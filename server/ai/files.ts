import fs from "node:fs/promises";
import path from "node:path";
import { fileNameNote } from "../../shared/importReview";
import type { UploadFile } from "../../shared/types";

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

export interface StagedFile {
  index: number;
  /** Nome original do arquivo enviado pelo usuário. */
  original: string;
  /** Observação sobre o nome (convenção banco-pf, suspeita de duplicado). */
  note: string;
  kind: UploadFile["kind"];
  /** Caminho em disco (imagens e PDFs). */
  path?: string;
  /** Conteúdo em texto (CSV/TXT, ou PDF convertido quando pedido). */
  text?: string;
}

/** Extrai o texto de um PDF (para provedores que não leem PDF visualmente). */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t, i) => `--- página ${i + 1} ---\n${t}`).join("\n");
}

/** Grava imagens/PDFs em `dir` e devolve a lista do que foi preparado. */
export async function stageFiles(files: UploadFile[], dir: string, opts: { pdfAsText?: boolean } = {}): Promise<StagedFile[]> {
  const out: StagedFile[] = [];
  for (const [i, f] of files.entries()) {
    const base = { index: i + 1, original: f.name, note: fileNameNote(f.name, f.looksLike), kind: f.kind };
    if (f.kind === "text") {
      out.push({ ...base, text: f.data });
      continue;
    }
    const safe = path.basename(f.name).replace(/[^\w.-]+/g, "_").replace(/\.[^.]*$/, "") || "arquivo";
    const ext = f.kind === "pdf" ? ".pdf" : (EXT[f.mediaType ?? ""] ?? ".png");
    const file = path.join(dir, `${i + 1}-${safe}${ext}`);
    const bytes = Buffer.from(f.data, "base64");
    await fs.writeFile(file, bytes);
    let text: string | undefined;
    if (f.kind === "pdf" && opts.pdfAsText) {
      try {
        text = await pdfToText(new Uint8Array(bytes));
      } catch {
        text = "(não foi possível extrair o texto deste PDF — pode ser um PDF escaneado)";
      }
    }
    out.push({ ...base, path: file, text });
  }
  return out;
}

/** Bloco de texto com o conteúdo dos arquivos de texto (e PDFs convertidos). */
export function inlineTexts(staged: StagedFile[]): string {
  const parts = staged
    .filter((s) => s.text != null)
    .map((s) => `=== Arquivo ${s.index}: ${s.original}${s.note}${s.kind === "pdf" ? " (texto extraído do PDF)" : ""} ===\n${s.text}`);
  return parts.length ? `\n${parts.join("\n\n")}` : "";
}
