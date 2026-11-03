import { useEffect, useState } from "react";
import {
  Activity, ArrowLeftRight, CalendarCheck, Car, Ellipsis, Hexagon, FileText, HandCoins, History as HistoryIcon, Landmark, Receipt, Repeat, Target, LineChart as LineChartIcon, Loader2, Radar, Scale,
  Settings as SettingsIcon, Upload, Wallet,
} from "lucide-react";
import { HistoryView } from "./components/HistoryView";
import { ChatFab } from "./components/ChatView";
import { GoalsView } from "./components/GoalsView";
import { CashflowView } from "./components/CashflowView";
import { MonthlyPlanView } from "./components/MonthlyPlanView";
import { SubscriptionsView } from "./components/SubscriptionsView";
import { TaxView } from "./components/TaxView";
import { DebtsView } from "./components/DebtsView";
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
import { openFinanceSettings } from "../shared/openFinance";

// Rótulos são getters: L() só é avaliado na renderização (no idioma atual).
const TABS = [
  { id: "portfolio", get label() { return L("Carteira", "Portfolio"); }, icon: Wallet },
  { id: "market", get label() { return L("Mercado", "Market"); }, icon: Activity },
  { id: "rebalance", get label() { return L("Rebalancear", "Rebalance"); }, icon: Scale },
  { id: "history", get label() { return L("Histórico", "History"); }, icon: HistoryIcon },
  { id: "projection", get label() { return L("Projeção", "Projection"); }, icon: LineChartIcon },
  { id: "goals", get label() { return L("Metas", "Goals"); }, icon: Target },
  { id: "plan", get label() { return L("Contas do mês", "Monthly bills"); }, icon: CalendarCheck },
  { id: "subs", get label() { return L("Assinaturas", "Subscriptions"); }, icon: Repeat },
  { id: "cashflow", get label() { return L("Gastos", "Spending"); }, icon: Receipt },
  { id: "tax", get label() { return L("Imposto de Renda", "Income tax"); }, icon: FileText },
  { id: "debts", get label() { return L("Dívidas", "Debts"); }, icon: HandCoins },
  { id: "institutions", get label() { return L("Instituições", "Institutions"); }, icon: Landmark },
  { id: "assets", get label() { return L("Bens", "Assets"); }, icon: Car },
  { id: "import", get label() { return L("Importar", "Import"); }, icon: Upload },
  { id: "scan", get label() { return L("Scan de ativos", "Asset scan"); }, icon: Radar },
  { id: "tx", get label() { return L("Movimentações", "Activity"); }, icon: ArrowLeftRight },
  { id: "settings", get label() { return L("Ajustes", "Settings"); }, icon: SettingsIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];
/** Menu em grupos (16 telas numa lista só ficava difícil de achar). */
const GROUPS: { label: () => string; tabs: TabId[] }[] = [
  { label: () => L("Patrimônio", "Wealth"), tabs: ["portfolio", "history", "institutions", "assets", "debts"] },
  { label: () => L("Planejar", "Plan"), tabs: ["rebalance", "goals", "projection"] },
  { label: () => L("Dia a dia", "Everyday"), tabs: ["plan", "subs", "cashflow", "tax"] },
  { label: () => L("Inteligência", "Intelligence"), tabs: ["market", "scan"] },
  { label: () => L("Dados", "Data"), tabs: ["import", "tx", "settings"] },
];
/** No celular: abas da barra de baixo; o resto fica em "Mais". */
const PRIMARY: TabId[] = ["portfolio", "cashflow", "history", "rebalance"];
const SHORT = (): Partial<Record<TabId, string>> => ({ rebalance: L("Rebalancear", "Rebalance"), scan: "Scan", tax: "IR", tx: L("Movim.", "Activity") });

export function App() {
  const { state, config, loadError, saveError, setProjection, setResearch, view, setView, update } = useStore();
  const [importTarget, setImportTarget] = useState<{ institution: string; owner: Owner } | null>(null);
  const [importMode, setImportMode] = useState<"openfinance" | null>(null);

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
    <div className="sidebar-foot" title={`${L("Metodologia", "Method")}: ${state.settings.methodology === "custom" ? L("personalizada", "custom") : METHODOLOGIES[state.settings.methodology].label} · ${L("dados salvos só neste computador", "data saved only on this computer")}`}>
      {L("IA", "AI")}: {PROVIDERS[aiConf.provider].label} · {aiConf.auth === "apiKey" ? L("chave de API", "API key") : config.aiStatus?.[aiConf.provider]?.account ?? L("login local", "local login")}
      <div className="row" style={{ gap: 6, marginTop: 6 }} role="group" aria-label={L("Idioma", "Language")}>
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
        <div className="nav-scroll">
          {GROUPS.map((g) => (
            <div key={g.label()} className="nav-group">
              <div className="nav-group-title">{g.label()}</div>
              {g.tabs.map((id) => navButton(TABS.find((t) => t.id === id)!))}
            </div>
          ))}
        </div>
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
        {(() => {
          // Conexão do Open Finance sem a primeira importação revisada ainda não se atualiza sozinha.
          const of = state ? openFinanceSettings(state.settings.openFinance) : null;
          const waiting = of && of.sourceOfTruth && of.autoSync ? of.connections.filter((c) => !c.syncedAt).length : 0;
          return waiting > 0 && !(tab === "import" && importMode === "openfinance") ? (
            <Banner kind="warn">
              {L(
                `Open Finance: ${waiting} ${waiting === 1 ? "conexão aguarda" : "conexões aguardam"} a primeira importação. Revise uma vez e daí em diante tudo se atualiza sozinho.`,
                `Open Finance: ${waiting} connection${waiting === 1 ? " is" : "s are"} waiting for the first import. Review it once and from then on everything updates on its own.`,
              )}{" "}
              <button className="btn sm primary" onClick={() => { setImportMode("openfinance"); setTab("import"); }}>{L("Importar agora", "Import now")}</button>
            </Banner>
          ) : null;
        })()}
        {saveError && <Banner kind="bad">{L("Falha ao salvar no servidor", "Failed to save to the server")}: {saveError}</Banner>}
        {tab === "portfolio" && <Portfolio goImport={() => setTab("import")} goAssets={() => setTab("assets")} refreshJob={refreshJob} />}
        {tab === "market" && <MarketView job={researchJob} />}
        {tab === "rebalance" && <Rebalance goScan={() => setTab("scan")} />}
        {tab === "history" && <HistoryView />}
        {tab === "projection" && <ProjectionView job={projectionJob} />}
        {tab === "goals" && <GoalsView />}
        {tab === "plan" && <MonthlyPlanView />}
        {tab === "subs" && <SubscriptionsView />}
        {tab === "cashflow" && <CashflowView goSettings={() => setTab("settings")} />}
        {tab === "tax" && <TaxView goSettings={() => setTab("settings")} />}
        {tab === "debts" && <DebtsView />}
        {tab === "institutions" && <InstitutionsView />}
        {tab === "assets" && <AssetsView />}
        {tab === "import" && <ImportView key={importMode ?? "files"} initialMode={importMode ?? undefined} done={() => { setImportTarget(null); setImportMode(null); setTab("portfolio"); }} target={importTarget} goSettings={() => setTab("settings")} />}
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
            {GROUPS.map((g) => {
              const tabs = g.tabs.filter((id) => !PRIMARY.includes(id));
              return tabs.length ? (
                <div key={g.label()} className="nav-group">
                  <div className="nav-group-title">{g.label()}</div>
                  {tabs.map((id) => navButton(TABS.find((t) => t.id === id)!))}
                </div>
              ) : null;
            })}
            {footer}
          </div>
        </div>
      )}
      <RemindersDialog onUpdate={(t) => { setImportTarget(t); setTab("import"); }} />
      {/* "Pergunte à Arca": flutuante em todas as telas; sabe qual tela está aberta. */}
      <ChatFab screen={TABS.find((t) => t.id === tab)!.label} />
    </div>
  );
}
