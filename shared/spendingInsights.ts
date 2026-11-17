import { categoryOf, normDesc, type BankTx, type MonthFlow } from "./cashflow";
import { L, locale } from "./i18n";

/*
 * "Para onde vai o dinheiro": a composição dos gastos por categoria mês a mês e os destaques do mês
 * (o que mais pesou, o que subiu contra a média, onde você mais gasta, parcelas, maior compra…).
 * Tudo calculado aqui, sem IA: é instantâneo, de graça e o mesmo número que a tela mostra.
 */

type Tx = BankTx & { category: string };

/** Chave do bloco "demais categorias" no gráfico empilhado. */
export const REST = "_rest";

export interface CategoryMix {
  /** Categorias com cor própria (as maiores do histórico, ordem fixa) + REST quando sobra algo. */
  keys: string[];
  rows: { month: string; values: Record<string, number>; total: number }[];
}

/**
 * Gasto por categoria nos `n` meses até `month`. As categorias com cor são as `top` maiores de TODO o
 * histórico — assim a cor de cada uma não muda quando você troca o mês selecionado.
 */
export function categoryMix(flows: MonthFlow[], month: string, n = 6, top = 5): CategoryMix {
  const sums: Record<string, number> = {};
  for (const f of flows) for (const [c, v] of Object.entries(f.byCategory)) sums[c] = (sums[c] ?? 0) + v;
  const keys = Object.entries(sums).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, top).map(([c]) => c);
  const window = flows.filter((f) => f.month <= month).slice(-n);
  const rows = window.map((f) => {
    const values: Record<string, number> = {};
    let named = 0;
    for (const c of keys) named += values[c] = Math.max(0, f.byCategory[c] ?? 0);
    const total = Math.max(0, f.expenses);
    values[REST] = Math.max(0, total - named);
    return { month: f.month, values, total };
  });
  const hasRest = rows.some((r) => r.values[REST] > 0.5);
  return { keys: hasRest ? [...keys, REST] : keys, rows };
}

export type Highlight =
  /** Mês fechado: total contra a média dos 3 meses anteriores. */
  | { kind: "total"; amount: number; avg: number }
  /** Mês corrente: o gasto até hoje contra o que você costuma ter gasto até o mesmo dia (e o mês médio inteiro). */
  | { kind: "pace"; amount: number; sameDay: number; day: number; avg: number }
  /** Maior categoria do mês e quanto as 3 maiores somam. */
  | { kind: "top"; category: string; amount: number; share: number; top3Share: number }
  | { kind: "up"; category: string; amount: number; avg: number }
  | { kind: "down"; category: string; amount: number; avg: number }
  /** Onde você mais gasta repetidas vezes (mesmo estabelecimento, 2+ compras). */
  | { kind: "merchant"; label: string; category: string; amount: number; count: number }
  /** Maior gasto avulso (contas fixas, que aparecem todo mês, ficam de fora). */
  | { kind: "largest"; label: string; category: string; amount: number; date: string }
  | { kind: "installments"; amount: number; share: number; count: number }
  /** Lugares que nunca apareceram antes deste mês. */
  | { kind: "new"; label: string; category: string; amount: number; count: number; total: number }
  | { kind: "uncategorized"; amount: number; share: number };

export type HighlightTone = "good" | "bad" | "neutral";

/** Variação que merece destaque: 25% e pelo menos R$ 100 (abaixo disso é ruído). */
const notable = (delta: number, base: number) => Math.abs(delta) >= Math.max(100, 0.25 * base);

/** Estabelecimento de um lançamento: o nome do comerciante quando a Pluggy traz, senão a descrição limpa. */
const merchantKey = (t: Tx) => normDesc(t.merchant || t.description);

