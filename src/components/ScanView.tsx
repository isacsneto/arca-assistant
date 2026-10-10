import { useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Globe, Loader2, Radar, Search, Square } from "lucide-react";
import { ARCA_CLASSES, CLASS_META, EFFORT_LABEL, type ArcaClass, type ScanEvent, type ScanResult } from "../../shared/types";
import { runScan } from "../api";
import { useStore } from "../store";
import { dateTime, safeUrl } from "../lib/format";
import { Banner, ClassLabel, Empty, PageHead } from "./ui";
import { useAi } from "../lib/useAi";
import { L, getLang } from "../../shared/i18n";

/** Rótulo exibido da convicção (o valor salvo continua alta/media/baixa). */
const convictionLabel = (c: string) =>
  c === "alta" ? L("convicção alta", "high conviction") : c === "media" ? L("convicção media", "med. conviction") : c === "baixa" ? L("convicção baixa", "low conviction") : L(`convicção ${c}`, `conviction ${c}`);

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
  const ai = useAi();
  const modelLabel = ai.modelLabel("scan");

  const onEvent = (e: ScanEvent) => {
    if (e.type === "done") return;
    const c = e.assetClass;
    setProgress((p) => {
      const cur: Progress = p[c] ?? { status: "", lines: [], searches: 0, state: "running" };
      switch (e.type) {
        case "status": return { ...p, [c]: { ...cur, status: e.text } };
        case "search": return { ...p, [c]: { ...cur, status: L("Pesquisando na web…", "Searching the web…"), searches: cur.searches + 1, lines: [...cur.lines, `🔎 ${e.query}`].slice(-6) } };
        case "fetch": return { ...p, [c]: { ...cur, status: L("Lendo documento…", "Reading document…"), lines: [...cur.lines, `📄 ${e.url}`].slice(-6) } };
        case "result": return { ...p, [c]: { ...cur, status: L("Concluído", "Done"), state: "done" } };
        case "error": return { ...p, [c]: { ...cur, state: "error", error: e.message } };
      }
    });
    if (e.type === "result") setScan(e.result);
  };

  const start = async () => {
    setError(null);
    setRunning(true);
    setActive(selected[0]);
    setProgress(Object.fromEntries(selected.map((c) => [c, { status: L("Na fila…", "Queued…"), lines: [], searches: 0, state: "running" as const }])));
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
          Object.entries(p).map(([c, v]) => [c, v.state === "running" ? { ...v, state: "error", error: L("Interrompido antes de terminar.", "Interrupted before finishing.") } : v]),
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
        title={L("Scan de ativos", "Asset scan")}
        subtitle={L("A IA pesquisa na web balanços de empresas, relatórios de fundos e a situação fiscal do governo para sugerir as melhores opções de cada classe da Arca.",
          "The AI searches the web for company financial statements, fund reports and the government's fiscal situation to suggest the best options for each Arca class.")}
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
            <button className="btn" onClick={() => abort.current?.abort()}><Square size={14} /> {L("Parar", "Stop")}</button>
          ) : (
            <button className="btn primary" disabled={!selected.length || !config!.hasCredentials} onClick={start}>
              <Radar size={16} /> {selected.length === 4
                ? L("Escanear tudo", "Scan all")
                : L(`Escanear ${selected.length} categoria${selected.length > 1 ? "s" : ""}`, `Scan ${selected.length} ${selected.length > 1 ? "categories" : "category"}`)}
            </button>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {L("Modelo", "Model")}: {modelLabel} · {L("esforço", "effort")} {EFFORT_LABEL[scanSettings.effort].toLowerCase()} ({L("altere em Ajustes", "change it in Settings")}).{" "}
          {L(`Cada categoria faz dezenas de buscas e leva alguns minutos; usa o limite da sua assinatura${ai.viaApi ? " / créditos da sua chave de API" : ""} de ${ai.name} (até 2 categorias em paralelo).`,
            `Each category runs dozens of searches and takes a few minutes; it uses your ${ai.name} subscription limits${ai.viaApi ? " / API key credits" : ""} (up to 2 categories in parallel).`)}
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
          <div className="row"><Loader2 size={16} className="spin" /><b>{prog.status}</b><span className="muted small">· {prog.searches} {L("buscas", "searches")}</span></div>
          <div className="feed" style={{ marginTop: 10 }}>{prog.lines.map((l, i) => <div className="line" key={i}>{l}</div>)}</div>
        </div>
      )}
      {prog?.state === "error" && <Banner kind="bad">{L("Falha no scan de", "Scan failed for")} {CLASS_META[active].label}: {prog.error}</Banner>}

      {scan ? (
        <ScanReportView scan={scan} />
      ) : (
        prog?.state !== "running" && (
          <div className="card"><Empty title={L(`Nenhum scan de ${CLASS_META[active].label} ainda`, `No ${CLASS_META[active].label} scan yet`)}>{L("Escolha as categorias acima e clique em Escanear.", "Choose the categories above and click Scan.")}</Empty></div>
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
        {getLang() === "pt" ? (
          <>Análise gerada por IA com dados públicos da web, em {dateTime(scan.runAt)} (dados até {scan.dataAsOf}). Não é recomendação de investimento: confira os números nas fontes antes de decidir.</>
        ) : (
          <>AI-generated analysis using public web data, on {dateTime(scan.runAt)} (data as of {scan.dataAsOf}). Not investment advice: check the numbers in the sources before deciding.</>
        )}
      </Banner>

      <div className="card">
        <div className="card-head"><h2>{L("Resumo", "Summary")}</h2><span className="muted small">{scan.searches} {L("buscas", "searches")} · {scan.model}</span></div>
        <p className="prose">{scan.summary}</p>
        <h3 style={{ margin: "16px 0 6px" }}>{L("Cenário", "Scenario")}</h3>
        <p className="prose muted">{scan.macroContext}</p>
      </div>

      <div className="stack">
        {picks.map((p) => (
          <div className="pick" key={p.ticker + p.rank}>
            <div className="pick-head">
              <span className="rank">{p.rank}</span>
              <h2>{p.ticker}</h2>
              <span className="muted grow">{p.name}</span>
              <span className={`chip ${p.conviction === "alta" ? "ok" : p.conviction === "media" ? "warn" : ""}`}>{convictionLabel(p.conviction)}</span>
              <span className="chip">{((p.suggestedWeightInClass / totalW) * 100).toFixed(0)}% {L("da classe", "of class")}</span>
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
          <h2 style={{ marginBottom: 10 }}>{L("Evitar por enquanto", "Avoid for now")}</h2>
          <ul className="risks" style={{ marginTop: 0 }}>{scan.avoid.map((a, i) => <li key={i}><b>{a.ticker}</b> — {a.reason}</li>)}</ul>
        </div>
      )}

      {scan.portfolioNotes && (
        <div className="card"><h2 style={{ marginBottom: 8 }}>{L("Sobre a sua carteira", "About your portfolio")}</h2><p className="prose">{scan.portfolioNotes}</p></div>
      )}

      {scan.sources.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}><Globe size={15} style={{ verticalAlign: -2 }} /> {L("Fontes", "Sources")}</h2>
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
      <span className="muted small row"><Search size={13} /> {L("Rode o scan de novo sempre que quiser atualizar (balanços saem a cada trimestre).", "Run the scan again whenever you want to update (financial statements come out every quarter).")}</span>
    </div>
  );
}
