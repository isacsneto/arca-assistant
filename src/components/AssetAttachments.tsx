import { useState } from "react";
import { FileText, Loader2, Paperclip, Upload, X } from "lucide-react";
import type { AssetAttachment, PhysicalAsset } from "../../shared/assets";
import { prepareFile } from "../lib/files";

const MAX = 12;
const attachmentUrl = (assetId: string, fileId: string) => `/api/assets/${encodeURIComponent(assetId)}/attachments/${encodeURIComponent(fileId)}`;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  return body as T;
}

/**
 * Anexos de um bem (fotos, nota fiscal, documentos). O arquivo vai para o servidor;
 * os metadados ficam no bem (via `onChange`), e a IA lê os anexos ao estimar.
 */
export function AssetAttachments({ asset, onChange }: { asset: PhysicalAsset; onChange: (list: AssetAttachment[]) => void }) {
  const list = asset.attachments ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    if (list.length + files.length > MAX) {
      setError(`Máximo de ${MAX} anexos por bem.`);
      return;
    }
    setBusy(true);
    try {
      const prepared = await Promise.allSettled(files.map(prepareFile));
      const bad = prepared.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
      const ok = prepared.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length) {
        const res = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: ok.map(({ name, kind, mediaType, data }) => ({ name, kind, mediaType, data })) }),
        });
        const { attachments } = await json<{ attachments: AssetAttachment[] }>(res);
        onChange([...list, ...attachments]);
      }
      if (bad.length) setError(bad.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: AssetAttachment) => {
    setError(null);
    try {
      await json(await fetch(attachmentUrl(asset.id, a.id), { method: "DELETE" }));
      onChange(list.filter((x) => x.id !== a.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={"att-panel" + (over ? " over" : "")}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}
      onPaste={(e) => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); void add(fs); } }}
      tabIndex={0}
    >
      <div className="row spread wrap" style={{ marginBottom: list.length ? 10 : 0 }}>
        <div>
          <b className="row" style={{ gap: 6 }}><Paperclip size={15} /> Anexos ({list.length})</b>
          <span className="muted small">Fotos, nota fiscal, documento (CRLV), laudo ou certificado — a IA lê ao estimar. Arraste, cole (Ctrl+V) ou escolha.</span>
        </div>
        <label className={"btn sm" + (busy ? " disabled" : "")}>
          {busy ? <><Loader2 size={14} className="spin" /> Enviando…</> : <><Upload size={14} /> Adicionar</>}
          <input type="file" hidden multiple disabled={busy} accept="image/*,.pdf,.txt,.csv"
            onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
      </div>
      {list.length > 0 && (
        <div className="att-grid">
          {list.map((a) => {
            const url = attachmentUrl(asset.id, a.id);
            return (
              <div className="att" key={a.id} title={a.name}>
                <a href={url} target="_blank" rel="noreferrer noopener">
                  {a.kind === "image" ? <img src={url} alt={a.name} /> : <div className="att-ph"><FileText size={22} /><span>{a.kind.toUpperCase()}</span></div>}
                </a>
                <div className="att-name">{a.name}</div>
                <button type="button" className="btn icon sm att-x" onClick={() => void remove(a)} aria-label={`Remover ${a.name}`}><X size={12} /></button>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="small" style={{ color: "var(--bad)", marginTop: 8 }}>{error}</p>}
    </div>
  );
}
