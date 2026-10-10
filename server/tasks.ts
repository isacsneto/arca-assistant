import {
  ClaudeRefreshSchema,
  ExtractionResultSchema,
  ProjectionAssumptionsSchema,
  PromptPlanSchema,
  ScanReportSchema,
  type AppState,
  type ArcaClass,
  type ClaudeRefresh,
  type ExtractionResult,
  type JobEvent,
  type Position,
  type ProjectionResult,
  type PromptImportRequest,
  type PromptPlan,
  type RefineRequest,
  type ScanEvent,
  type ScanResult,
  type UploadFile,
} from "../shared/types";
import { aiFor, aiLabel, type AiTask } from "../shared/ai";
import { computeAllocation, toBRL } from "../shared/arca";
import { finalizeExtraction } from "../shared/importReview";
import { ASSET_TYPES, AssetEstimateSchema, normalizeEstimate, type AssetEstimate, type PhysicalAsset } from "../shared/assets";
import {
  ASSET_ESTIMATE_SYSTEM, EXTRACTION_SYSTEM, PROJECTION_SYSTEM, PROMPT_IMPORT_SYSTEM, REFINE_SYSTEM, REFRESH_SYSTEM,
  assetEstimatePrompt, projectionPrompt, promptImportPrompt, refinePrompt, refreshPrompt, scanPrompt, scanSystem,
} from "./prompts";
import { AiError, runAi, type Progress } from "./ai";
import { L } from "../shared/i18n";

/*
 * Tarefas de IA do app. Não sabem qual provedor está rodando: montam o pedido
 * (instruções, tarefa, schema, anexos, busca na web) e chamam runAi().
 */

const todayBR = () => new Date().toLocaleDateString("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });
const todayFull = () => new Date().toLocaleDateString("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" });

export async function extractFromFiles(files: UploadFile[], ai: AiTask, signal?: AbortSignal): Promise<ExtractionResult> {
  const { data } = await runAi(ai, {
    system: EXTRACTION_SYSTEM,
    prompt:
      "Extraia todas as posições e transações dos arquivos abaixo, seguindo as regras do sistema. Preencha \"files\" com uma leitura por arquivo (pelo nome original), verifique duplicados entre os arquivos e faça perguntas só se algo não puder ser classificado com segurança. Use o nome do arquivo original em sourceFile.",
    schema: ExtractionResultSchema,
    files,
    web: false,
    maxTurns: 6 + files.length,
    signal,
  });
  return finalizeExtraction(data, files.map((f) => f.name));
}

/** Import por texto: interpreta a frase do usuário em operações sobre a carteira atual. */
export async function interpretPrompt(req: PromptImportRequest, positions: Position[], ai: AiTask, signal?: AbortSignal): Promise<PromptPlan> {
  const files = req.files ?? [];
  const { data } = await runAi(ai, {
    system: PROMPT_IMPORT_SYSTEM,
    prompt: promptImportPrompt({
      text: req.text,
      today: todayFull(),
      positions,
      answers: req.answers,
      attachments: files.length ? "\n(os anexos seguem abaixo)" : "",
    }),
    schema: PromptPlanSchema,
    files,
    web: false,
    maxTurns: 3 + files.length,
    signal,
  });
  return {
    ...data,
    questions: data.questions.slice(0, 4).map((q, i) => ({ ...q, id: q.id || "q" + (i + 1), options: q.options.slice(0, 4) })),
  };
}

/** Segunda rodada: aplica as respostas do usuário às perguntas, sem reenviar os arquivos. */
export async function refineImport(req: RefineRequest, ai: AiTask, signal?: AbortSignal): Promise<ExtractionResult> {
  const { data } = await runAi(ai, {
    system: REFINE_SYSTEM,
    prompt: refinePrompt(req),
    schema: ExtractionResultSchema,
    web: false,
    maxTurns: 3,
    signal,
  });
  // Nunca perder itens numa revisão: se o modelo devolver menos, o pedido foi mal aplicado.
  const removalAsked = req.answers.some((a) => /duplicad|ignor|remov|exclu|apag/i.test(a.answer));
  if (!removalAsked && data.items.length < req.items.length)
    throw new AiError(L("A revisão perdeu itens da importação. Tente responder de novo.", "The review dropped items from the import. Try answering again."));
  return finalizeExtraction(data, req.files.map((f) => f.file));
}

