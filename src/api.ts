import type { AiStatus, ProviderId } from "../shared/ai";
import type { FxRates } from "../shared/currency";
import type { OpenFinanceImport } from "../shared/openFinance";
import type {
  AppState, DayQuote, ExtractionResult, MarketSnapshot, PromptImportRequest, PromptPlan, RefineRequest, ScanEvent, SearchHit, UploadFile, View,
} from "../shared/types";
import { L } from "../shared/i18n";

export interface MarketData extends MarketSnapshot {
  benchmarks: { symbol: string; label: string; quote: DayQuote | null }[];
}

export interface ModelOption {
  id: string;
  label: string;
  tier: string;

  hint: string;
}
export interface Config {
  hasCredentials: boolean;
  account?: string;
  provider: ProviderId;
  auth: "local" | "apiKey";
  aiStatus: AiStatus;
  models: ModelOption[];
}

export interface OpenFinanceStatus {
  available: boolean;
  configured: boolean;
  /** Fim do Client ID, para o usuário reconhecer qual está salvo. */
  clientIdHint: string | null;
}
export interface OpenFinanceItem {
  id: string;
  name: string | null;
  status: string | null;
  lastUpdatedAt: string | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? L(`Erro ${res.status}`, `Error ${res.status}`));
  return body as T;
}

export const api = {
  getState: () => fetch("/api/state").then((r) => json<AppState>(r)),
  putState: (s: AppState) =>
    fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: s.positions, transactions: s.transactions, assets: s.assets, settings: s.settings }),
    }).then((r) => json<{ ok: true }>(r)),
  getConfig: (refresh = false) => fetch(`/api/config${refresh ? "?refresh=1" : ""}`).then((r) => json<Config>(r)),
  /** Salva (ou remove, com null) a chave de API de um provedor — fica só no servidor. */
  setAiKey: (provider: ProviderId, key: string | null) =>
    fetch("/api/ai/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, key }) }).then((r) => json<{ ok: true }>(r)),
  getFx: () => fetch("/api/fx").then((r) => json<{ fx: FxRates }>(r)),
  importFiles: (files: UploadFile[], signal?: AbortSignal) =>
    fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
      signal,
    }).then((r) => json<ExtractionResult>(r)),
  interpretPrompt: (body: PromptImportRequest, signal?: AbortSignal) =>
    fetch("/api/import/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) => json<PromptPlan>(r)),
  /** Open Finance (Meu Pluggy): status das credenciais (o segredo nunca volta ao navegador). */
  openFinanceStatus: () => fetch("/api/openfinance").then((r) => json<OpenFinanceStatus>(r)),
  setOpenFinanceCredentials: (creds: { clientId: string; clientSecret: string } | null) =>
    fetch("/api/openfinance/credentials", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds ?? { clientId: null }),
    }).then((r) => json<{ ok: true }>(r)),
  openFinanceItems: () => fetch("/api/openfinance/items").then((r) => json<{ items: OpenFinanceItem[] }>(r)),
  openFinanceSync: (signal?: AbortSignal) =>
    fetch("/api/openfinance/sync", { method: "POST", signal }).then((r) => json<OpenFinanceImport>(r)),
  /** Mercado: variação do dia dos principais ativos da visão + referências (Ibovespa, S&P 500…). */
  market: (view: View, signal?: AbortSignal) => fetch(`/api/market?view=${view}`, { signal }).then((r) => json<MarketData>(r)),
  searchAssets: (q: string, signal?: AbortSignal) =>
    fetch(`/api/market/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => json<{ results: SearchHit[] }>(r)),
  quote: (symbol: string, signal?: AbortSignal) =>
    fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`, { signal }).then((r) => json<{ quote: DayQuote }>(r)),
  deleteResearch: (id: string) => fetch(`/api/research/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  refineImport: (body: RefineRequest, signal?: AbortSignal) =>
    fetch("/api/import/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) => json<ExtractionResult>(r)),
};

/** Consome o stream SSE do scan. */
export function runScan(classes: string[], onEvent: (e: ScanEvent) => void, signal: AbortSignal): Promise<void> {
  return streamEvents("/api/scan", { classes }, onEvent, signal);
}

/** POST que responde com Server-Sent Events; chama `onEvent` para cada `data:`. */
export async function streamEvents<E>(url: string, body: unknown, onEvent: (e: E) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? L(`Erro ${res.status}`, `Error ${res.status}`));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as E);
    }
  }
}
