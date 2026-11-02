import { useMemo, useState } from "react";
import { Pencil, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { CLASS_META, type AssetClass } from "../../shared/types";
import { GOAL_KINDS, goalPositions, goalStatus, planningOf, type Goal, type GoalKind, type Planning } from "../../shared/planning";
import { toBRL } from "../../shared/arca";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt0, uid } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const CLASSES: AssetClass[] = ["caixa", "acoes", "fiis", "internacional", "outros"];

const blank = (): Goal => ({
  id: uid(), name: "", kind: "aposentadoria", target: 0,
  targetDate: `${new Date().getFullYear() + 10}-12`, positionIds: [], classes: [], monthly: 0, realReturnPct: null,
});

const monthsText = (n: number) =>
  n >= 24 ? L(`${Math.floor(n / 12)} anos${n % 12 ? ` e ${n % 12} meses` : ""}`, `${Math.floor(n / 12)} years${n % 12 ? ` ${n % 12} mo` : ""}`) : L(`${n} meses`, `${n} months`);

/** Metas: quanto falta, quanto aportar por mês e se o aporte planejado chega lá (em reais de hoje). */
export function GoalsView() {
  const { state, update, config } = useStore();
  const planning = planningOf(state!.planning);
  const [editing, setEditing] = useState<Goal | null>(null);
  const setPlanning = (fn: (p: Planning) => Planning) => update((s) => ({ ...s, planning: fn(planningOf(s.planning)) }));
  const advice = useJob<{ text: string; at: string }>("/api/goals/advice", (r) => setPlanning((p) => ({ ...p, goalsAdvice: r })));

  const rows = useMemo(() => planning.goals.map((g) => ({ g, st: goalStatus(g, state!) })), [planning.goals, state]);
  const totalRequired = rows.reduce((s, r) => s + r.st.required, 0);
  const totalPlanned = planning.goals.reduce((s, g) => s + g.monthly, 0);

  const save = (g: Goal) => {
    setPlanning((p) => ({ ...p, goals: p.goals.some((x) => x.id === g.id) ? p.goals.map((x) => (x.id === g.id ? g : x)) : [...p.goals, g] }));
    setEditing(null);
  };

  return (
    <>
      <PageHead
        title={L("Metas", "Goals")}
        subtitle={L("Para cada objetivo: quanto já tem, quanto aportar por mês e se chega lá no prazo — tudo em reais de hoje (já descontada a inflação).", "For each objective: how much you have, how much to invest per month and whether you get there on time — all in today's money (inflation already discounted).")}
        actions={<button className="btn primary" onClick={() => setEditing(blank())}><Plus size={16} /> {L("Nova meta", "New goal")}</button>}
      />

      {editing && <GoalForm goal={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {rows.length === 0 && !editing && (
        <Banner kind="info">{L("Nenhuma meta ainda. Crie uma (ex.: reserva de emergência, aposentadoria, imóvel) e ligue as posições ou classes que contam para ela.", "No goals yet. Create one (e.g. emergency fund, retirement, home) and link the positions or classes that count toward it.")}</Banner>
      )}

      {rows.length > 0 && (
        <div className="grid kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{L("Aporte necessário (todas)", "Required per month (all)")}</div><div className="value num">{amt0(totalRequired)}</div><div className="sub">{L("por mês", "per month")}</div></div>
          <div className="kpi"><div className="label">{L("Aporte planejado", "Planned per month")}</div><div className="value num" style={{ color: totalPlanned >= totalRequired ? "var(--ok)" : "var(--bad)" }}>{amt0(totalPlanned)}</div>
            <div className="sub">{totalPlanned >= totalRequired ? L("cobre todas as metas", "covers all goals") : L(`faltam ${amt0(totalRequired - totalPlanned)}/mês`, `${amt0(totalRequired - totalPlanned)}/mo short`)}</div></div>
          <div className="kpi"><div className="label">{L("No trilho", "On track")}</div><div className="value num">{rows.filter((r) => r.st.onTrack).length} / {rows.length}</div></div>
        </div>
      )}

      <div className="goals">
        {rows.map(({ g, st }) => (
          <div key={g.id} className="card goal">
            <div className="card-head">
              <div>
                <h2 className="row"><Target size={17} /> {g.name}</h2>
                <p className="muted small">{GOAL_KINDS()[g.kind]} · {L("alvo", "target")} {amt0(g.target)} {L("até", "by")} {new Date(`${g.targetDate}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "numeric" })} ({monthsText(st.months)})</p>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <span className={`chip ${st.onTrack ? "ok" : "bad"}`}>{st.onTrack ? L("no trilho", "on track") : L("fora do trilho", "off track")}</span>
                <button className="btn icon sm ghost" title={L("Editar", "Edit")} onClick={() => setEditing(g)}><Pencil size={14} /></button>
                <button className="btn icon sm ghost" title={L("Excluir", "Delete")} onClick={() => setPlanning((p) => ({ ...p, goals: p.goals.filter((x) => x.id !== g.id) }))}><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="bar"><div style={{ width: `${Math.min(100, st.progress * 100)}%`, background: st.onTrack ? "var(--ok)" : "var(--accent)" }} /></div>
            <div className="grid kpis small" style={{ marginTop: 10 }}>
              <div><div className="muted">{L("Hoje", "Today")}</div><b className="num">{amt0(st.current)}</b> <span className="muted">({(st.progress * 100).toFixed(0)}%)</span></div>
              <div><div className="muted">{L("Aporte necessário", "Required")}</div><b className="num">{amt0(st.required)}</b>/{L("mês", "mo")}</div>
              <div><div className="muted">{L("Com o planejado", "With planned")} ({amt0(g.monthly)}/{L("mês", "mo")})</div><b className="num" style={{ color: st.onTrack ? "var(--ok)" : "var(--bad)" }}>{amt0(st.projected)}</b></div>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {L("Retorno real", "Real return")} {st.realReturnPct.toLocaleString(locale(), { maximumFractionDigits: 1 })}% a.a. ({st.returnSource === "projection" ? L("da Projeção", "from Projection") : st.returnSource === "manual" ? L("definido por você", "set by you") : L("padrão — rode a Projeção para usar premissas pesquisadas", "default — run the Projection to use researched assumptions")})
              {" · "}{goalPositions(g, state!.positions).length} {L("posições", "positions")}{g.classes.length ? ` (${g.classes.map((c) => CLASS_META[c].label).join(", ")})` : ""}
            </p>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2 className="row"><Sparkles size={17} /> {L("Análise das metas", "Goals analysis")}</h2>
            <button className="btn sm primary" disabled={advice.running || !config?.hasCredentials} onClick={() => advice.start()}>
              <Sparkles size={14} /> {planning.goalsAdvice ? L("Refazer com IA", "Redo with AI") : L("Analisar com IA", "Analyze with AI")}
            </button>
          </div>
          {advice.running && <JobProgress job={advice} onCancel={advice.cancel} />}
          {advice.error && <Banner kind="bad">{advice.error}</Banner>}
          {planning.goalsAdvice ? (
            <>
              <div className="prose small">{planning.goalsAdvice.text}</div>
              <p className="muted small" style={{ marginTop: 8 }}>{L("Escrito pela IA em", "Written by the AI on")} {new Date(planning.goalsAdvice.at).toLocaleString(locale())}.</p>
            </>
          ) : (
            !advice.running && <p className="muted small">{L("A IA olha todas as metas juntas: se o aporte cabe, o que ajustar e se as posições combinam com cada prazo.", "The AI looks at all goals together: whether the contributions fit, what to adjust and whether the positions match each horizon.")}</p>
          )}
        </div>
      )}
    </>
  );
}

function GoalForm({ goal, onSave, onCancel }: { goal: Goal; onSave: (g: Goal) => void; onCancel: () => void }) {
  const { state } = useStore();
  const [g, setG] = useState<Goal>(goal);
  const [q, setQ] = useState("");
  const set = (patch: Partial<Goal>) => setG((x) => ({ ...x, ...patch }));
  const positions = [...state!.positions]
    .filter((p) => !g.classes.includes(p.assetClass))
    .filter((p) => `${p.name} ${p.ticker ?? ""} ${p.institution}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => toBRL(b, state!.settings.fx) - toBRL(a, state!.settings.fx));
  const valid = g.name.trim() && g.target > 0 && /^\d{4}-\d{2}$/.test(g.targetDate);
  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ ...g, name: g.name.trim() }); }}>
      <h2 style={{ marginBottom: 10 }}>{goal.name ? L("Editar meta", "Edit goal") : L("Nova meta", "New goal")}</h2>
      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="field grow" style={{ minWidth: 200 }}>{L("Nome", "Name")}<input value={g.name} onChange={(e) => set({ name: e.target.value })} placeholder={L("ex.: Aposentadoria aos 55", "e.g. Retire at 55")} /></label>
        <label className="field">{L("Tipo", "Type")}
          <select value={g.kind} onChange={(e) => set({ kind: e.target.value as GoalKind })}>{Object.entries(GOAL_KINDS()).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field">{L("Valor-alvo (R$ de hoje)", "Target (today's R$)")}<input type="number" min={0} step={1000} value={g.target || ""} onChange={(e) => set({ target: Number(e.target.value) })} /></label>
        <label className="field">{L("Até (mês)", "By (month)")}<input type="month" value={g.targetDate} onChange={(e) => set({ targetDate: e.target.value })} /></label>
        <label className="field">{L("Aporte planejado/mês", "Planned per month")}<input type="number" min={0} step={100} value={g.monthly || ""} onChange={(e) => set({ monthly: Number(e.target.value) })} /></label>
        <label className="field" title={L("Vazio = usa a Projeção (ou 4% a.a.)", "Empty = use the Projection (or 4% p.a.)")}>{L("Retorno real % a.a.", "Real return % p.a.")}
          <input type="number" step={0.1} value={g.realReturnPct ?? ""} placeholder={L("automático", "automatic")} onChange={(e) => set({ realReturnPct: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
      </div>
      <p className="small" style={{ marginTop: 12, marginBottom: 6 }}><b>{L("O que conta para a meta", "What counts toward the goal")}</b> — {L("classes inteiras e/ou posições específicas", "whole classes and/or specific positions")}</p>
      <div className="row wrap" style={{ gap: 12 }}>
        {CLASSES.map((c) => (
          <label key={c} className="check small"><input type="checkbox" checked={g.classes.includes(c)} onChange={(e) => set({ classes: e.target.checked ? [...g.classes, c] : g.classes.filter((x) => x !== c) })} /> {CLASS_META[c].label}</label>
        ))}
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Buscar posição…", "Search position…")} style={{ marginTop: 10, maxWidth: 320 }} />
      <div className="goal-pick">
        {positions.map((p) => (
          <label key={p.id} className="check small">
            <input type="checkbox" checked={g.positionIds.includes(p.id)} onChange={(e) => set({ positionIds: e.target.checked ? [...g.positionIds, p.id] : g.positionIds.filter((x) => x !== p.id) })} />
            <span>{p.ticker ? `${p.ticker} · ` : ""}{p.name} <span className="muted">· {p.institution} {p.owner} · {amt0(toBRL(p, state!.settings.fx))}</span></span>
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary" disabled={!valid}>{L("Salvar meta", "Save goal")}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>{L("Cancelar", "Cancel")}</button>
      </div>
    </form>
  );
}
