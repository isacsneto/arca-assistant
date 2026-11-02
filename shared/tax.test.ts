import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSales, darfByMonth, darfDueDate, discrimination, incomeFromTransactions, taxGroup, type Holding } from "./tax";
import type { InvestTxRecord } from "./ledger";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
const t = (o: Partial<InvestTxRecord>): InvestTxRecord => ({
  id: Math.random().toString(36), investmentId: "i", itemId: "x", institution: "BTG", owner: "PF", ticker: "PETR4", name: "PETROBRAS",
  kind: "EQUITY/STOCK", type: "BUY", date: "2026-01-10", quantity: 100, price: 30, amount: 3000, fees: 0, ...o,
});

test("grupo de tributação e vencimento do DARF (último dia útil do mês seguinte)", () => {
  assert.equal(taxGroup("EQUITY/STOCK", "PETR4"), "acoes");
  assert.equal(taxGroup("EQUITY/REAL_ESTATE_FUND", "MXRF11"), "fii");
  assert.equal(taxGroup("ETF/ETF", "BOVA11"), "etf");
  assert.equal(taxGroup("EQUITY/STOCK", "AAPL34"), "bdr");
  assert.equal(taxGroup("FIXED_INCOME/CDB", null), null);
  assert.equal(darfDueDate("2026-04"), "2026-05-29", "31/05/2026 é domingo");
});

test("venda pelo custo médio das compras; sem compras, custo da corretora (aproximado)", () => {
  const sales = computeSales([
    t({ date: "2026-01-10", quantity: 100, amount: 3000 }),
    t({ date: "2026-02-10", quantity: 100, amount: 5000 }),
    t({ date: "2026-03-10", type: "SELL", quantity: 50, amount: 2500, fees: 10 }),
    t({ ticker: "VALE3", name: "VALE", date: "2026-03-12", type: "SELL", quantity: 10, amount: 700 }),
  ], [{ itemId: "x", ticker: "VALE3", name: "VALE", kind: "EQUITY/STOCK", quantity: 20, cost: 1200, value: 1300, institution: "BTG", owner: "PF", isin: null, dueDate: null }]);
  const petr = sales.find((s) => s.ticker === "PETR4")!;
  close(petr.cost, 2000);
  close(petr.gain, 490);
  assert.equal(petr.approxCost, false);
  const vale = sales.find((s) => s.ticker === "VALE3")!;
  close(vale.cost, 600);
  assert.equal(vale.approxCost, true);
});

test("DARF: ações isentas até R$ 20 mil de vendas; FII 20%; prejuízo compensa; abaixo de R$ 10 acumula", () => {
  const s = (date: string, ticker: string, group: "acoes" | "fii" | "etf", proceeds: number, gain: number) => ({ date, ticker, group, quantity: 1, proceeds, cost: proceeds - gain, gain, approxCost: false });
  const months = darfByMonth([
    s("2026-01-05", "PETR4", "acoes", 15_000, 3000),
    s("2026-02-05", "PETR4", "acoes", 30_000, 4000),
    s("2026-03-05", "BOVA11", "etf", 10_000, -2000),
    s("2026-04-05", "BOVA11", "etf", 10_000, 3000),
    s("2026-05-05", "MXRF11", "fii", 1000, 40),
    s("2026-06-05", "MXRF11", "fii", 1000, 20),
  ], 2026);
  const by = Object.fromEntries(months.map((m) => [m.month, m]));
  assert.equal(by["2026-01"].darf, 0, "isento");
  assert.equal(by["2026-01"].stocksExempt, true);
  close(by["2026-02"].darf, 600);
  close(by["2026-03"].darf, 0);
  close(by["2026-04"].taxableCommon, 1000, );
  close(by["2026-04"].darf, 150);
  assert.equal(by["2026-05"].darf, 0, "R$ 8 acumula");
  close(by["2026-06"].darf, 12, );
});

test("proventos pela conta e discriminação de Bens e Direitos", () => {
  const tx = (description: string, amount: number) => ({ id: description, itemId: "", accountId: "", accountName: "", accountType: "BANK" as const, institution: "", owner: "PF" as const, date: "2026-05-10", description, amount, currency: "BRL", pluggyCategory: null, category: "rendimentos", categorySource: "pluggy" as const });
  const inc = incomeFromTransactions([tx("RENDIMENTOS - À VISTA s/ FII XPML11", 154.56), tx("JUROS S/ CAPITAL ITUB4", 80), tx("TRANSF", 999)], 2026);
  assert.deepEqual([inc.exempt, inc.jcp, inc.items.length], [154.56, 80, 2]);
  const h: Holding = { itemId: "", ticker: "PETR4", name: "PETROBRAS PN", kind: "EQUITY/STOCK", quantity: 100, cost: 3150.5, value: 4000, institution: "BTG Pactual", owner: "PF", isin: null, dueDate: null };
  assert.equal(discrimination(h), "100 PETR4 — PETROBRAS PN, custodiado em BTG Pactual. Custo de aquisição R$ 3.150,50 (preço médio R$ 31,51).");
});
