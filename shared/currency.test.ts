import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_CURRENCY, CURRENCY_CODES, FX_CODES, convert, fxRates, fxSummary, rate, toCurrency } from "./currency";
import { toBRL } from "./arca";

test("registro: BRL é a base e o dólar tem cotação", () => {
  assert.equal(BASE_CURRENCY, "BRL");
  assert.ok(CURRENCY_CODES.includes("USD"));
  assert.deepEqual(FX_CODES, CURRENCY_CODES.filter((c) => c !== "BRL"));
});

test("conversão pela moeda base, nos dois sentidos", () => {
  const fx = { USD: 5 };
  assert.equal(rate(fx, "BRL"), 1);
  assert.equal(convert(10, "USD", "BRL", fx), 50);
  assert.equal(convert(50, "BRL", "USD", fx), 10);
  assert.equal(convert(7, "USD", "USD", fx), 7);
  assert.equal(toBRL({ value: 100, currency: "USD" }, fx), 500);
});

test("cotação ausente ou inválida usa o padrão do registro", () => {
  assert.equal(rate({}, "USD"), 5.5);
  assert.equal(rate({ USD: 0 }, "USD"), 5.5);
  assert.equal(rate(undefined, "USD"), 5.5);
});

test("ajustes antigos: usdBrl vira fx.USD; fx novo tem prioridade", () => {
  assert.deepEqual(fxRates(undefined, 6), { USD: 6 });
  assert.deepEqual(fxRates({ USD: 5.2 }, 6), { USD: 5.2 });
  assert.deepEqual(fxRates({ USD: "abc" }), { USD: 5.5 });
  assert.equal(toCurrency("USD"), "USD");
  assert.equal(toCurrency("XYZ"), "BRL", "moeda desconhecida cai na base");
});

test("resumo das cotações", () => {
  assert.match(fxSummary({ USD: 5.42 }).replace(/\s/g, " "), /^US\$ 1 = R\$ 5[.,]42$/);
});
