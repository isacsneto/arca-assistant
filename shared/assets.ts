import { z } from "zod";
import { inView } from "./owner";
import type { Owner, View } from "./types";

/*
 * Patrimônio físico (bens): carros, imóveis, joias, eletrônicos…
 * Fica separado da carteira de investimentos — não entra na alocação Arca,
 * no rebalanceamento, na projeção nem no total investido.
 */

export const ASSET_TYPES = {
  imovel: { label: "Imóveis", color: "#0ea5e9" },
  carro: { label: "Veículos", color: "#6366f1" },
  joias: { label: "Joias e ouro", color: "#eab308" },
  eletronicos: { label: "Eletrônicos", color: "#14b8a6" },
  outros: { label: "Outros", color: "#94a3b8" },
} as const;
export type AssetType = keyof typeof ASSET_TYPES;
export const ASSET_TYPE_KEYS = Object.keys(ASSET_TYPES) as AssetType[];

/** O que o Claude devolve ao estimar um bem pesquisando anúncios. */
export const AssetEstimateSchema = z.object({
  /** Valor sugerido (R$) para o bem no estado descrito. */
  estimate: z.number(),
  low: z.number(),
  high: z.number(),
  /** Preço do equivalente novo hoje (R$), se ainda vendido. */
  newPrice: z.number().nullable(),
  /** Mediana dos anúncios de usados comparáveis (R$). */
  usedPrice: z.number().nullable(),
  confidence: z.enum(["alta", "media", "baixa"]),
  /** Premissas usadas (versão, ano, km, estado, peso…) em uma ou duas frases. */
  assumptions: z.string(),
  summary: z.string(),
  comparables: z.array(
    z.object({ title: z.string(), price: z.number(), condition: z.enum(["novo", "usado", "referencia"]), url: z.string() }),
  ),
});
export type AssetEstimateData = z.infer<typeof AssetEstimateSchema>;

export interface AssetEstimate extends AssetEstimateData {
  at: string;
  model: string;
  searches: number;
}

export interface PhysicalAsset {
  id: string;
  type: AssetType;
  name: string;
  /** Valor estimado em R$. */
  value: number;
  owner: Owner;
  notes?: string;
  updatedAt: string;
  /** Última estimativa da IA (não altera "value" sozinha). */
  estimate?: AssetEstimate;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/**
 * Deixa a estimativa consistente: faixa em ordem (low ≤ estimate ≤ high) e
 * preço novo/usado preenchidos a partir dos anúncios listados quando o modelo deixou vazio.
 */
export function normalizeEstimate(d: AssetEstimateData): AssetEstimateData {
  const valid = d.comparables.filter((c) => Number.isFinite(c.price) && c.price > 0);
  const pricesOf = (cond: "novo" | "usado") => valid.filter((c) => c.condition === cond).map((c) => c.price);
  return {
    ...d,
    low: Math.min(d.low, d.estimate, d.high),
    high: Math.max(d.low, d.estimate, d.high),
    newPrice: d.newPrice ?? median(pricesOf("novo")),
    usedPrice: d.usedPrice ?? median(pricesOf("usado")),
    comparables: valid,
  };
}

/** Normaliza bens salvos (versões antigas/estado parcial). */
export function sanitizeAssets(raw: unknown): PhysicalAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string")
    .map((a) => ({
      id: a.id as string,
      type: (ASSET_TYPE_KEYS as string[]).includes(a.type as string) ? (a.type as AssetType) : "outros",
      name: typeof a.name === "string" ? a.name : "",
      value: Number.isFinite(Number(a.value)) ? Number(a.value) : 0,
      owner: a.owner === "PJ" ? "PJ" : "PF",
      notes: typeof a.notes === "string" && a.notes ? a.notes : undefined,
      updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : new Date(0).toISOString(),
      estimate: isEstimate(a.estimate) ? (a.estimate as AssetEstimate) : undefined,
    }));
}

function isEstimate(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return typeof x.estimate === "number" && typeof x.at === "string" && Array.isArray(x.comparables);
}

export interface AssetSummary {
  total: number;
  count: number;
  byType: { type: AssetType; total: number; count: number }[];
}

export function summarizeAssets(assets: PhysicalAsset[], view: View): AssetSummary {
  const visible = inView(assets, view);
  const byType = ASSET_TYPE_KEYS.map((type) => {
    const items = visible.filter((a) => a.type === type);
    return { type, total: items.reduce((s, a) => s + a.value, 0), count: items.length };
  }).filter((t) => t.count > 0);
  return { total: visible.reduce((s, a) => s + a.value, 0), count: visible.length, byType };
}
