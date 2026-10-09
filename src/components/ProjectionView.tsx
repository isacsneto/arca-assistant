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

const compact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const pctTxt = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const rateTxt = (r: ScenarioRateT) => `${pctTxt(r.annualReturnPct)} a.a.${r.initialShockPct ? ` · choque ${pctTxt(r.initialShockPct, 0)}` : ""}`;

const SERIES = {
  base: { label: "Cenário provável", color: "var(--series-base)" },
  worst: { label: "Pior caso", color: "var(--series-worst)" },
} as const;

export function ProjectionView({ job }: { job: Job<ProjectionResult> }) {
  const { state, config, visible: positions, view } = useStore();
  const { settings, projection } = state!;
  const allTotal = state!.positions.reduce((s, p) => s + (p.currency === "USD" ? p.value * settings.usdBrl : p.value), 0);
  const [real, setReal] = useState(false);

  const modelLabel = config!.models.find((m) => m.id === settings.projection.model)?.label ?? settings.projection.model;
  const years = useMemo(() => Array.from({ length: 31 }, (_, i) => i), []);
  const yearly = useMemo(
    () => (projection ? project(positions, settings.usdBrl, projection, years) : null),
    [projection, positions, settings.usdBrl, years],
  );

  const runButton = (
    <button className="btn primary" disabled={job.running || !positions.length || !config!.hasCredentials} onClick={job.start}>
      <RefreshCw size={15} className={job.running ? "spin" : ""} /> {projection ? "Atualizar projeção" : "Gerar projeção"}
    </button>
  );

  const head = (
    <PageHead
      title={view === "all" ? "Projeção" : "Projeção · " + view}
      subtitle={(view === "all" ? "Carteira consolidada (PF + PJ)" : VIEW_LABEL[view]) + ": quanto pode valer em 5, 10, 15, 20 e 30 anos — no cenário mais provável e no pior caso plausível."}
      actions={runButton}
    />
  );

  const status = (
    <>
      {job.running && <JobProgress job={job} onCancel={job.cancel} />}
      {job.error && <Banner kind="bad">Falha na projeção: {job.error}</Banner>}
    </>
  );

  if (!projection || !yearly) {
    return (
      <>
        {head}
        {status}
        {!job.running && (
          <div className="card">
            <Empty title={positions.length ? "Nenhuma projeção ainda" : "Sua carteira está vazia"}>
              <p style={{ maxWidth: 560, margin: "0 auto" }}>
                O Claude ({modelLabel}) pesquisa inflação, juros, situação fiscal, valuation das bolsas e o histórico de longo prazo de cada classe para
                definir as premissas dos dois cenários. Os valores são calculados sobre a sua carteira atual, sem novos aportes. Leva alguns minutos.
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
        Projeção gerada por IA em {dateTime(projection.runAt)} com dados públicos ({projection.asOf}). Cenários são hipóteses, não promessas nem
        recomendação de investimento.{view !== "all" && " As premissas são as mesmas da carteira consolidada; aqui só entram os ativos de " + VIEW_LABEL[view].toLowerCase() + "."}{drift > 0.05 && " Sua carteira mudou desde a pesquisa: os valores usam a carteira atual com as premissas daquela data."}
      </Banner>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="prose">{projection.summary}</p>
      </div>

      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div className="muted small">Hoje: <b className="num" style={{ color: "var(--text)" }}>{brl0(start)}</b> · sem novos aportes</div>
        <div className="seg" role="group" aria-label="Unidade">
          <button className={!real ? "active" : ""} onClick={() => setReal(false)}>Valores nominais</button>
          <button className={real ? "active" : ""} onClick={() => setReal(true)}>Em reais de hoje</button>
        </div>
      </div>

      <div className="grid horizons" style={{ marginBottom: 16 }}>
        {PROJECTION_HORIZONS.map((y) => (
          <div className="card kpi" key={y}>
            <div className="label">{y} anos</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}><span className="dot" style={{ background: SERIES.base.color }} /><span className="value num" style={{ fontSize: 18, marginTop: 0 }}>{compact.format(val(y, "base"))}</span></div>
            <div className="row" style={{ gap: 6, marginTop: 2 }}><span className="dot" style={{ background: SERIES.worst.color }} /><span className="num muted">{compact.format(val(y, "worst"))}</span></div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Evolução do patrimônio {real ? "(em reais de hoje)" : "(nominal)"}</h2>
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
              <XAxis dataKey="years" type="number" domain={[0, 30]} ticks={[0, 5, 10, 15, 20, 25, 30]} tickFormatter={(y) => (y ? `${y}a` : "hoje")}
                stroke="var(--muted)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis tickFormatter={(v) => compact.format(v)} width={72} stroke="var(--muted)" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                labelStyle={{ color: "var(--muted)" }}
                labelFormatter={(y) => (Number(y) ? `Em ${y} anos` : "Hoje")}
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
        <h2 style={{ marginBottom: 10 }}>Tabela</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Horizonte</th>
                <th className="right">{SERIES.base.label}</th><th className="right">a.a.</th>
                <th className="right">{SERIES.worst.label}</th><th className="right">a.a.</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Hoje</td><td className="right num">{brl0(start)}</td><td /><td className="right num">{brl0(start)}</td><td /></tr>
              {PROJECTION_HORIZONS.map((y) => (
                <tr key={y}>
                  <td>{y} anos</td>
                  <td className="right num"><b>{brl0(val(y, "base"))}</b></td>
                  <td className="right num muted">{pctTxt(impliedCagr(start, val(y, "base"), y))}</td>
                  <td className="right num"><b>{brl0(val(y, "worst"))}</b></td>
                  <td className="right num muted">{pctTxt(impliedCagr(start, val(y, "worst"), y))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          "a.a." = retorno anual composto implícito da carteira inteira{real ? ", já descontada a inflação" : ""}.
          Inflação usada para "reais de hoje": {pctTxt(projection.inflation.basePct)} a.a. no cenário provável e {pctTxt(projection.inflation.worstPct)} a.a. no pior caso.
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
        <h2 style={{ marginBottom: 10 }}>Premissas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Classe / ativo</th><th>{SERIES.base.label}</th><th>{SERIES.worst.label}</th></tr>
            </thead>
            <tbody>
              {projection.classes
                .filter((c) => presentClasses.includes(c.assetClass))
                .map((c) => (
                  <tr key={c.assetClass}>
                    <td style={{ minWidth: 150 }}><ClassLabel c={c.assetClass} /></td>
                    <td><b className="num">{rateTxt(c.base)}</b><div className="muted small">{c.base.rationale}</div></td>
                    <td><b className="num">{rateTxt(c.worst)}</b><div className="muted small">{c.worst.rationale}</div></td>
                  </tr>
                ))}
              {projection.assets
                .filter((a) => assetsById.has(a.positionId))
                .map((a) => {
                  const p = assetsById.get(a.positionId)!;
                  return (
                    <tr key={a.positionId}>
                      <td style={{ paddingLeft: 26 }}>{p.ticker ?? p.name}<div className="muted small">{CLASS_META[p.assetClass].label} · premissa própria</div></td>
                      <td><b className="num">{rateTxt(a.base)}</b><div className="muted small">{a.base.rationale}</div></td>
                      <td><b className="num">{rateTxt(a.worst)}</b><div className="muted small">{a.worst.rationale}</div></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Retornos nominais em reais (incluem câmbio, dividendos e juros reinvestidos; antes de IR). No pior caso, o choque acontece no 1º ano e depois o retorno anual se aplica.
          {yearly.missing.length > 0 && ` ${yearly.missing.length} posição(ões) sem premissa ficaram com valor constante — atualize a projeção.`}
        </p>
        <p className="muted small" style={{ marginTop: 6 }}>Inflação: {projection.inflation.rationale}</p>
      </div>

      {projection.sources.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}><Globe size={15} style={{ verticalAlign: -2 }} /> Fontes</h2>
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
          <p className="muted small row" style={{ marginTop: 12 }}><TrendingUp size={13} /> {projection.searches} buscas · {projection.model} · esforço {projection.effort}</p>
        </div>
      )}
    </>
  );
}
