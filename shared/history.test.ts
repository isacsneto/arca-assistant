import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyStats, snapshotOf, upsertSnapshot, type Snapshot } from "./history";
import { DEFAULT_SETTINGS, type Position } from "./types";

const p = (o: Partial<Position>): Position => ({
  id: "x", name: "X", institution: "BTG Pactual", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 100, updatedAt: "", source: "", ...o,
});

test("foto do dia: total em reais por classe, instituição e titular; bens à parte", () => {
  const s = snapshotOf({
    positions: [p({ id: "a", value: 1000 }), p({ id: "b", value: 100, currency: "USD", assetClass: "internacional", institution: "Avenue", owner: "PJ" })],
    assets: [{ id: "car", type: "vehicle", name: "Carro", value: 50000, owner: "PF", updatedAt: "" } as never],
    settings: { ...DEFAULT_SETTINGS, fx: { USD: 5 } },
  }, "2026-11-01");
  assert.equal(s.total, 1500);
  assert.deepEqual(s.byClass, { caixa: 1000, internacional: 500 });
  assert.deepEqual(s.byInstitution, { "BTG Pactual": 1000, Avenue: 500 });
  assert.deepEqual(s.byOwner, { PF: 1000, PJ: 500 });
  assert.equal(s.physical, 50000);
});

const snap = (date: string, total: number, estimated = false): Snapshot =>
  ({ date, total, byClass: {}, byInstitution: {}, byOwner: {}, physical: 0, debts: 0, ...(estimated && { estimated }) });

test("uma foto por dia, em ordem; a real substitui a estimada", () => {
  let list = upsertSnapshot([], snap("2026-10-02", 10, true));
  list = upsertSnapshot(list, snap("2026-10-01", 9));
  list = upsertSnapshot(list, snap("2026-10-02", 11));
  assert.deepEqual(list.map((s) => [s.date, s.total, !!s.estimated]), [["2026-10-01", 9, false], ["2026-10-02", 11, false]]);
});

test("mês: início = última foto do mês anterior; rendimento desconta aportes", () => {
  const list = [snap("2026-09-30", 1000), snap("2026-10-10", 1100), snap("2026-10-31", 1250), snap("2026-11-01", 1240, true)];
  const [sep, oct, nov] = monthlyStats(list, { "2026-10": 200 });
  assert.equal(sep.change, 0);
  assert.deepEqual([oct.start, oct.end, oct.change, oct.flows], [1000, 1250, 250, 200]);
  assert.ok(Math.abs(oct.returnPct! - 5) < 1e-9, "250 − 200 de aporte = 50 sobre 1000");
  assert.equal(nov.estimated, true);
  assert.equal(nov.change, -10);
});
