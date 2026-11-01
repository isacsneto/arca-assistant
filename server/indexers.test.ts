import { test } from "node:test";
import assert from "node:assert/strict";
import { accrue, bcbSource, parseIndexer, type IndexSeries } from "./indexers";
import type { Position } from "../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: "x", name: "CDB", institution: "BTG Pactual", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 1000, updatedAt: "2026-10-26T15:00:00Z", source: "", ...o,
});

test("indexador pelo nome/subtipo; fundos, COE, saldos e ações ficam de fora", () => {
  assert.deepEqual(parseIndexer(p({ subtype: "CDB 109% CDI · venc. 29/05/2028" })), { kind: "cdiPct", pct: 1.09 });
  assert.deepEqual(parseIndexer(p({ subtype: "LCA 96,5% CDI" })), { kind: "cdiPct", pct: 0.965 });
  assert.deepEqual(parseIndexer(p({ subtype: "Debênture CDI + 5,64% · venc. 30/10/2030" })), { kind: "cdiPlus", spread: 0.0564 });
  assert.deepEqual(parseIndexer(p({ subtype: "CDB IPCA + 7,60% · venc. 16/08/2032" })), { kind: "ipcaPlus", real: 0.076 });
  assert.deepEqual(parseIndexer(p({ subtype: "Debênture TR + 1,00% · venc. 12/12/2055" })), { kind: "trPlus", spread: 0.01 });
  assert.deepEqual(parseIndexer(p({ subtype: "CDB Pré 11,85% a.a. · venc. 15/12/2026" })), { kind: "pre", rate: 0.1185 });
  assert.deepEqual(parseIndexer(p({ name: "Reserva (CDB)", subtype: "CDB 100% CDI" })), { kind: "cdiPct", pct: 1 });
  assert.equal(parseIndexer(p({ name: "BTG Tesouro Selic FIRF", subtype: "Fundo RF Tesouro Selic · D+0" })), null);
  assert.equal(parseIndexer(p({ name: "COE CSN", subtype: "COE CSN pré (cupom semestral)" })), null);
  assert.equal(parseIndexer(p({ name: "Conta", subtype: "Saldo em conta investimento" })), null);
  assert.deepEqual(parseIndexer(p({ name: "Saldo investido (CDB)", subtype: "CDB 100% CDI" })), { kind: "cdiPct", pct: 1 }, "saldo aplicado em CDB rende");
  assert.equal(parseIndexer(p({ subtype: "CDB" })), null, "sem taxa não dá para calcular");
  assert.equal(parseIndexer(p({ subtype: "CDB 100% CDI", currency: "USD" })), null);
});

// Calendário: 26 a 30/10 (seg–sex), 23 dias úteis em out/2026; CDI de 0,05% ao dia.
const series: IndexSeries = {
  cdi: ["2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((d) => ({ d, r: 0.0005 })),
  ipca: new Map([["2026-09", 0.0082]]),
  ipca12m: 0.0458,
  tr: new Map([["2026-10", 0.0016]]),
};
const TODAY = "2026-11-01";
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test("acumula os dias úteis desde a última atualização, até o último CDI publicado", () => {
  const l = accrue(p({ subtype: "CDB 110% CDI" }), { kind: "cdiPct", pct: 1.1 }, series, TODAY);
  close(l.newValue, 1000 * Math.pow(1 + 0.0005 * 1.1, 5));
  assert.equal(l.method, "indexador");
  assert.equal(l.asOf, "2026-10-31T03:00:00.000Z", "a próxima atualização começa no dia seguinte ao último acumulado");
  assert.match(l.note, /5 dias úteis \(26\/10\/2026 a 30\/10\/2026\)/);

  close(accrue(p({}), { kind: "cdiPlus", spread: 0.02 }, series, TODAY).newValue, 1000 * Math.pow(1.0005, 5) * Math.pow(1.02, 5 / 252));
  close(accrue(p({}), { kind: "pre", rate: 0.12 }, series, TODAY).newValue, 1000 * Math.pow(1.12, 5 / 252));
  close(accrue(p({}), { kind: "trPlus", spread: 0.01 }, series, TODAY).newValue, 1000 * Math.pow(1.0016, 5 / 22) * Math.pow(1.01, 5 / 252));
});

test("IPCA ainda não divulgado é projetado pelo IPCA 12 meses, e a nota avisa", () => {
  const l = accrue(p({}), { kind: "ipcaPlus", real: 0.07 }, series, TODAY);
  const monthly = Math.pow(1.0458, 1 / 12) - 1;
  close(l.newValue, 1000 * Math.pow(1 + monthly, 5 / 22) * Math.pow(1.07, 5 / 252));
  assert.match(l.note, /10\/2026 ainda não divulgado/);
});

test("sem dia útil novo: mesmo valor, sem mexer na data", () => {
  const l = accrue(p({ updatedAt: "2026-11-01T12:00:00Z" }), { kind: "cdiPct", pct: 1 }, series, TODAY);
  assert.equal(l.newValue, 1000);
  assert.equal(l.asOf, undefined);
  assert.match(l.note, /nenhum dia útil/);
});

test("hoje não entra (o CDI do dia rende para amanhã)", () => {
  const l = accrue(p({}), { kind: "cdiPct", pct: 1 }, series, "2026-10-30");
  close(l.newValue, 1000 * Math.pow(1.0005, 4));
});

test("fonte do BCB: lê as séries, guarda 1 h e falha sem CDI", async () => {
  const urls: string[] = [];
  const ok = (async (url: string) => {
    urls.push(url);
    const serie = /sgs\.(\d+)/.exec(url)![1];
    const body = serie === "12" ? [{ data: "29/10/2026", valor: "0.050788" }] : serie === "433" ? [{ data: "01/09/2026", valor: "0.82" }] : serie === "13522" ? [{ data: "01/09/2026", valor: "4.58" }] : [{ data: "01/10/2026", valor: "0.1616" }];
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  const src = bcbSource(ok, () => new Date("2026-11-01T12:00:00Z"));
  const s = (await src("2026-10-09"))!;
  assert.deepEqual(s.cdi, [{ d: "2026-10-29", r: 0.00050788 }]);
  close(s.ipca.get("2026-09")!, 0.0082);
  close(s.ipca12m!, 0.0458);
  close(s.tr.get("2026-10")!, 0.001616);
  assert.ok(urls[0].includes("dataInicial=09/10/2026&dataFinal=01/11/2026"));
  await src("2026-10-20");
  assert.equal(urls.length, 4, "cache cobre um início mais recente");
  const down = bcbSource((async () => new Response("", { status: 500 })) as unknown as typeof fetch);
  assert.equal(await down("2026-10-09"), null);
});
