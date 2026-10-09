import { z } from "zod";
import type { PhysicalAsset } from "./assets";

/* ------------------------------------------------------------------ */
/* Classes da Arca (Primo Rico / Thiago Nigro)                         */
/* ------------------------------------------------------------------ */

export const ARCA_CLASSES = ["acoes", "fiis", "caixa", "internacional"] as const;
export type ArcaClass = (typeof ARCA_CLASSES)[number];
export type AssetClass = ArcaClass | "outros";
export const ALL_CLASSES: AssetClass[] = [...ARCA_CLASSES, "outros"];

export const CLASS_META: Record<
  AssetClass,
  { label: string; color: string; desc: string }
> = {
  acoes: {
    label: "Ações",
    color: "#3b82f6",
    desc: "Ações brasileiras, units, fundos de ações e ETFs de Brasil (ex.: BOVA11).",
  },
  fiis: {
    label: "Imóveis (FIIs)",
    color: "#f59e0b",
    desc: "Fundos imobiliários e Fiagros.",
  },
  caixa: {
    label: "Caixa / Renda Fixa",
    color: "#10b981",
    desc: "Conta corrente, poupança, Tesouro, CDB, LCI/LCA, debêntures, fundos DI.",
  },
  internacional: {
    label: "Internacional",
    color: "#8b5cf6",
    desc: "Ações e ETFs no exterior, BDRs, contas em dólar.",
  },
  outros: {
    label: "Fora da Arca",
    color: "#94a3b8",
    desc: "Cripto, ouro, multimercado, previdência, imóveis físicos etc. Não entram no rebalanceamento.",
  },
};

export const DEFAULT_TARGETS: Record<ArcaClass, number> = {
  acoes: 25,
  fiis: 25,
  caixa: 25,
  internacional: 25,
};

/** Metodologias de alocação prontas; "custom" = percentuais definidos pelo usuário. */
export const METHODOLOGIES = {
  arca: {
    label: "Arca — Primo Rico",
    desc: "Divisão igual entre as quatro classes (25% cada), como no método Arca de Thiago Nigro.",
    targets: { acoes: 25, fiis: 25, caixa: 25, internacional: 25 },
  },
  grao: {
    label: "Arca Grão",
    desc: "Alocação do fundo Arca Grão: 30% ações, 10% imóveis, 40% caixa/renda fixa e 20% internacional.",
    targets: { acoes: 30, fiis: 10, caixa: 40, internacional: 20 },
  },
} as const satisfies Record<string, { label: string; desc: string; targets: Record<ArcaClass, number> }>;
export type Methodology = keyof typeof METHODOLOGIES | "custom";

/** Descobre a metodologia a partir dos percentuais (para estados antigos sem o campo). */
export function methodologyOf(targets: Record<ArcaClass, number>): Methodology {
  for (const [k, m] of Object.entries(METHODOLOGIES))
    if (ARCA_CLASSES.every((c) => Number(targets[c]) === m.targets[c])) return k as Methodology;
  return "custom";
}

/* ------------------------------------------------------------------ */
/* Modelos                                                             */
/* ------------------------------------------------------------------ */

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const MODEL_OPTIONS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", tier: "uso moderado do plano", hint: "Melhor para o scan (pesquisa e análise profunda)" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", tier: "uso baixo do plano", hint: "Ótimo custo-benefício para ler prints" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", tier: "uso mínimo do plano", hint: "Mais rápido; ok para prints simples" },
  { id: "claude-fable-5-1", label: "Fable 5.1", tier: "uso alto do plano", hint: "Mais capaz; depende de estar disponível no seu plano" },
] as const;

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

/* ------------------------------------------------------------------ */
/* Extração (prints / exports)                                         */
/* ------------------------------------------------------------------ */

