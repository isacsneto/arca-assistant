import { toBRL } from "./arca";
import type { AppState, ArcaClass, AssetClass, Position } from "./types";
import { L } from "./i18n";
import { planOf, type MonthlyPlan } from "./monthlyPlan";
import { subsOf, type Subscription } from "./subscriptions";

/*
 * Planejamento (editado no app, salvo junto com a carteira): metas, orçamentos, regras de categoria
 * dos gastos e dívidas cadastradas à mão. A conta é sempre do app; a IA explica e sugere.
 */

export type GoalKind = "aposentadoria" | "reserva" | "imovel" | "educacao" | "viagem" | "outro";

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  /** Valor-alvo em reais de HOJE (a conta desconta a inflação). */
  target: number;
  /** Mês-alvo (AAAA-MM). */
  targetDate: string;
  /** Posições que contam para a meta… */
  positionIds: string[];
  /** …e/ou classes inteiras (ex.: tudo em Caixa conta para a reserva). */
  classes: AssetClass[];
  /** Aporte mensal planejado (R$ de hoje). */
  monthly: number;
  /** Retorno real ao ano (%) a usar; vazio = vem da Projeção (ou 4%). */
  realReturnPct?: number | null;
}

export interface Budget {
  /** Categoria (a mesma dos gastos). */
  category: string;
  /** Limite mensal (R$). */
  limit: number;
}

/** Correção do usuário: descrição que contém `match` vai para `category` (vale também para o futuro). */
export interface CategoryRule {
  match: string;
  category: string;
  /** Só para entradas (1) ou saídas (−1); vazio = as duas. */
  sign?: 1 | -1;
}

export interface Debt {
  id: string;
  name: string;
  /** Saldo devedor hoje (R$). */
  balance: number;
  /** Juros ao ano (%), se souber. */
  ratePct?: number | null;
  /** Parcela mensal (R$). */
  installment?: number | null;
  /** Parcelas que faltam. */
  remaining?: number | null;
  owner: "PF" | "PJ";
}

export interface Planning {
  goals: Goal[];
  budgets: Budget[];
  categoryRules: CategoryRule[];
  debts: Debt[];
  /** Última análise das metas pela IA. */
  goalsAdvice?: { text: string; at: string } | null;
  /** Última análise dos gastos pela IA. */
  spendingAdvice?: { text: string; at: string } | null;
  /** Último checklist do IR pela IA. */
  taxAdvice?: { text: string; at: string; year: number } | null;
  /** Contas do mês (a planilha de contas a pagar). */
  monthlyPlan?: MonthlyPlan;
  /** Assinaturas (serviços mensais) e as sugestões dispensadas. */
  subscriptions?: Subscription[];
  subsIgnored?: string[];
}

export const EMPTY_PLANNING: Planning = { goals: [], budgets: [], categoryRules: [], debts: [] };

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Normaliza o que vem do disco/navegador (versões antigas, campos faltando). */
export function planningOf(raw: Partial<Planning> | undefined | null): Planning {
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    goals: arr<Goal>(raw?.goals).filter((g) => g && str(g.id) && str(g.name)).map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind ?? "outro",
      target: Math.max(0, num(g.target)),
      targetDate: /^\d{4}-\d{2}$/.test(str(g.targetDate)) ? g.targetDate : new Date().toISOString().slice(0, 7),
      positionIds: arr<string>(g.positionIds).filter((x) => typeof x === "string"),
      classes: arr<AssetClass>(g.classes),
      monthly: Math.max(0, num(g.monthly)),
      realReturnPct: typeof g.realReturnPct === "number" ? g.realReturnPct : null,
    })),
    budgets: arr<Budget>(raw?.budgets).filter((b) => b && str(b.category) && num(b.limit) > 0),
    categoryRules: arr<CategoryRule>(raw?.categoryRules).filter((r) => r && str(r.match).trim() && str(r.category)),
    debts: arr<Debt>(raw?.debts).filter((d) => d && str(d.id) && str(d.name)).map((d) => ({ ...d, balance: Math.max(0, num(d.balance)), owner: d.owner === "PJ" ? "PJ" : "PF" })),
    goalsAdvice: raw?.goalsAdvice ?? null,
    spendingAdvice: raw?.spendingAdvice ?? null,
    taxAdvice: raw?.taxAdvice ?? null,
    monthlyPlan: planOf(raw?.monthlyPlan),
    subscriptions: subsOf(raw?.subscriptions),
    subsIgnored: arr<string>(raw?.subsIgnored).filter((x) => typeof x === "string").slice(0, 500),
  };
}

