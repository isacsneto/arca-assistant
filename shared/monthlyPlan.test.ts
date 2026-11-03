import { test } from "node:test";
import assert from "node:assert/strict";
import { linkWithTx, mergeSameLink, planAuto, planCardBills, planGrid, planOf, suggestLinks, type MonthlyPlan, type PlanLine } from "./monthlyPlan";
import type { BankTx, Bill } from "./cashflow";

const TODAY = "2026-11-03";
const line = (o: Partial<PlanLine>): PlanLine => ({ id: o.name ?? "l", name: "Conta", owner: "PF", kind: "expense", cells: {}, ...o });
const tx = (o: Partial<BankTx> & { category?: string }): BankTx & { category: string } => ({
  id: Math.random().toString(36), itemId: "i", accountId: "conta", accountName: "Conta", accountType: "BANK", institution: "Itaú", owner: "PF",
  date: "2026-10-10", description: "PIX QR CODE TELEFONIA", amount: -100, currency: "BRL", pluggyCategory: null, category: "contas", ...o,
});
const bill = (o: Partial<Bill>): Bill => ({ id: "b", accountId: "cartao", accountName: "CARTAO X", institution: "Itaú", owner: "PF", dueDate: "2026-10-28", total: 1000, ...o });

test("normaliza o que vem do disco: status inválido, mês inválido e célula vazia somem", () => {
  const p = planOf({ lines: [{ id: "a", name: "Escola", owner: "XX", kind: "?", cells: { "2026-10": { amount: 2000, status: "pago", manual: true }, "2026-13x": { amount: 1 }, "2026-11": { status: "foo" } } }] });
  assert.deepEqual(p.lines[0].cells, { "2026-10": { amount: 2000, status: "pago", manual: true } });
  assert.deepEqual([p.lines[0].owner, p.lines[0].kind], ["PF", "expense"]);
});

test("vínculo sugerido: fatura do cartão que bate com a linha; descrição que bate em valor e mês", () => {
  const plan: MonthlyPlan = { lines: [
    line({ id: "cartao", name: "Cartão", cells: { "2026-09": { amount: 900 }, "2026-10": { amount: 1000 } } }),
    line({ id: "tel", name: "Telefone", cells: { "2026-08": { amount: 100 }, "2026-09": { amount: 100 }, "2026-10": { amount: 140 } } }),
  ] };
  const txs = [
    tx({ date: "2026-08-08", amount: -99.5, description: "PIX QR CODE TELEFONIA 123456" }),
    tx({ date: "2026-09-08", amount: -100, description: "PIX QR CODE TELEFONIA 654321" }),
    tx({ date: "2026-10-08", amount: -140, description: "PIX QR CODE TELEFONIA 999999" }),
    // Transferência entre contas nunca é a "conta", mesmo batendo valor.
    tx({ date: "2026-09-01", amount: -100, description: "TRANSF PROPRIA", category: "transferencia" }),
    tx({ date: "2026-10-01", amount: -140, description: "TRANSF PROPRIA", category: "transferencia" }),
  ];
  const links = suggestLinks(plan, txs, [bill({ dueDate: "2026-09-28", total: 900 }), bill({ total: 1000 })]);
  assert.deepEqual(links.cartao, { card: "cartao" });
  assert.deepEqual(links.tel.patterns, ["pix qr code telefonia"]);
  assert.ok(links.tel.min! < 99.5 && links.tel.max! > 140);
});

test("coincidência de valor não vira vínculo: a descrição tem que bater na maioria dos meses em que aparece", () => {
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const plan: MonthlyPlan = { lines: [line({ id: "imposto", cells: Object.fromEntries(months.map((m) => [m, { amount: 450 }])) })] };
  // Boleto mensal que só em 2 meses custou o mesmo que o imposto.
  const txs = months.map((m, i) => tx({ date: `${m}-10`, description: "BOLETO PLANO", amount: i < 2 ? -450 : -900 }));
  assert.equal(suggestLinks(plan, txs, []).imposto, undefined);
});

test("automático: fatura fechada aguardando → paga quando o débito aparece; lançamentos somam na linha", () => {
  const plan: MonthlyPlan = { lines: [
    line({ id: "cartao", link: { card: "cartao" }, cells: { "2026-10": { amount: 1 } } }),
    line({ id: "tel", link: { patterns: ["pix qr code telefonia"], min: 50, max: 200 }, cells: { "2026-10": { amount: 120 } } }),
  ] };
  const bills = planCardBills([bill({ dueDate: "2026-10-28", total: 1000 }), bill({ id: "n", dueDate: "2026-11-28", total: 800 })], [{ accountId: "cartao", month: "2026-12", dueDate: "2026-12-28", total: 300 }]);
  const months = ["2026-10", "2026-11", "2026-12"];
  const txs = [
    tx({ date: "2026-10-28", amount: -1000, description: "DEBITO AUTOMATICO FATURA", category: "fatura" }),
    tx({ date: "2026-10-08", amount: -140, description: "PIX QR CODE TELEFONIA 1" }),
  ];
  const auto = planAuto(plan, txs, bills, months, TODAY);
  assert.deepEqual([auto.cartao["2026-10"].status, auto.cartao["2026-11"].status, auto.cartao["2026-12"].status], ["pago", "aguardando", "previsto"]);
  assert.equal(auto.cartao["2026-12"].forecast, true);
  assert.deepEqual([auto.tel["2026-10"].amount, auto.tel["2026-10"].status], [140, "pago"]);
});

