import { L, locale } from "./i18n";

/*
 * Moedas suportadas. Os valores de cada posição ficam na moeda dela; somas,
 * alocação, rebalanceamento e projeção são calculados na moeda BASE (BRL) e
 * mostrados na moeda de exibição escolhida em Settings.
 *
 * Para suportar uma moeda nova (ex.: EUR), basta acrescentar uma entrada aqui:
 * a cotação é buscada sozinha no "Atualizar valores" (Yahoo `EURBRL=X`) e em
 * Settings → Moeda (AwesomeAPI `EUR-BRL`), e ela aparece nos seletores, na
 * importação (schema da IA) e no Open Finance.
 */
export const CURRENCIES = {
  BRL: { symbol: "R$", get name() { return L("Real brasileiro", "Brazilian real"); }, fallbackRate: 1 },
  USD: { symbol: "US$", get name() { return L("Dólar americano", "US dollar"); }, fallbackRate: 5.5 },
} as const satisfies Record<string, { symbol: string; name: string; fallbackRate: number }>;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
/** Moeda em que o app soma e guarda totais. */
export const BASE_CURRENCY: CurrencyCode = "BRL";
/** Moedas que precisam de cotação (todas menos a base). */
export const FX_CODES = CURRENCY_CODES.filter((c) => c !== BASE_CURRENCY);

/** Quanto vale 1 unidade de cada moeda na moeda base (ex.: { USD: 5.42 }). A base vale 1. */
export type FxRates = Partial<Record<CurrencyCode, number>>;

export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === "string" && c in CURRENCIES;
/** Código conhecido ou a moeda base (dados antigos/inesperados). */
export const toCurrency = (c: unknown): CurrencyCode => (isCurrency(c) ? c : BASE_CURRENCY);

/** Valor de 1 unidade de `code` na moeda base. */
export function rate(fx: FxRates | undefined, code: CurrencyCode): number {
  if (code === BASE_CURRENCY) return 1;
  const r = fx?.[code];
  return typeof r === "number" && r > 0 ? r : CURRENCIES[code].fallbackRate;
}

/** Converte entre duas moedas suportadas. */
export function convert(value: number, from: CurrencyCode, to: CurrencyCode, fx: FxRates | undefined): number {
  if (from === to) return value;
  return (value * rate(fx, from)) / rate(fx, to);
}

/** Cotações completas e válidas (preenche as que faltam com o padrão). */
export function fxRates(raw: unknown, legacyUsd?: unknown): FxRates {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: FxRates = {};
  for (const c of FX_CODES) {
    const v = Number(src[c] ?? (c === "USD" ? legacyUsd : undefined));
    out[c] = Number.isFinite(v) && v > 0 ? v : CURRENCIES[c].fallbackRate;
  }
  return out;
}

/** "US$ 1 = R$ 5,42" — uma entrada por moeda com cotação. */
export function fxSummary(fx: FxRates): string {
  const base = CURRENCIES[BASE_CURRENCY].symbol;
  return FX_CODES.filter((c) => fx[c] != null)
    .map((c) => `${CURRENCIES[c].symbol} 1 = ${base} ${rate(fx, c).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`)
    .join(" · ");
}
