import { locale } from "../../shared/i18n";
import { BASE_CURRENCY, convert, type CurrencyCode, type FxRates } from "../../shared/currency";

// Formatadores por idioma e moeda (ambos podem mudar com o app aberto).
const cache = new Map<string, Intl.NumberFormat>();
const nf = (currency: string, key: string, opts: Intl.NumberFormatOptions) => {
  const k = `${locale()}|${currency}|${key}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale(), { style: "currency", currency, ...opts }));
  return cache.get(k)!;
};

/* Moeda de exibição: totais são calculados na moeda base (BRL) e mostrados nesta. */
let display: CurrencyCode = BASE_CURRENCY;
let displayFx: FxRates = {};
/** Chamado pelo app ao carregar/alterar os ajustes. */
export function setDisplayCurrency(code: CurrencyCode, fx: FxRates) {
  display = code;
  displayFx = fx;
}
export const displayCurrency = () => display;
/** Valor da moeda base convertido para a moeda de exibição (número). */
export const toDisplay = (nBase: number) => convert(nBase, BASE_CURRENCY, display, displayFx);
/** Valor na moeda de exibição convertido de volta para a base (ex.: aporte digitado). */
export const fromDisplay = (n: number) => convert(n, display, BASE_CURRENCY, displayFx);

/* Modo privacidade (botão de olho): valores do patrimônio viram "R$ •••••". */
let hidden = false;
/** Chamado pelo app quando o olho muda. */
export function setValuesHidden(h: boolean) {
  hidden = h;
}
export const valuesHidden = () => hidden;
export const MASK = "•••••";
const NUMBER_PARTS = new Set(["integer", "group", "decimal", "fraction", "compact", "exponentInteger", "exponentSeparator", "exponentMinusSign"]);
/** Formata ou, no modo privacidade, mantém só o símbolo da moeda (R$ ••••• / $•••••). */
const fmt = (f: Intl.NumberFormat, n: number) => {
  if (!hidden) return f.format(n);
  let masked = false;
  return f
    .formatToParts(Math.abs(n))
    .map((p) => (!NUMBER_PARTS.has(p.type) ? p.value : masked ? "" : ((masked = true), MASK)))
    .join("")
    .trim(); // sobra o espaço antes do "mi" do compacto
};

/** Valor em moeda base, formatado na moeda de exibição (R$ 1.234,50 / $250.12). */
export const amt = (nBase: number) => fmt(nf(display, "2", {}), toDisplay(nBase));
/** Idem, sem centavos. */
export const amt0 = (nBase: number) => fmt(nf(display, "0", { maximumFractionDigits: 0 }), toDisplay(nBase));
/** Idem, compacto (R$ 1,2 mi / $1.2M) — eixos de gráfico, faixas de estimativa. */
export const amtCompact = (nBase: number) => fmt(nf(display, "c", { notation: "compact", maximumFractionDigits: 1 }), toDisplay(nBase));
/** Valor na própria moeda (ex.: posição em USD continua em US$). */
export const money = (n: number, currency: CurrencyCode) => fmt(nf(currency, "2", {}), n);

export const pct = (n: number, digits = 1) =>
  `${n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const signedPp = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
export const uid = () => crypto.randomUUID();

/** Só deixa passar links http(s); URLs vindas da web/modelo podem ser `javascript:` etc. */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
