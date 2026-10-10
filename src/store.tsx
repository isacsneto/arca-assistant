import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type AppState, type Position, type ProjectionResult, type ScanResult, type View } from "../shared/types";
import { inView } from "../shared/owner";
import { aiSettings, isAiReady } from "../shared/ai";
import { api, type Config } from "./api";

interface Ctx {
  state: AppState | null;
  config: Config | null;
  loadError: string | null;
  saveError: string | null;
  update: (mutate: (s: AppState) => AppState) => void;
  setScan: (r: ScanResult) => void;
  setProjection: (r: ProjectionResult) => void;
  /** Visão atual: consolidado, só PF ou só PJ. */
  view: View;
  setView: (v: View) => void;
  /** Posições da visão atual. */
  visible: Position[];
  /** Busca de novo o status dos provedores de IA (após salvar chave, instalar CLI…). */
  refreshConfig: () => Promise<void>;
}

const VIEW_KEY = "arca:view";
function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "PF" || v === "PJ" ? v : "all";
  } catch {
    return "all";
  }
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<AppState | null>(null);
  const [view, setViewState] = useState<View>(readView);
  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sem storage: só não lembra a escolha */
    }
  }, []);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    Promise.all([api.getState(), api.getConfig()])
      .then(([s, c]) => {
        const merged: AppState = { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
        latest.current = merged;
        setState(merged);
        setConfig(c);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const persist = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!latest.current) return;
      api
        .putState(latest.current)
        .then(() => setSaveError(null))
        .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)));
    }, 350);
  }, []);

  const update = useCallback(
    (mutate: (s: AppState) => AppState) => {
      if (!latest.current) return;
      latest.current = mutate(latest.current);
      setState(latest.current);
      persist();
    },
    [persist],
  );

  const setScan = useCallback((r: ScanResult) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, scans: { ...latest.current.scans, [r.assetClass]: r } };
    setState(latest.current); // o servidor já persistiu o scan
  }, []);

  const setProjection = useCallback((projection: ProjectionResult) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, projection };
    setState(latest.current); // o servidor já persistiu a projeção
  }, []);

  const visible = useMemo(() => (state ? inView(state.positions, view) : []), [state, view]);

  // "IA pronta" é calculado aqui, com os ajustes atuais (trocar de provedor reflete na hora).
  const effectiveConfig = useMemo(
    () => (config && state ? { ...config, hasCredentials: isAiReady(aiSettings(state.settings), config.aiStatus) } : config),
    [config, state],
  );
  const refreshConfig = useCallback(async () => {
    setConfig(await api.getConfig(true));
  }, []);

  return (
    <StoreCtx.Provider value={{ state, config: effectiveConfig, loadError, saveError, update, setScan, setProjection, view, setView, visible, refreshConfig }}>
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("StoreProvider ausente");
  return c;
}
