import type { z } from "zod";
import type { AiTask } from "../../shared/ai";
import type { UploadFile } from "../../shared/types";

export type Progress = { type: "status"; text: string } | { type: "search"; query: string } | { type: "fetch"; url: string };

/** Um pedido de IA independente de provedor: instruções + tarefa → JSON no schema. */
export interface AiRequest<S extends z.ZodType> {
  system: string;
  prompt: string;
  schema: S;
  /** Arquivos para o modelo ler (imagens, PDFs, texto). */
  files?: UploadFile[];
  /** Pode pesquisar na web. */
  web: boolean;
  /** Limite de passos do agente (onde o provedor suporta). */
  maxTurns: number;
  signal?: AbortSignal;
  onProgress?: (e: Progress) => void;
}

export interface AiResult<T> {
  data: T;
  searches: number;
}

export interface EngineContext {
  task: AiTask;
  /** Chave de API (modo "apiKey"). */
  apiKey?: string;
}

export type Engine = <S extends z.ZodType>(req: AiRequest<S>, ctx: EngineContext) => Promise<AiResult<z.infer<S>>>;

export class AiError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}
