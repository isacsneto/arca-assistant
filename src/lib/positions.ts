import type { AppState, Position } from "../../shared/types";

/** Edição manual de uma posição (Carteira e Instituições). */
export function patchPosition(s: AppState, id: string, changes: Partial<Position>, now = new Date().toISOString()): AppState {
  return {
    ...s,
    // Valor digitado à mão deixa de ser estimativa da IA.
    positions: s.positions.map((p) => (p.id === id ? { ...p, ...changes, ...("value" in changes && { aiEstimate: undefined }), updatedAt: now } : p)),
  };
}

export function removePosition(s: AppState, id: string): AppState {
  return { ...s, positions: s.positions.filter((p) => p.id !== id) };
}

/** Veio do Open Finance: a próxima sincronização volta a escrever o valor do banco. */
export const fromOpenFinance = (p: Position) => /^open finance/i.test(p.source);
