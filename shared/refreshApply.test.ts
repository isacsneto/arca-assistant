import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRefresh, fxImpact, isChange, keepOrRemoveDefaults, refreshTotals, withChoice } from "./refreshApply";
import type { Position, RefreshLine } from "./types";

const NOW = "2026-10-09T15:00:00.000Z";
const p = (id: string, value: number, quantity?: number): Position => ({
  id, name: id, institution: "x", owner: "PF", assetClass: "acoes", subtype: "", currency: "BRL",
  value, quantity, updatedAt: "2026-09-01", source: "",
});
const line = (id: string, oldValue: number, newValue: number, method: RefreshLine["method"], quantity?: number): RefreshLine => ({
  id, name: id, currency: "BRL", oldValue, newValue, method, quantity, note: "",
});

test("aplica só as aprovadas e grava a quantidade inferida", () => {
  const positions = [p("a", 100), p("b", 200, 3), p("c", 300)];
  const lines = [line("a", 100, 150, "cotacao", 10), line("b", 200, 210, "cotacao", 3), line("c", 300, 330, "indexador")];
  const out = applyRefresh(positions, lines, new Set(["a", "c"]), NOW);
  assert.deepEqual(out.map((x) => x.value), [150, 200, 330]);
  assert.equal(out[0].quantity, 10);
  assert.equal(out[0].updatedAt, NOW);
  assert.equal(out[1].updatedAt, "2026-09-01", "não aprovada fica intacta");
  assert.equal(out[2].quantity, undefined, "indexador não inventa quantidade");
  assert.equal(positions[0].value, 100, "não muta a entrada");
});

test("'mantido' não altera nem a data (para não perder o período de acúmulo)", () => {
  const out = applyRefresh([p("cc", 500)], [line("cc", 500, 999, "mantido")], new Set(["cc"]), NOW);
  assert.equal(out[0].value, 500);
  assert.equal(out[0].updatedAt, "2026-09-01");
});

test("data de referência do indexador vira o updatedAt; valor da IA fica marcado e a marca sai depois", () => {
  const asOf = "2026-10-31T03:00:00.000Z";
  const out = applyRefresh([p("cdb", 1000), p("fundo", 500)], [{ ...line("cdb", 1000, 1007, "indexador"), asOf }, { ...line("fundo", 500, 505, "cotacao"), ai: true }], new Set(["cdb", "fundo"]), NOW);
  assert.equal(out[0].updatedAt, asOf);
  assert.equal(out[0].aiEstimate, undefined);
  assert.equal(out[1].aiEstimate, true);
  const again = applyRefresh(out, [line("fundo", 505, 510, "cotacao")], new Set(["fundo"]), NOW);
  assert.equal(again[1].aiEstimate, undefined, "atualizado por fonte oficial deixa de ser estimativa");
});

test("aplicação automática: entra tudo que mudou, mas só sai o que veio do Open Finance", async () => {
  const { autoApplicable } = await import("./refreshApply");
  const positions = [{ ...p("of", 100), source: "Open Finance · BTG Pactual PF" }, { ...p("btc", 100), source: "print" }];
  const lines = [line("of", 100, 0, "removido"), line("btc", 100, 0, "removido"), { ...line("x", 0, 50, "openfinance"), add: {} as never }];
  assert.deepEqual(autoApplicable(positions, lines).map((l) => l.id), ["of", "x"]);
});

test("isChange ignora mantidos e diferenças de centavos", () => {
  assert.equal(isChange(line("a", 100, 100.001, "cotacao")), false);
  assert.equal(isChange(line("a", 100, 101, "cotacao")), true);
  assert.equal(isChange(line("a", 100, 101, "mantido")), false);
});

