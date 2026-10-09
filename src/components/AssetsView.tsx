import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ASSET_TYPES, ASSET_TYPE_KEYS, summarizeAssets, type AssetType, type PhysicalAsset } from "../../shared/assets";
import { inView, VIEW_LABEL } from "../../shared/owner";
import { OWNERS, type Owner } from "../../shared/types";
import { useStore } from "../store";
import { brl, pct, uid } from "../lib/format";
import { Empty, PageHead } from "./ui";

/** Patrimônio físico: fora da carteira de investimentos. */
export function AssetsView() {
  const { state, update, view } = useStore();
  const assets = state!.assets;
  const [adding, setAdding] = useState(false);

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
        title={view === "all" ? "Bens" : `Bens · ${view}`}
        subtitle="Patrimônio físico — carros, imóveis, joias, eletrônicos. Fica fora da carteira de investimentos: não entra na Arca, no rebalanceamento nem na projeção."
        actions={<button className="btn primary" onClick={() => setAdding((v) => !v)}><Plus size={16} /> Adicionar bem</button>}
      />

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <div className="label">Total em bens</div>
          <div className="value num">{brl(summary.total)}</div>
          <div className="sub">{summary.count} ite{summary.count === 1 ? "m" : "ns"}{view !== "all" ? ` · ${VIEW_LABEL[view].toLowerCase()}` : ""}</div>
        </div>
        {summary.byType.map((t) => (
          <div className="card kpi" key={t.type}>
            <div className="label row" style={{ gap: 6 }}><span className="dot" style={{ background: ASSET_TYPES[t.type].color }} />{ASSET_TYPES[t.type].label}</div>
            <div className="value num" style={{ fontSize: 20 }}>{brl(t.total)}</div>
            <div className="sub">{t.count} ite{t.count === 1 ? "m" : "ns"} · {pct(summary.total ? (t.total / summary.total) * 100 : 0, 0)}</div>
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
          <Empty title="Nenhum bem cadastrado">
            <p>Cadastre carros, imóveis, joias e outros bens para acompanhar o patrimônio total — sem misturar com os investimentos.</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tipo</th><th>Item</th><th>Titular</th><th className="right">Valor (R$)</th><th>Observação</th><th /></tr></thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <td style={{ minWidth: 130 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="dot" style={{ background: ASSET_TYPES[a.type].color }} />
                        <select className="cell" value={a.type} onChange={(e) => patch(a.id, { type: e.target.value as AssetType })} aria-label="Tipo">
                          {ASSET_TYPE_KEYS.map((k) => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}
                        </select>
                      </span>
                    </td>
                    <td style={{ minWidth: 200, width: "40%" }}>
                      <input className="cell" type="text" defaultValue={a.name} key={a.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && patch(a.id, { name: e.target.value.trim() })} aria-label="Item" />
                    </td>
                    <td style={{ minWidth: 70 }}>
                      <select className="cell" value={a.owner} onChange={(e) => patch(a.id, { owner: e.target.value as Owner })} aria-label="Titular">
                        {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="right" style={{ minWidth: 120 }}>
                      <input className="cell num right" type="number" step="0.01" min="0" defaultValue={a.value.toFixed(2)} key={a.value}
                        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== a.value) patch(a.id, { value: v }); }} aria-label={`Valor de ${a.name}`} />
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <input className="cell small" type="text" placeholder="—" defaultValue={a.notes ?? ""} key={a.notes ?? ""}
                        onBlur={(e) => e.target.value !== (a.notes ?? "") && patch(a.id, { notes: e.target.value.trim() || undefined })} aria-label="Observação" />
                    </td>
                    <td className="right"><button className="btn ghost icon danger" title="Remover" onClick={() => remove(a.id)}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}><b>Total</b></td><td className="right num"><b>{brl(summary.total)}</b></td><td colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Valores estimados de mercado, editáveis a qualquer momento. Clique num campo para alterar.</p>
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
      <label className="field" style={{ width: 150 }}>Tipo
        <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>{ASSET_TYPE_KEYS.map((k) => <option key={k} value={k}>{ASSET_TYPES[k].label}</option>)}</select>
      </label>
      <label className="field grow" style={{ minWidth: 200 }}>Item<input type="text" value={name} placeholder="Ex.: Tiggo 8 Max Drive 2024" onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field" style={{ width: 80 }}>Titular
        <select value={owner} onChange={(e) => setOwner(e.target.value as Owner)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select>
      </label>
      <label className="field" style={{ width: 140 }}>Valor (R$)<input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <label className="field" style={{ width: 180 }}>Observação<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn primary" disabled={!valid}>Adicionar</button>
      <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
    </form>
  );
}
