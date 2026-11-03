import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { normDesc } from "../shared/cashflow";
import type { MonthlyPlan, PlanCell, PlanLine, PlanOwner, PlanStatus } from "../shared/monthlyPlan";
import type { SubStatus, Subscription } from "../shared/subscriptions";

/** Célula lida da planilha: valor e cor de fundo (RGB, sem "#"). */
export interface SheetCell {
  v: unknown;
  fill: string | null;
}
export interface Sheet {
  name: string;
  rows: (SheetCell | null)[][];
}

export interface PlanImport {
  plan: MonthlyPlan;
  years: { year: number; lines: number; expenses: number; income: number; sheetExpenses: number | null; sheetIncome: number | null }[];
  skipped: string[];
}

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const plain = (v: unknown) => (typeof v === "string" ? v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim() : "");
const amountOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** Cores da legenda da própria planilha (a célula à esquerda do texto); senão as cores de costume. */
function legend(sheets: Sheet[]): Map<string, PlanStatus> {
  const map = new Map<string, PlanStatus>([["00FF00", "pago"], ["D9EAD3", "iniciado"], ["00FFFF", "aguardando"], ["FFF2CC", "previsto"]]);
  for (const s of sheets) {
    for (const row of s.rows) {
      row.forEach((c, i) => {
        const t = plain(c?.v);
        const fill = row[i - 1]?.fill;
        if (!t || !fill) return;
        const st: PlanStatus | null = /completamente pago|^pago$/.test(t) ? "pago" : /iniciado|parcial/.test(t) ? "iniciado" : /aguardando/.test(t) ? "aguardando" : /previsto/.test(t) ? "previsto" : null;
        if (st) map.set(fill.toUpperCase(), st);
      });
    }
  }
  return map;
}

/**
 * "PF - Escola" → PF, "Escola"; "LLC - Equipe" → LLC, "Equipe"; "PJ" → PJ, "PJ"; sem prefixo → PF.
 * O que vem entre colchetes ("Carro [parcela 3 de 10]") vira observação da linha.
 */
export function ownerAndName(raw: string): { owner: PlanOwner; name: string; note: string | null } {
  const notes: string[] = [];
  const s = raw.replace(/\s+/g, " ").replace(/\[([^\]]*)\]?/g, (_, n: string) => {
    if (n.trim()) notes.push(n.trim());
    return "";
  }).trim();
  const note = notes.length ? notes.join(" · ") : null;
  const m = /^(PF|PJ|LLC)\b\s*-?\s*(.*)$/i.exec(s);
  if (!m) return { owner: "PF", name: s || raw.trim(), note };
  const owner = m[1].toUpperCase() as PlanOwner;
  return { owner, name: m[2].replace(/^-\s*/, "").trim() || owner, note };
}

/**
 * Lê a planilha de gastos: uma aba por ano ("2026"), linha "Despesa | Janeiro … Dezembro", uma linha por conta
 * até "Total…", depois "Renda por mês", e opcionalmente a coluna "Contenção" e o bloco "Dividendos PJ".
 * A cor da célula vira o status (pela legenda da planilha). Valores pagos ou marcados ficam como digitados.
 */
