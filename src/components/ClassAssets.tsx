import { X } from "lucide-react";
import { CLASS_META, type AssetClass, type Position } from "../../shared/types";
import { toBRL } from "../../shared/arca";
import { brl, pct } from "../lib/format";
import { ClassLabel } from "./ui";
import { L } from "../../shared/i18n";

/** Lista dos ativos de uma classe, com peso dentro da classe — aberta ao clicar na categoria. */
export function ClassAssets({
  assetClass,
  positions,
  usdBrl,
  showOwner,
  onClose,
}: {
  assetClass: AssetClass;
  positions: Position[];
  usdBrl: number;
  showOwner: boolean;
  onClose: () => void;
}) {
  const items = positions
    .filter((p) => p.assetClass === assetClass)
    .map((p) => ({ p, v: toBRL(p, usdBrl) }))
    .sort((a, b) => b.v - a.v);
  const total = items.reduce((s, x) => s + x.v, 0);
  const color = CLASS_META[assetClass].color;

  return (
    <div className="drill">
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div className="row">
          <ClassLabel c={assetClass} />
          <span className="muted small">· {L(`${items.length} ativo${items.length === 1 ? "" : "s"}`, `${items.length} asset${items.length === 1 ? "" : "s"}`)} · {brl(total)}</span>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} title={L("Fechar", "Close")} aria-label={L("Fechar lista", "Close list")}>
          <X size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">{L("Nenhum ativo nesta classe.", "No assets in this class.")}</p>
      ) : (
        <div className="table-wrap">
          <table className="mc t-cls">
            <tbody>
              {items.map(({ p, v }) => {
                const share = total > 0 ? (v / total) * 100 : 0;
                return (
                  <tr key={p.id}>
                    <td className="ga-main" style={{ minWidth: 180 }}>
                      <b>{p.ticker ? `${p.ticker} · ` : ""}{p.name}</b>
                      <div className="muted small">
                        {p.institution}
                        {showOwner && <> · <span className={`chip owner-${p.owner}`}>{p.owner}</span></>}
                        {p.subtype ? ` · ${p.subtype}` : ""}
                      </div>
                    </td>
                    <td className="ga-a" style={{ width: "34%", minWidth: 120 }}>
                      <div className="bar" style={{ height: 8 }} title={L(`${pct(share)} da classe`, `${pct(share)} of the class`)}>
                        <div className="fill" style={{ width: `${share}%`, background: color }} />
                      </div>
                    </td>
                    <td className="right num muted ga-side" style={{ width: 70 }}>{pct(share)}</td>
                    <td className="right num ga-val" style={{ width: 130 }}><b>{brl(v)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
