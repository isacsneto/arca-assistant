import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyFlows, type BankTx } from "./cashflow";
import { categoryMix, describeHighlight, highlightTone, REST, spendingHighlights, type Highlight } from "./spendingInsights";

let seq = 0;
const tx = (o: Partial<BankTx> & { category?: string }): BankTx & { category: string } => ({
  id: String(++seq), itemId: "i", accountId: "a", accountName: "Conta", accountType: "BANK", institution: "Banco", owner: "PF",
  date: "2026-10-10", description: "X", amount: -10, currency: "BRL", pluggyCategory: null, category: "outros", ...o,
});

/** Três meses "normais" (jul–set) e outubro com mercado e viagem acima do comum. */
function history() {
  const base = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [
    tx({ date: `${m}-05`, description: "ALUGUEL", amount: -2500, category: "moradia" }),
    tx({ date: `${m}-08`, description: "SUPERMERCADO BOM", amount: -800, category: "mercado" }),
    tx({ date: `${m}-12`, description: "IFOOD", amount: -300, category: "restaurantes" }),
    tx({ date: `${m}-20`, description: "LAZER CLUBE", amount: -600, category: "lazer" }),
  ]);
  const oct = [
    tx({ date: "2026-10-05", description: "ALUGUEL", amount: -2500, category: "moradia" }),
    tx({ date: "2026-10-08", description: "SUPERMERCADO BOM", amount: -900, category: "mercado" }),
    tx({ date: "2026-10-15", description: "SUPERMERCADO BOM", amount: -700, category: "mercado" }),
    tx({ date: "2026-10-12", description: "IFOOD", amount: -300, category: "restaurantes" }),
    tx({ date: "2026-10-18", description: "LATAM AIRLINES", amount: -1800, category: "viagem" }),
    tx({ date: "2026-10-20", description: "LOJA TV 2/10", amount: -400, category: "compras", installment: { n: 2, total: 10 } }),
    tx({ date: "2026-10-21", description: "LOJA TV 2/10 ESTORNO", amount: 0, category: "compras" }),
    tx({ date: "2026-10-25", description: "PIX ALGUEM", amount: -50, category: "outros" }),
    tx({ date: "2026-10-26", description: "PAGAMENTO FATURA", amount: -3000, category: "fatura" }),
  ];
  return [...base, ...oct];
}

test("composição: cores pelas maiores do histórico inteiro; o resto vira um bloco só", () => {
  const all = history();
  const flows = monthlyFlows(all, "2026-10-31");
  const mix = categoryMix(flows, "2026-10", 6, 3);
  assert.deepEqual(mix.keys, ["moradia", "mercado", "lazer", REST], "empate lazer × viagem (1.800 cada): fica a que apareceu primeiro");
  const oct = mix.rows.at(-1)!;
  assert.equal(oct.total, 6650);
  assert.equal(oct.values.moradia + oct.values.mercado + oct.values.lazer + oct.values[REST], oct.total, "pedaços somam o total");
  // Mês selecionado mais antigo: a janela termina nele e as cores não mudam.
  const sep = categoryMix(flows, "2026-08", 6, 3);
  assert.deepEqual(sep.keys, mix.keys);
  assert.deepEqual(sep.rows.map((r) => r.month), ["2026-07", "2026-08"]);
});