export async function scanClass(assetClass: ArcaClass, state: AppState, emit: (e: ScanEvent) => void, signal: AbortSignal): Promise<ScanResult> {
  const { settings, positions } = state;
  const ai = aiFor(settings, "scan");
  emit({ type: "status", assetClass, text: L("Iniciando pesquisa…", "Starting research…") });
  const { data, searches } = await runAi(ai, {
    system: scanSystem(),
    prompt: scanPrompt({ assetClass, today: todayBR(), allocation: computeAllocation(positions, settings.usdBrl), settings, positions }),
    schema: ScanReportSchema,
    web: true,
    maxTurns: 80,
    signal,
    onProgress: (e) => emit({ ...e, assetClass }),
  });
  return { ...data, assetClass, runAt: new Date().toISOString(), model: aiLabel(ai), effort: ai.effort, searches };
}

export async function refreshWithAi(
  positions: Position[],
  ctx: { usdBrl: number; state: AppState },
  emit: (e: Progress) => void,
  signal: AbortSignal,
): Promise<ClaudeRefresh> {
  const { data } = await runAi(aiFor(ctx.state.settings, "refresh"), {
    system: REFRESH_SYSTEM,
    prompt: refreshPrompt({ positions, today: todayBR(), usdBrl: ctx.usdBrl }),
    schema: ClaudeRefreshSchema,
    web: true,
    maxTurns: 40,
    signal,
    onProgress: emit,
  });
  return data;
}

export async function projectWithAi(state: AppState, emit: (e: JobEvent<ProjectionResult>) => void, signal: AbortSignal): Promise<ProjectionResult> {
  const { settings, positions } = state;
  const ai = aiFor(settings, "projection");
  const baseTotal = positions.reduce((s, p) => s + toBRL(p, settings.usdBrl), 0);
  emit({ type: "status", text: L("Iniciando pesquisa de cenários…", "Starting scenario research…") });
  const { data, searches } = await runAi(ai, {
    system: PROJECTION_SYSTEM,
    prompt: projectionPrompt({ positions, settings, today: todayBR(), total: baseTotal }),
    schema: ProjectionAssumptionsSchema,
    web: true,
    maxTurns: 80,
    signal,
    onProgress: emit,
  });
  return { ...data, runAt: new Date().toISOString(), model: aiLabel(ai), effort: ai.effort, searches, baseTotal };
}

/** Estima o valor de um bem físico pesquisando anúncios de novos e usados. */
export async function estimateAsset(
  asset: PhysicalAsset,
  ai: AiTask,
  emit: (e: JobEvent<AssetEstimate>) => void,
  signal: AbortSignal,
  files: UploadFile[] = [],
): Promise<AssetEstimate> {
  emit({ type: "status", text: files.length
      ? L(
          `Lendo ${files.length} anexo${files.length > 1 ? "s" : ""} e procurando anúncios…`,
          `Reading ${files.length} attachment${files.length > 1 ? "s" : ""} and looking for listings…`,
        )
      : L("Procurando anúncios e referências…", "Looking for listings and references…") });
  const { data, searches } = await runAi(ai, {
    system: ASSET_ESTIMATE_SYSTEM,
    prompt:
      assetEstimatePrompt({ type: asset.type, typeLabel: ASSET_TYPES[asset.type].label, name: asset.name, notes: asset.notes, currentValue: asset.value, today: todayBR() }) +
      (files.length ? "\n\nAnexos do usuário sobre este item (fotos, nota fiscal, documentos) — leia todos antes de pesquisar e use-os para identificar modelo, versão, ano, peso, estado etc." : ""),
    schema: AssetEstimateSchema,
    files,
    web: true,
    maxTurns: 40,
    signal,
    onProgress: emit,
  });
  return { ...normalizeEstimate(data), at: new Date().toISOString(), model: aiLabel(ai), searches };
}
