import { test } from "node:test";
import assert from "node:assert/strict";
import { growValue, impliedCagr, project, rateFor, toReal } from "./projection";
import type { Position, ProjectionAssumptions } from "./types";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const rate = (annualReturnPct: number, initialShockPct = 0) => ({ annualReturnPct, initialShockPct, rationale: "" });

const pos = (id: string, assetClass: Position["assetClass"], value: number, currency: Position["currency"] = "BRL"): Position => ({
  id, name: id, institution: "x", owner: "PF", assetClass, subtype: "", currency, value, updatedAt: "", source: "",
});

const assumptions = (o: Partial<ProjectionAssumptions> = {}): ProjectionAssumptions => ({
  asOf: "out/2026", summary: "", sources: [], scenarios: { base: "", worst: "" },
  inflation: { basePct: 4, worstPct: 8, rationale: "" },
  classes: [
    { assetClass: "acoes", base: rate(12), worst: rate(3, -40) },
    { assetClass: "caixa", base: rate(10), worst: rate(9) },
  ],
  assets: [],
  ...o,
});

test("growValue: juros compostos e choque no 1º ano", () => {
  close(growValue(100, rate(10), 0), 100);
  close(growValue(100, rate(10), 2), 121);
  close(growValue(100, rate(0, -50), 5), 50);
  close(growValue(100, rate(10, -20), 1), 88);
  assert.equal(growValue(100, rate(5, -150), 3), 0, "choque abaixo de -100% não gera valor negativo");
});

test("toReal desconta a inflação", () => {
  close(toReal(121, 10, 2), 100);
  close(toReal(100, 4, 0), 100);
});

test("premissa por ativo tem prioridade sobre a da classe", () => {
  const a = assumptions({ assets: [{ positionId: "wege", base: rate(15), worst: rate(1, -30) }] });
  assert.equal(rateFor(pos("wege", "acoes", 1), a, "base")!.annualReturnPct, 15);
  assert.equal(rateFor(pos("petr", "acoes", 1), a, "base")!.annualReturnPct, 12);
  assert.equal(rateFor(pos("x", "fiis", 1), a, "base"), null);
});

test("project soma posições, converte dólar e separa por classe", () => {
  const positions = [pos("a", "acoes", 1000), pos("c", "caixa", 100, "USD")];
  const out = project(positions, { USD: 5 }, assumptions(), [0, 10]);
  close(out.start, 1500);
  const [p0, p10] = out.points;
  close(p0.base, 1500);
  close(p0.worst, 1500);
  close(p10.byClass.acoes.base, 1000 * 1.12 ** 10);
  close(p10.byClass.acoes.worst, 1000 * 0.6 * 1.03 ** 10);
  close(p10.byClass.caixa.base, 500 * 1.1 ** 10);
  close(p10.base, p10.byClass.acoes.base + p10.byClass.caixa.base);
  close(p10.baseReal, p10.base / 1.04 ** 10);
  close(p10.worstReal, p10.worst / 1.08 ** 10);
  assert.ok(p10.worst < p10.base);
  assert.deepEqual(out.missing, []);
});

test("posições sem premissa ficam constantes e são reportadas", () => {
  const out = project([pos("f", "fiis", 200)], { USD: 5 }, assumptions(), [5]);
  close(out.points[0].base, 200);
  assert.deepEqual(out.missing, ["f"]);
});

test("impliedCagr inverte o crescimento composto", () => {
  close(impliedCagr(100, 100 * 1.08 ** 20, 20), 8);
  assert.equal(impliedCagr(0, 10, 5), 0);
});
