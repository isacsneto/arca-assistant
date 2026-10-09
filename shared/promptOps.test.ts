import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPromptOps, previewOps } from "./promptOps";
import type { Position, PromptOp } from "./types";

const NOW = "2026-10-10T12:00:00.000Z";
let n = 0;
const ctx = { now: NOW, newId: () => `new-${++n}`, source: "texto" };

const pos = (o: Partial<Position>): Position => ({
  id: "inter", name: "Caixinha CDB", institution: "Banco Inter", owner: "PJ", assetClass: "caixa", subtype: "CDB 100% CDI",
  currency: "BRL", value: 272361.79, updatedAt: "2026-10-09", source: "x", ...o,
});

const op = (o: Partial<PromptOp>): PromptOp => ({
  action: "ajustar", positionId: "inter", delta: null, quantityDelta: null, value: null, newPosition: null,
  transaction: null, explanation: "teste", ...o,
});

test("aporte soma ao saldo e registra a transação de depósito", () => {
  const ops = [op({ delta: 17000.3, transaction: { type: "deposito", date: null, amount: 17000.3 }, explanation: "Aporte de R$ 17.000,30 na caixinha CDB do Inter PJ" })];
  const [row] = previewOps([pos({})], ops);
  assert.equal(row.before, 272361.79);
  assert.equal(row.after, 289362.09);
  assert.equal(row.error, null);

  const out = applyPromptOps({ positions: [pos({})], transactions: [] }, ops, new Set([0]), ctx);
  assert.equal(out.positions[0].value, 289362.09);
  assert.equal(out.positions[0].updatedAt, NOW);
  assert.equal(out.transactions.length, 1);
  assert.deepEqual(
    { type: out.transactions[0].type, amount: out.transactions[0].amount, owner: out.transactions[0].owner, inst: out.transactions[0].institution, date: out.transactions[0].date },
    { type: "deposito", amount: 17000.3, owner: "PJ", inst: "Banco Inter", date: "2026-10-10" },
  );
});

test("resgate maior que o saldo é barrado", () => {
  const [row] = previewOps([pos({ value: 1000 })], [op({ delta: -5000 })]);
  assert.match(row.error!, /negativo/);
  const out = applyPromptOps({ positions: [pos({ value: 1000 })], transactions: [] }, [op({ delta: -5000 })], new Set([0]), ctx);
  assert.equal(out.positions[0].value, 1000, "operação com erro não é aplicada");
});

test("operações na mesma posição se acumulam; só as aprovadas são aplicadas", () => {
  const ops = [op({ delta: 1000 }), op({ delta: -300 }), op({ action: "definir", value: 50 })];
  const rows = previewOps([pos({ value: 100 })], ops);
  assert.deepEqual(rows.map((r) => [r.before, r.after]), [[100, 1100], [1100, 800], [800, 50]]);
  const out = applyPromptOps({ positions: [pos({ value: 100 })], transactions: [] }, ops, new Set([0, 1]), ctx);
  assert.equal(out.positions[0].value, 800);
});

test("compra de ações ajusta valor e quantidade", () => {
  const petr = pos({ id: "petr", ticker: "PETR4", name: "Petrobras", assetClass: "acoes", value: 5600, quantity: 100, owner: "PF" });
  const out = applyPromptOps(
    { positions: [petr], transactions: [] },
    [op({ positionId: "petr", delta: 3850, quantityDelta: 100, transaction: { type: "compra", date: "2026-10-08", amount: 3850 } })],
    new Set([0]),
    ctx,
  );
  assert.equal(out.positions[0].quantity, 200);
  assert.equal(out.positions[0].value, 9450);
  assert.equal(out.transactions[0].date, "2026-10-08");
  assert.equal(out.transactions[0].ticker, "PETR4");
});

test("criar adiciona ativo novo; remover apaga; posição inexistente é erro", () => {
  const ops: PromptOp[] = [
    op({
      action: "criar", positionId: null, value: 10000,
      newPosition: { name: "LCI 95% CDI", ticker: null, institution: "Itaú", owner: "PF", assetClass: "caixa", subtype: "LCI 95% CDI", currency: "BRL", quantity: null },
      transaction: { type: "deposito", date: null, amount: 10000 },
    }),
    op({ action: "remover", positionId: "inter" }),
    op({ positionId: "nao-existe", delta: 10 }),
  ];
  const rows = previewOps([pos({})], ops);
  assert.equal(rows[0].after, 10000);
  assert.equal(rows[1].after, 0);
  assert.match(rows[2].error!, /não encontrada/);

  const out = applyPromptOps({ positions: [pos({})], transactions: [] }, ops, new Set([0, 1, 2]), ctx);
  assert.deepEqual(out.positions.map((p) => p.name), ["LCI 95% CDI"]);
  assert.equal(out.positions[0].owner, "PF");
  assert.equal(out.transactions.length, 1);
});

test("criar sem valor ou sem dados do ativo é erro", () => {
  const rows = previewOps([], [op({ action: "criar", positionId: null }), op({ action: "criar", positionId: null, newPosition: { name: "X", ticker: null, institution: "Y", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL", quantity: null } })]);
  assert.match(rows[0].error!, /Faltam/);
  assert.match(rows[1].error!, /inválido/);
});
