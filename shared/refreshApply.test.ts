import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRefresh, isChange } from "./refreshApply";
import type { Position, RefreshLine } from "./types";

const NOW = "2026-10-09T15:00:00.000Z";
const p = (id: string, value: number, quantity?: number): Position => ({
  id, name: id, institution: "x", owner: "PF", assetClass: "acoes", subtype: "", currency: "BRL",
  value, quantity, updatedAt: "2026-09-01", source: "",
});
const line = (id: string, oldValue: number, newValue: number, method: RefreshLine["method"], quantity?: number): RefreshLine => ({
  id, name: id, currency: "BRL", oldValue, newValue, method, quantity, note: "",
});

test("aplica só as aprovadas e grava a quantidade inferida", () => {
  const positions = [p("a", 100), p("b", 200, 3), p("c", 300)];
  const lines = [line("a", 100, 150, "cotacao", 10), line("b", 200, 210, "cotacao", 3), line("c", 300, 330, "indexador")];
  const out = applyRefresh(positions, lines, new Set(["a", "c"]), NOW);
  assert.deepEqual(out.map((x) => x.value), [150, 200, 330]);
  assert.equal(out[0].quantity, 10);
  assert.equal(out[0].updatedAt, NOW);
  assert.equal(out[1].updatedAt, "2026-09-01", "não aprovada fica intacta");
  assert.equal(out[2].quantity, undefined, "indexador não inventa quantidade");
  assert.equal(positions[0].value, 100, "não muta a entrada");
});

test("'mantido' não altera nem a data (para não perder o período de acúmulo)", () => {
  const out = applyRefresh([p("cc", 500)], [line("cc", 500, 999, "mantido")], new Set(["cc"]), NOW);
  assert.equal(out[0].value, 500);
  assert.equal(out[0].updatedAt, "2026-09-01");
});

test("isChange ignora mantidos e diferenças de centavos", () => {
  assert.equal(isChange(line("a", 100, 100.001, "cotacao")), false);
  assert.equal(isChange(line("a", 100, 101, "cotacao")), true);
  assert.equal(isChange(line("a", 100, 101, "mantido")), false);
});

test("Open Finance: atualiza, remove o que saiu e cria o que entrou (só o aprovado)", () => {
  const positions = [p("a", 100), p("b", 200), p("c", 300)];
  const lines: RefreshLine[] = [
    { id: "a", name: "A", currency: "BRL", oldValue: 100, newValue: 110, method: "openfinance", quantity: 7, note: "" },
    { id: "b", name: "B", currency: "BRL", oldValue: 200, newValue: 0, method: "removido", note: "" },
    { id: "c", name: "C", currency: "BRL", oldValue: 300, newValue: 0, method: "removido", note: "" },
    {
      id: "of-new:x:0", name: "N", currency: "BRL", oldValue: 0, newValue: 50, method: "openfinance", note: "",
      add: { kind: "position", sourceFile: "OF", institution: "BTG Pactual", name: "Novo", ticker: null, assetClass: "caixa", subtype: "CDB", currency: "BRL", value: 50, quantity: null, date: null, txType: null, owner: "PF", confidence: "alta", notes: null },
    },
  ];
  assert.ok(lines.every(isChange));
  const out = applyRefresh(positions, lines, new Set(["a", "b", "of-new:x:0"]), "2026-10-10T00:00:00Z", () => "novo-id");
  assert.deepEqual(out.map((x) => [x.id, x.value]), [["a", 110], ["c", 300], ["novo-id", 50]]);
  assert.equal(out[0].quantity, 7);
  assert.equal(out[2].institution, "BTG Pactual");
});
