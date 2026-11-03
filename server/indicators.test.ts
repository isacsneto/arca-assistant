import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFixedIncome, indicatorsSource, irRate } from "./indicators";
import { parseIndexer } from "./indexers";
import { realGrowth, realOf, type Indicators } from "../shared/indicators";
import type { Position } from "../shared/types";
import type { MonthStats } from "../shared/history";

const close = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const pos = (o: Partial<Position>): Position => ({
  id: o.name ?? "p", name: "CDB", institution: "Banco X", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL", value: 10_000, updatedAt: "2026-11-01", source: "", ...o,
});
const IND: Indicators = { selic: { value: 15, date: "2026-11-01" }, cdi: { value: 14.9, date: "2026-10-31" }, ipca12m: { value: 5, date: "2026-09-01" }, ipcaMonthly: [], realRate: null, fetchedAt: "" };

test("IR regressivo pelo prazo", () => {
  assert.deepEqual([irRate(100), irRate(200), irRate(500), irRate(1000)], [0.225, 0.2, 0.175, 0.15]);
});

test("prefixado só com a taxa (\"12,5% a.a.\") é reconhecido; com CDI/IPCA no texto não vira pré", () => {
  assert.deepEqual(parseIndexer(pos({ subtype: "CDB 12,5% a.a. · venc. 10/06/2027" })), { kind: "pre", rate: 0.125 });
  assert.deepEqual(parseIndexer(pos({ subtype: "CDB 105% CDI" })), { kind: "cdiPct", pct: 1.05 });
  assert.equal(parseIndexer(pos({ subtype: "Fundo 12% a.a." })), null);
});

test("renda fixa contra o CDI: 100% CDI = 1; LCA isenta comparada com o CDI líquido; IPCA+ usa o IPCA 12m", () => {
  const rows = checkFixedIncome([
    pos({ name: "A", subtype: "CDB 100% CDI · venc. 10/10/2030" }),
    pos({ name: "B", subtype: "LCA 93% CDI · venc. 10/10/2030" }),
    pos({ name: "C", subtype: "CDB 80% CDI · venc. 10/10/2030" }),
    pos({ name: "D", subtype: "CDB IPCA + 6,9% · venc. 10/10/2030" }),
    pos({ name: "E", subtype: "Conta corrente" }),
  ], {}, IND, "2026-11-03");
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(rows.length, 4, "sem taxa no nome fica de fora");
  close(by.A.vsCdi, 1);
  close(by.A.gross, 14.9, 0.02);
  close(by.A.net, 14.9 * 0.85, 0.02);
  assert.equal(by.A.verdict, "acima");
  // LCA 93% isenta ≈ 93% × 14,9 = 13,9 líquido, contra 12,7 do CDI líquido (15% IR).
  assert.ok(by.B.exempt && by.B.vsCdi > 1.05);
  assert.equal(by.C.verdict, "abaixo");
  close(by.D.gross, (1.05 * 1.069 - 1) * 100, 0.02);
  assert.equal(rows[0].name, "C", "pior primeiro");
});

test("crescimento real: rendimento composto contra o IPCA dos mesmos meses (só meses com IPCA)", () => {
  const m = (month: string, returnPct: number | null, start = 100, end = 101): MonthStats => ({ month, start, end, change: end - start, flows: 0, returnPct, estimated: false });
  const g = realGrowth([m("2026-07", 1), m("2026-08", 1), m("2026-09", 1), m("2026-10", 1)], { "2026-07": 0.5, "2026-08": 0.5, "2026-09": 0.5 })!;
  assert.equal(g.months, 3, "outubro sem IPCA divulgado fica de fora");
  close(g.nominal, (1.01 ** 3 - 1) * 100);
  close(g.inflation, (1.005 ** 3 - 1) * 100);
  close(g.real, ((1.01 / 1.005) ** 3 - 1) * 100);
  assert.equal(realGrowth([m("2026-07", 1)], { "2026-07": 0.5 }, 12)!.months, 1);
  close(realOf(1, 0.5)!, (1.01 / 1.005 - 1) * 100);
  assert.equal(realOf(null, 0.5), null);
});

test("fonte do Banco Central: últimas leituras, juro real, cache de 1 h e atualizar à força", async () => {
  let calls = 0;
  const rows: Record<string, unknown> = {
    "432": [{ data: "01/11/2026", valor: "15.00" }],
    "4389": [{ data: "31/10/2026", valor: "14.90" }],
    "13522": [{ data: "01/09/2026", valor: "5.00" }],
    "433": [{ data: "01/08/2026", valor: "0.20" }, { data: "01/09/2026", valor: "-0.11" }],
  };
  const f = (async (url: string) => {
    calls += 1;
    const serie = /sgs\.(\d+)\//.exec(url)![1];
    return new Response(JSON.stringify(rows[serie]));
  }) as unknown as typeof fetch;
  let now = Date.parse("2026-11-03T12:00:00Z");
  const src = indicatorsSource(f, () => new Date(now));
  const a = (await src())!;
  assert.deepEqual([a.selic!.value, a.cdi!.date, a.ipca12m!.value, a.ipcaMonthly.map((x) => x.month)], [15, "2026-10-31", 5, ["2026-08", "2026-09"]]);
  close(a.realRate!, (1.15 / 1.05 - 1) * 100);
  await src();
  assert.equal(calls, 4, "cache");
  await src(true);
  assert.equal(calls, 8, "atualizar agora");
  now += 2 * 3_600_000;
  const down = indicatorsSource((async () => new Response("", { status: 500 })) as unknown as typeof fetch);
  assert.equal(await down(), null);
});

test("taxa solta abaixo de 3% a.a. não vira prefixado (é só o spread que o banco mandou)", () => {
  assert.equal(parseIndexer(pos({ subtype: "Debênture 1,5% a.a. · venc. 01/06/2040" })), null);
});
