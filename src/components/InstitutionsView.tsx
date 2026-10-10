import { useMemo, useState } from "react";
import { BellOff, BellRing, ChevronRight, Landmark } from "lucide-react";
import { isStale, markStale, unmarkStale } from "../../shared/reminders";
import { ALL_CLASSES, CLASS_META, type AssetClass, type Owner, type Position } from "../../shared/types";
import { toBRL } from "../../shared/arca";
import { VIEW_LABEL } from "../../shared/owner";
import { useStore } from "../store";
import { amt, pct } from "../lib/format";
import { ClassDot, Empty, PageHead } from "./ui";
import { L } from "../../shared/i18n";

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
  const { state, visible, view, update } = useStore();
  const staleList = state!.settings.staleInstitutions;

  /** Marca/desmarca a instituição como desatualizada para todos os titulares do grupo. */
  const toggleStale = (g: Group) => {
    const stale = g.owners.every((o) => isStale(state!.settings, g.institution, o));
    const now = new Date().toISOString();
    let list = staleList;
    for (const o of g.owners) list = stale ? unmarkStale(list, g.institution, o) : markStale(list, g.institution, o, now);
    update((st) => ({ ...st, settings: { ...st.settings, staleInstitutions: list } }));
  };
  const usd = state!.settings.fx;
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
        title={L("Instituições", "Institutions")}
        subtitle={L(
          `Em que banco ou corretora cada investimento está${view === "all" ? "" : ` — ${VIEW_LABEL[view].toLowerCase()}`}.`,
          `Which bank or broker holds each investment${view === "all" ? "" : ` — ${view}`}.`,
        )}
        actions={
          view === "all" && (
            <label className="check small">
              <input type="checkbox" checked={splitOwner} onChange={(e) => setSplitOwner(e.target.checked)} />
              {L("Separar PF e PJ da mesma instituição", "Split PF and PJ at the same institution")}
            </label>
          )
        }
      />

      {groups.length === 0 ? (
        <div className="card"><Empty title={L("Nenhum investimento nesta visão", "No investments in this view")} /></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>{L("Distribuição por instituição", "Breakdown by institution")}</h2><span className="muted small">{L(`${groups.length} instituições`, `${groups.length} institution${groups.length === 1 ? "" : "s"}`)} · {amt(grand)}</span></div>
            <div className="inst-bar" role="img" aria-label={L("Participação de cada instituição no total", "Share of each institution in the total")}>
              {groups.map((g, i) => (
                <div key={g.key} style={{ width: `${(g.total / grand) * 100}%`, background: `var(--inst-${i % 6})` }} title={`${g.institution}: ${pct((g.total / grand) * 100)}`} />
              ))}
            </div>
          </div>

          <div className="stack">
            {groups.map((g, i) => {
              const isOpen = open === g.key;
              return (
                <div className={"card inst" + (g.owners.some((o) => isStale(state!.settings, g.institution, o)) ? " is-stale" : "")} key={g.key}>
                  <div className="row inst-row" style={{ alignItems: "center", gap: 10 }}>
                  <button type="button" className="inst-head grow" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen}>
                    <ChevronRight size={16} className="chev" style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                    <span className="inst-swatch" style={{ background: `var(--inst-${i % 6})` }}><Landmark size={14} /></span>
                    <div className="grow inst-info">
                      <div className="row wrap" style={{ gap: 6 }}>
                        <b>{g.institution}</b>
                        {g.owners.map((o) => <span key={o} className={`chip owner-${o}`}>{o}</span>)}
                        {g.owners.some((o) => isStale(state!.settings, g.institution, o)) && <span className="chip stale"><BellRing size={11} /> {L("desatualizada", "outdated")}</span>}
                      </div>
                      <div className="row wrap small muted" style={{ gap: 10, marginTop: 4 }}>
                        {ALL_CLASSES.filter((c) => g.byClass[c]).map((c) => (
                          <span key={c} className="row" style={{ gap: 5 }}><ClassDot c={c} />{CLASS_META[c].label} {pct(((g.byClass[c] ?? 0) / g.total) * 100, 0)}</span>
                        ))}
                      </div>
                    </div>
                    <div className="right inst-total">
                      <div className="num"><b>{amt(g.total)}</b></div>
                      <div className="muted small num">{pct((g.total / grand) * 100)} {L("do total", "of total")} · {L(`${g.items.length} ativo${g.items.length === 1 ? "" : "s"}`, `${g.items.length} asset${g.items.length === 1 ? "" : "s"}`)}</div>
                    </div>
                  </button>
                  {(() => {
                    const stale = g.owners.every((o) => isStale(state!.settings, g.institution, o));
                    return (
                      <button type="button" className={"btn sm inst-stale" + (stale ? " stale-btn" : "")} onClick={() => toggleStale(g)}
                        title={stale ? L("Desmarcar: os valores já estão em dia", "Unmark: the values are up to date") : L("Pedir para atualizar esta instituição sempre que abrir o app", "Ask to update this institution every time you open the app")}>
                        {stale ? <><BellOff size={14} /> {L("Desmarcar", "Unmark")}</> : <><BellRing size={14} /> {L("Marcar desatualizada", "Mark outdated")}</>}
                      </button>
                    );
                  })()}
                  </div>
                  {isOpen && (
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table className="mc t-inst">
                        <thead><tr><th>{L("Ativo", "Asset")}</th><th>{L("Classe", "Class")}</th>{view === "all" && <th>{L("Titular", "Owner")}</th>}<th className="right">{L("Valor", "Value")}</th><th className="right">{L("% na instituição", "% of institution")}</th></tr></thead>
                        <tbody>
                          {g.items.map(({ p, v }) => (
                            <tr key={p.id}>
                              <td className="ga-main"><b>{p.ticker ? `${p.ticker} · ` : ""}{p.name}</b><div className="muted small">{p.subtype}</div></td>
                              <td className="ga-sub"><span className="row" style={{ gap: 6 }}><ClassDot c={p.assetClass} />{CLASS_META[p.assetClass].label}{view === "all" && <span className={`chip owner-${p.owner} m-only`}>{p.owner}</span>}</span></td>
                              {view === "all" && <td className="mc-hide"><span className={`chip owner-${p.owner}`}>{p.owner}</span></td>}
                              <td className="right num ga-val">{amt(v)}</td>
                              <td className="right num muted ga-side">{pct((v / g.total) * 100)}</td>
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
