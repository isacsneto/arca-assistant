import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jsonSchema } from "./claude";
import { inlineTexts, stageFiles } from "./files";
import { quickExec, runProcess } from "./proc";
import { keyEnvVars } from "./secrets";
import { AiError, type Engine } from "./types";

/*
 * Cursor via o CLI `agent` (instalado à parte: https://cursor.com/docs/cli/installation).
 * - login local: `agent login`;  - chave de API: CURSOR_API_KEY só neste processo.
 * O CLI não tem saída com schema: o pedido vai num arquivo prompt.md com o schema,
 * a resposta (texto) é convertida em JSON e validada; se falhar, tenta mais uma vez.
 */

const CANDIDATES = ["agent", "cursor-agent"];
const isWin = process.platform === "win32";

/** O comando existe no PATH? (`where`/`which` pelo código de saída — a mensagem varia com idioma/codificação.) */
function onPath(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(isWin ? "where" : "which", [cmd], { timeout: 8000, windowsHide: true }, (err) => resolve(!err));
  });
}

let resolved: { bin: string | null; at: number } | undefined;
/** Descobre o nome do executável do Cursor CLI no PATH (revalida a cada minuto, caso seja instalado depois). */
export async function cursorBin(): Promise<string | null> {
  if (resolved && Date.now() - resolved.at < 60_000) return resolved.bin;
  let bin: string | null = null;
  for (const c of CANDIDATES) {
    if (await onPath(c)) {
      bin = c;
      break;
    }
  }
  resolved = { bin, at: Date.now() };
  return bin;
}

/** Extrai o primeiro objeto JSON de um texto (com ou sem bloco ```json). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  if (start < 0) throw new Error("sem JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error("JSON incompleto");
}

export function cursorArgs(o: { model?: string; instruction: string }): string[] {
  return ["-p", "--output-format", "json", ...(o.model ? ["--model", o.model] : []), o.instruction];
}

function env(apiKey?: string): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of keyEnvVars("cursor")) delete e[k];
  if (apiKey) e.CURSOR_API_KEY = apiKey;
  return e;
}

const INSTRUCTION = "Leia o arquivo prompt.md nesta pasta e execute exatamente o que ele pede. Responda somente com o JSON final.";

export const cursorEngine: Engine = async (req, { task, apiKey }) => {
  const bin = await cursorBin();
  if (!bin) throw new AiError("Cursor CLI não encontrado. Instale em https://cursor.com/docs/cli/installation e rode `agent login`.", 400);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arca-cursor-"));
  try {
    const staged = req.files?.length ? await stageFiles(req.files, dir, { pdfAsText: true }) : [];
    const images = staged.filter((s) => s.kind === "image" && s.path);
    const base = [
      "# Instruções",
      req.system,
      "",
      "# Tarefa",
      req.prompt,
      images.length
        ? `\nAbra e analise estas imagens nesta pasta:\n${images.map((s) => `- ./${path.basename(s.path!)} (arquivo original "${s.original}"${s.note})`).join("\n")}`
        : "",
      inlineTexts(staged),
      req.web ? "\nUse sua ferramenta de busca na web para obter dados atuais." : "",
      "\n# Formato da resposta",
      "Responda SOMENTE com um objeto JSON válido (sem texto antes ou depois, sem comentários) que siga exatamente este JSON Schema:",
      "```json",
      JSON.stringify(jsonSchema(req.schema), null, 2),
      "```",
    ].join("\n");

    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0 ? base : `${base}\n\nATENÇÃO: a resposta anterior não seguiu o schema (${lastError}). Corrija e responda só o JSON.`;
      await fs.writeFile(path.join(dir, "prompt.md"), prompt);
      req.onProgress?.({ type: "status", text: attempt === 0 ? "Cursor trabalhando…" : "Cursor corrigindo o formato…" });
      // No Windows o CLI é um .cmd e roda via shell: a instrução precisa ir entre aspas.
      const instruction = isWin ? `"${INSTRUCTION}"` : INSTRUCTION;
      const { code, stdout, stderr } = await runProcess(bin, cursorArgs({ model: task.model, instruction }), {
        cwd: dir,
        env: env(task.auth === "apiKey" ? apiKey : undefined),
        signal: req.signal,
        shell: isWin,
      });
      let result: { is_error?: boolean; result?: string } = {};
      try {
        result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
      } catch {
        /* saída não-JSON */
      }
      if (code !== 0 || result.is_error || !result.result) {
        const why = (result.result || stderr || `código ${code}`).slice(-400);
        if (/log ?in|unauthori[sz]ed|401|api key/i.test(why))
          throw new AiError(task.auth === "apiKey" ? "Chave da API do Cursor inválida." : "Cursor CLI não está logado. Rode `agent login`.", 401);
        if (/rate.?limit|usage limit|429/i.test(why)) throw new AiError("Limite de uso do Cursor atingido.", 429);
        throw new AiError(`O Cursor não retornou resultado: ${why}`);
      }
      try {
        const parsed = req.schema.safeParse(extractJson(result.result));
        if (parsed.success) return { data: parsed.data, searches: 0 };
        lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    throw new AiError("O Cursor respondeu fora do formato esperado. Tente novamente ou use outro provedor.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Status do Cursor CLI (instalado / logado). */
export async function cursorStatus(): Promise<{ installed: boolean; loggedIn: boolean | null; account?: string }> {
  const bin = await cursorBin();
  if (!bin) return { installed: false, loggedIn: null };
  const out = await quickExec(bin, ["status"], isWin, env());
  if (out == null) return { installed: true, loggedIn: null };
  if (/not (logged|authenticated)|log ?in required|please (log|sign) ?in/i.test(out)) return { installed: true, loggedIn: false };
  const email = out.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (/logged in|authenticated/i.test(out)) return { installed: true, loggedIn: true, account: email };
  return { installed: true, loggedIn: null };
}
