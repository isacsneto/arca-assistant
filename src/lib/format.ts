const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const brl = (n: number) => brlFmt.format(n);
export const brl0 = (n: number) => brlCompact.format(n);
export const usd = (n: number) => usdFmt.format(n);
export const money = (n: number, currency: "BRL" | "USD") => (currency === "USD" ? usd(n) : brl(n));
export const pct = (n: number, digits = 1) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const signedPp = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
