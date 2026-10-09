import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeImport, posKey } from "./importMerge";
import type { ExtractedItem, Position, Transaction } from "./types";

const NOW = "2026-10-09T12:00:00.000Z";
let n = 0;
const opts = (removeStale = false) => ({ removeStale, now: NOW, newId: () => `new-${++n}` });

const item = (o: Partial<ExtractedItem>): ExtractedItem => ({
  kind: "position", sourceFile: "print.png", institution: "BTG Pactual", name: "Ativo", ticker: null,
  assetClass: "caixa", subtype: "", currency: "BRL", value: 100, quantity: null, date: null, txType: null,
  confidence: "alta", notes: null, ...o,
});

const pos = (o: Partial<Position>): Position => ({
  id: "p", name: "Ativo", institution: "BTG Pactual", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 1, updatedAt: "2026-01-01", source: "old", ...o,
});

test("posKey ignora acento, caixa e espaços; usa ticker quando existe", () => {
  assert.equal(posKey(" Itaú ", "petr4", "Petrobras PN"), posKey("itau", "PETR4", "outro nome"));
  assert.notEqual(posKey("XP", null, "Tesouro Selic 2029"), posKey("XP", null, "Tesouro Selic 2031"));
});

test("atualiza posição existente mantendo o id e adiciona as novas", () => {
  const current = { positions: [pos({ id: "keep", ticker: "PETR4", name: "Petrobras", assetClass: "acoes", value: 10 })], transactions: [] };
  const out = mergeImport(
    current,
    [item({ ticker: "PETR4", name: "PETROBRAS PN", assetClass: "acoes", value: 31250 }), item({ name: "Conta corrente", value: 2314.77 })],
    opts(),
  );
  assert.equal(out.positions.length, 2);
  const petr = out.positions.find((p) => p.ticker === "PETR4")!;
  assert.equal(petr.id, "keep");
  assert.equal(petr.value, 31250);
  assert.equal(petr.updatedAt, NOW);
  assert.equal(current.positions[0].value, 10, "não muta o estado original");
});

test("removeStale apaga só posições antigas das instituições importadas", () => {
  const current = {
    positions: [
      pos({ id: "a", name: "CDB antigo" }),
      pos({ id: "b", name: "Tesouro Selic" }),
      pos({ id: "c", institution: "Nubank", name: "Caixinha" }),
    ],
    transactions: [],
  };
  const items = [item({ name: "Tesouro Selic", value: 500 })];

  const keep = mergeImport(current, items, opts(false));
  assert.deepEqual(keep.positions.map((p) => p.id).sort(), ["a", "b", "c"]);

  const prune = mergeImport(current, items, opts(true));
  assert.deepEqual(prune.positions.map((p) => p.id).sort(), ["b", "c"]);
});

test("transações não duplicam (nem contra o histórico, nem dentro do mesmo import)", () => {
  const existing: Transaction = {
    id: "t1", date: "2026-10-01", type: "dividendo", description: "Rendimento MXRF11", institution: "XP",
    assetClass: "fiis", amount: 90.5, currency: "BRL", source: "x", importedAt: NOW,
  };
  const tx = (o: Partial<ExtractedItem>) =>
    item({ kind: "transaction", institution: "XP", txType: "dividendo", date: "2026-10-01", name: "Rendimento MXRF11", value: 90.5, ...o });

  const out = mergeImport(
    { positions: [], transactions: [existing] },
    [tx({}), tx({ name: "rendimento mxrf11 " }), tx({ value: 12 }), tx({ value: 12 }), tx({ txType: null, value: 7 })],
    opts(),
  );
  assert.equal(out.transactions.length, 3); // existente + R$12 + R$7
  assert.equal(out.transactions.at(-1)!.type, "outro");
  assert.equal(out.positions.length, 0);
});

test("item de posição em USD preserva moeda e quantidade", () => {
  const out = mergeImport({ positions: [], transactions: [] }, [item({ ticker: "VOO", currency: "USD", value: 1200, quantity: 2.5, assetClass: "internacional" })], opts());
  assert.equal(out.positions[0].currency, "USD");
  assert.equal(out.positions[0].quantity, 2.5);
  assert.equal(out.positions[0].source, "print.png");
});
