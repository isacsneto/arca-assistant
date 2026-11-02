import { useMemo, useState } from "react";
import { positionLabel } from "../../shared/label";
import { BellOff, BellRing, ChevronRight, Landmark, Trash2 } from "lucide-react";
import { isStale, markStale, unmarkStale } from "../../shared/reminders";
import { ALL_CLASSES, CLASS_META, type AssetClass, type Owner, type Position } from "../../shared/types";
import { toBRL } from "../../shared/arca";
import { VIEW_LABEL } from "../../shared/owner";
import { useStore } from "../store";
import { amt, money, pct, displayCurrency } from "../lib/format";
import { useHideValues } from "../lib/privacy";
import { fromOpenFinance, patchPosition, removePosition } from "../lib/positions";
import { CURRENCIES } from "../../shared/currency";
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
  const [hidden] = useHideValues();
  /** Apagar pede um segundo clique (o primeiro só arma o botão). */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const patch = (id: string, changes: Partial<Position>) => update((s) => patchPosition(s, id, changes));
  const remove = (id: string) => {
    setConfirmDel(null);
    update((s) => removePosition(s, id));
  };

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
                        <thead><tr><th>{L("Ativo", "Asset")}</th><th>{L("Classe", "Class")}</th>{view === "all" && <th>{L("Titular", "Owner")}</th>}<th className="right">{L("Valor", "Value")}</th><th className="right">{L("% na instituição", "% of institution")}</th><th aria-label={L("Ações", "Actions")} /></tr></thead>
                        <tbody>
                          {g.items.map(({ p, v }) => (
                            <tr key={p.id}>
                              <td className="ga-main">
                                {/* Edita só o nome; o ticker vai na linha de baixo (senão "PETR4 · PETR4 · …"). */}
                                <input className="cell inst-name" type="text" defaultValue={p.name} key={`${p.id}:${p.name}`}
                                  onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== p.name) patch(p.id, { name }); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                  aria-label={L(`Nome de ${p.name}`, `Name of ${p.name}`)} />
                                <div className="muted small">{positionLabel(p) !== p.name ? `${p.ticker} · ` : ""}{p.subtype}</div>
                                {fromOpenFinance(p) && <div className="muted small">{L("Open Finance: a próxima sincronização volta a trazer o valor do banco.", "Open Finance: the next sync brings back the bank's value.")}</div>}
                              </td>
                              <td className="ga-sub"><span className="row" style={{ gap: 6 }}><ClassDot c={p.assetClass} />{CLASS_META[p.assetClass].label}{view === "all" && <span className={`chip owner-${p.owner} m-only`}>{p.owner}</span>}</span></td>
                              {view === "all" && <td className="mc-hide"><span className={`chip owner-${p.owner}`}>{p.owner}</span></td>}
                              <td className="right ga-val" style={{ minWidth: 130 }}>
                                {hidden ? (
                                  <div className="num masked-value">{money(p.value, p.currency)}</div>
                                ) : (
                                  <input className="cell num right" type="number" step="0.01" min="0" defaultValue={p.value.toFixed(2)} key={`${p.id}:${p.value}`}
                                    onBlur={(e) => { const val = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(val) && val >= 0 && val !== p.value) patch(p.id, { value: val }); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                                    aria-label={L(`Valor de ${p.name} (${p.currency})`, `Value of ${p.name} (${p.currency})`)} />
                                )}
                                {p.currency !== displayCurrency() && <div className="muted small num">{CURRENCIES[p.currency].symbol} · ≈ {amt(v)}</div>}
                              </td>
                              <td className="right num muted ga-side">{pct((v / g.total) * 100)}</td>
                              <td className="right ga-act">
                                {confirmDel === p.id ? (
                                  <button type="button" className="btn sm danger" onClick={() => remove(p.id)} onBlur={() => setConfirmDel(null)} autoFocus>
                                    <Trash2 size={14} /> {L("Apagar", "Delete")}
                                  </button>
                                ) : (
                                  <button type="button" className="btn ghost icon danger" title={L("Apagar esta posição", "Delete this position")} aria-label={L(`Apagar ${p.name}`, `Delete ${p.name}`)} onClick={() => setConfirmDel(p.id)}>
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </td>
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