export const ExtractedItemSchema = z.object({
  kind: z.enum(["position", "transaction"]),
  sourceFile: z.string(),
  institution: z.string(),
  name: z.string(),
  ticker: z.string().nullable(),
  assetClass: z.enum(["acoes", "fiis", "caixa", "internacional", "outros"]),
  subtype: z.string(),
  currency: z.enum(["BRL", "USD"]),
  value: z.number(),
  quantity: z.number().nullable(),
  date: z.string().nullable(),
  txType: z
    .enum(["compra", "venda", "deposito", "saque", "dividendo", "juros", "taxa", "transferencia", "outro"])
    .nullable(),
  /** Titular: PF ou PJ, quando o documento deixa claro (CNPJ, razão social). */
  owner: z.enum(["PF", "PJ"]).nullable(),
  confidence: z.enum(["alta", "media", "baixa"]),
  notes: z.string().nullable(),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

/** Como o Claude entendeu cada arquivo (nome + conteúdo). */
export const FileReadingSchema = z.object({
  file: z.string(),
  institution: z.string().nullable(),
  owner: z.enum(["PF", "PJ"]).nullable(),
  /** Produto/dica que o nome do arquivo indica (ex.: "CDB 100% do CDI"). */
  productHint: z.string().nullable(),
  /** Resumo curto do que o arquivo mostra. */
  summary: z.string(),
  /** Se o conteúdo repete outro arquivo do mesmo lote, o nome desse outro arquivo. */
  duplicateOf: z.string().nullable(),
});
export type FileReading = z.infer<typeof FileReadingSchema>;

/** Pergunta do Claude quando não dá para classificar com segurança. */
export const ImportQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** Índices (em `items`) dos itens que a resposta afeta. */
  itemIndexes: z.array(z.number()),
  /** 2–4 respostas sugeridas, curtas. O usuário também pode escrever outra. */
  options: z.array(z.string()),
});
export type ImportQuestion = z.infer<typeof ImportQuestionSchema>;

