import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown, ArrowUp, ExternalLink, Globe, Loader2, Minus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, TrendingDown, TrendingUp, X,
} from "lucide-react";
import { CLASS_META, EFFORT_LABEL, type DayQuote, type MarketRow, type ResearchRequest, type ResearchResult, type SearchHit } from "../../shared/types";
import { researchKey } from "../../shared/research";
import { api, type MarketData } from "../api";
import { useStore } from "../store";
import type { Job } from "../lib/useJob";
import { useAi } from "../lib/useAi";
import { amt, amt0, dateTime, pct, safeUrl } from "../lib/format";
import { Banner, ClassDot, ClassLabel, Empty, PageHead } from "./ui";
import { JobProgress } from "./JobProgress";
import { L, getLang, locale } from "../../shared/i18n";

/* ------------------------------------------------------------------ */
/* Formatação de cotações                                              */
/* ------------------------------------------------------------------ */

/** Preço na moeda da cotação (índice em pontos; câmbio com 4 casas; pence → libra). */
export function quotePrice(q: Pick<DayQuote, "currency" | "type">, value: number): string {
  let cur = q.currency;
  let n = value;
  if (cur === "GBp" || cur === "GBX") {
    cur = "GBP";
    n = value / 100;
  }
  if (q.type === "INDEX") return `${n.toLocaleString(locale(), { maximumFractionDigits: n >= 1000 ? 0 : 2 })} pts`;
  const max = q.type === "CURRENCY" || Math.abs(n) < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: max }).format(n);
  } catch {
    return `${n.toLocaleString(locale(), { maximumFractionDigits: max })} ${cur}`;
  }
}

const signedPct = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const signedAmt = (n: number) => `${n > 0 ? "+" : ""}${amt(n)}`;
const dir = (n: number | null | undefined) => (n == null || Math.abs(n) < 0.005 ? "flat" : n > 0 ? "up" : "down");

function Change({ pct: p }: { pct: number | null | undefined }) {
  if (p == null) return <span className="chg flat">—</span>;
  const d = dir(p);
  const Icon = d === "up" ? ArrowUp : d === "down" ? ArrowDown : Minus;
  return <span className={`chg ${d}`}><Icon size={12} strokeWidth={2.6} />{signedPct(p)}</span>;
}

