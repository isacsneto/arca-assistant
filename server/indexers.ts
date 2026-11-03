import type { Position, RefreshLine } from "../shared/types";
import { L, locale } from "../shared/i18n";

/*
 * Renda fixa indexada calculada com as séries oficiais do Banco Central (SGS, sem chave), em vez de
 * pedir à IA: "% do CDI", "CDI + x%", "IPCA + x%", "TR + x%" e prefixados. Acumula dia útil a dia útil
 * (o calendário é o do próprio CDI publicado), da data da última atualização até o último dia com taxa.
 */

export type Indexer =
  | { kind: "cdiPct"; pct: number }
  | { kind: "cdiPlus"; spread: number }
  | { kind: "ipcaPlus"; real: number }
  | { kind: "trPlus"; spread: number }
  | { kind: "pre"; rate: number };

export interface IndexSeries {
  /** Dia útil (AAAA-MM-DD) → CDI do dia (fração). Em ordem. */
  cdi: { d: string; r: number }[];
  /** "AAAA-MM" → IPCA do mês (fração). */
  ipca: Map<string, number>;
  /** IPCA 12 meses mais recente (fração), para os meses ainda sem IPCA divulgado. */
  ipca12m: number | null;
  /** "AAAA-MM" → TR do mês (fração). */
  tr: Map<string, number>;
}

const pctNum = (s: string) => Number(s.replace(",", ".")) / 100;
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;

/** Indexador pelo nome/subtipo; null = não é renda fixa que dê para calcular (fundo, COE, saldo, sem taxa…). */
export function parseIndexer(p: Pick<Position, "name" | "subtype" | "currency" | "ticker">): Indexer | null {
  if (p.currency !== "BRL" || p.ticker?.trim()) return null;
  const t = `${p.subtype} ${p.name}`;
  if (!/\b(CDB|LCA|LCI|LCD|LC|LF|RDB|CRI|CRA|deb[eê]ntures?)\b/i.test(t)) return null;
  if (/\bfundo\b|\bFI(C|M|RF|A)?\b|\bCOE\b/i.test(t)) return null;
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`\bCDI\s*\+\s*${NUM}\s*%`, "i").exec(t))) return { kind: "cdiPlus", spread: pctNum(m[1]) };
  if ((m = new RegExp(String.raw`${NUM}\s*%\s*(?:do\s+)?(?:CDI|DI)\b`, "i").exec(t))) return { kind: "cdiPct", pct: pctNum(m[1]) };
  if ((m = new RegExp(String.raw`\bIPCA\s*\+\s*${NUM}\s*%`, "i").exec(t))) return { kind: "ipcaPlus", real: pctNum(m[1]) };
  if ((m = new RegExp(String.raw`\bTR\s*\+\s*${NUM}\s*%`, "i").exec(t))) return { kind: "trPlus", spread: pctNum(m[1]) };
  if ((m = new RegExp(String.raw`\bpr[eé](?:-?fixad[oa])?\s*${NUM}\s*%`, "i").exec(t))) return { kind: "pre", rate: pctNum(m[1]) };
  // Prefixado escrito só com a taxa: "CDB 12,5% a.a." (sem CDI, IPCA ou TR no texto). Abaixo de 3% a.a. não é
  // prefixado de verdade — é o banco que mandou só o spread (ex.: "Debênture 1% a.a." de IPCA + 1%).
  if (!/\b(CDI|DI|IPCA|TR|SELIC)\b/i.test(t) && (m = new RegExp(String.raw`${NUM}\s*%\s*a\.?\s*a\.?`, "i").exec(t)) && pctNum(m[1]) >= 0.03) return { kind: "pre", rate: pctNum(m[1]) };
  return null;
}

/** Data no fuso de Brasília (AAAA-MM-DD). */
export const brDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Dias úteis (seg–sex) do mês: base do pró-rata de IPCA e TR. */
function weekdays(month: string): number {
  const [y, m] = month.split("-").map(Number);
  let n = 0;
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() % 6 !== 0) n += 1;
  }
  return n;
}

