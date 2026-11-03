import type { Bill, BankTx } from "./cashflow";
import { categoryOf, normDesc } from "./cashflow";
import { L } from "./i18n";

/*
 * Contas do mês: a planilha de contas a pagar (por credor, mês a mês, com status), com o Open Finance
 * preenchendo o que dá — fatura de cartão e contas pagas pela conta — e o resto digitado, como na planilha.
 * O que foi digitado (ou veio pago da planilha) vale mais que o banco; o banco preenche o que está em aberto.
 */

export type PlanOwner = "PF" | "PJ" | "LLC";
export const PLAN_OWNERS: PlanOwner[] = ["PF", "PJ", "LLC"];
export type PlanStatus = "previsto" | "aguardando" | "iniciado" | "pago";
export const PLAN_STATUSES: PlanStatus[] = ["previsto", "aguardando", "iniciado", "pago"];
/** Despesa e receita entram nos totais; "info" (ex.: dividendos da PJ) só aparece. */
export type PlanKind = "expense" | "income" | "info";

export interface PlanCell {
  amount?: number | null;
  /** Escolhido à mão (ou a cor da planilha): vale mais que o automático. */
  status?: PlanStatus | null;
  /** O valor foi digitado (ou veio pago da planilha): o banco não substitui. Sem isso, o valor é o planejado. */
  manual?: boolean;
  note?: string;
}

/** Como achar a conta no Open Finance: fatura de um cartão, ou lançamentos da conta com essa descrição. */
export interface PlanLink {
  card?: string | null;
  patterns?: string[];
  min?: number | null;
  max?: number | null;
}

export interface PlanLine {
  id: string;
  name: string;
  owner: PlanOwner;
  kind: PlanKind;
  /** Agrupa linhas "info" (ex.: "Dividendos PJ"). */
  section?: string | null;
  /** Quanto essa conta custaria no modo contenção (por mês). */
  contention?: number | null;
  link?: PlanLink | null;
  note?: string | null;
  /** Por mês (AAAA-MM). */
  cells: Record<string, PlanCell>;
}

export interface MonthlyPlan {
  lines: PlanLine[];
  importedAt?: string | null;
}

export const EMPTY_PLAN: MonthlyPlan = { lines: [] };

export const STATUS_LABEL = (): Record<PlanStatus, string> => ({
  previsto: L("Previsto", "Planned"),
  aguardando: L("Aguardando pagamento", "Awaiting payment"),
  iniciado: L("Pago em parte", "Partly paid"),
  pago: L("Pago", "Paid"),
});

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Normaliza o que vem do disco/navegador. */
export function planOf(raw: unknown): MonthlyPlan {
  const r = (raw ?? {}) as Partial<MonthlyPlan>;
  const lines = (Array.isArray(r.lines) ? r.lines : []).filter((l) => l && typeof l.id === "string" && typeof l.name === "string");
  return {
    importedAt: typeof r.importedAt === "string" ? r.importedAt : null,
    lines: lines.map((l) => {
      const cells: Record<string, PlanCell> = {};
      for (const [m, c] of Object.entries(l.cells ?? {})) {
        if (!MONTH_RE.test(m) || !c || typeof c !== "object") continue;
        const amount = num(c.amount);
        const status = PLAN_STATUSES.includes(c.status as PlanStatus) ? (c.status as PlanStatus) : null;
        const note = typeof c.note === "string" && c.note.trim() ? c.note.slice(0, 500) : undefined;
        if (amount == null && !status && !note) continue;
        cells[m] = { ...(amount != null && { amount }), ...(status && { status }), ...(c.manual && { manual: true }), ...(note && { note }) };
      }
      const link = l.link && typeof l.link === "object" ? l.link : null;
      return {
        id: l.id,
        name: l.name.slice(0, 120),
        owner: PLAN_OWNERS.includes(l.owner) ? l.owner : "PF",
        kind: l.kind === "income" || l.kind === "info" ? l.kind : "expense",
        section: typeof l.section === "string" && l.section ? l.section : null,
        contention: num(l.contention),
        note: typeof l.note === "string" && l.note.trim() ? l.note.slice(0, 500) : null,
        link: link
          ? {
              card: typeof link.card === "string" && link.card ? link.card : null,
              patterns: (Array.isArray(link.patterns) ? link.patterns : []).filter((p): p is string => typeof p === "string" && p.trim().length >= 3).map(normDesc),
              min: num(link.min),
              max: num(link.max),
            }
          : null,
        cells,
      };
    }),
  };
}

