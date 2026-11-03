import type { MonthStats } from "./history";

/** Indicadores do Banco Central (SGS), em % ao ano (IPCA do mês em % no mês). */
export interface Indicators {
  /** Meta Selic definida pelo Copom. */
  selic: { value: number; date: string } | null;
  /** CDI anualizado (base 252) do último dia útil. */
  cdi: { value: number; date: string } | null;
  /** IPCA acumulado em 12 meses. */
  ipca12m: { value: number; date: string } | null;
  /** IPCA de cada mês (o mais recente por último). */
  ipcaMonthly: { month: string; value: number }[];
  /** Juro real ex-post: (1 + Selic) / (1 + IPCA 12m) − 1. */
  realRate: number | null;
  fetchedAt: string;
}

export type FixedIncomeVerdict = "acima" | "perto" | "abaixo";

/** Uma posição de renda fixa comparada com o CDI de hoje. */
export interface FixedIncomeRow {
  id: string;
  name: string;
  institution: string;
  owner: string;
  value: number;
  /** "105% do CDI", "IPCA + 6,5%", "pré 12,5% a.a."… */
  indexer: string;
  kind: "cdiPct" | "cdiPlus" | "ipcaPlus" | "trPlus" | "pre";
  /** Isenta de IR (LCI, LCA, CRI, CRA…). */
  exempt: boolean;
  /** Alíquota de IR usada (pelo prazo até o vencimento). */
  taxRate: number;
  maturity: string | null;
  /** Rendimento bruto ao ano hoje, em %. */
  gross: number;
  /** Líquido de IR ao ano, em %. */
  net: number;
  /** Líquido / CDI líquido com a mesma alíquota (1 = 100% do CDI). */
  vsCdi: number;
  /** Ganho real líquido sobre o IPCA 12 meses, em %. */
  real: number;
  verdict: FixedIncomeVerdict;
}

export interface RealGrowth {
  months: number;
  from: string;
  to: string;
  /** Rendimento composto dos meses (sem aportes), em %. */
  nominal: number;
  /** IPCA composto dos mesmos meses, em %. */
  inflation: number;
  /** (1 + nominal) / (1 + inflação) − 1, em %. */
  real: number;
  /** Patrimônio do início corrigido pela inflação até hoje (para comparar com o atual). */
  startInTodayMoney: number;
  start: number;
  end: number;
}

/**
 * Crescimento real: o rendimento mês a mês (variação menos aportes) composto, contra o IPCA dos mesmos
 * meses. Só entram meses com IPCA divulgado. `last` limita aos últimos n meses.
 */
export function realGrowth(months: MonthStats[], ipca: Record<string, number>, last = Infinity): RealGrowth | null {
  const usable = months.filter((m) => m.returnPct != null && ipca[m.month] != null);
  const win = Number.isFinite(last) ? usable.slice(-last) : usable;
  if (!win.length) return null;
  const nominal = win.reduce((f, m) => f * (1 + m.returnPct! / 100), 1) - 1;
  const inflation = win.reduce((f, m) => f * (1 + ipca[m.month] / 100), 1) - 1;
  return {
    months: win.length,
    from: win[0].month,
    to: win.at(-1)!.month,
    nominal: nominal * 100,
    inflation: inflation * 100,
    real: ((1 + nominal) / (1 + inflation) - 1) * 100,
    start: win[0].start,
    end: win.at(-1)!.end,
    startInTodayMoney: win[0].start * (1 + inflation),
  };
}

/** Rendimento real de um mês: (1 + rendimento) / (1 + IPCA) − 1, em %. */
export const realOf = (returnPct: number | null | undefined, ipcaPct: number | null | undefined) =>
  returnPct == null || ipcaPct == null ? null : ((1 + returnPct / 100) / (1 + ipcaPct / 100) - 1) * 100;