test("destaques de um mês fechado: total, maior categoria, o que subiu, hábito, maior gasto, parcelas, lugar novo", () => {
  const all = history();
  const flows = monthlyFlows(all, "2026-11-17");
  const h = spendingHighlights(flows, all, "2026-10", "2026-11-17", { max: 20 });
  const kinds = h.map((x) => x.kind);
  assert.deepEqual(kinds, ["total", "top", "up", "up", "down", "merchant", "largest", "installments", "new"]);
  const total = h[0] as Extract<Highlight, { kind: "total" }>;
  assert.deepEqual([total.amount, total.avg], [6650, 4200]);
  assert.equal(highlightTone(total), "bad");
  assert.deepEqual(h.filter((x) => x.kind === "up").map((x) => (x as { category: string }).category), ["viagem", "mercado"], "viagem (+1.800) antes de mercado (+800)");
  assert.equal((h.find((x) => x.kind === "down") as { category: string }).category, "lazer", "lazer sumiu (−600)");
  const merchant = h.find((x) => x.kind === "merchant") as Extract<Highlight, { kind: "merchant" }>;
  assert.deepEqual([merchant.label, merchant.count, merchant.amount], ["SUPERMERCADO BOM", 2, 1600]);
  assert.equal((h.find((x) => x.kind === "largest") as { label: string }).label, "LATAM AIRLINES", "aluguel é conta fixa, não 'maior gasto'");
  const inst = h.find((x) => x.kind === "installments") as Extract<Highlight, { kind: "installments" }>;
  assert.deepEqual([inst.amount, inst.count], [400, 1]);
  const fresh = h.find((x) => x.kind === "new") as Extract<Highlight, { kind: "new" }>;
  assert.deepEqual([fresh.count, fresh.total], [3, 2250], "LATAM, LOJA TV e PIX ALGUEM");
  assert.ok(!kinds.includes("uncategorized"), "R$ 50 em Outros é pouco");
  assert.match(describeHighlight(total, (n) => `R$ ${n}`), /R\$ 6650 — R\$ 2450 \(58%\) acima/);
});

test("mês corrente: ritmo em vez de total e nada de 'caiu' (o mês ainda não acabou)", () => {
  const all = [...history(), tx({ date: "2026-11-03", description: "ALUGUEL", amount: -2500, category: "moradia" }), tx({ date: "2026-11-20", description: "FUTURO", amount: -999, category: "compras" })];
  const flows = monthlyFlows(all, "2026-11-10");
  const h = spendingHighlights(flows, all, "2026-11", "2026-11-10");
  assert.equal(h[0].kind, "pace");
  const pace = h[0] as Extract<Highlight, { kind: "pace" }>;
  assert.equal(pace.amount, 2500, "lançamento futuro fica de fora");
  // Até o dia 10: ago/set 2500+800 = 3300; out 2500+900 = 3400 → média 3333,33.
  assert.equal(Math.round(pace.sameDay), 3333);
  assert.equal(highlightTone(pace), "good", "abaixo do que costuma ter gasto até o dia 10");
  assert.ok(!h.some((x) => x.kind === "down"));
  assert.ok(!h.some((x) => x.kind === "largest" && x.label === "FUTURO"));
});

test("a mesma compra não vira dois destaques", () => {
  const all = [...history(), tx({ date: "2026-11-08", description: "ZARA", amount: -690, category: "pessoal" })];
  const flows = monthlyFlows(all, "2026-11-30");
  const h = spendingHighlights(flows, all, "2026-11", "2026-11-30", { max: 20 });
  assert.ok(h.some((x) => x.kind === "up" && x.category === "pessoal"));
  assert.ok(!h.some((x) => x.kind === "new"), "o 'lugar novo' seria a mesma ZARA");
});

test("muito em 'Outros' pede para categorizar; sem histórico não há comparação", () => {
  const all = [tx({ date: "2026-10-02", description: "PIX A", amount: -500, category: "outros" }), tx({ date: "2026-10-03", description: "MERCADO", amount: -500, category: "mercado" })];
  const flows = monthlyFlows(all, "2026-10-31");
  const h = spendingHighlights(flows, all, "2026-10", "2026-11-01");
  assert.ok(h.some((x) => x.kind === "uncategorized"));
  assert.ok(!h.some((x) => x.kind === "total" || x.kind === "up" || x.kind === "new"), "sem meses anteriores, nada a comparar");
  assert.deepEqual(spendingHighlights(flows, all, "2026-05", "2026-11-01"), [], "mês sem gasto");
});

test("revisão: o aviso de 'Outros' não cai no corte de 7 destaques", () => {
  const all = [...history(), tx({ date: "2026-10-27", description: "PIX FULANO", amount: -1000, category: "outros" })];
  const flows = monthlyFlows(all, "2026-11-17");
  const h = spendingHighlights(flows, all, "2026-10", "2026-11-17");
  assert.equal(h.length, 7);
  assert.equal(h.at(-1)!.kind, "uncategorized");
});

