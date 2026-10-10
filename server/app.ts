import express from "express";
import fs from "node:fs";
import path from "node:path";
import {
  ARCA_CLASSES, MODEL_OPTIONS,
  type AppState, type ArcaClass, type ExtractionResult, type JobEvent,
  type ProjectionResult, type PromptImportRequest, type PromptPlan, type RefineRequest, type RefreshResult, type ScanEvent, type ScanResult, type UploadFile,
} from "../shared/types";
import type { Store } from "./store";
import { AiError, explainError } from "./ai";
import { PROVIDER_IDS, aiFor, aiSettings, isAiReady, type AiStatus, type AiTask, type ProviderId } from "../shared/ai";
import { mapPool } from "./pool";
import { attachmentsRoot } from "./paths";
import { sanitizeAssets, type AssetEstimate, type PhysicalAsset } from "../shared/assets";
import { AttachmentError, collectGarbage, deleteAttachment, loadForClaude, readAttachment, saveAttachments } from "./attachments";
import { PluggyError, fetchConnections, type PluggyClient, type PluggyCredentialStore } from "./pluggy";
import { openFinanceSettings, toImport, type PluggyItem } from "../shared/openFinance";
import { VideoError, type VideoSample } from "./video";
import { VIDEO_SAMPLE_STEP } from "../shared/videoFrames";
import { L, setLang } from "../shared/i18n";

export { mapPool };

/** Dependências externas — injetáveis para os testes não chamarem a IA de verdade. */
export interface Deps {
  store: Store;
  /** Status de instalação/login/chave de cada provedor de IA. */
  aiStatus: (force?: boolean) => Promise<AiStatus>;
  /** Salva (ou remove, com null) a chave de API de um provedor. */
  setApiKey: (provider: ProviderId, key: string | null) => void;
  extractFromFiles: (files: UploadFile[], ai: AiTask, signal?: AbortSignal) => Promise<ExtractionResult>;
  interpretPrompt: (req: PromptImportRequest, positions: AppState["positions"], ai: AiTask, signal?: AbortSignal) => Promise<PromptPlan>;
  refineImport: (req: RefineRequest, ai: AiTask, signal?: AbortSignal) => Promise<ExtractionResult>;
  scanClass: (c: ArcaClass, state: AppState, emit: (e: ScanEvent) => void, signal: AbortSignal) => Promise<ScanResult>;
  estimateAsset: (
    asset: PhysicalAsset,
    ai: AiTask,
    emit: (e: JobEvent<AssetEstimate>) => void,
    signal: AbortSignal,
    files?: UploadFile[],
  ) => Promise<AssetEstimate>;
  /** Pasta dos anexos dos bens (padrão: data/attachments). */
  attachmentsDir?: string;
  refreshValues: (state: AppState, emit: (e: JobEvent<RefreshResult>) => void, signal: AbortSignal) => Promise<RefreshResult>;
  projectPortfolio: (state: AppState, emit: (e: JobEvent<ProjectionResult>) => void, signal: AbortSignal) => Promise<ProjectionResult>;
  fetchFx?: () => Promise<number>;
  /** Open Finance (Meu Pluggy): credenciais no servidor + cliente da API. */
  pluggy?: { credentials: PluggyCredentialStore; client: PluggyClient };
  /** Amostras de um vídeo via ffmpeg (quando o navegador não decodifica o formato). */
  sampleVideo?: (bytes: Buffer, opts: { step: number; signal?: AbortSignal }) => Promise<VideoSample[]>;
  distDir?: string;
  scanConcurrency?: number;
}

async function awesomeApiFx(): Promise<number> {
  const r = await fetch("https://economia.awesomeapi.com.br/last/USD-BRL", { signal: AbortSignal.timeout(6000) });
  const j = (await r.json()) as { USDBRL?: { bid?: string } };
  const bid = Number(j.USDBRL?.bid);
  if (!Number.isFinite(bid) || bid <= 0) throw new Error(L("resposta inesperada", "unexpected response"));
  return bid;
}

