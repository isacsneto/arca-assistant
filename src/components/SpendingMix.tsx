import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart as RePieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ChartColumnStacked, ChartPie, ChevronRight, Info, PieChart, TrendingDown, TrendingUp } from "lucide-react";
import { categoryOf } from "../../shared/cashflow";
import type { CashflowView } from "../../shared/cashflowView";
import { describeHighlight, highlightCategory, highlightTone, REST, type Highlight } from "../../shared/spendingInsights";
import { amt0, amtCompact, pct } from "../lib/format";
import { L, locale } from "../../shared/i18n";

const monthShort = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "2-digit" });
const monthLong = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
/** Cor fixa por posição na lista de categorias do histórico (a ordem não muda com o mês selecionado). */
const color = (keys: string[], c: string) => (c === REST || !keys.includes(c) ? "var(--series-rest)" : `var(--series-${keys.indexOf(c) + 1})`);
const name = (c: string) => (c === REST ? L("Demais categorias", "Everything else") : categoryOf(c).label());

/* Colunas ou pizza: lembrado por aparelho (como o alto contraste). */
type ChartKind = "bars" | "pie";
const KIND_KEY = "arca:spending-chart";
function readKind(): ChartKind {
  try {
    return localStorage.getItem(KIND_KEY) === "pie" ? "pie" : "bars";
  } catch {
    return "bars";
  }
}
function useChartKind(): [ChartKind, (k: ChartKind) => void] {
  const [kind, setKind] = useState<ChartKind>(readKind);
  return [kind, (k) => {
    setKind(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {
      /* sem storage: vale até recarregar */
    }
  }];
}

/**
 * "Para onde vai o dinheiro": categorias mês a mês (colunas empilhadas), o ranking do mês selecionado
 * e os destaques. Tudo clicável: categoria → histórico dela; destaque do mês → detalhe do mês.
 */
export function SpendingMix({ view, onCategory, onMonth }: { view: CashflowView; onCategory: (category: string, month: string) => void; onMonth: (month: string) => void }) {
  const { mix, highlights } = view;
  const [kind, setKind] = useChartKind();
  const current = view.months.find((m) => m.month === view.month);
  if (!current || current.expenses <= 0 || !mix.rows.length) return null;

  const ranked = Object.entries(current.byCategory).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, 8);
  const hidden = ranked.slice(8);
  const max = ranked[0]?.[1] ?? 1;
  const data = mix.rows.map((r) => ({ month: r.month, total: r.total, ...r.values }));
  // Pizza: o mês selecionado, com as mesmas categorias (e cores) das colunas.
  const monthRow = mix.rows.find((r) => r.month === view.month);
  const slices = monthRow ? mix.keys.map((k) => ({ key: k, value: monthRow.values[k] ?? 0 })).filter((x) => x.value > 0.5) : [];
  // Clique num pedaço da coluna: a categoria (o "resto" abre o mês inteiro).
  const segClick = (key: string) => (d: unknown) => {
    const m = (d as { payload?: { month?: string } }).payload?.month;
    if (!m) return;
    if (key === REST) onMonth(m);
    else onCategory(key, m);
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2 className="row"><PieChart size={17} /> {L("Para onde vai o dinheiro", "Where your money goes")}</h2>
        <div className="row" style={{ gap: 10 }}>
          <span className="muted small">
            {kind === "pie"
              ? <><span className="cap">{monthLong(view.month)}</span> · {L("clique numa fatia", "click a slice")}</>
              : L("últimos meses · clique para detalhar", "recent months · click for details")}
          </span>
          <div className="sm-toggle" role="group" aria-label={L("Tipo de gráfico", "Chart type")}>
            <button className={`chip-btn${kind === "bars" ? " active" : ""}`} aria-pressed={kind === "bars"} onClick={() => setKind("bars")} title={L("Colunas por mês", "Columns by month")}>
              <ChartColumnStacked size={14} /> {L("Colunas", "Columns")}
            </button>
            <button className={`chip-btn${kind === "pie" ? " active" : ""}`} aria-pressed={kind === "pie"} onClick={() => setKind("pie")} title={L("Pizza do mês", "Pie for the month")}>
              <ChartPie size={14} /> {L("Pizza", "Pie")}
            </button>
          </div>
        </div>
      </div>

      <div className="sm-legend" aria-label={L("Legenda", "Legend")}>
        {(kind === "pie" ? slices.map((x) => x.key) : mix.keys).map((k) => (
          <span key={k} className="sm-legend-item"><i style={{ background: color(mix.keys, k) }} />{name(k)}</span>
        ))}
      </div>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === "pie" ? (
            <RePieChart margin={{ top: 8, bottom: 8 }}>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const k = String((payload[0].payload as { key: string }).key);
                  const v = Number(payload[0].value);
                  return (
                    <div className="sm-tip">
                      <div className="sm-tip-row">
                        <span><i style={{ background: color(mix.keys, k) }} />{name(k)}</span>
                        <span className="num">{amt0(v)} <span className="muted">{pct((v / current.expenses) * 100, 0)}</span></span>
                      </div>
                    </div>
                  );
                }}
              />
              <Pie data={slices} dataKey="value" nameKey="key" startAngle={90} endAngle={-270} outerRadius="78%" isAnimationActive={false}
                stroke="var(--surface)" strokeWidth={2} cursor="pointer"
                onClick={(d: unknown) => { const k = (d as { payload?: { key?: string } }).payload?.key; if (k === REST) onMonth(view.month); else if (k) onCategory(k, view.month); }}
                labelLine={false}
                // Só a porcentagem, fora da fatia e na cor do texto; fatias pequenas ficam para a dica e a lista ao lado.
                label={({ cx, cy, midAngle, outerRadius, value }: { cx: number; cy: number; midAngle?: number; outerRadius: number; value: number }) => {
                  const share = value / current.expenses;
                  if (share < 0.05 || midAngle == null) return null;
                  const r = outerRadius + 14, a = (-midAngle * Math.PI) / 180;
                  const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                  return <text x={x} y={y} fill="var(--text)" fontSize={11} textAnchor={x > cx ? "start" : "end"} dominantBaseline="central">{pct(share * 100, 0)}</text>;
                }}>
                {slices.map((x) => <Cell key={x.key} fill={color(mix.keys, x.key)} />)}
              </Pie>
            </RePieChart>
          ) : (
          <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11 }} stroke="var(--muted)" />
            <YAxis tickFormatter={(v: number) => amtCompact(v)} width={68} tick={{ fontSize: 11 }} stroke="var(--muted)" />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as { total: number };
                const items = [...payload].filter((p) => Number(p.value) > 0.5).reverse();
                return (
                  <div className="sm-tip">
                    <div className="sm-tip-head"><b>{monthLong(String(label))}</b><b className="num">{amt0(row.total)}</b></div>
                    {items.map((p) => (
                      <div key={String(p.dataKey)} className="sm-tip-row">
                        <span><i style={{ background: color(mix.keys, String(p.dataKey)) }} />{name(String(p.dataKey))}</span>
                        <span className="num">{amt0(Number(p.value))} <span className="muted">{pct((Number(p.value) / row.total) * 100, 0)}</span></span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {mix.keys.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="mix" isAnimationActive={false} cursor="pointer" onClick={segClick(k)}
                stroke="var(--surface)" strokeWidth={1} radius={i === mix.keys.length - 1 ? [4, 4, 0, 0] : 0}>
                {mix.rows.map((r) => <Cell key={r.month} fill={color(mix.keys, k)} fillOpacity={r.month === view.month ? 1 : 0.5} />)}
              </Bar>
            ))}
          </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="grid two sm-split">
        <div>
          <h3 className="sm-sub"><span className="cap">{monthLong(view.month)}</span> · <span className="num">{amt0(current.expenses)}</span></h3>
          <div className="sm-rank">
            {shown.map(([c, v]) => (
              <button key={c} className="sm-rank-row" onClick={() => onCategory(c, view.month)}>
                <span className="sm-rank-name"><i style={{ background: color(mix.keys, c) }} />{categoryOf(c).label()}</span>
                <span className="sm-rank-bar"><span style={{ width: `${(v / max) * 100}%` }} /></span>
                <span className="num">{amt0(v)}</span>
                <span className="muted small num sm-rank-share">{pct((v / current.expenses) * 100, 0)}</span>
              </button>
            ))}
            {hidden.length > 0 && (
              <button className="sm-rank-row sm-more" onClick={() => onMonth(view.month)}>
                <span className="muted">+ {hidden.length} {L("categorias", "categories")}</span><span />
                <span className="num muted">{amt0(hidden.reduce((s, [, v]) => s + v, 0))}</span><ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
        <div>
          <h3 className="sm-sub">{L("Destaques do mês", "This month's highlights")}</h3>
          {highlights.length ? (
            <ul className="sm-highlights">
              {highlights.map((h, i) => <HighlightRow key={i} h={h} onClick={() => { const c = highlightCategory(h); if (c) onCategory(c, view.month); else onMonth(view.month); }} />)}
            </ul>
          ) : (
            <p className="muted small">{L("Ainda pouco histórico para comparar — os destaques aparecem conforme os meses se acumulam.", "Not enough history to compare yet — highlights appear as months accumulate.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function HighlightRow({ h, onClick }: { h: Highlight; onClick: () => void }) {
  const tone = highlightTone(h);
  const Icon = h.kind === "uncategorized" ? AlertTriangle : tone === "bad" ? TrendingUp : tone === "good" ? TrendingDown : Info;
  const toneLabel = tone === "bad" ? L("atenção", "watch") : tone === "good" ? L("bom sinal", "good sign") : null;
  return (
    <li>
      <button className={`sm-hl sm-hl-${tone}`} onClick={onClick}>
        <Icon size={15} aria-hidden />
        <span>{toneLabel && <span className="sr-only">{toneLabel}: </span>}{describeHighlight(h, amt0)}</span>
        <ChevronRight size={14} className="muted" />
      </button>
    </li>
  );
}
