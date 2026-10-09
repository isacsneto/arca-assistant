import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshValues, type RefreshDeps } from "./refresh";
import type { Quote } from "./quotes";
import { withDefaults } from "./store";
import type { JobEvent, Position, RefreshResult } from "../shared/types";

const NOW = new Date("2026-10-09T15:00:00Z");
const ts = (iso: string) => Date.parse(iso) / 1000;

const p = (o: Partial<Position>): Position => ({
  id: "x", name: "X", institution: "XP", owner: "PF", assetClass: "acoes", subtype: "", currency: "BRL",
  value: 100, updatedAt: "2026-09-01T00:00:00Z", source: "", ...o,
});

const quotes: Record<string, Quote> = {
  "BRL=X": { symbol: "BRL=X", price: 5, currency: "BRL", history: [] },
  "PETR4.SA": { symbol: "PETR4.SA", price: 56, currency: "BRL", history: [{ t: ts("2026-09-01T13:00:00Z"), close: 40 }] },
  VOO: { symbol: "VOO", price: 700, currency: "USD", history: [{ t: ts("2026-09-01T13:00:00Z"), close: 600 }] },
};

async function run(
  positions: Position[],
  claude?: RefreshDeps["claudeRefresh"],
  fetchQuote?: RefreshDeps["fetchQuote"],
) {
  const events: JobEvent<RefreshResult>[] = [];
  let claudeCalledWith: string[] = [];
  const deps: RefreshDeps = {
    fetchQuote: fetchQuote ?? (async (s) => quotes[s] ?? null),
    claudeRefresh: async (ps, ctx, emit, signal) => {
      claudeCalledWith = ps.map((x) => x.id);
      return claude ? claude(ps, ctx, emit, signal) : { updates: [], ratesUsed: "" };
    },
    now: () => NOW,
  };
  const r = await refreshValues(withDefaults({ positions }), deps, (e) => events.push(e), new AbortController().signal);
  return { r, events, claudeCalledWith, line: (id: string) => r.lines.find((l) => l.id === id)! };
}

test("ativo com quantidade: quantidade × cotação; câmbio atualizado", async () => {
  const { r, line } = await run([p({ id: "petr", ticker: "PETR4", quantity: 500, value: 20000 })]);
  assert.equal(r.usdBrl, 5);
  assert.equal(line("petr").method, "cotacao");
  assert.equal(line("petr").newValue, 28000);
  assert.match(line("petr").source!, /PETR4\.SA/);
});

test("sem quantidade: infere pela cotação na data da última atualização", async () => {
  const { line } = await run([p({ id: "petr", ticker: "PETR4", value: 4000 })]);
  assert.equal(line("petr").quantity, 100); // 4000 / 40
  assert.equal(line("petr").newValue, 5600);
  assert.match(line("petr").note, /inferida/);
});

test("ativo em USD continua em USD; posição em BRL de ativo cotado em USD é convertida", async () => {
  const { line } = await run([
    p({ id: "usd", ticker: "VOO", assetClass: "internacional", currency: "USD", quantity: 2, value: 1200 }),
    p({ id: "brl", ticker: "VOO", assetClass: "internacional", currency: "BRL", quantity: 2, value: 6000 }),
  ]);
  assert.equal(line("usd").newValue, 1400);
  assert.equal(line("brl").newValue, 7000);
});

test("sem cotação vai para o Claude; recém-atualizado não; estimativas absurdas são descartadas", async () => {
  const { line, claudeCalledWith } = await run(
    [
      p({ id: "cdb", name: "CDB 110% CDI", assetClass: "caixa", value: 10000 }),
      p({ id: "cc", name: "Conta corrente", assetClass: "caixa", value: 500 }),
      p({ id: "novo", name: "LCI", assetClass: "caixa", value: 1000, updatedAt: "2026-10-09T10:00:00Z" }),
      p({ id: "louco", name: "Fundo X", assetClass: "outros", value: 1000 }),
      p({ id: "sumiu", name: "Fundo Y", assetClass: "outros", value: 1000 }),
    ],
    async () => ({
      ratesUsed: "CDI set/26 1,05%",
      updates: [
        { id: "cdb", newValue: 10115.5, method: "indexador", note: "110% do CDI", source: "https://bcb.gov.br" },
        { id: "cc", newValue: 999, method: "mantido", note: "saldo", source: null },
        { id: "louco", newValue: 50000, method: "cotacao", note: "?", source: null },
      ],
    }),
  );
  assert.deepEqual(claudeCalledWith.sort(), ["cc", "cdb", "louco", "sumiu"]);
  assert.equal(line("cdb").newValue, 10115.5);
  assert.equal(line("cdb").method, "indexador");
  assert.equal(line("cc").newValue, 500, "mantido ignora o número devolvido");
  assert.equal(line("novo").method, "mantido");
  assert.equal(line("louco").newValue, 1000);
  assert.match(line("louco").note, /implausível/);
  assert.match(line("sumiu").note, /Sem estimativa/);
});

test("falha do Claude não perde as cotações já obtidas", async () => {
  const { r, line, events } = await run(
    [p({ id: "petr", ticker: "PETR4", quantity: 1 }), p({ id: "cdb", assetClass: "caixa" })],
    async () => {
      throw new Error("limite de uso");
    },
  );
  assert.equal(line("petr").newValue, 56);
  assert.equal(line("cdb").method, "mantido");
  assert.match(line("cdb").note, /limite de uso/);
  assert.equal(r.lines.length, 2);
  assert.ok(events.some((e) => e.type === "status" && /limite de uso/.test(e.text)));
});

test("sem internet para cotações: usa o dólar dos ajustes e manda tudo ao Claude", async () => {
  const { r, claudeCalledWith } = await run([p({ id: "petr", ticker: "PETR4" })], undefined, async () => {
    throw new Error("offline");
  });
  assert.equal(r.usdBrl, null);
  assert.deepEqual(claudeCalledWith, ["petr"]);
});
