import { useRef, useState } from "react";
import { BASE_CURRENCY, CURRENCIES, CURRENCY_CODES, FX_CODES } from "../../shared/currency";
import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  ARCA_CLASSES, CLASS_META, EFFORTS, EFFORT_LABEL, METHODOLOGIES, methodologyOf,
  type AppState, type ModelSetting, type Settings,
} from "../../shared/types";
import { targetsSum } from "../../shared/arca";
import { api } from "../api";
import { AiProviderSettings } from "./AiProviderSettings";
import { OpenFinanceSettings } from "./OpenFinanceSettings";
import { aiSettings } from "../../shared/ai";
import { useStore } from "../store";
import { Banner, ClassDot, PageHead } from "./ui";
import { L, LANGS, getLang, type Lang } from "../../shared/i18n";

export function SettingsView() {
  const { state, config, update } = useStore();
  const settings = state!.settings;
  const isClaude = aiSettings(settings).provider === "claude";
  const [fxMsg, setFxMsg] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const sum = targetsSum(settings.targets);

  const fetchFx = async () => {
    try {
      const { fx } = await api.getFx();
      const rounded = Object.fromEntries(Object.entries(fx).map(([c, v]) => [c, Math.round(Number(v) * 10000) / 10000]));
      set({ fx: { ...settings.fx, ...rounded } });
      setFxMsg(L("Cotações atualizadas.", "Exchange rates updated."));
    } catch (e) {
      setFxMsg(e instanceof Error ? e.message : L("Falhou.", "Failed."));
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
      if (!Array.isArray(data.positions) || !data.settings) throw new Error(L("Arquivo de backup inválido.", "Invalid backup file."));
      update((s) => ({
        ...s,
        positions: data.positions!,
        transactions: data.transactions ?? [],
        assets: data.assets ?? s.assets,
        settings: { ...s.settings, ...data.settings },
      }));
      setMsg({ kind: "ok", text: L("Backup restaurado.", "Backup restored.") });
    } catch (e) {
      setMsg({ kind: "bad", text: e instanceof Error ? e.message : L("Falha ao ler o backup.", "Failed to read the backup.") });
    }
  };

  return (
    <>
      <PageHead title={L("Ajustes", "Settings")} />
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="stack-lg">
        <section className="card">
          <h2 style={{ marginBottom: 6 }}>Language / Idioma</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>
            {L("A IA também escreve os textos dela (scans, projeções, perguntas) neste idioma.",
              "The AI also writes its texts (scans, projections, questions) in this language.")}
          </p>
          <div className="seg" role="radiogroup" aria-label="Language / Idioma">
            {(Object.keys(LANGS) as Lang[]).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={getLang() === l} className={getLang() === l ? "active" : ""}
                onClick={() => set({ language: l })}>
                {LANGS[l].label}
              </button>
            ))}
          </div>
        </section>

        <AiProviderSettings />

        <OpenFinanceSettings />

        <section className="card">
          <div className="card-head">
            <div>
              <h2>{L("Metodologia de alocação", "Allocation method")}</h2>
              <p className="muted small">{L("Define as metas de cada classe usadas na Carteira, no Rebalancear e no Scan. Escolha uma pronta ou ajuste os percentuais.", "Sets the target for each class used in Portfolio, Rebalance and Scan. Pick a preset or adjust the percentages.")}</p>
            </div>
          </div>
          <div className="methods" role="radiogroup" aria-label={L("Metodologia", "Method")}>
            {(Object.keys(METHODOLOGIES) as (keyof typeof METHODOLOGIES)[]).map((k) => {
              const m = METHODOLOGIES[k];
              return (
                <button key={k} type="button" role="radio" aria-checked={settings.methodology === k}
                  className={"method" + (settings.methodology === k ? " active" : "")}
                  onClick={() => set({ methodology: k, targets: { ...m.targets } })}>
                  <b>{m.label}</b>
                  <span className="num small">{ARCA_CLASSES.map((c) => m.targets[c]).join(" / ")}</span>
                  <span className="muted small">{m.desc}</span>
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={settings.methodology === "custom"}
              className={"method" + (settings.methodology === "custom" ? " active" : "")}
              onClick={() => set({ methodology: "custom" })}>
              <b>{L("Personalizada", "Custom")}</b>
              <span className="num small">{ARCA_CLASSES.map((c) => settings.targets[c]).join(" / ")}</span>
              <span className="muted small">{L("Seus próprios percentuais — edite abaixo.", "Your own percentages — edit below.")}</span>
            </button>
          </div>
          <p className="muted small" style={{ margin: "12px 0 8px" }}>{L("Ordem", "Order")}: {ARCA_CLASSES.map((c) => CLASS_META[c].label).join(" / ")}. {L('Alterar qualquer valor muda para "Personalizada".', 'Changing any value switches to "Custom".')}</p>
          <div className="grid kpis">
            {ARCA_CLASSES.map((c) => (
              <label className="field" key={c}>
                <span className="row"><ClassDot c={c} />{CLASS_META[c].label}</span>
                <span className="row">
                  <input type="number" min="0" max="100" step="1" value={settings.targets[c]}
                    onChange={(e) => {
                      const targets = { ...settings.targets, [c]: Number(e.target.value) };
                      set({ targets, methodology: methodologyOf(targets) });
                    }} />
                  <span className="muted">%</span>
                </span>
                <span className="hint">{CLASS_META[c].desc}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <span className={`chip ${Math.round(sum) === 100 ? "ok" : "bad"}`}>Total: {sum}% {Math.round(sum) === 100 ? "✓" : L("(deve somar 100%)", "(must add up to 100%)")}</span>
          </div>
          <label className="check setting-check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={settings.cryptoAsInternational} onChange={(e) => set({ cryptoAsInternational: e.target.checked })} />
            <span>
              <b>{L("Considerar cripto como Internacional", "Count crypto as International")}</b>
              <span className="hint">
                {settings.cryptoAsInternational
                  ? L(
                      "Ligado: Bitcoin, Ethereum, ETFs de cripto (HASH11, QBTC11…) e outras criptos entram na classe Internacional — contam na alocação, no rebalanceamento, no scan e na projeção.",
                      "On: Bitcoin, Ethereum, crypto ETFs (HASH11, QBTC11…) and other crypto count in the International class — in allocation, rebalancing, scan and projection.",
                    )
                  : L(
                      "Desligado: cripto fica em Fora da Arca e não entra no rebalanceamento.",
                      "Off: crypto stays Outside the Arca and is not included in rebalancing.",
                    )}{" "}
                {L("A classe salva de cada posição não muda; dá para alternar quando quiser.", "Each position's saved class doesn't change; you can switch any time.")}
              </span>
            </span>
          </label>
        </section>

        <section className="card">
          <div className="card-head"><div>
            <h2>{isClaude ? L("Modelos do Claude", "Claude models") : L("Esforço por tarefa", "Effort per task")}</h2>
            <p className="muted small">
              {isClaude
                ? L("Escolha o modelo e o esforço de raciocínio de cada tarefa. Mais esforço = mais preciso, porém mais lento e mais caro.", "Choose the model and reasoning effort for each task. More effort = more accurate, but slower and more expensive.")
                : L("Quanto a IA raciocina em cada tarefa (os modelos do provedor ficam na seção acima). Mais esforço = mais preciso, porém mais lento.", "How much the AI reasons on each task (the provider's models are in the section above). More effort = more accurate, but slower.")}
            </p>
          </div></div>
          <div className="grid two">
            <ModelPicker showModel={isClaude} title={L("Ler prints e arquivos", "Read screenshots and files")} value={settings.extraction} models={config!.models} onChange={(extraction) => set({ extraction })}
              tip={L("Sonnet 5.5 com esforço médio costuma bastar. Suba o esforço se os valores saírem errados.", "Sonnet 5.5 with medium effort is usually enough. Raise the effort if values come out wrong.")} />
            <ModelPicker showModel={isClaude} title={L("Scan de melhores ativos", "Best-asset scan")} value={settings.scan} models={config!.models} onChange={(scan) => set({ scan })}
              tip={L("Pesquisa longa na web com análise de balanços: Opus 5.5 com esforço alto é um bom ponto de partida.", "Long web research with financial statement analysis: Opus 5.5 with high effort is a good starting point.")} />
            <ModelPicker showModel={isClaude} title={L("Atualizar valores", "Update values")} value={settings.refresh} models={config!.models} onChange={(refresh) => set({ refresh })}
              tip={L("Ações, FIIs e ETFs usam cotação de mercado direto; a IA só estima renda fixa e o que não tem cotação. Sonnet 5.5 médio basta.", "Stocks, FIIs and ETFs use market quotes directly; the AI only estimates fixed income and what has no quote. Sonnet 5.5 medium is enough.")} />
            <ModelPicker showModel={isClaude} title={L("Estimar valor dos bens", "Estimate asset values")} value={settings.estimate} models={config!.models} onChange={(estimate) => set({ estimate })}
              tip={L("Pesquisa anúncios de novos e usados (FIPE, OLX, Mercado Livre…): Sonnet 5.5 médio é suficiente.", "Searches new and used listings (FIPE, OLX, Mercado Livre…): Sonnet 5.5 medium is enough.")} />
            <ModelPicker showModel={isClaude} title={L("Projeção de cenários", "Scenario projection")} value={settings.projection} models={config!.models} onChange={(projection) => set({ projection })}
              tip={L("Pesquisa macro e de longo prazo para definir premissas: Opus 5.5 com esforço alto.", "Macro and long-term research to set assumptions: Opus 5.5 with high effort.")} />
            <ModelPicker showModel={isClaude} title={L("Pesquisa de ativo (Mercado)", "Asset research (Market)")} value={settings.research} models={config!.models} onChange={(research) => set({ research })}
              tip={L("Análise completa de um ativo (balanços, qualidade, macro e geopolítica, cenários): Opus 5.5 com esforço alto.", "Full analysis of one asset (financials, quality, macro and geopolitics, scenarios): Opus 5.5 with high effort.")} />
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 6 }}>{L("Lembretes de atualização", "Update reminders")}</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>
            {L("De tempos em tempos o app pergunta, ao abrir, se está tudo atualizado. Instituições marcadas como desatualizadas (na aba Instituições) aparecem sempre que você abre o app.", "Every so often the app asks, when it opens, whether everything is up to date. Institutions marked as outdated (in the Institutions tab) show up every time you open the app.")}
          </p>
          <label className="field" style={{ maxWidth: 280 }}>
            {L("Perguntar se está tudo atualizado", "Ask whether everything is up to date")}
            <select value={settings.reviewIntervalDays} onChange={(e) => set({ reviewIntervalDays: Number(e.target.value) as 0 | 7 | 14 })}>
              <option value={7}>{L("Toda semana", "Every week")}</option>
              <option value={14}>{L("A cada 2 semanas", "Every 2 weeks")}</option>
              <option value={0}>{L("Nunca", "Never")}</option>
            </select>
          </label>
          {settings.staleInstitutions.length > 0 && (
            <p className="small" style={{ marginTop: 10 }}>
              {L("Desatualizadas agora", "Outdated now")}: {settings.staleInstitutions.map((m) => `${m.institution} (${m.owner})`).join(", ")}.
            </p>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>{L("Perfil do investidor", "Investor profile")}</h2>
          <label className="field">
            <span className="hint">{L("Usado pelo scan para calibrar as sugestões (horizonte, tolerância a risco, objetivos).", "Used by the scan to calibrate suggestions (horizon, risk tolerance, goals).")}</span>
            <textarea value={settings.investorProfile} onChange={(e) => set({ investorProfile: e.target.value })} />
          </label>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 6 }}>{L("Moeda e câmbio", "Currency & exchange rates")}</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>
            {L(
              "Cada posição continua na própria moeda; totais, gráficos, rebalanceamento e projeção são mostrados na moeda escolhida aqui, convertidos pelas cotações abaixo (atualizadas também no Atualizar valores).",
              "Each position keeps its own currency; totals, charts, rebalancing and projection are shown in the currency chosen here, converted with the rates below (also refreshed by Update values).",
            )}
          </p>
          <div className="field" style={{ marginBottom: 14 }}>
            {L("Mostrar valores em", "Show amounts in")}
            <div className="seg" role="radiogroup" aria-label={L("Moeda de exibição", "Display currency")}>
              {CURRENCY_CODES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={settings.displayCurrency === c}
                  className={settings.displayCurrency === c ? "active" : ""} onClick={() => set({ displayCurrency: c })}>
                  {CURRENCIES[c].symbol} · {CURRENCIES[c].name}
                </button>
              ))}
            </div>
          </div>
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            {FX_CODES.map((c) => (
              <label className="field" style={{ width: 200 }} key={c}>
                {CURRENCIES[c].name} ({CURRENCIES[c].symbol} 1 = {CURRENCIES[BASE_CURRENCY].symbol})
                <input type="number" step="0.0001" min="0" value={settings.fx[c] ?? ""}
                  onChange={(e) => set({ fx: { ...settings.fx, [c]: Number(e.target.value) } })} />
              </label>
            ))}
            <button className="btn" onClick={fetchFx}><RefreshCw size={15} /> {L("Buscar cotações atuais", "Fetch current rates")}</button>
            {fxMsg && <span className="muted small">{fxMsg}</span>}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>{L("Dados", "Data")}</h2>
          <p className="muted small" style={{ marginBottom: 12 }}>{L("Tudo fica salvo no arquivo", "Everything is saved in the project's")} <code>data/state.json</code> {L("do projeto. Prints e arquivos não são armazenados — só vão para a IA escolhida na hora da leitura.", "file. Screenshots and files are not stored — they only go to the chosen AI when being read.")}</p>
          <div className="row wrap">
            <button className="btn" onClick={exportData}><Download size={15} /> {L("Exportar backup", "Export backup")}</button>
            <button className="btn" onClick={() => file.current?.click()}><Upload size={15} /> {L("Restaurar backup", "Restore backup")}</button>
            <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = ""; }} />
            <button className="btn danger" onClick={() => { if (confirm(L("Apagar todas as posições e transações?", "Delete all positions and transactions?"))) update((s) => ({ ...s, positions: [], transactions: [] })); }}>
              <Trash2 size={15} /> {L("Apagar posições e transações", "Delete positions and transactions")}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function ModelPicker({ title, value, models, onChange, tip, showModel = true }: {
  showModel?: boolean;
  title: string; value: ModelSetting; models: { id: string; label: string; tier: string; hint: string }[];
  onChange: (v: ModelSetting) => void; tip: string;
}) {
  const current = models.find((m) => m.id === value.model);
  return (
    <div className="stack">
      <h3>{title}</h3>
      {showModel && (
        <label className="field">{L("Modelo", "Model")}
          <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.tier}</option>)}
          </select>
          {current && <span className="hint">{current.hint}</span>}
        </label>
      )}
      <label className="field">{L("Esforço", "Effort")}
        <select value={value.effort} onChange={(e) => onChange({ ...value, effort: e.target.value as ModelSetting["effort"] })}>
          {EFFORTS.map((ef) => <option key={ef} value={ef}>{EFFORT_LABEL[ef]}</option>)}
        </select>
        {showModel && <span className="hint">{tip}</span>}
      </label>
    </div>
  );
}
