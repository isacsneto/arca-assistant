import { test } from "node:test";
import assert from "node:assert/strict";
import { fundProxy, priceByProxy } from "./fundProxy";
import type { Position } from "../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: "f", name: "Fundo", institution: "BTG Pactual", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 1000, updatedAt: "2026-10-09T22:00:00Z", source: "", ...o,
});

test("índice de referência do fundo pelo nome; com ticker, em dólar ou sem equivalente, nada", () => {
  const sym = (o: Partial<Position>) => {
    const f = fundProxy(p(o));
    return f ? (f.kind === "etf" ? f.symbol : "CDI") : null;
  };
  assert.equal(sym({ name: "Hashdex 100 Nasdaq Crypto Index", subtype: "Fundo multimercado cripto" }), "HASH11.SA");
  assert.equal(sym({ name: "BTG Pactual S&P 500 BRL FIM", subtype: "Fundo S&P 500 em reais" }), "IVVB11.SA");
  assert.equal(sym({ name: "Trigono Flagship 60 Small Caps", subtype: "Fundo de ações small caps" }), "SMAL11.SA");
  assert.equal(sym({ name: "Sparta Top Inflação FIC FIRF", subtype: "Fundo RF inflação (IMA-B5)" }), "B5P211.SA");
  assert.equal(sym({ name: "Tivio Banks FIRF CrPr", subtype: "Fundo RF crédito privado" }), "CDI");
  assert.equal(sym({ name: "BTG Tesouro Selic FIRF", subtype: "Fundo RF Tesouro Selic · D+0" }), "CDI");
  assert.equal(sym({ name: "PIMCO Income Dólar FIC FIM", subtype: "Fundo renda fixa global (dólar)" }), null, "sem ETF equivalente: fica para a IA");
  assert.equal(sym({ name: "COE CSN", subtype: "COE CSN pré" }), null);
  assert.equal(sym({ name: "Maxi Renda", subtype: "FII", ticker: "MXRF11" }), null, "com ticker vai pela cotação");
});

test("estima pela variação do ETF desde a última atualização e marca como estimativa", async () => {
  const bar = (d: string, close: number) => ({ t: Date.parse(`${d}T13:00:00Z`) / 1000, close });
  // O pregão de hoje (em andamento) não conta: vale de fechamento a fechamento.
  const fetchQuote = async (s: string) =>
    s === "SMAL11.SA" ? { symbol: s, price: 50, currency: "BRL", history: [bar("2026-10-09", 110), bar("2026-10-30", 99), bar("2026-11-01", 50)] } : null;
  const l = (await priceByProxy(p({}), { kind: "etf", symbol: "SMAL11.SA", label: "SMAL11" }, { fetchQuote, series: null, today: "2026-11-01" }))!;
  assert.ok(Math.abs(l.newValue - 900) < 1e-9);
  assert.equal(l.asOf, "2026-10-30T21:00:00.000Z", "vale no fechamento do último pregão");
  assert.equal(l.ai, true);
  // Rodando de novo depois de aplicado (updatedAt = asOf): sem pregão novo, não muda nada.
  const again = (await priceByProxy(p({ value: 900, updatedAt: l.asOf! }), { kind: "etf", symbol: "SMAL11.SA", label: "SMAL11" }, { fetchQuote, series: null, today: "2026-11-01" }))!;
  assert.equal(again.newValue, 900);
  assert.match(l.note, /−|-10,00%/);
  assert.equal(await priceByProxy(p({}), { kind: "etf", symbol: "XXXX11.SA", label: "X" }, { fetchQuote, series: null, today: "2026-11-01" }), null);
});

test("fundo DI/Selic/crédito: CDI do período, marcado como estimativa", async () => {
  const series = { cdi: [{ d: "2026-10-09", r: 0.0005 }, { d: "2026-10-13", r: 0.0005 }], ipca: new Map(), ipca12m: null, tr: new Map() };
  const l = (await priceByProxy(p({}), { kind: "cdi", label: "CDI" }, { fetchQuote: async () => null, series, today: "2026-11-01" }))!;
  assert.ok(Math.abs(l.newValue - 1000 * 1.0005 ** 2) < 1e-9);
  assert.equal(l.ai, true);
  assert.match(l.note, /CDI/);
  assert.equal(await priceByProxy(p({}), { kind: "cdi", label: "CDI" }, { fetchQuote: async () => null, series: null, today: "2026-11-01" }), null, "sem BCB: IA");
});
