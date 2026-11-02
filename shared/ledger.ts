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
  /** Investimentos com custo de aquisição, por ano (a última sincronização do ano ≈ posição de 31/12). */
  holdingsByYear?: Record<string, import("./tax").Holding[]>;
  /** Categoria decidida pela IA por descrição normalizada. */
  aiCategories: Record<string, string>;
  /** Até que dia cada conta já foi sincronizada. */
  lastTxSync: Record<string, string>;
  /** Versão do formato: mudou = busca as transações de novo, do zero. */
  version?: number;
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
  /** Cobranças dos últimos 6 meses (mais recente primeiro). */
  occurrences: { date: string; amount: number }[];
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
    const occurrences = [...list].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => ({ date: t.date, amount: -t.amount }));
    out.push({ key, label: last.merchant || last.description, category: last.category, amount: med, lastDate: last.date, nextDate: addMonth(last.date), months: months.size, account: last.accountName, occurrences });
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

/* ---------------- faturas, compromissos e reserva ---------------- */

/** Pagamento da fatura anterior lançado no cartão: não reduz a fatura. */
const isBillPayment = (t: BankTx) => t.amount > 0 && /pagamento|pagto|pgto|debito automatico|débito automático/i.test(t.description);

export interface CardBill {
  accountId: string;
  accountName: string;
  institution: string;
  /** Mês do vencimento (AAAA-MM). */
  month: string;
  dueDate: string;
  /** Compras − estornos (sem o pagamento da fatura anterior). */
  total: number;
  /** Parte que é parcela de compra antiga. */
  installments: number;
  /** A próxima a vencer (aberta); as seguintes são futuras (só parcelas, por enquanto). */
  open: boolean;
  tx: BankTx[];
}

/**
 * Faturas a vencer de cada cartão, somando os lançamentos de cada fatura (cada transação diz em que fatura
 * cai). O saldo do cartão que o banco informa é o total devedor (inclui todas as parcelas futuras) — não serve.
 * O vencimento repete o dia das faturas fechadas.
 */
export function cardBills(ledger: Pick<LedgerData, "bankTx" | "bills">, today: string): CardBill[] {
  const out: CardBill[] = [];
  const cards = new Map<string, BankTx[]>();
  for (const t of ledger.bankTx) {
    if (t.accountType !== "CREDIT" || !t.billMonth) continue;
    const list = cards.get(t.accountId);
    if (list) list.push(t);
    else cards.set(t.accountId, [t]);
  }
  for (const [accountId, txs] of cards) {
    const closed = ledger.bills.filter((b) => b.accountId === accountId && !b.open).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const last = closed.at(-1);
    const dueDay = last ? Number(last.dueDate.slice(8, 10)) : 10;
    // Primeira fatura ainda não fechada: a seguinte à última fechada (ou a do mês, se não houver histórico).
    const firstOpen = last ? nextMonth(last.dueDate.slice(0, 7)) : today.slice(0, 7);
    const months = [...new Set(txs.map((t) => t.billMonth!))].filter((m) => m >= firstOpen).sort();
    months.forEach((month, i) => {
      const inBill = txs.filter((t) => t.billMonth === month && !isBillPayment(t));
      const total = inBill.reduce((s, t) => s - t.amount, 0);
      if (total <= 0.005) return;
      const [y, m] = month.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      out.push({
        accountId, accountName: txs[0].accountName, institution: txs[0].institution, month,
        dueDate: `${month}-${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`,
        total, installments: inBill.filter((t) => t.installment).reduce((s, t) => s - t.amount, 0),
        open: i === 0, tx: inBill.sort((a, b) => (a.date < b.date ? 1 : -1)),
      });
    });
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.total - a.total));
}

const nextMonth = (m: string) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};

export interface Commitment {
  month: string;
  /** Faturas de cartão que vencem no mês (já com as parcelas que caem nelas). */
  bills: number;
  /** Quanto dessas faturas é parcela de compra antiga. */
  installments: number;
  /** Recorrentes esperados no mês que ainda não foram cobrados. */
  recurring: number;
  total: number;
  /** O que compõe o mês (para o detalhe). */
  items: { kind: "bill" | "recurring"; label: string; detail: string; date: string; amount: number; accountId?: string }[];
}

/** O que já está contratado para os próximos `n` meses: faturas a vencer e recorrentes ainda não cobrados. */
export function commitments(ledger: Pick<LedgerData, "bankTx" | "bills">, recurring: Recurring[], today: string, n = 3): Commitment[] {
  const months: string[] = [];
  let m = today.slice(0, 7);
  for (let i = 0; i < n; i += 1) {
    months.push(m);
    m = nextMonth(m);
  }
  const bills = cardBills(ledger, today);
  return months.map((month, i) => {
    const mb = bills.filter((b) => b.month === month);
    // Mês corrente: só o recorrente cuja próxima cobrança ainda vai acontecer; meses seguintes: todos.
    const rec = recurring.filter((r) => (i === 0 ? r.nextDate.startsWith(month) && r.nextDate > today : true));
    const items: Commitment["items"] = [
      ...mb.map((b) => ({ kind: "bill" as const, label: b.accountName, detail: `${b.institution} · ${b.tx.length} lançamentos${b.installments ? ` (parcelas ${b.installments.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})` : ""}`, date: b.dueDate, amount: b.total, accountId: b.accountId })),
      ...rec.map((r) => ({ kind: "recurring" as const, label: r.label, detail: r.account, date: i === 0 ? r.nextDate : `${month}-${r.nextDate.slice(8, 10)}`, amount: r.amount })),
    ];
    const billsTotal = mb.reduce((s, b) => s + b.total, 0);
    const recTotal = rec.reduce((s, r) => s + r.amount, 0);
    return { month, bills: billsTotal, installments: mb.reduce((s, b) => s + b.installments, 0), recurring: recTotal, total: billsTotal + recTotal, items };
  });
}

/** Quantos meses de gasto médio a reserva cobre. */
export function reserveCoverage(reserve: number, avgMonthlyExpenses: number): number | null {
  return avgMonthlyExpenses > 0 ? reserve / avgMonthlyExpenses : null;
}
