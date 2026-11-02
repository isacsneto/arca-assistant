import type { Owner } from "./types";
import type { InvestTxRecord } from "./ledger";
import type { ResolvedTx } from "./cashflowView";

/*
 * IR do investidor (pessoa física, operações comuns): DARF mensal de renda variável, Bens e Direitos e
 * rendimentos isentos/exclusivos. É uma estimativa a partir do que o Open Finance traz — confira com as
 * notas de corretagem e os informes de rendimentos.
 *
 * Regras usadas: ações 15% com isenção se as VENDAS de ações no mês somarem até R$ 20 mil; ETF e BDR
 * 15% sem isenção; FII 20% sem isenção. Prejuízo compensa lucro futuro do mesmo grupo (comum: ações,
 * ETF, BDR · FII à parte). DARF (código 6015) vence no último dia útil do mês seguinte; abaixo de R$ 10
 * acumula para o próximo.
 */

export interface Holding {
  itemId: string;
  ticker: string | null;
  name: string;
  /** "EQUITY/STOCK", "FIXED_INCOME/CDB"… */
  kind: string;
  quantity: number | null;
  /** Custo de aquisição (valor aplicado) informado pela instituição. */
  cost: number | null;
  value: number;
  institution: string;
  owner: Owner;
  isin: string | null;
  dueDate: string | null;
}

export type TaxGroup = "acoes" | "etf" | "bdr" | "fii";

export function taxGroup(kind: string, ticker: string | null): TaxGroup | null {
  const k = kind.toUpperCase();
  if (k.includes("REAL_ESTATE_FUND")) return "fii";
  if (k.startsWith("ETF")) return "etf";
  // BDRs negociam com final 32–35 ou 39 (ex.: AAPL34).
  if (k.includes("BDR") || /^[A-Z]{4}3[2-59]$/.test(ticker ?? "")) return "bdr";
  if (k.startsWith("EQUITY")) return "acoes";
  return null;
}

export interface SaleResult {
  date: string;
  ticker: string;
  group: TaxGroup;
  quantity: number;
  proceeds: number;
  cost: number;
  gain: number;
  /** Custo médio veio da corretora (não havia o histórico de compras completo). */
  approxCost: boolean;
}

export interface DarfMonth {
  month: string;
  stockSales: number;
  stocksExempt: boolean;
  gains: Record<TaxGroup, number>;
  /** Base tributável depois de compensar prejuízos, por pool. */
  taxableCommon: number;
  taxableFii: number;
  tax: number;
  /** Imposto a pagar no DARF (com acúmulo abaixo de R$ 10). */
  darf: number;
  dueDate: string;
  sales: SaleResult[];
}

