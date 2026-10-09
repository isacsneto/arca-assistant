import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  ClaudeRefreshSchema,
  ExtractionResultSchema,
  ProjectionAssumptionsSchema,
  PromptPlanSchema,
  ScanReportSchema,
  type AppState,
  type ClaudeRefresh,
  type JobEvent,
  type Position,
  type ProjectionResult,
  type PromptImportRequest,
  type PromptPlan,
  type RefineRequest,
  type ArcaClass,
  type Effort,
  type ExtractionResult,
  type ScanEvent,
  type ScanResult,
  type UploadFile,
} from "../shared/types";
import { computeAllocation, toBRL } from "../shared/arca";
import { fileNameNote, finalizeExtraction } from "../shared/importReview";
import {
  EXTRACTION_SYSTEM, PROJECTION_SYSTEM, PROMPT_IMPORT_SYSTEM, REFINE_SYSTEM, REFRESH_SYSTEM,
  projectionPrompt, promptImportPrompt, refinePrompt, refreshPrompt, scanPrompt, scanSystem,
} from "./prompts";

/*
 * A IA roda pelo Claude Code instalado na máquina (Agent SDK), usando o login
 * da sua assinatura (`claude auth login`) — não precisa de ANTHROPIC_API_KEY.
 * Cada chamada é isolada: sem CLAUDE.md/hooks/MCP do usuário, sem sessão salva,
 * e só com as ferramentas mínimas (Read para prints; WebSearch/WebFetch para pesquisas).
 */

export class ClaudeError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

const LOGIN_HELP = "Claude Code não está logado. Rode `claude auth login` no terminal e tente de novo.";

export function explainError(err: unknown): ClaudeError {
  if (err instanceof ClaudeError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT|spawn/i.test(msg)) return new ClaudeError("Não foi possível iniciar o Claude Code. Verifique a instalação (`claude --version`).");
  if (/not logged in|log ?in|authenticat|api key|credential|\b401\b|oauth/i.test(msg)) return new ClaudeError(LOGIN_HELP, 401);
  if (/rate.?limit|usage limit|429|overloaded/i.test(msg))
    return new ClaudeError("Limite de uso da assinatura atingido. Aguarde o reset ou use um modelo/esforço menor.", 429);
  return new ClaudeError(msg);
}

/* ------------------------------------------------------------------ */
/* Autenticação                                                        */
/* ------------------------------------------------------------------ */

export interface AuthInfo {
  loggedIn: boolean;
  account?: string;
}

let authCache: { at: number; info: AuthInfo } | null = null;

