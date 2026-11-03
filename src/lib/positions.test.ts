import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOpenFinance, patchPosition, removePosition } from "./positions";
import type { AppState, Position } from "../../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: "a", name: "CDB", institution: "Banco X", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 100, updatedAt: "2026-11-01T00:00:00Z", source: "extrato.pdf", ...o,
});
const st = (positions: Position[]) => ({ positions }) as unknown as AppState;

test("editar o valor à mão: data nova e deixa de ser estimativa da IA; só a posição editada muda", () => {
  const s = patchPosition(st([p({ aiEstimate: true }), p({ id: "b" })]), "a", { value: 25_000 }, "2026-11-02T10:00:00Z");
  assert.deepEqual([s.positions[0].value, s.positions[0].aiEstimate, s.positions[0].updatedAt], [25_000, undefined, "2026-11-02T10:00:00Z"]);
  assert.equal(s.positions[1].updatedAt, "2026-11-01T00:00:00Z");
});

test("renomear não mexe na marca de estimativa; apagar tira só a posição", () => {
  const s = patchPosition(st([p({ aiEstimate: true })]), "a", { name: "Reserva" });
  assert.deepEqual([s.positions[0].name, s.positions[0].aiEstimate], ["Reserva", true]);
  assert.deepEqual(removePosition(st([p({}), p({ id: "b" })]), "a").positions.map((x) => x.id), ["b"]);
});

test("origem Open Finance", () => {
  assert.equal(fromOpenFinance(p({ source: "Open Finance" })), true);
  assert.equal(fromOpenFinance(p({ source: "WhatsApp Image.jpeg" })), false);
});