/* ---------------- metas ---------------- */

export const GOAL_KINDS = (): Record<GoalKind, string> => ({
  aposentadoria: L("Aposentadoria", "Retirement"),
  reserva: L("Reserva de emergência", "Emergency fund"),
  imovel: L("Imóvel", "Home"),
  educacao: L("Educação", "Education"),
  viagem: L("Viagem", "Travel"),
  outro: L("Outra", "Other"),
});

/** Posições que contam para a meta (ligadas diretamente ou pela classe). */
export function goalPositions(goal: Goal, positions: Position[]): Position[] {
  return positions.filter((p) => goal.positionIds.includes(p.id) || goal.classes.includes(p.assetClass));
}

/**
 * Retorno real ao ano (%) das posições da meta: média ponderada do cenário base da Projeção por classe,
 * descontada a inflação do cenário. Sem Projeção, 4% a.a. reais.
 */
export function goalRealReturn(goal: Goal, state: Pick<AppState, "positions" | "projection" | "settings">): { pct: number; source: "manual" | "projection" | "default" } {
  if (goal.realReturnPct != null) return { pct: goal.realReturnPct, source: "manual" };
  const proj = state.projection;
  const ps = goalPositions(goal, state.positions);
  const total = ps.reduce((s, p) => s + toBRL(p, state.settings.fx), 0);
  if (!proj || !total) return { pct: 4, source: "default" };
  const infl = proj.inflation.basePct / 100;
  let nominal = 0;
  for (const p of ps) {
    const rate = proj.assets.find((a) => a.positionId === p.id)?.base ?? proj.classes.find((c) => c.assetClass === p.assetClass)?.base;
    nominal += (toBRL(p, state.settings.fx) / total) * ((rate?.annualReturnPct ?? 10) / 100);
  }
  return { pct: ((1 + nominal) / (1 + infl) - 1) * 100, source: "projection" };
}

export interface GoalStatus {
  current: number;
  months: number;
  realReturnPct: number;
  returnSource: "manual" | "projection" | "default";
  /** Aporte mensal necessário para chegar lá (0 = já chega sem aportar). */
  required: number;
  /** Onde chega no prazo com o aporte planejado (R$ de hoje). */
  projected: number;
  /** Fração atingida hoje (0–1+). */
  progress: number;
  onTrack: boolean;
}

/** Valor futuro em termos reais: atual rendendo + aportes mensais, por `months` meses. */
export function futureValue(current: number, monthly: number, annualRealPct: number, months: number): number {
  const r = Math.pow(1 + annualRealPct / 100, 1 / 12) - 1;
  if (months <= 0) return current;
  if (Math.abs(r) < 1e-12) return current + monthly * months;
  const g = Math.pow(1 + r, months);
  return current * g + monthly * ((g - 1) / r);
}

/** Aporte mensal que leva `current` a `target` em `months` meses. */
export function requiredMonthly(current: number, target: number, annualRealPct: number, months: number): number {
  if (months <= 0) return Math.max(0, target - current);
  const r = Math.pow(1 + annualRealPct / 100, 1 / 12) - 1;
  const g = Math.pow(1 + r, months);
  const gap = target - current * g;
  if (gap <= 0) return 0;
  return Math.abs(r) < 1e-12 ? gap / months : (gap * r) / (g - 1);
}

export function monthsUntil(targetDate: string, now = new Date()): number {
  const [y, m] = targetDate.split("-").map(Number);
  return Math.max(0, (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1)));
}

export function goalStatus(goal: Goal, state: Pick<AppState, "positions" | "projection" | "settings">, now = new Date()): GoalStatus {
  const current = goalPositions(goal, state.positions).reduce((s, p) => s + toBRL(p, state.settings.fx), 0);
  const months = monthsUntil(goal.targetDate, now);
  const ret = goalRealReturn(goal, state);
  const projected = futureValue(current, goal.monthly, ret.pct, months);
  return {
    current,
    months,
    realReturnPct: ret.pct,
    returnSource: ret.source,
    required: requiredMonthly(current, goal.target, ret.pct, months),
    projected,
    progress: goal.target > 0 ? current / goal.target : 0,
    onTrack: projected >= goal.target * 0.995,
  };
}

/** Classes da Arca (para os atalhos de metas). */
export const ARCA_GOAL_CLASSES: ArcaClass[] = ["acoes", "fiis", "caixa", "internacional"];
