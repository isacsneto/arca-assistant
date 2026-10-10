import type { Position, RefreshLine } from "./types";

/** Linhas que realmente mudam algo (as "mantidas" não contam). */
export const isChange = (l: RefreshLine) =>
  l.method !== "mantido" && (l.method === "removido" || !!l.add || Math.abs(l.newValue - l.oldValue) > 0.005);

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