/** Mini gráfico do dia; o traço tracejado é o fechamento anterior. */
function Spark({ data, base, w = 84, h = 26 }: { data: number[]; base: number | null; w?: number; h?: number }) {
  if (data.length < 2) return <svg className="spark" width={w} height={h} aria-hidden />;
  const lo = Math.min(...data, base ?? Infinity);
  const hi = Math.max(...data, base ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => 1 + (i / (data.length - 1)) * (w - 2);
  const y = (v: number) => h - 2 - ((v - lo) / span) * (h - 4);
  const up = data[data.length - 1] >= (base ?? data[0]);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {base != null && <line x1={0} x2={w} y1={y(base)} y2={y(base)} className="spark-base" />}
      <polyline points={data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none"
        stroke={up ? "var(--ok)" : "var(--bad)"} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Onde o preço está entre a mínima e a máxima (do dia ou de 52 semanas). */
function RangeBar({ label, low, high, value, q }: { label: string; low: number | null; high: number | null; value: number; q: DayQuote }) {
  if (low == null || high == null || !(high > low)) return null;
  const at = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div className="range">
      <div className="row spread muted small"><span>{label}</span></div>
      <div className="range-track"><div className="range-dot" style={{ left: `${at}%` }} /></div>
      <div className="row spread small num"><span>{quotePrice(q, low)}</span><span>{quotePrice(q, high)}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rótulos da pesquisa                                                 */
/* ------------------------------------------------------------------ */

const VERDICT = () =>
  ({
    comprar: { label: L("Comprar", "Buy"), cls: "ok" },
    acumular: { label: L("Acumular", "Accumulate"), cls: "ok" },
    manter: { label: L("Manter", "Hold"), cls: "" },
    reduzir: { label: L("Reduzir", "Reduce"), cls: "warn" },
    evitar: { label: L("Evitar", "Avoid"), cls: "bad" },
  }) as const;

const OUTLOOK = () =>
  ({
    alta: { label: L("Expectativa de alta", "Expected to rise"), cls: "up", Icon: TrendingUp },
    neutra: { label: L("Expectativa neutra", "Neutral outlook"), cls: "flat", Icon: Minus },
    queda: { label: L("Expectativa de queda", "Expected to fall"), cls: "down", Icon: TrendingDown },
  }) as const;

const LIKELY = (v: string) => (v === "alta" ? L("alta", "high") : v === "media" ? L("média", "medium") : L("baixa", "low"));

/* ------------------------------------------------------------------ */
/* Tela                                                                */
/* ------------------------------------------------------------------ */

/** Último resultado por visão: ao voltar para a aba, mostra na hora e atualiza por trás. */
const cache = new Map<string, MarketData>();

type Sort = "value" | "gainers" | "losers";
type Picked = { hit: SearchHit; quote: DayQuote | null; loading: boolean; error?: string };

export function MarketView({ job }: { job: Job<ResearchResult> }) {
  const { state, config, view, removeResearch } = useStore();
  const research = useMemo(() => state!.research ?? [], [state]);
  const ai = useAi();
  const [section, setSection] = useState<"today" | "research">("today");
  const [openId, setOpenId] = useState<string | null>(research[0]?.id ?? null);

  const [data, setData] = useState<MarketData | null>(() => cache.get(view) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("value");
  const [picked, setPicked] = useState<Picked | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.market(view, signal);
      cache.set(view, d);
      setData(d);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    setData(cache.get(view) ?? null);
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, view]);

  // Pesquisa concluída: abre o relatório.
  const lastResult = job.result;
  useEffect(() => {
    if (lastResult) setOpenId(lastResult.id);
  }, [lastResult]);

  const startResearch = (req: ResearchRequest) => {
    job.start(req);
    setSection("research");
    setOpenId(null);
    window.scrollTo(0, 0);
  };

  const pick = (hit: SearchHit) => {
    setPicked({ hit, quote: null, loading: true });
    api.quote(hit.symbol)
      .then(({ quote }) => setPicked((p) => (p?.hit.symbol === hit.symbol ? { ...p, quote, loading: false } : p)))
      .catch((e: Error) => setPicked((p) => (p?.hit.symbol === hit.symbol ? { ...p, loading: false, error: e.message } : p)));
  };

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    if (sort === "gainers") list.sort((a, b) => (b.quote?.changePct ?? -Infinity) - (a.quote?.changePct ?? -Infinity));
    if (sort === "losers") list.sort((a, b) => (a.quote?.changePct ?? Infinity) - (b.quote?.changePct ?? Infinity));
    return list;
  }, [data, sort]);

  const quoted = (data?.rows ?? []).filter((r) => r.quote?.changePct != null);
  const dayTotal = quoted.reduce((s, r) => s + (r.dayChange ?? 0), 0);
  const quotedValue = quoted.reduce((s, r) => s + r.value, 0);
  const dayPct = quotedValue > 0 ? (dayTotal / (quotedValue - dayTotal)) * 100 : null;
  const ups = quoted.filter((r) => dir(r.quote!.changePct) === "up").length;
  const downs = quoted.filter((r) => dir(r.quote!.changePct) === "down").length;
  const lastTime = (data?.rows ?? []).map((r) => r.quote?.marketTime).filter(Boolean).sort().pop();
  const busy = job.running;
  const canAi = config!.hasCredentials;
  const bySymbol = (symbol: string) => research.find((r) => researchKey(r) === researchKey({ symbol, ticker: symbol }));
  const heldRow = (symbol: string) => (data?.rows ?? []).find((r) => r.quote?.symbol === symbol || (r.ticker && researchKey({ symbol: r.ticker, ticker: r.ticker }) === researchKey({ symbol, ticker: symbol })));

  const open = research.find((r) => r.id === openId) ?? (job.running ? null : research[0]) ?? null;

  return (
    <>
      <PageHead
        title={view === "all" ? L("Mercado", "Market") : `${L("Mercado", "Market")} · ${view}`}
        subtitle={L(
          "Como estão hoje os principais ativos da sua carteira — e uma pesquisa completa de qualquer ativo, com recomendação pensada para a sua estratégia.",
          "How your portfolio's main assets are doing today — and a full research on any asset, with a recommendation tailored to your strategy.",
        )}
        actions={
          <button className="btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> {L("Atualizar", "Refresh")}
          </button>
        }
      />

      <AssetSearch
        rows={data?.rows ?? []}
        picked={picked}
        onPick={pick}
        onClear={() => setPicked(null)}
        onFreeText={(query) => startResearch({ query })}
        busy={busy}
        canAi={canAi}
      />

      {picked && (
        <PickedCard
          picked={picked}
          held={heldRow(picked.hit.symbol)}
          previous={bySymbol(picked.hit.symbol)}
          busy={busy}
          canAi={canAi}
          modelLabel={ai.modelLabel("research")}
          onOpenPrevious={(id) => { setOpenId(id); setSection("research"); }}
          onResearch={() => startResearch({ query: picked.hit.symbol, symbol: picked.hit.symbol, name: picked.hit.name })}
          onClose={() => setPicked(null)}
        />
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={section === "today"} className={`tab ${section === "today" ? "active" : ""}`} onClick={() => setSection("today")}>
          {L("Hoje", "Today")}
        </button>
        <button role="tab" aria-selected={section === "research"} className={`tab ${section === "research" ? "active" : ""}`} onClick={() => setSection("research")}>
          {L("Pesquisas", "Research")}{research.length > 0 && <span className="chip">{research.length}</span>}
          {busy && <Loader2 size={14} className="spin" />}
        </button>
      </div>

      {section === "today" ? (
        <div className="stack-lg">
          {error && <Banner kind="bad">{L("Não foi possível buscar as cotações:", "Couldn't fetch quotes:")} {error}</Banner>}

          {data && (
            <div className="bench-strip">
              {data.benchmarks.map((b) => (
                <div className="card bench" key={b.symbol} title={b.quote?.marketTime ? dateTime(b.quote.marketTime) : undefined}>
                  <div className="muted small">{b.label}</div>
                  {b.quote ? (
                    <>
                      <div className="num bench-price">{quotePrice(b.quote, b.quote.price)}</div>
                      <div className="row spread"><Change pct={b.quote.changePct} /><Spark data={b.quote.spark} base={b.quote.previousClose} w={64} h={22} /></div>
                    </>
                  ) : (
                    <div className="muted small">{L("sem cotação", "no quote")}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>{L("Seus principais ativos hoje", "Your main assets today")}</h2>
                <p className="muted small">
                  {lastTime
                    ? L(`Cotações do Yahoo Finance até ${dateTime(lastTime)} · podem ter atraso de até 15 min.`, `Yahoo Finance quotes as of ${dateTime(lastTime)} · may be delayed up to 15 min.`)
                    : L("Cotações do Yahoo Finance (podem ter atraso de até 15 min).", "Yahoo Finance quotes (may be delayed up to 15 min).")}
                </p>
              </div>
              <div className="seg" role="radiogroup" aria-label={L("Ordenar", "Sort")}>
                {([["value", L("Maiores posições", "Largest")], ["gainers", L("Altas", "Gainers")], ["losers", L("Quedas", "Losers")]] as [Sort, string][]).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={sort === k} className={sort === k ? "active" : ""} onClick={() => setSort(k)}>{label}</button>
                ))}
              </div>
            </div>

            {quoted.length > 0 && (
              <div className="grid kpis" style={{ marginBottom: 14 }}>
                <div className="kpi">
                  <div className="label">{L("Variação de hoje", "Today's change")}</div>
                  <div className={`value num ${dir(dayTotal) === "up" ? "ok-text" : dir(dayTotal) === "down" ? "bad-text" : ""}`}>{signedAmt(dayTotal)}</div>
                  <div className="sub">{dayPct != null ? signedPct(dayPct) : "—"} {L("nesses ativos (estimado)", "on these assets (estimate)")}</div>
                </div>
                <div className="kpi">
                  <div className="label">{L("Em alta · em queda", "Up · down")}</div>
                  <div className="value num"><span className="ok-text">{ups}</span> <span className="muted">·</span> <span className="bad-text">{downs}</span></div>
                  <div className="sub">{L(`de ${quoted.length} com cotação`, `of ${quoted.length} quoted`)}</div>
                </div>
                <div className="kpi">
                  <div className="label">{L("Cobertura", "Coverage")}</div>
                  <div className="value num">{data && data.total > 0 ? pct((quotedValue / data.total) * 100, 0) : "—"}</div>
                  <div className="sub">{L("do patrimônio tem cotação de mercado", "of your investments have a market quote")}</div>
                </div>
              </div>
            )}

            {!data && loading ? (
              <div className="row muted" style={{ padding: 20 }}><Loader2 size={16} className="spin" /> {L("Buscando cotações…", "Fetching quotes…")}</div>
            ) : rows.length === 0 ? (
              <Empty title={L("Nenhum ativo com cotação de mercado", "No assets with a market quote")}>
                {L("Ações, FIIs, ETFs, BDRs e cripto com ticker aparecem aqui. Renda fixa e saldos não têm variação diária.", "Stocks, FIIs, ETFs, BDRs and crypto with a ticker show up here. Fixed income and balances don't move daily.")}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="mc t-mkt">
                  <thead>
                    <tr>
                      <th>{L("Ativo", "Asset")}</th>
                      <th className="right">{L("Hoje", "Today")}</th>
                      <th className="right">{L("Preço", "Price")}</th>
                      <th className="right">{L("Sua posição", "Your position")}</th>
                      <th className="right">{L("Impacto hoje", "Impact today")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <MarketLine key={r.key} r={r} busy={busy} canAi={canAi} previous={r.quote ? bySymbol(r.quote.symbol) : undefined}
                        onResearch={() => startResearch({ query: r.ticker ?? r.name, symbol: r.quote?.symbol ?? null, name: r.quote?.name ?? r.name })}
                        onOpen={(id) => { setOpenId(id); setSection("research"); }} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small" style={{ marginTop: 10 }}>
              {L(
                "Posições do mesmo ativo em instituições diferentes aparecem somadas. O impacto é estimado pelo valor salvo da posição × variação do dia.",
                "Positions in the same asset across institutions are summed. The impact is estimated as the saved position value × today's change.",
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="stack-lg">
          {job.running && <JobProgress job={job} onCancel={job.cancel} />}
          {job.error && <Banner kind="bad">{L("Falha na pesquisa:", "Research failed:")} {job.error}</Banner>}
          {research.length > 0 && (
            <div className="research-list" role="list">
              {research.map((r) => {
                const v = VERDICT()[r.recommendation.verdict];
                return (
                  <button key={r.id} role="listitem" className={"research-pill" + (open?.id === r.id ? " active" : "")} onClick={() => setOpenId(r.id)}>
                    <b>{r.ticker}</b>
                    <span className={`chip ${v.cls}`}>{v.label}</span>
                    <span className="muted small">{new Date(r.runAt).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" })}</span>
                  </button>
                );
              })}
            </div>
          )}
          {open ? (
            <ResearchReportView r={open} busy={busy} canAi={canAi}
              onRerun={() => startResearch({ query: open.symbol ?? open.query, symbol: open.symbol, name: open.name })}
              onDelete={() => { removeResearch(open.id); setOpenId(null); }} />
          ) : (
            !job.running && (
              <div className="card">
                <Empty title={L("Nenhuma pesquisa ainda", "No research yet")}>
                  <p style={{ maxWidth: 560, margin: "0 auto" }}>
                    {L(
                      `Busque um ativo acima (ex.: PETR4, HGLG11, IVVB11, Apple, Bitcoin) ou clique em ✨ na lista de hoje. A IA (${ai.modelLabel("research")}) pesquisa balanços, notícias, macro e geopolítica, dá uma nota de qualidade, a expectativa de alta ou queda, cenários positivos e negativos e recomenda — ou não — com base na sua carteira e na Arca.`,
                      `Search an asset above (e.g. PETR4, HGLG11, IVVB11, Apple, Bitcoin) or click ✨ in today's list. The AI (${ai.modelLabel("research")}) researches financials, news, macro and geopolitics, scores quality, gives the expected direction, positive and negative scenarios, and recommends — or not — based on your portfolio and the Arca.`,
                    )}
                  </p>
                </Empty>
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

function MarketLine({ r, busy, canAi, previous, onResearch, onOpen }: {
  r: MarketRow; busy: boolean; canAi: boolean; previous?: ResearchResult; onResearch: () => void; onOpen: (id: string) => void;
}) {
  const q = r.quote;
  return (
    <tr>
      <td className="ga-main" style={{ minWidth: 180 }}>
        <div className="row" style={{ gap: 6 }}><ClassDot c={r.assetClass} /><b>{r.ticker ?? q?.symbol ?? r.name}</b></div>
        <div className="muted small ellipsis" title={q?.name ?? r.name}>{q?.name ?? r.name}</div>
      </td>
      <td className="ga-val">
        <span className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          {q && <span className="d-only"><Spark data={q.spark} base={q.previousClose} /></span>}
          <Change pct={q?.changePct} />
        </span>
      </td>
      <td className="right num ga-b" data-l={L("Preço", "Price")} title={q?.marketTime ? dateTime(q.marketTime) : undefined}>{q ? quotePrice(q, q.price) : <span className="muted">{L("sem cotação", "no quote")}</span>}</td>
      <td className="right num ga-a" data-l={L("Sua posição", "Your position")}>
        {amt0(r.value)}
        <div className="muted small">{pct(r.weightPct)}{r.positions > 1 ? ` · ${r.positions} ${L("posições", "positions")}` : ""}</div>
      </td>
      <td className={`right num ga-side ${dir(r.dayChange) === "up" ? "ok-text" : dir(r.dayChange) === "down" ? "bad-text" : ""}`} data-l={L("Impacto hoje", "Impact today")}>
        {r.dayChange != null ? signedAmt(r.dayChange) : "—"}
      </td>
      <td className="right ga-act">
        <span className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
          {previous && (
            <button className="btn ghost icon" title={L(`Ver pesquisa de ${dateTime(previous.runAt)}`, `See research from ${dateTime(previous.runAt)}`)} onClick={() => onOpen(previous.id)}>
              <ShieldCheck size={16} />
            </button>
          )}
          <button className="btn ghost icon" disabled={busy || !canAi} onClick={onResearch}
            title={L("Pesquisa completa com IA (leva alguns minutos)", "Full AI research (takes a few minutes)")} aria-label={L(`Pesquisar ${r.ticker ?? r.name} com IA`, `Research ${r.ticker ?? r.name} with AI`)}>
            <Sparkles size={16} />
          </button>
        </span>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

function AssetSearch({ rows, picked, onPick, onClear, onFreeText, busy, canAi }: {
  rows: MarketRow[]; picked: Picked | null; onPick: (h: SearchHit) => void; onClear: () => void; onFreeText: (q: string) => void; busy: boolean; canAi: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setSearching(true);
      api.searchAssets(term, ctrl.signal)
        .then(({ results }) => setHits(results))
        .catch(() => setHits([]))
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Da carteira primeiro (já com o símbolo que tem cotação), depois o resto da busca.
  const term = q.trim().toLowerCase();
  const mine: SearchHit[] = term.length >= 2
    ? rows
        .filter((r) => r.quote && `${r.ticker ?? ""} ${r.name} ${r.quote.name ?? ""}`.toLowerCase().includes(term))
        .slice(0, 4)
        .map((r) => ({ symbol: r.quote!.symbol, name: r.quote!.name ?? r.name, exchange: r.quote!.exchange, type: r.quote!.type }))
    : [];
  const list = [...mine, ...hits.filter((h) => !mine.some((m) => m.symbol === h.symbol))].slice(0, 9);
  const options = [...list.map((h) => ({ kind: "hit" as const, h })), ...(term.length >= 2 ? [{ kind: "free" as const }] : [])];

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    setOpen(false);
    if (o.kind === "hit") {
      onPick(o.h);
      setQ("");
    } else if (canAi && !busy) {
      onFreeText(q.trim());
      setQ("");
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="card search-card" ref={box}>
      <div className="search-input">
        <Search size={18} className="muted" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls="asset-search-list"
          aria-label={L("Pesquisar ativo", "Search asset")}
          placeholder={L("Pesquisar qualquer ativo: PETR4, HGLG11, IVVB11, Apple, Bitcoin…", "Search any asset: PETR4, HGLG11, IVVB11, Apple, Bitcoin…")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        {searching && <Loader2 size={16} className="spin muted" />}
        {picked && !q && <button className="btn ghost sm" onClick={onClear}><X size={14} /> {L("Limpar", "Clear")}</button>}
      </div>
      {open && options.length > 0 && (
        <div className="search-list" id="asset-search-list" role="listbox">
          {options.map((o, i) =>
            o.kind === "hit" ? (
              <button key={o.h.symbol} role="option" aria-selected={i === active} className={"search-opt" + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                <b className="num">{o.h.symbol.replace(/\.SA$/, "")}</b>
                <span className="grow ellipsis">{o.h.name}</span>
                {i < mine.length && <span className="chip owner-PF">{L("na carteira", "in portfolio")}</span>}
                <span className="muted small">{[o.h.exchange, typeLabel(o.h.type)].filter(Boolean).join(" · ")}</span>
              </button>
            ) : (
              <button key="free" role="option" aria-selected={i === active} className={"search-opt" + (i === active ? " active" : "")}
                disabled={!canAi || busy} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                <Sparkles size={15} />
                <span className="grow">{L(`Pesquisar “${q.trim()}” com IA`, `Research “${q.trim()}” with AI`)}</span>
                <span className="muted small">{L("sem cotação", "no quote")}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const typeLabel = (t: string | null) =>
  t === "EQUITY" ? L("Ação", "Stock") : t === "ETF" ? "ETF" : t === "MUTUALFUND" ? L("Fundo", "Fund") : t === "CRYPTOCURRENCY" ? "Cripto" : t === "INDEX" ? L("Índice", "Index") : t === "CURRENCY" ? L("Moeda", "Currency") : null;

function PickedCard({ picked, held, previous, busy, canAi, modelLabel, onResearch, onOpenPrevious, onClose }: {
  picked: Picked; held?: MarketRow; previous?: ResearchResult; busy: boolean; canAi: boolean; modelLabel: string;
  onResearch: () => void; onOpenPrevious: (id: string) => void; onClose: () => void;
}) {
  const { hit, quote: q } = picked;
  return (
    <div className="card picked">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 8 }}>
            <h2 className="num">{hit.symbol.replace(/\.SA$/, "")}</h2>
            {typeLabel(hit.type) && <span className="chip">{typeLabel(hit.type)}</span>}
            {held && <span className="chip owner-PF">{L(`você tem ${amt0(held.value)} (${pct(held.weightPct)})`, `you hold ${amt0(held.value)} (${pct(held.weightPct)})`)}</span>}
          </div>
          <div className="muted">{hit.name}{hit.exchange ? ` · ${hit.exchange}` : ""}</div>
        </div>
        <button className="btn ghost icon" onClick={onClose} aria-label={L("Fechar", "Close")}><X size={16} /></button>
      </div>

      {picked.loading ? (
        <div className="row muted" style={{ marginTop: 12 }}><Loader2 size={16} className="spin" /> {L("Buscando cotação…", "Fetching quote…")}</div>
      ) : q ? (
        <div className="picked-body">
          <div>
            <div className="picked-price num">{quotePrice(q, q.price)}</div>
            <div className="row" style={{ gap: 8 }}>
              <Change pct={q.changePct} />
              {q.change != null && <span className="muted small num">{q.change > 0 ? "+" : ""}{quotePrice(q, q.change)} {L("hoje", "today")}</span>}
            </div>
            {q.marketTime && <div className="muted small">{dateTime(q.marketTime)}</div>}
          </div>
          <Spark data={q.spark} base={q.previousClose} w={180} h={54} />
          <div className="picked-ranges">
            <RangeBar label={L("Faixa do dia", "Day range")} low={q.dayLow} high={q.dayHigh} value={q.price} q={q} />
            <RangeBar label={L("52 semanas", "52 weeks")} low={q.low52} high={q.high52} value={q.price} q={q} />
          </div>
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 10 }}>{picked.error ?? L("Cotação indisponível — a pesquisa com IA ainda funciona.", "Quote unavailable — the AI research still works.")}</p>
      )}

      <div className="row wrap" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={busy || !canAi} onClick={onResearch}>
          <Sparkles size={16} /> {previous ? L("Pesquisar de novo com IA", "Research again with AI") : L("Pesquisa completa com IA", "Full AI research")}
        </button>
        {previous && <button className="btn" onClick={() => onOpenPrevious(previous.id)}>{L(`Ver pesquisa de ${dateTime(previous.runAt)}`, `See research from ${dateTime(previous.runAt)}`)}</button>}
        <span className="muted small grow" style={{ minWidth: 220 }}>
          {busy
            ? L("Já há uma pesquisa em andamento.", "A research is already running.")
            : L(`${modelLabel} pesquisa balanços, notícias, macro e geopolítica e recomenda com base na sua carteira. Leva alguns minutos.`,
                `${modelLabel} researches financials, news, macro and geopolitics and recommends based on your portfolio. Takes a few minutes.`)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Relatório da pesquisa                                               */
/* ------------------------------------------------------------------ */

function ResearchReportView({ r, busy, canAi, onRerun, onDelete }: { r: ResearchResult; busy: boolean; canAi: boolean; onRerun: () => void; onDelete: () => void }) {
  const v = VERDICT()[r.recommendation.verdict];
  const o = OUTLOOK()[r.outlook.direction];
  const score = r.quality.score;
  const scoreCls = score >= 7 ? "ok" : score >= 4 ? "warn" : "bad";
  const positives = r.scenarios.filter((s) => s.kind === "positivo");
  const negatives = r.scenarios.filter((s) => s.kind === "negativo");
  return (
    <div className="stack-lg">
      <Banner kind="warn">
        {getLang() === "pt" ? (
          <>Análise gerada por IA com dados públicos da web, em {dateTime(r.runAt)} (dados até {r.dataAsOf}). Não é recomendação de investimento: confira os números nas fontes antes de decidir.</>
        ) : (
          <>AI-generated analysis using public web data, on {dateTime(r.runAt)} (data as of {r.dataAsOf}). Not investment advice: check the numbers in the sources before deciding.</>
        )}
      </Banner>

      <div className="card report-head">
        <div className="row spread wrap" style={{ alignItems: "flex-start" }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 className="report-ticker">{r.ticker}</h2>
              <span className="chip">{r.assetType}</span>
              <span className="chip"><ClassLabel c={r.arcaClass} /></span>
            </div>
            <div className="muted">{r.name}</div>
            {r.quote && (
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <span className="num"><b>{quotePrice(r.quote, r.quote.price)}</b></span>
                <Change pct={r.quote.changePct} />
                <span className="muted small">{L("na data da pesquisa", "at research time")}</span>
              </div>
            )}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" disabled={busy || !canAi} onClick={onRerun}><RefreshCw size={13} /> {L("Pesquisar de novo", "Research again")}</button>
            <button className="btn sm ghost danger" onClick={onDelete} title={L("Apagar esta pesquisa", "Delete this research")}><Trash2 size={13} /></button>
          </div>
        </div>

        <div className="verdict-grid">
          <div className={`verdict ${v.cls}`}>
            <div className="label">{L("Recomendação", "Recommendation")}</div>
            <div className="verdict-value">{v.label}</div>
          </div>
          <div className={`verdict outlook ${o.cls}`}>
            <div className="label">{L("Expectativa", "Outlook")} · {r.outlook.horizon}</div>
            <div className="verdict-value"><o.Icon size={20} /> {o.label}</div>
            <div className="small">{L("confiança", "confidence")} {LIKELY(r.outlook.confidence)}{r.outlook.priceRange ? ` · ${r.outlook.priceRange}` : ""}</div>
          </div>
          <div className="verdict">
            <div className="label">{L("Qualidade do ativo", "Asset quality")}</div>
            <div className="verdict-value num">{score.toLocaleString(locale(), { maximumFractionDigits: 1 })}<span className="muted small"> / 10</span></div>
            <div className={`score-bar ${scoreCls}`}><div style={{ width: `${score * 10}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>{L("Para a sua carteira", "For your portfolio")}</h2>
        <p className="prose">{r.recommendation.fitWithPortfolio}</p>
        <div className="action-box"><b>{L("O que fazer", "What to do")}:</b> {r.recommendation.suggestedAction}</div>
        <p className="prose muted" style={{ marginTop: 10 }}>{r.recommendation.rationale}</p>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>{L("Visão geral", "Overview")}</h2>
        <p className="prose">{r.overview}</p>
        {r.keyMetrics.length > 0 && <div className="metrics">{r.keyMetrics.map((m, i) => <span className="metric" key={i}>{m.label}: <b>{m.value}</b></span>)}</div>}
      </div>

      <div className="grid two">
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>{L("Qualidade", "Quality")}</h2>
          <p className="prose">{r.quality.summary}</p>
          {r.quality.strengths.length > 0 && (<><h3 style={{ margin: "12px 0 4px" }} className="ok-text">{L("Pontos fortes", "Strengths")}</h3><ul className="risks">{r.quality.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
          {r.quality.weaknesses.length > 0 && (<><h3 style={{ margin: "12px 0 4px" }} className="bad-text">{L("Pontos fracos", "Weaknesses")}</h3><ul className="risks">{r.quality.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>{L("Expectativa", "Outlook")}</h2>
          <p className="prose">{r.outlook.rationale}</p>
          <h3 style={{ margin: "14px 0 6px" }}><Globe size={14} style={{ verticalAlign: -2 }} /> {L("Macro e geopolítica", "Macro & geopolitics")}</h3>
          <p className="prose muted">{r.macroGeopolitics}</p>
        </div>
      </div>

      {r.scenarios.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>{L("Cenários", "Scenarios")}</h2>
          <div className="scenarios">
            {[...positives, ...negatives].map((s, i) => (
              <div key={i} className={`scenario ${s.kind === "positivo" ? "pos" : "neg"}`}>
                <div className="row spread" style={{ gap: 8, alignItems: "flex-start" }}>
                  <b className="row" style={{ gap: 6 }}>{s.kind === "positivo" ? <TrendingUp size={16} className="ok-text" /> : <TrendingDown size={16} className="bad-text" />}{s.title}</b>
                  <span className="chip">{L("prob.", "prob.")} {LIKELY(s.probability)}</span>
                </div>
                <p className="prose small" style={{ marginTop: 6 }}>{s.description}</p>
                <p className="small" style={{ marginTop: 6 }}><b>{L("Impacto", "Impact")}:</b> {s.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {r.sources.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}><Globe size={15} style={{ verticalAlign: -2 }} /> {L("Fontes", "Sources")}</h2>
          <div className="stack" style={{ gap: 6 }}>
            {r.sources.map((s, i) => {
              const href = safeUrl(s.url);
              return href ? (
                <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="row small"><ExternalLink size={13} /> {s.title || href}</a>
              ) : (
                <span key={i} className="small muted">{s.title || s.url}</span>
              );
            })}
          </div>
        </div>
      )}
      <span className="muted small">{r.searches} {L("buscas", "searches")} · {r.model} · {L("esforço", "effort")} {EFFORT_LABEL[r.effort].toLowerCase()} · {CLASS_META[r.arcaClass].label}</span>
    </div>
  );
}
