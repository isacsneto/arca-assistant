import { useRef, useState } from "react";
import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  ARCA_CLASSES, CLASS_META, DEFAULT_TARGETS, EFFORTS, EFFORT_LABEL,
  type AppState, type ModelSetting, type Settings,
} from "../../shared/types";
import { targetsSum } from "../../shared/arca";
import { api } from "../api";
import { useStore } from "../store";
import { Banner, ClassDot, PageHead } from "./ui";

export function SettingsView() {
  const { state, config, update } = useStore();
  const settings = state!.settings;
  const [fxMsg, setFxMsg] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const sum = targetsSum(settings.targets);

  const fetchFx = async () => {
    try {
      const { usdBrl } = await api.getFx();
      set({ usdBrl: Math.round(usdBrl * 100) / 100 });
      setFxMsg("Cotação atualizada.");
    } catch (e) {
      setFxMsg(e instanceof Error ? e.message : "Falhou.");
    }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arca-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Partial<AppState>;
      if (!Array.isArray(data.positions) || !data.settings) throw new Error("Arquivo de backup inválido.");
      update((s) => ({
        ...s,
        positions: data.positions!,
        transactions: data.transactions ?? [],
        settings: { ...s.settings, ...data.settings },
      }));
      setMsg({ kind: "ok", text: "Backup restaurado." });
    } catch (e) {
      setMsg({ kind: "bad", text: e instanceof Error ? e.message : "Falha ao ler o backup." });
    }
  };

  return (
    <>
      <PageHead title="Ajustes" />
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="stack-lg">
        <section className="card">
          <div className="card-head">
            <div><h2>Metas da Arca</h2><p className="muted small">A Arca original divide o patrimônio em partes iguais entre as quatro classes. Ajuste se quiser.</p></div>
            <button className="btn sm" onClick={() => set({ targets: { ...DEFAULT_TARGETS } })}>Restaurar 25/25/25/25</button>
          </div>
          <div className="grid kpis">
            {ARCA_CLASSES.map((c) => (
              <label className="field" key={c}>
                <span className="row"><ClassDot c={c} />{CLASS_META[c].label}</span>
                <span className="row">
                  <input type="number" min="0" max="100" step="1" value={settings.targets[c]}
                    onChange={(e) => set({ targets: { ...settings.targets, [c]: Number(e.target.value) } })} />
                  <span className="muted">%</span>
                </span>
                <span className="hint">{CLASS_META[c].desc}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <span className={`chip ${Math.round(sum) === 100 ? "ok" : "bad"}`}>Total: {sum}% {Math.round(sum) === 100 ? "✓" : "(deve somar 100%)"}</span>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><h2>Modelos do Claude</h2><p className="muted small">Escolha o modelo e o esforço de raciocínio de cada tarefa. Mais esforço = mais preciso, porém mais lento e mais caro.</p></div></div>
          <div className="grid two">
            <ModelPicker title="Ler prints e arquivos" value={settings.extraction} models={config!.models} onChange={(extraction) => set({ extraction })}
              tip="Sonnet 5.5 com esforço médio costuma bastar. Suba o esforço se os valores saírem errados." />
            <ModelPicker title="Scan de melhores ativos" value={settings.scan} models={config!.models} onChange={(scan) => set({ scan })}
              tip="Pesquisa longa na web com análise de balanços: Opus 5.5 com esforço alto é um bom ponto de partida." />
            <ModelPicker title="Atualizar valores" value={settings.refresh} models={config!.models} onChange={(refresh) => set({ refresh })}
              tip="Ações, FIIs e ETFs usam cotação de mercado direto; o Claude só estima renda fixa e o que não tem cotação. Sonnet 5.5 médio basta." />
            <ModelPicker title="Projeção de cenários" value={settings.projection} models={config!.models} onChange={(projection) => set({ projection })}
              tip="Pesquisa macro e de longo prazo para definir premissas: Opus 5.5 com esforço alto." />
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Perfil do investidor</h2>
          <label className="field">
            <span className="hint">Usado pelo scan para calibrar as sugestões (horizonte, tolerância a risco, objetivos).</span>
            <textarea value={settings.investorProfile} onChange={(e) => set({ investorProfile: e.target.value })} />
          </label>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Câmbio</h2>
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ width: 200 }}>Dólar (R$)
              <input type="number" step="0.01" min="0" value={settings.usdBrl} onChange={(e) => set({ usdBrl: Number(e.target.value) })} />
            </label>
            <button className="btn" onClick={fetchFx}><RefreshCw size={15} /> Buscar cotação atual</button>
            {fxMsg && <span className="muted small">{fxMsg}</span>}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Dados</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>Tudo fica salvo no arquivo <code>data/state.json</code> do projeto. Prints e arquivos não são armazenados — só vão para a API da Anthropic na hora da leitura.</p>
          <div className="row wrap">
            <button className="btn" onClick={exportData}><Download size={15} /> Exportar backup</button>
            <button className="btn" onClick={() => file.current?.click()}><Upload size={15} /> Restaurar backup</button>
            <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = ""; }} />
            <button className="btn danger" onClick={() => { if (confirm("Apagar todas as posições e transações?")) update((s) => ({ ...s, positions: [], transactions: [] })); }}>
              <Trash2 size={15} /> Apagar posições e transações
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function ModelPicker({ title, value, models, onChange, tip }: {
  title: string; value: ModelSetting; models: { id: string; label: string; tier: string; hint: string }[];
  onChange: (v: ModelSetting) => void; tip: string;
}) {
  const current = models.find((m) => m.id === value.model);
  return (
    <div className="stack">
      <h3>{title}</h3>
      <label className="field">Modelo
        <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.tier}</option>)}
        </select>
        {current && <span className="hint">{current.hint}</span>}
      </label>
      <label className="field">Esforço
        <select value={value.effort} onChange={(e) => onChange({ ...value, effort: e.target.value as ModelSetting["effort"] })}>
          {EFFORTS.map((ef) => <option key={ef} value={ef}>{EFFORT_LABEL[ef]}</option>)}
        </select>
        <span className="hint">{tip}</span>
      </label>
    </div>
  );
}
