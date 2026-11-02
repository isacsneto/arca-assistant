import type { LedgerData } from "./ledger";
import type { Planning } from "./planning";
import type { Owner } from "./types";

/*
 * Dívidas (empréstimos e financiamentos): as do Open Finance e as cadastradas à mão. Entram no patrimônio
 * líquido e numa comparação simples "amortizar ou investir": se o juro da dívida passa do que o dinheiro
 * renderia investido (CDI líquido de IR), amortizar ganha.
 */

export interface DebtRow {
  id: string;
  name: string;
  institution: string | null;
  owner: Owner;
  balance: number;
  ratePct: number | null;
  installment: number | null;
  remaining: number | null;
  source: "openfinance" | "manual";
}

export function debtRows(planning: Pick<Planning, "debts">, ledger: Pick<LedgerData, "loans"> | null): DebtRow[] {
  return [
    ...(ledger?.loans ?? []).map((l): DebtRow => ({ id: l.id, name: l.name, institution: l.institution, owner: l.owner, balance: l.balance, ratePct: l.ratePct, installment: l.installment, remaining: l.remaining, source: "openfinance" })),
    ...planning.debts.map((d): DebtRow => ({ id: d.id, name: d.name, institution: null, owner: d.owner, balance: d.balance, ratePct: d.ratePct ?? null, installment: d.installment ?? null, remaining: d.remaining ?? null, source: "manual" })),
  ].sort((a, b) => b.balance - a.balance);
}

export const totalDebt = (rows: DebtRow[]) => rows.reduce((s, r) => s + r.balance, 0);

/** Rendimento líquido de IR (alíquota de longo prazo, 15%) de uma aplicação que rende `grossPct` ao ano. */
export const netOfTax = (grossPct: number, taxRate = 0.15) => grossPct * (1 - taxRate);

export interface AmortizeVerdict {
  verdict: "amortizar" | "investir" | "empate" | "sem-taxa";
  /** Diferença por ano a cada R$ 10 mil: juro evitado − rendimento líquido perdido. */
  per10kYear: number | null;
}

export function amortizeOrInvest(ratePct: number | null, netReturnPct: number | null): AmortizeVerdict {
  if (ratePct == null || netReturnPct == null) return { verdict: "sem-taxa", per10kYear: null };
  const diff = ((ratePct - netReturnPct) / 100) * 10_000;
  return { verdict: Math.abs(ratePct - netReturnPct) < 0.5 ? "empate" : diff > 0 ? "amortizar" : "investir", per10kYear: diff };
}
