import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, pct, safeUrl, signedPp } from "./format";

test("safeUrl só aceita http(s)", () => {
  assert.equal(safeUrl("https://www.b3.com.br/x?y=1"), "https://www.b3.com.br/x?y=1");
  assert.equal(safeUrl("http://ri.empresa.com"), "http://ri.empresa.com/");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>"), null);
  assert.equal(safeUrl("not a url"), null);
});

test("formatação em pt-BR", () => {
  assert.equal(brl(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
  assert.equal(pct(12.345), "12,3%");
  assert.equal(pct(25, 0), "25%");
  assert.equal(signedPp(3.21), "+3,2 pp");
  assert.equal(signedPp(-7), "-7,0 pp");
});
