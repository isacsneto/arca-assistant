import type { Position, RefreshLine } from "../shared/types";
import { L, locale } from "../shared/i18n";

/*
 * Preço oficial dos títulos do Tesouro Direto (Tesouro Transparente, dados abertos, sem chave).
 * O CSV traz o histórico diário de PU de todos os títulos — inclusive Renda+ e Educa+, que não têm
 * ticker e por isso não saem pelo Yahoo. Valor = quantidade × PU de venda (o que a corretora mostra).
 */

export const TESOURO_CSV =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";
export const TESOURO_PAGE = "https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto";

export type Point = { d: string; pu: number };
export interface TesouroPrices {
  /** Último dia com preço no arquivo (AAAA-MM-DD). */
  lastDate: string;
  /** `${tipo}|${vencimento AAAA-MM-DD}` → PU por dia, em ordem. */
  series: Map<string, Point[]>;
}

const isoDate = (br: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const num = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));

/** Colunas: Tipo Titulo; Data Vencimento; Data Base; Taxa Compra; Taxa Venda; PU Compra; PU Venda; PU Base. */
export function parseTesouroCsv(text: string): TesouroPrices {
  const series = new Map<string, Point[]>();
  let lastDate = "";
  for (const row of text.split(/\r?\n/).slice(1)) {
    const c = row.split(";");
    if (c.length < 8) continue;
    const venc = isoDate(c[1]);
    const d = isoDate(c[2]);
    const venda = num(c[6]);
    const pu = venda > 0 ? venda : num(c[7]);
    if (!venc || !d || !(pu > 0)) continue;
    const key = `${c[0].trim()}|${venc}`;
    let s = series.get(key);
    if (!s) series.set(key, (s = []));
    s.push({ d, pu });
    if (d > lastDate) lastDate = d;
  }
  for (const s of series.values()) s.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return { lastDate, series };
}

/** PU no dia (ou no último dia antes dele); antes do histórico, o primeiro. */
export function puAt(s: Point[], iso: string): Point {
  const day = iso.slice(0, 10);
  let best = s[0];
  for (const p of s) {
    if (p.d <= day) best = p;
    else break;
  }
  return best;
}

/** Tipo do título no CSV a partir do nome/subtipo; null = não é título do Tesouro Direto (fundos e ETFs de Tesouro não contam). */
export function tesouroType(p: Pick<Position, "name" | "subtype" | "ticker">): string | null {
  if (p.ticker?.trim() || !(/^\s*tesouro\b/i.test(p.name) || /^\s*tesouro\b/i.test(p.subtype))) return null;
  const t = `${p.name} ${p.subtype}`;
  const js = /juros\s+semestrais|c\/\s*juros|\bJS\b/i.test(t);
  if (/igp-?m/i.test(t)) return "Tesouro IGPM+ com Juros Semestrais";
  if (/renda\s*\+/i.test(t)) return "Tesouro Renda+ Aposentadoria Extra";
  if (/educa\s*\+/i.test(t)) return "Tesouro Educa+";
  if (/ipca/i.test(t)) return js ? "Tesouro IPCA+ com Juros Semestrais" : "Tesouro IPCA+";
  if (/prefixado/i.test(t)) return js ? "Tesouro Prefixado com Juros Semestrais" : "Tesouro Prefixado";
  if (/selic/i.test(t)) return "Tesouro Selic";
  return null;
}

/**
 * Vencimentos candidatos. Com "venc. dd/mm/aaaa", é ele. Só com o ano, o nome oficial do Renda+ e do
 * Educa+ é o ano de conversão (Renda+ 2065 vence em 2084; Educa+ 2031, em 2035), mas corretoras
 * costumam mostrar o ano de vencimento — os dois entram e a quantidade desempata.
 */
function candidates(p: Pick<Position, "name" | "subtype">, type: string, prices: TesouroPrices): string[] {
  const t = `${p.name} ${p.subtype}`;
  const venc = /venc[a-z.]*\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  const keys = [...prices.series.keys()].filter((k) => k.startsWith(`${type}|`)).map((k) => k.slice(type.length + 1));
  if (venc) {
    const iso = isoDate(venc[1]);
    if (iso && keys.includes(iso)) return [iso];
  }
  const year = Number([...t.matchAll(/\b(20\d{2})\b/g)].at(-1)?.[1]);
  if (!year) return [];
  const offsets = type.includes("Renda+") ? [19, 0] : type.includes("Educa+") ? [4, 0] : [0];
  return offsets.flatMap((o) => keys.filter((k) => Number(k.slice(0, 4)) === year + o));
}

