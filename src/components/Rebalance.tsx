import { useMemo, useState } from "react";
import { CURRENCIES } from "../../shared/currency";
import { ArrowDownRight, ArrowUpRight, Radar } from "lucide-react";
import { CLASS_META, METHODOLOGIES } from "../../shared/types";
import { VIEW_LABEL } from "../../shared/owner";
import { computeAllocation, rebalance, targetsSum } from "../../shared/arca";
import { useStore } from "../store";
import { amt, pct, displayCurrency, fromDisplay } from "../lib/format";
import { Banner, ClassLabel, Empty, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

export function Rebalance({ goScan }: { goScan: () => void }) {
  const { state, visible: positions, view } = useStore();
  const { settings, scans } = state!;
  const [contribution, setContribution] = useState("5000");
  const [allowSell, setAllowSell] = useState(false);

  const alloc = useMemo(() => computeAllocation(positions, settings.fx), [positions, settings.fx]);
  // O aporte é digitado na moeda de exibição; o cálculo é na moeda base.
  const amount = fromDisplay(Math.max(Number(contribution) || 0, 0));
  const lines = useMemo(() => rebalance(alloc, settings.targets, amount, allowSell), [alloc, settings.targets, amount, allowSell]);
  const sum = targetsSum(settings.targets);

  if (alloc.arcaTotal <= 0 && amount <= 0)
    return (
      <>
        <PageHead title={L("Rebalancear", "Rebalance")} />
        <div className="card"><Empty title={L("Sem dados para rebalancear", "No data to rebalance")}>{L("Importe suas posições primeiro.", "Import your positions first.")}</Empty></div>
      </>
    );

  return (
    <>
      <PageHead
        title={view === "all" ? L("Rebalancear", "Rebalance") : L("Rebalancear", "Rebalance") + " · " + view}
        subtitle={L(
          (view === "all" ? "Carteira consolidada (PF + PJ)" : "Só " + VIEW_LABEL[view].toLowerCase()) + " — quanto colocar (ou tirar) em cada classe para voltar às metas (" + (settings.methodology === "custom" ? "personalizada" : METHODOLOGIES[settings.methodology].label) + ").",
          (view === "all" ? "All portfolios (PF + PJ)" : "Only " + view) + " — how much to put in (or take out of) each class to get back to the targets (" + (settings.methodology === "custom" ? "custom" : METHODOLOGIES[settings.methodology].label) + ").",
        )}
      />
      {Math.round(sum) !== 100 && <Banner kind="warn">{L(`As metas somam ${pct(sum, 0)} — ajuste em Ajustes para somarem 100%.`, `Targets add up to ${pct(sum, 0)} — adjust them in Settings so they add up to 100%.`)}</Banner>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ alignItems: "flex-end", gap: 20 }}>
          <label className="field" style={{ width: 220 }}>
            {L("Novo aporte", "New contribution")} ({CURRENCIES[displayCurrency()].symbol})
            <input type="number" min="0" step="100" value={contribution} onChange={(e) => setContribution(e.target.value)} />
          </label>
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={allowSell} onChange={(e) => setAllowSell(e.target.checked)} />
            {L("Permitir vendas para atingir a meta exata", "Allow selling to hit the exact target")}
          </label>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {allowSell
            ? L("Modo completo: cada classe vai exatamente à meta, vendendo o excedente (atenção a impostos sobre ganho de capital).", "Full mode: every class goes exactly to its target, selling the excess (mind capital gains taxes).")
            : L("Modo só-aporte: o dinheiro novo vai para as classes abaixo da meta, proporcionalmente ao que falta. Nada é vendido.", "Contribution-only mode: new money goes to the classes below target, in proportion to what is missing. Nothing is sold.")}
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
                  {buy && <span className="chip ok"><ArrowUpRight size={14} /> {L("Comprar", "Buy")} {amt(l.trade)}</span>}
                  {sell && <span className="chip bad"><ArrowDownRight size={14} /> {L("Vender", "Sell")} {amt(-l.trade)}</span>}
                  {!buy && !sell && <span className="chip">{L("Sem movimento", "No change")}</span>}
                </div>
              </div>
              <div className="grid kpis" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                <div className="kpi"><div className="label">{L("Hoje", "Today")}</div><div className="num"><b>{amt(l.current)}</b></div></div>
                <div className="kpi"><div className="label">{L("Meta", "Target")} ({pct(settings.targets[l.assetClass], 0)})</div><div className="num"><b>{amt(l.ideal)}</b></div></div>
                <div className="kpi"><div className="label">{L("Depois", "After")}</div><div className="num"><b>{amt(l.after)}</b> <span className="muted">· {pct(l.afterPct)}</span></div></div>
              </div>
              {buy && (
                <div style={{ marginTop: 14 }}>
                  {scan && scan.picks.length > 0 ? (
                    <>
                      <div className="muted small" style={{ marginBottom: 6 }}>
                        {L(
                          `Sugestão de divisão usando o último scan (${new Date(scan.runAt).toLocaleDateString(locale())}):`,
                          `Suggested split based on the latest scan (${new Date(scan.runAt).toLocaleDateString(locale())}):`,
                        )}
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
                                  <td className="right num"><b>{amt((p.suggestedWeightInClass / totalW) * l.trade)}</b></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <button className="btn sm" onClick={goScan}><Radar size={14} /> {L(`Rodar scan de ${CLASS_META[l.assetClass].label} para sugerir onde aportar`, `Run a ${CLASS_META[l.assetClass].label} scan to suggest where to invest`)}</button>
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
