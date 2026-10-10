import { useEffect, useState } from "react";
import {
  Activity, ArrowLeftRight, Car, Ellipsis, Hexagon, Landmark, LineChart as LineChartIcon, Loader2, Radar, Scale,
  Settings as SettingsIcon, Upload, Wallet,
} from "lucide-react";
import type { ProjectionResult, RefreshResult, ResearchResult } from "../shared/types";
import { MarketView } from "./components/MarketView";
import { useStore } from "./store";
import { useJob } from "./lib/useJob";
import { Banner } from "./components/ui";
import { Portfolio } from "./components/Portfolio";
import { Rebalance } from "./components/Rebalance";
import { ImportView } from "./components/ImportView";
import { ScanView } from "./components/ScanView";
import { ProjectionView } from "./components/ProjectionView";
import { InstitutionsView } from "./components/InstitutionsView";
import { AssetsView } from "./components/AssetsView";
import { METHODOLOGIES, type Owner, type View } from "../shared/types";
import { PROVIDERS, aiSettings } from "../shared/ai";
import { RemindersDialog } from "./components/RemindersDialog";
import { Transactions } from "./components/Transactions";
import { SettingsView } from "./components/SettingsView";
import { L, LANGS, getLang, type Lang } from "../shared/i18n";

// Rótulos são getters: L() só é avaliado na renderização (no idioma atual).
const TABS = [
  { id: "portfolio", get label() { return L("Carteira", "Portfolio"); }, icon: Wallet },
  { id: "market", get label() { return L("Mercado", "Market"); }, icon: Activity },
  { id: "rebalance", get label() { return L("Rebalancear", "Rebalance"); }, icon: Scale },
  { id: "projection", get label() { return L("Projeção", "Projection"); }, icon: LineChartIcon },
  { id: "institutions", get label() { return L("Instituições", "Institutions"); }, icon: Landmark },
  { id: "assets", get label() { return L("Bens", "Assets"); }, icon: Car },
  { id: "import", get label() { return L("Importar", "Import"); }, icon: Upload },
  { id: "scan", get label() { return L("Scan de ativos", "Asset scan"); }, icon: Radar },
  { id: "tx", get label() { return L("Transações", "Transactions"); }, icon: ArrowLeftRight },
  { id: "settings", get label() { return L("Ajustes", "Settings"); }, icon: SettingsIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];
/** No celular: abas da barra de baixo; o resto fica em "Mais". */
const PRIMARY: TabId[] = ["portfolio", "rebalance", "import", "projection"];
const SHORT = (): Partial<Record<TabId, string>> => ({ rebalance: L("Rebalancear", "Rebalance"), scan: "Scan" });

export function App() {
  const { state, config, loadError, saveError, setProjection, setResearch, view, setView, update } = useStore();
  const [importTarget, setImportTarget] = useState<{ institution: string; owner: Owner } | null>(null);

  // Primeiro uso: começa a contar o prazo da revisão periódica a partir de hoje.
  const needsReviewStart = state != null && state.settings.lastReviewAt == null;
  useEffect(() => {
    if (needsReviewStart) update((s) => ({ ...s, settings: { ...s.settings, lastReviewAt: new Date().toISOString() } }));
  }, [needsReviewStart, update]);
  const [tab, setTabState] = useState<TabId>("portfolio");
  const [moreOpen, setMoreOpen] = useState(false);
  const setTab = (t: TabId) => {
    setTabState(t);
    setMoreOpen(false);
  };
  useEffect(() => {
    // Sem `return`: em Chrome novo scrollTo devolve uma Promise, que o React trataria como cleanup.
    window.scrollTo(0, 0);
  }, [tab]);

  // Tarefas longas ficam aqui para continuarem rodando ao trocar de aba.
  const refreshJob = useJob<RefreshResult>("/api/refresh");
  const projectionJob = useJob<ProjectionResult>("/api/projection", setProjection);
  const researchJob = useJob<ResearchResult>("/api/research", setResearch);

  if (loadError)
    return (
      <div className="main">
        <Banner kind="bad">
          {L("Não foi possível conectar ao servidor", "Could not connect to the server")} ({loadError}). {L("Rode", "Run")} <code>npm run dev</code> {L("e recarregue.", "and reload.")}
        </Banner>
      </div>
    );
  if (!state || !config)
    return (
      <div className="main row muted">
        <Loader2 className="spin" size={18} /> {L("Carregando…", "Loading…")}
      </div>
    );

  const aiConf = aiSettings(state.settings);
  const busy: Partial<Record<TabId, boolean>> = { portfolio: refreshJob.running, projection: projectionJob.running, market: researchJob.running };
  const viewSwitch = (
    <div className="seg view-switch" role="group" aria-label={L("Visão da carteira", "Portfolio view")}>
      {(["all", "PF", "PJ"] as View[]).map((v) => (
        <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)} title={v === "all" ? "PF + PJ" : undefined}>
          {v === "all" ? L("Consolidado", "All") : v}
        </button>
      ))}
    </div>
  );
  const lang = getLang();
  const setLanguage = (language: Lang) => update((s) => ({ ...s, settings: { ...s.settings, language } }));
  const footer = (
    <div className="sidebar-foot">
      {L("Metodologia", "Method")}: {state.settings.methodology === "custom" ? L("personalizada", "custom") : METHODOLOGIES[state.settings.methodology].label}<br />
      {L("Dados salvos localmente.", "Data saved locally.")}<br />
      {L("IA", "AI")}: {PROVIDERS[aiConf.provider].label} · {aiConf.auth === "apiKey" ? L("chave de API", "API key") : config.aiStatus?.[aiConf.provider]?.account ?? L("login local", "local login")}
      <div className="row" style={{ gap: 6, marginTop: 8 }} role="group" aria-label={L("Idioma", "Language")}>
        {(Object.keys(LANGS) as Lang[]).map((l, i) => (
          <span key={l} className="row" style={{ gap: 6 }}>
            {i > 0 && <span aria-hidden>·</span>}
            <button type="button" onClick={() => setLanguage(l)} aria-pressed={lang === l} title={LANGS[l].label}
              style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit", color: lang === l ? "var(--accent)" : "inherit", fontWeight: lang === l ? 600 : 400 }}>
              {l.toUpperCase()}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
  const navButton = ({ id, label, icon: Icon }: (typeof TABS)[number]) => (
    <button key={id} className={`nav-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
      <Icon size={18} />
      {label}
      {busy[id] && <Loader2 size={14} className="spin" style={{ marginLeft: "auto" }} />}
    </button>
  );

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Hexagon size={18} />
          </span>
          Arca Assistant
        </div>
        {viewSwitch}
        {TABS.map(navButton)}
        {footer}
      </nav>
      {/* Celular: topo compacto com a visão PF/PJ */}
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Hexagon size={15} /></span>Arca</div>
        {viewSwitch}
      </header>
      <main className="main">
        {!config.hasCredentials && (
          <Banner kind="warn">
            {L("A IA", "The AI")} ({PROVIDERS[aiConf.provider].label}, {aiConf.auth === "apiKey" ? L("chave de API", "API key") : L("login local", "local login")}) {L("não está pronta", "is not ready")} —{" "}
            {aiConf.auth === "apiKey"
              ? L("cadastre a chave de API", "add the API key")
              : !config.aiStatus?.[aiConf.provider]?.installed
                ? L("o CLI não está instalado", "the CLI is not installed")
                : <>{L("rode", "run")} <code>{PROVIDERS[aiConf.provider].loginCmd}</code> {L("no terminal", "in the terminal")}</>}
            . {L("Sem isso, importar, escanear e projetar não funcionam.", "Without it, importing, scanning and projecting don't work.")}{" "}
            <button className="btn sm" onClick={() => setTab("settings")}>{L("Configurar IA", "Set up AI")}</button>
          </Banner>
        )}
        {saveError && <Banner kind="bad">{L("Falha ao salvar no servidor", "Failed to save to the server")}: {saveError}</Banner>}
        {tab === "portfolio" && <Portfolio goImport={() => setTab("import")} goAssets={() => setTab("assets")} refreshJob={refreshJob} />}
        {tab === "market" && <MarketView job={researchJob} />}
        {tab === "rebalance" && <Rebalance goScan={() => setTab("scan")} />}
        {tab === "projection" && <ProjectionView job={projectionJob} />}
        {tab === "institutions" && <InstitutionsView />}
        {tab === "assets" && <AssetsView />}
        {tab === "import" && <ImportView done={() => { setImportTarget(null); setTab("portfolio"); }} target={importTarget} goSettings={() => setTab("settings")} />}
        {/* Fica montado para o scan continuar mostrando progresso se você trocar de aba. */}
        <div hidden={tab !== "scan"}>
          <ScanView />
        </div>
        {tab === "tx" && <Transactions />}
        {tab === "settings" && <SettingsView />}
      </main>
      {/* Celular: barra de abas + folha "Mais" */}
      <nav className="tabbar" aria-label={L("Navegação", "Navigation")}>
        {TABS.filter((t) => PRIMARY.includes(t.id)).map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id && !moreOpen ? "active" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            <Icon size={22} strokeWidth={tab === id ? 2.3 : 1.8} />
            {SHORT()[id] ?? label}
            {busy[id] && <span className="busy-dot" />}
          </button>
        ))}
        <button className={!PRIMARY.includes(tab) || moreOpen ? "active" : ""} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
          <Ellipsis size={22} />
          {PRIMARY.includes(tab) ? L("Mais", "More") : (SHORT()[tab] ?? TABS.find((t) => t.id === tab)!.label)}
        </button>
      </nav>
      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-label={L("Mais opções", "More options")} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            {TABS.filter((t) => !PRIMARY.includes(t.id)).map(navButton)}
            {footer}
          </div>
        </div>
      )}
      <RemindersDialog onUpdate={(t) => { setImportTarget(t); setTab("import"); }} />
    </div>
  );
}
