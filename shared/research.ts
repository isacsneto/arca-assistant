import type { ResearchResult } from "./types";

/** Quantas pesquisas de ativos ficam salvas. */
export const MAX_RESEARCH = 30;

/** Mesmo ativo = mesmo símbolo (ou ticker, sem ".SA"). */
export const researchKey = (r: Pick<ResearchResult, "symbol" | "ticker">) =>
  (r.symbol || r.ticker).trim().toUpperCase().replace(/\.SA$/, "");

/** Põe a pesquisa nova no topo, substituindo a anterior do mesmo ativo. */
export function addResearch(list: ResearchResult[] | undefined, r: ResearchResult): ResearchResult[] {
  const key = researchKey(r);
  return [r, ...(list ?? []).filter((x) => x.id !== r.id && researchKey(x) !== key)].slice(0, MAX_RESEARCH);
}

/** Garante a nota de qualidade entre 0 e 10 e ao menos as listas vazias. */
export function normalizeResearch<T extends Omit<ResearchResult, "id" | "query" | "symbol" | "quote" | "runAt" | "model" | "effort" | "searches">>(r: T): T {
  const score = Number(r.quality?.score);
  return {
    ...r,
    quality: { ...r.quality, score: Number.isFinite(score) ? Math.min(10, Math.max(0, Math.round(score * 10) / 10)) : 0 },
    scenarios: (r.scenarios ?? []).slice(0, 8),
    keyMetrics: (r.keyMetrics ?? []).slice(0, 16),
  };
}
