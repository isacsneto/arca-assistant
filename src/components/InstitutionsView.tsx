import { useMemo, useState } from "react";
import { ChevronRight, Landmark } from "lucide-react";
import { ALL_CLASSES, CLASS_META, type AssetClass, type Owner, type Position } from "../../shared/types";
import { toBRL } from "../../shared/arca";
import { VIEW_LABEL } from "../../shared/owner";
import { useStore } from "../store";
import { brl, pct } from "../lib/format";
import { ClassDot, Empty, PageHead } from "./ui";

interface Group {
  key: string;
  institution: string;
  owners: Owner[];
  total: number;
  byClass: Partial<Record<AssetClass, number>>;
  items: { p: Position; v: number }[];
}

/** Onde está cada investimento: agrupa por banco/corretora. */
export function InstitutionsView() {
  const { state, visible, view } = useStore();
  const usd = state!.settings.usdBrl;
  const [open, setOpen] = useState<string | null>(null);
  const [splitOwner, setSplitOwner] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const p of visible) {
      const key = splitOwner ? `${p.institution}|${p.owner}` : p.institution;
      const g = map.get(key) ?? { key, institution: p.institution, owners: [], total: 0, byClass: {}, items: [] };
      const v = toBRL(p, usd);
      g.total += v;
      g.byClass[p.assetClass] = (g.byClass[p.assetClass] ?? 0) + v;
      if (!g.owners.includes(p.owner)) g.owners.push(p.owner);
      g.items.push({ p, v });
      map.set(key, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, owners: g.owners.sort(), items: g.items.sort((a, b) => b.v - a.v) }))
      .sort((a, b) => b.total - a.total);
  }, [visible, usd, splitOwner]);

  const grand = groups.reduce((s, g) => s + g.total, 0);

  return (
    <>
      <PageHead
        title="Instituições"
        subtitle={`Em que banco ou corretora cada investimento está${view === "all" ? "" : ` — ${VIEW_LABEL[view].toLowerCase()}`}.`}
        actions={
          view === "all" && (
            <label className="check small">
              <input type="checkbox" checked={splitOwner} onChange={(e) => setSplitOwner(e.target.checked)} />
              Separar PF e PJ da mesma instituição
            </label>
          )
        }
      />

      {groups.length === 0 ? (
        <div className="card"><Empty title="Nenhum investimento nesta visão" /></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Distribuição por instituição</h2><span className="muted small">{groups.length} instituições · {brl(grand)}</span></div>
            <div className="inst-bar" role="img" aria-label="Participação de cada instituição no total">
              {groups.map((g, i) => (
                <div key={g.key} style={{ width: `${(g.total / grand) * 100}%`, background: `var(--inst-${i % 6})` }} title={`${g.institution}: ${pct((g.total / grand) * 100)}`} />
              ))}
            </div>
          </div>

          <div className="stack">
            {groups.map((g, i) => {
              const isOpen = open === g.key;
              return (
                <div className="card inst" key={g.key}>
                  <button type="button" className="inst-head" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen}>
                    <ChevronRight size={16} className="chev" style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                    <span className="inst-swatch" style={{ background: `var(--inst-${i % 6})` }}><Landmark size={14} /></span>
                    <div className="grow">
                      <div className="row" style={{ gap: 6 }}>
                        <b>{g.institution}</b>
                        {g.owners.map((o) => <span key={o} className={`chip owner-${o}`}>{o}</span>)}
                      </div>
                      <div className="row wrap small muted" style={{ gap: 10, marginTop: 4 }}>
                        {ALL_CLASSES.filter((c) => g.byClass[c]).map((c) => (
                          <span key={c} className="row" style={{ gap: 5 }}><ClassDot c={c} />{CLASS_META[c].label} {pct(((g.byClass[c] ?? 0) / g.total) * 100, 0)}</span>
                        ))}
                      </div>
                    </div>
                    <div className="right">
                      <div className="num"><b>{brl(g.total)}</b></div>
                      <div className="muted small num">{pct((g.total / grand) * 100)} do total · {g.items.length} ativo{g.items.length === 1 ? "" : "s"}</div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table>
                        <thead><tr><th>Ativo</th><th>Classe</th>{view === "all" && <th>Titular</th>}<th className="right">Valor</th><th className="right">% na instituição</th></tr></thead>
                        <tbody>
                          {g.items.map(({ p, v }) => (
                            <tr key={p.id}>
                              <td><b>{p.ticker ? `${p.ticker} · ` : ""}{p.name}</b><div className="muted small">{p.subtype}</div></td>
                              <td><span className="row" style={{ gap: 6 }}><ClassDot c={p.assetClass} />{CLASS_META[p.assetClass].label}</span></td>
                              {view === "all" && <td><span className={`chip owner-${p.owner}`}>{p.owner}</span></td>}
                              <td className="right num">{brl(v)}</td>
                              <td className="right num muted">{pct((v / g.total) * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
