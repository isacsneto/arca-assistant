import type { Position, RefreshLine } from "./types";
import { rate, type FxRates } from "./currency";

/** Linhas que realmente mudam algo (as "mantidas" não contam). */
export const isChange = (l: RefreshLine) =>
  l.method !== "mantido" && (l.method === "removido" || !!l.add || Math.abs(l.newValue - l.oldValue) > 0.005);

export interface RefreshTotals {
  /** Total antes, na moeda base, com o câmbio salvo. */
  before: number;
  /** Total depois, na moeda base, com o câmbio novo (só linhas aprovadas mudam de valor). */
  after: number;
  /** Parte da variação que vem dos próprios ativos (valor novo − antigo, no câmbio novo). */
  assets: number;
  /** Parte que vem só do câmbio: posições em outra moeda valem mais/menos em reais. */
  fx: number;
}

/**
 * Totais do "Atualizar valores". after − before = assets + fx exatamente:
 * Σ novo·taxaNova − Σ antigo·taxaVelha = Σ (novo − antigo)·taxaNova + Σ antigo·(taxaNova − taxaVelha).
 */
export function refreshTotals(lines: RefreshLine[], approved: Set<string>, fxOld: FxRates, fxNew: FxRates): RefreshTotals {
  const t: RefreshTotals = { before: 0, after: 0, assets: 0, fx: 0 };
  for (const l of lines) {
    const rOld = rate(fxOld, l.currency);
    const rNew = rate(fxNew, l.currency);
    const v = approved.has(l.id) ? l.newValue : l.oldValue;
    t.before += l.oldValue * rOld;
    t.after += v * rNew;
    t.assets += (v - l.oldValue) * rNew;
    t.fx += l.oldValue * (rNew - rOld);
  }
  return t;
}

/** Quanto a linha ganha/perde em moeda base só pelo câmbio (0 se a moeda é a base ou a taxa não mudou). */
export const fxImpact = (l: RefreshLine, fxOld: FxRates, fxNew: FxRates) => l.oldValue * (rate(fxNew, l.currency) - rate(fxOld, l.currency));

/**
 * Aplica as linhas aprovadas de um "atualizar valores".
 * Só mexe em posições alteradas: as mantidas preservam `updatedAt`, para que a
 * próxima atualização continue acumulando a partir da data certa.
 * Quantidade inferida pela cotação (ou informada pelo Open Finance) é gravada.
 * Open Finance: "removido" tira a posição e linhas com `add` criam posições novas.
 */
export function applyRefresh(positions: Position[], lines: RefreshLine[], approved: Set<string>, now: string, newId: () => string = () => crypto.randomUUID()): Position[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const kept = positions.flatMap((p) => {
    const l = byId.get(p.id);
    if (!l || !approved.has(p.id) || l.method === "mantido") return [p];
    if (l.method === "removido") return [];
    const fromOf = l.method === "openfinance";
    return [{
      ...p,
      value: l.newValue,
      ...(fromOf && { currency: l.currency, source: "Open Finance" }),
      quantity: (l.method === "cotacao" || fromOf) && l.quantity && l.quantity > 0 ? l.quantity : p.quantity,
      updatedAt: now,
    }];
  });
  const added: Position[] = lines
    .filter((l) => l.add && approved.has(l.id))
    .map((l) => ({
      id: newId(),
      name: l.add!.name,
      ticker: l.add!.ticker ?? undefined,
      institution: l.add!.institution,
      owner: l.add!.owner ?? "PF",
      assetClass: l.add!.assetClass,
      subtype: l.add!.subtype,
      currency: l.add!.currency,
      value: l.add!.value,
      quantity: l.add!.quantity ?? undefined,
      updatedAt: now,
      source: "Open Finance",
    }));
  return [...kept, ...added];
}
