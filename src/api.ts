import type { AppState, ExtractionResult, PromptImportRequest, PromptPlan, RefineRequest, ScanEvent, UploadFile } from "../shared/types";

export interface ModelOption {
  id: string;
  label: string;
  tier: string;

  hint: string;
}
export interface Config {
  hasCredentials: boolean;
  account?: string;
  models: ModelOption[];
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  return body as T;
}

export const api = {
  getState: () => fetch("/api/state").then((r) => json<AppState>(r)),
  putState: (s: AppState) =>
    fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: s.positions, transactions: s.transactions, settings: s.settings }),
    }).then((r) => json<{ ok: true }>(r)),
  getConfig: () => fetch("/api/config").then((r) => json<Config>(r)),
  getFx: () => fetch("/api/fx").then((r) => json<{ usdBrl: number }>(r)),
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
    throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
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
