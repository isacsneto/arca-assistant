import { test } from "node:test";
import assert from "node:assert/strict";
import { futureValue, goalRealReturn, goalStatus, monthsUntil, planningOf, requiredMonthly, type Goal } from "./planning";
import { DEFAULT_SETTINGS, type Position } from "./types";

const close = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
const p = (o: Partial<Position>): Position => ({
  id: "x", name: "X", institution: "BTG", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL", value: 100, updatedAt: "", source: "", ...o,
});
const goal = (o: Partial<Goal>): Goal => ({ id: "g", name: "Meta", kind: "outro", target: 100_000, targetDate: "2036-11", positionIds: [], classes: [], monthly: 0, realReturnPct: null, ...o });

test("valor futuro e aporte necessário fecham entre si (juros compostos mensais)", () => {
  close(futureValue(1000, 0, 0, 12), 1000);
  close(futureValue(0, 100, 0, 12), 1200);
  const need = requiredMonthly(10_000, 100_000, 5, 120);
  close(futureValue(10_000, need, 5, 120), 100_000, 0.5);
  assert.equal(requiredMonthly(200_000, 100_000, 5, 120), 0, "já chega sem aportar");
  assert.equal(requiredMonthly(1000, 5000, 5, 0), 4000, "prazo vencido: falta tudo");
});

test("meses até o alvo e status da meta com posições ligadas + classe inteira", () => {
  assert.equal(monthsUntil("2026-12", new Date("2026-11-15T12:00:00Z")), 1);
  assert.equal(monthsUntil("2020-01", new Date("2026-11-15T12:00:00Z")), 0);
  const state = { positions: [p({ id: "a", value: 30_000 }), p({ id: "b", value: 20_000, assetClass: "acoes" }), p({ id: "c", value: 5_000, currency: "USD", assetClass: "internacional" })], settings: { ...DEFAULT_SETTINGS, fx: { USD: 5 } }, projection: undefined };
  const st = goalStatus(goal({ classes: ["caixa"], positionIds: ["c"], realReturnPct: 4, monthly: 0, target: 55_000 }), state, new Date("2026-11-15T12:00:00Z"));
  assert.equal(st.current, 55_000, "caixa (30 mil) + posição em dólar (5 mil × 5)");
  assert.equal(st.onTrack, true);
  assert.equal(st.required, 0);
});

test("retorno real vem da Projeção (ponderado por classe, menos inflação); sem Projeção, 4%", () => {
  const positions = [p({ id: "a", value: 50, assetClass: "caixa" }), p({ id: "b", value: 50, assetClass: "acoes" })];
  const base = { annualReturnPct: 0, initialShockPct: 0, rationale: "" };
  const projection = {
    inflation: { basePct: 4, worstPct: 6, rationale: "" },
    classes: [{ assetClass: "caixa" as const, base: { ...base, annualReturnPct: 10 }, worst: base }, { assetClass: "acoes" as const, base: { ...base, annualReturnPct: 14 }, worst: base }],
    assets: [],
  } as never;
  const g = goal({ classes: ["caixa", "acoes"] });
  const r = goalRealReturn(g, { positions, projection, settings: DEFAULT_SETTINGS });
  close(r.pct, (1.12 / 1.04 - 1) * 100, 1e-6);
  assert.equal(r.source, "projection");
  assert.deepEqual(goalRealReturn(g, { positions, projection: undefined, settings: DEFAULT_SETTINGS }), { pct: 4, source: "default" });
});

test("planejamento normaliza o que vem do disco", () => {
  const pl = planningOf({ goals: [{ id: "1", name: "X", target: -5, targetDate: "lixo" } as never, { id: "", name: "" } as never], budgets: [{ category: "Mercado", limit: 0 }] as never });
  assert.equal(pl.goals.length, 1);
  assert.equal(pl.goals[0].target, 0);
  assert.match(pl.goals[0].targetDate, /^\d{4}-\d{2}$/);
  assert.deepEqual(pl.budgets, [], "limite zero não conta");
  assert.deepEqual(planningOf(undefined).goals, []);
});
