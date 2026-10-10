import { locale } from "../../shared/i18n";

// Formatadores por idioma (o idioma pode mudar com o app aberto).
const cache = new Map<string, Intl.NumberFormat>();
const nf = (key: string, opts: Intl.NumberFormatOptions) => {
  const k = `${locale()}|${key}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale(), opts));
  return cache.get(k)!;
};

export const brl = (n: number) => nf("brl", { style: "currency", currency: "BRL" }).format(n);
export const brl0 = (n: number) => nf("brl0", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
export const usd = (n: number) => nf("usd", { style: "currency", currency: "USD" }).format(n);
export const money = (n: number, currency: "BRL" | "USD") => (currency === "USD" ? usd(n) : brl(n));
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
