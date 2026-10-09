import type { ExtractedItem, Owner, Position, Transaction } from "./types";

export const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Identifica "o mesmo ativo": mesmo titular + instituição + ticker (ou nome, se não houver ticker). */
export const posKey = (owner: Owner, institution: string, ticker: string | null | undefined, name: string) =>
  `${owner}|${norm(institution)}|${norm(ticker) || norm(name)}`;

const scopeKey = (owner: Owner, institution: string) => `${owner}|${norm(institution)}`;

const txSig = (t: Pick<Transaction, "date" | "type" | "amount" | "description" | "institution" | "owner">) =>
  [t.owner, t.date, t.type, t.amount.toFixed(2), norm(t.description), norm(t.institution)].join("|");

export interface MergeOptions {
  /** Remove posições das instituições (do mesmo titular) importadas que não vieram neste import. */
  removeStale: boolean;
  /** Titular usado quando nem o arquivo nem o documento indicam PF/PJ. */
  defaultOwner?: Owner;
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
  { removeStale, now, newId, defaultOwner = "PF" }: MergeOptions,
): { positions: Position[]; transactions: Transaction[] } {
  let positions = [...current.positions];
  const importedKeys = new Set<string>();
  const institutions = new Set<string>();

  for (const d of items) {
    if (d.kind !== "position") continue;
    const owner = d.owner ?? defaultOwner;
    const key = posKey(owner, d.institution, d.ticker, d.name);
    importedKeys.add(key);
    institutions.add(scopeKey(owner, d.institution));
    const base: Omit<Position, "id"> = {
      name: d.name,
      ticker: d.ticker ?? undefined,
      institution: d.institution,
      owner,
      assetClass: d.assetClass,
      subtype: d.subtype,
      currency: d.currency,
      value: d.value,
      quantity: d.quantity ?? undefined,
      updatedAt: now,
      source: d.sourceFile,
    };
    const idx = positions.findIndex((p) => posKey(p.owner, p.institution, p.ticker, p.name) === key);
    if (idx >= 0) positions[idx] = { ...base, id: positions[idx].id };
    else positions.push({ ...base, id: newId() });
  }

  if (removeStale)
    positions = positions.filter(
      (p) => !institutions.has(scopeKey(p.owner, p.institution)) || importedKeys.has(posKey(p.owner, p.institution, p.ticker, p.name)),
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
      owner: d.owner ?? defaultOwner,
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
