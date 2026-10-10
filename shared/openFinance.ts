import type { AssetClass, ExtractedItem, ExtractionResult, FileReading, Owner, Position, RefreshLine } from "./types";
import { norm, posKey } from "./importMerge";
import { parseFileName } from "./fileHints";

/*
 * Open Finance via Pluggy (Meu Pluggy). O servidor busca os investimentos e contas de
 * cada conexão ("item") e este módulo os converte em itens de importação — o mesmo
 * fluxo de revisão dos prints (antes → depois, nada é salvo sem o usuário confirmar).
 */

/** Conexão configurada pelo usuário (um item do Meu Pluggy = um banco). */
export interface OpenFinanceConnection {
  itemId: string;
  owner: Owner;
  /** Nome da instituição na carteira (vazio = usa o nome do conector da Pluggy). */
  institution?: string;
}

export interface OpenFinanceSettings {
  connections: OpenFinanceConnection[];
  /** Inclui saldo de conta corrente/poupança como Caixa. */
  includeAccounts: boolean;
  /**
   * Open Finance é a fonte da verdade das instituições conectadas: importar substitui
   * tudo o que havia nelas (por titular) e o "Atualizar valores" usa os dados de lá.
   */
  sourceOfTruth: boolean;
  lastSyncAt: string | null;
}

export const DEFAULT_OPEN_FINANCE: OpenFinanceSettings = { connections: [], includeAccounts: true, sourceOfTruth: true, lastSyncAt: null };

export function openFinanceSettings(raw: Partial<OpenFinanceSettings> | undefined): OpenFinanceSettings {
  const connections = (Array.isArray(raw?.connections) ? raw.connections : [])
    .filter((c) => c && typeof c.itemId === "string" && c.itemId.trim())
    .map((c) => ({
      itemId: c.itemId.trim(),
      owner: c.owner === "PJ" ? ("PJ" as const) : ("PF" as const),
      ...(typeof c.institution === "string" && c.institution.trim() && { institution: c.institution.trim() }),
    }));
  return {
    connections,
    includeAccounts: raw?.includeAccounts ?? true,
    sourceOfTruth: raw?.sourceOfTruth ?? true,
    lastSyncAt: typeof raw?.lastSyncAt === "string" ? raw.lastSyncAt : null,
  };
}

/* ---------------- formatos da API da Pluggy (só o que usamos) ---------------- */

export interface PluggyItem {
  id: string;
  status?: string;
  executionStatus?: string;
  lastUpdatedAt?: string | null;
  connector?: { id?: number; name?: string; imageUrl?: string } | null;
}

export interface PluggyInvestment {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  subtype?: string | null;
  balance?: number | null;
  amount?: number | null;
  quantity?: number | null;
  currencyCode?: string | null;
  status?: string | null;
  rate?: number | null;
  rateType?: string | null;
  fixedAnnualRate?: number | null;
  dueDate?: string | null;
  issuer?: string | null;
  date?: string | null;
}

export interface PluggyAccount {
  id: string;
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  balance?: number | null;
  currencyCode?: string | null;
}

/** Dados de uma conexão, como o servidor entrega para a conversão. */
export interface ConnectionData {
  connection: OpenFinanceConnection;
  item: PluggyItem | null;
  investments: PluggyInvestment[];
  accounts: PluggyAccount[];
  error?: string;
}

/* ---------------- classificação ---------------- */

const FIXED_INCOME_LABEL: Record<string, string> = {
  CDB: "CDB", LCI: "LCI", LCA: "LCA", LC: "LC", CRI: "CRI", CRA: "CRA",
  TREASURY: "Tesouro Direto", DEBENTURES: "Debênture", LIG: "LIG", LF: "Letra Financeira",
};

/** ETFs brasileiros que não são de ações Brasil. */
const ETF_CLASS: Record<string, AssetClass> = {
  IVVB11: "internacional", SPXI11: "internacional", NASD11: "internacional", WRLD11: "internacional", ACWI11: "internacional",
  EURP11: "internacional", XINA11: "internacional", USAL11: "internacional", TECK11: "internacional", BIEF11: "internacional",
  IMAB11: "caixa", IRFM11: "caixa", IB5M11: "caixa", B5P211: "caixa", FIXA11: "caixa", LFTB11: "caixa", LFTS11: "caixa", IMBB11: "caixa",
  HASH11: "outros", QBTC11: "outros", BITH11: "outros", ETHE11: "outros", QETH11: "outros", GOLD11: "outros",
};

export interface Classification {
  assetClass: AssetClass;
  subtype: string;
  confidence: ExtractedItem["confidence"];
  note: string | null;
}

