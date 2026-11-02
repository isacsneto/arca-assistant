import { useEffect, useState } from "react";
import { Copy, FileText, Sparkles } from "lucide-react";
import type { TaxView as View } from "../../shared/taxView";
import { planningOf } from "../../shared/planning";
import { api } from "../api";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const KIND = (k: string) => {
  const map: Record<string, [string, string]> = {
    "EQUITY/STOCK": ["Ação", "Stock"], "EQUITY/REAL_ESTATE_FUND": ["FII", "REIT (FII)"], "ETF/ETF": ["ETF", "ETF"], "EQUITY/BDR": ["BDR", "BDR"],
    "FIXED_INCOME/TREASURY": ["Tesouro Direto", "Treasury"], "FIXED_INCOME/CDB": ["CDB", "CDB"], "FIXED_INCOME/LCA": ["LCA", "LCA"], "FIXED_INCOME/LCI": ["LCI", "LCI"],
    "FIXED_INCOME/CRA": ["CRA", "CRA"], "FIXED_INCOME/CRI": ["CRI", "CRI"], "FIXED_INCOME/DEBENTURES": ["Debênture", "Debenture"],
  };
  const hit = map[k];
  return hit ? L(hit[0], hit[1]) : k.startsWith("MUTUAL_FUND") ? L("Fundo", "Fund") : k;
};