export const hasLink = (l: PlanLine) => !!(l.link?.card || l.link?.patterns?.length);

/**
 * Período em que a linha vale: do primeiro mês com dado em diante. Linha sem nada nos últimos 2 meses
 * (conta que acabou, ou que virou outra linha num ano seguinte) para no último mês preenchido —
 * não recebe dado do banco nem previsão depois dele.
 */
export function lineSpan(line: PlanLine, current: string): { first: string | null; last: string | null } {
  const ms = Object.entries(line.cells).filter(([, c]) => c.amount != null || c.status).map(([m]) => m).sort();
  if (!ms.length) return { first: null, last: null };
  const lastFilled = Object.entries(line.cells).filter(([, c]) => (c.amount ?? 0) > 0).map(([m]) => m).sort().at(-1) ?? ms.at(-1)!;
  return { first: ms[0], last: lastFilled >= addMonths(current, -2) ? null : lastFilled };
}
const inSpan = (span: { first: string | null; last: string | null }, m: string) => (!span.first || m >= span.first) && (!span.last || m <= span.last);

/**
 * A mesma conta com nomes diferentes em anos diferentes ("Visa Gold" em 2025, "Cartao Visa Gold"
 * em 2026): ligadas ao mesmo cartão (ou à mesma descrição) e sem meses em comum, viram uma linha só — a mais
 * recente, com o histórico da outra. Senão a fatura contaria duas vezes.
 */
export function mergeSameLink(plan: MonthlyPlan): MonthlyPlan {
  const keyOf = (l: PlanLine) => (l.link?.card ? `card:${l.link.card}` : l.link?.patterns?.length ? `tx:${l.link.patterns[0]}` : null);
  const lastMonth = (l: PlanLine) => Object.keys(l.cells).sort().at(-1) ?? "";
  const out: PlanLine[] = [];
  const sorted = [...plan.lines].sort((a, b) => (lastMonth(a) < lastMonth(b) ? 1 : -1));
  const gone = new Set<string>();
  for (const l of sorted) {
    if (gone.has(l.id)) continue;
    const k = keyOf(l);
    let merged = l;
    if (k && l.kind === "expense") {
      for (const o of sorted) {
        if (o.id === merged.id || gone.has(o.id) || o.kind !== l.kind || keyOf(o) !== k) continue;
        if (Object.keys(o.cells).some((m) => m in merged.cells)) continue;
        merged = { ...merged, cells: { ...o.cells, ...merged.cells }, contention: merged.contention ?? o.contention ?? null, note: merged.note ?? o.note ?? null };
        gone.add(o.id);
      }
    }
    out.push(merged);
  }
  // Mantém a ordem original (a da planilha).
  const order = new Map(plan.lines.map((l, i) => [l.id, i]));
  return { ...plan, lines: out.sort((a, b) => order.get(a.id)! - order.get(b.id)!) };
}

/* ---------------- meses ---------------- */