const fmtPct = (f: number, digits = 2) => `${(f * 100).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const br = (iso: string) => iso.split("-").reverse().join("/");

function describe(ix: Indexer): string {
  switch (ix.kind) {
    case "cdiPct": return L(`${fmtPct(ix.pct, 1)} do CDI`, `${fmtPct(ix.pct, 1)} of CDI`);
    case "cdiPlus": return `CDI + ${fmtPct(ix.spread)}`;
    case "ipcaPlus": return `IPCA + ${fmtPct(ix.real)}`;
    case "trPlus": return `TR + ${fmtPct(ix.spread)}`;
    case "pre": return L(`pré ${fmtPct(ix.rate)} a.a.`, `fixed ${fmtPct(ix.rate)} p.a.`);
  }
}

/**
 * Valor de hoje pelo indexador. Acumula os dias úteis d com última atualização ≤ d < hoje (o CDI do dia d
 * rende de d para d+1). Sem dia útil novo, devolve o mesmo valor — de fato não mudou.
 */
export function accrue(p: Position, ix: Indexer, s: IndexSeries, today: string): RefreshLine {
  const from = brDate(new Date(p.updatedAt));
  const days = s.cdi.filter((c) => c.d >= from && c.d < today);
  const lastTr = [...s.tr.values()].at(-1) ?? 0;
  const ipcaProj = s.ipca12m != null ? Math.pow(1 + s.ipca12m, 1 / 12) - 1 : null;
  const projected = new Set<string>();
  let factor = 1;
  for (const { d, r } of days) {
    const month = d.slice(0, 7);
    switch (ix.kind) {
      case "cdiPct": factor *= 1 + r * ix.pct; break;
      case "cdiPlus": factor *= (1 + r) * Math.pow(1 + ix.spread, 1 / 252); break;
      case "pre": factor *= Math.pow(1 + ix.rate, 1 / 252); break;
      case "trPlus": factor *= Math.pow(1 + (s.tr.get(month) ?? lastTr), 1 / weekdays(month)) * Math.pow(1 + ix.spread, 1 / 252); break;
      case "ipcaPlus": {
        let m = s.ipca.get(month);
        if (m == null) {
          m = ipcaProj ?? 0;
          projected.add(month);
        }
        factor *= Math.pow(1 + m, 1 / weekdays(month)) * Math.pow(1 + ix.real, 1 / 252);
        break;
      }
    }
  }
  const last = days.at(-1)?.d;
  // Vale para o início do dia seguinte ao último dia acumulado; a próxima atualização continua dali.
  const asOf = last ? new Date(Date.parse(`${last}T03:00:00Z`) + 86_400_000).toISOString() : undefined;
  const proj = projected.size
    ? L(` · IPCA de ${[...projected].map(br).join(", ")} ainda não divulgado: projetado pelo IPCA 12 meses (${fmtPct(s.ipca12m ?? 0)})`,
        ` · IPCA for ${[...projected].map(br).join(", ")} not yet released: projected from 12-month IPCA (${fmtPct(s.ipca12m ?? 0)})`)
    : "";
  const note = days.length
    ? L(`${describe(ix)}: ${days.length} dias úteis (${br(days[0].d)} a ${br(last!)}) · fator ${factor.toFixed(6)} · bruto, antes de IR${proj}`,
        `${describe(ix)}: ${days.length} business days (${br(days[0].d)} to ${br(last!)}) · factor ${factor.toFixed(6)} · gross, before tax${proj}`)
    : L(`${describe(ix)}: nenhum dia útil com taxa publicada desde ${br(from)} — valor igual.`, `${describe(ix)}: no business day with a published rate since ${br(from)} — same value.`);
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    oldValue: p.value,
    newValue: p.value * factor,
    method: "indexador",
    note,
    source: "https://www3.bcb.gov.br/sgspub",
    ...(asOf && { asOf }),
  };
}

type SgsRow = { data: string; valor: string };
const toIso = (d: string) => d.split("/").reverse().join("-");

/** Séries do BCB a partir de uma data (AAAA-MM-DD); guarda 1 h. Sem CDI = null (aí as posições vão para a IA). */
export function bcbSource(fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()) {
  let cache: { at: number; from: string; series: IndexSeries } | null = null;
  const get = async (serie: number, query: string, signal?: AbortSignal): Promise<SgsRow[]> => {
    const res = await fetchImpl(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados${query}`, {
      headers: { Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`BCB ${serie}: ${res.status}`);
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as SgsRow[]) : [];
  };
  return async (from: string, signal?: AbortSignal): Promise<IndexSeries | null> => {
    const t = now().getTime();
    if (cache && cache.from <= from && t - cache.at < 3_600_000) return cache.series;
    const start = br(from);
    const end = br(brDate(now()));
    const monthStart = `01/${start.slice(3)}`;
    try {
      const [cdi, ipca, ipca12, tr] = await Promise.all([
        get(12, `?formato=json&dataInicial=${start}&dataFinal=${end}`, signal),
        get(433, `?formato=json&dataInicial=${monthStart}&dataFinal=${end}`, signal).catch(() => []),
        get(13522, "/ultimos/1?formato=json", signal).catch(() => []),
        get(7811, `?formato=json&dataInicial=${monthStart}&dataFinal=${end}`, signal).catch(() => []),
      ]);
      const series: IndexSeries = {
        cdi: cdi.map((r) => ({ d: toIso(r.data), r: pctNum(r.valor) })).filter((r) => Number.isFinite(r.r)).sort((a, b) => (a.d < b.d ? -1 : 1)),
        ipca: new Map(ipca.map((r) => [toIso(r.data).slice(0, 7), pctNum(r.valor)])),
        ipca12m: ipca12.length ? pctNum(ipca12[0].valor) : null,
        tr: new Map(tr.map((r) => [toIso(r.data).slice(0, 7), pctNum(r.valor)])),
      };
      if (!series.cdi.length) return null;
      cache = { at: t, from, series };
      return series;
    } catch {
      return null;
    }
  };
}
