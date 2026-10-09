import { useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Globe, Loader2, Radar, Search, Square } from "lucide-react";
import { ARCA_CLASSES, CLASS_META, EFFORT_LABEL, type ArcaClass, type ScanEvent, type ScanResult } from "../../shared/types";
import { runScan } from "../api";
import { useStore } from "../store";
import { dateTime, safeUrl } from "../lib/format";
import { Banner, ClassLabel, Empty, PageHead } from "./ui";

interface Progress {
  status: string;
  lines: string[];
  searches: number;
  state: "running" | "done" | "error";
  error?: string;
}

export function ScanView() {
  const { state, config, setScan } = useStore();
  const [selected, setSelected] = useState<ArcaClass[]>([...ARCA_CLASSES]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Partial<Record<ArcaClass, Progress>>>({});
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ArcaClass>(() => ARCA_CLASSES.find((c) => state?.scans[c]) ?? "acoes");
  const abort = useRef<AbortController | null>(null);

  const scanSettings = state!.settings.scan;
  const modelLabel = config!.models.find((m) => m.id === scanSettings.model)?.label ?? scanSettings.model;

  const onEvent = (e: ScanEvent) => {
    if (e.type === "done") return;
    const c = e.assetClass;
    setProgress((p) => {
      const cur: Progress = p[c] ?? { status: "", lines: [], searches: 0, state: "running" };
      switch (e.type) {
        case "status": return { ...p, [c]: { ...cur, status: e.text } };
        case "search": return { ...p, [c]: { ...cur, status: "Pesquisando na web…", searches: cur.searches + 1, lines: [...cur.lines, `🔎 ${e.query}`].slice(-6) } };
        case "fetch": return { ...p, [c]: { ...cur, status: "Lendo documento…", lines: [...cur.lines, `📄 ${e.url}`].slice(-6) } };
        case "result": return { ...p, [c]: { ...cur, status: "Concluído", state: "done" } };
        case "error": return { ...p, [c]: { ...cur, state: "error", error: e.message } };
      }
    });
    if (e.type === "result") setScan(e.result);
  };

  const start = async () => {
    setError(null);
    setRunning(true);
    setActive(selected[0]);
    setProgress(Object.fromEntries(selected.map((c) => [c, { status: "Na fila…", lines: [], searches: 0, state: "running" as const }])));
    abort.current = new AbortController();
    try {
      await runScan(selected, onEvent, abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      // Categorias sem resultado (scan parado ou conexão caiu) não podem ficar "rodando" para sempre.
      setProgress((p) =>
        Object.fromEntries(
          Object.entries(p).map(([c, v]) => [c, v.state === "running" ? { ...v, state: "error", error: "Interrompido antes de terminar." } : v]),
        ),
      );
    }
  };

  const toggle = (c: ArcaClass) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const scan = state!.scans[active];
  const prog = progress[active];

  return (
    <>
      <PageHead
        title="Scan de ativos"
        subtitle="O Claude pesquisa na web balanços de empresas, relatórios de fundos e a situação fiscal do governo para sugerir as melhores opções de cada classe da Arca."
      />
      {error && <Banner kind="bad">{error}</Banner>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 18 }}>
          {ARCA_CLASSES.map((c) => (
            <label className="check" key={c}>
              <input type="checkbox" checked={selected.includes(c)} disabled={running} onChange={() => toggle(c)} />
              <ClassLabel c={c} />
            </label>
          ))}
          <div className="grow" />
          {running ? (
            <button className="btn" onClick={() => abort.current?.abort()}><Square size={14} /> Parar</button>
          ) : (
            <button className="btn primary" disabled={!selected.length || !config!.hasCredentials} onClick={start}>
              <Radar size={16} /> Escanear {selected.length === 4 ? "tudo" : `${selected.length} categoria${selected.length > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Modelo: {modelLabel} · esforço {EFFORT_LABEL[scanSettings.effort].toLowerCase()} (altere em Ajustes). Cada categoria faz dezenas de buscas e leva alguns minutos; usa o limite da sua assinatura do Claude (até 2 categorias em paralelo).
        </p>
      </div>

      <div className="tabs">
        {ARCA_CLASSES.map((c) => (
          <button key={c} className={`tab ${active === c ? "active" : ""}`} onClick={() => setActive(c)}>
            <ClassLabel c={c} />
            {progress[c]?.state === "running" && <Loader2 size={14} className="spin" />}
            {progress[c]?.state === "error" && <AlertTriangle size={14} color="var(--bad)" />}
          </button>
        ))}
      </div>

      {prog?.state === "running" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row"><Loader2 size={16} className="spin" /><b>{prog.status}</b><span className="muted small">· {prog.searches} buscas</span></div>
          <div className="feed" style={{ marginTop: 10 }}>{prog.lines.map((l, i) => <div className="line" key={i}>{l}</div>)}</div>
        </div>
      )}
      {prog?.state === "error" && <Banner kind="bad">Falha no scan de {CLASS_META[active].label}: {prog.error}</Banner>}

      {scan ? (
        <ScanReportView scan={scan} />
      ) : (
        prog?.state !== "running" && (
          <div className="card"><Empty title={`Nenhum scan de ${CLASS_META[active].label} ainda`}>Escolha as categorias acima e clique em Escanear.</Empty></div>
        )
      )}
    </>
  );
}

function ScanReportView({ scan }: { scan: ScanResult }) {
  const totalW = scan.picks.reduce((s, p) => s + p.suggestedWeightInClass, 0) || 1;
  const picks = [...scan.picks].sort((a, b) => a.rank - b.rank);
  return (
    <div className="stack-lg">
      <Banner kind="warn">
        Análise gerada por IA com dados públicos da web, em {dateTime(scan.runAt)} (dados até {scan.dataAsOf}). Não é recomendação de investimento: confira os números nas fontes antes de decidir.
      </Banner>

      <div className="card">
        <div className="card-head"><h2>Resumo</h2><span className="muted small">{scan.searches} buscas · {scan.model}</span></div>
        <p className="prose">{scan.summary}</p>
        <h3 style={{ margin: "16px 0 6px" }}>Cenário</h3>
        <p className="prose muted">{scan.macroContext}</p>
      </div>

      <div className="stack">
        {picks.map((p) => (
          <div className="pick" key={p.ticker + p.rank}>
            <div className="pick-head">
              <span className="rank">{p.rank}</span>
              <h2>{p.ticker}</h2>
              <span className="muted grow">{p.name}</span>
              <span className={`chip ${p.conviction === "alta" ? "ok" : p.conviction === "media" ? "warn" : ""}`}>convicção {p.conviction}</span>
              <span className="chip">{((p.suggestedWeightInClass / totalW) * 100).toFixed(0)}% da classe</span>
            </div>
            <p className="prose" style={{ marginTop: 10 }}>{p.thesis}</p>
            {p.keyMetrics.length > 0 && (
              <div className="metrics">{p.keyMetrics.map((m, i) => <span className="metric" key={i}>{m.label}: <b>{m.value}</b></span>)}</div>
            )}
            {p.risks.length > 0 && <ul className="risks">{p.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          </div>
        ))}
      </div>

      {scan.avoid.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Evitar por enquanto</h2>
          <ul className="risks" style={{ marginTop: 0 }}>{scan.avoid.map((a, i) => <li key={i}><b>{a.ticker}</b> — {a.reason}</li>)}</ul>
        </div>
      )}

      {scan.portfolioNotes && (
        <div className="card"><h2 style={{ marginBottom: 8 }}>Sobre a sua carteira</h2><p className="prose">{scan.portfolioNotes}</p></div>
      )}

      {scan.sources.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}><Globe size={15} style={{ verticalAlign: -2 }} /> Fontes</h2>
          <div className="stack" style={{ gap: 6 }}>
            {scan.sources.map((s, i) => {
              const href = safeUrl(s.url);
              return href ? (
                <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="row small">
                  <ExternalLink size={13} /> {s.title || href}
                </a>
              ) : (
                <span key={i} className="small muted">{s.title || s.url}</span>
              );
            })}
          </div>
        </div>
      )}
      <span className="muted small row"><Search size={13} /> Rode o scan de novo sempre que quiser atualizar (balanços saem a cada trimestre).</span>
    </div>
  );
}