export function authStatus(): Promise<AuthInfo> {
  if (authCache && Date.now() - authCache.at < 30_000) return Promise.resolve(authCache.info);
  return new Promise((resolve) => {
    execFile("claude", ["auth", "status"], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      let info: AuthInfo;
      try {
        const j = JSON.parse(stdout) as { loggedIn?: boolean; subscriptionType?: string; authMethod?: string };
        info = {
          loggedIn: Boolean(j.loggedIn),
          account: j.subscriptionType ? `Claude ${j.subscriptionType[0].toUpperCase()}${j.subscriptionType.slice(1)}` : j.authMethod,
        };
      } catch {
        // CLI fora do PATH: o SDK usa o binário embutido e as credenciais de ~/.claude; deixe tentar.
        info = { loggedIn: !err };
      }
      authCache = { at: Date.now(), info };
      resolve(info);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Execução isolada com saída estruturada                              */
/* ------------------------------------------------------------------ */

interface RunArgs<S extends z.ZodType> {
  prompt: string;
  system: string;
  model: string;
  effort: Effort;
  schema: S;
  cwd: string;
  tools: string[];
  maxTurns: number;
  signal?: AbortSignal;
  onAssistantBlock?: (block: { type: string; name?: string; input?: unknown }) => void;
}

function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "arca-assistant/0.1" };
  // Variável vazia no .env faria o CLI tentar autenticar por chave em vez do login.
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) if (!env[k]) delete env[k];
  return env;
}

/** O validador do CLI não conhece o meta-schema 2020-12 que o zod emite por padrão. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

async function runStructured<S extends z.ZodType>(a: RunArgs<S>): Promise<{ data: z.infer<S>; turns: number }> {
  const abortController = new AbortController();
  if (a.signal?.aborted) abortController.abort();
  else a.signal?.addEventListener("abort", () => abortController.abort(), { once: true });

  const options: Options = {
    model: a.model,
    effort: a.effort,
    systemPrompt: a.system,
    cwd: a.cwd,
    tools: a.tools,
    allowedTools: a.tools,
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: a.maxTurns,
    abortController,
    env: cleanEnv(),
    outputFormat: { type: "json_schema", schema: jsonSchema(a.schema) },
  };

  for await (const msg of query({ prompt: a.prompt, options })) {
    if (msg.type === "assistant") {
      if (msg.error === "authentication_failed") throw new ClaudeError(LOGIN_HELP, 401);
      if (msg.error === "rate_limit") throw new ClaudeError("Limite de uso da assinatura atingido. Aguarde o reset ou use um modelo/esforço menor.", 429);
      for (const block of msg.message.content) a.onAssistantBlock?.(block as { type: string; name?: string; input?: unknown });
    } else if (msg.type === "result") {
      if (msg.subtype !== "success") {
        if (msg.subtype === "error_max_turns") throw new ClaudeError("A análise passou do limite de passos. Tente com menos categorias ou esforço menor.");
        throw new ClaudeError(msg.errors?.join(" ") || `Falha na execução (${msg.subtype}).`);
      }
      if (msg.is_error) throw explainError(new Error(msg.result));
      const parsed = a.schema.safeParse(msg.structured_output);
      if (!parsed.success) throw new ClaudeError("Não foi possível interpretar a resposta do modelo. Tente novamente.");
      return { data: parsed.data, turns: msg.num_turns };
    }
  }
  if (abortController.signal.aborted) throw new ClaudeError("Cancelado.");
  throw new ClaudeError("O Claude não retornou resultado.");
}

/* ------------------------------------------------------------------ */
/* Extração de prints / exports                                        */
/* ------------------------------------------------------------------ */

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

/**
 * Grava imagens/PDFs numa pasta temporária para o Claude ler com a ferramenta Read
 * e devolve o trecho do prompt que lista os caminhos (texto/CSV vai inline).
 */
async function stageFiles(files: UploadFile[], dir: string): Promise<string> {
  const lines: string[] = [];
  const inline: string[] = [];
  for (const [i, f] of files.entries()) {
    if (f.kind === "text") {
      inline.push(`=== Arquivo ${i + 1}: ${f.name}${fileNameNote(f.name, f.looksLike)} (conteúdo abaixo) ===\n${f.data}`);
      continue;
    }
    const base = path.basename(f.name).replace(/[^\w.-]+/g, "_").replace(/\.[^.]*$/, "");
    const ext = f.kind === "pdf" ? ".pdf" : (EXT[f.mediaType ?? ""] ?? ".png");
    const file = path.join(dir, `${i + 1}-${base}${ext}`);
    await fs.writeFile(file, Buffer.from(f.data, "base64"));
    lines.push(`- ${file}  (arquivo original: "${f.name}"${fileNameNote(f.name, f.looksLike)})`);
  }
  return [
    lines.length
      ? `\nUse a ferramenta Read em CADA um destes caminhos (imagens e PDFs são lidos visualmente; em PDFs com mais de 10 páginas leia em blocos de até 10 páginas):\n${lines.join("\n")}`
      : "",
    inline.length ? `\n${inline.join("\n\n")}` : "",
  ].join("\n");
}

export async function extractFromFiles(
  files: UploadFile[],
  model: string,
  effort: Effort,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-import-"));
  try {
    const prompt = [
      "Extraia todas as posições e transações dos arquivos abaixo, seguindo as regras do sistema. Preencha \"files\" com uma leitura por arquivo (pelo nome original), verifique duplicados entre os arquivos e faça perguntas só se algo não puder ser classificado com segurança.",
      await stageFiles(files, dir),
      "\nUse o nome do arquivo original em sourceFile. Responda apenas com o resultado estruturado.",
    ].join("\n");

    const { data } = await runStructured({
      prompt,
      system: EXTRACTION_SYSTEM,
      model,
      effort,
      schema: ExtractionResultSchema,
      cwd: dir,
      tools: ["Read"],
      maxTurns: 6 + files.length * 3,
      signal,
    });
    return finalizeExtraction(data, files.map((f) => f.name));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Import por texto: interpreta a frase do usuário em operações sobre a carteira atual. */
export async function interpretPrompt(
  req: PromptImportRequest,
  positions: Position[],
  model: string,
  effort: Effort,
  signal?: AbortSignal,
): Promise<PromptPlan> {
  const today = new Date().toLocaleDateString("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" });
  const files = req.files ?? [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-prompt-"));
  try {
    const attachments = files.length ? await stageFiles(files, dir) : "";
    const { data } = await runStructured({
      prompt: promptImportPrompt({ text: req.text, today, positions, answers: req.answers, attachments }),
      system: PROMPT_IMPORT_SYSTEM,
      model,
      effort,
      schema: PromptPlanSchema,
      cwd: dir,
      tools: files.length ? ["Read"] : [],
      maxTurns: 3 + files.length * 3,
      signal,
    });
    return {
      ...data,
      questions: data.questions.slice(0, 4).map((q, i) => ({ ...q, id: q.id || "q" + (i + 1), options: q.options.slice(0, 4) })),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Segunda rodada: aplica as respostas do usuário às perguntas, sem reenviar os arquivos. */
export async function refineImport(req: RefineRequest, model: string, effort: Effort, signal?: AbortSignal): Promise<ExtractionResult> {
  const { data } = await runStructured({
    prompt: refinePrompt(req),
    system: REFINE_SYSTEM,
    model,
    effort,
    schema: ExtractionResultSchema,
    cwd: os.tmpdir(),
    tools: [],
    maxTurns: 3,
    signal,
  });
  // Nunca perder itens numa revisão: se o modelo devolver menos, o pedido foi mal aplicado.
  const removalAsked = req.answers.some((a) => /duplicad|ignor|remov|exclu|apag/i.test(a.answer));
  if (!removalAsked && data.items.length < req.items.length)
    throw new ClaudeError("A revisão perdeu itens da importação. Tente responder de novo.");
  return finalizeExtraction(data, req.files.map((f) => f.file));
}

/* ------------------------------------------------------------------ */
/* Pesquisa na web (scan, atualizar valores, projeção)                 */
/* ------------------------------------------------------------------ */

type Progress = { type: "status"; text: string } | { type: "search"; query: string } | { type: "fetch"; url: string };

/** Roda uma pesquisa com WebSearch/WebFetch e saída estruturada, emitindo o progresso. */
async function webResearch<S extends z.ZodType>(a: {
  prompt: string;
  system: string;
  model: string;
  effort: Effort;
  schema: S;
  maxTurns: number;
  signal: AbortSignal;
  emit: (e: Progress) => void;
}): Promise<{ data: z.infer<S>; searches: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-web-"));
  let searches = 0;
  try {
    const { data } = await runStructured({
      prompt: a.prompt,
      system: a.system,
      model: a.model,
      effort: a.effort,
      schema: a.schema,
      cwd: dir,
      tools: ["WebSearch", "WebFetch"],
      maxTurns: a.maxTurns,
      signal: a.signal,
      onAssistantBlock: (b) => {
        const input = (b.input ?? {}) as { query?: string; url?: string };
        if (b.type === "tool_use" && b.name === "WebSearch" && input.query) {
          searches++;
          a.emit({ type: "search", query: input.query });
        } else if (b.type === "tool_use" && b.name === "WebFetch" && input.url) {
          a.emit({ type: "fetch", url: input.url });
        } else if (b.type === "thinking") {
          a.emit({ type: "status", text: "Analisando…" });
        } else if (b.type === "text") {
          a.emit({ type: "status", text: "Consolidando resultado…" });
        }
      },
    });
    return { data, searches };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const todayBR = () => new Date().toLocaleDateString("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

export async function scanClass(
  assetClass: ArcaClass,
  state: AppState,
  emit: (e: ScanEvent) => void,
  signal: AbortSignal,
): Promise<ScanResult> {
  const { settings, positions } = state;
  emit({ type: "status", assetClass, text: "Iniciando pesquisa…" });
  const { data, searches } = await webResearch({
    prompt: scanPrompt({ assetClass, today: todayBR(), allocation: computeAllocation(positions, settings.usdBrl), settings, positions }),
    system: scanSystem(),
    model: settings.scan.model,
    effort: settings.scan.effort,
    schema: ScanReportSchema,
    maxTurns: 80,
    signal,
    emit: (e) => emit({ ...e, assetClass }),
  });
  return { ...data, assetClass, runAt: new Date().toISOString(), model: settings.scan.model, effort: settings.scan.effort, searches };
}

export async function refreshWithClaude(
  positions: Position[],
  ctx: { usdBrl: number; state: AppState },
  emit: (e: Progress) => void,
  signal: AbortSignal,
): Promise<ClaudeRefresh> {
  const { refresh } = ctx.state.settings;
  const { data } = await webResearch({
    prompt: refreshPrompt({ positions, today: todayBR(), usdBrl: ctx.usdBrl }),
    system: REFRESH_SYSTEM,
    model: refresh.model,
    effort: refresh.effort,
    schema: ClaudeRefreshSchema,
    maxTurns: 40,
    signal,
    emit,
  });
  return data;
}

export async function projectWithClaude(
  state: AppState,
  emit: (e: JobEvent<ProjectionResult>) => void,
  signal: AbortSignal,
): Promise<ProjectionResult> {
  const { settings, positions } = state;
  const baseTotal = positions.reduce((s, p) => s + toBRL(p, settings.usdBrl), 0);
  emit({ type: "status", text: "Iniciando pesquisa de cenários…" });
  const { data, searches } = await webResearch({
    prompt: projectionPrompt({ positions, settings, today: todayBR(), total: baseTotal }),
    system: PROJECTION_SYSTEM,
    model: settings.projection.model,
    effort: settings.projection.effort,
    schema: ProjectionAssumptionsSchema,
    maxTurns: 80,
    signal,
    emit,
  });
  return {
    ...data,
    runAt: new Date().toISOString(),
    model: settings.projection.model,
    effort: settings.projection.effort,
    searches,
    baseTotal,
  };
}