test("revisão: mês parcial do começo do histórico e meses sem dados não entram na média", () => {
  const all = [
    tx({ date: "2026-06-25", description: "MERCADO", amount: -100, category: "mercado" }), // sincronização começou dia 25
    ...["2026-08", "2026-09"].map((m) => tx({ date: `${m}-10`, description: "MERCADO", amount: -1000, category: "mercado" })),
    tx({ date: "2026-10-10", description: "MERCADO", amount: -1000, category: "mercado" }),
  ];
  const flows = monthlyFlows(all, "2026-10-31");
  const total = spendingHighlights(flows, all, "2026-10", "2026-11-01").find((x) => x.kind === "total") as Extract<Highlight, { kind: "total" }>;
  assert.equal(total.avg, 1000, "só ago e set (jul não tem dados; jun é parcial)");
});

test("revisão: estorno no passado não vira média negativa nem 'apareceu este mês'", () => {
  const all = [
    ...["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => tx({ date: `${m}-05`, description: "ALUGUEL", amount: -2000, category: "moradia" })),
    tx({ date: "2026-08-15", description: "LOJA ESTORNO", amount: 300, category: "compras" }),
    tx({ date: "2026-10-15", description: "LOJA", amount: -50, category: "compras" }),
  ];
  const flows = monthlyFlows(all, "2026-10-31");
  const h = spendingHighlights(flows, all, "2026-10", "2026-11-01");
  assert.ok(!h.some((x) => x.kind === "up" && x.category === "compras"), "R$ 50 contra média 0 não é destaque");
});

test("revisão: 'lugar novo' com 2 meses de histórico; recorrente e descrição vazia não confundem", () => {
  const all = [
    ...["2026-09", "2026-10", "2026-11"].map((m) => tx({ date: `${m}-02`, description: "ALUGUEL", amount: -2000, category: "moradia" })),
    tx({ date: "2026-09-20", description: "123456", amount: -40, category: "outros" }),
    tx({ date: "2026-10-20", description: "654321", amount: -40, category: "outros" }),
    tx({ date: "2026-11-05", description: "NETFLIX 03", amount: -60, category: "assinaturas" }),
    // Mercado já existe nos meses anteriores (em outro lugar): a categoria não "apareceu", o lugar sim.
    ...["2026-09", "2026-10"].map((m) => tx({ date: `${m}-12`, description: "SUPERMERCADO X", amount: -400, category: "mercado" })),
    tx({ date: "2026-11-09", description: "LOJA NOVA", amount: -500, category: "mercado" }),
    tx({ date: "2026-11-10", description: "999999", amount: -900, category: "compras" }),
  ];
  const flows = monthlyFlows(all, "2026-11-30");
  const h = spendingHighlights(flows, all, "2026-11", "2026-11-30", { max: 20, recurring: ["netflix"] });
  const largest = h.find((x) => x.kind === "largest") as Extract<Highlight, { kind: "largest" }>;
  assert.equal(largest.label, "999999", "descrição só com números ainda pode ser o maior gasto avulso");
  const fresh = h.find((x) => x.kind === "new") as Extract<Highlight, { kind: "new" }>;
  assert.ok(fresh, "set e out bastam de histórico para novembro");
  assert.equal(fresh.count, 1, "só LOJA NOVA: Netflix é recorrente e a descrição vazia não é 'lugar'");
  assert.match(describeHighlight(largest, (n) => `R$ ${n}`), /10 de nov/, "data sem ambiguidade de dia/mês");
});

test("revisão: olhar um mês passado não mistura os lançamentos dos meses seguintes", () => {
  const later = ["2026-11-05", "2026-12-05"].flatMap((d) => [
    tx({ date: d, description: "ALUGUEL", amount: -2500, category: "moradia" }),
    tx({ date: d, description: "LATAM AIRLINES", amount: -900, category: "viagem" }),
  ]);
  const base = history();
  const at = (all: ReturnType<typeof history>) => spendingHighlights(monthlyFlows(all, "2026-12-31"), all, "2026-10", "2026-12-31", { max: 20 });
  assert.deepEqual(at([...base, ...later]), at(base));
});
