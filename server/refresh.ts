import type { AppState, ClaudeRefresh, JobEvent, Position, RefreshLine, RefreshResult } from "../shared/types";
import { closeAt, convert, yahooSymbols, type FetchQuote } from "./quotes";
import { mapPool } from "./pool";
import { L, locale } from "../shared/i18n";
import { openFinanceRefresh, openFinanceSettings, type ConnectionData } from "../shared/openFinance";

export interface RefreshDeps {
  fetchQuote: FetchQuote;
  /** Estima valores de posições sem cotação (renda fixa, saldos, cripto sem ticker…). */
  claudeRefresh: (
    positions: Position[],
    ctx: { usdBrl: number; state: AppState },
    emit: (e: JobEvent<never>) => void,
    signal: AbortSignal,
  ) => Promise<ClaudeRefresh>;
  now?: () => Date;
  /** Dados das conexões do Open Finance, quando ele é a fonte da verdade (null = não usar). */
  openFinance?: (state: AppState, signal: AbortSignal) => Promise<ConnectionData[] | null>;
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
  usdBrl: number,
): Promise<RefreshLine | null> {
  for (const symbol of yahooSymbols(p)) {
    const q = await fetchQuote(symbol).catch(() => null);
    if (!q) continue;

    let quantity = p.quantity;
    let inferredFrom: string | null = null;
    if (!(quantity && quantity > 0)) {
      const oldInQuoteCcy = convert(p.value, p.currency, q.currency, usdBrl);
      const close = closeAt(q.history, p.updatedAt);
      if (oldInQuoteCcy == null || !close) continue;
      quantity = oldInQuoteCcy / close;
      const date = new Date(p.updatedAt).toLocaleDateString(locale());
      inferredFrom = L(`${date} a ${fmt(close)} ${q.currency}`, `${date} at ${fmt(close)} ${q.currency}`);
    }
    const newValue = convert(quantity * q.price, q.currency, p.currency, usdBrl);
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

  emit({ type: "status", text: L("Buscando cotação do dólar…", "Fetching the dollar exchange rate…") });
  const fx = await deps.fetchQuote("BRL=X").catch(() => null);
  const usdBrl = fx?.price ?? state.settings.usdBrl;

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

  emit({ type: "status", text: L("Buscando cotações de mercado…", "Fetching market quotes…") });
  const pending: Position[] = [];
  await mapPool(state.positions.filter((p) => !covered.has(p.id)), 4, async (p) => {
    if (signal.aborted) return;
    const line = await priceFromQuote(p, deps.fetchQuote, usdBrl);
    if (line) lines.set(p.id, line);
    else pending.push(p);
  });
  emit({ type: "status", text: L(`${lines.size - covered.size} posições atualizadas pela cotação.`, `${lines.size - covered.size} positions updated from market quotes.`) });

  // Sem cotação: o que foi atualizado há menos de 1 dia não muda; o resto vai para o Claude.
  const forClaude: Position[] = [];
  for (const p of pending) {
    const age = now.getTime() - Date.parse(p.updatedAt);
    if (Number.isFinite(age) && age < DAY) lines.set(p.id, kept(p, L("Atualizado há menos de 1 dia.", "Updated less than 1 day ago.")));
    else forClaude.push(p);
  }

  let ratesUsed: string | undefined;
  if (forClaude.length && !signal.aborted) {
    emit({ type: "status", text: L(
        `Pesquisando ${forClaude.length} posições sem cotação (renda fixa, saldos…)…`,
        `Researching ${forClaude.length} positions without a market quote (fixed income, balances…)…`,
      ) });
    try {
      const res = await deps.claudeRefresh(forClaude, { usdBrl, state }, emit as (e: JobEvent<never>) => void, signal);
      ratesUsed = res.ratesUsed;
      const byId = new Map(res.updates.map((u) => [u.id, u]));
      for (const p of forClaude) {
        const u = byId.get(p.id);
        if (!u) {
          lines.set(p.id, kept(p, L("Sem estimativa do Claude.", "No estimate from Claude.")));
        } else if (!(u.newValue >= 0) || (p.value > 0 && (u.newValue / p.value > MAX_CHANGE || u.newValue / p.value < 1 / MAX_CHANGE))) {
          lines.set(p.id, kept(p, L(`Estimativa descartada por variação implausível (${fmt(u.newValue)}).`, `Estimate discarded due to implausible change (${fmt(u.newValue)}).`)));
        } else {
          lines.set(p.id, {
            ...kept(p, u.note),
            newValue: u.method === "mantido" ? p.value : u.newValue,
            method: u.method,
            source: u.source,
          });
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "status", text: L(`Não foi possível estimar as posições sem cotação: ${msg}`, `Couldn't estimate the positions without a market quote: ${msg}`) });
      for (const p of forClaude) lines.set(p.id, kept(p, L(`Não estimado: ${msg}`, `Not estimated: ${msg}`)));
    }
  }

  return {
    runAt: now.toISOString(),
    usdBrl: fx?.price ?? null,
    lines: [...state.positions.map((p) => lines.get(p.id) ?? kept(p, L("Não processado.", "Not processed."))), ...extra],
    ratesUsed,
    ...(warnings.length && { warnings }),
  };
}
