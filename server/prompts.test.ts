import { test } from "node:test";
import assert from "node:assert/strict";
import { researchPrompt, scanPrompt } from "./prompts";
import { computeAllocation } from "../shared/arca";
import { DEFAULT_SETTINGS, type Position } from "../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: "1", name: "X", institution: "XP", owner: "PF", assetClass: "fiis", subtype: "FII", currency: "BRL",
  value: 0, updatedAt: "", source: "", ...o,
});

test("scanPrompt inclui data, meta, % atual e as posições da classe (maiores primeiro)", () => {
  const positions = [
    p({ ticker: "MXRF11", name: "Maxi Renda", value: 1000 }),
    p({ ticker: "HGLG11", name: "CSHG Log", value: 3000 }),
    p({ name: "Tesouro Selic", assetClass: "caixa", value: 4000 }),
    p({ name: "VOO", assetClass: "internacional", currency: "USD", value: 1000 }),
  ];
  const settings = { ...DEFAULT_SETTINGS, fx: { USD: 2 } };
  const out = scanPrompt({
    assetClass: "fiis",
    today: "9 de outubro de 2026",
    allocation: computeAllocation(positions, settings.fx),
    settings,
    positions,
  });
  assert.match(out, /9 de outubro de 2026/);
  assert.match(out, /Meta da Arca para esta classe: 25%/);
  assert.match(out, /Atual: 40,0%|Atual: 40\.0%/); // 4000 de 10000
  assert.ok(out.indexOf("HGLG11") < out.indexOf("MXRF11"), "ordena por valor");
  assert.ok(!out.includes("Tesouro Selic"), "não mistura outras classes");
  assert.match(out, /SOMENTE com o resultado estruturado/);
});

test("scanPrompt com classe vazia avisa que não há posições", () => {
  const out = scanPrompt({
    assetClass: "internacional", today: "hoje", allocation: computeAllocation([], { USD: 5 }),
    settings: DEFAULT_SETTINGS, positions: [],
  });
  assert.match(out, /\(nenhuma ainda\)/);
  assert.match(out, /Atual: 0/);
});

test("researchPrompt leva a cotação, a alocação × meta e se o investidor já tem o ativo", () => {
  const positions = [
    p({ ticker: "PETR4", name: "Petrobras", assetClass: "acoes", value: 3000 }),
    p({ ticker: "PETR4", name: "Petrobras", assetClass: "acoes", value: 1000, institution: "BTG" }),
    p({ name: "Tesouro Selic", assetClass: "caixa", value: 6000 }),
  ];
  const settings = { ...DEFAULT_SETTINGS, fx: { USD: 5 }, cryptoAsInternational: true };
  const out = researchPrompt({
    query: "petr4", symbol: "PETR4.SA", name: "Petrobras", today: "10 de outubro de 2026", settings, positions,
    allocation: computeAllocation(positions, settings.fx),
    quote: {
      symbol: "PETR4.SA", name: "Petrobras", currency: "BRL", price: 56, previousClose: 55, change: 1, changePct: 1.82,
      dayHigh: null, dayLow: null, high52: 57, low52: 30, marketTime: null, exchange: "São Paulo", type: "EQUITY", spark: [],
    },
  });
  assert.match(out, /Símbolo \(Yahoo Finance\): PETR4\.SA/);
  assert.match(out, /dia \+1\.82%/);
  assert.match(out, /JÁ TEM este ativo: R\$\s?4\.000 \(40\.0%/);
  assert.match(out, /\(acoes\): 40\.0% da base Arca \(meta 25%\)/);
  assert.match(out, /Cripto conta como Internacional/);
  assert.match(out, new RegExp(DEFAULT_SETTINGS.investorProfile.slice(0, 30)));
  assert.match(researchPrompt({ ...{ query: "xyz", symbol: null, name: null, quote: null, today: "hoje", settings: DEFAULT_SETTINGS, positions: [], allocation: computeAllocation([], {}) } }), /ainda não tem este ativo/);
});
