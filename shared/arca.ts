import {
  ARCA_CLASSES,
  type ArcaClass,
  type AssetClass,
  type Position,
  type Settings,
} from "./types";
import { rate, type FxRates } from "./currency";
import { isCrypto } from "./crypto";

/** Regras de classificação que valem só na visão (a posição salva não muda). */
export type ClassRules = Pick<Settings, "cryptoAsInternational">;

/** Classe usada nos cálculos: cripto em "Fora da Arca" pode contar como Internacional. */
export function effectiveClass(p: Pick<Position, "assetClass" | "name" | "subtype" | "ticker">, rules: ClassRules): AssetClass {
  if (rules.cryptoAsInternational && p.assetClass === "outros" && isCrypto(p)) return "internacional";
  return p.assetClass;
}

/** As posições com a classe efetiva (mesmo array se nada mudar). */
export function withClassRules<T extends Position>(positions: T[], rules: ClassRules): T[] {
  if (!rules.cryptoAsInternational) return positions;
  return positions.map((p) => {
    const c = effectiveClass(p, rules);
    return c === p.assetClass ? p : { ...p, assetClass: c };
  });
}

/** Valor da posição na moeda base (BRL), pelas cotações dos ajustes. */
export function toBRL(p: Pick<Position, "value" | "currency">, fx: FxRates): number {
  return p.value * rate(fx, p.currency);
}

export interface Allocation {
  byClass: Record<AssetClass, number>;
  arcaTotal: number; // soma das 4 classes da Arca
  outrosTotal: number;
  grandTotal: number;
}

export function computeAllocation(positions: Position[], fx: FxRates): Allocation {
  const byClass: Record<AssetClass, number> = {
    acoes: 0,
    fiis: 0,
    caixa: 0,
    internacional: 0,
    outros: 0,
  };
  for (const p of positions) byClass[p.assetClass] += toBRL(p, fx);
  const arcaTotal = ARCA_CLASSES.reduce((s, c) => s + byClass[c], 0);
  return { byClass, arcaTotal, outrosTotal: byClass.outros, grandTotal: arcaTotal + byClass.outros };
}

export type DriftStatus = "ok" | "warn" | "bad";

export interface ClassRow {
  assetClass: ArcaClass;
  current: number; // R$
  currentPct: number; // % da base Arca
  targetPct: number;
  driftPp: number; // current - target, em pontos percentuais
  status: DriftStatus;
}

export function driftStatus(driftPp: number): DriftStatus {
  const d = Math.abs(driftPp);
  return d < 3 ? "ok" : d < 7 ? "warn" : "bad";
}

export function classRows(alloc: Allocation, targets: Settings["targets"]): ClassRow[] {
  return ARCA_CLASSES.map((c) => {
    const current = alloc.byClass[c];
    const currentPct = alloc.arcaTotal > 0 ? (current / alloc.arcaTotal) * 100 : 0;
    const driftPp = alloc.arcaTotal > 0 ? currentPct - targets[c] : 0;
    return {
      assetClass: c,
      current,
      currentPct,
      targetPct: targets[c],
      driftPp,
      status: driftStatus(driftPp),
    };
  });
}

export interface RebalanceLine {
  assetClass: ArcaClass;
  current: number;
  ideal: number; // valor ideal após o aporte
  trade: number; // >0 comprar, <0 vender
  after: number;
  afterPct: number;
}

/**
 * Calcula quanto comprar/vender em cada classe.
 * - allowSell=false: o aporte é distribuído só entre classes abaixo da meta,
 *   proporcionalmente ao quanto faltam (nada é vendido).
 * - allowSell=true: leva cada classe exatamente à meta.
 */
export function rebalance(
  alloc: Allocation,
  targets: Settings["targets"],
  contribution: number,
  allowSell: boolean,
): RebalanceLine[] {
  const newTotal = alloc.arcaTotal + contribution;
  const raw = ARCA_CLASSES.map((c) => {
    const ideal = (targets[c] / 100) * newTotal;
    return { c, current: alloc.byClass[c], ideal, delta: ideal - alloc.byClass[c] };
  });

  let trades: number[];
  if (allowSell) {
    trades = raw.map((r) => r.delta);
  } else {
    const gaps = raw.map((r) => Math.max(r.delta, 0));
    const gapSum = gaps.reduce((a, b) => a + b, 0);
    if (contribution <= 0 || gapSum <= 0) {
      trades = raw.map(() => 0);
    } else {
      // gapSum >= contribution sempre (a soma dos deltas é igual ao aporte)
      trades = gaps.map((g) => (g / gapSum) * contribution);
    }
  }

  return raw.map((r, i) => {
    const after = r.current + trades[i];
    const base = allowSell ? newTotal : alloc.arcaTotal + Math.max(contribution, 0);
    return {
      assetClass: r.c,
      current: r.current,
      ideal: r.ideal,
      trade: trades[i],
      after,
      afterPct: base > 0 ? (after / base) * 100 : 0,
    };
  });
}

export function targetsSum(targets: Settings["targets"]): number {
  return ARCA_CLASSES.reduce((s, c) => s + (Number(targets[c]) || 0), 0);
}
