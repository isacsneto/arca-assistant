import type { Position } from "../shared/types";
import type { FixedIncomeRow, FixedIncomeVerdict, Indicators } from "../shared/indicators";
import { toBRL } from "../shared/arca";
import { positionLabel } from "../shared/label";
import { L, locale } from "../shared/i18n";
import { brDate, parseIndexer } from "./indexers";
import type { FxRates } from "../shared/currency";

/*
 * Indicadores do Banco Central sob demanda (Selic, CDI, IPCA) e a renda fixa da carteira comparada com
 * o CDI de hoje, já descontado o IR — para saber se um CDB rende bem ou se vale trocar.
 */

type SgsRow = { data: string; valor: string };
const toIso = (d: string) => d.split("/").reverse().join("-");
const num = (s: string) => Number(s.replace(",", "."));

/** SGS: 432 meta Selic, 4389 CDI anualizado (252), 13522 IPCA 12 meses, 433 IPCA do mês. Guarda 1 h (ou atualiza à força). */
export function indicatorsSource(fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()) {
  let cache: { at: number; data: Indicators } | null = null;
  const last = async (serie: number, n: number): Promise<SgsRow[]> => {
    const res = await fetchImpl(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/${n}?formato=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`BCB ${serie}: ${res.status}`);
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as SgsRow[]) : [];
  };
  const one = (rows: SgsRow[]) => {
    const r = rows.at(-1);
    return r && Number.isFinite(num(r.valor)) ? { value: num(r.valor), date: toIso(r.data) } : null;
  };
  return async (force = false): Promise<Indicators | null> => {
    const t = now().getTime();
    if (!force && cache && t - cache.at < 3_600_000) return cache.data;
    const [selic, cdi, ipca12, ipcaM] = await Promise.all([
      last(432, 1).catch(() => []),
      last(4389, 1).catch(() => []),
      last(13522, 1).catch(() => []),
      // O SGS devolve no máximo 20 valores em "ultimos".
      last(433, 18).catch(() => []),
    ]);
    const data: Indicators = {
      selic: one(selic),
      cdi: one(cdi),
      ipca12m: one(ipca12),
      ipcaMonthly: ipcaM.map((r) => ({ month: toIso(r.data).slice(0, 7), value: num(r.valor) })).filter((r) => Number.isFinite(r.value)),
      realRate: null,
      fetchedAt: now().toISOString(),
    };
    if (!data.selic && !data.cdi && !data.ipca12m) return cache?.data ?? null;
    const base = data.selic?.value ?? data.cdi?.value;
    if (base != null && data.ipca12m) data.realRate = ((1 + base / 100) / (1 + data.ipca12m.value / 100) - 1) * 100;
    cache = { at: t, data };
    return data;
  };
}

/** IR regressivo pelo prazo (dias): até 180 22,5%; até 360 20%; até 720 17,5%; depois 15%. */
export const irRate = (days: number) => (days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15);

const maturityOf = (p: Position): string | null => {
  const m = /venc(?:imento)?\.?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(`${p.subtype} ${p.name}`);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const fmt = (f: number, d = 2) => `${(f * 100).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d })}%`;

/**
 * Cada CDB/LCI/LCA/debênture com taxa conhecida: quanto rende ao ano hoje (bruto e líquido de IR), em
 * proporção ao CDI líquido com a mesma alíquota, e o ganho real sobre o IPCA. IPCA+ usa o IPCA 12 meses;
 * prefixado e IPCA+ dependem do CDI futuro — a comparação é com o de hoje.
 */
export function checkFixedIncome(positions: Position[], fx: FxRates | undefined, ind: Indicators, today = brDate(new Date())): FixedIncomeRow[] {
  const cdi = (ind.cdi?.value ?? (ind.selic ? ind.selic.value - 0.1 : NaN)) / 100;
  const ipca = (ind.ipca12m?.value ?? NaN) / 100;
  if (!Number.isFinite(cdi)) return [];
  const rows: FixedIncomeRow[] = [];
  for (const p of positions) {
    const ix = parseIndexer(p);
    if (!ix) continue;
    const t = `${p.subtype} ${p.name}`;
    const exempt = /\b(LCI|LCA|LCD|CRI|CRA)\b|incentivad/i.test(t);
    const maturity = maturityOf(p);
    const days = maturity ? Math.max(0, (Date.parse(`${maturity}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : 9999;
    const taxRate = exempt ? 0 : irRate(days);
    let gross: number;
    let indexer: string;
    switch (ix.kind) {
      case "cdiPct":
        gross = Math.pow(1 + (Math.pow(1 + cdi, 1 / 252) - 1) * ix.pct, 252) - 1;
        indexer = L(`${fmt(ix.pct, 1)} do CDI`, `${fmt(ix.pct, 1)} of CDI`);
        break;
      case "cdiPlus":
        gross = (1 + cdi) * (1 + ix.spread) - 1;
        indexer = `CDI + ${fmt(ix.spread)}`;
        break;
      case "ipcaPlus":
        if (!Number.isFinite(ipca)) continue;
        gross = (1 + ipca) * (1 + ix.real) - 1;
        indexer = `IPCA + ${fmt(ix.real)}`;
        break;
      case "trPlus":
        gross = ix.spread;
        indexer = `TR + ${fmt(ix.spread)}`;
        break;
      case "pre":
        gross = ix.rate;
        indexer = L(`pré ${fmt(ix.rate)} a.a.`, `fixed ${fmt(ix.rate)} p.a.`);
        break;
    }
    const net = gross * (1 - taxRate);
    // Comparação justa: o CDI líquido com a alíquota que um CDB comum pagaria no mesmo prazo.
    const cdiNet = cdi * (1 - (exempt ? irRate(days) : taxRate));
    const vsCdi = net / cdiNet;
    const verdict: FixedIncomeVerdict = vsCdi >= 0.999 ? "acima" : vsCdi >= 0.9 ? "perto" : "abaixo";
    rows.push({
      id: p.id, name: positionLabel(p), institution: p.institution, owner: p.owner, value: toBRL(p, fx ?? {}),
      indexer, kind: ix.kind, exempt, taxRate, maturity,
      gross: gross * 100, net: net * 100, vsCdi,
      real: Number.isFinite(ipca) ? ((1 + net) / (1 + ipca) - 1) * 100 : NaN,
      verdict,
    });
  }
  return rows.sort((a, b) => a.vsCdi - b.vsCdi);
}
