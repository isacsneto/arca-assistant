import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeAssets, summarizeAssets, type PhysicalAsset } from "./assets";

const a = (o: Partial<PhysicalAsset>): PhysicalAsset => ({
  id: Math.random().toString(), type: "carro", name: "x", value: 0, owner: "PF", updatedAt: "2026-10-10", ...o,
});

test("resumo por tipo respeita a visão PF/PJ e ignora tipos vazios", () => {
  const assets = [
    a({ type: "carro", value: 76000 }),
    a({ type: "carro", value: 150000 }),
    a({ type: "joias", value: 10000 }),
    a({ type: "imovel", value: 900000, owner: "PJ" }),
  ];
  const all = summarizeAssets(assets, "all");
  assert.equal(all.total, 1136000);
  assert.equal(all.count, 4);
  assert.deepEqual(all.byType.map((t) => [t.type, t.total, t.count]), [["imovel", 900000, 1], ["carro", 226000, 2], ["joias", 10000, 1]]);
  assert.equal(summarizeAssets(assets, "PF").total, 236000);
  assert.equal(summarizeAssets(assets, "PJ").total, 900000);
  assert.equal(summarizeAssets([], "all").total, 0);
});

test("sanitizeAssets aceita estado antigo/parcial sem quebrar", () => {
  assert.deepEqual(sanitizeAssets(undefined), []);
  const out = sanitizeAssets([
    { id: "1", type: "barco", name: "Lancha", value: "120000", owner: "XX" },
    { id: "2", type: "joias", name: "Anel", value: 10000, owner: "PJ", notes: "", updatedAt: "2026-10-10" },
    { name: "sem id" },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].type, out[0].value, out[0].owner], ["outros", 120000, "PF"]);
  assert.equal(out[1].owner, "PJ");
  assert.equal(out[1].notes, undefined);
});
