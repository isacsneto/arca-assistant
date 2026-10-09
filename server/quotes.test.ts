import { test } from "node:test";
import assert from "node:assert/strict";
import { closeAt, convert, yahooSymbols } from "./quotes";

test("yahooSymbols mapeia B3, exterior e cripto", () => {
  assert.deepEqual(yahooSymbols({ ticker: "petr4", currency: "BRL", assetClass: "acoes" }), ["PETR4.SA"]);
  assert.deepEqual(yahooSymbols({ ticker: "MXRF11", currency: "BRL", assetClass: "fiis" }), ["MXRF11.SA"]);
  assert.deepEqual(yahooSymbols({ ticker: "IVVB11.SA", currency: "BRL", assetClass: "internacional" }), ["IVVB11.SA"]);
  assert.deepEqual(yahooSymbols({ ticker: "VOO", currency: "USD", assetClass: "internacional" }), ["VOO"]);
  assert.deepEqual(yahooSymbols({ ticker: "BTC", currency: "BRL", assetClass: "outros" }), ["BTC-USD", "BTC"]);
  assert.deepEqual(yahooSymbols({ ticker: undefined, currency: "BRL", assetClass: "caixa" }), []);
  assert.deepEqual(yahooSymbols({ ticker: undefined, name: "Bitcoin", currency: "BRL", assetClass: "outros" }), ["BTC-USD"]);
  assert.deepEqual(yahooSymbols({ ticker: undefined, name: "ETF de Ethereum", currency: "BRL", assetClass: "outros" }), ["ETH-USD"]);
  assert.deepEqual(yahooSymbols({ ticker: undefined, name: "Bitcoin Fund", currency: "BRL", assetClass: "caixa" }), [], "só cripto na classe 'outros'");
  assert.deepEqual(yahooSymbols({ ticker: "Tesouro Selic 2029", currency: "BRL", assetClass: "caixa" }), [], "texto livre não vira símbolo");
});

test("closeAt pega o fechamento do dia (ou o anterior mais próximo)", () => {
  const d = (iso: string) => Date.parse(iso) / 1000;
  const h = [
    { t: d("2026-01-05T13:00:00Z"), close: 10 },
    { t: d("2026-01-06T13:00:00Z"), close: 11 },
    { t: d("2026-01-08T13:00:00Z"), close: 12 },
  ];
  assert.equal(closeAt(h, "2026-01-06T00:00:00Z"), 11);
  assert.equal(closeAt(h, "2026-01-07T20:00:00Z"), 11, "feriado/fim de semana: usa o pregão anterior");
  assert.equal(closeAt(h, "2025-06-01"), 10, "antes do histórico: primeiro fechamento");
  assert.equal(closeAt(h, "2027-01-01"), 12);
  assert.equal(closeAt(h, "data ruim"), null);
  assert.equal(closeAt([], "2026-01-06"), null);
});

test("convert entre BRL e USD", () => {
  assert.equal(convert(10, "USD", "BRL", 5), 50);
  assert.equal(convert(50, "BRL", "USD", 5), 10);
  assert.equal(convert(7, "BRL", "BRL", 5), 7);
  assert.equal(convert(7, "EUR", "BRL", 5), null);
});
