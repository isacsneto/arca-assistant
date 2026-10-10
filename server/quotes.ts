import type { Position } from "../shared/types";
import { BASE_CURRENCY, convert as convertCurrency, isCurrency, type CurrencyCode, type FxRates } from "../shared/currency";
import { CRYPTO_BY_NAME } from "../shared/crypto";

/*
 * Cotações via endpoint público do Yahoo Finance (sem chave).
 * B3: PETR4 -> PETR4.SA · EUA: VOO · Câmbio: BRL=X (USD→BRL).
 */

export interface Quote {
  symbol: string;
  price: number;
  currency: string; // "BRL" | "USD" | ...
  /** Fechamentos diários para inferir a quantidade a partir de um valor antigo. */
  history: { t: number; close: number }[];
}

export type FetchQuote = (symbol: string) => Promise<Quote | null>;

const B3_TICKER = /^[A-Z]{4}\d{1,2}[A-Z]?$/;

/** Símbolos candidatos no Yahoo para uma posição (vazio = sem cotação de mercado). */
export function yahooSymbols(p: Pick<Position, "ticker" | "currency" | "assetClass"> & { name?: string }): string[] {
  const t = p.ticker?.trim().toUpperCase().replace(/\.SA$/, "");
  if (!t && p.assetClass === "outros" && p.name) {
    const hit = CRYPTO_BY_NAME.find(([re]) => re.test(p.name!));
    return hit ? [hit[1]] : [];
  }
  if (!t || !/^[A-Z0-9.\-^=]{1,15}$/.test(t)) return [];
  if (B3_TICKER.test(t)) return [`${t}.SA`];
  if (p.assetClass === "outros" && /^[A-Z]{2,6}$/.test(t)) return [`${t}-USD`, t]; // cripto: BTC -> BTC-USD
  return [t];
}

/** Fechamento mais próximo (no ou antes) da data; se a data for anterior ao histórico, usa o primeiro. */
export function closeAt(history: Quote["history"], isoDate: string): number | null {
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms) || history.length === 0) return null;
  // Compara por dia (UTC): o pregão da B3/EUA cai no mesmo dia UTC do horário local.
  const day = new Date(ms).toISOString().slice(0, 10);
  let best: number | null = null;
  for (const h of history) {
    if (new Date(h.t * 1000).toISOString().slice(0, 10) <= day) best = h.close;
    else break;
  }
  return best ?? history[0].close;
}

/** Converte entre moedas do registro (cotação do Yahoo pode vir em qualquer código); desconhecida = null. */
export function convert(value: number, from: string, to: string, fx: FxRates): number | null {
  if (from === to) return value;
  if (!isCurrency(from) || !isCurrency(to)) return null;
  return convertCurrency(value, from, to, fx);
}

/** Símbolo do Yahoo para a cotação de uma moeda na moeda base (ex.: USD → "USDBRL=X"). */
export const fxSymbol = (code: CurrencyCode) => `${code}${BASE_CURRENCY}=X`;

export const yahooQuote: FetchQuote = async (symbol) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    chart?: {
      result?: {
        meta?: { regularMarketPrice?: number; currency?: string };
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  };
  const res = j.chart?.result?.[0];
  const price = res?.meta?.regularMarketPrice;
  if (!res || typeof price !== "number" || !(price > 0)) return null;
  const closes = res.indicators?.quote?.[0]?.close ?? [];
  const history = (res.timestamp ?? [])
    .map((t, i) => ({ t, close: closes[i] }))
    .filter((h): h is { t: number; close: number } => typeof h.close === "number" && h.close > 0);
  return { symbol, price, currency: res.meta?.currency ?? "USD", history };
};
