import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, fromPluggyCategory, monthlyFlows, normDesc, savingsCapacity, type BankTx } from "./cashflow";
import { budgetStatus, commitments, detectRecurring, suggestBudgets } from "./ledger";

const tx = (o: Partial<BankTx> & { category?: string }): BankTx & { category: string } => ({
  id: Math.random().toString(36), itemId: "i", accountId: "a", accountName: "Conta", accountType: "BANK", institution: "Itaú", owner: "PF",
  date: "2026-10-10", description: "X", amount: -10, currency: "BRL", pluggyCategory: null, category: "outros", ...o,
});

test("categoria: regra do usuário > IA > banco > genérico pelo sinal", () => {
  const t = { description: "PIX ENVIADO JOAO 12/12", pluggyCategory: "Transfer - PIX", amount: -100 };
  assert.deepEqual(categorize(t, [], {}), { category: "outros", source: "default" });
  assert.deepEqual(categorize(t, [], { [normDesc(t.description)]: "moradia" }), { category: "moradia", source: "ai" });
  assert.deepEqual(categorize(t, [{ match: "pix enviado joao", category: "transferencia" }], { [normDesc(t.description)]: "moradia" }), { category: "transferencia", source: "rule" });
  assert.deepEqual(categorize({ description: "IFOOD", pluggyCategory: "Food delivery", amount: -50 }, [], {}), { category: "restaurantes", source: "pluggy" });
  assert.deepEqual(categorize({ description: "SALARIO", pluggyCategory: "Salary", amount: -50 }, [], {}).source, "default", "categoria de receita num débito não vale");
  assert.equal(normDesc("MP *SAMSUNG       18/18"), "mp *samsung");
  assert.equal(fromPluggyCategory("Income taxes"), "impostos", "imposto de renda é gasto, não receita");
});

test("mês: fatura, transferência e aplicação não contam; estorno reduz gasto; futuro fica de fora", () => {
  const flows = monthlyFlows([
    tx({ amount: 5000, category: "salario" }),
    tx({ amount: -1200, category: "moradia" }),
    tx({ amount: -300, category: "mercado" }),
    tx({ amount: 50, category: "mercado" }),
    tx({ amount: -2000, category: "fatura" }),
    tx({ amount: -1000, category: "investimento" }),
    tx({ amount: -99, category: "compras", date: "2026-12-10" }),
  ], "2026-11-01");
  assert.equal(flows.length, 1);
  assert.deepEqual([flows[0].income, flows[0].expenses, flows[0].net], [5000, 1450, 3550]);
  assert.equal(flows[0].byCategory.mercado, 250);
  const cap = savingsCapacity([{ ...flows[0], month: "2026-09" }, { ...flows[0], month: "2026-10", net: 1000 }, { ...flows[0], month: "2026-11", net: -9999 }], "2026-11");
  assert.deepEqual(cap, { average: 2275, months: ["2026-09", "2026-10"] }, "mês corrente não entra");
});

test("recorrentes: mesmo estabelecimento em 3+ meses com valor estável; parcelas e hábitos não", () => {
  const txs = [
    ...["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].map((date) => tx({ date, description: "NETFLIX.COM", amount: -55.9, category: "assinaturas" })),
    ...["2026-07-02", "2026-08-02", "2026-09-02"].map((date) => tx({ date, description: "LOJA X 1/3", amount: -100, category: "compras", installment: { n: 1, total: 3 } })),
    ...["2026-07", "2026-08", "2026-09"].flatMap((m) => [1, 8, 15, 22].map((d) => tx({ date: `${m}-${String(d).padStart(2, "0")}`, description: "PADARIA", amount: -20, category: "mercado" }))),
  ];
  const r = detectRecurring(txs, "2026-10-01");
  assert.deepEqual(r.map((x) => [x.label, x.amount, x.months, x.nextDate]), [["NETFLIX.COM", 55.9, 4, "2026-10-05"]]);
});

test("orçamento: gasto, projeção no ritmo do mês e sugestão pela mediana", () => {
  const month = { month: "2026-10", income: 0, expenses: 300, net: -300, byCategory: { mercado: 300 }, incomeByCategory: {} };
  const [b] = budgetStatus([{ category: "mercado", limit: 600 }], month, "2026-10-10");
  assert.deepEqual([b.spent, b.pct], [300, 0.5]);
  assert.ok(Math.abs(b.projected - 930) < 1e-9, "300 em 10 dias → 930 em 31");
  const flows = [810, 1000, 1210].map((v, i) => ({ ...month, month: `2026-0${7 + i}`, byCategory: { mercado: v } }));
  assert.deepEqual(suggestBudgets(flows, "2026-10"), [{ category: "mercado", limit: 1000 }]);
});

test("compromissos: fatura aberta pelo vencimento, parcelas futuras e recorrentes", () => {
  const ledger = {
    bills: [{ id: "o", accountId: "c", accountName: "Visa", institution: "Itaú", owner: "PF" as const, dueDate: "2026-11-28", total: 3000, open: true }],
    bankTx: [tx({ accountType: "CREDIT", date: "2026-12-05", amount: -200, installment: { n: 2, total: 3 } }), tx({ accountType: "CREDIT", date: "2027-01-05", amount: -200, installment: { n: 3, total: 3 } })],
  };
  const c = commitments(ledger, [{ key: "n", label: "Netflix", category: "assinaturas", amount: 50, lastDate: "", nextDate: "", months: 3, account: "" }], "2026-11-01");
  assert.deepEqual(c.map((x) => [x.month, x.bills, x.installments, x.total]), [["2026-11", 3000, 0, 3050], ["2026-12", 0, 200, 250], ["2027-01", 0, 200, 250]]);
});