export function planFromSheets(sheets: Sheet[], now = new Date().toISOString()): PlanImport {
  const colors = legend(sheets);
  const lines = new Map<string, PlanLine>();
  const years: PlanImport["years"] = [];
  const skipped: string[] = [];
  const currentYear = now.slice(0, 4);
  // Contenção por aba: vale a do ano atual (ou a mais recente antes dele) — é um plano só, não se soma entre anos.
  const contentionByYear: Record<string, Map<PlanLine, number>> = {};
  const lineFor = (owner: PlanOwner, base: string, kind: PlanLine["kind"], section: string | null = null, taken?: Set<string>) => {
    let key = `${kind}|${section ?? ""}|${owner}|${normDesc(base)}`;
    let name = base;
    // Duas linhas com o mesmo nome na mesma aba ("OUTRO", "Presente"): são contas diferentes.
    for (let n = 2; taken?.has(key); n += 1) {
      key = `${kind}|${section ?? ""}|${owner}|${normDesc(base)}|${n}`;
      name = `${base} (${n})`;
    }
    taken?.add(key);
    let l = lines.get(key);
    if (!l) {
      l = { id: randomUUID(), name, owner, kind, section, contention: null, link: null, note: null, cells: {} };
      lines.set(key, l);
    }
    return l;
  };

  for (const sheet of sheets) {
    const year = /^\s*(\d{4})\s*$/.exec(sheet.name)?.[1];
    if (!year) {
      skipped.push(sheet.name);
      continue;
    }
    const head = sheet.rows.findIndex((r) => plain(r?.[0]?.v) === "despesa" || plain(r?.[0]?.v) === "despesas");
    if (head < 0) {
      skipped.push(sheet.name);
      continue;
    }
    // Colunas dos meses e da contenção (o título pode estar na linha de cima).
    const monthCol = new Map<number, string>();
    let contentionCol: number | null = null;
    sheet.rows[head].forEach((c, i) => {
      const k = MONTHS.indexOf(plain(c?.v));
      if (k >= 0) monthCol.set(i, `${year}-${String(k + 1).padStart(2, "0")}`);
      if (/conten/.test(plain(c?.v))) contentionCol = i;
    });
    if (contentionCol == null) sheet.rows[head - 1]?.forEach((c, i) => { if (/conten/.test(plain(c?.v))) contentionCol = i; });
    if (!monthCol.size) {
      skipped.push(sheet.name);
      continue;
    }

    let r = head + 1;
    let count = 0;
    const taken = new Set<string>();
    for (; r < sheet.rows.length; r += 1) {
      const row = sheet.rows[r] ?? [];
      const label = typeof row[0]?.v === "string" ? (row[0]!.v as string) : "";
      if (/^total/i.test(plain(label))) break;
      if (!label.trim()) continue;
      const cells: Record<string, PlanCell> = {};
      for (const [col, month] of monthCol) {
        const c = row[col];
        const amount = amountOf(c?.v);
        const status = c?.fill ? colors.get(c.fill.toUpperCase()) ?? null : null;
        if (amount == null && !status) continue;
        // Pago (ou em andamento) e meses passados são o que aconteceu: o banco não substitui. O resto é o planejado.
        const done = status === "pago" || status === "iniciado" || month < now.slice(0, 7);
        cells[month] = { amount: amount ?? 0, ...(status && { status }), ...(done && { manual: true }) };
      }
      const contention = contentionCol != null ? amountOf(row[contentionCol]?.v) : null;
      // Linha-modelo vazia ("OUTRO" com zeros): fica de fora.
      if (!Object.values(cells).some((c) => (c.amount ?? 0) !== 0 || c.status) && !contention) continue;
      const { owner, name, note } = ownerAndName(label);
      const line = lineFor(owner, name, "expense", null, taken);
      Object.assign(line.cells, cells);
      if (note) line.note = note;
      if (contention != null && contention > 0) (contentionByYear[year] ??= new Map()).set(line, contention);
      count += 1;
    }

    const sheetTotal = (re: RegExp) => {
      const row = sheet.rows.find((x) => re.test(plain(x?.[0]?.v)));
      return row ? row.slice(1).map((c) => amountOf(c?.v)).find((v) => v != null) ?? null : null;
    };
    // Renda por mês (digitada na planilha).
    const income = sheet.rows.find((x) => /^renda por mes/.test(plain(x?.[0]?.v)));
    if (income) {
      const line = lineFor("PF", "Renda", "income");
      for (const [col, month] of monthCol) {
        const a = amountOf(income[col]?.v);
        if (a != null) line.cells[month] = { amount: a, ...(month < now.slice(0, 7) && { manual: true }) };
      }
    }
    // Bloco "Dividendos PJ": linhas sem nome até "Total" — informativas.
    const divHead = sheet.rows.findIndex((x) => (x ?? []).some((c) => /^dividendos/.test(plain(c?.v))));
    if (divHead >= 0) {
      const title = String(sheet.rows[divHead]!.find((c) => /^dividendos/.test(plain(c?.v)))!.v).trim();
      let n = 0;
      for (let k = divHead + 1; k < sheet.rows.length; k += 1) {
        const row = sheet.rows[k] ?? [];
        if (row.some((c) => /^total/.test(plain(c?.v)))) break;
        const vals = [...monthCol].map(([col, month]) => [month, amountOf(row[col]?.v)] as const).filter(([, a]) => a != null);
        if (!vals.length) continue;
        n += 1;
        const line = lineFor("PJ", `${title} ${n}`, "info", title);
        for (const [month, a] of vals) line.cells[month] = { amount: a!, manual: true };
      }
    }

    const ys = [...lines.values()];
    const sumKind = (kind: PlanLine["kind"]) => ys.filter((l) => l.kind === kind).reduce((s, l) => s + Object.entries(l.cells).filter(([m]) => m.startsWith(year)).reduce((t, [, c]) => t + (c.amount ?? 0), 0), 0);
    years.push({
      year: Number(year), lines: count,
      expenses: Math.round(sumKind("expense") * 100) / 100, income: Math.round(sumKind("income") * 100) / 100,
      sheetExpenses: sheetTotal(/^gasto total do ano/), sheetIncome: sheetTotal(/^renda do ano/),
    });
  }
  const cy = Object.keys(contentionByYear).sort();
  const pick = cy.filter((y) => y <= currentYear).at(-1) ?? cy[0];
  for (const [line, v] of contentionByYear[pick] ?? []) line.contention = v;
  return { plan: { lines: [...lines.values()], importedAt: now }, years: years.sort((a, b) => a.year - b.year), skipped };
}