export const ExtractionResultSchema = z.object({
  items: z.array(ExtractedItemSchema),
  files: z.array(FileReadingSchema),
  questions: z.array(ImportQuestionSchema),
  warnings: z.array(z.string()),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface ImportAnswer {
  questionId: string;
  question: string;
  answer: string;
  itemIndexes: number[];
}

/** Pedido de revisão: itens atuais + respostas do usuário, sem reenviar os arquivos. */
export interface RefineRequest {
  items: ExtractedItem[];
  files: FileReading[];
  answers: ImportAnswer[];
}

/* ------------------------------------------------------------------ */
/* Import por texto ("17000.30 adicionados à caixinha cdb do inter pj") */
/* ------------------------------------------------------------------ */

const TX_TYPES = ["compra", "venda", "deposito", "saque", "dividendo", "juros", "taxa", "transferencia", "outro"] as const;

export const PromptOpSchema = z.object({
  /** ajustar = somar/subtrair `delta`; definir = novo saldo `value`; criar = ativo novo; remover = zerar e apagar. */
  action: z.enum(["ajustar", "definir", "criar", "remover"]),
  /** Posição existente (id da lista enviada). null só em "criar". */
  positionId: z.string().nullable(),
  /** Variação do valor, na moeda da posição (+ aporte/compra, − resgate/venda). */
  delta: z.number().nullable(),
  /** Variação de quantidade (ações/cotas), quando informada. */
  quantityDelta: z.number().nullable(),
  /** Novo valor total, em "definir" e "criar". */
  value: z.number().nullable(),
  newPosition: z
    .object({
      name: z.string(),
      ticker: z.string().nullable(),
      institution: z.string(),
      owner: z.enum(["PF", "PJ"]),
      assetClass: z.enum(["acoes", "fiis", "caixa", "internacional", "outros"]),
      subtype: z.string(),
      currency: z.enum(["BRL", "USD"]),
      quantity: z.number().nullable(),
    })
    .nullable(),
  /** Lançamento para o histórico (aporte vira "deposito", resgate vira "saque"...). */
  transaction: z.object({ type: z.enum(TX_TYPES), date: z.string().nullable(), amount: z.number() }).nullable(),
  /** Uma linha em português explicando o que será feito. */
  explanation: z.string(),
});
export type PromptOp = z.infer<typeof PromptOpSchema>;

export const PromptPlanSchema = z.object({
  operations: z.array(PromptOpSchema),
  questions: z.array(z.object({ id: z.string(), question: z.string(), options: z.array(z.string()) })),
  warnings: z.array(z.string()),
});
export type PromptPlan = z.infer<typeof PromptPlanSchema>;

export interface PromptImportRequest {
  text: string;
  /** Anexos opcionais (comprovantes, notas, extratos, prints) para dar contexto. */
  files?: UploadFile[];
  /** Respostas a perguntas anteriores do Claude sobre este mesmo texto. */
  answers?: { question: string; answer: string }[];
}

export interface UploadFile {
  name: string;
  kind: "image" | "pdf" | "text";
  mediaType?: string; // image/* ou application/pdf
  data: string; // base64 (image/pdf) ou texto puro
  /** Outro arquivo do lote que é visualmente quase idêntico (hash de imagem). */
  looksLike?: string;
}

/* ------------------------------------------------------------------ */
/* Estado persistido                                                   */
/* ------------------------------------------------------------------ */

export type Currency = "BRL" | "USD";

/** Titular do investimento: pessoa física ou jurídica. */
export const OWNERS = ["PF", "PJ"] as const;
export type Owner = (typeof OWNERS)[number];
/** Visão da carteira: tudo junto ou só um titular. */
export type View = "all" | Owner;
export type TxType = NonNullable<ExtractedItem["txType"]>;

export interface Position {
  id: string;
  name: string;
  ticker?: string;
  institution: string;
  owner: Owner;
  assetClass: AssetClass;
  subtype: string;
  currency: Currency;
  value: number; // valor total na moeda original
  quantity?: number;
  updatedAt: string; // ISO
  source: string;
}

export interface Transaction {
  id: string;
  date: string | null;
  type: TxType;
  description: string;
  ticker?: string;
  institution: string;
  owner: Owner;
  assetClass: AssetClass;
  amount: number;
  currency: Currency;
  source: string;
  importedAt: string;
}

export interface ModelSetting {
  model: string;
  effort: Effort;
}

export interface Settings {
  usdBrl: number;
  methodology: Methodology;
  targets: Record<ArcaClass, number>;
  extraction: ModelSetting;
  scan: ModelSetting;
  refresh: ModelSetting;
  projection: ModelSetting;
  /** Estimativa de valor dos bens (pesquisa de anúncios). */
  estimate: ModelSetting;
  investorProfile: string;
  /** Instituições (por titular) marcadas como desatualizadas — pedem atualização ao abrir o app. */
  staleInstitutions: StaleMark[];
  /** A cada quantos dias perguntar "está tudo atualizado?" (0 = nunca). */
  reviewIntervalDays: 0 | 7 | 14;
  /** Última vez que o usuário confirmou a revisão periódica. */
  lastReviewAt: string | null;
}

export interface StaleMark {
  institution: string;
  owner: Owner;
  markedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  usdBrl: 5.5,
  methodology: "arca",
  targets: DEFAULT_TARGETS,
  extraction: { model: "claude-sonnet-5-5", effort: "medium" },
  scan: { model: "claude-opus-5-5", effort: "high" },
  refresh: { model: "claude-sonnet-5-5", effort: "medium" },
  projection: { model: "claude-opus-5-5", effort: "high" },
  estimate: { model: "claude-sonnet-5-5", effort: "medium" },
  staleInstitutions: [],
  reviewIntervalDays: 14,
  lastReviewAt: null,
  investorProfile:
    "Investidor brasileiro de longo prazo (10+ anos), foco em construir patrimônio e renda passiva, tolerância moderada a volatilidade.",
};

/* ------------------------------------------------------------------ */
/* Scan                                                                */
/* ------------------------------------------------------------------ */

export const ScanPickSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  rank: z.number(),
  thesis: z.string(),
  keyMetrics: z.array(z.object({ label: z.string(), value: z.string() })),
  risks: z.array(z.string()),
  suggestedWeightInClass: z.number(),
  conviction: z.enum(["alta", "media", "baixa"]),
});
export type ScanPick = z.infer<typeof ScanPickSchema>;

