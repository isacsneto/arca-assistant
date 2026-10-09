import type { Position, PromptOp, Transaction } from "./types";

/** Como uma operação do import por texto muda a carteira (para a tela de revisão). */
export interface OpPreview {
  index: number;
  op: PromptOp;
  /** Rótulo da posição afetada. */
  label: string;
  institution: string;
  owner: Position["owner"] | null;
  currency: Position["currency"];
  before: number | null;
  after: number | null;
  /** Motivo de a operação não poder ser aplicada (posição inexistente, saldo negativo…). */
  error: string | null;
}

const label = (p: Pick<Position, "ticker" | "name">) => (p.ticker ? `${p.ticker} · ${p.name}` : p.name);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function previewOps(positions: Position[], ops: PromptOp[]): OpPreview[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  // Várias operações na mesma posição se acumulam (ex.: aporte + resgate na mesma frase).
  const running = new Map<string, number>();

  return ops.map((op, index) => {
    const base = { index, op, error: null as string | null };
    if (op.action === "criar") {
      const np = op.newPosition;
      if (!np) return { ...base, label: "?", institution: "?", owner: null, currency: "BRL", before: null, after: null, error: "Faltam os dados do ativo novo." };
      const value = op.value ?? op.delta;
      return {
        ...base,
        label: label({ ticker: np.ticker ?? undefined, name: np.name }),
        institution: np.institution,
        owner: np.owner,
        currency: np.currency,
        before: null,
        after: value,
        error: value == null || !(value >= 0) ? "Valor do ativo novo inválido." : null,
      };
    }

    const p = op.positionId ? byId.get(op.positionId) : undefined;
    if (!p) return { ...base, label: "?", institution: "?", owner: null, currency: "BRL", before: null, after: null, error: "Posição não encontrada na carteira." };
    const before = running.get(p.id) ?? p.value;
    let after: number | null;
    let error: string | null = null;
    if (op.action === "remover") after = 0;
    else if (op.action === "definir") after = op.value;
    else after = op.delta == null ? null : round2(before + op.delta);

    if (after == null || !Number.isFinite(after)) error = "Valor não informado.";
    else if (after < 0) error = `O saldo ficaria negativo (${round2(after)}).`;
    if (!error && after != null) running.set(p.id, after);

    return { ...base, label: label(p), institution: p.institution, owner: p.owner, currency: p.currency, before, after, error };
  });
}

/**
 * Aplica as operações aprovadas (índices em `approved`). Operações com erro são ignoradas.
 * "remover" apaga a posição; "criar" adiciona; "ajustar"/"definir" mudam valor (e quantidade).
 */
export function applyPromptOps(
  current: { positions: Position[]; transactions: Transaction[] },
  ops: PromptOp[],
  approved: Set<number>,
  { now, newId, source }: { now: string; newId: () => string; source: string },
): { positions: Position[]; transactions: Transaction[] } {
  const preview = previewOps(current.positions, ops);
  let positions = [...current.positions];
  const transactions = [...current.transactions];

  for (const row of preview) {
    if (!approved.has(row.index) || row.error) continue;
    const { op } = row;
    let target: Position | undefined;

    if (op.action === "criar" && op.newPosition) {
      const np = op.newPosition;
      target = {
        id: newId(), name: np.name, ticker: np.ticker ?? undefined, institution: np.institution, owner: np.owner,
        assetClass: np.assetClass, subtype: np.subtype, currency: np.currency, value: row.after!,
        quantity: np.quantity ?? undefined, updatedAt: now, source,
      };
      positions.push(target);
    } else {
      const idx = positions.findIndex((p) => p.id === op.positionId);
      if (idx < 0) continue;
      target = positions[idx];
      if (op.action === "remover") {
        positions = positions.filter((p) => p.id !== target!.id);
      } else {
        const quantity =
          op.quantityDelta != null && target.quantity != null ? Math.max(target.quantity + op.quantityDelta, 0) : target.quantity;
        positions[idx] = { ...target, value: row.after!, quantity, updatedAt: now };
      }
    }

    if (op.transaction && target) {
      transactions.push({
        id: newId(),
        date: op.transaction.date ?? now.slice(0, 10),
        type: op.transaction.type,
        description: `${op.explanation}`.slice(0, 200),
        ticker: target.ticker,
        institution: target.institution,
        owner: target.owner,
        assetClass: target.assetClass,
        amount: Math.abs(op.transaction.amount),
        currency: target.currency,
        source,
        importedAt: now,
      });
    }
  }
  return { positions, transactions };
}
