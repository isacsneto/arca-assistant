import { useEffect, useMemo, useState } from "react";
import { fxSummary } from "../../shared/currency";
import { Check, X } from "lucide-react";
import type { RefreshLine, RefreshResult } from "../../shared/types";
import { applyRefresh, isChange } from "../../shared/refreshApply";
import { toBRL } from "../../shared/arca";
import { useStore } from "../store";
import type { Job } from "../lib/useJob";
import { amt, dateTime, money, safeUrl } from "../lib/format";
import { Banner } from "./ui";
import { JobProgress } from "./JobProgress";
import { L, locale } from "../../shared/i18n";

const METHOD = (): Record<RefreshLine["method"], { label: string; cls: string }> => ({
  cotacao: { label: L("cotação", "quote"), cls: "ok" },
  indexador: { label: L("indexador", "index accrual"), cls: "warn" },
  mantido: { label: L("mantido", "kept"), cls: "" },
  openfinance: { label: "Open Finance", cls: "ok" },
  removido: { label: L("saiu", "removed"), cls: "bad" },
});

/** Revisão do "Atualizar valores": mostra antes/depois e aplica só o que o usuário aprovar. */
export function RefreshPanel({ job }: { job: Job<RefreshResult> }) {
  const { state, update } = useStore();
  const result = job.result;
  const [approved, setApproved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (result) setApproved(new Set(result.lines.filter(isChange).map((l) => l.id)));
  }, [result]);

  const fxNew = { ...state!.settings.fx, ...result?.fx };
  const totals = useMemo(() => {
    if (!result) return null;
    const fxOld = state!.settings.fx;
    let before = 0;
    let after = 0;
    for (const l of result.lines) {
      before += toBRL({ value: l.oldValue, currency: l.currency }, fxOld);
      const v = approved.has(l.id) ? l.newValue : l.oldValue;
      after += toBRL({ value: v, currency: l.currency }, fxNew);
    }
    return { before, after };
  }, [result, approved, state]);

  if (job.running) return <JobProgress job={job} onCancel={job.cancel} />;
  if (job.error && !result) return <Banner kind="bad">{L("Falha ao atualizar valores:", "Failed to update values:")} {job.error}</Banner>;
  if (!result || !totals) return null;

  const changed = result.lines.filter(isChange);
  const apply = () => {
    const now = new Date().toISOString();
    update((s) => ({
      ...s,
      positions: applyRefresh(s.positions, result.lines, approved, now),
      settings: result.fx ? { ...s.settings, fx: { ...s.settings.fx, ...result.fx } } : s.settings,
    }));
    job.clear();
  };
  const toggle = (id: string) =>
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const diff = totals.after - totals.before;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <h2>{L("Valores atualizados", "Updated values")}</h2>
          <p className="muted small">
            {dateTime(result.runAt)} · {L(`${changed.length} de ${result.lines.length} posições mudaram`, `${changed.length} of ${result.lines.length} positions changed`)}
            {result.fx ? ` · ${fxSummary(result.fx)}` : ""}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={job.clear}><X size={15} /> {L("Descartar", "Discard")}</button>
          <button className="btn primary" onClick={apply}><Check size={15} /> {L("Aplicar", "Apply")} {approved.size}</button>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="label">{L("Antes", "Before")}</div><div className="value num" style={{ fontSize: 20 }}>{amt(totals.before)}</div></div>
        <div className="kpi"><div className="label">{L("Depois", "After")}</div><div className="value num" style={{ fontSize: 20 }}>{amt(totals.after)}</div></div>
        <div className="kpi">
          <div className="label">{L("Variação", "Change")}</div>
          <div className="value num" style={{ fontSize: 20, color: diff >= 0 ? "var(--ok)" : "var(--bad)" }}>
            {diff >= 0 ? "+" : "−"}{amt(Math.abs(diff))}
          </div>
          <div className="sub">{totals.before > 0 ? `${((diff / totals.before) * 100).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : ""}</div>
        </div>
      </div>

      {job.error && <Banner kind="warn">{job.error}</Banner>}
      {result.warnings?.map((w) => <Banner kind="warn" key={w}>{w}</Banner>)}

      <div className="table-wrap">
        <table className="mc t-refresh">
          <thead>
            <tr><th /><th>{L("Ativo", "Asset")}</th><th className="right">{L("Antes", "Before")}</th><th className="right">{L("Agora", "Now")}</th><th>{L("Como", "How")}</th></tr>
          </thead>
          <tbody>
            {result.lines.map((l) => {
              const change = isChange(l);
              const pct = l.oldValue > 0 ? ((l.newValue - l.oldValue) / l.oldValue) * 100 : 0;
              const href = l.source ? safeUrl(l.source) : null;
              return (
                <tr key={l.id} style={{ opacity: change && !approved.has(l.id) ? 0.5 : 1 }}>
                  <td className="ga-chk">
                    <input type="checkbox" disabled={!change} checked={approved.has(l.id)} onChange={() => toggle(l.id)} aria-label={L(`Aplicar ${l.name}`, `Apply ${l.name}`)} />
                  </td>
                  <td className="ga-main" style={{ minWidth: 200 }}>
                    <b>{l.name}</b>
                    <div className="muted small">
                      {l.note}
                      {l.source && (href ? <> · <a href={href} target="_blank" rel="noreferrer noopener">{L("fonte", "source")}</a></> : ` · ${l.source}`)}
                    </div>
                  </td>
                  <td className="right num muted ga-side" data-l={L("antes", "before")}>{money(l.oldValue, l.currency)}</td>
                  <td className="right num ga-val">
                    <b>{money(l.newValue, l.currency)}</b>
                    {change && !l.add && l.method !== "removido" && (
                      <div className="small" style={{ color: pct >= 0 ? "var(--ok)" : "var(--bad)" }}>
                        {pct >= 0 ? "+" : ""}{pct.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                      </div>
                    )}
                  </td>
                  <td className="ga-a"><span className={`chip ${METHOD()[l.method].cls}`}>{l.add ? L("novo", "new") : METHOD()[l.method].label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.ratesUsed && <p className="muted small" style={{ marginTop: 10 }}>{L("Taxas de referência:", "Reference rates:")} {result.ratesUsed}</p>}
      <p className="muted small" style={{ marginTop: 6 }}>
        {L(
          "Cotação = preço de mercado (Yahoo Finance). Indexador = estimativa da IA acumulando CDI/Selic/IPCA desde a última atualização (valor bruto, antes de IR). Open Finance = valor líquido informado pelo banco (instituições conectadas): ativos novos entram e os que não vieram saem. Saldos em conta são mantidos. Para o valor exato de renda fixa, importe um print novo do banco.",
          "Quote = market price (Yahoo Finance). Index accrual = AI estimate accruing CDI/Selic/IPCA since the last update (gross value, before income tax). Open Finance = net value reported by the bank (connected institutions): new assets are added and those not returned are removed. Account balances are kept. For the exact fixed income value, import a new screenshot from your bank.",
        )}
      </p>
    </div>
  );
}
