import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkles } from "lucide-react";
import { CLASS_META, type AssetClass } from "../../shared/types";
import type { MonthStats, MonthSummary, Snapshot } from "../../shared/history";
import { api } from "../api";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt0, amtCompact, pct } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

export interface HistoryResponse {
  snapshots: Snapshot[];
  summaries: MonthSummary[];
  months: MonthStats[];
  benchmarks: { cdi: Record<string, number>; ibov: Record<string, number> };
}

const RANGES = [
  { id: "3m", days: 92 },
  { id: "6m", days: 183 },
  { id: "1a", days: 366 },
  { id: "all", days: Infinity },
] as const;
const CLASSES: AssetClass[] = ["caixa", "acoes", "fiis", "internacional", "outros"];

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "numeric" });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${amt0(Math.abs(n))}`;
const signedPct = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${pct(Math.abs(n), 2)}`);

/** Histórico do patrimônio: evolução, mês a mês contra CDI e Ibovespa, e o resumo do mês escrito pela IA. */
export function HistoryView() {
  const { state, config } = useStore();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("6m");
  const [month, setMonth] = useState<string | null>(null);
  const summaryJob = useJob<MonthSummary>("/api/history/summary", (s) =>
    setData((d) => (d ? { ...d, summaries: [...d.summaries.filter((x) => x.month !== s.month), s] } : d)),
  );

  // Recarrega quando a carteira muda (atualização automática, importação…).
  useEffect(() => {
    api.history().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [state?.rev, state?.positions]);

  const snaps = useMemo(() => {
    if (!data) return [];
    const days = RANGES.find((r) => r.id === range)!.days;
    const from = Number.isFinite(days) ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : "";
    return data.snapshots.filter((s) => s.date >= from);
  }, [data, range]);

  if (error) return <Banner kind="bad">{error}</Banner>;
  if (!data) return <p className="muted">{L("Carregando…", "Loading…")}</p>;

  const months = [...data.months].reverse();
  const current = months[0];
  const selected = months.find((m) => m.month === (month ?? current?.month)) ?? current;
  const summary = selected && data.summaries.find((s) => s.month === selected.month);
  const last = data.snapshots.at(-1);
  const first = snaps[0];
  const lastEstimated = [...snaps].reverse().find((s) => s.estimated)?.date;
  const periodChange = last && first ? last.total - first.total : 0;
  const chart = snaps.map((s) => ({ date: s.date, ...Object.fromEntries(CLASSES.map((c) => [c, s.byClass[c] ?? 0])) }));

  return (
    <>
      <PageHead
        title={L("Histórico", "History")}
        subtitle={L("Como o seu patrimônio evoluiu, mês a mês, comparado ao CDI e ao Ibovespa.", "How your wealth evolved, month by month, against CDI and the Ibovespa.")}
      />

      {data.snapshots.length < 2 ? (
        <Banner kind="info">{L("O histórico começa agora: a cada atualização o app guarda uma foto do dia. Volte amanhã para ver a evolução.", "History starts now: every update saves a snapshot of the day. Come back tomorrow to see the evolution.")}</Banner>
      ) : (
        <>
          <div className="grid kpis" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="label">{L("Investido hoje", "Invested today")}</div><div className="value num">{amt0(last!.total)}</div>
              {last!.physical > 0 && <div className="sub">{L("com bens", "with assets")} {amt0(last!.total + last!.physical - last!.debts)}</div>}</div>
            {current && (
              <div className="kpi"><div className="label">{L("No mês", "This month")} ({monthLabel(current.month)})</div>
                <div className="value num" style={{ color: current.change >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(current.change)}</div>
                <div className="sub">{L("rendimento", "return")} {signedPct(current.returnPct)} · CDI {signedPct(data.benchmarks.cdi[current.month])}</div></div>
            )}
            <div className="kpi"><div className="label">{L("No período", "In the period")}</div>
              <div className="value num" style={{ color: periodChange >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(periodChange)}</div>
              <div className="sub">{first ? `${L("desde", "since")} ${new Date(`${first.date}T12:00:00Z`).toLocaleDateString(locale())}` : ""}</div></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>{L("Evolução por classe", "Evolution by class")}</h2>
              <div className="row" style={{ gap: 4 }}>
                {RANGES.map((r) => (
                  <button key={r.id} className={`btn sm ${range === r.id ? "primary" : "ghost"}`} onClick={() => setRange(r.id)}>
                    {r.id === "all" ? L("Tudo", "All") : r.id === "1a" ? L("1 ano", "1 year") : r.id.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={28} tick={{ fontSize: 11 }} stroke="var(--muted)" />
                  <YAxis tickFormatter={(v: number) => amtCompact(v)} width={72} tick={{ fontSize: 11 }} stroke="var(--muted)" />
                  <Tooltip
                    formatter={(v, k) => [amt0(Number(v)), CLASS_META[k as AssetClass]?.label ?? String(k)]}
                    labelFormatter={(d) => new Date(`${String(d)}T12:00:00Z`).toLocaleDateString(locale())}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
                  />
                  {lastEstimated && first && <ReferenceArea x1={first.date} x2={lastEstimated} fill="var(--muted)" fillOpacity={0.08} />}
                  {CLASSES.map((c) => (
                    <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={CLASS_META[c].color} fill={CLASS_META[c].color} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {lastEstimated && (
              <p className="muted small">
                {L(
                  `Faixa cinza (até ${dayLabel(lastEstimated)}): reconstruída com as quantidades de hoje e os preços de cada dia — compras e vendas do período não aparecem.`,
                  `Grey band (until ${dayLabel(lastEstimated)}): rebuilt with today's quantities and each day's prices — buys and sells in the period don't show.`,
                )}
              </p>
            )}
          </div>
        </>
      )}

      {months.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h2>{L("Mês a mês", "Month by month")}</h2></div>
          <div className="table-wrap">
            <table className="mc t-months">
              <thead>
                <tr>
                  <th>{L("Mês", "Month")}</th><th className="right">{L("Fim", "End")}</th><th className="right">{L("Variação", "Change")}</th>
                  <th className="right">{L("Aportes", "Contributions")}</th><th className="right">{L("Rendimento", "Return")}</th>
                  <th className="right">CDI</th><th className="right">Ibovespa</th><th />
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} style={{ background: selected?.month === m.month ? "var(--surface-2)" : undefined, cursor: "pointer" }} onClick={() => setMonth(m.month)}>
                    <td className="ga-main"><b>{monthLabel(m.month)}</b>{m.estimated && <span className="muted small"> · {L("estimado", "estimated")}</span>}</td>
                    <td className="right num ga-side" data-l={L("fim", "end")}>{amt0(m.end)}</td>
                    <td className="right num ga-val" style={{ color: m.change >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(m.change)}</td>
                    <td className="right num muted ga-side" data-l={L("aportes", "contrib.")}>{m.flows ? signed(m.flows) : "—"}</td>
                    <td className="right num ga-side" data-l={L("rend.", "return")}>{signedPct(m.returnPct)}</td>
                    <td className="right num muted ga-side" data-l="CDI">{signedPct(data.benchmarks.cdi[m.month])}</td>
                    <td className="right num muted ga-side" data-l="Ibov">{signedPct(data.benchmarks.ibov[m.month])}</td>
                    <td className="ga-a">{data.summaries.some((s) => s.month === m.month) && <Sparkles size={14} aria-label={L("tem resumo", "has summary")} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            {L("Rendimento = variação menos aportes registrados (depósitos − saques), sobre o valor do início do mês.", "Return = change minus recorded contributions (deposits − withdrawals), over the value at the start of the month.")}
          </p>
        </div>
      )}

      {selected && (
        <div className="card">
          <div className="card-head">
            <h2 className="row"><Sparkles size={17} /> {L("Resumo do mês", "Month summary")} · {monthLabel(selected.month)}</h2>
            <button className="btn sm primary" disabled={summaryJob.running || !config?.hasCredentials} onClick={() => summaryJob.start({ month: selected.month })}>
              <Sparkles size={14} /> {summary ? L("Refazer com IA", "Redo with AI") : L("Gerar com IA", "Generate with AI")}
            </button>
          </div>
          {summaryJob.running && <JobProgress job={summaryJob} onCancel={summaryJob.cancel} />}
          {summaryJob.error && <Banner kind="bad">{summaryJob.error}</Banner>}
          {summary ? (
            <>
              <div className="prose small" style={{ whiteSpace: "pre-wrap" }}>{summary.text}</div>
              <p className="muted small" style={{ marginTop: 8 }}>{L("Escrito pela IA em", "Written by the AI on")} {new Date(summary.at).toLocaleString(locale())}.</p>
            </>
          ) : (
            !summaryJob.running && <p className="muted small">{L("A IA explica o que mais pesou no mês (juros, bolsa, dólar, notícias) usando os números do seu histórico.", "The AI explains what weighed most this month (rates, stocks, dollar, news) using the numbers from your history.")}</p>
          )}
        </div>
      )}
    </>
  );
}
