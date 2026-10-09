import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFileHints, describeHint, parseFileName } from "./fileHints";
import type { ExtractedItem } from "./types";

test("instituição + titular", () => {
  assert.deepEqual(parseFileName("vest-pf.png"), { institution: "Vest", owner: "PF", hint: null });
  assert.deepEqual(parseFileName("btg-pj.pdf"), { institution: "BTG Pactual", owner: "PJ", hint: null });
});

test("instituição + titular + dica do produto", () => {
  assert.deepEqual(parseFileName("itau-pf-cdb100cdi.jpg"), { institution: "Itaú", owner: "PF", hint: "cdb100cdi" });
  assert.deepEqual(parseFileName("C:\\prints\\XP_PJ_lci 95 cdi.png"), { institution: "XP Investimentos", owner: "PJ", hint: "lci 95 cdi" });
});

test("ordem livre e maiúsculas", () => {
  assert.deepEqual(parseFileName("Nubank-PF.PNG"), { institution: "Nubank", owner: "PF", hint: null });
  assert.deepEqual(parseFileName("inter-cdb-pj.png"), { institution: "Banco Inter", owner: "PJ", hint: "cdb" });
});

test("instituição desconhecida só é aceita junto com pf/pj", () => {
  assert.deepEqual(parseFileName("bancoxyz-pf.png"), { institution: "Bancoxyz", owner: "PF", hint: null });
  assert.deepEqual(parseFileName("relatorio-outubro.pdf"), { institution: null, owner: null, hint: null });
  assert.deepEqual(parseFileName("itau.png"), { institution: "Itaú", owner: null, hint: null });
});

test("nomes genéricos de print são ignorados", () => {
  assert.deepEqual(parseFileName("Screenshot 2026-10-09 101500.png"), { institution: null, owner: null, hint: null });
  assert.deepEqual(parseFileName("colado-1791581.png"), { institution: null, owner: null, hint: null });
});

test("só titular", () => {
  assert.deepEqual(parseFileName("pj-extrato.csv"), { institution: null, owner: "PJ", hint: "extrato" });
});

test("describeHint monta a dica para o prompt", () => {
  assert.equal(
    describeHint(parseFileName("itau-pf-cdb100cdi.png")),
    'instituição = Itaú; titular = pessoa física (PF); dica do usuário sobre o produto = "cdb100cdi"',
  );
  assert.equal(describeHint(parseFileName("print.png")), null);
});

test("applyFileHints: o nome do arquivo sobrescreve instituição e titular", () => {
  const item = (sourceFile: string, institution: string, owner: ExtractedItem["owner"]): ExtractedItem => ({
    kind: "position", sourceFile, institution, name: "CDB", ticker: null, assetClass: "caixa", subtype: "CDB",
    currency: "BRL", value: 1, quantity: null, date: null, txType: null, owner, confidence: "alta", notes: null,
  });
  const out = applyFileHints(
    [item("itau-pf-cdb100cdi.png", "Itaú Unibanco", null), item("print.png", "Nubank", "PJ"), item("outro.png", "XP", null)],
    ["itau-pf-cdb100cdi.png", "print.png"],
  );
  assert.equal(out[0].institution, "Itaú");
  assert.equal(out[0].owner, "PF");
  assert.equal(out[1].institution, "Nubank", "sem convenção: mantém o que o modelo leu");
  assert.equal(out[1].owner, "PJ");
  assert.equal(out[2].institution, "XP", "arquivo desconhecido não é alterado");
});