test("grade: digitado > banco > planejado > previsão; previsão só do mês atual em diante", () => {
  const plan: MonthlyPlan = { lines: [
    // 0 no mês seguinte: não repete.
    line({ id: "pago", cells: { "2026-10": { amount: 1200, status: "pago", manual: true }, "2026-11": { amount: 0 } } }),
    line({ id: "plan", cells: { "2026-10": { amount: 100, manual: true }, "2026-11": { amount: 2000 } } }),
    line({ id: "renda", kind: "income", cells: { "2026-10": { amount: 200, manual: true }, "2026-11": { amount: 150 } } }),
  ] };
  const auto = {
    pago: { "2026-10": { amount: 1500, status: "pago" as const, source: "card" as const, tx: [] } },
    plan: { "2026-11": { amount: 2100, status: "aguardando" as const, source: "card" as const, tx: [] } },
  };
  const g = planGrid(plan, 2026, auto, TODAY);
  const cell = (id: string, m: string) => g.rows.find((r) => r.line.id === id)!.cells.find((c) => c.month === m)!;
  assert.equal(cell("pago", "2026-10").amount, 1200, "digitado vale mais que o banco");
  assert.deepEqual([cell("plan", "2026-11").amount, cell("plan", "2026-11").planned, cell("plan", "2026-11").status], [2100, 2000, "aguardando"]);
  assert.deepEqual([cell("plan", "2026-12").amount, cell("plan", "2026-12").forecast], [2100, true], "repete o mês anterior");
  assert.equal(cell("plan", "2026-09").amount, null, "passado sem dado fica vazio");
  assert.equal(cell("pago", "2026-12").amount, null, "0 interrompe a repetição");
  const nov = g.totals.find((t) => t.month === "2026-11")!;
  assert.deepEqual([nov.expenses, nov.income, nov.open], [2100, 150, 2100]);
});

test("fatura aberta maior que o planejado vale a do banco; menor fica o planejado", () => {
  const plan: MonthlyPlan = { lines: [line({ id: "c", cells: { "2026-11": { amount: 2000 }, "2026-12": { amount: 2500 } } })] };
  const f = (amount: number) => ({ amount, status: "previsto" as const, source: "card" as const, forecast: true, tx: [] });
  const g = planGrid(plan, 2026, { c: { "2026-11": f(2100), "2026-12": f(1800) } }, TODAY);
  assert.deepEqual(g.rows[0].cells.slice(10).map((c) => c.amount), [2100, 2500]);
});

test("linha que acabou (ou ano já planejado sem ela) não recebe banco nem previsão", () => {
  const plan: MonthlyPlan = { lines: [
    line({ id: "velha", link: { card: "cartao" }, cells: { "2025-12": { amount: 500, manual: true } } }),
    line({ id: "nova", cells: { "2026-10": { amount: 100, manual: true } } }),
  ] };
  const auto = { velha: { "2026-10": { amount: 999, status: "pago" as const, source: "card" as const, tx: [] } } };
  const g = planGrid(plan, 2026, auto, TODAY);
  assert.equal(g.rows.some((r) => r.line.id === "velha"), false);
  assert.equal(g.year.expenses, 100 + 100 + 100, "a nova repete out → nov e dez");
});

test("mesma conta com outro nome em outro ano: vira uma linha (a mais recente) com o histórico", () => {
  const plan = mergeSameLink({ lines: [
    line({ id: "a", name: "Visa Gold", link: { card: "visa" }, cells: { "2025-12": { amount: 1 } } }),
    line({ id: "b", name: "Cartao Visa Gold", link: { card: "visa" }, cells: { "2026-01": { amount: 2 } } }),
  ] });
  assert.deepEqual(plan.lines.map((l) => [l.name, Object.keys(l.cells)]), [["Cartao Visa Gold", ["2025-12", "2026-01"]]]);
});

test("ligar à mão um lançamento: a descrição vira padrão e a faixa de valor cabe nele", () => {
  const l = linkWithTx({ patterns: ["pix telefonia"], min: 80, max: 150 }, { description: "PIX QR CODE TELEFONIA 123456", amount: -300 });
  assert.deepEqual(l.patterns, ["pix telefonia", "pix qr code telefonia"]);
  assert.ok(l.min! <= 80 && l.max! >= 300);
});
