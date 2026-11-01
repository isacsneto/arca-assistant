import type { Position, RefreshLine } from "../shared/types";
import { L, locale } from "../shared/i18n";
import { closeAt, type FetchQuote } from "./quotes";
import { accrue, type IndexSeries } from "./indexers";

/*
 * Fundos sem cota pública fácil: estimativa pela variação de um ETF da B3 que segue o mesmo índice
 * (ou pelo CDI, para fundos DI/Selic/crédito). É a melhor conta possível sem a cota — e fica marcada
 * como estimativa ("atualizado pela IA") para o investidor conferir com o extrato.
 */

export type Proxy = { kind: "etf"; symbol: string; label: string } | { kind: "cdi"; label: string };

const ETF = (symbol: string, label: string): Proxy => ({ kind: "etf", symbol, label });

/** Índice de referência pelo nome/subtipo do fundo; null = não é fundo ou não há equivalente seguro. */
export function fundProxy(p: Pick<Position, "name" | "subtype" | "ticker" | "currency">): Proxy | null {
  if (p.ticker?.trim() || p.currency !== "BRL") return null;
  const t = `${p.name} ${p.subtype}`;
  if (!/\bfundo\b|\bFI(C|M|A|RF)?\b|multimercado/i.test(t)) return null;
  if (/nasdaq\s+crypto|cripto|crypto/i.test(t)) return ETF("HASH11.SA", L("HASH11 (Nasdaq Crypto Index)", "HASH11 (Nasdaq Crypto Index)"));
  if (/s&p\s*500/i.test(t)) return ETF("IVVB11.SA", "IVVB11 (S&P 500 em reais)");
  if (/small\s*caps?/i.test(t)) return ETF("SMAL11.SA", "SMAL11 (small caps)");
  if (/IMA-?B\s*5\b/i.test(t)) return ETF("B5P211.SA", "B5P211 (IMA-B5)");
  if (/IMA-?B\b/i.test(t)) return ETF("IMAB11.SA", "IMAB11 (IMA-B)");
  if (/IRF-?M/i.test(t)) return ETF("IRFM11.SA", "IRFM11 (IRF-M)");
  if (/dividend/i.test(t)) return ETF("DIVO11.SA", "DIVO11 (IDIV)");
  if (/\b(a[cç][oõ]es|ibovespa)\b/i.test(t)) return ETF("BOVA11.SA", "BOVA11 (Ibovespa)");
  if (/\b(DI|selic|cr[eé]dito privado|CrPr|renda fixa)\b/i.test(t) && !/d[oó]lar|global|exterior|internacional/i.test(t)) return { kind: "cdi", label: "CDI" };
  return null;
}

const pct = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** Linha estimada pelo índice de referência; null = sem dado do índice (aí a IA tenta). */
export async function priceByProxy(
  p: Position,
  proxy: Proxy,
  deps: { fetchQuote: FetchQuote; series: IndexSeries | null; today: string },
): Promise<RefreshLine | null> {
  const mark = L("estimativa: confira com o extrato", "estimate: check your statement");
  if (proxy.kind === "cdi") {
    if (!deps.series) return null;
    const l = accrue(p, { kind: "cdiPct", pct: 1 }, deps.series, deps.today);
    return { ...l, ai: true, note: L(`Fundo sem cota pública: rendimento do CDI no período (${l.note}) · ${mark}`, `Fund without a public quota: CDI return over the period (${l.note}) · ${mark}`) };
  }
  const q = await deps.fetchQuote(proxy.symbol).catch(() => null);
  const then = q && closeAt(q.history, p.updatedAt);
  if (!q || !then) return null;
  const change = q.price / then - 1;
  const since = new Date(p.updatedAt).toLocaleDateString(locale());
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    oldValue: p.value,
    newValue: p.value * (1 + change),
    method: "indexador",
    ai: true,
    note: L(
      `Fundo sem cota pública: variação de ${proxy.label} desde ${since} (${pct(change)}) · ${mark}`,
      `Fund without a public quota: change of ${proxy.label} since ${since} (${pct(change)}) · ${mark}`,
    ),
    source: `Yahoo Finance (${proxy.symbol})`,
  };
}