/** Último dia útil (seg–sex) do mês seguinte. */
export function darfDueDate(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m + 1, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Vendas com ganho pelo custo médio (compras em ordem); sem compras conhecidas, usa o custo da corretora. */
export function computeSales(txs: InvestTxRecord[], holdings: Holding[]): SaleResult[] {
  const byKey = new Map<string, InvestTxRecord[]>();
  for (const t of txs) {
    if (t.type === "OTHER" || !t.ticker) continue;
    const key = `${t.owner}|${t.ticker}`;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }
  const out: SaleResult[] = [];
  for (const [key, list] of byKey) {
    const [owner, ticker] = key.split("|");
    const group = taxGroup(list[0].kind, ticker);
    if (!group || owner !== "PF") continue;
    const h = holdings.find((x) => x.ticker === ticker && x.owner === owner && x.cost && x.quantity);
    const brokerAvg = h ? h.cost! / h.quantity! : null;
    let qty = 0;
    let cost = 0;
    for (const t of [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === "BUY" ? -1 : 1))) {
      if (t.type === "BUY") {
        qty += t.quantity;
        cost += t.amount + t.fees;
        continue;
      }
      const known = qty >= t.quantity - 1e-9;
      const avg = known && qty > 0 ? cost / qty : (brokerAvg ?? (qty > 0 ? cost / qty : 0));
      const saleCost = avg * t.quantity;
      const proceeds = t.amount - t.fees;
      out.push({ date: t.date, ticker, group, quantity: t.quantity, proceeds, cost: saleCost, gain: proceeds - saleCost, approxCost: !known });
      qty = Math.max(0, qty - t.quantity);
      cost = qty > 0 ? cost - (known ? saleCost : 0) : 0;
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** DARFs do ano, compensando prejuízos acumulados desde o início do histórico. */
export function darfByMonth(sales: SaleResult[], year: number): DarfMonth[] {
  const months = [...new Set(sales.map((s) => s.date.slice(0, 7)))].sort();
  let lossCommon = 0;
  let lossFii = 0;
  let carry = 0;
  const out: DarfMonth[] = [];
  for (const month of months) {
    const ms = sales.filter((s) => s.date.startsWith(month));
    const gains: Record<TaxGroup, number> = { acoes: 0, etf: 0, bdr: 0, fii: 0 };
    for (const s of ms) gains[s.group] += s.gain;
    const stockSales = ms.filter((s) => s.group === "acoes").reduce((t, s) => t + s.proceeds, 0);
    const stocksExempt = stockSales <= 20_000;
    // Lucro de ações isento não entra; prejuízo de ações compensa sempre.
    const stockPart = stocksExempt && gains.acoes > 0 ? 0 : gains.acoes;
    let common = stockPart + gains.etf + gains.bdr;
    if (common > 0) {
      const used = Math.min(common, lossCommon);
      common -= used;
      lossCommon -= used;
    } else {
      lossCommon += -common;
      common = 0;
    }
    let fii = gains.fii;
    if (fii > 0) {
      const used = Math.min(fii, lossFii);
      fii -= used;
      lossFii -= used;
    } else {
      lossFii += -fii;
      fii = 0;
    }
    const tax = common * 0.15 + fii * 0.2;
    const due = tax + carry;
    const darf = due >= 10 ? due : 0;
    carry = due >= 10 ? 0 : due;
    if (month.startsWith(String(year))) out.push({ month, stockSales, stocksExempt, gains, taxableCommon: common, taxableFii: fii, tax, darf, dueDate: darfDueDate(month), sales: ms });
  }
  return out;
}

export interface IncomeSummary {
  /** Dividendos e rendimentos de FII (isentos). */
  exempt: number;
  /** JCP (tributação exclusiva, já retida). */
  jcp: number;
  items: { date: string; description: string; amount: number; kind: "isento" | "jcp" }[];
}

/** Proventos do ano a partir das transações da conta (categoria "rendimentos"). */
export function incomeFromTransactions(txs: ResolvedTx[], year: number): IncomeSummary {
  const items = txs
    .filter((t) => t.date.startsWith(String(year)) && t.amount > 0 && t.category === "rendimentos")
    .filter((t) => /dividend|rendiment|jcp|juros s\/? ?cap|jrs cap|provento/i.test(t.description))
    .map((t) => ({ date: t.date, description: t.description, amount: t.amount, kind: /jcp|juros s\/? ?cap|jrs cap/i.test(t.description) ? ("jcp" as const) : ("isento" as const) }));
  return {
    exempt: items.filter((i) => i.kind === "isento").reduce((s, i) => s + i.amount, 0),
    jcp: items.filter((i) => i.kind === "jcp").reduce((s, i) => s + i.amount, 0),
    items,
  };
}

/** Texto da "Discriminação" de Bens e Direitos. */
export function discrimination(h: Holding): string {
  const qty = h.quantity ? `${h.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ` : "";
  const avg = h.cost && h.quantity ? ` (preço médio R$ ${(h.cost / h.quantity).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : "";
  const due = h.dueDate ? `, vencimento ${h.dueDate.split("-").reverse().join("/")}` : "";
  return `${qty}${h.ticker ? `${h.ticker} — ` : ""}${h.name}${due}, custodiado em ${h.institution}. Custo de aquisição R$ ${(h.cost ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${avg}.`;
}
