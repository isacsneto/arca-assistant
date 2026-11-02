import fs from "node:fs";
import path from "node:path";
import type { AppState, Position } from "../shared/types";
import { brDay, snapshotOf, upsertSnapshot, type HistoryData, type MonthSummary, type Snapshot } from "../shared/history";
import { rate } from "../shared/currency";
import type { Store } from "./store";
import { closeAt, fxSymbol, yahooSymbols, type FetchQuote } from "./quotes";
import { matchTesouro, puAt, type TesouroPrices } from "./tesouro";
import { accrue, parseIndexer, type IndexSeries } from "./indexers";

/** Arquivo do histórico (fora do estado principal, para não pesar em cada gravação da carteira). */
export function historyStore(file: string) {
  let cache: HistoryData | null = null;
  const read = (): HistoryData => {
    if (cache) return cache;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<HistoryData>;
      cache = { snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [], summaries: Array.isArray(raw.summaries) ? raw.summaries : [] };
    } catch {
      cache = { snapshots: [], summaries: [] };
    }
    return cache;
  };
  const write = (data: HistoryData) => {
    cache = data;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(data));
    fs.renameSync(file + ".tmp", file);
  };
  return {
    get: read,
    /** Foto de hoje a partir do estado (chamada a cada gravação da carteira). */
    record(state: AppState, debts = 0, now = new Date()) {
      const data = read();
      write({ ...data, snapshots: upsertSnapshot(data.snapshots, snapshotOf({ ...state, debts }, brDay(now))) });
    },
    /** Fotos estimadas só para os dias que ainda não têm foto. */
    addEstimated(snaps: Snapshot[]) {
      const data = read();
      const have = new Set(data.snapshots.map((s) => s.date));
      let list = data.snapshots;
      for (const s of snaps) if (!have.has(s.date)) list = upsertSnapshot(list, s);
      write({ ...data, snapshots: list });
    },
    saveSummary(summary: MonthSummary) {
      const data = read();
      write({ ...data, summaries: [...data.summaries.filter((s) => s.month !== summary.month), summary] });
    },
  };
}
export type HistoryStore = ReturnType<typeof historyStore>;

/** Store da carteira que também tira a foto do dia a cada gravação. */
export function withHistory(store: Store, history: HistoryStore, debts: (state: AppState) => number = () => 0): Store {
  return {
    load: () => store.load(),
    save(state) {
      store.save(state);
      try {
        history.record(state, debts(state));
      } catch (e) {
        console.warn(`Histórico: ${(e as Error).message}`);
      }
    },
  };
}

/**
 * Reconstrói os últimos `days` dias com as quantidades de HOJE e os preços do passado: cotação (Yahoo),
 * PU do Tesouro e renda fixa "desfazendo" CDI/IPCA/pré. O resto fica com o valor atual. É uma estimativa
 * (compras e vendas no período não entram) e fica marcada assim.
 */
export async function backfillHistory(
  state: AppState,
  deps: { fetchQuote: FetchQuote; tesouro: TesouroPrices | null; series: IndexSeries | null; today: string },
  days = 120,
): Promise<Snapshot[]> {
  const dates: string[] = [];
  for (let i = days; i >= 1; i -= 1) dates.push(brDay(new Date(Date.parse(`${deps.today}T15:00:00Z`) - i * 86_400_000)));
  const usd = await deps.fetchQuote(fxSymbol("USD")).catch(() => null);
  const fxAt = (d: string, ccy: string) => (ccy === "USD" && usd ? closeAt(usd.history, d) ?? rate(state.settings.fx, "USD") : rate(state.settings.fx, ccy as never));

  // Valor (moeda da posição) de cada posição em cada dia.
  const valueAt = new Map<string, (d: string) => number>();
  await Promise.all(state.positions.map(async (p: Position) => {
    const tes = deps.tesouro && matchTesouro(p, deps.tesouro);
    if (tes) {
      valueAt.set(p.id, (d) => tes.quantity * puAt(tes.s, d).pu);
      return;
    }
    const ix = deps.series && parseIndexer(p);
    if (ix && deps.series) {
      const s = deps.series;
      valueAt.set(p.id, (d) => {
        const l = accrue({ ...p, updatedAt: `${d}T15:00:00Z` }, ix, s, deps.today);
        return l.newValue > 0 ? (p.value * p.value) / l.newValue : p.value;
      });
      return;
    }
    for (const sym of yahooSymbols(p)) {
      const q = await deps.fetchQuote(sym).catch(() => null);
      if (!q || !(q.price > 0)) continue;
      const qty = p.quantity && p.quantity > 0 ? p.quantity : null;
      // Cotação em outra moeda (ex.: BTC-USD numa posição em reais): converte pelo dólar do dia.
      const conv = (d: string) =>
        q.currency === p.currency ? 1 : q.currency === "USD" && p.currency === "BRL" ? fxAt(d, "USD") : q.currency === "BRL" && p.currency === "USD" ? 1 / fxAt(d, "USD") : 1;
      // Sem quantidade: proporção ao preço de hoje.
      valueAt.set(p.id, (d) => {
        const c = closeAt(q.history, d) ?? q.price;
        return qty ? qty * c * conv(d) : p.value * ((c * conv(d)) / (q.price * conv(deps.today)));
      });
      return;
    }
  }));

  return dates.map((d) => {
    const positions = state.positions.map((p) => {
      const f = valueAt.get(p.id);
      const v = f ? f(d) : p.value;
      return { ...p, value: v, currency: "BRL" as const, _brl: v * fxAt(d, p.currency) };
    }).map(({ _brl, ...p }) => ({ ...p, value: _brl }));
    return { ...snapshotOf({ ...state, positions, settings: { ...state.settings, fx: { ...state.settings.fx } } }, d), estimated: true };
  });
}