test("Open Finance: atualiza, remove o que saiu e cria o que entrou (só o aprovado)", () => {
  const positions = [p("a", 100), p("b", 200), p("c", 300)];
  const lines: RefreshLine[] = [
    { id: "a", name: "A", currency: "BRL", oldValue: 100, newValue: 110, method: "openfinance", quantity: 7, note: "" },
    { id: "b", name: "B", currency: "BRL", oldValue: 200, newValue: 0, method: "removido", note: "" },
    { id: "c", name: "C", currency: "BRL", oldValue: 300, newValue: 0, method: "removido", note: "" },
    {
      id: "of-new:x:0", name: "N", currency: "BRL", oldValue: 0, newValue: 50, method: "openfinance", note: "",
      add: { kind: "position", sourceFile: "OF", institution: "BTG Pactual", name: "Novo", ticker: null, assetClass: "caixa", subtype: "CDB", currency: "BRL", value: 50, quantity: null, date: null, txType: null, owner: "PF", confidence: "alta", notes: null },
    },
  ];
  assert.ok(lines.every(isChange));
  const out = applyRefresh(positions, lines, new Set(["a", "b", "of-new:x:0"]), "2026-10-10T00:00:00Z", () => "novo-id");
  assert.deepEqual(out.map((x) => [x.id, x.value]), [["a", 110], ["c", 300], ["novo-id", 50]]);
  assert.equal(out[0].quantity, 7);
  assert.equal(out[2].institution, "BTG Pactual");
});

test("totais separam ativos e câmbio: fim de semana com dólar em queda e Bitcoin em alta", () => {
  // Caso real: só o Bitcoin (BRL) subiu 0,25%; US$ 55.410,55 em dólar ficaram "mantidos", mas o dólar caiu.
  const btc = line("btc", 13_771.32, 13_806.25, "cotacao");
  const usd: RefreshLine = { ...line("voo", 55_410.55, 55_410.55, "mantido"), currency: "USD" };
  const t = refreshTotals([btc, usd], new Set(["btc"]), { USD: 4.9918 }, { USD: 4.9772 });
  assert.ok(Math.abs(t.assets - 34.93) < 0.01, `ativos ${t.assets}`);
  assert.ok(Math.abs(t.fx - -808.99) < 0.01, `câmbio ${t.fx}`);
  assert.ok(Math.abs(t.after - t.before - (t.assets + t.fx)) < 1e-6, "variação = ativos + câmbio");
  assert.ok(Math.abs(t.after - t.before - -774.06) < 0.01);
  assert.ok(Math.abs(fxImpact(usd, { USD: 4.9918 }, { USD: 4.9772 }) - -808.99) < 0.01);
  assert.equal(fxImpact(btc, { USD: 4.9918 }, { USD: 4.9772 }), 0, "real não tem efeito de câmbio");
  // Não aprovada: o valor não muda, só o câmbio conta.
  const t2 = refreshTotals([btc, usd], new Set(), { USD: 4.9918 }, { USD: 4.9772 });
  assert.equal(t2.assets, 0);
});
test("não veio do Open Finance: manter ou remover (o que veio dele começa removido; COE/cripto/print, mantidos)", () => {
  const positions = [{ ...p("of", 100), source: "Open Finance · Banco PF" }, { ...p("print", 200), source: "print" }, p("coe", 300)];
  const lines = [line("of", 100, 0, "removido"), line("print", 200, 0, "removido"), { ...line("coe", 300, 310, "mantido"), notInOf: true, ai: true }];
  const c = keepOrRemoveDefaults(positions, lines);
  assert.deepEqual([...c], [["of", "remove"], ["print", "keep"], ["coe", "keep"]]);

  const eff = lines.map((l) => withChoice(l, c.get(l.id)));
  assert.deepEqual(eff.map((l) => [l.method, l.newValue]), [["removido", 0], ["mantido", 200], ["mantido", 310]]);
  // Removendo o COE à mão: sai; mantendo o que veio do Open Finance: fica como está.
  c.set("coe", "remove").set("of", "keep");
  const eff2 = lines.map((l) => withChoice(l, c.get(l.id)));
  const out = applyRefresh(positions, eff2, new Set(eff2.filter(isChange).map((l) => l.id)), NOW);
  assert.deepEqual(out.map((x) => [x.id, x.value]), [["of", 100], ["print", 200]]);
});
