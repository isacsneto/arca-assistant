import type { Owner } from "./types";
import { categoryOf, normDesc, type BankTx, type Bill, type MonthFlow } from "./cashflow";
import type { Budget } from "./planning";

/*
 * Dados do Open Finance além dos investimentos: transações, faturas, empréstimos e movimentações de
 * investimentos. Ficam em data/ledger.json (fora do estado da carteira) e são sincronizados pelo servidor.
 */

export interface LoanRecord {
  id: string;
  itemId: string;
  institution: string;
  owner: Owner;
  name: string;
  balance: number;
  currency: string;
  /** Juros ao ano (%), quando o banco informa. */
  ratePct: number | null;
  installment: number | null;
  remaining: number | null;
  dueDate: string | null;
}

export interface InvestTxRecord {
  id: string;
  investmentId: string;
  itemId: string;
  institution: string;
  owner: Owner;
  ticker: string | null;
  name: string;
  /** "EQUITY/STOCK", "EQUITY/REAL_ESTATE_FUND", "ETF/ETF"… (tipo/subtipo da Pluggy). */
  kind: string;
  type: "BUY" | "SELL" | "OTHER";
  date: string;
  quantity: number;
  price: number;
  amount: number;
  fees: number;
}

export interface LedgerData {
  bankTx: BankTx[];
  /** Faturas fechadas (Pluggy /bills) e a aberta (saldo do cartão), por cartão. */
  bills: (Bill & { open?: boolean })[];
  loans: LoanRecord[];
  investTx: InvestTxRecord[];
  /** Categoria decidida pela IA por descrição normalizada. */
  aiCategories: Record<string, string>;
  /** Até que dia cada conta já foi sincronizada. */
  lastTxSync: Record<string, string>;
  /** Última sincronização "lenta" (empréstimos, movimentações de investimento): 1x por dia. */
  lastSlowSync?: string | null;
  syncedAt?: string | null;
  error?: string | null;
}

export const EMPTY_LEDGER: LedgerData = { bankTx: [], bills: [], loans: [], investTx: [], aiCategories: {}, lastTxSync: {} };

/* ---------------- recorrentes ---------------- */

export interface Recurring {
  key: string;
  label: string;
  category: string;
  /** Valor típico por mês (positivo). */
  amount: number;
  lastDate: string;
  nextDate: string;
  months: number;
  account: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const addMonth = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Gastos que se repetem (assinaturas, contas fixas): mesma descrição/estabelecimento em ao menos 3 meses
 * diferentes dos últimos 6, com valor estável (±25% da mediana). Compras parceladas não contam — são
 * parcelas, não recorrência.
 */
export function detectRecurring(txs: (BankTx & { category: string })[], today: string): Recurring[] {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 186 * 86_400_000).toISOString().slice(0, 10);
  const groups = new Map<string, (BankTx & { category: string })[]>();
  for (const t of txs) {
    if (t.date < since || t.date > today || t.amount >= 0 || t.installment) continue;
    if (categoryOf(t.category).kind !== "expense") continue;
    const key = normDesc(t.merchant || t.description).replace(/\s+\d+$/, "");
    if (key.length < 3) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const amounts = list.map((t) => -t.amount);
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= med * 0.25).length / amounts.length >= 0.7;
    // Mais de ~2 lançamentos por mês em média não é assinatura (é hábito: mercado, padaria…).
    if (!stable || list.length > months.size * 2) continue;
    const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out.push({ key, label: last.merchant || last.description, category: last.category, amount: med, lastDate: last.date, nextDate: addMonth(last.date), months: months.size, account: last.accountName });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/* ---------------- orçamentos ---------------- */

export interface BudgetStatus {
  category: string;
  limit: number;
  spent: number;
  /** Projeção para o mês inteiro, no ritmo atual. */
  projected: number;
  pct: number;
}

export function budgetStatus(budgets: Budget[], month: MonthFlow | undefined, today: string): BudgetStatus[] {
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isCurrent = month?.month === today.slice(0, 7);
  return budgets.map((b) => {
    const spent = Math.max(0, month?.byCategory[b.category] ?? 0);
    const projected = isCurrent && d > 0 ? (spent / d) * daysInMonth : spent;
    return { category: b.category, limit: b.limit, spent, projected, pct: b.limit > 0 ? spent / b.limit : 0 };
  });
}

/** Sugestão de limite: mediana dos últimos 3 meses completos, arredondada para cima (R$ 50). */
export function suggestBudgets(flows: MonthFlow[], currentMonth: string): Budget[] {
  const done = flows.filter((f) => f.month < currentMonth).slice(-3);
  if (!done.length) return [];
  const cats = new Set(done.flatMap((f) => Object.keys(f.byCategory)));
  return [...cats]
    .map((category) => ({ category, limit: Math.ceil(median(done.map((f) => Math.max(0, f.byCategory[category] ?? 0))) / 50) * 50 }))
    .filter((b) => b.limit >= 50)
    .sort((a, b) => b.limit - a.limit);
}

/* ---------------- compromissos e reserva ---------------- */

export interface Commitment {
  month: string;
  /** Fatura aberta / fechada a pagar. */
  bills: number;
  /** Parcelas de compras já feitas que caem nesse mês. */
  installments: number;
  /** Recorrentes esperados. */
  recurring: number;
  total: number;
}

/**
 * O que já está contratado para os próximos `n` meses: faturas abertas (pelo vencimento), parcelas futuras
 * do cartão (pela data da parcela) e os gastos recorrentes.
 */
export function commitments(ledger: Pick<LedgerData, "bankTx" | "bills">, recurring: Recurring[], today: string, n = 3): Commitment[] {
  const months: string[] = [];
  const start = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
  for (let i = 0; i < n; i += 1) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    months.push(d.toISOString().slice(0, 7));
  }
  const recurringTotal = recurring.reduce((s, r) => s + r.amount, 0);
  return months.map((month) => {
    const bills = ledger.bills.filter((b) => b.open && b.dueDate.slice(0, 7) === month && b.dueDate >= today).reduce((s, b) => s + Math.max(0, b.total), 0);
    const installments = ledger.bankTx
      .filter((t) => t.accountType === "CREDIT" && t.installment && t.date > today && t.date.slice(0, 7) === month && t.amount < 0)
      .reduce((s, t) => s - t.amount, 0);
    return { month, bills, installments, recurring: recurringTotal, total: bills + installments + recurringTotal };
  });
}

/** Quantos meses de gasto médio a reserva cobre. */
export function reserveCoverage(reserve: number, avgMonthlyExpenses: number): number | null {
  return avgMonthlyExpenses > 0 ? reserve / avgMonthlyExpenses : null;
}
