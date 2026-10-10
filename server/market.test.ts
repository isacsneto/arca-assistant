import { test } from "node:test";
import assert from "node:assert/strict";
import { marketSnapshot, parseDayQuote, parseSearch, portfolioAssets, type FetchDayQuote } from "./market";
import type { DayQuote, Position } from "../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: Math.random().toString(36).slice(2), name: "X", institution: "XP", owner: "PF", assetClass: "acoes", subtype: "Ação",
  currency: "BRL", value: 100, updatedAt: "2026-10-01T00:00:00Z", source: "", ...o,
});

const settings = { fx: { USD: 5 }, cryptoAsInternational: false };

test("parseDayQuote lê preço, fechamento anterior, variação e o gráfico do dia", () => {
  const q = parseDayQuote("PETR4.SA", {
    chart: {
      result: [{
        meta: {
          symbol: "PETR4.SA", currency: "BRL", regularMarketPrice: 56, previousClose: 55, chartPreviousClose: 54,
          longName: "Petrobras", fullExchangeName: "São Paulo", instrumentType: "EQUITY", regularMarketTime: 1791576331,
          fiftyTwoWeekHigh: 57, fiftyTwoWeekLow: 30, regularMarketDayHigh: 56.5, regularMarketDayLow: 55.1,
        },
        indicators: { quote: [{ close: [55.2, null, 55.8, 56] }] },
      }],
    },
  })!;
  assert.equal(q.price, 56);
  assert.equal(q.previousClose, 55, "previousClose tem prioridade");
  assert.equal(q.change, 1);
  assert.ok(Math.abs(q.changePct! - 1.818) < 0.01);
  assert.deepEqual(q.spark, [55.2, 55.8, 56]);
  assert.equal(q.name, "Petrobras");
  assert.equal(q.type, "EQUITY");
  assert.equal(q.marketTime, new Date(1791576331 * 1000).toISOString());
  assert.equal(parseDayQuote("X", { chart: { result: [] } }), null);
  assert.equal(parseDayQuote("X", { chart: { result: [{ meta: { regularMarketPrice: 0 } }] } }), null);
});

test("parseSearch filtra tipos e fracionário, e põe a B3 primeiro", () => {
  const hits = parseSearch({
    quotes: [
      { symbol: "PBR", longname: "Petrobras", exchDisp: "NYSE", quoteType: "EQUITY" },
      { symbol: "PETR4.SA", shortname: "PETROBRAS PN", exchDisp: "São Paulo", quoteType: "EQUITY" },
      { symbol: "PETR4F.SA", shortname: "PETROBRAS PN", quoteType: "EQUITY" },
      { symbol: "PETR4C40", shortname: "opção", quoteType: "OPTION" },
      { symbol: "bad symbol!", quoteType: "EQUITY" },
    ],
  });
  assert.deepEqual(hits.map((h) => h.symbol), ["PETR4.SA", "PBR"]);
  assert.equal(hits[0].name, "PETROBRAS PN");
  assert.deepEqual(parseSearch({}), []);
});

test("portfolioAssets soma o mesmo ticker, ignora o que não tem cotação e ordena pelo valor", () => {
  const { total, assets } = portfolioAssets([
    p({ ticker: "PETR4", value: 1000 }),
    p({ ticker: "petr4.sa", value: 500, institution: "BTG" }),
    p({ ticker: "VOO", assetClass: "internacional", currency: "USD", value: 100 }),
    p({ name: "CDB 110% CDI", assetClass: "caixa", value: 5000 }),
    p({ name: "Bitcoin", subtype: "Cripto", assetClass: "outros", value: 300 }),
  ], settings);
  assert.equal(total, 7300);
  assert.deepEqual(assets.map((a) => [a.key, a.value, a.positions]), [["PETR4", 1500, 2], ["VOO", 500, 1], ["BTC-USD", 300, 1]]);
  assert.deepEqual(assets[0].symbols, ["PETR4.SA"]);
  assert.ok(Math.abs(assets[0].weightPct - (1500 / 7300) * 100) < 1e-9);
  assert.equal(assets[2].assetClass, "outros");
  assert.equal(portfolioAssets([p({ name: "Bitcoin", subtype: "Cripto", assetClass: "outros" })], { ...settings, cryptoAsInternational: true }).assets[0].assetClass, "internacional");
  assert.equal(portfolioAssets([p({ ticker: "PETR4" })], settings, 0).assets.length, 0);
});

test("marketSnapshot busca a cotação do dia e estima o impacto na posição", async () => {
  const quote = (symbol: string, changePct: number): DayQuote => ({
    symbol, name: symbol, currency: "BRL", price: 10, previousClose: 10, change: 0, changePct, dayHigh: null, dayLow: null,
    high52: null, low52: null, marketTime: null, exchange: null, type: "EQUITY", spark: [],
  });
  const seen: string[] = [];
  const fetchDayQuote: FetchDayQuote = async (s) => {
    seen.push(s);
    if (s === "PETR4.SA") return quote(s, 2);
    if (s === "BTC-USD") throw new Error("rede");
    return null;
  };
  const snap = await marketSnapshot(
    [p({ ticker: "PETR4", value: 1000 }), p({ ticker: "XPTO3", value: 50 }), p({ name: "Bitcoin", subtype: "Cripto", assetClass: "outros", value: 200 })],
    settings, fetchDayQuote, { now: new Date("2026-10-10T15:00:00Z") },
  );
  assert.equal(snap.at, "2026-10-10T15:00:00.000Z");
  assert.deepEqual(snap.rows.map((r) => r.key), ["PETR4", "BTC-USD", "XPTO3"]);
  assert.equal(snap.rows[0].dayChange, 20);
  assert.equal(snap.rows[1].quote, null, "erro de rede vira 'sem cotação'");
  assert.equal(snap.rows[1].dayChange, null);
  assert.ok(seen.includes("XPTO3.SA"));
});
