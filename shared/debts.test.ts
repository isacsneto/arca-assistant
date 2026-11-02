import { test } from "node:test";
import assert from "node:assert/strict";
import { amortizeOrInvest, debtRows, netOfTax, totalDebt } from "./debts";

test("dívidas do Open Finance + cadastradas, maiores primeiro; total", () => {
  const rows = debtRows(
    { debts: [{ id: "m", name: "Carro", balance: 30_000, ratePct: 18, installment: 1500, remaining: 24, owner: "PF" }] },
    { loans: [{ id: "l", itemId: "i", institution: "Itaú", owner: "PF", name: "Imobiliário", balance: 300_000, currency: "BRL", ratePct: 10.5, installment: 3000, remaining: 200, dueDate: null }] },
  );
  assert.deepEqual(rows.map((r) => [r.name, r.source]), [["Imobiliário", "openfinance"], ["Carro", "manual"]]);
  assert.equal(totalDebt(rows), 330_000);
});

test("amortizar × investir: juro da dívida contra o CDI líquido de IR", () => {
  const net = netOfTax(14);
  assert.ok(Math.abs(net - 11.9) < 1e-9);
  assert.deepEqual(amortizeOrInvest(18, net).verdict, "amortizar");
  assert.ok(Math.abs(amortizeOrInvest(18, net).per10kYear! - 610) < 1e-6);
  assert.equal(amortizeOrInvest(8, net).verdict, "investir");
  assert.equal(amortizeOrInvest(12, net).verdict, "empate");
  assert.equal(amortizeOrInvest(null, net).verdict, "sem-taxa");
});
