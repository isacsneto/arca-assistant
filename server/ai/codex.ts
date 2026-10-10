import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { jsonSchema } from "./claude";
import { inlineTexts, stageFiles } from "./files";
import { runProcess, quickExec } from "./proc";
import { keyEnvVars } from "./secrets";
import { AiError, type Engine, type Progress } from "./types";
import type { Effort } from "../../shared/types";
import { L } from "../../shared/i18n";

/*
 * Codex (OpenAI) via `codex exec` — o CLI vem como dependência (@openai/codex).
 * - login local: usa ~/.codex (login do ChatGPT ou chave salva pelo próprio Codex);
 * - chave de API: CODEX_API_KEY só neste processo.
 * Saída estruturada com --output-schema; progresso pelos eventos --json; busca com web_search="live".
 */

const require = createRequire(import.meta.url);

export function codexEntry(): string {
  return require.resolve("@openai/codex/bin/codex.js");
}

/** O Codex aceita minimal/low/medium/high; níveis acima viram "high". */
export function codexEffort(e: Effort): "low" | "medium" | "high" {
  return e === "low" ? "low" : e === "medium" ? "medium" : "high";
}

export function codexArgs(o: {
  dir: string;
  schemaPath: string;
  outPath: string;
  model?: string;
  effort: Effort;
  web: boolean;
  images: string[];
}): string[] {
  const args = [
    "exec", "--json", "--skip-git-repo-check", "--ephemeral",
    "-s", "read-only",
    "-C", o.dir,
    "--output-schema", o.schemaPath,
    "-o", o.outPath,
    "-c", `model_reasoning_effort="${codexEffort(o.effort)}"`,
  ];
  if (o.web) args.push("-c", 'web_search="live"');
  if (o.model) args.push("-m", o.model);
  // "--image=a,b" (com "=") para o "-" final não ser lido como mais uma imagem.
  if (o.images.length) args.push(`--image=${o.images.join(",")}`);
  args.push("-"); // prompt pelo stdin (sem limite de tamanho de linha de comando)
  return args;
}

/** Traduz um evento JSONL do `codex exec --json` em progresso (ou erro). */
export function parseCodexEvent(line: string): { progress?: Progress; error?: string } | null {
  let e: { type?: string; item?: Record<string, unknown> & { type?: string }; message?: string; error?: { message?: string } };
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  const item = e.item;
  if (e.type === "item.completed" && item?.type === "web_search") {
    const q = (item.query as string) || ((item.action as { query?: string } | undefined)?.query ?? "");
    return q ? { progress: { type: "search", query: q } } : null;
  }
  if (e.type === "item.started" && item?.type === "web_search") return { progress: { type: "status", text: L("Pesquisando na web…", "Searching the web…") } };
  if (e.type === "item.started" && item?.type === "reasoning") return { progress: { type: "status", text: L("Analisando…", "Analyzing…") } };
  if (e.type === "item.started" && item?.type === "command_execution") return { progress: { type: "status", text: L("Lendo arquivos…", "Reading files…") } };
  if (e.type === "item.completed" && item?.type === "agent_message") return { progress: { type: "status", text: L("Consolidando resultado…", "Consolidating results…") } };
  if (e.type === "turn.failed") return { error: e.error?.message || L("O Codex não conseguiu concluir a tarefa.", "Codex couldn't complete the task.") };
  if (e.type === "error") return { error: e.message || L("Erro no Codex.", "Codex error.") };
  return null;
}

function env(apiKey?: string): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of keyEnvVars("codex")) delete e[k];
  if (apiKey) e.CODEX_API_KEY = apiKey;
  return e;
}

export const codexEngine: Engine = async (req, { task, apiKey }) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-codex-"));
  let searches = 0;
  let failure: string | undefined;
  try {
    const staged = req.files?.length ? await stageFiles(req.files, dir, { pdfAsText: true }) : [];
    const images = staged.filter((s) => s.kind === "image" && s.path);
    const schemaPath = path.join(dir, "schema.json");
    const outPath = path.join(dir, "resposta.json");
    await fs.writeFile(schemaPath, JSON.stringify(jsonSchema(req.schema)));

    const prompt = [
      "# Instruções",
      req.system,
      "",
      "# Tarefa",
      req.prompt,
      images.length
        ? `\nImagens anexadas a esta mensagem, na ordem:\n${images.map((s, i) => `- imagem ${i + 1} = arquivo original "${s.original}"${s.note}`).join("\n")}`
        : "",
      inlineTexts(staged),
      req.web ? "\nUse a busca na web para obter dados atuais." : "\nNão é preciso pesquisar na web.",
      "\nResponda somente com o JSON final no schema exigido.",
    ].join("\n");

    req.onProgress?.({ type: "status", text: L("Codex trabalhando…", "Codex working…") });
    const { code, stderr } = await runProcess(
      process.execPath,
      [codexEntry(), ...codexArgs({ dir, schemaPath, outPath, model: task.model, effort: task.effort, web: req.web, images: images.map((s) => s.path!) })],
      {
        cwd: dir,
        env: env(task.auth === "apiKey" ? apiKey : undefined),
        stdin: prompt,
        signal: req.signal,
        onLine: (line) => {
          const ev = parseCodexEvent(line);
          if (ev?.progress?.type === "search") searches++;
          if (ev?.progress) req.onProgress?.(ev.progress);
          if (ev?.error) failure = ev.error;
        },
      },
    );

    let raw: string | null = null;
    try {
      raw = await fs.readFile(outPath, "utf8");
    } catch {
      /* sem resposta */
    }
    if (!raw?.trim()) {
      const why = failure || stderr.split("\n").filter(Boolean).slice(-3).join(" ") || L(`código ${code}`, `exit code ${code}`);
      if (/not logged in|login|unauthori[sz]ed|401|api key/i.test(why))
        throw new AiError(task.auth === "apiKey" ? L("Chave da API OpenAI inválida.", "Invalid OpenAI API key.") : L("Codex não está logado. Rode `npx codex login` na pasta do app (ou use uma chave de API em Ajustes).", "Codex isn't logged in. Run `npx codex login` in the app folder (or use an API key in Settings)."), 401);
      if (/rate.?limit|usage limit|429|quota/i.test(why)) throw new AiError(L("Limite de uso do Codex/ChatGPT atingido. Aguarde o reset.", "Codex/ChatGPT usage limit reached. Wait for the reset."), 429);
      throw new AiError(L(`O Codex não retornou resultado: ${why}`, `Codex returned no result: ${why}`));
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AiError(L("O Codex respondeu fora do formato esperado. Tente novamente.", "Codex responded in an unexpected format. Try again."));
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new AiError(L("Não foi possível interpretar a resposta do Codex. Tente novamente.", "Couldn't parse Codex's response. Try again."));
    return { data: parsed.data, searches };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Status do login do Codex (`codex login status`). */
export async function codexStatus(): Promise<{ installed: boolean; loggedIn: boolean | null; account?: string }> {
  let entry: string;
  try {
    entry = codexEntry();
  } catch {
    return { installed: false, loggedIn: null };
  }
  const out = await quickExec(process.execPath, [entry, "login", "status"], false, env());
  if (out == null) return { installed: true, loggedIn: null };
  if (/not logged in/i.test(out)) return { installed: true, loggedIn: false };
  if (/logged in/i.test(out)) return { installed: true, loggedIn: true, account: /chatgpt/i.test(out) ? "ChatGPT" : /api key/i.test(out) ? L("chave salva no Codex", "key saved in Codex") : undefined };
  return { installed: true, loggedIn: null };
}
