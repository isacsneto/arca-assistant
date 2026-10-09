import { useCallback, useRef, useState } from "react";
import { checkDuplicates, uniqueName } from "../../shared/dupes";
import type { UploadFile } from "../../shared/types";
import { prepareFile, type PreparedFile } from "./files";

export type Upload = PreparedFile & { looksLike?: string };

/** Arquivos anexados: prepara, dá nomes únicos e descarta duplicados idênticos. */
export function useUploads() {
  const [files, setFiles] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const ref = useRef<Upload[]>([]);
  ref.current = files;

  const addFiles = useCallback(async (list: File[]) => {
    setError(null);
    const results = await Promise.allSettled(list.map(prepareFile));
    const bad = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
    const taken = new Set(ref.current.map((f) => f.name));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])).map((f) => {
      const name = uniqueName(f.name, taken);
      taken.add(name);
      return { ...f, name };
    });
    const { accepted, exact } = checkDuplicates(ref.current, ok);
    if (bad.length) setError(bad.join(" "));
    setNotice(exact.map((e) => `"${e.file.name}" é idêntico a "${e.sameAs}" e foi ignorado.`));
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const remove = useCallback((id: string) => setFiles((fs) => fs.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setFiles([]), []);

  /** Só os campos que o servidor precisa. */
  const toUpload = useCallback(
    (): UploadFile[] => ref.current.map(({ name, kind, mediaType, data, looksLike }) => ({ name, kind, mediaType, data, looksLike })),
    [],
  );

  return { files, setFiles, addFiles, remove, clear, toUpload, error, setError, notice };
}
