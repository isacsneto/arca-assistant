import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { realGrowth, type FixedIncomeRow, type Indicators } from "../../shared/indicators";
import { api } from "../api";
import type { HistoryResponse } from "./HistoryView";
import { amt0, pct } from "../lib/format";
import { Banner, Empty, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale());
const monthShort = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "2-digit" });
const p2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : pct(n, 2));
const signed = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : "−"}${pct(Math.abs(n), 2)}`);
const PERIODS = [3, 6, 12, Infinity] as const;

const VERDICT = (): Record<FixedIncomeRow["verdict"], { label: string; cls: string }> => ({
  acima: { label: L("acima do CDI", "above CDI"), cls: "ok" },
  perto: { label: L("perto do CDI", "near CDI"), cls: "" },
  abaixo: { label: L("abaixo do CDI", "below CDI"), cls: "warn" },
});

/** Selic, CDI e IPCA do Banco Central quando você quiser; a renda fixa contra o CDI; o crescimento real do patrimônio. */
export function IndicatorsView() {
  const [data, setData] = useState<{ indicators: Indicators; fixedIncome: FixedIncomeRow[] } | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(12);

  const load = async (refresh = false) => {
    setBusy(true);
    setError(null);
    try {
      setData(await api.indicators(refresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    api.history().then(setHistory).catch(() => undefined);
  }, []);

  const ind = data?.indicators;
  const rows = data?.fixedIncome ?? [];
  const growth = history ? realGrowth(history.months, history.benchmarks.ipca ?? {}, period) : null;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const count = (v: FixedIncomeRow["verdict"]) => rows.filter((r) => r.verdict === v);

  return (
    <>
      <PageHead
        title={L("Indicadores", "Indicators")}
        subtitle={L("Selic, CDI e IPCA direto do Banco Central — para conferir os seus CDBs e o crescimento real do patrimônio.", "Selic, CDI and IPCA straight from the Central Bank — to check your CDBs and the real growth of your wealth.")}
        actions={
          <button className="btn sm" onClick={() => void load(true)} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {L("Atualizar do Banco Central", "Update from the Central Bank")}
          </button>
        }
      />
      {error && <Banner kind="bad">{error}</Banner>}
      {!ind ? (
        !error && <div className="card"><Empty title={L("Buscando no Banco Central…", "Fetching from the Central Bank…")} /></div>
      ) : (
        <>
          <div className="grid kpis" style={{ marginBottom: 6 }}>
            <div className="card kpi"><div className="label">{L("Selic (meta)", "Selic (target)")}</div><div className="value num">{p2(ind.selic?.value)}</div>
              <div className="sub">{L("ao ano", "per year")}{ind.selic ? ` · ${day(ind.selic.date)}` : ""}</div></div>
            <div className="card kpi"><div className="label">CDI</div><div className="value num">{p2(ind.cdi?.value)}</div>
              <div className="sub">{L("ao ano", "per year")}{ind.cdi ? ` · ${day(ind.cdi.date)}` : ""}</div></div>
            <div className="card kpi"><div className="label">{L("IPCA 12 meses", "IPCA 12 months")}</div><div className="value num">{p2(ind.ipca12m?.value)}</div>
              <div className="sub">{ind.ipca12m ? L(`até ${monthShort(ind.ipca12m.date.slice(0, 7))}`, `through ${monthShort(ind.ipca12m.date.slice(0, 7))}`) : ""}</div></div>
            <div className="card kpi"><div className="label">{L("Juro real", "Real rate")}</div>
              <div className="value num" style={{ color: (ind.realRate ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{p2(ind.realRate)}</div>
              <div className="sub">{L("Selic acima da inflação", "Selic above inflation")}</div></div>
          </div>
          <p className="muted small" style={{ marginBottom: 16 }}>
            {L(`Banco Central (SGS) · buscado em ${new Date(ind.fetchedAt).toLocaleString(locale())} · guarda 1 h; o botão busca agora.`, `Central Bank (SGS) · fetched ${new Date(ind.fetchedAt).toLocaleString(locale())} · cached 1 h; the button fetches now.`)}
          </p>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>{L("Sua renda fixa contra o CDI de hoje", "Your fixed income vs today's CDI")}</h2>
              <span className="muted small">{rows.length} {L("posições", "positions")} · {amt0(total)}</span>
            </div>
            {rows.length === 0 ? (
              <p className="muted">{L("Nenhum CDB, LCI, LCA ou debênture com taxa no nome (ex.: \"CDB 105% CDI\", \"IPCA + 6%\", \"12,5% a.a.\").", "No CDB, LCI, LCA or bond with a rate in its name (e.g. \"CDB 105% CDI\", \"IPCA + 6%\", \"12.5% p.a.\").")}</p>
            ) : (
              <>
                <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
                  <span className="chip ok">{count("acima").length} {L("acima do CDI", "above CDI")} · {amt0(count("acima").reduce((s, r) => s + r.value, 0))}</span>
                  <span className="chip">{count("perto").length} {L("perto", "near")} · {amt0(count("perto").reduce((s, r) => s + r.value, 0))}</span>
                  <span className="chip warn">{count("abaixo").length} {L("abaixo", "below")} · {amt0(count("abaixo").reduce((s, r) => s + r.value, 0))}</span>
                </div>
                <div className="table-wrap">
                  <table className="mc t-fi">
                    <thead><tr>
                      <th>{L("Ativo", "Asset")}</th><th>{L("Taxa", "Rate")}</th><th className="right">{L("Bruto a.a.", "Gross p.a.")}</th>
                      <th className="right">IR</th><th className="right">{L("Líquido a.a.", "Net p.a.")}</th>
                      <th className="right" title={L("Líquido sobre o CDI líquido com a mesma alíquota", "Net over CDI net of the same tax rate")}>{L("vs CDI", "vs CDI")}</th>
                      <th className="right" title={L("Líquido acima do IPCA 12 meses", "Net above 12-month IPCA")}>{L("Real", "Real")}</th><th />
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="ga-main"><b>{r.name}</b><div className="muted small">{r.institution} · {r.owner}{r.maturity ? ` · ${L("vence", "due")} ${day(r.maturity)}` : ""} · {amt0(r.value)}</div></td>
                          <td className="ga-a small">{r.indexer}</td>
                          <td className="right num ga-b" data-l={L("bruto", "gross")}>{p2(r.gross)}</td>
                          <td className="right num muted ga-c" data-l="IR">{r.exempt ? L("isento", "exempt") : pct(r.taxRate * 100, 1)}</td>
                          <td className="right num ga-d" data-l={L("líquido", "net")}>{p2(r.net)}</td>
                          <td className="right num ga-val" style={{ fontWeight: 600 }}>{pct(r.vsCdi * 100, 0)}</td>
                          <td className="right num ga-e" data-l={L("real", "real")}>{signed(r.real)}</td>
                          <td className="ga-side"><span className={`chip ${VERDICT()[r.verdict].cls}`}>{VERDICT()[r.verdict].label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small" style={{ marginTop: 8 }}>
                  {L("vs CDI = rendimento líquido sobre o de um CDB 100% do CDI com o mesmo IR (LCI/LCA isentas são comparadas com o CDI já descontado o IR). IR pelo prazo até o vencimento. IPCA+ usa o IPCA de 12 meses; prefixados e IPCA+ dependem dos juros futuros — a comparação é com o CDI de hoje.",
                    "vs CDI = net return over a 100%-of-CDI CDB with the same tax (tax-exempt LCI/LCA are compared to CDI after tax). Tax by time to maturity. IPCA+ uses 12-month IPCA; fixed-rate and IPCA+ depend on future rates — the comparison is with today's CDI.")}
                </p>
              </>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>{L("Crescimento real do patrimônio", "Real growth of your wealth")}</h2>
              <div className="seg" role="radiogroup" aria-label={L("Período", "Period")}>
                {PERIODS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={period === n} className={period === n ? "active" : ""} onClick={() => setPeriod(n)}>
                    {Number.isFinite(n) ? L(`${n} meses`, `${n} months`) : L("Tudo", "All")}
                  </button>
                ))}
              </div>
            </div>
            {!growth ? (
              <p className="muted">{L("Ainda sem meses com histórico e IPCA divulgado.", "No months with history and published IPCA yet.")}</p>
            ) : (
              <>
                <div className="grid kpis">
                  <div className="kpi"><div className="label">{L("Rendimento (sem aportes)", "Return (excl. contributions)")}</div><div className="value num">{signed(growth.nominal)}</div></div>
                  <div className="kpi"><div className="label">{L("Inflação (IPCA)", "Inflation (IPCA)")}</div><div className="value num">{signed(growth.inflation)}</div></div>
                  <div className="kpi"><div className="label">{L("Ganho real", "Real gain")}</div><div className="value num" style={{ color: growth.real >= 0 ? "var(--ok)" : "var(--bad)" }}>{signed(growth.real)}</div></div>
                </div>
                <p className="small" style={{ marginTop: 10 }}>
                  {L(`De ${monthShort(growth.from)} a ${monthShort(growth.to)} (${growth.months} ${growth.months === 1 ? "mês" : "meses"} com IPCA divulgado): ${amt0(growth.start)} no início equivalem a ${amt0(growth.startInTodayMoney)} em dinheiro de hoje; o patrimônio está em ${amt0(growth.end)} (com aportes).`,
                    `From ${monthShort(growth.from)} to ${monthShort(growth.to)} (${growth.months} month${growth.months === 1 ? "" : "s"} with published IPCA): ${amt0(growth.start)} at the start is ${amt0(growth.startInTodayMoney)} in today's money; your wealth is at ${amt0(growth.end)} (with contributions).`)}
                </p>
                {history?.months.some((m) => m.estimated) && <p className="muted small">{L("Parte dos meses do histórico é estimada (reconstruída pelos preços).", "Some history months are estimated (rebuilt from prices).")}</p>}
              </>
            )}
          </div>

          {ind.ipcaMonthly.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>{L("IPCA mês a mês", "IPCA month by month")}</h2><span className="muted small">{L("últimos 12 meses", "last 12 months")}</span></div>
              <div className="ipca-strip">
                {ind.ipcaMonthly.slice(-12).map((m) => (
                  <div key={m.month} className="ipca-cell">
                    <span className="muted small">{monthShort(m.month)}</span>
                    <b className="num" style={{ color: m.value < 0 ? "var(--ok)" : undefined }}>{m.value.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
