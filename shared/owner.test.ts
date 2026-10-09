import { test } from "node:test";
import assert from "node:assert/strict";
import { inView, withOwner } from "./owner";

test("migra o titular que estava no nome da instituição", () => {
  assert.deepEqual(withOwner({ institution: "BTG Pactual (PF)" }), { institution: "BTG Pactual", owner: "PF" });
  assert.deepEqual(withOwner({ institution: "BTG Pactual (pj)" }), { institution: "BTG Pactual", owner: "PJ" });
  assert.deepEqual(withOwner({ institution: "Itaú - PJ" }), { institution: "Itaú", owner: "PJ" });
});

test("sem indicação vira PF; owner existente é respeitado", () => {
  assert.deepEqual(withOwner({ institution: "XP" }), { institution: "XP", owner: "PF" });
  assert.deepEqual(withOwner({ institution: "BTG Pactual (PF)", owner: "PJ" as const }), { institution: "BTG Pactual (PF)", owner: "PJ" });
  assert.deepEqual(withOwner({ institution: "Banco PJotinha" }), { institution: "Banco PJotinha", owner: "PF" }, "não confunde palavra com sufixo");
});

test("inView filtra por titular", () => {
  const xs = [{ owner: "PF" as const, n: 1 }, { owner: "PJ" as const, n: 2 }];
  assert.equal(inView(xs, "all").length, 2);
  assert.deepEqual(inView(xs, "PJ").map((x) => x.n), [2]);
});