/** Lê o .xlsx (valores calculados e cor de fundo de cada célula). */
export function readWorkbook(buf: Buffer): Sheet[] {
  const wb = XLSX.read(buf, { type: "buffer", cellStyles: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) return { name, rows: [] };
    const range = XLSX.utils.decode_range(ws["!ref"]);
    // Planilhas com 1000 linhas vazias: só até onde há conteúdo de verdade.
    const rows: (SheetCell | null)[][] = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, 400); r += 1) {
      const row: (SheetCell | null)[] = [];
      for (let c = 0; c <= Math.min(range.e.c, 40); c += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as (XLSX.CellObject & { s?: { patternType?: string; fgColor?: { rgb?: string } } }) | undefined;
        if (!cell) {
          row.push(null);
          continue;
        }
        const fill = cell.s?.patternType === "solid" && cell.s.fgColor?.rgb ? cell.s.fgColor.rgb.slice(-6).toUpperCase() : null;
        row.push({ v: cell.v, fill: fill === "FFFFFF" ? null : fill });
      }
      rows.push(row);
    }
    return { name, rows };
  });
}

/**
 * Aba de assinaturas: cabeçalho com "Serviço" e "Valor" (e, se houver, conta/e-mail, ativo, cartão, obs).
 * A cor da coluna "Ativo" vira o status: verde claro = ativa, verde escuro = paga adiantado, amarelo = parada.
 * Valor em dólar escrito na observação ("20 USD") vira o valor em USD.
 */
export function subsFromSheets(sheets: Sheet[]): Subscription[] {
  const out: Subscription[] = [];
  for (const sheet of sheets) {
    const head = sheet.rows.findIndex((r) => (r ?? []).some((c) => /^servi[cç]o/.test(plain(c?.v))) && (r ?? []).some((c) => /^valor/.test(plain(c?.v))));
    if (head < 0) continue;
    const col = (re: RegExp) => sheet.rows[head].findIndex((c) => re.test(plain(c?.v)));
    const cService = col(/^servi[cç]o/), cAmount = col(/^valor/), cAccount = col(/^(e-?mail|conta|login|usuario)/);
    const cActive = col(/^(ativo|ativa|status|situacao)/), cPay = col(/^(cartao|pagamento|forma|meio)/), cNote = col(/^(obs|nota)/);
    for (let r = head + 1; r < sheet.rows.length; r += 1) {
      const row = sheet.rows[r] ?? [];
      if (row.some((c) => /^total/.test(plain(c?.v)))) break;
      const service = typeof row[cService]?.v === "string" ? (row[cService]!.v as string).trim() : "";
      if (!service) continue;
      const note = cNote >= 0 && row[cNote]?.v != null ? String(row[cNote]!.v).trim() : null;
      let amount = cAmount >= 0 ? amountOf(row[cAmount]?.v) : null;
      let currency: "BRL" | "USD" = "BRL";
      const usd = /(\d+(?:[.,]\d+)?)\s*(?:usd|us\$|dolares|dólares)/i.exec(`${cAmount >= 0 && typeof row[cAmount]?.v === "string" ? row[cAmount]!.v : ""} ${note ?? ""}`);
      if (amount == null && usd) {
        amount = Number(usd[1].replace(",", "."));
        currency = "USD";
      }
      const fill = cActive >= 0 ? row[cActive]?.fill ?? null : null;
      const said = cActive >= 0 ? plain(row[cActive]?.v) : "";
      const status: SubStatus =
        /^(nao|não|inativ|cancel|parad)/.test(said) ? "inativa"
        : /^(sim|ativ)/.test(said) ? "ativa"
        : fill === "B6D7A8" ? "anual"
        : fill === "FFF2CC" || fill === "F4CCCC" || fill === "EA9999" ? "inativa"
        : fill === "D9EAD3" || fill === "00FF00" ? "ativa"
        : amount != null && amount > 0 ? "ativa" : "inativa";
      out.push({
        id: randomUUID(), service, status, amount, currency,
        account: cAccount >= 0 && row[cAccount]?.v != null ? String(row[cAccount]!.v).trim() : null,
        payment: cPay >= 0 && row[cPay]?.v != null ? String(row[cPay]!.v).trim() : null,
        note, keywords: null,
      });
    }
  }
  return out;
}
