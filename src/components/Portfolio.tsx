import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronRight, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { ALL_CLASSES, ARCA_CLASSES, CLASS_META, OWNERS, type AssetClass, type Currency, type Owner, type Position, type RefreshResult } from "../../shared/types";
import { VIEW_LABEL } from "../../shared/owner";
import { ClassAssets } from "./ClassAssets";
import type { Job } from "../lib/useJob";
import { RefreshPanel } from "./RefreshPanel";
import { summarizeAssets } from "../../shared/assets";
import { classRows, computeAllocation, toBRL } from "../../shared/arca";
import { useStore } from "../store";
import { brl, brl0, pct, signedPp, uid } from "../lib/format";
import { ClassDot, ClassLabel, ClassSelect, Empty, PageHead } from "./ui";

const statusLabel = { ok: "Em equilíbrio", warn: "Atenção", bad: "Fora da meta" } as const;

export function Portfolio({ goImport, goAssets, refreshJob }: { goImport: () => void; goAssets: () => void; refreshJob: Job<RefreshResult> }) {
  const { state, update, config, view, visible } = useStore();
  const [openClass, setOpenClass] = useState<AssetClass | null>(null);
  const toggleClass = (c: AssetClass) => setOpenClass((o) => (o === c ? null : c));
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<AssetClass>>(readCollapsed);
  const setCollapsedSaved = (next: Set<AssetClass>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* sem storage: só não lembra */
    }
  };
  const toggleGroup = (c: AssetClass) => {
    const next = new Set(collapsed);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCollapsedSaved(next);
  };
  const [adding, setAdding] = useState(false);
  const settings = state!.settings;
  const positions = visible;
  const assetSummary = useMemo(() => summarizeAssets(state!.assets, view), [state, view]);
  const showOwner = view === "all";

  const alloc = useMemo(() => computeAllocation(positions, settings.usdBrl), [positions, settings.usdBrl]);
  const rows = useMemo(() => classRows(alloc, settings.targets), [alloc, settings.targets]);
  const worst = rows.reduce((a, b) => (Math.abs(b.driftPp) > Math.abs(a.driftPp) ? b : a), rows[0]);
  const oldestTs = Math.min(...positions.map((p) => Date.parse(p.updatedAt)).filter(Number.isFinite));
  const oldest = Number.isFinite(oldestTs) ? new Date(oldestTs).toLocaleDateString("pt-BR") : null;

  const filtered = positions.filter((p) =>
    `${p.name} ${p.ticker ?? ""} ${p.institution} ${p.subtype}`.toLowerCase().includes(query.toLowerCase()),
  );

  const patch = (id: string, changes: Partial<Position>) =>
    update((s) => ({
      ...s,
      positions: s.positions.map((p) => (p.id === id ? { ...p, ...changes, updatedAt: new Date().toISOString() } : p)),
    }));
  const remove = (id: string) => update((s) => ({ ...s, positions: s.positions.filter((p) => p.id !== id) }));

  if (positions.length === 0 && !adding) {
    return (
      <>
        <PageHead title="Carteira" subtitle="Consolidação de tudo o que você tem, organizada pelas classes da Arca." />
        <div className="card">
          <Empty title={view === "all" ? "Sua carteira está vazia" : `Nenhum investimento de ${VIEW_LABEL[view].toLowerCase()}`}>
            <p>Importe prints do app do banco/corretora ou exports (BTG, XP, Nubank…) para começar.</p>
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="btn primary" onClick={goImport}>Importar prints e arquivos</button>
              <button className="btn" onClick={() => setAdding(true)}>Adicionar manualmente</button>
            </div>
          </Empty>
        </div>
      </>
    );
  }

  const pieCurrent = rows.map((r) => ({ name: CLASS_META[r.assetClass].label, value: r.current, kind: "atual", color: CLASS_META[r.assetClass].color }));
  const pieTarget = rows.map((r) => ({ name: CLASS_META[r.assetClass].label, value: r.targetPct, kind: "meta", color: CLASS_META[r.assetClass].color }));

  return (
    <>
      <PageHead
        title={view === "all" ? "Carteira" : `Carteira · ${view}`}
        subtitle={view === "all" ? "Consolidação de tudo o que você tem (PF + PJ), organizada pelas classes da Arca." : `Só os investimentos de ${VIEW_LABEL[view].toLowerCase()}.`}
        actions={
          <>
            <button
              className="btn"
              onClick={refreshJob.start}
              disabled={refreshJob.running || !config!.hasCredentials}
              title="Busca cotações de mercado e estima a renda fixa até hoje"
            >
              <RefreshCw size={16} className={refreshJob.running ? "spin" : ""} /> Atualizar valores
            </button>
            <button className="btn" onClick={() => setAdding((v) => !v)}><Plus size={16} /> Adicionar</button>
            <button className="btn primary" onClick={goImport}>Importar</button>
          </>
        }
      />

      <RefreshPanel job={refreshJob} />

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <div className="label">Patrimônio total</div>
          <div className="value num">{brl0(alloc.grandTotal)}</div>
          <div className="sub">{positions.length} posições{oldest ? ` · valor mais antigo: ${oldest}` : ""}</div>
        </div>
        <div className="card kpi"><div className="label">Base Arca</div><div className="value num">{brl0(alloc.arcaTotal)}</div><div className="sub">4 classes rebalanceáveis</div></div>
        <div className="card kpi"><div className="label">Fora da Arca</div><div className="value num">{brl0(alloc.outrosTotal)}</div><div className="sub">cripto, ouro, etc.</div></div>
        <button type="button" className="card kpi kpi-link assets-kpi" onClick={goAssets} title="Patrimônio físico — não somado aos investimentos">
          <div className="label">Bens físicos</div>
          <div className="value num">{brl0(assetSummary.total)}</div>
          <div className="sub">{assetSummary.count ? `${assetSummary.count} ite${assetSummary.count === 1 ? "m" : "ns"} · fora dos investimentos` : "cadastre carros, imóveis, joias…"}</div>
        </button>
        <div className="card kpi">
          <div className="label">Maior desvio</div>
          <div className="value num">{alloc.arcaTotal ? signedPp(worst.driftPp) : "—"}</div>
          <div className="sub">{alloc.arcaTotal ? CLASS_META[worst.assetClass].label : "sem dados"}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h2>Alocação atual × meta da Arca</h2><span className="muted small">clique numa classe para ver os ativos · traço vertical = meta</span></div>
        <div className="row wrap" style={{ alignItems: "flex-start", gap: 24 }}>
          <div style={{ width: 210, height: 210, flex: "none" }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieTarget} dataKey="value" innerRadius={42} outerRadius={60} stroke="none" isAnimationActive={false}>
                  {pieTarget.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.35} />)}
                </Pie>
                <Pie data={pieCurrent} dataKey="value" innerRadius={66} outerRadius={96} stroke="none" paddingAngle={1} isAnimationActive={false}
                  onClick={(_d, i) => toggleClass(rows[i].assetClass)} style={{ cursor: "pointer" }}>
                  {pieCurrent.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={openClass && openClass !== rows[i].assetClass ? 0.35 : 1} />)}
                </Pie>
                <Tooltip formatter={(v, _n, item) => (item?.payload?.kind === "meta" ? pct(Number(v), 0) : brl(Number(v)))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="muted small right" style={{ marginTop: -4 }}>anel externo = atual · interno = meta</div>
          </div>
          <div className="grow" style={{ minWidth: 300 }}>
            {rows.map((r) => [
              <button
                type="button"
                className={"alloc-row clickable" + (openClass === r.assetClass ? " open" : "")}
                key={r.assetClass}
                onClick={() => toggleClass(r.assetClass)}
                aria-expanded={openClass === r.assetClass}
                title="Ver os ativos desta classe"
              >
                <div className="row" style={{ gap: 6 }}>
                  <ChevronRight size={14} className="chev" />
                  <div><ClassLabel c={r.assetClass} /><div className="muted small num">{brl(r.current)}</div></div>
                </div>
                <div className="bar" title={`Atual ${pct(r.currentPct)} · Meta ${pct(r.targetPct, 0)}`}>
                  <div className="fill" style={{ width: `${Math.min(r.currentPct, 100)}%`, background: CLASS_META[r.assetClass].color }} />
                  <div className="target" style={{ left: `${Math.min(r.targetPct, 100)}%` }} />
                </div>
                <div className="row spread">
                  <span className="num"><b>{pct(r.currentPct)}</b> <span className="muted">/ {pct(r.targetPct, 0)}</span></span>
                  <span className={`chip ${r.status}`} title={signedPp(r.driftPp)}>{alloc.arcaTotal ? statusLabel[r.status] : "—"}</span>
                </div>
              </button>,
            ])}
            {alloc.outrosTotal > 0 && (
              <>
                <button type="button" className={"alloc-row clickable" + (openClass === "outros" ? " open" : "")} onClick={() => toggleClass("outros")} aria-expanded={openClass === "outros"}>
                  <div className="row" style={{ gap: 6 }}>
                    <ChevronRight size={14} className="chev" />
                    <div><ClassLabel c="outros" /><div className="muted small num">{brl(alloc.outrosTotal)}</div></div>
                  </div>
                  <div className="muted small">não entra no rebalanceamento</div>
                  <div />
                </button>
              </>
            )}
          </div>
        </div>
        {openClass && (
          <ClassAssets assetClass={openClass} positions={positions} usdBrl={settings.usdBrl} showOwner={showOwner} onClose={() => setOpenClass(null)} />
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row" style={{ gap: 10 }}>
            <h2>Posições</h2>
            <button className="btn ghost sm" onClick={() => setCollapsedSaved(new Set(ALL_CLASSES))}>Recolher todas</button>
            <button className="btn ghost sm" onClick={() => setCollapsedSaved(new Set())}>Expandir todas</button>
          </div>
          <div className="row" style={{ width: 260 }}>
            <Search size={16} className="muted" />
            <input type="text" placeholder="Filtrar por nome, ticker, banco…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {adding && <AddPosition defaultOwner={view === "all" ? "PF" : view} onAdd={(p) => { update((s) => ({ ...s, positions: [...s.positions, p] })); setAdding(false); }} onCancel={() => setAdding(false)} />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ativo</th><th>Instituição</th><th>Classe</th><th className="right">Valor</th><th /></tr>
            </thead>
            <tbody>
              {ALL_CLASSES.map((c) => {
                const items = filtered.filter((p) => p.assetClass === c);
                if (!items.length) return null;
                const sum = items.reduce((s, p) => s + toBRL(p, settings.usdBrl), 0);
                // Ao filtrar, mostra os resultados mesmo em grupos recolhidos.
                const isCollapsed = collapsed.has(c) && !query;
                return [
                  <tr className="group clickable" key={`g-${c}`} onClick={() => toggleGroup(c)} aria-expanded={!isCollapsed}
                    tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleGroup(c))}
                    title={isCollapsed ? "Mostrar os ativos" : "Recolher"}>
                    <td colSpan={3}>
                      <span className="row">
                        <ChevronRight size={14} className="chev" style={{ transform: isCollapsed ? undefined : "rotate(90deg)" }} />
                        <ClassDot c={c} />{CLASS_META[c].label}
                        <span className="muted small" style={{ fontWeight: 400 }}>· {items.length} ativo{items.length === 1 ? "" : "s"}</span>
                      </span>
                    </td>
                    <td className="right num">{brl(sum)}</td><td />
                  </tr>,
                  ...(isCollapsed ? [] : items)
                    .sort((a, b) => toBRL(b, settings.usdBrl) - toBRL(a, settings.usdBrl))
                    .map((p) => (
                      <tr key={p.id}>
                        <td style={{ minWidth: 200 }}>
                          <div><b>{p.ticker ? `${p.ticker} · ` : ""}{p.name}</b></div>
                          <div className="muted small">{p.subtype}{p.quantity != null ? ` · ${p.quantity.toLocaleString("pt-BR")} un.` : ""}</div>
                        </td>
                        <td className="muted">
                          {p.institution}
                          <div>
                            <select className="cell owner-select small" value={p.owner} onChange={(e) => patch(p.id, { owner: e.target.value as Owner })} aria-label={"Titular de " + p.name}>
                              {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        </td>
                        <td style={{ minWidth: 175 }}><ClassSelect value={p.assetClass} onChange={(assetClass) => patch(p.id, { assetClass })} /></td>
                        <td className="right" style={{ minWidth: 130 }}>
                          <input
                            className="cell num right"
                            type="number"
                            step="0.01"
                            defaultValue={p.value.toFixed(2)}
                            key={p.value}
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== p.value) patch(p.id, { value: v }); }}
                            aria-label={`Valor de ${p.name} (${p.currency})`}
                          />
                          {p.currency === "USD" && <div className="muted small num">US$ · ≈ {brl(toBRL(p, settings.usdBrl))}</div>}
                        </td>
                        <td className="right"><button className="btn ghost icon danger" title="Remover" onClick={() => remove(p.id)}><Trash2 size={16} /></button></td>
                      </tr>
                    )),
                ];
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <Empty title="Nada encontrado" />}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Classes da Arca: {ARCA_CLASSES.map((c) => CLASS_META[c].label).join(" · ")}. Posições em dólar usam a cotação de R$ {settings.usdBrl.toLocaleString("pt-BR")} (altere em Ajustes).
        </p>
      </div>
    </>
  );
}