/** Classe por palavras do nome (fundos genéricos e ETFs desconhecidos). */
function byName(name: string): AssetClass | null {
  const n = ` ${norm(name)} `;
  if (/imobiliar|\bfii\b|fiagro/.test(n)) return "fiis";
  if (/multimercado|\bmm\b|\bfip\b|previd|cripto|bitcoin|ouro/.test(n)) return "outros";
  if (/global|exterior|internacional|s&p|nasdaq|\bie\b|offshore|cambial|dolar/.test(n)) return "internacional";
  if (/\bacoes\b|\bfia\b|small cap|dividend/.test(n)) return "acoes";
  if (/\bdi\b|renda fixa|\brf\b|\bfirf\b|\bfi rf\b|\bcp\b|referenciado|tesouro|selic|credito (privado|corporativo)|cdi/.test(n)) return "caixa";
  return null;
}

function rateLabel(inv: PluggyInvestment): string | null {
  const t = (inv.rateType ?? "").toUpperCase();
  const fmt = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  if (t === "CDI" && inv.rate) return `${fmt(inv.rate)}% CDI`;
  if (t === "SELIC") return inv.rate ? `${fmt(inv.rate)}% Selic` : "Selic";
  if (t === "IPCA") return inv.fixedAnnualRate ? `IPCA + ${fmt(inv.fixedAnnualRate)}%` : "IPCA+";
  if ((t === "PRE_FIXADO" || t === "PREFIXADO") && (inv.fixedAnnualRate ?? inv.rate)) return `${fmt((inv.fixedAnnualRate ?? inv.rate)!)}% a.a.`;
  return null;
}

export function classifyInvestment(inv: PluggyInvestment): Classification {
  const type = (inv.type ?? "").toUpperCase();
  const sub = (inv.subtype ?? "").toUpperCase();
  const code = (inv.code ?? "").toUpperCase();
  const ok = (assetClass: AssetClass, subtype: string, note: string | null = null): Classification => ({ assetClass, subtype, confidence: "alta", note });
  const guess = (assetClass: AssetClass, subtype: string, note: string): Classification => ({ assetClass, subtype, confidence: "media", note });

  switch (type) {
    case "FIXED_INCOME": {
      const label = FIXED_INCOME_LABEL[sub] ?? "Renda fixa";
      return ok("caixa", [label, rateLabel(inv)].filter(Boolean).join(" "));
    }
    case "SECURITY":
      return ok("outros", sub === "PGBL" ? "Previdência PGBL" : sub === "VGBL" ? "Previdência VGBL" : "Previdência");
    case "COE":
      return ok("outros", "COE");
    case "EQUITY":
      if (sub === "REAL_ESTATE_FUND") return ok("fiis", "FII");
      if (sub === "BDR") return ok("internacional", "BDR");
      if (sub === "DERIVATIVES" || sub === "OPTION") return ok("outros", sub === "OPTION" ? "Opção" : "Derivativo");
      return ok("acoes", "Ação");
    case "ETF": {
      const known = ETF_CLASS[code];
      if (known) return ok(known, "ETF");
      const named = byName(inv.name);
      return named ? guess(named, "ETF", "Classe deduzida pelo nome do ETF — confira.") : guess("acoes", "ETF", "ETF sem classe conhecida; considerado ETF de ações Brasil — confira.");
    }
    case "MUTUAL_FUND": {
      const fixed: Record<string, Classification> = {
        FIXED_INCOME_FUND: ok("caixa", "Fundo de renda fixa"),
        STOCK_FUND: ok("acoes", "Fundo de ações"),
        MULTIMARKET_FUND: ok("outros", "Fundo multimercado"),
        EXCHANGE_FUND: guess("internacional", "Fundo cambial", "Fundo cambial (exposição ao dólar) — confira."),
        OFFSHORE_FUND: ok("internacional", "Fundo no exterior"),
        FIP_FUND: ok("outros", "FIP"),
        ETF_FUND: guess("acoes", "Fundo de índice", "Fundo de índice — confira se é de ações Brasil."),
      };
      if (fixed[sub]) return fixed[sub];
      const named = byName(inv.name);
      return named
        ? guess(named, "Fundo de investimento", "Classe deduzida pelo nome do fundo — confira.")
        : { assetClass: "outros", subtype: "Fundo de investimento", confidence: "baixa", note: "Tipo de fundo não informado pela instituição — escolha a classe." };
    }
    default: {
      const named = byName(inv.name);
      return named
        ? guess(named, "Investimento", "Tipo não informado; classe deduzida pelo nome — confira.")
        : { assetClass: "outros", subtype: "Investimento", confidence: "baixa", note: "Tipo não informado pela instituição — escolha a classe." };
    }
  }
}

/** Código de negociação (PETR4, HGLG11, IVVB11…); CNPJs de fundos e códigos internos não contam. */
export function tickerOf(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(c) ? c : null;
}