function fmt(n: number, digits = 2) {
  return n.toLocaleString(locale(), { maximumFractionDigits: digits });
}

/** Linha de "Atualizar valores" pelo PU oficial; null = não é título do Tesouro ou não foi achado no arquivo. */
/** Título e série de PU de uma posição (com a quantidade salva ou inferida); null = não é título do Tesouro. */
export function matchTesouro(p: Position, prices: TesouroPrices): { type: string; venc: string; s: Point[]; quantity: number; inferred: boolean } | null {
  if (p.currency !== "BRL") return null;
  const type = tesouroType(p);
  if (!type) return null;
  const options = candidates(p, type, prices).map((venc) => ({ venc, s: prices.series.get(`${type}|${venc}`)! }));
  if (!options.length) return null;
  const hasQty = !!(p.quantity && p.quantity > 0);
  // Mais de um vencimento possível: fica o que, com a quantidade salva, reproduz o valor da última atualização.
  const pick = hasQty && options.length > 1
    ? options.reduce((a, b) => (Math.abs(p.quantity! * puAt(a.s, p.updatedAt).pu - p.value) <= Math.abs(p.quantity! * puAt(b.s, p.updatedAt).pu - p.value) ? a : b))
    : options[0];
  return { type, ...pick, quantity: hasQty ? p.quantity! : p.value / puAt(pick.s, p.updatedAt).pu, inferred: !hasQty };
}

export function priceTesouro(p: Position, prices: TesouroPrices): RefreshLine | null {
  const m = matchTesouro(p, prices);
  if (!m) return null;
  const { type, s, quantity } = m;
  const pick = m;
  const hasQty = !m.inferred;
  const now = s[s.length - 1];
  const before = puAt(s, p.updatedAt);
  const vencBr = pick.venc.split("-").reverse().join("/");
  const dayBr = now.d.split("-").reverse().join("/");
  const inferred = hasQty ? "" : L(` (inferida pelo PU de ${before.d.split("-").reverse().join("/")})`, ` (inferred from the unit price on ${before.d.split("-").reverse().join("/")})`);
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    oldValue: p.value,
    newValue: quantity * now.pu,
    method: "cotacao",
    quantity,
    unitPrice: now.pu,
    note: L(
      `${fmt(quantity, 4)} títulos${inferred} × PU R$ ${fmt(now.pu)} de ${dayBr} · ${type.replace("Tesouro ", "")} venc. ${vencBr}`,
      `${fmt(quantity, 4)} bonds${inferred} × unit price R$ ${fmt(now.pu)} on ${dayBr} · ${type.replace("Tesouro ", "")} maturing ${vencBr}`,
    ),
    source: TESOURO_PAGE,
  };
}

/** Arquivo com mais de 15 dias sem preço novo é tratado como fora do ar (aí a IA tenta). */
const STALE_MS = 15 * 86_400_000;
const TTL_MS = 6 * 3_600_000;

/** Baixa (≈15 MB) e guarda em memória por 6 h; falha ou arquivo velho = null. */
export function tesouroSource(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  let cache: { at: number; prices: TesouroPrices } | null = null;
  return async (signal?: AbortSignal): Promise<TesouroPrices | null> => {
    if (cache && now() - cache.at < TTL_MS) return cache.prices;
    try {
      const res = await fetchImpl(TESOURO_CSV, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      });
      if (!res.ok) return null;
      // O arquivo vem em latin1 ou UTF-8 conforme o dia; os nomes dos tipos são ASCII, então tanto faz.
      const prices = parseTesouroCsv(new TextDecoder("latin1").decode(await res.arrayBuffer()));
      if (!prices.lastDate || now() - Date.parse(prices.lastDate) > STALE_MS) return null;
      cache = { at: now(), prices };
      return prices;
    } catch {
      return null;
    }
  };
}
