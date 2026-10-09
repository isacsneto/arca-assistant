import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Radar } from "lucide-react";
import { CLASS_META } from "../../shared/types";
import { computeAllocation, rebalance, targetsSum } from "../../shared/arca";
import { useStore } from "../store";
import { brl, pct } from "../lib/format";
import { Banner, ClassLabel, Empty, PageHead } from "./ui";

export function Rebalance({ goScan }: { goScan: () => void }) {
  const { state } = useStore();
  const { settings, positions, scans } = state!;
  const [contribution, setContribution] = useState("5000");
  const [allowSell, setAllowSell] = useState(false);

  const alloc = useMemo(() => computeAllocation(positions, settings.usdBrl), [positions, settings.usdBrl]);
  const amount = Math.max(Number(contribution) || 0, 0);
  const lines = useMemo(() => rebalance(alloc, settings.targets, amount, allowSell), [alloc, settings.targets, amount, allowSell]);
  const sum = targetsSum(settings.targets);

  if (alloc.arcaTotal <= 0 && amount <= 0)
    return (
      <>
        <PageHead title="Rebalancear" />
        <div className="card"><Empty title="Sem dados para rebalancear">Importe suas posições primeiro.</Empty></div>
      </>
    );

  return (
    <>
      <PageHead
        title="Rebalancear"
        subtitle="Quanto colocar (ou tirar) em cada classe para voltar às metas da Arca."
      />
      {Math.round(sum) !== 100 && <Banner kind="warn">As metas somam {pct(sum, 0)} — ajuste em Ajustes para somarem 100%.</Banner>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ alignItems: "flex-end", gap: 20 }}>
          <label className="field" style={{ width: 220 }}>
            Novo aporte (R$)
            <input type="number" min="0" step="100" value={contribution} onChange={(e) => setContribution(e.target.value)} />
          </label>
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={allowSell} onChange={(e) => setAllowSell(e.target.checked)} />
            Permitir vendas para atingir a meta exata
          </label>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {allowSell
            ? "Modo completo: cada classe vai exatamente à meta, vendendo o excedente (atenção a impostos sobre ganho de capital)."
            : "Modo só-aporte: o dinheiro novo vai para as classes abaixo da meta, proporcionalmente ao que falta. Nada é vendido."}
        </p>
      </div>

      <div className="stack">
        {lines.map((l) => {
          const buy = l.trade > 0.005;
          const sell = l.trade < -0.005;
          const scan = scans[l.assetClass];
          return (
            <div className="card" key={l.assetClass}>
              <div className="row spread wrap">
                <h2><ClassLabel c={l.assetClass} /></h2>
                <div className="row">
                  {buy && <span className="chip ok"><ArrowUpRight size={14} /> Comprar {brl(l.trade)}</span>}
                  {sell && <span className="chip bad"><ArrowDownRight size={14} /> Vender {brl(-l.trade)}</span>}
                  {!buy && !sell && <span className="chip">Sem movimento</span>}
                </div>
              </div>
              <div className="grid kpis" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                <div className="kpi"><div className="label">Hoje</div><div className="num"><b>{brl(l.current)}</b></div></div>
                <div className="kpi"><div className="label">Meta ({pct(settings.targets[l.assetClass], 0)})</div><div className="num"><b>{brl(l.ideal)}</b></div></div>
                <div className="kpi"><div className="label">Depois</div><div className="num"><b>{brl(l.after)}</b> <span className="muted">· {pct(l.afterPct)}</span></div></div>
              </div>
              {buy && (
                <div style={{ marginTop: 14 }}>
                  {scan && scan.picks.length > 0 ? (
                    <>
                      <div className="muted small" style={{ marginBottom: 6 }}>
                        Sugestão de divisão usando o último scan ({new Date(scan.runAt).toLocaleDateString("pt-BR")}):
                      </div>
                      <div className="table-wrap">
                        <table>
                          <tbody>
                            {scan.picks.map((p) => {
                              const totalW = scan.picks.reduce((s, x) => s + x.suggestedWeightInClass, 0) || 1;
                              return (
                                <tr key={p.ticker + p.rank}>
                                  <td><b>{p.ticker}</b> <span className="muted">{p.name}</span></td>
                                  <td className="right num muted">{pct((p.suggestedWeightInClass / totalW) * 100, 0)}</td>
                                  <td className="right num"><b>{brl((p.suggestedWeightInClass / totalW) * l.trade)}</b></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <button className="btn sm" onClick={goScan}><Radar size={14} /> Rodar scan de {CLASS_META[l.assetClass].label} para sugerir onde aportar</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
