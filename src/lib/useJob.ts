import { useCallback, useEffect, useRef, useState } from "react";
import type { JobEvent } from "../../shared/types";
import { streamEvents } from "../api";
import { L } from "../../shared/i18n";

export interface JobState<R> {
  running: boolean;
  status: string;
  /** Últimas buscas/páginas lidas, para mostrar o que a IA está fazendo. */
  feed: string[];
  searches: number;
  error: string | null;
  result: R | null;
}

export interface Job<R> extends JobState<R> {
  start: () => void;
  cancel: () => void;
  clear: () => void;
}

const idle = <R,>(): JobState<R> => ({ running: false, status: "", feed: [], searches: 0, error: null, result: null });

/** Tarefa longa no servidor com progresso via SSE (atualizar valores, projeção). */
export function useJob<R>(url: string, onResult?: (r: R) => void): Job<R> {
  const [s, setS] = useState<JobState<R>>(idle);
  const abort = useRef<AbortController | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setS({ ...idle<R>(), running: true, status: L("Iniciando…", "Starting…") });

    const onEvent = (e: JobEvent<R>) => {
      if (e.type === "result") onResultRef.current?.(e.result);
      setS((p) => {
        switch (e.type) {
          case "status": return { ...p, status: e.text };
          case "search": return { ...p, status: L("Pesquisando na web…", "Searching the web…"), searches: p.searches + 1, feed: [...p.feed, `🔎 ${e.query}`].slice(-6) };
          case "fetch": return { ...p, status: L("Lendo página…", "Reading page…"), feed: [...p.feed, `📄 ${e.url}`].slice(-6) };
          case "result": return { ...p, result: e.result, status: L("Concluído", "Done") };
          case "error": return { ...p, error: e.message };
          case "done": return p;
        }
      });
    };

    streamEvents<JobEvent<R>>(url, {}, onEvent, ctrl.signal)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setS((p) => ({ ...p, error: err.message }));
      })
      .finally(() => {
        if (abort.current === ctrl) setS((p) => ({ ...p, running: false }));
      });
  }, [url]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    setS((p) => ({ ...p, running: false, status: "Cancelado" }));
  }, []);

  const clear = useCallback(() => setS(idle), []);

  return { ...s, start, cancel, clear };
}
