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

export interface PhysicalAsset {
  id: string;
  type: AssetType;
  name: string;
  /** Valor estimado em R$. */
  value: number;
  owner: Owner;
  notes?: string;
  updatedAt: string;
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
    }));
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
