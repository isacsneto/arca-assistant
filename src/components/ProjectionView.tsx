import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Globe, RefreshCw, TrendingUp } from "lucide-react";
import { ALL_CLASSES, CLASS_META, PROJECTION_HORIZONS, type ProjectionResult, type ScenarioRateT } from "../../shared/types";
import { impliedCagr, project } from "../../shared/projection";
import { useStore } from "../store";
import type { Job } from "../lib/useJob";
import { brl0, dateTime, safeUrl } from "../lib/format";
import { Banner, ClassLabel, Empty, PageHead } from "./ui";
import { VIEW_LABEL } from "../../shared/owner";
import { JobProgress } from "./JobProgress";
import { useAi } from "../lib/useAi";
import { L, locale } from "../../shared/i18n";

const compactFmt = () => new Intl.NumberFormat(locale(), { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const pctTxt = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const pa = () => L("a.a.", "p.a.");
const rateTxt = (r: ScenarioRateT) => `${pctTxt(r.annualReturnPct)} ${pa()}${r.initialShockPct ? ` · ${L("choque", "shock")} ${pctTxt(r.initialShockPct, 0)}` : ""}`;

const seriesMeta = () =>
  ({
    base: { label: L("Cenário provável", "Likely scenario"), color: "var(--series-base)" },
    worst: { label: L("Pior caso", "Worst case"), color: "var(--series-worst)" },
  }) as const;

export function ProjectionView({ job }: { job: Job<ProjectionResult> }) {
  const { state, config, visible: positions, view } = useStore();
  const { settings, projection } = state!;
  const allTotal = state!.positions.reduce((s, p) => s + (p.currency === "USD" ? p.value * settings.usdBrl : p.value), 0);
  const [real, setReal] = useState(false);
  const SERIES = seriesMeta();
  const compact = useMemo(compactFmt, []);

  const modelLabel = useAi().modelLabel("projection");
  const years = useMemo(() => Array.from({ length: 31 }, (_, i) => i), []);
  const yearly = useMemo(
    () => (projection ? project(positions, settings.usdBrl, projection, years) : null),
    [projection, positions, settings.usdBrl, years],
  );

  const runButton = (
    <button className="btn primary" disabled={job.running || !positions.length || !config!.hasCredentials} onClick={job.start}>
      <RefreshCw size={15} className={job.running ? "spin" : ""} /> {projection ? L("Atualizar projeção", "Update projection") : L("Gerar projeção", "Generate projection")}
    </button>
  );

  const head = (
    <PageHead
      title={view === "all" ? L("Projeção", "Projection") : L("Projeção", "Projection") + " · " + view}
      subtitle={L(
        (view === "all" ? "Carteira consolidada (PF + PJ)" : VIEW_LABEL[view]) + ": quanto pode valer em 5, 10, 15, 20 e 30 anos — no cenário mais provável e no pior caso plausível.",
        (view === "all" ? "All portfolios (PF + PJ)" : view) + ": what it may be worth in 5, 10, 15, 20 and 30 years — in the most likely scenario and the plausible worst case.",
      )}
      actions={runButton}
    />
  );

  const status = (
    <>
      {job.running && <JobProgress job={job} onCancel={job.cancel} />}
      {job.error && <Banner kind="bad">{L("Falha na projeção:", "Projection failed:")} {job.error}</Banner>}
    </>
  );

  if (!projection || !yearly) {
    return (
      <>
        {head}
        {status}
        {!job.running && (
          <div className="card">
            <Empty title={positions.length ? L("Nenhuma projeção ainda", "No projection yet") : L("Sua carteira está vazia", "Your portfolio is empty")}>
              <p style={{ maxWidth: 560, margin: "0 auto" }}>
                {L(
                  `A IA (${modelLabel}) pesquisa inflação, juros, situação fiscal, valuation das bolsas e o histórico de longo prazo de cada classe para definir as premissas dos dois cenários. Os valores são calculados sobre a sua carteira atual, sem novos aportes. Leva alguns minutos.`,
                  `The AI (${modelLabel}) researches inflation, interest rates, the fiscal situation, stock market valuations and the long-term history of each class to set the assumptions for both scenarios. Values are computed on your current portfolio, with no new contributions. It takes a few minutes.`,
                )}
              </p>
            </Empty>
          </div>
        )}
      </>
    );
  }

  const start = yearly.start;
  const at = (y: number) => yearly.points[y];
  const val = (y: number, s: "base" | "worst") => (real ? at(y)[s === "base" ? "baseReal" : "worstReal"] : at(y)[s]);
  const chartData = yearly.points.map((p) => ({
    years: p.years,
    base: real ? p.baseReal : p.base,
    worst: real ? p.worstReal : p.worst,
  }));
  // A pesquisa é feita sobre a carteira inteira; compara com o total consolidado atual.
  const drift = projection.baseTotal > 0 ? Math.abs(allTotal - projection.baseTotal) / projection.baseTotal : 0;
  const assetsById = new Map(positions.map((p) => [p.id, p]));
  const presentClasses = ALL_CLASSES.filter((c) => positions.some((p) => p.assetClass === c));

  return (
    <>
      {head}
      {status}

      <Banner kind="warn">
        {L(
          `Projeção gerada por IA em ${dateTime(projection.runAt)} com dados públicos (${projection.asOf}). Cenários são hipóteses, não promessas nem recomendação de investimento.`,
          `AI-generated projection on ${dateTime(projection.runAt)} using public data (${projection.asOf}). Scenarios are hypotheses, not promises or investment advice.`,
        )}
        {view !== "all" && L(" As premissas são as mesmas da carteira consolidada; aqui só entram os ativos de " + VIEW_LABEL[view].toLowerCase() + ".", " The assumptions are the same as for the combined portfolio; only " + view + " assets are included here.")}
        {drift > 0.05 && L(" Sua carteira mudou desde a pesquisa: os valores usam a carteira atual com as premissas daquela data.", " Your portfolio has changed since the research: values use the current portfolio with the assumptions from that date.")}
      </Banner>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="prose">{projection.summary}</p>
      </div>

      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div className="muted small">{L("Hoje:", "Today:")} <b className="num" style={{ color: "var(--text)" }}>{brl0(start)}</b> · {L("sem novos aportes", "no new contributions")}</div>
        <div className="seg" role="group" aria-label={L("Unidade", "Unit")}>
          <button className={!real ? "active" : ""} onClick={() => setReal(false)}>{L("Valores nominais", "Nominal values")}</button>
          <button className={real ? "active" : ""} onClick={() => setReal(true)}>{L("Em reais de hoje", "In today's money")}</button>
        </div>
      </div>

      <div className="grid horizons" style={{ marginBottom: 16 }}>
        {PROJECTION_HORIZONS.map((y) => (
          <div className="card kpi" key={y}>
            <div className="label">{L(`${y} anos`, `${y} years`)}</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}><span className="dot" style={{ background: SERIES.base.color }} /><span className="value num" style={{ fontSize: 18, marginTop: 0 }}>{compact.format(val(y, "base"))}</span></div>
            <div className="row" style={{ gap: 6, marginTop: 2 }}><span className="dot" style={{ background: SERIES.worst.color }} /><span className="num muted">{compact.format(val(y, "worst"))}</span></div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L("Evolução do patrimônio", "Net worth over time")} {real ? L("(em reais de hoje)", "(in today's money)") : "(nominal)"}</h2>
          <div className="row small muted" style={{ gap: 14 }}>
            {(["base", "worst"] as const).map((s) => (
              <span className="row" style={{ gap: 6 }} key={s}><span className="legend-line" style={{ background: SERIES[s].color }} />{SERIES[s].label}</span>
            ))}
          </div>
        </div>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 96, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
              <XAxis dataKey="years" type="number" domain={[0, 30]} ticks={[0, 5, 10, 15, 20, 25, 30]} tickFormatter={(y) => (y ? L(`${y}a`, `${y}y`) : L("hoje", "today"))}
                stroke="var(--muted)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis tickFormatter={(v) => compact.format(v)} width={72} stroke="var(--muted)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                labelStyle={{ color: "var(--muted)" }}
                labelFormatter={(y) => (Number(y) ? L(`Em ${y} anos`, `In ${y} years`) : L("Hoje", "Today"))}
                formatter={(v, name) => [brl0(Number(v)), SERIES[name as "base" | "worst"].label]}
              />
              {(["base", "worst"] as const).map((s) => (
                <Line key={s} dataKey={s} name={s} type="monotone" stroke={SERIES[s].color} strokeWidth={2} dot={false}
                  activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false}
                  label={({ index, x, y }: { index?: number; x?: number | string; y?: number | string }) =>
                    index === chartData.length - 1 ? (
                      <text x={Number(x) + 8} y={Number(y)} dy={4} fill="var(--text)" fontSize={12} fontWeight={600}>
                        {compact.format(chartData[chartData.length - 1][s])}
                      </text>
                    ) : <g />
                  } />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10 }}>{L("Tabela", "Table")}</h2>
        <div className="table-wrap">
          <table className="mc t-horiz">
            <thead>
              <tr>
                <th>{L("Horizonte", "Horizon")}</th>
                <th className="right">{SERIES.base.label}</th><th className="right">{pa()}</th>
                <th className="right">{SERIES.worst.label}</th><th className="right">{pa()}</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="ga-main">{L("Hoje", "Today")}</td><td className="right num ga-a">{brl0(start)}</td><td /><td className="right num ga-b">{brl0(start)}</td><td /></tr>
              {PROJECTION_HORIZONS.map((y) => (
                <tr key={y}>
                  <td className="ga-main">{L(`${y} anos`, `${y} years`)}</td>
                  <td className="right num ga-a"><b>{brl0(val(y, "base"))}</b><div className="muted small m-only">{pctTxt(impliedCagr(start, val(y, "base"), y))} {pa()}</div></td>
                  <td className="right num muted mc-hide">{pctTxt(impliedCagr(start, val(y, "base"), y))}</td>
                  <td className="right num ga-b"><b>{brl0(val(y, "worst"))}</b><div className="muted small m-only">{pctTxt(impliedCagr(start, val(y, "worst"), y))} {pa()}</div></td>
                  <td className="right num muted mc-hide">{pctTxt(impliedCagr(start, val(y, "worst"), y))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {L(
            `"a.a." = retorno anual composto implícito da carteira inteira${real ? ", já descontada a inflação" : ""}. Inflação usada para "reais de hoje": ${pctTxt(projection.inflation.basePct)} a.a. no cenário provável e ${pctTxt(projection.inflation.worstPct)} a.a. no pior caso.`,
            `"p.a." = implied compound annual return of the whole portfolio${real ? ", net of inflation" : ""}. Inflation used for "today's money": ${pctTxt(projection.inflation.basePct)} p.a. in the likely scenario and ${pctTxt(projection.inflation.worstPct)} p.a. in the worst case.`,
          )}
        </p>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        {(["base", "worst"] as const).map((s) => (
          <div className="card" key={s}>
            <h2 className="row" style={{ marginBottom: 8 }}><span className="legend-line" style={{ background: SERIES[s].color }} />{SERIES[s].label}</h2>
            <p className="prose">{projection.scenarios[s]}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 10 }}>{L("Premissas", "Assumptions")}</h2>
        <div className="table-wrap">
          <table className="mc t-prem">
            <thead>
              <tr><th>{L("Classe / ativo", "Class / asset")}</th><th>{SERIES.base.label}</th><th>{SERIES.worst.label}</th></tr>
            </thead>
            <tbody>
              {projection.classes
                .filter((c) => presentClasses.includes(c.assetClass))
                .map((c) => (
                  <tr key={c.assetClass}>
                    <td className="ga-main" style={{ minWidth: 150 }}><ClassLabel c={c.assetClass} /></td>
                    <td className="ga-a" data-l={SERIES.base.label}><b className="num">{rateTxt(c.base)}</b><div className="muted small">{c.base.rationale}</div></td>
                    <td className="ga-b" data-l={SERIES.worst.label}><b className="num">{rateTxt(c.worst)}</b><div className="muted small">{c.worst.rationale}</div></td>
                  </tr>
                ))}
              {projection.assets
                .filter((a) => assetsById.has(a.positionId))
                .map((a) => {
                  const p = assetsById.get(a.positionId)!;
                  return (
                    <tr key={a.positionId}>
                      <td className="ga-main" style={{ paddingLeft: 26 }}>{p.ticker ?? p.name}<div className="muted small">{CLASS_META[p.assetClass].label} · {L("premissa própria", "own assumption")}</div></td>
                      <td className="ga-a" data-l={SERIES.base.label}><b className="num">{rateTxt(a.base)}</b><div className="muted small">{a.base.rationale}</div></td>
                      <td className="ga-b" data-l={SERIES.worst.label}><b className="num">{rateTxt(a.worst)}</b><div className="muted small">{a.worst.rationale}</div></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          {L(
            "Retornos nominais em reais (incluem câmbio, dividendos e juros reinvestidos; antes de IR). No pior caso, o choque acontece no 1º ano e depois o retorno anual se aplica.",
            "Nominal returns in reais (including currency, reinvested dividends and interest; before income tax). In the worst case, the shock happens in year 1 and then the annual return applies.",
          )}
          {yearly.missing.length > 0 &&
            L(
              ` ${yearly.missing.length} posição(ões) sem premissa ficaram com valor constante — atualize a projeção.`,
              ` ${yearly.missing.length} position${yearly.missing.length === 1 ? "" : "s"} without an assumption kept a constant value — update the projection.`,
            )}
        </p>
        <p className="muted small" style={{ marginTop: 6 }}>{L("Inflação:", "Inflation:")} {projection.inflation.rationale}</p>
      </div>

      {projection.sources.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}><Globe size={15} style={{ verticalAlign: -2 }} /> {L("Fontes", "Sources")}</h2>
          <div className="stack" style={{ gap: 6 }}>
            {projection.sources.map((s, i) => {
              const href = safeUrl(s.url);
              return href ? (
                <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="row small"><ExternalLink size={13} /> {s.title || href}</a>
              ) : (
                <span key={i} className="small muted">{s.title || s.url}</span>
              );
            })}
          </div>
          <p className="muted small row" style={{ marginTop: 12 }}><TrendingUp size={13} /> {L(`${projection.searches} buscas`, `${projection.searches} searches`)} · {projection.model} · {L("esforço", "effort")} {projection.effort}</p>
        </div>
      )}
    </>
  );
}