export const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const yearMonths = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
const dayDiff = (a: string, b: string) => (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/* ---------------- o que o banco diz (servidor) ---------------- */

export interface AutoTx {
  id: string;
  date: string;
  description: string;
  amount: number;
  account: string;
}

export interface AutoCell {
  amount: number;
  status: PlanStatus | null;
  source: "card" | "tx";
  /** Fatura ainda aberta/futura: o valor ainda pode mudar. */
  forecast?: boolean;
  dueDate?: string;
  tx: AutoTx[];
}

/** linha → mês → o que o banco mostra. */
export type PlanAuto = Record<string, Record<string, AutoCell>>;

export interface PlanCardBill {
  accountId: string;
  month: string;
  dueDate: string;
  total: number;
  /** Fechada pelo banco (valor oficial); senão é a soma dos lançamentos que já caíram nela. */
  closed: boolean;
}

type Tx = BankTx & { category: string };
const autoTx = (t: BankTx): AutoTx => ({ id: t.id, date: t.date, description: t.description, amount: t.amount, account: t.accountName });
const isBillPayment = (t: BankTx) => /pagamento|pagto|pgto|debito automatico|débito automático/i.test(t.description);

/** Pagamento da fatura achado: crédito no próprio cartão ou débito "fatura" na conta, perto do vencimento. */
function billPaid(bill: PlanCardBill, txs: Tx[]): BankTx[] {
  const near = (t: BankTx) => dayDiff(t.date, bill.dueDate) >= -25 && dayDiff(t.date, bill.dueDate) <= 10;
  const same = (v: number) => Math.abs(Math.abs(v) - bill.total) <= Math.max(1, bill.total * 0.01);
  return txs.filter((t) => near(t) && same(t.amount) && (
    (t.accountType === "CREDIT" && t.accountId === bill.accountId && t.amount > 0 && isBillPayment(t)) ||
    (t.accountType === "BANK" && t.amount < 0 && t.category === "fatura")
  )).slice(0, 1);
}

/** Lançamentos da conta que batem com a regra da linha (sinal, descrição e faixa de valor). */
function matches(line: PlanLine, t: Tx): boolean {
  const pats = line.link?.patterns ?? [];
  if (!pats.length || t.accountType !== "BANK") return false;
  if (line.kind === "income" ? t.amount <= 0 : t.amount >= 0) return false;
  const a = Math.abs(t.amount);
  if (line.link?.min != null && a < line.link.min) return false;
  if (line.link?.max != null && a > line.link.max) return false;
  const d = normDesc(t.description);
  return pats.some((p) => d.includes(p));
}

/**
 * O que o Open Finance diz de cada linha nos meses pedidos: fatura do cartão (fechada = valor oficial;
 * paga quando o pagamento aparece) e lançamentos da conta. Um lançamento conta para uma linha só — a de
 * valor esperado mais próximo.
 */
export function planAuto(plan: MonthlyPlan, txs: Tx[], bills: PlanCardBill[], months: string[], today: string): PlanAuto {
  const out: PlanAuto = {};
  const set = (lineId: string, month: string, c: AutoCell) => ((out[lineId] ??= {})[month] = c);
  const wanted = new Set(months);

  const current = today.slice(0, 7);
  const spans = new Map(plan.lines.map((l) => [l.id, lineSpan(l, current)]));
  for (const line of plan.lines) {
    if (!line.link?.card) continue;
    for (const b of bills.filter((x) => x.accountId === line.link!.card && wanted.has(x.month) && inSpan(spans.get(line.id)!, x.month))) {
      const paid = b.closed ? billPaid(b, txs) : [];
      set(line.id, b.month, {
        amount: b.total, source: "card", dueDate: b.dueDate, tx: paid.map(autoTx),
        status: paid.length ? "pago" : b.closed ? "aguardando" : "previsto",
        ...(!b.closed && { forecast: true }),
      });
    }
  }

  const expected = (line: PlanLine, month: string) => {
    const own = line.cells[month]?.amount;
    if (own != null && own > 0) return own;
    const known = Object.entries(line.cells).filter(([m, c]) => m < month && (c.amount ?? 0) > 0).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return known[0]?.[1].amount ?? ((line.link?.min ?? 0) + (line.link?.max ?? 0)) / 2;
  };
  const byLine = new Map<string, Tx[]>();
  const txLines = plan.lines.filter((l) => !l.link?.card && l.link?.patterns?.length);
  for (const t of txs) {
    const month = t.date.slice(0, 7);
    if (!wanted.has(month)) continue;
    const cands = txLines.filter((l) => matches(l, t) && inSpan(spans.get(l.id)!, month));
    if (!cands.length) continue;
    const best = cands.reduce((a, b) => (Math.abs(Math.abs(t.amount) - expected(b, month)) < Math.abs(Math.abs(t.amount) - expected(a, month)) ? b : a));
    const k = `${best.id}|${month}`;
    byLine.set(k, [...(byLine.get(k) ?? []), t]);
  }
  for (const [k, list] of byLine) {
    const [lineId, month] = k.split("|");
    const line = plan.lines.find((l) => l.id === lineId)!;
    const amount = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const planned = line.cells[month]?.amount;
    // Pagou menos que o planejado num mês que ainda não acabou: em andamento.
    const partial = planned != null && planned > 0 && amount < planned * 0.98 && month >= today.slice(0, 7);
    set(lineId, month, { amount, source: "tx", status: partial ? "iniciado" : "pago", tx: list.sort((a, b) => (a.date < b.date ? -1 : 1)).map(autoTx) });
  }
  return out;
}

/** Faturas por cartão e mês de vencimento: as fechadas (oficiais) e as que ainda estão abertas/futuras. */
export function planCardBills(bills: Bill[], openBills: { accountId: string; month: string; dueDate: string; total: number }[]): PlanCardBill[] {
  const out: PlanCardBill[] = bills.map((b) => ({ accountId: b.accountId, month: b.dueDate.slice(0, 7), dueDate: b.dueDate, total: b.total, closed: true }));
  for (const b of openBills) {
    if (!out.some((x) => x.accountId === b.accountId && x.month === b.month)) out.push({ ...b, closed: false });
  }
  return out;
}

/* ---------------- sugestão de vínculos (importação) ---------------- */

/**
 * Liga cada linha ao que a explica no banco, pelo que bate em valor e mês: a fatura de um cartão
 * (total da fatura = valor da linha) ou uma descrição de lançamento da conta. Precisa bater em 2+ meses.
 * Transferências entre contas, aplicações e pagamento de fatura nunca são a "conta".
 */
export function suggestLinks(plan: MonthlyPlan, txs: Tx[], bills: Bill[]): Record<string, PlanLink> {
  const out: Record<string, PlanLink> = {};
  const usable = txs.filter((t) => t.accountType === "BANK" && categoryOf(t.category).kind !== "ignore");
  const claims = new Map<string, { lineId: string; hits: number }>();
  const groupHits: Record<string, Map<string, number[]>> = {};

  for (const line of plan.lines.filter((l) => l.kind !== "info" && !hasLink(l))) {
    const months = Object.entries(line.cells).filter(([, c]) => (c.amount ?? 0) > 0) as [string, PlanCell & { amount: number }][];
    if (months.length < 2) continue;
    const close = (a: number, v: number, pct: number, abs: number) => Math.abs(a - v) <= Math.max(abs, v * pct);

    if (line.kind === "expense") {
      const cardHits = new Map<string, number>();
      for (const [m, c] of months) {
        for (const b of bills) if (b.dueDate.startsWith(m) && close(b.total, c.amount, 0.01, 1)) cardHits.set(b.accountId, (cardHits.get(b.accountId) ?? 0) + 1);
      }
      const best = [...cardHits].sort((a, b) => b[1] - a[1]);
      if (best[0] && best[0][1] >= 2 && (best.length < 2 || best[0][1] > best[1][1])) {
        out[line.id] = { card: best[0][0] };
        continue;
      }
    }

    // descrição → mês → valor (um acerto por mês por descrição).
    const perMonth = new Map<string, Map<string, number>>();
    for (const [m, c] of months) {
      for (const t of usable) {
        if (!t.date.startsWith(m) || (line.kind === "income" ? t.amount <= 0 : t.amount >= 0)) continue;
        if (!close(Math.abs(t.amount), c.amount, 0.03, 2)) continue;
        const g = normDesc(t.description);
        if (g.length < 4) continue;
        const hit = perMonth.get(g) ?? new Map<string, number>();
        if (!hit.has(m)) hit.set(m, Math.abs(t.amount));
        perMonth.set(g, hit);
      }
    }
    // A descrição tem que bater na maioria dos meses em que aparece (senão é coincidência de valor:
    // um boleto mensal que uma vez custou o mesmo que o imposto do carro).
    const occurs = (g: string) => months.filter(([m]) => usable.some((t) => t.date.startsWith(m) && (line.kind === "income" ? t.amount > 0 : t.amount < 0) && normDesc(t.description) === g)).length;
    const groups = new Map([...perMonth].filter(([g, hit]) => hit.size >= 2 && hit.size / occurs(g) >= 0.5).map(([g, hit]) => [g, [...hit.values()]]));
    groupHits[line.id] = groups;
    for (const [g, amounts] of groups) {
      if (amounts.length < 2) continue;
      const prev = claims.get(g);
      if (!prev || amounts.length > prev.hits) claims.set(g, { lineId: line.id, hits: amounts.length });
    }
  }

  for (const [lineId, groups] of Object.entries(groupHits)) {
    const mine = [...groups].filter(([g, a]) => a.length >= 2 && claims.get(g)?.lineId === lineId).sort((a, b) => b[1].length - a[1].length);
    if (!mine.length) continue;
    const top = mine.filter(([, a]) => a.length >= Math.max(2, mine[0][1].length / 2)).slice(0, 3);
    const amounts = top.flatMap(([, a]) => a);
    out[lineId] = { patterns: top.map(([g]) => g), min: Math.round(Math.min(...amounts) * 0.6 * 100) / 100, max: Math.round(Math.max(...amounts) * 1.6 * 100) / 100 };
  }
  return out;
}

/** Padrão para uma descrição escolhida à mão; amplia a faixa de valor para caber o lançamento. */
export function linkWithTx(link: PlanLink | null | undefined, t: { description: string; amount: number }): PlanLink {
  const p = normDesc(t.description);
  const a = Math.abs(t.amount);
  const patterns = [...new Set([...(link?.patterns ?? []), p])];
  return {
    patterns,
    min: Math.round(Math.min(link?.min ?? a, a * 0.6) * 100) / 100,
    max: Math.round(Math.max(link?.max ?? a, a * 1.6) * 100) / 100,
  };
}

/* ---------------- a grade (tela) ---------------- */

export interface GridCell {
  month: string;
  /** O valor que conta no total. */
  amount: number | null;
  /** Planejado na planilha/à mão (quando o banco mostrou outro valor). */
  planned: number | null;
  status: PlanStatus | null;
  statusSource: "manual" | "auto" | "default" | null;
  /** Valor previsto (mês ainda por vir): repetido do mês anterior ou fatura ainda aberta. */
  forecast: boolean;
  auto: AutoCell | null;
  note?: string;
}

export interface GridRow {
  line: PlanLine;
  cells: GridCell[];
  total: number;
}

export interface PlanGrid {
  months: string[];
  rows: GridRow[];
  /** Por mês: despesas, receitas, sobra, já pago e ainda em aberto. */
  totals: { month: string; expenses: number; income: number; surplus: number; paid: number; open: number }[];
  year: { expenses: number; income: number; surplus: number };
  contention: number;
}

/**
 * Monta a grade do ano: valor digitado (manual) > banco (fatura fechada/pagamento) > planejado > previsão.
 * Previsão só para o mês atual em diante: a fatura aberta do cartão ou o valor do mês anterior repetido
 * (quem não quer a repetição digita 0).
 */
export function planGrid(plan: MonthlyPlan, year: number, auto: PlanAuto, today: string): PlanGrid {
  const months = yearMonths(year);
  const current = today.slice(0, 7);
  const rows: GridRow[] = [];
  // Ano que já foi planejado (na planilha ou à mão): só as linhas dele entram; as outras não são repetidas.
  const plannedYears = new Set(plan.lines.filter((l) => l.kind === "expense").flatMap((l) => Object.entries(l.cells).filter(([, c]) => (c.amount ?? 0) > 0).map(([m]) => m.slice(0, 4))));

  for (const line of plan.lines) {
    const memo = new Map<string, number | null>();
    const span = lineSpan(line, current);
    const yearsOfLine = new Set(Object.keys(line.cells).map((m) => m.slice(0, 4)));
    // Fora do período da linha, ou ano já planejado em que ela não aparece (a conta tinha outro nome, ou não
    // existia): nem banco, nem previsão.
    const blocked = (m: string) => !inSpan(span, m) || (Object.keys(line.cells).length > 0 && plannedYears.has(m.slice(0, 4)) && !yearsOfLine.has(m.slice(0, 4)));
    const valueAt = (m: string, depth = 0): { amount: number | null; forecast: boolean; planned: number | null } => {
      if (blocked(m)) return { amount: null, forecast: false, planned: null };
      const c = line.cells[m];
      const a = auto[line.id]?.[m];
      const planned = c?.amount ?? null;
      if (c?.manual && planned != null) return { amount: planned, forecast: false, planned: null };
      // Pago em parte: o total do mês continua sendo o planejado (o resto ainda vai sair).
      if (a && a.status === "iniciado" && planned != null && planned > a.amount) return { amount: planned, forecast: false, planned: null };
      if (a && !a.forecast) return { amount: a.amount, forecast: false, planned: planned != null && Math.abs(planned - a.amount) > 0.005 ? planned : null };
      // Fatura aberta já maior que o planejado: até fechar ela só cresce — vale a do banco.
      if (a?.forecast && a.source === "card" && planned != null && a.amount > planned && m >= current) return { amount: a.amount, forecast: true, planned };
      if (planned != null) return { amount: planned, forecast: false, planned: null };
      if (m < current) return { amount: null, forecast: false, planned: null };
      if (a) return { amount: a.amount, forecast: true, planned: null };
      // Repete o mês anterior (até 24 meses à frente de algo conhecido).
      if (depth > 24) return { amount: null, forecast: false, planned: null };
      const prev = addMonths(m, -1);
      if (!memo.has(prev)) memo.set(prev, valueAt(prev, depth + 1).amount);
      const p = memo.get(prev) ?? null;
      return { amount: p != null && p > 0 ? p : null, forecast: p != null && p > 0, planned: null };
    };

    const cells: GridCell[] = months.map((m) => {
      const v = valueAt(m);
      const c = line.cells[m];
      const a = blocked(m) ? null : auto[line.id]?.[m] ?? null;
      let status: PlanStatus | null = null;
      let statusSource: GridCell["statusSource"] = null;
      if (line.kind !== "info") {
        if (c?.status) [status, statusSource] = [c.status, "manual"];
        // Mês com 0 (não houve a conta): sem status, mesmo que o banco tenha achado algo parecido.
        else if (v.amount === 0) [status, statusSource] = [null, null];
        else if (a?.status && !(a.forecast && m < current)) [status, statusSource] = [a.status, "auto"];
        else if ((v.amount ?? 0) > 0 && m >= current) [status, statusSource] = ["previsto", "default"];
      }
      return { month: m, amount: v.amount, planned: v.planned, status, statusSource, forecast: v.forecast, auto: a, ...(c?.note && { note: c.note }) };
    });
    // Linha sem nada no ano (nem previsão) não aparece; linha nova (sem valores) aparece para ser preenchida.
    const empty = Object.keys(line.cells).length > 0 && cells.every((c) => c.amount == null || (c.amount === 0 && !c.status));
    if (empty) continue;
    rows.push({ line, cells, total: cells.reduce((s, c) => s + (c.amount ?? 0), 0) });
  }

  const totals = months.map((m, i) => {
    let expenses = 0, income = 0, paid = 0, open = 0;
    for (const r of rows) {
      const c = r.cells[i];
      const v = c.amount ?? 0;
      if (r.line.kind === "income") income += v;
      if (r.line.kind !== "expense") continue;
      expenses += v;
      if (c.status === "pago") paid += v;
      else if (c.status && v > 0) open += v;
    }
    return { month: m, expenses, income, surplus: income - expenses, paid, open };
  });
  const sum = (k: "expenses" | "income") => totals.reduce((s, t) => s + t[k], 0);
  return {
    months,
    rows,
    totals,
    year: { expenses: sum("expenses"), income: sum("income"), surplus: sum("income") - sum("expenses") },
    // Só as contas que aparecem no ano (a contenção de uma conta que acabou não conta).
    contention: rows.filter((r) => r.line.kind === "expense").reduce((s, r) => s + (r.line.contention ?? 0), 0),
  };
}

/** Anos com algum dado (para o seletor), sempre incluindo o ano atual. */
export function planYears(plan: MonthlyPlan, today: string): number[] {
  const ys = new Set<number>([Number(today.slice(0, 4))]);
  for (const l of plan.lines) for (const m of Object.keys(l.cells)) ys.add(Number(m.slice(0, 4)));
  return [...ys].sort((a, b) => a - b);
}
