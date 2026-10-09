import type { ExtractedItem, Position, Transaction } from "./types";

export const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Identifica "o mesmo ativo": mesma instituição + ticker (ou nome, se não houver ticker). */
export const posKey = (institution: string, ticker: string | null | undefined, name: string) =>
  `${norm(institution)}|${norm(ticker) || norm(name)}`;

const txSig = (t: Pick<Transaction, "date" | "type" | "amount" | "description" | "institution">) =>
  [t.date, t.type, t.amount.toFixed(2), norm(t.description), norm(t.institution)].join("|");

export interface MergeOptions {
  /** Remove posições das instituições importadas que não vieram neste import. */
  removeStale: boolean;
  now: string;
  newId: () => string;
}

/**
 * Aplica itens extraídos (já revisados pelo usuário) sobre a carteira:
 * posições fazem upsert por posKey; transações são adicionadas sem duplicar.
 */
export function mergeImport(
  current: { positions: Position[]; transactions: Transaction[] },
  items: ExtractedItem[],
  { removeStale, now, newId }: MergeOptions,
): { positions: Position[]; transactions: Transaction[] } {
  let positions = [...current.positions];
  const importedKeys = new Set<string>();
  const institutions = new Set<string>();

  for (const d of items) {
    if (d.kind !== "position") continue;
    const key = posKey(d.institution, d.ticker, d.name);
    importedKeys.add(key);
    institutions.add(norm(d.institution));
    const base: Omit<Position, "id"> = {
      name: d.name,
      ticker: d.ticker ?? undefined,
      institution: d.institution,
      assetClass: d.assetClass,
      subtype: d.subtype,
      currency: d.currency,
      value: d.value,
      quantity: d.quantity ?? undefined,
      updatedAt: now,
      source: d.sourceFile,
    };
    const idx = positions.findIndex((p) => posKey(p.institution, p.ticker, p.name) === key);
    if (idx >= 0) positions[idx] = { ...base, id: positions[idx].id };
    else positions.push({ ...base, id: newId() });
  }

  if (removeStale)
    positions = positions.filter(
      (p) => !institutions.has(norm(p.institution)) || importedKeys.has(posKey(p.institution, p.ticker, p.name)),
    );

  const seen = new Set(current.transactions.map(txSig));
  const added: Transaction[] = [];
  for (const d of items) {
    if (d.kind !== "transaction") continue;
    const t: Transaction = {
      id: newId(),
      date: d.date,
      type: d.txType ?? "outro",
      description: d.name,
      ticker: d.ticker ?? undefined,
      institution: d.institution,
      assetClass: d.assetClass,
      amount: d.value,
      currency: d.currency,
      source: d.sourceFile,
      importedAt: now,
    };
    const sig = txSig(t);
    if (seen.has(sig)) continue;
    seen.add(sig);
    added.push(t);
  }

  return { positions, transactions: [...current.transactions, ...added] };
}