/* ---------------- instituição ---------------- */

/**
 * Nome da instituição na carteira: o configurado pelo usuário; senão, o nome do
 * conector reaproveitando o nome já usado na carteira (ex.: "Banco BTG Pactual" → "BTG Pactual").
 */
export function institutionName(conn: OpenFinanceConnection, item: PluggyItem | null, known: string[]): string {
  if (conn.institution) return conn.institution;
  const raw = item?.connector?.name?.trim() ?? "";
  if (!raw || /meu ?pluggy/i.test(raw)) return "Open Finance";
  const cleaned = raw.replace(/\b(open finance|pessoa (f[ií]sica|jur[ií]dica)|empresas?|pj|pf)\b/gi, "").replace(/\s{2,}/g, " ").trim() || raw;
  const n = norm(cleaned);
  const exact = known.find((k) => norm(k) === n);
  if (exact) return exact;
  const contained = known.find((k) => norm(k).length >= 3 && (n.includes(norm(k)) || norm(k).includes(n)));
  if (contained) return contained;
  // Apelidos conhecidos ("Itaú Unibanco" → "Itaú", "Nu Pagamentos" → "Nubank").
  for (const token of n.split(/\s+/)) {
    const viaHint = parseFileName(`${token}-pf`).institution;
    if (viaHint && viaHint.toLowerCase() !== token) return known.find((k) => norm(k) === norm(viaHint)) ?? viaHint;
  }
  return cleaned;
}

/* ---------------- conversão ---------------- */

const money = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


/** Itens (posições) de uma conexão: investimentos com saldo e, se pedido, contas. */
function connectionItems(d: ConnectionData, institution: string, source: string, includeAccounts: boolean): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const base = { kind: "position" as const, sourceFile: source, institution, owner: d.connection.owner, txType: null };
  for (const inv of d.investments) {
    const value = inv.balance ?? inv.amount ?? 0;
    if (inv.status === "TOTAL_WITHDRAWAL" || !(value > 0)) continue;
    const c = classifyInvestment(inv);
    const ticker = tickerOf(inv.code);
    items.push({
      ...base,
      name: inv.name.trim() || ticker || "Investimento",
      ticker,
      assetClass: c.assetClass,
      subtype: c.subtype,
      currency: inv.currencyCode === "USD" ? "USD" : "BRL",
      value: Math.round(value * 100) / 100,
      quantity: inv.quantity ?? null,
      date: inv.date?.slice(0, 10) ?? null,
      confidence: c.confidence,
      notes: [c.note, inv.dueDate ? `vence em ${inv.dueDate.slice(0, 10)}` : null, inv.issuer ? `emissor: ${inv.issuer}` : null].filter(Boolean).join(" · ") || null,
    });
  }
  if (includeAccounts) {
    for (const a of d.accounts) {
      if ((a.type ?? "").toUpperCase() !== "BANK" || !((a.balance ?? 0) > 0)) continue;
      const savings = /SAVINGS/i.test(a.subtype ?? "");
      items.push({
        ...base,
        name: savings ? "Poupança" : "Conta corrente",
        ticker: null,
        assetClass: "caixa",
        subtype: savings ? "Poupança" : "Conta corrente",
        currency: a.currencyCode === "USD" ? "USD" : "BRL",
        value: Math.round(a.balance! * 100) / 100,
        quantity: null,
        date: null,
        confidence: "alta",
        notes: a.marketingName || a.name || null,
      });
    }
  }
  return items;
}

/** Resultado da busca no Open Finance: itens para revisão + qual conexão gerou cada bloco. */
export interface OpenFinanceImport extends ExtractionResult {
  connections: { itemId: string; file: string; institution: string; owner: Owner }[];
}

/** Converte os dados das conexões em um resultado de importação para a tela de revisão. */
export function toImport(data: ConnectionData[], positions: Pick<Position, "institution">[], opts: { includeAccounts: boolean }): OpenFinanceImport {
  const known = [...new Set(positions.map((p) => p.institution))];
  const items: ExtractedItem[] = [];
  const files: FileReading[] = [];
  const warnings: string[] = [];
  const connections: OpenFinanceImport["connections"] = [];

  for (const d of data) {
    const institution = institutionName(d.connection, d.item, known);
    const owner = d.connection.owner;
    const source = `Open Finance · ${institution} ${owner}`;
    if (d.error) {
      warnings.push(`${institution} (${owner}): ${d.error}`);
      continue;
    }
    const mine = connectionItems(d, institution, source, opts.includeAccounts);
    items.push(...mine);
    connections.push({ itemId: d.connection.itemId, file: source, institution, owner });
    const total = mine.reduce((s, i) => s + i.value, 0);
    const updated = d.item?.lastUpdatedAt ? ` Dados de ${new Date(d.item.lastUpdatedAt).toLocaleDateString("pt-BR")}.` : "";
    files.push({
      file: source,
      institution,
      owner,
      productHint: d.item?.connector?.name ?? null,
      summary: mine.length ? `${mine.length} ${mine.length === 1 ? "item" : "itens"} · R$ ${money(total)} (valores líquidos).${updated}` : `Nenhum investimento com saldo.${updated}`,
      duplicateOf: null,
    });
    if (d.item?.status && !/UPDATED/i.test(d.item.status))
      warnings.push(`${institution} (${owner}): a conexão está com status "${d.item.status}" na Pluggy — os dados podem estar desatualizados. Reconecte no Meu Pluggy se precisar.`);
  }
  return { items, files, questions: [], warnings, connections };
}

