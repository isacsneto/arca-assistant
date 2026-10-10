import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { inlineTexts, stageFiles } from "./files";
import { keyEnvVars } from "./secrets";
import { AiError, type Engine } from "./types";
import { L } from "../../shared/i18n";

/*
 * Claude via Agent SDK (o binário do Claude Code vem embutido no pacote).
 * - login local: usa a assinatura logada em `claude auth login`;
 * - chave de API: injeta ANTHROPIC_API_KEY só neste processo.
 * Cada chamada é isolada: sem CLAUDE.md/hooks/MCP do usuário, sem sessão salva.
 */

const loginHelp = () =>
  L(
    "Claude Code não está logado. Rode `claude auth login` no terminal (ou use uma chave de API em Ajustes).",
    "Claude Code isn't logged in. Run `claude auth login` in the terminal (or use an API key in Settings).",
  );

/** O validador do CLI não conhece o meta-schema 2020-12 que o zod emite por padrão. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

function env(apiKey?: string): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "arca-assistant/0.1" };
  // Login local: nenhuma chave pode "vencer" o login. Chave: só a escolhida.
  for (const k of [...keyEnvVars("claude"), "ANTHROPIC_AUTH_TOKEN"]) delete e[k];
  if (apiKey) e.ANTHROPIC_API_KEY = apiKey;
  return e;
}

export const claudeEngine: Engine = async (req, { task, apiKey }) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-claude-"));
  const abortController = new AbortController();
  if (req.signal?.aborted) abortController.abort();
  else req.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  let searches = 0;

  try {
    const files = req.files ?? [];
    const staged = files.length ? await stageFiles(files, dir) : [];
    const readable = staged.filter((s) => s.path && s.text == null);
    const attachments = [
      readable.length
        ? `\nUse a ferramenta Read em CADA um destes caminhos (imagens e PDFs são lidos visualmente; em PDFs com mais de 10 páginas leia em blocos de até 10 páginas):\n${readable.map((s) => `- ${s.path}  (arquivo original: "${s.original}"${s.note})`).join("\n")}`
        : "",
      inlineTexts(staged),
    ].join("\n");

    const tools = [...(readable.length ? ["Read"] : []), ...(req.web ? ["WebSearch", "WebFetch"] : [])];
    const options: Options = {
      model: task.model,
      effort: task.effort,
      systemPrompt: req.system,
      cwd: dir,
      tools,
      allowedTools: tools,
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: req.maxTurns + readable.length * 2,
      abortController,
      env: env(task.auth === "apiKey" ? apiKey : undefined),
      outputFormat: { type: "json_schema", schema: jsonSchema(req.schema) },
    };

    for await (const msg of query({ prompt: req.prompt + attachments, options })) {
      if (msg.type === "assistant") {
        if (msg.error === "authentication_failed") throw new AiError(task.auth === "apiKey" ? L("Chave da API Anthropic inválida.", "Invalid Anthropic API key.") : loginHelp(), 401);
        if (msg.error === "rate_limit") throw new AiError(L("Limite de uso atingido. Aguarde o reset ou use um modelo/esforço menor.", "Usage limit reached. Wait for the reset or use a smaller model/effort."), 429);
        for (const block of msg.message.content as { type: string; name?: string; input?: { query?: string; url?: string } }[]) {
          if (block.type === "tool_use" && block.name === "WebSearch" && block.input?.query) {
            searches++;
            req.onProgress?.({ type: "search", query: block.input.query });
          } else if (block.type === "tool_use" && block.name === "WebFetch" && block.input?.url) {
            req.onProgress?.({ type: "fetch", url: block.input.url });
          } else if (block.type === "tool_use" && block.name === "Read") {
            req.onProgress?.({ type: "status", text: L("Lendo arquivos…", "Reading files…") });
          } else if (block.type === "thinking") {
            req.onProgress?.({ type: "status", text: L("Analisando…", "Analyzing…") });
          } else if (block.type === "text") {
            req.onProgress?.({ type: "status", text: L("Consolidando resultado…", "Consolidating results…") });
          }
        }
      } else if (msg.type === "result") {
        if (msg.subtype !== "success") {
          if (msg.subtype === "error_max_turns") throw new AiError(L("A análise passou do limite de passos. Tente de novo ou com esforço menor.", "The analysis exceeded the step limit. Try again or with lower effort."));
          throw new AiError(msg.errors?.join(" ") || L(`Falha na execução (${msg.subtype}).`, `Execution failed (${msg.subtype}).`));
        }
        if (msg.is_error) throw new Error(msg.result);
        const parsed = req.schema.safeParse(msg.structured_output);
        if (!parsed.success) throw new AiError(L("Não foi possível interpretar a resposta do modelo. Tente novamente.", "Couldn't parse the model's response. Try again."));
        return { data: parsed.data, searches };
      }
    }
    if (abortController.signal.aborted) throw new AiError(L("Cancelado.", "Cancelled."));
    throw new AiError(L("O Claude não retornou resultado.", "Claude returned no result."));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};
