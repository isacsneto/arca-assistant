import { L } from "./i18n";
import type { Owner, View } from "./types";

const SUFFIX = /\s*(?:\((PF|PJ)\)|[-–·]\s*(PF|PJ))\s*$/i;

/**
 * Garante o campo `owner` em dados antigos. Antes do campo existir, o titular
 * ficava no nome da instituição ("BTG Pactual (PF)"); aqui ele é separado.
 */
export function withOwner<T extends { institution: string; owner?: Owner | null }>(x: T): T & { owner: Owner } {
  if (x.owner === "PF" || x.owner === "PJ") return x as T & { owner: Owner };
  const m = x.institution.match(SUFFIX);
  if (!m) return { ...x, owner: "PF" };
  return { ...x, institution: x.institution.replace(SUFFIX, "").trim(), owner: (m[1] ?? m[2]).toUpperCase() as Owner };
}

export function inView<T extends { owner: Owner }>(items: T[], view: View): T[] {
  return view === "all" ? items : items.filter((x) => x.owner === view);
}

export const VIEW_LABEL: Record<View, string> = {
  get all() { return L("Consolidado", "All"); },
  get PF() { return L("Pessoa física", "Individual (PF)"); },
  get PJ() { return L("Pessoa jurídica", "Company (PJ)"); },
};