/* ---------------- "Atualizar valores" com o Open Finance como fonte da verdade ---------------- */

export interface OpenFinanceRefresh {
  /** Linhas para a revisão: atualizações, saídas (newValue 0) e entradas (com `add`). */
  lines: RefreshLine[];
  /** Posições já cobertas pelo Open Finance (ficam fora da cotação/IA). */
  covered: Set<string>;
  warnings: string[];
}

const label = (p: { ticker?: string | null; name: string }) => (p.ticker ? `${p.ticker} · ${p.name}` : p.name);

/**
 * Compara a carteira com o Open Finance, instituição por instituição (por titular).
 * Conexão com erro não mexe em nada: as posições dela seguem pela atualização normal.
 */
export function openFinanceRefresh(positions: Position[], data: ConnectionData[], opts: { includeAccounts: boolean }): OpenFinanceRefresh {
  const known = [...new Set(positions.map((p) => p.institution))];
  const lines: RefreshLine[] = [];
  const covered = new Set<string>();
  const warnings: string[] = [];

  for (const d of data) {
    const institution = institutionName(d.connection, d.item, known);
    const owner = d.connection.owner;
    if (d.error) {
      warnings.push(`Open Finance · ${institution} (${owner}): ${d.error} — usei cotação/IA para esta instituição.`);
      continue;
    }
    const source = `Open Finance · ${institution} ${owner}`;
    const fresh = connectionItems(d, institution, source, opts.includeAccounts);
    const scope = positions.filter((p) => p.owner === owner && norm(p.institution) === norm(institution));
    const used = new Set<number>();
    const updated = d.item?.lastUpdatedAt ? `dados de ${new Date(d.item.lastUpdatedAt).toLocaleDateString("pt-BR")}` : "Open Finance";

    for (const p of scope) {
      covered.add(p.id);
      const key = posKey(p.owner, p.institution, p.ticker, p.name);
      const i = fresh.findIndex((it, k) => !used.has(k) && posKey(owner, institution, it.ticker, it.name) === key);
      if (i < 0) {
        lines.push({ id: p.id, name: label(p), currency: p.currency, oldValue: p.value, newValue: 0, method: "removido", note: `Não veio do Open Finance (${updated}): sai da carteira.`, source: "Pluggy" });
        continue;
      }
      used.add(i);
      const it = fresh[i];
      lines.push({
        id: p.id, name: label(p), currency: it.currency, oldValue: p.value, newValue: it.value, method: "openfinance",
        quantity: it.quantity ?? undefined, note: `Valor líquido informado pelo banco (${updated}).`, source: "Pluggy",
      });
    }
    fresh.forEach((it, k) => {
      if (used.has(k)) return;
      lines.push({
        id: `of-new:${d.connection.itemId}:${k}`, name: `${label(it)} (${institution} ${owner})`, currency: it.currency, oldValue: 0, newValue: it.value,
        method: "openfinance", quantity: it.quantity ?? undefined, note: `Novo no Open Finance (${updated}): entra na carteira.`, source: "Pluggy", add: it,
      });
    });
  }
  return { lines, covered, warnings };
}

/**
 * Depois de salvar uma importação do Open Finance: grava em cada conexão a instituição e o
 * titular finais (o usuário pode ter corrigido na revisão), para o "Atualizar valores"
 * achar as mesmas posições depois.
 */
export function withSyncedConnections(
  raw: Partial<OpenFinanceSettings> | undefined,
  files: Pick<FileReading, "file" | "institution" | "owner">[],
  synced: OpenFinanceImport["connections"],
  now: string,
): OpenFinanceSettings {
  const of = openFinanceSettings(raw);
  return {
    ...of,
    lastSyncAt: now,
    connections: of.connections.map((c) => {
      const s = synced.find((x) => x.itemId === c.itemId);
      if (!s) return c;
      const f = files.find((x) => x.file === s.file);
      return { ...c, institution: f?.institution?.trim() || s.institution, owner: f?.owner ?? s.owner };
    }),
  };
}
