import { useEffect, useState } from "react";
import {
  ArrowLeftRight, Hexagon, LineChart as LineChartIcon, Loader2, Radar, Scale,
  Settings as SettingsIcon, Upload, Wallet,
} from "lucide-react";
import type { ProjectionResult, RefreshResult } from "../shared/types";
import { useStore } from "./store";
import { useJob } from "./lib/useJob";
import { Banner } from "./components/ui";
import { Portfolio } from "./components/Portfolio";
import { Rebalance } from "./components/Rebalance";
import { ImportView } from "./components/ImportView";
import { ScanView } from "./components/ScanView";
import { ProjectionView } from "./components/ProjectionView";
import { Transactions } from "./components/Transactions";
import { SettingsView } from "./components/SettingsView";

const TABS = [
  { id: "portfolio", label: "Carteira", icon: Wallet },
  { id: "rebalance", label: "Rebalancear", icon: Scale },
  { id: "projection", label: "Projeção", icon: LineChartIcon },
  { id: "import", label: "Importar", icon: Upload },
  { id: "scan", label: "Scan de ativos", icon: Radar },
  { id: "tx", label: "Transações", icon: ArrowLeftRight },
  { id: "settings", label: "Ajustes", icon: SettingsIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function App() {
  const { state, config, loadError, saveError, setProjection } = useStore();
  const [tab, setTab] = useState<TabId>("portfolio");
  useEffect(() => {
    // Sem `return`: em Chrome novo scrollTo devolve uma Promise, que o React trataria como cleanup.
    window.scrollTo(0, 0);
  }, [tab]);

  // Tarefas longas ficam aqui para continuarem rodando ao trocar de aba.
  const refreshJob = useJob<RefreshResult>("/api/refresh");
  const projectionJob = useJob<ProjectionResult>("/api/projection", setProjection);

  if (loadError)
    return (
      <div className="main">
        <Banner kind="bad">
          Não foi possível conectar ao servidor ({loadError}). Rode <code>npm run dev</code> e recarregue.
        </Banner>
      </div>
    );
  if (!state || !config)
    return (
      <div className="main row muted">
        <Loader2 className="spin" size={18} /> Carregando…
      </div>
    );

  const busy: Partial<Record<TabId, boolean>> = { portfolio: refreshJob.running, projection: projectionJob.running };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Hexagon size={18} />
          </span>
          Arca Assistant
        </div>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            <Icon size={18} />
            {label}
            {busy[id] && <Loader2 size={14} className="spin" style={{ marginLeft: "auto" }} />}
          </button>
        ))}
        <div className="sidebar-foot">Filosofia: Arca (Primo Rico)<br />Dados salvos localmente.<br />IA: {config.account ?? "Claude Code"} (login local)</div>
      </nav>
      <main className="main">
        {!config.hasCredentials && (
          <Banner kind="warn">
            O Claude Code não está logado neste computador. Rode <code>claude auth login</code> no terminal e recarregue — sem isso,
            importar e escanear não funcionam.
          </Banner>
        )}
        {saveError && <Banner kind="bad">Falha ao salvar no servidor: {saveError}</Banner>}
        {tab === "portfolio" && <Portfolio goImport={() => setTab("import")} refreshJob={refreshJob} />}
        {tab === "rebalance" && <Rebalance goScan={() => setTab("scan")} />}
        {tab === "projection" && <ProjectionView job={projectionJob} />}
        {tab === "import" && <ImportView done={() => setTab("portfolio")} />}
        {/* Fica montado para o scan continuar mostrando progresso se você trocar de aba. */}
        <div hidden={tab !== "scan"}>
          <ScanView />
        </div>
        {tab === "tx" && <Transactions />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
