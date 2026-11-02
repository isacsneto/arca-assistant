import type { AppState } from "./types";
import { categorize } from "./cashflow";
import type { LedgerData } from "./ledger";
import { planningOf } from "./planning";
import { computeSales, darfByMonth, discrimination, incomeFromTransactions, type DarfMonth, type Holding, type IncomeSummary } from "./tax";

export interface TaxView {
  year: number;
  years: number[];
  darfs: DarfMonth[];
  darfTotal: number;
  /** Bens e Direitos da pessoa física (posição mais recente do ano). */
  bens: (Holding & { text: string })[];
  bensAsOf: string | null;
  income: IncomeSummary;
  /** Desde quando há movimentações de investimento (o que veio antes não entra no cálculo). */
  historyFrom: string | null;
  approx: boolean;
}

export function taxView(state: AppState, ledger: LedgerData, year: number): TaxView {
  const byYear = ledger.holdingsByYear ?? {};
  const years = [...new Set([...Object.keys(byYear).map(Number), ...ledger.investTx.map((t) => Number(t.date.slice(0, 4))), year])].sort((a, b) => b - a);
  const holdingsYear = Object.keys(byYear).map(Number).filter((y) => y <= year).sort((a, b) => b - a)[0];
  const holdings = holdingsYear ? byYear[String(holdingsYear)] : [];
  const latest = byYear[String(Math.max(...Object.keys(byYear).map(Number), 0))] ?? [];
  const sales = computeSales(ledger.investTx, latest);
  const darfs = darfByMonth(sales, year);
  const rules = planningOf(state.planning).categoryRules;
  const resolved = ledger.bankTx.map((t) => ({ ...t, ...(() => { const c = categorize(t, rules, ledger.aiCategories); return { category: c.category, categorySource: c.source }; })() }));
  const dates = ledger.investTx.map((t) => t.date).sort();
  return {
    year,
    years,
    darfs,
    darfTotal: darfs.reduce((s, d) => s + d.darf, 0),
    bens: holdings.filter((h) => h.owner === "PF").sort((a, b) => (b.cost ?? b.value) - (a.cost ?? a.value)).map((h) => ({ ...h, text: discrimination(h) })),
    bensAsOf: holdingsYear ? (holdingsYear < year ? `${holdingsYear}-12-31` : ledger.lastSlowSync ?? null) : null,
    income: incomeFromTransactions(resolved, year),
    historyFrom: dates[0] ?? null,
    approx: darfs.some((d) => d.sales.some((s) => s.approxCost)),
  };
}
