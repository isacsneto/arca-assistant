import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RESEARCH, addResearch, normalizeResearch, researchKey } from "./research";
import type { ResearchResult } from "./types";

const r = (o: Partial<ResearchResult>): ResearchResult => ({
  id: "1", query: "PETR4", symbol: "PETR4.SA", quote: null, runAt: "2026-10-10T12:00:00Z", model: "m", effort: "high", searches: 3,
  ticker: "PETR4", name: "Petrobras", assetType: "Ação (B3)", arcaClass: "acoes", dataAsOf: "2T26", overview: "",
  keyMetrics: [], quality: { score: 7, summary: "", strengths: [], weaknesses: [] },
  outlook: { direction: "alta", horizon: "12 meses", confidence: "media", rationale: "", priceRange: null },
  macroGeopolitics: "", scenarios: [],
  recommendation: { verdict: "acumular", fitWithPortfolio: "", suggestedAction: "", rationale: "" },
  sources: [], ...o,
});

test("researchKey junta símbolo do Yahoo e ticker", () => {
  assert.equal(researchKey({ symbol: "PETR4.SA", ticker: "PETR4" }), "PETR4");
  assert.equal(researchKey({ symbol: null, ticker: "petr4" }), "PETR4");
  assert.equal(researchKey({ symbol: "BTC-USD", ticker: "BTC" }), "BTC-USD");
});

test("addResearch: nova no topo, substitui a do mesmo ativo e limita a lista", () => {
  const old = r({ id: "a" });
  const other = r({ id: "b", symbol: "VALE3.SA", ticker: "VALE3" });
  const fresh = r({ id: "c", symbol: null, ticker: "PETR4" });
  assert.deepEqual(addResearch([old, other], fresh).map((x) => x.id), ["c", "b"]);
  const many = Array.from({ length: MAX_RESEARCH + 5 }, (_, i) => r({ id: `x${i}`, symbol: `T${i}`, ticker: `T${i}` }));
  assert.equal(addResearch(many, fresh).length, MAX_RESEARCH);
  assert.deepEqual(addResearch(undefined, fresh).map((x) => x.id), ["c"]);
});

test("normalizeResearch limita a nota entre 0 e 10", () => {
  assert.equal(normalizeResearch(r({ quality: { score: 14, summary: "", strengths: [], weaknesses: [] } })).quality.score, 10);
  assert.equal(normalizeResearch(r({ quality: { score: -2, summary: "", strengths: [], weaknesses: [] } })).quality.score, 0);
  assert.equal(normalizeResearch(r({ quality: { score: 7.25, summary: "", strengths: [], weaknesses: [] } })).quality.score, 7.3);
});
