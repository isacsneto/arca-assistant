import type { Position, RefreshLine } from "./types";

/** Linhas que realmente mudam algo (as "mantidas" não contam). */
export const isChange = (l: RefreshLine) => l.method !== "mantido" && Math.abs(l.newValue - l.oldValue) > 0.005;

/**
 * Aplica as linhas aprovadas de um "atualizar valores".
 * Só mexe em posições alteradas: as mantidas preservam `updatedAt`, para que a
 * próxima atualização continue acumulando a partir da data certa.
 * Quantidade inferida pela cotação é gravada, deixando as próximas atualizações exatas.
 */
export function applyRefresh(positions: Position[], lines: RefreshLine[], approved: Set<string>, now: string): Position[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return positions.map((p) => {
    const l = byId.get(p.id);
    if (!l || !approved.has(p.id) || l.method === "mantido") return p;
    return {
      ...p,
      value: l.newValue,
      quantity: l.method === "cotacao" && l.quantity && l.quantity > 0 ? l.quantity : p.quantity,
      updatedAt: now,
    };
  });
}
