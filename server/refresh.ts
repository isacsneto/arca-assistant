import type { AppState, ClaudeRefresh, JobEvent, Position, RefreshLine, RefreshResult } from "../shared/types";
import { closeAt, convert, fxSymbol, yahooSymbols, type FetchQuote } from "./quotes";
import { FX_CODES, fxRates, type FxRates } from "../shared/currency";
import { mapPool } from "./pool";
import { priceTesouro, tesouroType, type TesouroPrices } from "./tesouro";
import { accrue, brDate, parseIndexer, type IndexSeries } from "./indexers";
import { L, locale } from "../shared/i18n";
import { openFinanceRefresh, openFinanceSettings, type ConnectionData } from "../shared/openFinance";

export interface RefreshDeps {
  fetchQuote: FetchQuote;
  /** Estima valores de posições sem cotação (renda fixa, saldos, cripto sem ticker…). */
  claudeRefresh: (
    positions: Position[],
    ctx: { fx: FxRates; state: AppState },
    emit: (e: JobEvent<never>) => void,
    signal: AbortSignal,
  ) => Promise<ClaudeRefresh>;
  now?: () => Date;
  /** Dados das conexões do Open Finance, quando ele é a fonte da verdade (null = não usar). */
  openFinance?: (state: AppState, signal: AbortSignal) => Promise<ConnectionData[] | null>;
  /** PU oficial dos títulos do Tesouro Direto (null = indisponível; aí vão para a IA). */
  tesouro?: (signal: AbortSignal) => Promise<TesouroPrices | null>;
  /** Séries do Banco Central (CDI, IPCA, TR) desde a data dada, para a renda fixa indexada. */
  indexSeries?: (from: string, signal: AbortSignal) => Promise<IndexSeries | null>;
}

const DAY = 86_400_000;
/** Variação máxima aceita de uma estimativa do Claude (proteção contra número absurdo). */
const MAX_CHANGE = 3;

function fmt(n: number, digits = 2) {
  return n.toLocaleString(locale(), { maximumFractionDigits: digits });
}

async function priceFromQuote(
  p: Position,
  fetchQuote: FetchQuote,
  fx: FxRates,
): Promise<RefreshLine | null> {
  for (const symbol of yahooSymbols(p)) {
    const q = await fetchQuote(symbol).catch(() => null);
    if (!q) continue;

    let quantity = p.quantity;
    let inferredFrom: string | null = null;
    if (!(quantity && quantity > 0)) {
      const oldInQuoteCcy = convert(p.value, p.currency, q.currency, fx);
      const close = closeAt(q.history, p.updatedAt);
      if (oldInQuoteCcy == null || !close) continue;
      quantity = oldInQuoteCcy / close;
      const date = new Date(p.updatedAt).toLocaleDateString(locale());
      inferredFrom = L(`${date} a ${fmt(close)} ${q.currency}`, `${date} at ${fmt(close)} ${q.currency}`);
    }
    const newValue = convert(quantity * q.price, q.currency, p.currency, fx);
    if (newValue == null) continue;

    return {
      id: p.id,
      name: p.ticker ? `${p.ticker} · ${p.name}` : p.name,
      currency: p.currency,
      oldValue: p.value,
      newValue,
      method: "cotacao",
      quantity,
      unitPrice: q.price,
      note: inferredFrom
        ? L(
            `${fmt(quantity, 4)} un. (inferida pela cotação de ${inferredFrom}) × ${fmt(q.price)} ${q.currency}`,
            `${fmt(quantity, 4)} units (inferred from the quote on ${inferredFrom}) × ${fmt(q.price)} ${q.currency}`,
          )
        : L(`${fmt(quantity, 4)} un. × ${fmt(q.price)} ${q.currency}`, `${fmt(quantity, 4)} units × ${fmt(q.price)} ${q.currency}`),
      source: `Yahoo Finance (${symbol})`,
    };
  }
  return null;
}

function kept(p: Position, note: string): RefreshLine {
  return { id: p.id, name: p.ticker ? `${p.ticker} · ${p.name}` : p.name, currency: p.currency, oldValue: p.value, newValue: p.value, method: "mantido", note };
}

