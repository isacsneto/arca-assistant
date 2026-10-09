import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AssetAttachment } from "../shared/assets";
import type { UploadFile } from "../shared/types";

/*
 * Anexos dos bens (fotos, nota fiscal, documentos), guardados em disco:
 *   <dir>/<assetId>/<fileId>
 * fileId é gerado aqui (uuid + extensão); o nome original fica só nos metadados.
 */

export const MAX_ATTACHMENTS_PER_ASSET = 12;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp|gif|pdf|txt|csv)$/;

const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};
const MEDIA_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MEDIA).map(([m, e]) => [e, m]));
MEDIA_BY_EXT.jpeg = "image/jpeg";

export class AttachmentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const isSafeAssetId = (id: string) => SAFE_ID.test(id);

function assetDir(root: string, assetId: string): string {
  if (!isSafeAssetId(assetId)) throw new AttachmentError("Bem inválido.");
  return path.join(root, assetId);
}

function filePath(root: string, assetId: string, fileId: string): string {
  if (!SAFE_FILE.test(fileId)) throw new AttachmentError("Anexo inválido.", 404);
  return path.join(assetDir(root, assetId), fileId);
}

function mediaOf(f: UploadFile): string {
  if (f.kind === "pdf") return "application/pdf";
  if (f.kind === "text") return "text/plain";
  return f.mediaType && EXT_BY_MEDIA[f.mediaType] ? f.mediaType : "image/png";
}

/** Grava os arquivos enviados e devolve os metadados para guardar no bem. */
export async function saveAttachments(root: string, assetId: string, files: UploadFile[], existing = 0): Promise<AssetAttachment[]> {
  if (!files.length) throw new AttachmentError("Nenhum arquivo enviado.");
  if (existing + files.length > MAX_ATTACHMENTS_PER_ASSET)
    throw new AttachmentError(`Máximo de ${MAX_ATTACHMENTS_PER_ASSET} anexos por bem.`);
  const dir = assetDir(root, assetId);
  await fs.mkdir(dir, { recursive: true });

  const out: AssetAttachment[] = [];
  for (const f of files) {
    const mediaType = mediaOf(f);
    const bytes = f.kind === "text" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data, "base64");
    if (!bytes.length) throw new AttachmentError(`"${f.name}" está vazio.`);
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`"${f.name}" passa de 15 MB.`);
    const id = `${randomUUID()}.${EXT_BY_MEDIA[mediaType]}`;
    await fs.writeFile(path.join(dir, id), bytes);
    out.push({
      id,
      name: String(f.name).slice(0, 200),
      kind: f.kind === "pdf" ? "pdf" : f.kind === "text" ? "text" : "image",
      mediaType,
      size: bytes.length,
      addedAt: new Date().toISOString(),
    });
  }
  return out;
}

export async function readAttachment(root: string, assetId: string, fileId: string): Promise<{ path: string; mediaType: string }> {
  const p = filePath(root, assetId, fileId);
  try {
    await fs.access(p);
  } catch {
    throw new AttachmentError("Anexo não encontrado.", 404);
  }
  return { path: p, mediaType: MEDIA_BY_EXT[fileId.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" };
}

export async function deleteAttachment(root: string, assetId: string, fileId: string): Promise<void> {
  await fs.rm(filePath(root, assetId, fileId), { force: true });
}

/** Lê os anexos de um bem no formato que o Claude recebe (para a estimativa). */
export async function loadForClaude(root: string, assetId: string, attachments: AssetAttachment[]): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const a of attachments) {
    try {
      const { path: p } = await readAttachment(root, assetId, a.id);
      const buf = await fs.readFile(p);
      out.push(
        a.kind === "text"
          ? { name: a.name, kind: "text", data: buf.toString("utf8") }
          : { name: a.name, kind: a.kind, mediaType: a.mediaType, data: buf.toString("base64") },
      );
    } catch {
      /* anexo sumiu do disco: segue sem ele */
    }
  }
  return out;
}

/**
 * Remove arquivos que nenhum bem referencia (e pastas de bens apagados).
 * Só apaga o que tem mais de `minAgeMs`: um upload recém-feito ainda pode estar
 * esperando o cliente gravar os metadados no bem.
 */
export async function collectGarbage(
  root: string,
  assets: { id: string; attachments?: AssetAttachment[] }[],
  minAgeMs = 10 * 60_000,
  now = Date.now(),
): Promise<void> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(root);
  } catch {
    return;
  }
  const byId = new Map(assets.map((a) => [a.id, new Set((a.attachments ?? []).map((x) => x.id))]));
  for (const d of dirs) {
    if (!isSafeAssetId(d)) continue;
    const keep = byId.get(d) ?? new Set<string>();
    const dir = path.join(root, d);
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      if (keep.has(f)) continue;
      const st = await fs.stat(path.join(dir, f)).catch(() => null);
      if (st && now - st.mtimeMs >= minAgeMs) await fs.rm(path.join(dir, f), { force: true });
    }
    if (!byId.has(d) && !(await fs.readdir(dir).catch(() => ["?"])).length) await fs.rm(dir, { recursive: true, force: true });
  }
}
