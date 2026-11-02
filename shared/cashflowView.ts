import type { AppState } from "./types";
import { toBRL } from "./arca";
import { categorize, monthlyFlows, savingsCapacity, type BankTx, type CategorySource, type MonthFlow } from "./cashflow";
import { budgetStatus, commitments, detectRecurring, reserveCoverage, suggestBudgets, type BudgetStatus, type Commitment, type LedgerData, type Recurring } from "./ledger";
import { goalStatus, planningOf } from "./planning";

export type ResolvedTx = BankTx & { category: string; categorySource: CategorySource };

export interface CashflowView {
  hasData: boolean;
  syncedAt: string | null;
  error: string | null;
  month: string;
  months: MonthFlow[];
  /** Média do que sobra por mês (últimos 3 meses completos). */
  capacity: { average: number; months: string[] } | null;
  tx: ResolvedTx[];
  recurring: Recurring[];
  budgets: BudgetStatus[];
  suggestedBudgets: { category: string; limit: number }[];
  commitments: Commitment[];
  bills: LedgerData["bills"];
  /** Reserva de emergência e quantos meses de gasto ela cobre. */
  reserve: { value: number; source: "goal" | "liquid"; months: number | null; avgExpenses: number };
}

/** Caixa com liquidez imediata (para estimar a reserva quando não há meta de reserva). */
const LIQUID = /liquidez di[aá]ria|d\+0|\bconta\b|saldo|tesouro selic|caixinha|reserva/i;

export function cashflowView(state: AppState, ledger: LedgerData, month: string | null, today: string): CashflowView {
  const planning = planningOf(state.planning);
  const tx: ResolvedTx[] = ledger.bankTx.map((t) => {
    const c = categorize(t, planning.categoryRules, ledger.aiCategories);
    return { ...t, category: c.category, categorySource: c.source };
  });
  const flows = monthlyFlows(tx, today).slice(-13);
  const current = today.slice(0, 7);
  const selected = month ?? current;
  const recurring = detectRecurring(tx, today);
  const capacity = savingsCapacity(flows, current);
  const done = flows.filter((f) => f.month < current).slice(-3);
  const avgExpenses = done.length ? done.reduce((s, f) => s + f.expenses, 0) / done.length : 0;

  const reserveGoal = planning.goals.find((g) => g.kind === "reserva");
  const reserveValue = reserveGoal
    ? goalStatus(reserveGoal, state).current
    : state.positions.filter((p) => p.assetClass === "caixa" && LIQUID.test(`${p.name} ${p.subtype}`)).reduce((s, p) => s + toBRL(p, state.settings.fx), 0);

  return {
    hasData: ledger.bankTx.length > 0,
    syncedAt: ledger.syncedAt ?? null,
    error: ledger.error ?? null,
    month: selected,
    months: flows,
    capacity,
    tx: tx.filter((t) => t.date.startsWith(selected)).sort((a, b) => (a.date < b.date ? 1 : -1)),
    recurring,
    budgets: budgetStatus(planning.budgets, flows.find((f) => f.month === selected), today),
    suggestedBudgets: suggestBudgets(flows, current),
    commitments: commitments(ledger, recurring, today),
    bills: ledger.bills,
    reserve: { value: reserveValue, source: reserveGoal ? "goal" : "liquid", months: reserveCoverage(reserveValue, avgExpenses), avgExpenses },
  };
}
