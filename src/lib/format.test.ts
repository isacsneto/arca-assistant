import { test } from "node:test";
import assert from "node:assert/strict";
import { amt, amt0, amtCompact, fromDisplay, MASK, money, pct, safeUrl, setDisplayCurrency, setValuesHidden, signedPp } from "./format";
import { setLang } from "../../shared/i18n";

const sp = (s: string) => s.replace(/\s/g, " ");

test("safeUrl só aceita http(s)", () => {
  assert.equal(safeUrl("https://www.b3.com.br/x?y=1"), "https://www.b3.com.br/x?y=1");
  assert.equal(safeUrl("http://ri.empresa.com"), "http://ri.empresa.com/");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>"), null);
  assert.equal(safeUrl("not a url"), null);
});

test("formatação em pt-BR", () => {
  setLang("pt");
  setDisplayCurrency("BRL", { USD: 5 });
  assert.equal(sp(amt(1234.5)), "R$ 1.234,50");
  assert.equal(pct(12.345), "12,3%");
  assert.equal(pct(25, 0), "25%");
  assert.equal(signedPp(3.21), "+3,2 pp");
  assert.equal(signedPp(-7), "-7,0 pp");
});

test("moeda de exibição: totais em BRL aparecem convertidos; posições ficam na própria moeda", () => {
  setLang("en");
  setDisplayCurrency("USD", { USD: 5 });
  assert.equal(amt(1000), "$200.00", "R$ 1.000 a R$ 5/US$ = US$ 200");
  assert.equal(amt0(12_345), "$2,469");
  assert.equal(fromDisplay(100), 500, "aporte digitado em US$ vira R$ para o cálculo");
  assert.match(sp(money(1234.5, "BRL")), /^R\$ ?1,234\.50$/);
  assert.equal(money(10, "USD"), "$10.00");
  setDisplayCurrency("BRL", { USD: 5 });
  assert.match(sp(amt(1000)), /^R\$ ?1,000\.00$/);
  setLang("pt");
});

test("olho de privacidade: esconde o valor (e o sinal) mas mantém a moeda; % continua visível", () => {
  setLang("pt");
  setDisplayCurrency("BRL", { USD: 5 });
  setValuesHidden(true);
  try {
    assert.equal(sp(amt(1234.5)), `R$ ${MASK}`);
    assert.equal(sp(amt0(-50_000)), `R$ ${MASK}`);
    assert.equal(sp(amtCompact(1_200_000)), `R$ ${MASK}`, "sem o \"mi\" do compacto");
    assert.equal(money(10, "USD").replace(/\s/g, ""), `US$${MASK}`);
    assert.equal(pct(12.345), "12,3%");
  } finally {
    setValuesHidden(false);
  }
  assert.equal(sp(amt(1234.5)), "R$ 1.234,50");
});
