import { Fragment, useMemo, useRef, useState } from "react";
import { Lightbulb, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";
import { AssetAttachments } from "./AssetAttachments";
import { ASSET_DETAIL_HINTS, ASSET_TYPES, ASSET_TYPE_KEYS, summarizeAssets, type AssetEstimate, type AssetType, type PhysicalAsset } from "../../shared/assets";
import type { JobEvent } from "../../shared/types";
import { streamEvents } from "../api";
import { EstimateCell, EstimateDetails, type EstimateRun } from "./AssetEstimate";
import { inView, VIEW_LABEL } from "../../shared/owner";
import { OWNERS, type Owner } from "../../shared/types";
import { useStore } from "../store";
import { brl, pct, uid } from "../lib/format";
import { Empty, PageHead } from "./ui";
import { L, getLang } from "../../shared/i18n";

/** Patrimônio físico: fora da carteira de investimentos. */
export function AssetsView() {
  const { state, update, view, config } = useStore();
  const assets = state!.assets;
  const [adding, setAdding] = useState(false);
  const [runs, setRuns] = useState<Record<string, EstimateRun>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const controllers = useRef<Record<string, AbortController>>({});

  /** Pesquisa anúncios e grava a estimativa no bem (o valor só muda se o usuário clicar em "Usar"). */
  const estimate = async (a: PhysicalAsset) => {
    controllers.current[a.id]?.abort();
    const ctrl = new AbortController();
    controllers.current[a.id] = ctrl;
    const setRun = (r: EstimateRun) => setRuns((s) => ({ ...s, [a.id]: r }));
    setRun({ status: L("Procurando anúncios…", "Looking for listings…") });
    setErrors(({ [a.id]: _drop, ...rest }) => rest);
    try {
      await streamEvents<JobEvent<AssetEstimate>>("/api/assets/estimate", { asset: a }, (e) => {
        if (e.type === "search") setRun({ status: L("Pesquisando…", "Searching…"), last: e.query });
        else if (e.type === "fetch") setRun({ status: L("Lendo anúncio…", "Reading listing…"), last: hostOf(e.url) });
        else if (e.type === "status") setRun({ status: e.text });
        else if (e.type === "error") setErrors((s) => ({ ...s, [a.id]: e.message }));
        else if (e.type === "result")
          update((s) => ({ ...s, assets: s.assets.map((x) => (x.id === a.id ? { ...x, estimate: e.result } : x)) }));
      }, ctrl.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setErrors((s) => ({ ...s, [a.id]: (err as Error).message }));
    } finally {
      setRuns(({ [a.id]: _drop, ...rest }) => rest);
    }
  };

  /** Estima todos os bens da visão, 2 por vez. */
  const estimateAll = async () => {
    const queue = visible.filter((a) => !runs[a.id]);
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await estimate(a);
    };
    await Promise.all([worker(), worker()]);
  };

  const summary = useMemo(() => summarizeAssets(assets, view), [assets, view]);
  const visible = useMemo(
    () => inView(assets, view).sort((a, b) => ASSET_TYPE_KEYS.indexOf(a.type) - ASSET_TYPE_KEYS.indexOf(b.type) || b.value - a.value),
    [assets, view],
  );

  const patch = (id: string, changes: Partial<PhysicalAsset>) =>
    update((s) => ({
      ...s,
      assets: s.assets.map((a) => (a.id === id ? { ...a, ...changes, updatedAt: new Date().toISOString() } : a)),
    }));
  const remove = (id: string) => update((s) => ({ ...s, assets: s.assets.filter((a) => a.id !== id) }));

  return (
    <>
      <PageHead
        title={view === "all" ? L("Bens", "Physical assets") : `${L("Bens", "Physical assets")} · ${view}`}
        subtitle={L("Patrimônio físico — carros, imóveis, joias, eletrônicos. Fica fora da carteira de investimentos: não entra na Arca, no rebalanceamento nem na projeção.",
          "Physical wealth — cars, real estate, jewelry, electronics. Kept outside the investment portfolio: not part of the Arca, rebalancing or projection.")}
        actions={
          <>
            <button className="btn" disabled={!visible.length || !config!.hasCredentials || Object.keys(runs).length > 0} onClick={() => void estimateAll()}
              title={L("Pesquisa anúncios para todos os bens (2 por vez)", "Searches listings for all assets (2 at a time)")}>
              <Sparkles size={16} /> {L("Estimar todos", "Estimate all")}
            </button>
            <button className="btn primary" onClick={() => setAdding((v) => !v)}><Plus size={16} /> {L("Adicionar bem", "Add asset")}</button>
          </>
        }
      />

      <div className="banner tip">
        <Lightbulb size={18} />
        <div className="grow">
          {getLang() === "pt" ? (
            <>
              <b>Quanto mais detalhes no item, melhor a estimativa da IA.</b> A IA compara o seu bem com anúncios reais — sem versão, ano, peso ou
              metragem ela precisa supor, e a estimativa sai com confiança baixa. Escreva no nome do item ou na <b>Observação</b> — e, se quiser,
              anexe <b>fotos, nota fiscal ou documentos</b> pelo clipe <Paperclip size={12} style={{ verticalAlign: -1 }} /> ao lado do item:
            </>
          ) : (
            <>
              <b>The more details on the item, the better the AI estimate.</b> The AI compares your asset with real listings — without version, year, weight or
              size it has to guess, and the estimate comes out with low confidence. Write them in the item name or in <b>Notes</b> — and, if you want,
              attach <b>photos, invoices or documents</b> with the clip <Paperclip size={12} style={{ verticalAlign: -1 }} /> next to the item:
            </>
          )}
          <ul className="tip-list">
            {ASSET_TYPE_KEYS.map((k) => (
              <li key={k}><b>{ASSET_TYPES[k].label}:</b> {ASSET_DETAIL_HINTS[k].needs}.</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <div className="label">{L("Total em bens", "Total in assets")}</div>
          <div className="value num">{brl(summary.total)}</div>
          <div className="sub">{itemsLabel(summary.count)}{view !== "all" ? ` · ${VIEW_LABEL[view].toLowerCase()}` : ""}</div>
        </div>
        {summary.byType.map((t) => (
          <div className="card kpi" key={t.type}>
            <div className="label row" style={{ gap: 6 }}><span className="dot" style={{ background: ASSET_TYPES[t.type].color }} />{ASSET_TYPES[t.type].label}</div>
            <div className="value num" style={{ fontSize: 20 }}>{brl(t.total)}</div>
            <div className="sub">{itemsLabel(t.count)} · {pct(summary.total ? (t.total / summary.total) * 100 : 0, 0)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        {adding && (
          <AddAsset
            defaultOwner={view === "all" ? "PF" : view}
            onAdd={(a) => { update((s) => ({ ...s, assets: [...s.assets, a] })); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        )}
        {visible.length === 0 ? (
          <Empty title={L("Nenhum bem cadastrado", "No assets yet")}>
            <p>{L("Cadastre carros, imóveis, joias e outros bens para acompanhar o patrimônio total — sem misturar com os investimentos.", "Add cars, real estate, jewelry and other assets to track your total wealth — without mixing them with investments.")}</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="mc t-assets">
              <thead><tr><th>{L("Tipo", "Type")}</th><th>Item</th><th>{L("Titular", "Owner")}</th><th className="right">{L("Valor (R$)", "Value (R$)")}</th><th>{L("Estimativa (IA)", "Estimate (AI)")}</th><th>{L("Observação", "Notes")}</th><th /></tr></thead>
              <tbody>
                {visible.map((a) => (
                  <Fragment key={a.id}>
                  <tr>
                    <td className="ga-a" style={{ minWidth: 130 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="dot" style={{ background: ASSET_TYPES[a.type].color }} />
                        <select className="cell" value={a.type} onChange={(e) => patch(a.id, { type: e.target.value as AssetType })} aria-label={L("Tipo", "Type")}>
                          {ASSET_TYPE_KEYS.map((k) => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}
                        </select>
                      </span>
                    </td>
                    <td className="ga-main" style={{ minWidth: 200, width: "40%" }}>
                      <div className="row" style={{ gap: 4 }}>
                        <input className="cell grow" type="text" defaultValue={a.name} key={a.name}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && patch(a.id, { name: e.target.value.trim() })} aria-label="Item" />
                        <button type="button" className={"btn ghost sm att-toggle" + (a.attachments?.length ? " has" : "")}
                          onClick={() => setOpenId((o) => (o === a.id ? null : a.id))} aria-expanded={openId === a.id}
                          title={a.attachments?.length
                            ? L(`${a.attachments.length} anexo(s) — ver ou adicionar`, `${a.attachments.length} attachment(s) — view or add`)
                            : L("Adicionar fotos, nota fiscal ou documentos", "Add photos, invoice or documents")}>
                          <Paperclip size={14} />{a.attachments?.length ? a.attachments.length : ""}
                        </button>
                      </div>
                    </td>
                    <td className="ga-b" style={{ minWidth: 70 }}>
                      <select className="cell" value={a.owner} onChange={(e) => patch(a.id, { owner: e.target.value as Owner })} aria-label={L("Titular", "Owner")}>
                        {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="right ga-val" style={{ minWidth: 120 }}>
                      <input className="cell num right" type="number" step="0.01" min="0" defaultValue={a.value.toFixed(2)} key={a.value}
                        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== a.value) patch(a.id, { value: v }); }} aria-label={L(`Valor de ${a.name}`, `Value of ${a.name}`)} />
                    </td>
                    <td className="ga-c" data-l={L("Estimativa (IA)", "Estimate (AI)")} style={{ minWidth: 190 }}>
                      <EstimateCell
                        asset={a}
                        run={runs[a.id]}
                        error={errors[a.id]}
                        disabled={!config!.hasCredentials || !!runs[a.id]}
                        open={openId === a.id}
                        onEstimate={() => void estimate(a)}
                        onUse={(value) => patch(a.id, { value })}
                        onToggle={() => setOpenId((o) => (o === a.id ? null : a.id))}
                      />
                    </td>
                    <td className="ga-d" data-l={L("Observação", "Notes")} style={{ minWidth: 110 }}>
                      <input className="cell small" type="text" placeholder={L("Ex.: ", "E.g.: ") + ASSET_DETAIL_HINTS[a.type].needs} title={L("Detalhes que melhoram a estimativa: ", "Details that improve the estimate: ") + ASSET_DETAIL_HINTS[a.type].needs} defaultValue={a.notes ?? ""} key={a.notes ?? ""}
                        onBlur={(e) => e.target.value !== (a.notes ?? "") && patch(a.id, { notes: e.target.value.trim() || undefined })} aria-label={L("Observação", "Notes")} />
                    </td>
                    <td className="right ga-act"><button className="btn ghost icon danger" title={L("Remover", "Remove")} onClick={() => remove(a.id)}><Trash2 size={16} /></button></td>
                  </tr>
                  {openId === a.id && (
                    <tr className="est-row">
                      <td colSpan={7}>
                        <AssetAttachments
                          asset={a}
                          onChange={(attachments) => update((s) => ({ ...s, assets: s.assets.map((x) => (x.id === a.id ? { ...x, attachments } : x)) }))}
                        />
                        {a.estimate && <EstimateDetails e={a.estimate} />}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}><b>Total</b></td>
                  <td className="right num"><b>{brl(summary.total)}</b></td>
                  <td className="num muted small">{estimatedTotal(visible)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>{L("Valores estimados de mercado, editáveis a qualquer momento. Clique num campo para alterar.", "Estimated market values, editable at any time. Click a field to change it.")}</p>
      </div>
    </>
  );
}

function AddAsset({ onAdd, onCancel, defaultOwner }: { onAdd: (a: PhysicalAsset) => void; onCancel: () => void; defaultOwner: Owner }) {
  const [type, setType] = useState<AssetType>("carro");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [owner, setOwner] = useState<Owner>(defaultOwner);
  const [notes, setNotes] = useState("");
  const valid = name.trim() && Number(value) >= 0 && value !== "";

  return (
    <form
      className="row wrap"
      style={{ marginBottom: 14, padding: 12, background: "var(--surface-2)", borderRadius: 10, alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({ id: uid(), type, name: name.trim(), value: Number(value), owner, notes: notes.trim() || undefined, updatedAt: new Date().toISOString() });
      }}
    >
      <label className="field" style={{ width: 150 }}>{L("Tipo", "Type")}
        <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>{ASSET_TYPE_KEYS.map((k) => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}</select>
      </label>
      <label className="field grow" style={{ minWidth: 200 }}>Item<input type="text" value={name} placeholder={L("Ex.: ", "E.g.: ") + ASSET_DETAIL_HINTS[type].example} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field" style={{ width: 80 }}>{L("Titular", "Owner")}
        <select value={owner} onChange={(e) => setOwner(e.target.value as Owner)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select>
      </label>
      <label className="field" style={{ width: 140 }}>{L("Valor (R$)", "Value (R$)")}<input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <label className="field" style={{ width: 220 }}>{L("Observação", "Notes")}<input type="text" value={notes} placeholder={L("Detalhes extras", "Extra details")} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn primary" disabled={!valid}>{L("Adicionar", "Add")}</button>
      <button className="btn" type="button" onClick={onCancel}>{L("Cancelar", "Cancel")}</button>
      <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
        <Lightbulb size={13} style={{ verticalAlign: -2 }} /> {L("Para", "For")} {ASSET_TYPES[type].label.toLowerCase()}, {L("informe", "provide")} <b>{ASSET_DETAIL_HINTS[type].needs}</b> — {L("quanto mais detalhes, mais precisa a estimativa da IA.", "the more details, the more accurate the AI estimate.")}
      </p>
    </form>
  );
}

const itemsLabel = (n: number) => (n === 1 ? L("1 item", "1 item") : L(`${n} itens`, `${n} items`));

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Soma das estimativas (com o valor registrado para bens ainda sem estimativa). */
function estimatedTotal(list: PhysicalAsset[]): string {
  const withEst = list.filter((a) => a.estimate).length;
  if (!withEst) return "";
  const total = list.reduce((s, a) => s + (a.estimate ? Math.round(a.estimate.estimate) : a.value), 0);
  return `${L("IA", "AI")}: ${brl(total)}${withEst < list.length ? ` (${withEst}/${list.length} ${L("estimados", "estimated")})` : ""}`;
}
