import { toBRL } from "./arca";
import {
  ALL_CLASSES,
  type AssetClass,
  type Position,
  type ProjectionAssumptions,
  type ScenarioRateT,
} from "./types";

export type Scenario = "base" | "worst";

/**
 * Valor de um ativo após `years` anos:
 *   V · (1 + choque) · (1 + r)^anos      (o choque, se houver, acontece no 1º ano)
 * Ano 0 é sempre o valor atual.
 */
export function growValue(value: number, rate: Pick<ScenarioRateT, "annualReturnPct" | "initialShockPct">, years: number): number {
  if (years <= 0) return value;
  const shock = 1 + rate.initialShockPct / 100;
  return value * Math.max(shock, 0) * Math.pow(1 + rate.annualReturnPct / 100, years);
}

/** Converte valor nominal futuro em "reais de hoje". */
export function toReal(nominal: number, inflationPct: number, years: number): number {
  return nominal / Math.pow(1 + inflationPct / 100, years);
}

export function rateFor(p: Position, a: ProjectionAssumptions, scenario: Scenario): ScenarioRateT | null {
  const own = a.assets.find((x) => x.positionId === p.id);
  if (own) return own[scenario];
  return a.classes.find((c) => c.assetClass === p.assetClass)?.[scenario] ?? null;
}

export interface HorizonPoint {
  years: number;
  base: number;
  worst: number;
  baseReal: number;
  worstReal: number;
  byClass: Record<AssetClass, { base: number; worst: number }>;
}

export interface Projection {
  start: number;
  points: HorizonPoint[];
  /** Posições sem premissa (classe ausente) — mantidas com valor constante. */
  missing: string[];
}

export function project(
  positions: Position[],
  usdBrl: number,
  a: ProjectionAssumptions,
  years: readonly number[],
): Projection {
  const missing = new Set<string>();
  const start = positions.reduce((s, p) => s + toBRL(p, usdBrl), 0);

  const points = years.map((y) => {
    const byClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, { base: 0, worst: 0 }])) as HorizonPoint["byClass"];
    let base = 0;
    let worst = 0;
    for (const p of positions) {
      const v = toBRL(p, usdBrl);
      const rb = rateFor(p, a, "base");
      const rw = rateFor(p, a, "worst");
      if (!rb || !rw) missing.add(p.id);
      const vb = rb ? growValue(v, rb, y) : v;
      const vw = rw ? growValue(v, rw, y) : v;
      base += vb;
      worst += vw;
      byClass[p.assetClass].base += vb;
      byClass[p.assetClass].worst += vw;
    }
    return {
      years: y,
      base,
      worst,
      baseReal: toReal(base, a.inflation.basePct, y),
      worstReal: toReal(worst, a.inflation.worstPct, y),
      byClass,
    };
  });

  return { start, points, missing: [...missing] };
}

/** Retorno anual composto implícito da carteira inteira entre hoje e `years`. */
export function impliedCagr(start: number, end: number, years: number): number {
  if (start <= 0 || years <= 0) return 0;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}
