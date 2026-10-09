import type { ExtractedItem, FileReading, Owner } from "./types";

/*
 * Convenção de nome de arquivo:  <instituição>-<pf|pj>[-<dica>]
 *   vest-pf.png            -> Vest, pessoa física
 *   itau-pf-cdb100cdi.pdf  -> Itaú, pessoa física, dica "cdb100cdi" (CDB 100% do CDI)
 * Separadores aceitos: "-", "_", "." e espaço. A ordem de pf/pj e da dica é livre.
 */

const INSTITUTIONS: Record<string, string> = {
  btg: "BTG Pactual",
  btgpactual: "BTG Pactual",
  itau: "Itaú",
  xp: "XP Investimentos",
  rico: "Rico",
  clear: "Clear",
  nubank: "Nubank",
  nu: "Nubank",
  inter: "Banco Inter",
  c6: "C6 Bank",
  bb: "Banco do Brasil",
  bancodobrasil: "Banco do Brasil",
  caixa: "Caixa Econômica Federal",
  cef: "Caixa Econômica Federal",
  santander: "Santander",
  bradesco: "Bradesco",
  safra: "Safra",
  sicredi: "Sicredi",
  sicoob: "Sicoob",
  modal: "Modal",
  genial: "Genial",
  orama: "Órama",
  warren: "Warren",
  toro: "Toro",
  avenue: "Avenue",
  nomad: "Nomad",
  binance: "Binance",
  mercadopago: "Mercado Pago",
  picpay: "PicPay",
  pagbank: "PagBank",
  vest: "Vest",
  agora: "Ágora",
  easynvest: "NuInvest",
  nuinvest: "NuInvest",
};

export interface FileHint {
  institution: string | null;
  owner: Owner | null;
  /** Restante do nome (ex.: "cdb100cdi"), repassado ao Claude como dica. */
  hint: string | null;
}

const OWNER_TOKENS: Record<string, Owner> = { pf: "PF", pj: "PJ" };

/** Pedaços do nome que não dizem nada sobre o produto: versões e cópias. Números soltos ficam ("lci 95 cdi", "ipca 2029"). */
const NOISE = /^(v\d+|copia|cópia|copy|final|novo|nova|new|\(\d+\)|\d{6,})$/i;
/** Datas completas e "(2)" de cópia, removidas antes de quebrar o nome em partes. */
const DATES = /\b(\d{4}[-_.]\d{2}[-_.]\d{2}|\d{2}[-_.]\d{2}[-_.]\d{4})\b|\(\d+\)/g;

/** Ignora nomes genéricos de print/captura, que não seguem a convenção. */
const GENERIC = /^(screenshot|captura|print|img|image|imagem|whatsapp|photo|foto|scan|colado|ss)\b/i;

export function parseFileName(fileName: string): FileHint {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  const tokens = base.toLowerCase().replace(DATES, " ").split(/[-_.\s]+/).filter((t) => t && !NOISE.test(t));
  const empty: FileHint = { institution: null, owner: null, hint: null };
  if (!tokens.length || GENERIC.test(base)) return empty;

  const ownerIdx = tokens.findIndex((t) => t in OWNER_TOKENS);
  const owner = ownerIdx >= 0 ? OWNER_TOKENS[tokens[ownerIdx]] : null;

  // Sem pf/pj só aceitamos a instituição se for uma conhecida (evita "relatorio-outubro" virar banco).
  const first = tokens[0];
  const known = INSTITUTIONS[first];
  if (ownerIdx === 0) return { institution: null, owner, hint: tokens.slice(1).join(" ") || null };
  if (!known && owner === null) return empty;

  const institution = known ?? first.charAt(0).toUpperCase() + first.slice(1);
  const rest = tokens.slice(1).filter((_, i) => i + 1 !== ownerIdx);
  return { institution, owner, hint: rest.join(" ") || null };
}

/** Texto curto para o prompt de extração. */
export function describeHint(h: FileHint): string | null {
  const parts = [
    h.institution && `instituição = ${h.institution}`,
    h.owner && `titular = ${h.owner === "PF" ? "pessoa física (PF)" : "pessoa jurídica (PJ)"}`,
    h.hint && `dica do usuário sobre o produto = "${h.hint}"`,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/**
 * Aplica a instituição/titular de cada arquivo aos itens dele.
 * Prioridade: leitura do Claude sobre o arquivo (nome + conteúdo) > leitura
 * determinística do nome > o que veio no item.
 */
export function applyFileReadings(
  items: ExtractedItem[],
  fileNames: string[],
  readings: Pick<FileReading, "file" | "institution" | "owner">[] = [],
): ExtractedItem[] {
  const hints = new Map(fileNames.map((n) => [n, parseFileName(n)]));
  const byFile = new Map(readings.map((r) => [r.file, r]));
  const only = fileNames.length === 1 ? fileNames[0] : undefined;
  return items.map((it) => {
    const file = hints.has(it.sourceFile) ? it.sourceFile : only;
    if (!file) return it;
    const h = hints.get(file)!;
    const r = byFile.get(file);
    return {
      ...it,
      sourceFile: file,
      institution: r?.institution ?? h.institution ?? it.institution,
      owner: r?.owner ?? h.owner ?? it.owner,
    };
  });
}