function AddPosition({ onAdd, onCancel, defaultOwner }: { onAdd: (p: Position) => void; onCancel: () => void; defaultOwner: Owner }) {
  const [owner, setOwner] = useState<Owner>(defaultOwner);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [institution, setInstitution] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("caixa");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [value, setValue] = useState("");
  const valid = name.trim() && Number(value) > 0;

  return (
    <form
      className="row wrap"
      style={{ marginBottom: 14, padding: 12, background: "var(--surface-2)", borderRadius: 10, alignItems: "flex-end" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({
          id: uid(), name: name.trim(), ticker: ticker.trim().toUpperCase() || undefined,
          institution: institution.trim() || "Manual", owner, assetClass, subtype: "Manual", currency,
          value: Number(value), updatedAt: new Date().toISOString(), source: "manual",
        });
      }}
    >
      <label className="field grow" style={{ minWidth: 160 }}>Nome<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field" style={{ width: 100 }}>Ticker<input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} /></label>
      <label className="field" style={{ width: 150 }}>Instituição<input type="text" value={institution} onChange={(e) => setInstitution(e.target.value)} /></label>
      <label className="field" style={{ width: 80 }}>Titular
        <select value={owner} onChange={(e) => setOwner(e.target.value as Owner)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select>
      </label>
      <label className="field" style={{ width: 160 }}>Classe<ClassSelect className="" value={assetClass} onChange={setAssetClass} /></label>
      <label className="field" style={{ width: 80 }}>Moeda
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option>BRL</option><option>USD</option></select>
      </label>
      <label className="field" style={{ width: 130 }}>Valor<input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <button className="btn primary" disabled={!valid}>Adicionar</button>
      <button className="btn" type="button" onClick={onCancel}>Cancelar</button>
    </form>
  );
}

const COLLAPSE_KEY = "arca:collapsedClasses";
function readCollapsed(): Set<AssetClass> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((c): c is AssetClass => ALL_CLASSES.includes(c)) : []);
  } catch {
    return new Set();
  }
}
