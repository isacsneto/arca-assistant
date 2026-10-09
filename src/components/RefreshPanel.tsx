import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import type { RefreshLine, RefreshResult } from "../../shared/types";
import { applyRefresh, isChange } from "../../shared/refreshApply";
import { toBRL } from "../../shared/arca";
import { useStore } from "../store";
import type { Job } from "../lib/useJob";
import { brl, dateTime, money, safeUrl } from "../lib/format";
import { Banner } from "./ui";
import { JobProgress } from "./JobProgress";

const METHOD: Record<RefreshLine["method"], { label: string; cls: string }> = {
  cotacao: { label: "cotação", cls: "ok" },
  indexador: { label: "indexador", cls: "warn" },
  mantido: { label: "mantido", cls: "" },
};

/** Revisão do "Atualizar valores": mostra antes/depois e aplica só o que o usuário aprovar. */
export function RefreshPanel({ job }: { job: Job<RefreshResult> }) {
  const { state, update } = useStore();
  const result = job.result;
  const [approved, setApproved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (result) setApproved(new Set(result.lines.filter(isChange).map((l) => l.id)));
  }, [result]);

  const usdNew = result?.usdBrl ?? state!.settings.usdBrl;
  const totals = useMemo(() => {
    if (!result) return null;
    const usdOld = state!.settings.usdBrl;
    let before = 0;
    let after = 0;
    for (const l of result.lines) {
      before += toBRL({ value: l.oldValue, currency: l.currency }, usdOld);
      const v = approved.has(l.id) ? l.newValue : l.oldValue;
      after += toBRL({ value: v, currency: l.currency }, usdNew);
    }
    return { before, after };
  }, [result, approved, state, usdNew]);

  if (job.running) return <JobProgress job={job} onCancel={job.cancel} />;
  if (job.error && !result) return <Banner kind="bad">Falha ao atualizar valores: {job.error}</Banner>;
  if (!result || !totals) return null;

  const changed = result.lines.filter(isChange);
  const apply = () => {
    const now = new Date().toISOString();
    update((s) => ({
      ...s,
      positions: applyRefresh(s.positions, result.lines, approved, now),
      settings: result.usdBrl ? { ...s.settings, usdBrl: Math.round(result.usdBrl * 10000) / 10000 } : s.settings,
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
          <h2>Valores atualizados</h2>
          <p className="muted small">
            {dateTime(result.runAt)} · {changed.length} de {result.lines.length} posições mudaram
            {result.usdBrl ? ` · dólar R$ ${result.usdBrl.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}` : ""}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={job.clear}><X size={15} /> Descartar</button>
          <button className="btn primary" onClick={apply}><Check size={15} /> Aplicar {approved.size}</button>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="label">Antes</div><div className="value num" style={{ fontSize: 20 }}>{brl(totals.before)}</div></div>
        <div className="kpi"><div className="label">Depois</div><div className="value num" style={{ fontSize: 20 }}>{brl(totals.after)}</div></div>
        <div className="kpi">
          <div className="label">Variação</div>
          <div className="value num" style={{ fontSize: 20, color: diff >= 0 ? "var(--ok)" : "var(--bad)" }}>
            {diff >= 0 ? "+" : "−"}{brl(Math.abs(diff))}
          </div>
          <div className="sub">{totals.before > 0 ? `${((diff / totals.before) * 100).toFixed(2).replace(".", ",")}%` : ""}</div>
        </div>
      </div>

      {job.error && <Banner kind="warn">{job.error}</Banner>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th /><th>Ativo</th><th className="right">Antes</th><th className="right">Agora</th><th>Como</th></tr>
          </thead>
          <tbody>
            {result.lines.map((l) => {
              const change = isChange(l);
              const pct = l.oldValue > 0 ? ((l.newValue - l.oldValue) / l.oldValue) * 100 : 0;
              const href = l.source ? safeUrl(l.source) : null;
              return (
                <tr key={l.id} style={{ opacity: change && !approved.has(l.id) ? 0.5 : 1 }}>
                  <td>
                    <input type="checkbox" disabled={!change} checked={approved.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Aplicar ${l.name}`} />
                  </td>
                  <td style={{ minWidth: 200 }}>
                    <b>{l.name}</b>
                    <div className="muted small">
                      {l.note}
                      {l.source && (href ? <> · <a href={href} target="_blank" rel="noreferrer noopener">fonte</a></> : ` · ${l.source}`)}
                    </div>
                  </td>
                  <td className="right num muted">{money(l.oldValue, l.currency)}</td>
                  <td className="right num">
                    <b>{money(l.newValue, l.currency)}</b>
                    {change && (
                      <div className="small" style={{ color: pct >= 0 ? "var(--ok)" : "var(--bad)" }}>
                        {pct >= 0 ? "+" : ""}{pct.toFixed(2).replace(".", ",")}%
                      </div>
                    )}
                  </td>
                  <td><span className={`chip ${METHOD[l.method].cls}`}>{METHOD[l.method].label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.ratesUsed && <p className="muted small" style={{ marginTop: 10 }}>Taxas de referência: {result.ratesUsed}</p>}
      <p className="muted small" style={{ marginTop: 6 }}>
        Cotação = preço de mercado (Yahoo Finance). Indexador = estimativa do Claude acumulando CDI/Selic/IPCA desde a última atualização (valor bruto, antes de IR).
        Saldos em conta são mantidos. Para o valor exato de renda fixa, importe um print novo do banco.
      </p>
    </div>
  );
}