/** Abre um stream Server-Sent Events; aborta `signal` se o cliente desconectar. */
function openSse<E>(res: express.Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const ctrl = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ctrl.abort();
  });
  const heartbeat = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
  return {
    signal: ctrl.signal,
    send(e: E) {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
      }
    },
  };
}

export function createApp(deps: Deps) {
  const { store } = deps;
  const app = express();
  app.use(express.json({ limit: "80mb" }));

  let state = store.load();
  // Mensagens e textos gerados pelo servidor seguem o idioma escolhido nos ajustes.
  setLang(state.settings.language);
  const attachmentsDir = deps.attachmentsDir ?? attachmentsRoot();

  app.get("/api/state", (_req, res) => {
    res.json(state);
  });

  // O cliente edita posições/transações/bens/ajustes; scans e projeção são gerenciados pelo servidor.
  app.put("/api/state", (req, res) => {
    const body = req.body as Partial<AppState>;
    if (!Array.isArray(body.positions) || !Array.isArray(body.transactions) || !body.settings || typeof body.settings !== "object") {
      res.status(400).json({ error: L("Estado inválido.", "Invalid state.") });
      return;
    }
    state = {
      ...state,
      positions: body.positions,
      transactions: body.transactions,
      settings: body.settings,
      // Cliente antigo sem "assets" não apaga os bens já salvos.
      ...(body.assets !== undefined && { assets: sanitizeAssets(body.assets) }),
    };
    setLang(state.settings.language);
    store.save(state);
    res.json({ ok: true });
    // Anexos de bens apagados (ou removidos) saem do disco depois de um tempo.
    void collectGarbage(attachmentsDir, state.assets).catch(() => undefined);
  });

  app.get("/api/config", async (req, res) => {
    const status = await deps.aiStatus(req.query.refresh === "1");
    const ai = aiSettings(state.settings);
    const s = status[ai.provider];
    res.json({
      hasCredentials: isAiReady(ai, status),
      account: ai.auth === "apiKey" ? L("chave de API", "API key") : s?.account,
      provider: ai.provider,
      auth: ai.auth,
      aiStatus: status,
      models: MODEL_OPTIONS,
    });
  });

  // Chave de API de um provedor: só entra (ou sai); nunca é devolvida ao navegador.
  app.put("/api/ai/key", (req, res) => {
    const { provider, key } = (req.body ?? {}) as { provider?: string; key?: string | null };
    if (!provider || !(PROVIDER_IDS as string[]).includes(provider)) {
      res.status(400).json({ error: L("Provedor inválido.", "Invalid provider.") });
      return;
    }
    if (key != null && (typeof key !== "string" || key.trim().length < 8 || key.length > 400)) {
      res.status(400).json({ error: L("Chave inválida.", "Invalid key.") });
      return;
    }
    deps.setApiKey(provider as ProviderId, key?.trim() || null);
    res.json({ ok: true });
  });

  // Cotação do dólar (opcional; o usuário também pode digitar manualmente).
  app.get("/api/fx", async (_req, res) => {
    try {
      res.json({ usdBrl: await (deps.fetchFx ?? awesomeApiFx)() });
    } catch {
      res.status(502).json({ error: L("Não foi possível obter a cotação agora.", "Couldn't fetch the exchange rate right now.") });
    }
  });

  app.post("/api/import", async (req, res) => {
    const files = (req.body?.files ?? []) as UploadFile[];
    if (!Array.isArray(files) || !files.length) {
      res.status(400).json({ error: L("Nenhum arquivo enviado.", "No files sent.") });
      return;
    }
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      res.json(await deps.extractFromFiles(files, aiFor(state.settings, "extraction"), ctrl.signal));
    } catch (err) {
      const e = explainError(err);
      if (!res.headersSent) res.status(e.status).json({ error: e.message });
    }
  });

  // Import por texto: "17000.30 adicionados à caixinha cdb do inter pj" → operações propostas (o cliente aplica).
  app.post("/api/import/prompt", async (req, res) => {
    const body = req.body as Partial<PromptImportRequest>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const files = Array.isArray(body.files) ? body.files.filter((f) => f && typeof f.name === "string" && typeof f.data === "string") : [];
    if ((!text && !files.length) || text.length > 4000) {
      res.status(400).json({ error: L("Escreva o que mudou (até 4000 caracteres) ou anexe um comprovante.", "Describe what changed (up to 4000 characters) or attach a receipt.") });
      return;
    }
    if (files.length > 10) {
      res.status(400).json({ error: L("Envie no máximo 10 anexos por vez.", "Send at most 10 attachments at a time.") });
      return;
    }
    const answers = Array.isArray(body.answers)
      ? body.answers.filter((x) => x && typeof x.question === "string" && typeof x.answer === "string" && x.answer.trim())
      : [];
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      res.json(await deps.interpretPrompt({ text, answers, files }, state.positions, aiFor(state.settings, "prompt"), ctrl.signal));
    } catch (err) {
      const e = explainError(err);
      if (!res.headersSent) res.status(e.status).json({ error: e.message });
    }
  });

  // Respostas do usuário às perguntas do Claude: reclassifica sem reenviar os arquivos.
  app.post("/api/import/refine", async (req, res) => {
    const body = req.body as Partial<RefineRequest>;
    if (!Array.isArray(body.items) || !Array.isArray(body.files) || !Array.isArray(body.answers) || !body.answers.length) {
      res.status(400).json({ error: L("Envie os itens, a leitura dos arquivos e ao menos uma resposta.", "Send the items, the file readings and at least one answer.") });
      return;
    }
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      res.json(await deps.refineImport(body as RefineRequest, aiFor(state.settings, "refine"), ctrl.signal));
    } catch (err) {
      const e = explainError(err);
      if (!res.headersSent) res.status(e.status).json({ error: e.message });
    }
  });

  // Vídeo que o navegador não conseguiu abrir: o ffmpeg tira amostras e o navegador escolhe os quadros.
  app.post("/api/video/frames", express.raw({ type: () => true, limit: "1gb" }), async (req, res) => {
    const bytes = req.body as Buffer;
    if (!deps.sampleVideo) {
      res.status(501).json({ error: L("Extração de vídeo indisponível.", "Video extraction unavailable.") });
      return;
    }
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
      res.status(400).json({ error: L("Envie o vídeo.", "Send the video.") });
      return;
    }
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      res.json({ samples: await deps.sampleVideo(bytes, { step: VIDEO_SAMPLE_STEP, signal: ctrl.signal }) });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      res.status(err instanceof VideoError ? err.status : 500).json({ error: err instanceof VideoError ? err.message : L("Falha ao processar o vídeo.", "Failed to process the video.") });
    }
  });

  /* ---------------- Open Finance (Meu Pluggy) ---------------- */
  const pluggyFail = (res: express.Response, err: unknown) => {
    const e = err instanceof PluggyError ? err : new PluggyError(err instanceof Error ? err.message : L("Erro no Open Finance.", "Open Finance error."), 500);
    if (!res.headersSent) res.status(e.status).json({ error: e.message });
  };
  const noPluggy = (res: express.Response) => {
    res.status(501).json({ error: L("Open Finance indisponível.", "Open Finance unavailable.") });
  };

  app.get("/api/openfinance", (_req, res) => {
    const creds = deps.pluggy?.credentials.get();
    res.json({ available: Boolean(deps.pluggy), configured: Boolean(creds), clientIdHint: creds ? `…${creds.clientId.slice(-4)}` : null });
  });

  // Credenciais só entram (ou saem); nunca voltam ao navegador.
  app.put("/api/openfinance/credentials", async (req, res) => {
    if (!deps.pluggy) return noPluggy(res);
    const { clientId, clientSecret } = (req.body ?? {}) as { clientId?: unknown; clientSecret?: unknown };
    if (clientId === null) {
      deps.pluggy.credentials.set(null);
      res.json({ ok: true });
      return;
    }
    const id = typeof clientId === "string" ? clientId.trim() : "";
    const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
    if (!/^[0-9a-f-]{20,64}$/i.test(id) || secret.length < 8 || secret.length > 400) {
      res.status(400).json({ error: L("Confira o Client ID (formato UUID) e o Client Secret.", "Check the Client ID (UUID format) and the Client Secret.") });
      return;
    }
    const previous = deps.pluggy.credentials.get();
    deps.pluggy.credentials.set({ clientId: id, clientSecret: secret });
    try {
      await deps.pluggy.client.check();
      res.json({ ok: true });
    } catch (err) {
      // Credencial recusada não fica salva; falha de rede mantém (dá para verificar depois).
      if (err instanceof PluggyError && err.status === 401) deps.pluggy.credentials.set(previous);
      pluggyFail(res, err);
    }
  });

  // Conexões encontradas na conta (quando a API permite listar) + as já configuradas.
  app.get("/api/openfinance/items", async (_req, res) => {
    if (!deps.pluggy) return noPluggy(res);
    try {
      const { client } = deps.pluggy;
      const listed = await client.listItems();
      const configured = openFinanceSettings(state.settings.openFinance).connections.map((c) => c.itemId);
      const missing = configured.filter((id) => !listed.some((i) => i.id === id));
      const resolved = await Promise.all(missing.map((id) => client.getItem(id).catch(() => ({ id, status: "NOT_FOUND" }) as PluggyItem)));
      res.json({
        items: [...listed, ...resolved].map((i) => ({
          id: i.id,
          name: i.connector?.name ?? null,
          status: i.status ?? null,
          lastUpdatedAt: i.lastUpdatedAt ?? null,
        })),
      });
    } catch (err) {
      pluggyFail(res, err);
    }
  });

  // Busca investimentos (e contas) de todas as conexões → itens para a tela de revisão.
  app.post("/api/openfinance/sync", async (_req, res) => {
    if (!deps.pluggy) return noPluggy(res);
    const of = openFinanceSettings(state.settings.openFinance);
    if (!of.connections.length) {
      res.status(400).json({ error: L("Adicione ao menos uma conexão em Ajustes → Open Finance.", "Add at least one connection in Settings → Open Finance.") });
      return;
    }
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      const data = await fetchConnections(deps.pluggy.client, of.connections, { includeAccounts: of.includeAccounts, signal: ctrl.signal });
      res.json(toImport(data, state.positions, { includeAccounts: of.includeAccounts }));
    } catch (err) {
      if (!ctrl.signal.aborted) pluggyFail(res, err);
    }
  });

  app.post("/api/scan", async (req, res) => {
    const raw = req.body?.classes;
    const requested = (Array.isArray(raw) ? raw : []).filter((c): c is ArcaClass =>
      (ARCA_CLASSES as readonly string[]).includes(c),
    );
    if (!requested.length) {
      res.status(400).json({ error: L("Escolha ao menos uma categoria.", "Choose at least one category.") });
      return;
    }
    const sse = openSse<ScanEvent>(res);
    const snapshot = structuredClone(state);
    try {
      // No máximo N categorias em paralelo, para não estourar o limite de uso da assinatura.
      await mapPool([...new Set(requested)], deps.scanConcurrency ?? 2, async (assetClass) => {
        try {
          const result = await deps.scanClass(assetClass, snapshot, sse.send, sse.signal);
          state = { ...state, scans: { ...state.scans, [assetClass]: result } };
          store.save(state);
          sse.send({ type: "result", assetClass, result });
        } catch (err) {
          if (sse.signal.aborted) return;
          sse.send({ type: "error", assetClass, message: explainError(err).message });
        }
      });
    } finally {
      sse.end();
    }
  });

  /** Tarefa longa única com progresso via SSE. `onResult` pode persistir o resultado. */
  function job<R>(
    route: string,
    run: (s: AppState, emit: (e: JobEvent<R>) => void, signal: AbortSignal) => Promise<R>,
    onResult?: (r: R) => void,
  ) {
    app.post(route, async (_req, res) => {
      if (!state.positions.length) {
        res.status(400).json({ error: L("A carteira está vazia.", "The portfolio is empty.") });
        return;
      }
      const sse = openSse<JobEvent<R>>(res);
      try {
        const result = await run(structuredClone(state), sse.send, sse.signal);
        onResult?.(result);
        sse.send({ type: "result", result });
      } catch (err) {
        if (!sse.signal.aborted) sse.send({ type: "error", message: explainError(err).message });
      } finally {
        sse.end();
      }
    });
  }

  // Anexos dos bens: fotos, nota fiscal, documentos.
  const attachmentFail = (res: express.Response, err: unknown) => {
    const status = err instanceof AttachmentError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : L("Erro ao salvar o anexo.", "Error saving the attachment.") });
  };

  app.post("/api/assets/:id/attachments", async (req, res) => {
    const asset = state.assets.find((a) => a.id === req.params.id);
    if (!asset) {
      res.status(404).json({ error: L("Bem não encontrado. Salve o bem antes de anexar arquivos.", "Asset not found. Save the asset before attaching files.") });
      return;
    }
    const files = (Array.isArray(req.body?.files) ? req.body.files : []).filter(
      (f: UploadFile) => f && typeof f.name === "string" && typeof f.data === "string",
    ) as UploadFile[];
    try {
      res.json({ attachments: await saveAttachments(attachmentsDir, asset.id, files, asset.attachments?.length ?? 0) });
    } catch (err) {
      attachmentFail(res, err);
    }
  });

  app.get("/api/assets/:id/attachments/:file", async (req, res) => {
    try {
      const { path: p, mediaType } = await readAttachment(attachmentsDir, req.params.id, req.params.file);
      res.setHeader("Content-Type", mediaType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.sendFile(p);
    } catch (err) {
      attachmentFail(res, err);
    }
  });

  app.delete("/api/assets/:id/attachments/:file", async (req, res) => {
    try {
      await deleteAttachment(attachmentsDir, req.params.id, req.params.file);
      res.json({ ok: true });
    } catch (err) {
      attachmentFail(res, err);
    }
  });

  // Estimativa de um bem: o cliente envia o bem e grava o resultado (não altera o valor sozinho).
  app.post("/api/assets/estimate", async (req, res) => {
    const [asset] = sanitizeAssets([req.body?.asset]);
    if (!asset || !asset.name.trim()) {
      res.status(400).json({ error: L("Informe o bem a estimar.", "Specify the asset to estimate.") });
      return;
    }
    const sse = openSse<JobEvent<AssetEstimate>>(res);
    try {
      // Anexos vêm do disco (o que está salvo para o bem), não do corpo da requisição.
      const saved = state.assets.find((a) => a.id === asset.id);
      const files = saved?.attachments?.length ? await loadForClaude(attachmentsDir, saved.id, saved.attachments) : [];
      const result = await deps.estimateAsset(asset, aiFor(state.settings, "estimate"), sse.send, sse.signal, files);
      sse.send({ type: "result", result });
    } catch (err) {
      if (!sse.signal.aborted) sse.send({ type: "error", message: explainError(err).message });
    } finally {
      sse.end();
    }
  });

  // Atualizar valores: só propõe; o cliente revisa e aplica pelo PUT /api/state.
  job("/api/refresh", deps.refreshValues);

  job("/api/projection", deps.projectPortfolio, (projection) => {
    state = { ...state, projection };
    store.save(state);
  });

  // Em produção serve o front-end compilado.
  const dist = deps.distDir ?? path.resolve(process.cwd(), "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err instanceof AiError ? err : null;
    const tooBig = (err as { type?: string })?.type === "entity.too.large";
    const badJson = (err as { type?: string })?.type === "entity.parse.failed";
    res.status(tooBig ? 413 : badJson ? 400 : (e?.status ?? 500)).json({
      error: tooBig
        ? L("Arquivos grandes demais. Envie menos arquivos por vez.", "Files too large. Send fewer files at a time.")
        : badJson
          ? L("JSON inválido.", "Invalid JSON.")
          : (e?.message ?? L("Erro interno.", "Internal error.")),
    });
  });

  return app;
}
