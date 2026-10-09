import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import type { ExtractedItem } from "../../shared/types";
import { CLASS_META, OWNERS, type Owner } from "../../shared/types";
import { parseFileName } from "../../shared/fileHints";
import { mergeImport, posKey } from "../../shared/importMerge";
import { api } from "../api";
import { useStore } from "../store";
import { prepareFile, type PreparedFile } from "../lib/files";
import { money, uid } from "../lib/format";
import { Banner, ClassSelect, PageHead } from "./ui";

interface Draft extends ExtractedItem {
  _id: string;
  include: boolean;
}

export function ImportView({ done }: { done: () => void }) {
  const { state, update, config, view } = useStore();
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [removeStale, setRemoveStale] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const addFiles = useCallback(async (list: File[]) => {
    setError(null);
    const results = await Promise.allSettled(list.map(prepareFile));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const bad = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
    if (bad.length) setError(bad.join(" "));
    setFiles((prev) => [...prev, ...ok]);
  }, []);

  // Ctrl+V de prints direto da área de transferência
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.files ?? [])];
      if (fs.length) {
        e.preventDefault();
        void addFiles(fs);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  useEffect(() => () => abort.current?.abort(), []);

  const process = async () => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const res = await api.importFiles(
        files.map(({ id: _id, preview: _p, size: _s, ...f }) => f),
        abort.current.signal,
      );
      setDrafts(res.items.map((it) => ({ ...it, _id: uid(), include: it.confidence !== "baixa" })));
      setWarnings(res.warnings);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const positions = useMemo(() => drafts?.filter((d) => d.kind === "position") ?? [], [drafts]);
  const txs = useMemo(() => drafts?.filter((d) => d.kind === "transaction") ?? [], [drafts]);
  const existing = useMemo(() => new Set(state!.positions.map((p) => posKey(p.owner, p.institution, p.ticker, p.name))), [state]);
  // Sem PF/PJ no arquivo nem no documento: usa a visão atual (ou PF no consolidado).
  const fallbackOwner: Owner = view === "PJ" ? "PJ" : "PF";

  const patch = (id: string, changes: Partial<Draft>) =>
    setDrafts((ds) => ds!.map((d) => (d._id === id ? { ...d, ...changes } : d)));

  const commit = () => {
    if (!drafts) return;
    const chosen = drafts.filter((d) => d.include).map(({ _id: _i, include: _c, ...item }) => item);
    update((s) => ({
      ...s,
      ...mergeImport(s, chosen, { removeStale, now: new Date().toISOString(), newId: uid, defaultOwner: fallbackOwner }),
    }));
    done();
  };

  /* ---------------- revisão ---------------- */
  if (drafts) {
    const included = drafts.filter((d) => d.include).length;
    return (
      <>
        <PageHead
          title="Revisar importação"
          subtitle="Confira o que o Claude leu. Edite o que precisar antes de salvar."
          actions={
            <>
              <button className="btn" onClick={() => setDrafts(null)}>Voltar</button>
              <button className="btn primary" disabled={!included} onClick={commit}>Salvar {included} itens</button>
            </>
          }
        />
        {warnings.length > 0 && (
          <Banner kind="warn">
            <b>Avisos do Claude:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Banner>
        )}
        {drafts.length === 0 && <Banner kind="warn">Nenhum dado financeiro foi encontrado nos arquivos.</Banner>}

        {positions.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>Posições ({positions.length})</h2>
              <label className="check small" title="Útil quando o print mostra a carteira inteira daquela instituição">
                <input type="checkbox" checked={removeStale} onChange={(e) => setRemoveStale(e.target.checked)} />
                Remover posições antigas dessas instituições que não vieram aqui
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th /><th>Ativo</th><th>Instituição</th><th>Titular</th><th>Classe</th><th className="right">Valor</th><th>Moeda</th><th /></tr></thead>
                <tbody>
                  {positions.map((d) => (
                    <tr key={d._id} style={{ opacity: d.include ? 1 : 0.5 }}>
                      <td><input type="checkbox" checked={d.include} onChange={(e) => patch(d._id, { include: e.target.checked })} aria-label="Incluir" /></td>
                      <td style={{ minWidth: 200 }}>
                        <input className="cell" type="text" value={d.name} onChange={(e) => patch(d._id, { name: e.target.value })} />
                        <div className="muted small" style={{ paddingLeft: 6 }}>{[d.ticker, d.subtype].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td><input className="cell" type="text" value={d.institution} onChange={(e) => patch(d._id, { institution: e.target.value })} /></td>
                      <td>
                        <select className="cell" value={d.owner ?? fallbackOwner} onChange={(e) => patch(d._id, { owner: e.target.value as Owner })} aria-label="Titular">
                          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td style={{ minWidth: 150 }}><ClassSelect value={d.assetClass} onChange={(assetClass) => patch(d._id, { assetClass })} /></td>
                      <td style={{ minWidth: 130 }}><input className="cell num right" type="number" step="0.01" value={d.value} onChange={(e) => patch(d._id, { value: Number(e.target.value) })} /></td>
                      <td>
                        <select className="cell" value={d.currency} onChange={(e) => patch(d._id, { currency: e.target.value as "BRL" | "USD" })}><option>BRL</option><option>USD</option></select>
                      </td>
                      <td className="small">
                        {existing.has(posKey(d.owner ?? fallbackOwner, d.institution, d.ticker, d.name)) && <span className="chip">atualiza</span>}{" "}
                        {d.confidence !== "alta" && <span className={`chip ${d.confidence === "baixa" ? "bad" : "warn"}`} title={d.notes ?? ""}>confiança {d.confidence}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {txs.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Transações ({txs.length})</h2></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th /><th>Data</th><th>Tipo</th><th>Descrição</th><th>Instituição</th><th className="right">Valor</th></tr></thead>
                <tbody>
                  {txs.map((d) => (
                    <tr key={d._id} style={{ opacity: d.include ? 1 : 0.5 }}>
                      <td><input type="checkbox" checked={d.include} onChange={(e) => patch(d._id, { include: e.target.checked })} aria-label="Incluir" /></td>
                      <td className="num">{d.date ?? "—"}</td>
                      <td><span className="chip">{d.txType ?? "outro"}</span></td>
                      <td>{d.ticker ? <b>{d.ticker} </b> : null}{d.name}</td>
                      <td className="muted">{d.institution}</td>
                      <td className="right num">{money(d.value, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ---------------- upload ---------------- */
  const ex = state!.settings.extraction;
  const modelLabel = config!.models.find((m) => m.id === ex.model)?.label ?? ex.model;
  const icon = (f: PreparedFile) => (f.kind === "image" ? <ImageIcon size={26} /> : f.kind === "pdf" ? <FileText size={26} /> : <FileSpreadsheet size={26} />);

  return (
    <>
      <PageHead
        title="Importar"
        subtitle="Prints do app do banco/corretora, PDFs, CSV ou XLSX (BTG, XP, Nubank, Inter…). O Claude lê e organiza tudo."
      />
      {error && <Banner kind="bad">{error}</Banner>}
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <Upload size={30} />
        <div className="big">Arraste arquivos, clique para escolher ou cole um print (Ctrl+V)</div>
        <div className="muted small">PNG, JPG, WEBP, PDF, CSV, XLSX</div>
        <input ref={input} type="file" hidden multiple accept="image/*,.pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,.ofx"
          onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <>
          <div className="thumbs">
            {files.map((f) => (
              <div className="thumb" key={f.id}>
                {f.preview ? <img src={f.preview} alt={f.name} /> : <div className="ph">{icon(f)}</div>}
                <div className="cap" title={f.name}>{f.name}</div>
                <FileHintChips name={f.name} />
                <button className="btn icon sm x" title="Remover" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" disabled={busy || !config!.hasCredentials} onClick={process}>
              {busy ? <><Loader2 className="spin" size={16} /> Lendo com Claude…</> : <><Sparkles size={16} /> Processar {files.length} arquivo{files.length > 1 ? "s" : ""}</>}
            </button>
            {busy && <button className="btn" onClick={() => abort.current?.abort()}>Cancelar</button>}
            <span className="muted small">Modelo: {modelLabel} · esforço {ex.effort} (altere em Ajustes)</span>
          </div>
        </>
      )}
      <p className="muted small" style={{ marginTop: 22 }}>
        Dica: nomeie os arquivos como <b>banco-pf</b> ou <b>banco-pj-dica</b> (ex.: <code>vest-pf.png</code>, <code>itau-pf-cdb100cdi.png</code>) para já definir instituição, titular e o produto. Um print por instituição com a lista completa de ativos funciona melhor. Depois da leitura você revisa tudo antes de salvar. Classes: {Object.values(CLASS_META).map((m) => m.label).join(" · ")}.
      </p>
    </>
  );
}

/** Mostra o que foi entendido do nome do arquivo (instituição · titular · dica). */
function FileHintChips({ name }: { name: string }) {
  const h = parseFileName(name);
  if (!h.institution && !h.owner && !h.hint) return <div className="cap muted small">sem dica no nome</div>;
  return (
    <div className="cap row wrap" style={{ gap: 4 }}>
      {h.institution && <span className="chip">{h.institution}</span>}
      {h.owner && <span className={"chip owner-" + h.owner}>{h.owner}</span>}
      {h.hint && <span className="chip" title="Dica repassada ao Claude">{h.hint}</span>}
    </div>
  );
}
