import type { Effort, Settings } from "./types";
import { L, type Lang } from "./i18n";

/*
 * Provedores de IA suportados. Cada um roda pelo seu próprio CLI, com o login
 * local do usuário ("local") ou com uma chave de API ("apiKey").
 */
export const PROVIDERS = {
  claude: {
    label: "Claude",
    vendor: "Anthropic",
    get local() { return L("Claude Code — login da sua assinatura", "Claude Code — your subscription login"); },
    loginCmd: "claude auth login",
    install: "https://claude.com/claude-code",
    get keyLabel() { return L("Chave da API Anthropic", "Anthropic API key"); },
    keyEnv: "ANTHROPIC_API_KEY",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  codex: {
    label: "Codex (ChatGPT)",
    vendor: "OpenAI",
    get local() { return L("Codex CLI — login do ChatGPT (já incluso no app)", "Codex CLI — ChatGPT login (bundled with the app)"); },
    loginCmd: "npx codex login",
    install: "https://developers.openai.com/codex/cli",
    get keyLabel() { return L("Chave da API OpenAI", "OpenAI API key"); },
    keyEnv: "CODEX_API_KEY",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  cursor: {
    label: "Cursor",
    vendor: "Cursor",
    get local() { return L("Cursor CLI (agent) — login do Cursor", "Cursor CLI (agent) — Cursor login"); },
    loginCmd: "agent login",
    install: "https://cursor.com/docs/cli/installation",
    get keyLabel() { return L("Chave da API do Cursor", "Cursor API key"); },
    keyEnv: "CURSOR_API_KEY",
    keyPlaceholder: "key_…",
    keyUrl: "https://cursor.com/dashboard?tab=integrations",
  },
} as const;
export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export type AuthMode = "local" | "apiKey";

export interface AiSettings {
  provider: ProviderId;
  auth: AuthMode;
  /** Modelos do Codex/Cursor por "força" (vazio = padrão do CLI). No Claude o modelo é escolhido por tarefa. */
  models: Record<Exclude<ProviderId, "claude">, { strong: string; fast: string }>;
}

export const DEFAULT_AI: AiSettings = {
  provider: "claude",
  auth: "local",
  models: { codex: { strong: "", fast: "" }, cursor: { strong: "", fast: "" } },
};

export type AiTaskName = "extraction" | "refine" | "prompt" | "refresh" | "estimate" | "scan" | "projection";

/** Pesquisas longas usam o modelo "forte"; leitura e lookups usam o "rápido". */
export const TASK_TIER: Record<AiTaskName, "strong" | "fast"> = {
  extraction: "fast",
  refine: "fast",
  prompt: "fast",
  refresh: "fast",
  estimate: "fast",
  scan: "strong",
  projection: "strong",
};

/** Tudo que um motor precisa saber para rodar uma tarefa. */
export interface AiTask {
  task: AiTaskName;
  provider: ProviderId;
  auth: AuthMode;
  /** undefined = modelo padrão do provedor. */
  model?: string;
  effort: Effort;
  /** Idioma dos textos que a IA escreve para o usuário. */
  language?: Lang;
}

export function aiSettings(settings: Pick<Settings, "ai">): AiSettings {
  const ai = settings.ai;
  if (!ai || !PROVIDER_IDS.includes(ai.provider)) return DEFAULT_AI;
  return {
    provider: ai.provider,
    auth: ai.auth === "apiKey" ? "apiKey" : "local",
    models: {
      codex: { ...DEFAULT_AI.models.codex, ...ai.models?.codex },
      cursor: { ...DEFAULT_AI.models.cursor, ...ai.models?.cursor },
    },
  };
}

export function aiFor(settings: Settings, task: AiTaskName): AiTask {
  const ai = aiSettings(settings);
  const setting =
    task === "refine" || task === "prompt" ? settings.extraction : settings[task];
  const model =
    ai.provider === "claude" ? setting.model : ai.models[ai.provider][TASK_TIER[task]].trim() || undefined;
  return { task, provider: ai.provider, auth: ai.auth, model, effort: setting.effort, language: settings.language };
}

/** Rótulo curto para mostrar/gravar quem gerou um resultado. */
export function aiLabel(t: Pick<AiTask, "provider" | "model">): string {
  return t.model ? `${PROVIDERS[t.provider].label} · ${t.model}` : PROVIDERS[t.provider].label;
}

export interface ProviderStatus {
  /** CLI encontrado (Claude e Codex vêm embutidos no app). */
  installed: boolean;
  /** null = não deu para verificar. */
  loggedIn: boolean | null;
  account?: string;
  /** Há chave de API salva (ou na variável de ambiente). */
  hasKey: boolean;
  detail?: string;
}
export type AiStatus = Record<ProviderId, ProviderStatus>;

/** O provedor/modo escolhidos estão prontos para uso? */
export function isAiReady(ai: AiSettings, status: AiStatus): boolean {
  const s = status[ai.provider];
  if (!s) return false;
  return ai.auth === "apiKey" ? s.hasKey && s.installed : s.installed && s.loggedIn !== false;
}
