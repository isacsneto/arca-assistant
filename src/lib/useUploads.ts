import { useCallback, useRef, useState } from "react";
import { checkDuplicates, uniqueName } from "../../shared/dupes";
import { isVideoName } from "../../shared/videoFrames";
import type { UploadFile } from "../../shared/types";
import { prepareFile, type PreparedFile } from "./files";
import { videoFrames } from "./video";

export type Upload = PreparedFile & { looksLike?: string };

const isVideo = (f: File) => f.type.startsWith("video/") || isVideoName(f.name);

/** Arquivos anexados: prepara, dá nomes únicos e descarta duplicados idênticos. Vídeos viram quadros. */
export function useUploads() {
  const [files, setFiles] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  /** Progresso da extração de quadros de vídeo. */
  const [progress, setProgress] = useState<string | null>(null);
  const ref = useRef<Upload[]>([]);
  ref.current = files;

  const addFiles = useCallback(async (list: File[]) => {
    setError(null);
    const bad: string[] = [];
    const info: string[] = [];
    // Vídeos (um por vez, para não pesar no navegador) → quadros como imagens.
    const expanded: { file: File; video?: { source: string; at: number } }[] = [];
    for (const f of list) {
      if (!isVideo(f)) {
        expanded.push({ file: f });
        continue;
      }
      try {
        const frames = await videoFrames(f, setProgress);
        if (!frames.length) bad.push(`${f.name}: nenhum quadro aproveitável.`);
        else info.push(`${f.name}: ${frames.length} ${frames.length === 1 ? "quadro escolhido" : "quadros escolhidos"} (um por tela).`);
        for (const fr of frames) expanded.push({ file: fr.file, video: { source: f.name, at: fr.at } });
      } catch (e) {
        bad.push((e as Error).message);
      }
    }
    setProgress(null);
    const results = await Promise.allSettled(expanded.map(async (x) => ({ ...(await prepareFile(x.file)), ...(x.video && { video: x.video }) })));
    bad.push(...results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : [])));
    const taken = new Set(ref.current.map((f) => f.name));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])).map((f) => {
      const name = uniqueName(f.name, taken);
      taken.add(name);
      return { ...f, name };
    });
    const { accepted, exact } = checkDuplicates(ref.current, ok);
    if (bad.length) setError(bad.join(" "));
    setNotice([...info, ...exact.map((e) => `"${e.file.name}" é idêntico a "${e.sameAs}" e foi ignorado.`)]);
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const remove = useCallback((id: string) => setFiles((fs) => fs.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setFiles([]), []);

  /** Só os campos que o servidor precisa. */
  const toUpload = useCallback(
    (): UploadFile[] =>
      ref.current.map(({ name, kind, mediaType, data, looksLike, video }) => ({ name, kind, mediaType, data, looksLike, ...(video && { video }) })),
    [],
  );

  return { files, setFiles, addFiles, remove, clear, toUpload, error, setError, notice, progress };
}
