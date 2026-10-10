import { test } from "node:test";
import assert from "node:assert/strict";
import { scanPrompt } from "./prompts";
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
