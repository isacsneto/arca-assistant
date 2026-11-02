import { useEffect, useState } from "react";
import { Landmark, Plus, Sparkles, Trash2 } from "lucide-react";
import { planningOf, type Debt, type Planning } from "../../shared/planning";
import type { AmortizeVerdict, DebtRow } from "../../shared/debts";
import { api } from "../api";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt, amt0, uid } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

export interface DebtsResponse {
  rows: (DebtRow & AmortizeVerdict)[];
  reference: { cdiPct: number | null; netPct: number | null };
  netWorth: { investments: number; physical: number; debts: number; net: number };
  monthly: number;
}

const VERDICT = (): Record<AmortizeVerdict["verdict"], [string, string]> => ({
  amortizar: [L("amortizar compensa", "prepaying pays off"), "warn"],
  investir: [L("investir rende mais", "investing earns more"), "ok"],
  empate: [L("praticamente empate", "roughly even"), ""],
  "sem-taxa": [L("informe os juros", "add the rate"), ""],
});

/** Dívidas e patrimônio líquido: empréstimos do Open Finance + cadastrados, e "amortizar ou investir?". */
export function DebtsView() {
  const { state, update, config, savedAt } = useStore();
  const planning = planningOf(state!.planning);
  const [data, setData] = useState<DebtsResponse | null>(null);
  const [adding, setAdding] = useState(false);
  const [advice, setAdvice] = useState<{ text: string; at: string } | null>(null);
  const setPlanning = (fn: (p: Planning) => Planning) => update((s) => ({ ...s, planning: fn(planningOf(s.planning)) }));
  const job = useJob<{ text: string; at: string }>("/api/debts/advice", setAdvice);

  useEffect(() => {
    api.debts().then(setData).catch(() => setData(null));
  }, [state?.rev, savedAt]);

  return (
    <>
      <PageHead
        title={L("Dívidas", "Debts")}
        subtitle={L("Empréstimos e financiamentos (do Open Finance e cadastrados por você), o patrimônio líquido e se compensa amortizar ou investir.", "Loans and financing (from Open Finance and added by you), your net worth and whether to prepay or invest.")}
        actions={<button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> {L("Cadastrar dívida", "Add debt")}</button>}
      />

      {data && (
        <div className="grid kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{L("Patrimônio líquido", "Net worth")}</div><div className="value num">{amt0(data.netWorth.net)}</div>
            <div className="sub">{L("investimentos", "investments")} {amt0(data.netWorth.investments)} + {L("bens", "assets")} {amt0(data.netWorth.physical)} − {L("dívidas", "debts")} {amt0(data.netWorth.debts)}</div></div>
          <div className="kpi"><div className="label">{L("Dívidas", "Debts")}</div><div className="value num" style={{ color: data.netWorth.debts > 0 ? "var(--bad)" : undefined }}>{amt0(data.netWorth.debts)}</div>
            <div className="sub">{data.rows.length} {L("contratos", "contracts")}{data.monthly > 0 ? ` · ${amt0(data.monthly)}/${L("mês", "mo")}` : ""}</div></div>
          <div className="kpi"><div className="label">{L("Referência para investir", "Investing benchmark")}</div><div className="value num">{data.reference.netPct != null ? `${data.reference.netPct.toLocaleString(locale(), { maximumFractionDigits: 2 })}%` : "—"}</div>
            <div className="sub">{L("CDI", "CDI")} {data.reference.cdiPct?.toLocaleString(locale(), { maximumFractionDigits: 2 }) ?? "—"}% {L("a.a. menos 15% de IR", "p.a. minus 15% tax")}</div></div>
        </div>
      )}

      {adding && <DebtForm onSave={(d) => { setPlanning((p) => ({ ...p, debts: [...p.debts, d] })); setAdding(false); }} onCancel={() => setAdding(false)} />}

      {data && data.rows.length === 0 && !adding && (
        <Banner kind="ok">{L("Nenhuma dívida: nem no Open Finance, nem cadastrada. O patrimônio líquido é o total investido mais os bens.", "No debts: none from Open Finance and none added. Net worth is your investments plus assets.")}</Banner>
      )}

      {data && data.rows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="table-wrap">
            <table className="mc">
              <thead><tr><th>{L("Dívida", "Debt")}</th><th className="right">{L("Saldo", "Balance")}</th><th className="right">{L("Juros a.a.", "Rate p.a.")}</th><th className="right">{L("Parcela", "Installment")}</th><th>{L("Amortizar ou investir?", "Prepay or invest?")}</th><th /></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const [label, cls] = VERDICT()[r.verdict];
                  return (
                    <tr key={r.id}>
                      <td className="ga-main"><b>{r.name}</b><div className="muted small">{r.institution ?? L("cadastrada", "added by you")} · {r.owner}{r.remaining ? ` · ${L("faltam", "remaining")} ${r.remaining}` : ""}</div></td>
                      <td className="right num ga-val">{amt(r.balance)}</td>
                      <td className="right num ga-side">{r.ratePct != null ? `${r.ratePct.toLocaleString(locale(), { maximumFractionDigits: 2 })}%` : "—"}</td>
                      <td className="right num ga-side">{r.installment ? amt(r.installment) : "—"}</td>
                      <td className="ga-a">
                        <span className={`chip ${cls}`}>{label}</span>
                        {r.per10kYear != null && <div className="muted small">{r.per10kYear >= 0 ? L(`economiza ~${amt0(r.per10kYear)}/ano a cada R$ 10 mil`, `saves ~${amt0(r.per10kYear)}/yr per R$ 10k`) : L(`investindo, ~${amt0(-r.per10kYear)}/ano a mais a cada R$ 10 mil`, `investing earns ~${amt0(-r.per10kYear)}/yr more per R$ 10k`)}</div>}
                      </td>
                      <td className="ga-act">{r.source === "manual" && <button className="btn icon sm ghost" title={L("Excluir", "Delete")} onClick={() => setPlanning((p) => ({ ...p, debts: p.debts.filter((d) => d.id !== r.id) }))}><Trash2 size={14} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>{L("Comparação simples: juro da dívida contra o CDI líquido de IR. Antes de amortizar, mantenha a reserva de emergência.", "Simple comparison: the debt's rate against CDI net of tax. Keep your emergency fund before prepaying.")}</p>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2 className="row"><Sparkles size={17} /> {L("Amortizar × investir", "Prepay × invest")}</h2>
            <button className="btn sm primary" disabled={job.running || !config?.hasCredentials} onClick={() => job.start()}><Sparkles size={14} /> {L("Simular com IA", "Simulate with AI")}</button>
          </div>
          {job.running && <JobProgress job={job} onCancel={job.cancel} />}
          {job.error && <Banner kind="bad">{job.error}</Banner>}
          {advice ? <div className="prose small">{advice.text}</div> : !job.running && <p className="muted small">{L("A IA considera SAC/Price, prazo × parcela, sua reserva e a sobra mensal.", "The AI considers amortization schedules, term × installment, your emergency fund and monthly surplus.")}</p>}
        </div>
      )}
      {planning.debts.length === 0 && data?.rows.some((r) => r.source === "openfinance") && (
        <p className="muted small" style={{ marginTop: 10 }}><Landmark size={12} /> {L("Empréstimos do Open Finance atualizam sozinhos (1x por dia).", "Open Finance loans update on their own (once a day).")}</p>
      )}
    </>
  );
}

function DebtForm({ onSave, onCancel }: { onSave: (d: Debt) => void; onCancel: () => void }) {
  const [d, setD] = useState<Debt>({ id: uid(), name: "", balance: 0, ratePct: null, installment: null, remaining: null, owner: "PF" });
  const set = (patch: Partial<Debt>) => setD((x) => ({ ...x, ...patch }));
  const n = (v: string) => (v === "" ? null : Number(v));
  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); if (d.name.trim() && d.balance > 0) onSave({ ...d, name: d.name.trim() }); }}>
      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="field grow" style={{ minWidth: 200 }}>{L("Nome", "Name")}<input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={L("ex.: Financiamento do apartamento", "e.g. Home mortgage")} /></label>
        <label className="field">{L("Saldo devedor", "Balance")}<input type="number" min={0} step={100} value={d.balance || ""} onChange={(e) => set({ balance: Number(e.target.value) })} /></label>
        <label className="field">{L("Juros % a.a.", "Rate % p.a.")}<input type="number" step={0.01} value={d.ratePct ?? ""} onChange={(e) => set({ ratePct: n(e.target.value) })} /></label>
        <label className="field">{L("Parcela", "Installment")}<input type="number" step={10} value={d.installment ?? ""} onChange={(e) => set({ installment: n(e.target.value) })} /></label>
        <label className="field">{L("Parcelas restantes", "Remaining")}<input type="number" step={1} value={d.remaining ?? ""} onChange={(e) => set({ remaining: n(e.target.value) })} /></label>
        <label className="field">{L("Titular", "Owner")}<select value={d.owner} onChange={(e) => set({ owner: e.target.value as "PF" | "PJ" })}><option>PF</option><option>PJ</option></select></label>
        <button className="btn primary" disabled={!d.name.trim() || !(d.balance > 0)}>{L("Salvar", "Save")}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>{L("Cancelar", "Cancel")}</button>
      </div>
    </form>
  );
}