export async function refreshValues(
  state: AppState,
  deps: RefreshDeps,
  emit: (e: JobEvent<RefreshResult>) => void,
  signal: AbortSignal,
): Promise<RefreshResult> {
  const now = (deps.now ?? (() => new Date()))();
  const lines = new Map<string, RefreshLine>();

  // Cotação de cada moeda do registro (hoje: dólar) na moeda base.
  emit({ type: "status", text: L("Buscando cotações das moedas…", "Fetching exchange rates…") });
  const fetched: FxRates = {};
  await Promise.all(
    FX_CODES.map(async (c) => {
      const q = await deps.fetchQuote(fxSymbol(c)).catch(() => null);
      if (q && q.price > 0) fetched[c] = q.price;
    }),
  );
  const fx: FxRates = { ...fxRates(state.settings.fx), ...fetched };

  // Open Finance primeiro: as instituições conectadas ficam fora da cotação/IA.
  const extra: RefreshLine[] = [];
  const warnings: string[] = [];
  let covered = new Set<string>();
  if (deps.openFinance) {
    try {
      const data = await deps.openFinance(state, signal);
      if (data?.length) {
        emit({ type: "status", text: L(
            `Buscando no Open Finance (${data.length} ${data.length === 1 ? "conexão" : "conexões"})…`,
            `Fetching from Open Finance (${data.length} ${data.length === 1 ? "connection" : "connections"})…`,
          ) });
        const of = openFinanceRefresh(state.positions, data, { includeAccounts: openFinanceSettings(state.settings.openFinance).includeAccounts });
        covered = of.covered;
        warnings.push(...of.warnings);
        for (const l of of.lines) {
          if (l.add) extra.push(l);
          else lines.set(l.id, l);
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(L(`Open Finance indisponível agora (${msg}) — usei cotação/IA.`, `Open Finance unavailable right now (${msg}) — used quotes/AI.`));
    }
  }

  // Títulos do Tesouro Direto: PU oficial (Renda+, Educa+, IPCA+… não têm ticker).
  const open = state.positions.filter((p) => !covered.has(p.id));
  let tesouro: TesouroPrices | null = null;
  if (deps.tesouro && open.some((p) => tesouroType(p))) {
    emit({ type: "status", text: L("Buscando preços do Tesouro Direto…", "Fetching Tesouro Direto prices…") });
    tesouro = await deps.tesouro(signal).catch(() => null);
    if (!tesouro && !signal.aborted) warnings.push(L("Preços do Tesouro Direto indisponíveis agora — os títulos foram para a IA.", "Tesouro Direto prices unavailable right now — the bonds went to the AI."));
  }

  emit({ type: "status", text: L("Buscando cotações de mercado…", "Fetching market quotes…") });
  const pending: Position[] = [];
  await mapPool(open, 4, async (p) => {
    if (signal.aborted) return;
    const line = (tesouro && priceTesouro(p, tesouro)) || (await priceFromQuote(p, deps.fetchQuote, fx));
    if (line) lines.set(p.id, line);
    else pending.push(p);
  });
  emit({ type: "status", text: L(`${lines.size - covered.size} posições atualizadas pela cotação.`, `${lines.size - covered.size} positions updated from market quotes.`) });

  // Renda fixa indexada (CDI, IPCA, TR, pré): conta exata com as taxas do Banco Central.
  const indexed = pending.map((p) => [p, parseIndexer(p)] as const).filter((x): x is [Position, NonNullable<ReturnType<typeof parseIndexer>>] => x[1] != null);
  let series: IndexSeries | null = null;
  if (deps.indexSeries && indexed.length && !signal.aborted) {
    emit({ type: "status", text: L("Buscando CDI, IPCA e TR no Banco Central…", "Fetching CDI, IPCA and TR from the Central Bank…") });
    const today = brDate(now);
    // Pelo menos 15 dias de histórico: a API recusa intervalo sem nenhum dia útil.
    const from = [...indexed.map(([p]) => brDate(new Date(p.updatedAt))), brDate(new Date(now.getTime() - 15 * DAY))].sort()[0];
    series = await deps.indexSeries(from, signal).catch(() => null);
    if (series) for (const [p, ix] of indexed) lines.set(p.id, accrue(p, ix, series, today));
    else if (!signal.aborted) warnings.push(L("Taxas do Banco Central indisponíveis agora — a renda fixa indexada foi para a IA.", "Central Bank rates unavailable right now — indexed fixed income went to the AI."));
  }

  // O resto (fundos, COE, cripto sem ticker…) vai para a IA. Nada fica de fora só por ter sido atualizado há pouco.
  const forClaude = pending.filter((p) => !lines.has(p.id));

  let ratesUsed: string | undefined;
  // Até 2 rodadas: a segunda pede de novo só o que a IA deixou sem resposta.
  let ask = forClaude;
  for (let round = 0; round < 2 && ask.length && !signal.aborted; round += 1) {
    emit({ type: "status", text: round === 0
      ? L(`Pesquisando ${ask.length} posições sem cotação (fundos, COE, saldos…)…`, `Researching ${ask.length} positions without a market quote (funds, structured notes, balances…)…`)
      : L(`A IA não respondeu ${ask.length} posições — pedindo de novo só elas…`, `The AI skipped ${ask.length} positions — asking again for just those…`) });
    try {
      const res = await deps.claudeRefresh(ask, { fx, state }, emit as (e: JobEvent<never>) => void, signal);
      ratesUsed = [ratesUsed, res.ratesUsed].filter(Boolean).join(" · ") || undefined;
      const byId = new Map(res.updates.map((u) => [u.id, u]));
      const missing: Position[] = [];
      for (const p of ask) {
        const u = byId.get(p.id);
        if (!u) {
          missing.push(p);
          lines.set(p.id, kept(p, L("Sem estimativa da IA.", "No estimate from the AI.")));
        } else if (!(u.newValue >= 0) || (p.value > 0 && (u.newValue / p.value > MAX_CHANGE || u.newValue / p.value < 1 / MAX_CHANGE))) {
          lines.set(p.id, kept(p, L(`Estimativa descartada por variação implausível (${fmt(u.newValue)}).`, `Estimate discarded due to implausible change (${fmt(u.newValue)}).`)));
        } else {
          lines.set(p.id, {
            ...kept(p, u.note),
            newValue: u.method === "mantido" ? p.value : u.newValue,
            method: u.method,
            source: u.source,
            ai: true,
          });
        }
      }
      ask = missing;
    } catch (err) {
      if (signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "status", text: L(`Não foi possível estimar as posições sem cotação: ${msg}`, `Couldn't estimate the positions without a market quote: ${msg}`) });
      for (const p of ask) lines.set(p.id, kept(p, L(`Não estimado: ${msg}`, `Not estimated: ${msg}`)));
      break;
    }
  }

  return {
    runAt: now.toISOString(),
    fx: Object.keys(fetched).length ? fetched : null,
    lines: [...state.positions.map((p) => lines.get(p.id) ?? kept(p, L("Não processado.", "Not processed."))), ...extra],
    ratesUsed,
    ...(warnings.length && { warnings }),
  };
}
