import { toBRL } from "./arca";
import type { AppState, Owner } from "./types";

/*
 * Histórico do patrimônio: uma foto por dia (a última do dia vale), em reais. Daí saem a evolução,
 * a rentabilidade do mês e a comparação com CDI e Ibovespa.
 */

export interface Snapshot {
  /** Dia (AAAA-MM-DD, horário de Brasília). */
  date: string;
  /** Total investido (posições), em reais. */
  total: number;
  byClass: Record<string, number>;
  byInstitution: Record<string, number>;
  byOwner: Partial<Record<Owner, number>>;
  /** Bens físicos e dívidas (patrimônio líquido = total + bens − dívidas). */
  physical: number;
  debts: number;
  /** Reconstruído com as quantidades de hoje e preços do passado (antes de o app gravar fotos). */
  estimated?: boolean;
}

export interface MonthSummary {
  month: string;
  text: string;
  at: string;
}

export interface HistoryData {
  snapshots: Snapshot[];
  summaries: MonthSummary[];
}

export const brDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const round = (n: number) => Math.round(n * 100) / 100;
const add = (m: Record<string, number>, k: string, v: number) => void (m[k] = round((m[k] ?? 0) + v));

/** Foto do patrimônio de agora. */
export function snapshotOf(state: Pick<AppState, "positions" | "assets" | "settings"> & { debts?: number }, date: string): Snapshot {
  const byClass: Record<string, number> = {};
  const byInstitution: Record<string, number> = {};
  const byOwner: Record<string, number> = {};
  let total = 0;
  for (const p of state.positions) {
    const v = toBRL(p, state.settings.fx);
    total += v;
    add(byClass, p.assetClass, v);
    add(byInstitution, p.institution, v);
    add(byOwner, p.owner, v);
  }
  const physical = (state.assets ?? []).reduce((s, a) => s + (a.value ?? 0), 0);
  return { date, total: round(total), byClass, byInstitution, byOwner, physical: round(physical), debts: round(state.debts ?? 0) };
}

/** Insere/substitui a foto do dia, mantendo a ordem. Uma foto real substitui a estimada do mesmo dia. */
export function upsertSnapshot(list: Snapshot[], snap: Snapshot): Snapshot[] {
  const out = list.filter((s) => s.date !== snap.date);
  out.push(snap);
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface MonthStats {
  month: string;
  start: number;
  end: number;
  change: number;
  /** Aportes líquidos do mês (depósitos/compras − saques/vendas registrados), quando houver. */
  flows: number;
  /** Rendimento estimado do mês, em % (variação menos aportes, sobre o início). */
  returnPct: number | null;
  estimated: boolean;
}

/**
 * Estatística por mês a partir das fotos: início = última foto do mês anterior (ou a primeira do mês),
 * fim = última foto do mês. `flows` vem de quem chama (transações registradas).
 */
export function monthlyStats(snapshots: Snapshot[], flowsByMonth: Record<string, number> = {}): MonthStats[] {
  const months = [...new Set(snapshots.map((s) => s.date.slice(0, 7)))].sort();
  return months.map((month) => {
    const inMonth = snapshots.filter((s) => s.date.startsWith(month));
    const before = snapshots.filter((s) => s.date < `${month}-01`).at(-1);
    const first = before ?? inMonth[0];
    const last = inMonth.at(-1)!;
    const flows = flowsByMonth[month] ?? 0;
    const change = round(last.total - first.total);
    return {
      month,
      start: first.total,
      end: last.total,
      change,
      flows: round(flows),
      returnPct: first.total > 0 ? ((change - flows) / first.total) * 100 : null,
      estimated: inMonth.some((s) => s.estimated) || !!first.estimated,
    };
  });
}
