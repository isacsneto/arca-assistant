import { X } from "lucide-react";
import { CLASS_META, type AssetClass, type Position } from "../../shared/types";
import { toBRL } from "../../shared/arca";
import { brl, pct } from "../lib/format";
import { ClassLabel } from "./ui";

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
          <span className="muted small">· {items.length} ativo{items.length === 1 ? "" : "s"} · {brl(total)}</span>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} title="Fechar" aria-label="Fechar lista">
          <X size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">Nenhum ativo nesta classe.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {items.map(({ p, v }) => {
                const share = total > 0 ? (v / total) * 100 : 0;
                return (
                  <tr key={p.id}>
                    <td style={{ minWidth: 180 }}>
                      <b>{p.ticker ? `${p.ticker} · ` : ""}{p.name}</b>
                      <div className="muted small">
                        {p.institution}
                        {showOwner && <> · <span className={`chip owner-${p.owner}`}>{p.owner}</span></>}
                        {p.subtype ? ` · ${p.subtype}` : ""}
                      </div>
                    </td>
                    <td style={{ width: "34%", minWidth: 120 }}>
                      <div className="bar" style={{ height: 8 }} title={`${pct(share)} da classe`}>
                        <div className="fill" style={{ width: `${share}%`, background: color }} />
                      </div>
                    </td>
                    <td className="right num muted" style={{ width: 70 }}>{pct(share)}</td>
                    <td className="right num" style={{ width: 130 }}><b>{brl(v)}</b></td>
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