const addMonths = (m: string, k: number) => {
  const d = new Date(`${m}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + k);
  return d.toISOString().slice(0, 7);
};


/** Destaques do mês `month`, do mais importante para o menos. `tx` = todas as transações (para comparar com o passado). */
export function spendingHighlights(flows: MonthFlow[], tx: Tx[], month: string, today: string, max = 7): Highlight[] {
  const f = flows.find((x) => x.month === month);
  if (!f || f.expenses <= 0) return [];
  const prev = flows.filter((x) => x.month < month).slice(-3);
  const avgOf = (pick: (x: MonthFlow) => number) => (prev.length ? prev.reduce((s, x) => s + pick(x), 0) / prev.length : null);
  const ongoing = month === today.slice(0, 7);
  const out: Highlight[] = [];

  const isExpense = (t: Tx) => categoryOf(t.category).kind === "expense";
  const avgTotal = avgOf((x) => x.expenses);
  if (avgTotal != null && avgTotal > 0) {
    if (ongoing) {
      // Até o mesmo dia nos meses anteriores: o aluguel do dia 5 não faz o começo do mês parecer "acima do ritmo".
      const day = today.slice(8, 10);
      const sameDay = prev.reduce((s, p) => s - tx.filter((t) => t.date.startsWith(p.month) && t.date.slice(8, 10) <= day && isExpense(t)).reduce((a, t) => a + t.amount, 0), 0) / prev.length;
      out.push({ kind: "pace", amount: f.expenses, sameDay, day: Number(day), avg: avgTotal });
    } else out.push({ kind: "total", amount: f.expenses, avg: avgTotal });
  }

  const cats = Object.entries(f.byCategory).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    const top3 = cats.slice(0, 3).reduce((s, [, v]) => s + v, 0);
    out.push({ kind: "top", category: cats[0][0], amount: cats[0][1], share: cats[0][1] / f.expenses, top3Share: top3 / f.expenses });
  }

  if (prev.length) {
    const changes = Object.keys({ ...f.byCategory, ...Object.assign({}, ...prev.map((p) => p.byCategory)) })
      .map((c) => ({ category: c, amount: Math.max(0, f.byCategory[c] ?? 0), avg: avgOf((x) => x.byCategory[c] ?? 0)! }))
      .map((x) => ({ ...x, delta: x.amount - x.avg }))
      .filter((x) => notable(x.delta, x.avg));
    for (const x of changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2))
      out.push({ kind: "up", category: x.category, amount: x.amount, avg: x.avg });
    // Mês em andamento ainda vai gastar mais: "caiu" só vale para mês fechado.
    if (!ongoing) {
      const down = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta)[0];
      if (down) out.push({ kind: "down", category: down.category, amount: down.amount, avg: down.avg });
    }
  }

  // Gastos do mês, um a um (estorno numa categoria de gasto conta como negativo).
  const spent = tx.filter((t) => t.date.startsWith(month) && t.date <= today && isExpense(t));
  /** Rótulos já citados: dois destaques não falam da mesma compra. */
  const mentioned = new Set<string>();
  const byMerchant = new Map<string, { label: string; category: string; amount: number; count: number }>();
  for (const t of spent) {
    const k = merchantKey(t);
    if (!k) continue;
    const m = byMerchant.get(k) ?? { label: t.merchant || t.description, category: t.category, amount: 0, count: 0 };
    m.amount -= t.amount;
    if (t.amount < 0) m.count++;
    byMerchant.set(k, m);
  }
  const habit = [...byMerchant.values()].filter((m) => m.count >= 2 && m.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  if (habit) {
    out.push({ kind: "merchant", ...habit });
    mentioned.add(normDesc(habit.label));
  }

  // Contas fixas (o mesmo lugar em 2 dos 3 meses anteriores) não são novidade: o aluguel seria sempre o "maior gasto".
  const fixed = new Map<string, Set<string>>();
  for (const t of tx) {
    if (t.date >= `${month}-01` || t.date < `${addMonths(month, -3)}-01` || t.amount >= 0) continue;
    const k = merchantKey(t);
    fixed.set(k, (fixed.get(k) ?? new Set()).add(t.date.slice(0, 7)));
  }
  const largest = spent.filter((t) => t.amount < 0 && !mentioned.has(merchantKey(t)) && (fixed.get(merchantKey(t))?.size ?? 0) < 2)
    .sort((a, b) => a.amount - b.amount)[0];
  if (largest && largest.amount <= -100) {
    out.push({ kind: "largest", label: largest.merchant || largest.description, category: largest.category, amount: -largest.amount, date: largest.date });
    mentioned.add(merchantKey(largest));
  }

  const inst = spent.filter((t) => t.installment && t.amount < 0);
  const instTotal = inst.reduce((s, t) => s - t.amount, 0);
  if (instTotal / f.expenses >= 0.05) out.push({ kind: "installments", amount: instTotal, share: instTotal / f.expenses, count: inst.length });

  // "Novo" só faz sentido com pelo menos 2 meses de histórico antes deste.
  const start = `${month}-01`;
  if (tx.some((t) => t.date < `${addMonths(month, -2)}-01`)) {
    const seen = new Set(tx.filter((t) => t.date < start).map(merchantKey));
    const fresh = [...byMerchant.entries()].filter(([k, m]) => !seen.has(k) && m.amount > 0).map(([, m]) => m);
    const total = fresh.reduce((s, m) => s + m.amount, 0);
    const biggest = fresh.sort((a, b) => b.amount - a.amount)[0];
    // Um lugar só, já citado (maior gasto) ou que é a categoria inteira que "apareceu este mês": seria repetir.
    const repeat = fresh.length === 1 && (mentioned.has(normDesc(biggest.label)) || out.some((h) => h.kind === "up" && h.avg < 1 && h.category === biggest.category));
    if (fresh.length && !repeat && total >= 100 && total / f.expenses >= 0.05)
      out.push({ kind: "new", label: biggest.label, category: biggest.category, amount: biggest.amount, count: fresh.length, total });
  }

  const other = f.byCategory.outros ?? 0;
  if (other / f.expenses >= 0.08 && other >= 50) out.push({ kind: "uncategorized", amount: other, share: other / f.expenses });

  return out.slice(0, max);
}

/** Bom, ruim ou neutro — decide a cor e o ícone do destaque. */
export function highlightTone(h: Highlight): HighlightTone {
  switch (h.kind) {
    case "total": return h.amount > h.avg * 1.1 ? "bad" : h.amount < h.avg * 0.9 ? "good" : "neutral";
    case "pace": return h.amount > h.sameDay * 1.1 ? "bad" : h.amount < h.sameDay * 0.9 ? "good" : "neutral";
    case "up": return "bad";
    case "down": return "good";
    case "uncategorized": return "bad";
    default: return "neutral";
  }
}

/** Categoria que o destaque abre ao clicar (null = abre o mês). */
export function highlightCategory(h: Highlight): string | null {
  return "category" in h ? h.category : h.kind === "uncategorized" ? "outros" : null;
}

/**
 * O destaque em uma frase, no idioma do app. `money` formata o valor (na tela respeita a moeda e o modo
 * privacidade; no prompt da IA é sempre R$).
 */
export function describeHighlight(h: Highlight, money: (n: number) => string): string {
  const pc = (x: number) => `${Math.round(x * 100).toLocaleString(locale())}%`;
  const cat = (c: string) => categoryOf(c).label();
  switch (h.kind) {
    case "total": {
      const d = h.amount - h.avg;
      if (Math.abs(d) < h.avg * 0.1) return L(`Você gastou ${money(h.amount)} — em linha com a média dos 3 meses anteriores (${money(h.avg)}).`, `You spent ${money(h.amount)} — in line with your previous 3-month average (${money(h.avg)}).`);
      return d > 0
        ? L(`Você gastou ${money(h.amount)} — ${money(d)} (${pc(d / h.avg)}) acima da média dos 3 meses anteriores (${money(h.avg)}).`, `You spent ${money(h.amount)} — ${money(d)} (${pc(d / h.avg)}) more than your previous 3-month average (${money(h.avg)}).`)
        : L(`Você gastou ${money(h.amount)} — ${money(-d)} (${pc(-d / h.avg)}) abaixo da média dos 3 meses anteriores (${money(h.avg)}).`, `You spent ${money(h.amount)} — ${money(-d)} (${pc(-d / h.avg)}) less than your previous 3-month average (${money(h.avg)}).`);
    }
    case "pace": {
      const d = h.amount - h.sameDay;
      const vs = Math.abs(d) < h.sameDay * 0.1
        ? L("no ritmo de sempre", "on your usual pace")
        : d > 0 ? L(`${money(d)} acima do ritmo de sempre`, `${money(d)} ahead of your usual pace`) : L(`${money(-d)} abaixo do ritmo de sempre`, `${money(-d)} below your usual pace`);
      return L(`Até o dia ${h.day}: ${money(h.amount)}, ${vs} (${money(h.sameDay)} até esse dia, em média; um mês inteiro fica em ${money(h.avg)}).`, `Through day ${h.day}: ${money(h.amount)}, ${vs} (${money(h.sameDay)} by this day on average; a full month ends around ${money(h.avg)}).`);
    }
    case "top":
      return L(`${cat(h.category)} é para onde mais foi dinheiro: ${money(h.amount)} (${pc(h.share)} dos gastos). As 3 maiores categorias somam ${pc(h.top3Share)}.`, `${cat(h.category)} is where most of the money went: ${money(h.amount)} (${pc(h.share)} of spending). The top 3 categories add up to ${pc(h.top3Share)}.`);
    case "up":
      return h.avg < 1
        ? L(`${cat(h.category)} apareceu este mês: ${money(h.amount)} (nos 3 meses anteriores, nada).`, `${cat(h.category)} showed up this month: ${money(h.amount)} (nothing in the previous 3 months).`)
        : L(`${cat(h.category)} subiu: ${money(h.amount)} contra ${money(h.avg)} na média (+${money(h.amount - h.avg)}).`, `${cat(h.category)} went up: ${money(h.amount)} vs ${money(h.avg)} on average (+${money(h.amount - h.avg)}).`);
    case "down":
      return L(`${cat(h.category)} caiu: ${money(h.amount)} contra ${money(h.avg)} na média (−${money(h.avg - h.amount)}).`, `${cat(h.category)} went down: ${money(h.amount)} vs ${money(h.avg)} on average (−${money(h.avg - h.amount)}).`);
    case "merchant":
      return L(`Onde você mais gasta: ${h.label} — ${h.count} compras, ${money(h.amount)}.`, `Where you spend the most: ${h.label} — ${h.count} purchases, ${money(h.amount)}.`);
    case "largest": {
      const day = new Date(`${h.date}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
      return L(`Maior gasto avulso: ${h.label}, ${money(h.amount)} em ${day} (${cat(h.category)}).`, `Biggest one-off expense: ${h.label}, ${money(h.amount)} on ${day} (${cat(h.category)}).`);
    }
    case "installments":
      return h.count === 1
        ? L(`Uma parcela leva ${money(h.amount)} (${pc(h.share)} dos gastos) — compra feita antes, que ainda pesa.`, `One installment takes ${money(h.amount)} (${pc(h.share)} of spending) — an earlier purchase still being paid off.`)
        : L(`Parcelas levam ${money(h.amount)} (${pc(h.share)} dos gastos) em ${h.count} lançamentos parcelados.`, `Installments take ${money(h.amount)} (${pc(h.share)} of spending) across ${h.count} installment charges.`);
    case "new":
      return h.count === 1
        ? L(`Um lugar novo este mês: ${h.label}, ${money(h.amount)}.`, `A new place this month: ${h.label}, ${money(h.amount)}.`)
        : L(`${h.count} lugares novos este mês somam ${money(h.total)} — o maior é ${h.label} (${money(h.amount)}).`, `${h.count} new places this month add up to ${money(h.total)} — the biggest is ${h.label} (${money(h.amount)}).`);
    case "uncategorized":
      return L(`${money(h.amount)} (${pc(h.share)}) está em "Outros gastos" — categorize para deixar este retrato mais preciso.`, `${money(h.amount)} (${pc(h.share)}) is under "Other expenses" — categorize it to sharpen this picture.`);
  }
}
