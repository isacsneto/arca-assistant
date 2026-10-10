import { test } from "node:test";
import assert from "node:assert/strict";
import { classRows, computeAllocation, driftStatus, rebalance, targetsSum, toBRL } from "./arca";
import { DEFAULT_TARGETS, type Position } from "./types";

const FX = { USD: 5 };

const pos = (assetClass: Position["assetClass"], value: number, currency: Position["currency"] = "BRL"): Position => ({
  id: Math.random().toString(),
  name: "x",
  institution: "t",
  owner: "PF",
  assetClass,
  subtype: "",
  currency,
  value,
  updatedAt: "",
  source: "",
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("aloca aporte só nas classes abaixo da meta, sem vender", () => {
  const alloc = computeAllocation(
    [pos("acoes", 400), pos("fiis", 200), pos("caixa", 300), pos("internacional", 100)],
    FX,
  );
  const lines = rebalance(alloc, DEFAULT_TARGETS, 200, false);
  const buy = Object.fromEntries(lines.map((l) => [l.assetClass, l.trade]));
  assert.equal(buy.acoes, 0); // acima da meta (40% vs 25%)
  close(sum(lines.map((l) => l.trade)), 200);
  assert.ok(buy.internacional > buy.fiis); // mais distante da meta
  assert.ok(lines.every((l) => l.trade >= 0));
});

test("rebalanceamento completo leva cada classe à meta", () => {
  const alloc = computeAllocation([pos("acoes", 600), pos("caixa", 400)], FX);
  const lines = rebalance(alloc, DEFAULT_TARGETS, 0, true);
  for (const l of lines) close(l.afterPct, 25);
  close(sum(lines.map((l) => l.trade)), 0);
});

test("rebalanceamento completo com aporte respeita metas personalizadas", () => {
  const targets = { acoes: 30, fiis: 10, caixa: 40, internacional: 20 };
  const alloc = computeAllocation([pos("acoes", 500), pos("fiis", 500)], FX);
  const lines = rebalance(alloc, targets, 1000, true);
  for (const l of lines) close(l.afterPct, targets[l.assetClass]);
  close(sum(lines.map((l) => l.trade)), 1000);
});

test("aporte sem vendas nunca passa da meta quando é pequeno", () => {
  const alloc = computeAllocation([pos("acoes", 1000), pos("fiis", 900), pos("caixa", 950), pos("internacional", 500)], FX);
  const lines = rebalance(alloc, DEFAULT_TARGETS, 300, false);
  for (const l of lines.filter((x) => x.trade > 0)) assert.ok(l.after <= l.ideal + 1e-9, `${l.assetClass} passou da meta`);
  assert.equal(lines.find((l) => l.assetClass === "acoes")!.trade, 0); // já acima da meta
});

test("carteira vazia: o aporte é dividido pelas metas", () => {
  const alloc = computeAllocation([], FX);
  const lines = rebalance(alloc, DEFAULT_TARGETS, 1000, false);
  for (const l of lines) {
    close(l.trade, 250);
    close(l.afterPct, 25);
  }
});

test("sem aporte e sem vendas não há movimento", () => {
  const alloc = computeAllocation([pos("acoes", 900), pos("caixa", 100)], FX);
  assert.ok(rebalance(alloc, DEFAULT_TARGETS, 0, false).every((l) => l.trade === 0));
});

test("converte dólar e separa 'outros' da base Arca", () => {
  const alloc = computeAllocation([pos("internacional", 100, "USD"), pos("outros", 50)], FX);
  assert.equal(alloc.byClass.internacional, 500);
  assert.equal(alloc.arcaTotal, 500);
  assert.equal(alloc.outrosTotal, 50);
  assert.equal(alloc.grandTotal, 550);
  assert.equal(toBRL({ value: 10, currency: "BRL" }, FX), 10);
});

test("classRows calcula % sobre a base Arca e status do desvio", () => {
  const alloc = computeAllocation([pos("acoes", 500), pos("fiis", 250), pos("caixa", 250), pos("outros", 10_000)], FX);
  const rows = Object.fromEntries(classRows(alloc, DEFAULT_TARGETS).map((r) => [r.assetClass, r]));
  close(rows.acoes.currentPct, 50);
  close(rows.acoes.driftPp, 25);
  assert.equal(rows.acoes.status, "bad");
  close(rows.internacional.driftPp, -25);
  assert.equal(rows.fiis.status, "ok");
});

test("classRows com carteira vazia não gera NaN", () => {
  const rows = classRows(computeAllocation([], FX), DEFAULT_TARGETS);
  for (const r of rows) {
    assert.equal(r.currentPct, 0);
    assert.equal(r.driftPp, 0);
    assert.equal(r.status, "ok");
  }
});

test("driftStatus: limites de 3 e 7 pontos", () => {
  assert.equal(driftStatus(2.99), "ok");
  assert.equal(driftStatus(-3), "warn");
  assert.equal(driftStatus(6.99), "warn");
  assert.equal(driftStatus(-7), "bad");
});

test("targetsSum tolera valores inválidos", () => {
  assert.equal(targetsSum(DEFAULT_TARGETS), 100);
  assert.equal(targetsSum({ acoes: 50, fiis: NaN, caixa: 30, internacional: 0 }), 80);
});
