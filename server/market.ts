import type { DayQuote, MarketRow, MarketSnapshot, Position, SearchHit, Settings } from "../shared/types";
import { effectiveClass, toBRL } from "../shared/arca";
import { mapPool } from "./pool";
import { yahooSymbols } from "./quotes";

/*
 * Aba Mercado: variação do dia dos principais ativos da carteira e busca de
 * qualquer ativo. Cotações do endpoint público do Yahoo Finance (sem chave).
 */

export type FetchDayQuote = (symbol: string) => Promise<DayQuote | null>;
export type SearchAssets = (query: string) => Promise<SearchHit[]>;

/** Referências do dia mostradas no topo da aba. */
export const BENCHMARKS = [
  { symbol: "^BVSP", label: "Ibovespa" },
  { symbol: "IFIX.SA", label: "IFIX" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "USDBRL=X", label: "USD/BRL" },
  { symbol: "BTC-USD", label: "Bitcoin" },
] as const;

/** Símbolo válido do Yahoo (PETR4.SA, ^BVSP, USDBRL=X, BTC-USD, BRK-B…). */
export const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** No máximo ~48 pontos: suficiente para o mini gráfico. */
function downsample(xs: number[], max = 48): number[] {
  if (xs.length <= max) return xs;
  const step = (xs.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => xs[Math.round(i * step)]);
}

/** Lê a resposta do /v8/finance/chart (range=1d) como cotação do dia. */
export function parseDayQuote(symbol: string, json: unknown): DayQuote | null {
  const res = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }
    | undefined;
  const m = res?.meta;
  const price = num(m?.regularMarketPrice);
  if (!m || price == null || !(price > 0)) return null;
  const prev = num(m.previousClose) ?? num(m.chartPreviousClose);
  const change = prev ? price - prev : null;
  const time = num(m.regularMarketTime);
  const closes = (res?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => num(c) != null && c! > 0);
  return {
    symbol: typeof m.symbol === "string" ? m.symbol : symbol,
    name: (typeof m.longName === "string" && m.longName) || (typeof m.shortName === "string" && m.shortName.trim()) || null,
    currency: typeof m.currency === "string" ? m.currency : "USD",
    price,
    previousClose: prev,
    change,
    changePct: prev && change != null ? (change / prev) * 100 : null,
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    high52: num(m.fiftyTwoWeekHigh),
    low52: num(m.fiftyTwoWeekLow),
    marketTime: time ? new Date(time * 1000).toISOString() : null,
    exchange: typeof m.fullExchangeName === "string" ? m.fullExchangeName : typeof m.exchangeName === "string" ? m.exchangeName : null,
    type: typeof m.instrumentType === "string" ? m.instrumentType : null,
    spark: downsample(closes),
  };
}

export const yahooDayQuote: FetchDayQuote = async (symbol) => {
  if (!SYMBOL_RE.test(symbol)) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  return parseDayQuote(symbol, await r.json());
};

/** Tipos que fazem sentido pesquisar (sem opções, futuros etc.). */
const SEARCH_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY", "INDEX", "CURRENCY"]);

export function parseSearch(json: unknown): SearchHit[] {
  const quotes = (json as { quotes?: Record<string, unknown>[] })?.quotes ?? [];
  const out: SearchHit[] = [];
  for (const q of quotes) {
    const symbol = typeof q.symbol === "string" ? q.symbol : "";
    const type = typeof q.quoteType === "string" ? q.quoteType : null;
    // "F.SA" = mercado fracionário da B3, igual ao papel inteiro.
    if (!SYMBOL_RE.test(symbol) || /F\.SA$/.test(symbol) || (type && !SEARCH_TYPES.has(type))) continue;
    const name = (typeof q.longname === "string" && q.longname) || (typeof q.shortname === "string" && q.shortname.trim()) || symbol;
    out.push({ symbol, name, exchange: typeof q.exchDisp === "string" ? q.exchDisp : null, type });
  }
  // Brasil primeiro: o investidor procura "petrobras" e quer PETR4, não PBR.
  return out.sort((a, b) => Number(b.symbol.endsWith(".SA")) - Number(a.symbol.endsWith(".SA")));
}

export const yahooSearch: SearchAssets = async (query) => {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  return parseSearch(await r.json());
};

/** Junta as posições do mesmo ativo (ex.: PETR4 em duas corretoras) e escolhe o símbolo de cotação. */
export function portfolioAssets(
  positions: Position[],
  settings: Pick<Settings, "fx" | "cryptoAsInternational">,
  limit = 30,
): { total: number; assets: (Omit<MarketRow, "quote" | "dayChange"> & { symbols: string[] })[] } {
  const total = positions.reduce((s, p) => s + toBRL(p, settings.fx), 0);
  const byKey = new Map<string, Omit<MarketRow, "quote" | "dayChange"> & { symbols: string[] }>();
  for (const saved of positions) {
    // Símbolo pela classe salva (cripto sem ticker é reconhecida em "outros"); classe mostrada pela regra dos ajustes.
    const symbols = yahooSymbols(saved);
    const p = { ...saved, assetClass: effectiveClass(saved, settings) };
    if (!symbols.length) continue;
    const key = p.ticker?.trim().toUpperCase().replace(/\.SA$/, "") || symbols[0];
    const cur = byKey.get(key);
    const v = toBRL(p, settings.fx);
    if (cur) {
      cur.value += v;
      cur.positions += 1;
    } else {
      byKey.set(key, { key, ticker: p.ticker?.trim().toUpperCase() || null, name: p.name, assetClass: p.assetClass, value: v, weightPct: 0, positions: 1, symbols });
    }
  }
  const assets = [...byKey.values()]
    .filter((a) => a.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((a) => ({ ...a, weightPct: total > 0 ? (a.value / total) * 100 : 0 }));
  return { total, assets };
}

/** Cotação do dia dos principais ativos da carteira. */
export async function marketSnapshot(
  positions: Position[],
  settings: Pick<Settings, "fx" | "cryptoAsInternational">,
  fetchDayQuote: FetchDayQuote,
  opts: { limit?: number; now?: Date } = {},
): Promise<MarketSnapshot> {
  const { total, assets } = portfolioAssets(positions, settings, opts.limit);
  const rows: MarketRow[] = [];
  await mapPool(assets, 6, async ({ symbols, ...a }) => {
    let quote: DayQuote | null = null;
    for (const s of symbols) {
      quote = await fetchDayQuote(s).catch(() => null);
      if (quote) break;
    }
    const pct = quote?.changePct;
    rows.push({ ...a, quote, dayChange: pct != null ? a.value * (pct / 100) : null });
  });
  return { at: (opts.now ?? new Date()).toISOString(), rows: rows.sort((a, b) => b.value - a.value), total };
}