export const ScanReportSchema = z.object({
  summary: z.string(),
  macroContext: z.string(),
  dataAsOf: z.string(),
  picks: z.array(ScanPickSchema),
  avoid: z.array(z.object({ ticker: z.string(), reason: z.string() })),
  portfolioNotes: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type ScanReport = z.infer<typeof ScanReportSchema>;

export interface ScanResult extends ScanReport {
  assetClass: ArcaClass;
  runAt: string;
  model: string;
  effort: Effort;
  searches: number;
}

export interface AppState {
  positions: Position[];
  transactions: Transaction[];
  /** Patrimônio físico (bens) — fora da carteira de investimentos. */
  assets: PhysicalAsset[];
  settings: Settings;
  scans: Partial<Record<ArcaClass, ScanResult>>;
  projection?: ProjectionResult;
}

export type ScanEvent =
  | { type: "status"; assetClass: ArcaClass; text: string }
  | { type: "search"; assetClass: ArcaClass; query: string }
  | { type: "fetch"; assetClass: ArcaClass; url: string }
  | { type: "result"; assetClass: ArcaClass; result: ScanResult }
  | { type: "error"; assetClass: ArcaClass; message: string }
  | { type: "done" };

/** Eventos de progresso de tarefas longas (atualizar valores, projeção). */
export type JobEvent<R> =
  | { type: "status"; text: string }
  | { type: "search"; query: string }
  | { type: "fetch"; url: string }
  | { type: "result"; result: R }
  | { type: "error"; message: string }
  | { type: "done" };

/* ------------------------------------------------------------------ */
/* Atualizar valores                                                   */
/* ------------------------------------------------------------------ */

export const RefreshMethod = z.enum(["cotacao", "indexador", "mantido"]);
export type RefreshMethod = z.infer<typeof RefreshMethod>;

/** O que o Claude devolve para posições sem cotação de mercado. */
export const ClaudeRefreshSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string(),
      newValue: z.number(),
      method: RefreshMethod,
      note: z.string(),
      source: z.string().nullable(),
    }),
  ),
  ratesUsed: z.string(),
});
export type ClaudeRefresh = z.infer<typeof ClaudeRefreshSchema>;

export interface RefreshLine {
  id: string;
  name: string;
  currency: Currency;
  oldValue: number;
  newValue: number;
  method: RefreshMethod;
  /** Quantidade conhecida ou inferida (cotação na data da última atualização). */
  quantity?: number;
  unitPrice?: number;
  note: string;
  source?: string | null;
}

export interface RefreshResult {
  runAt: string;
  usdBrl: number | null;
  lines: RefreshLine[];
  ratesUsed?: string;
}

/* ------------------------------------------------------------------ */
/* Projeção                                                            */
/* ------------------------------------------------------------------ */

export const PROJECTION_HORIZONS = [5, 10, 15, 20, 30] as const;

const ScenarioRate = z.object({
  /** Retorno anual composto em R$ nominais, em % (ex.: 9.5). */
  annualReturnPct: z.number(),
  /** Choque imediato no 1º ano, em % (ex.: -35). Zero no cenário base. */
  initialShockPct: z.number(),
  rationale: z.string(),
});

export const ProjectionAssumptionsSchema = z.object({
  asOf: z.string(),
  summary: z.string(),
  inflation: z.object({ basePct: z.number(), worstPct: z.number(), rationale: z.string() }),
  scenarios: z.object({ base: z.string(), worst: z.string() }),
  classes: z.array(
    z.object({
      assetClass: z.enum(["acoes", "fiis", "caixa", "internacional", "outros"]),
      base: ScenarioRate,
      worst: ScenarioRate,
    }),
  ),
  assets: z.array(z.object({ positionId: z.string(), base: ScenarioRate, worst: ScenarioRate })),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type ProjectionAssumptions = z.infer<typeof ProjectionAssumptionsSchema>;
export type ScenarioRateT = z.infer<typeof ScenarioRate>;

export interface ProjectionResult extends ProjectionAssumptions {
  runAt: string;
  model: string;
  effort: Effort;
  searches: number;
  /** Patrimônio (R$) no momento da pesquisa, para avisar se a carteira mudou desde então. */
  baseTotal: number;
}
