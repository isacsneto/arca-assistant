import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTesouroCsv, priceTesouro, tesouroSource, tesouroType, TESOURO_CSV } from "./tesouro";
import type { Position } from "../shared/types";

const CSV = [
  "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha",
  "Tesouro Renda+ Aposentadoria Extra;15/12/2084;30/10/2026;7,16;7,28;178,94;169,96;169,96",
  "Tesouro Renda+ Aposentadoria Extra;15/12/2084;09/10/2026;6,30;6,39;255,00;248,18;248,18",
  "Tesouro Renda+ Aposentadoria Extra;15/12/2065;09/10/2026;6,30;6,39;900,00;880,00;880,00",
  "Tesouro Renda+ Aposentadoria Extra;15/12/2065;30/10/2026;6,30;6,39;800,00;790,00;790,00",
  "Tesouro Educa+;15/12/2035;09/10/2026;7,00;7,10;3100,00;3086,35;3086,35",
  "Tesouro Educa+;15/12/2035;30/10/2026;7,60;7,70;2900,00;2885,54;2885,54",
  "Tesouro Educa+;15/12/2031;09/10/2026;7,00;7,10;4020,00;4011,57;4011,57",
  "Tesouro Educa+;15/12/2031;30/10/2026;7,60;7,70;3950,00;3934,70;3934,70",
  "Tesouro IPCA+ com Juros Semestrais;15/05/2045;30/10/2026;7,6;7,7;0,00;4190,71;4190,71",
  "Tesouro IPCA+ com Juros Semestrais;15/05/2045;09/10/2026;6,7;6,8;0,00;4573,25;4573,25",
  "Tesouro IPCA+;15/05/2045;30/10/2026;7,6;7,7;0,00;1272,11;1272,11",
  "Tesouro Selic;01/03/2029;30/10/2026;0,05;0,06;20185,67;20.170,66;20170,66",
].join("\r\n");
const prices = parseTesouroCsv(CSV);

const p = (o: Partial<Position>): Position => ({
  id: "x", name: "", institution: "BTG Pactual", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 0, updatedAt: "2026-10-09T22:00:00Z", source: "", ...o,
});

test("lê o CSV do Tesouro: série por título em ordem de data e PU de venda", () => {
  assert.equal(prices.lastDate, "2026-10-30");
  assert.deepEqual(prices.series.get("Tesouro Renda+ Aposentadoria Extra|2084-12-15"), [{ d: "2026-10-09", pu: 248.18 }, { d: "2026-10-30", pu: 169.96 }]);
  assert.equal(prices.series.get("Tesouro Selic|2029-03-01")![0].pu, 20170.66, "milhar com ponto");
});

test("tipo do título: só Tesouro Direto (fundos e ETFs de Tesouro ficam de fora)", () => {
  assert.equal(tesouroType({ name: "Tesouro IPCA+ Juros Semestrais 2045", subtype: "" }), "Tesouro IPCA+ com Juros Semestrais");
  assert.equal(tesouroType({ name: "Tesouro IPCA+ 2040", subtype: "Tesouro IPCA+" }), "Tesouro IPCA+");
  assert.equal(tesouroType({ name: "Tesouro Renda+ 2079", subtype: "" }), "Tesouro Renda+ Aposentadoria Extra");
  assert.equal(tesouroType({ name: "Título", subtype: "Tesouro Educa+ · venc. 15/12/2036" }), "Tesouro Educa+");
  assert.equal(tesouroType({ name: "BTG Pactual Tesouro Selic FIRF", subtype: "Fundo RF Tesouro Selic · D+0" }), null);
  assert.equal(tesouroType({ name: "Investo LFTB", subtype: "ETF renda fixa (LFT)", ticker: "LFTB11" }), null);
  assert.equal(tesouroType({ name: "Tesouro Selic", subtype: "", ticker: "LFTB11" }), null, "com ticker é cotação de bolsa");
});

test("quantidade × PU do último dia, com o vencimento explícito", () => {
  const l = priceTesouro(p({ name: "Tesouro Renda+ 2084", subtype: "Tesouro Renda+ · venc. 15/12/2084", value: 24818, quantity: 100 }), prices)!;
  assert.equal(l.method, "cotacao");
  assert.ok(Math.abs(l.newValue - 100 * 169.96) < 1e-6);
  assert.equal(l.unitPrice, 169.96);
  assert.match(l.note!, /30\/10\/2026/);
});

test("só o ano: Renda+ 2065 é o ano de conversão (vence em 2084); a quantidade desempata", () => {
  const renda = priceTesouro(p({ name: "Tesouro Renda+ Aposentadoria Extra 2065", value: 100 * 248.18, quantity: 100 }), prices)!;
  assert.match(renda.note!, /15\/12\/2084/);
  // Educa+ 2031 no nome oficial vence em 2035; quem salvou o valor de 2031 (vencimento) continua em 2031.
  const educaOficial = priceTesouro(p({ name: "Tesouro Educa+ 2031", value: 2 * 3086.35, quantity: 2 }), prices)!;
  assert.match(educaOficial.note!, /15\/12\/2035/);
  const educaVenc = priceTesouro(p({ name: "Tesouro Educa+ 2031", value: 2 * 4011.57, quantity: 2 }), prices)!;
  assert.match(educaVenc.note!, /15\/12\/2031/);
});

test("sem quantidade: inferida pelo PU do dia da última atualização", () => {
  const l = priceTesouro(p({ name: "Tesouro IPCA+ com Juros Semestrais 2045", value: 4573.25 * 2 }), prices)!;
  assert.ok(Math.abs(l.quantity! - 2) < 1e-9);
  assert.ok(Math.abs(l.newValue - 2 * 4190.71) < 1e-6);
  assert.match(l.note!, /inferida/);
});

test("não é título, outra moeda ou vencimento inexistente: null", () => {
  assert.equal(priceTesouro(p({ name: "CDB BTG 2028", value: 100 }), prices), null);
  assert.equal(priceTesouro(p({ name: "Tesouro IPCA+ 2045", value: 100, currency: "USD" }), prices), null);
  assert.equal(priceTesouro(p({ name: "Tesouro IPCA+ 2099", value: 100 }), prices), null);
});

test("fonte: guarda em memória e ignora arquivo velho ou fora do ar", async () => {
  let calls = 0;
  const ok = (async (url: string) => {
    calls += 1;
    assert.equal(url, TESOURO_CSV);
    return new Response(CSV);
  }) as unknown as typeof fetch;
  let now = Date.parse("2026-11-01T12:00:00Z");
  const src = tesouroSource(ok, () => now);
  assert.equal((await src())!.lastDate, "2026-10-30");
  await src();
  assert.equal(calls, 1, "cache de 6 h");
  now += 7 * 3_600_000;
  await src();
  assert.equal(calls, 2);
  const stale = tesouroSource(ok, () => Date.parse("2026-12-31T00:00:00Z"));
  assert.equal(await stale(), null);
  const down = tesouroSource((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
  assert.equal(await down(), null);
});