/** IR do investidor: DARF mensal de renda variável, Bens e Direitos, proventos e checklist da IA. Estimativa — confira com os informes. */
export function TaxView({ goSettings }: { goSettings: () => void }) {
  const { state, update, config, savedAt } = useStore();
  const planning = planningOf(state!.planning);
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const advice = useJob<{ text: string; at: string; year: number }>("/api/tax/advice", (r) => update((s) => ({ ...s, planning: { ...planningOf(s.planning), taxAdvice: r } })));

  useEffect(() => {
    api.tax(year).then(setView).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [year, state?.rev, savedAt]);

  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (error) return <Banner kind="bad">{error}</Banner>;
  if (!view) return <p className="muted">{L("Carregando…", "Loading…")}</p>;
  const tip = planning.taxAdvice?.year === year ? planning.taxAdvice : null;

  return (
    <>
      <PageHead
        title={L("Imposto de Renda", "Income tax")}
        subtitle={L("DARF da bolsa mês a mês, Bens e Direitos com custo de aquisição e proventos — a partir do Open Finance. É uma estimativa: confira com notas de corretagem e informes.", "Monthly stock-market DARF, assets with acquisition cost and income — from Open Finance. It's an estimate: check it against broker notes and income statements.")}
        actions={
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={L("Ano-base", "Base year")}>
            {view.years.map((y) => <option key={y} value={y}>{L(`Ano-base ${y}`, `Base year ${y}`)}</option>)}
          </select>
        }
      />

      {!view.bens.length && !view.darfs.length && (
        <Banner kind="info">
          {L("Sem dados ainda: o IR usa os investimentos e movimentações das conexões do Open Finance (sincronizados 1x por dia).", "No data yet: taxes use the investments and transactions from your Open Finance connections (synced once a day).")}{" "}
          <button className="btn sm" onClick={goSettings}>{L("Ajustes → Open Finance", "Settings → Open Finance")}</button>
        </Banner>
      )}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">{L("DARF no ano", "DARF in the year")}</div><div className="value num" style={{ color: view.darfTotal > 0 ? "var(--bad)" : undefined }}>{amt(view.darfTotal)}</div>
          <div className="sub">{view.darfs.filter((d) => d.darf > 0).length} {L("meses com imposto", "months with tax")}</div></div>
        <div className="kpi"><div className="label">{L("Proventos isentos", "Exempt income")}</div><div className="value num">{amt(view.income.exempt)}</div><div className="sub">{L("dividendos e FIIs", "dividends and REITs")}</div></div>
        <div className="kpi"><div className="label">JCP</div><div className="value num">{amt(view.income.jcp)}</div><div className="sub">{L("tributação exclusiva (já retida)", "taxed at source")}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h2>{L("Renda variável · DARF mês a mês", "Stocks · monthly DARF")}</h2></div>
        {view.darfs.length ? (
          <div className="table-wrap">
            <table className="mc">
              <thead><tr><th>{L("Mês", "Month")}</th><th className="right">{L("Vendas de ações", "Stock sales")}</th><th className="right">{L("Lucro ações", "Stock gain")}</th><th className="right">ETF/BDR</th><th className="right">FII</th><th className="right">DARF</th><th>{L("Vence", "Due")}</th></tr></thead>
              <tbody>
                {view.darfs.map((d) => (
                  <tr key={d.month}>
                    <td className="ga-main"><b>{monthLabel(d.month)}</b><div className="muted small">{d.sales.map((s) => `${s.ticker} ${s.quantity}`).join(", ")}</div></td>
                    <td className="right num">{amt(d.stockSales)}{d.stocksExempt && d.gains.acoes > 0 && <div className="small" style={{ color: "var(--ok)" }}>{L("isento (≤ R$ 20 mil)", "exempt (≤ R$ 20k)")}</div>}</td>
                    <td className="right num" style={{ color: d.gains.acoes >= 0 ? undefined : "var(--bad)" }}>{amt(d.gains.acoes)}</td>
                    <td className="right num">{amt(d.gains.etf + d.gains.bdr)}</td>
                    <td className="right num">{amt(d.gains.fii)}</td>
                    <td className="right num"><b>{amt(d.darf)}</b>{d.tax > 0 && d.darf === 0 && <div className="muted small">{L("< R$ 10: acumula", "< R$ 10: carries over")}</div>}</td>
                    <td className="small">{d.darf > 0 ? br(d.dueDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small">{L("Nenhuma venda de ações, FIIs ou ETFs registrada neste ano.", "No stock, REIT or ETF sales recorded this year.")}</p>}
        <p className="muted small" style={{ marginTop: 8 }}>
          {L("Ações: 15%, isento se as vendas do mês somarem até R$ 20 mil. ETF/BDR: 15%. FII: 20%. Prejuízo compensa lucro futuro do mesmo grupo. DARF código 6015.", "Stocks: 15%, exempt if monthly sales total up to R$ 20k. ETF/BDR: 15%. REIT: 20%. Losses offset future gains in the same group. DARF code 6015.")}
          {view.historyFrom && L(` Movimentações disponíveis desde ${br(view.historyFrom)}.`, ` Transactions available since ${br(view.historyFrom)}.`)}
          {view.approx && L(" Parte do custo médio veio da corretora (faltou o histórico de compras).", " Part of the average cost came from the broker (purchase history was missing).")}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="row"><FileText size={17} /> {L("Bens e Direitos", "Assets and rights")} ({view.bens.length})</h2>
          {view.bensAsOf && <span className="muted small">{L("posição de", "position as of")} {br(view.bensAsOf)}</span>}
        </div>
        <div className="table-wrap">
          <table className="mc">
            <thead><tr><th>{L("Tipo", "Type")}</th><th>{L("Discriminação (copie para a declaração)", "Description (copy into the return)")}</th><th className="right">{L("Situação em 31/12 (custo)", "Value on Dec 31 (cost)")}</th></tr></thead>
            <tbody>
              {view.bens.map((b, i) => (
                <tr key={`${b.itemId}-${i}`}>
                  <td className="small ga-side">{KIND(b.kind)}</td>
                  <td className="small ga-main">
                    {b.text}{" "}
                    <button className="btn icon sm ghost" title={L("Copiar", "Copy")} onClick={() => copy(`${b.itemId}-${i}`, b.text)}><Copy size={13} /></button>
                    {copied === `${b.itemId}-${i}` && <span className="muted"> {L("copiado", "copied")}</span>}
                  </td>
                  <td className="right num ga-val">{b.cost != null ? amt(b.cost) : <span className="muted">{L("sem custo", "no cost")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>{L("Na declaração, o valor é o custo de aquisição (o que você pagou), não o valor de mercado. O grupo/código de cada tipo está no checklist da IA abaixo.", "In the return, the value is the acquisition cost (what you paid), not the market value. Each type's group/code is in the AI checklist below.")}</p>
      </div>

      {view.income.items.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><h2>{L("Proventos recebidos", "Income received")} ({view.income.items.length})</h2></div>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
            <table className="mc">
              <tbody>
                {view.income.items.map((i, k) => (
                  <tr key={k}><td className="small">{br(i.date)}</td><td className="small">{i.description}</td><td className="small">{i.kind === "jcp" ? "JCP" : L("isento", "exempt")}</td><td className="right num">{amt(i.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2 className="row"><Sparkles size={17} /> {L("Checklist da declaração", "Return checklist")}</h2>
          <button className="btn sm primary" disabled={advice.running || !config?.hasCredentials} onClick={() => advice.start({ year })}>
            <Sparkles size={14} /> {tip ? L("Refazer com IA", "Redo with AI") : L("Montar com IA", "Build with AI")}
          </button>
        </div>
        {advice.running && <JobProgress job={advice} onCancel={advice.cancel} />}
        {advice.error && <Banner kind="bad">{advice.error}</Banner>}
        {tip ? (
          <>
            <div className="prose small">{tip.text}</div>
            <p className="muted small" style={{ marginTop: 8 }}>{L("Escrito pela IA em", "Written by the AI on")} {new Date(tip.at).toLocaleString(locale())}. {L("Não substitui um contador.", "Not a substitute for an accountant.")}</p>
          </>
        ) : (
          !advice.running && <p className="muted small">{L("A IA pesquisa a tabela de códigos vigente e diz onde lançar cada investimento, provento e DARF — com o que conferir.", "The AI looks up the current code table and says where to enter each investment, income and DARF — and what to double-check.")}</p>
        )}
      </div>
    </>
  );
}
