import { execFile } from "node:child_process";
import { L, LANGS } from "../../shared/i18n";
import type { z } from "zod";
import { PROVIDERS, PROVIDER_IDS, type AiStatus, type AiTask, type ProviderId } from "../../shared/ai";
import { claudeEngine } from "./claude";
import { codexEngine, codexStatus } from "./codex";
import { cursorEngine, cursorStatus } from "./cursor";
import { fileSecrets, type SecretStore } from "./secrets";
import { secretsFile } from "../paths";
import { AiError, type AiRequest, type AiResult, type Engine } from "./types";

export { AiError } from "./types";
export type { AiRequest, Progress } from "./types";

const ENGINES: Record<ProviderId, Engine> = { claude: claudeEngine, codex: codexEngine, cursor: cursorEngine };

let secrets: SecretStore = fileSecrets(secretsFile());
let engines: Record<ProviderId, Engine> = ENGINES;

/** Para testes: troca o armazenamento de chaves e os motores. */
export function configureAi(o: { secrets?: SecretStore; engines?: Partial<Record<ProviderId, Engine>> }) {
  if (o.secrets) secrets = o.secrets;
  if (o.engines) engines = { ...ENGINES, ...o.engines };
  statusCache = null;
}

/** Roda um pedido no provedor/modo escolhidos para a tarefa. */
export async function runAi<S extends z.ZodType>(task: AiTask, req: AiRequest<S>): Promise<AiResult<z.infer<S>>> {
  let apiKey: string | undefined;
  if (task.auth === "apiKey") {
    apiKey = secrets.get(task.provider);
    if (!apiKey) throw new AiError(
        L(
          `Nenhuma ${PROVIDERS[task.provider].keyLabel.toLowerCase()} salva. Cadastre em Ajustes → Provedor de IA.`,
          `No ${PROVIDERS[task.provider].keyLabel} saved. Add it in Settings → AI provider.`,
        ),
        401,
      );
  }
  // Os prompts são em português; o idioma da resposta segue o da interface.
  const language = LANGS[task.language ?? "pt"].ai;
  const system = `${req.system}\n\n## Idioma da resposta\nWrite every human-readable text field of the JSON (summaries, explanations, questions, options, notes, warnings, theses, rationales) in ${language}. Keep tickers, product names, enum values and numbers unchanged.`;
  return engines[task.provider]({ ...req, system }, { task, apiKey });
}

export function setApiKey(provider: ProviderId, key: string | null) {
  secrets.set(provider, key);
  statusCache = null;
}

/* ------------------------------------------------------------------ */
/* Status dos provedores                                               */
/* ------------------------------------------------------------------ */

function claudeLocalStatus(): Promise<{ installed: boolean; loggedIn: boolean | null; account?: string }> {
  return new Promise((resolve) => {
    execFile("claude", ["auth", "status"], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      try {
        const j = JSON.parse(stdout) as { loggedIn?: boolean; subscriptionType?: string; authMethod?: string };
        resolve({
          installed: true,
          loggedIn: Boolean(j.loggedIn),
          account: j.subscriptionType ? `Claude ${j.subscriptionType[0].toUpperCase()}${j.subscriptionType.slice(1)}` : j.authMethod,
        });
      } catch {
        // CLI fora do PATH: o SDK usa o binário embutido e as credenciais de ~/.claude; deixe tentar.
        resolve({ installed: true, loggedIn: err ? null : true });
      }
    });
  });
}

let statusCache: { at: number; value: AiStatus } | null = null;

export async function aiStatus(force = false): Promise<AiStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value;
  const [claude, codex, cursor] = await Promise.all([claudeLocalStatus(), codexStatus(), cursorStatus()]);
  const value = Object.fromEntries(
    PROVIDER_IDS.map((p) => [p, { ...{ claude, codex, cursor }[p], hasKey: secrets.has(p) }]),
  ) as AiStatus;
  statusCache = { at: Date.now(), value };
  return value;
}

/** Mensagem útil para erros que vêm de qualquer provedor. */
export function explainError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT|spawn/i.test(msg)) return new AiError(L("Não foi possível iniciar o CLI da IA. Verifique a instalação em Ajustes → Provedor de IA.", "Couldn't start the AI CLI. Check the installation in Settings → AI provider."));
  if (/not logged in|log ?in|authenticat|api key|credential|\b401\b|oauth/i.test(msg))
    return new AiError(L("A IA não está autenticada. Faça login no CLI ou cadastre uma chave de API em Ajustes → Provedor de IA.", "The AI isn't authenticated. Log in to the CLI or add an API key in Settings → AI provider."), 401);
  if (/rate.?limit|usage limit|429|overloaded|quota/i.test(msg))
    return new AiError(L("Limite de uso da IA atingido. Aguarde o reset ou use um modelo/esforço menor.", "AI usage limit reached. Wait for the reset or use a smaller model/effort."), 429);
  return new AiError(msg);
}
