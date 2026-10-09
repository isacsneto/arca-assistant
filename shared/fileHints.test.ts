import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFileReadings, describeHint, parseFileName } from "./fileHints";
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

test("versões, cópias, datas e timestamps no nome não viram dica de produto", () => {
  assert.deepEqual(parseFileName("xp-pj-v2.jpg"), { institution: "XP Investimentos", owner: "PJ", hint: null });
  assert.deepEqual(parseFileName("itau-pf-cdb100cdi copia (2).png"), { institution: "Itaú", owner: "PF", hint: "cdb100cdi" });
  assert.deepEqual(parseFileName("btg-pf-2026-10-09.png"), { institution: "BTG Pactual", owner: "PF", hint: null });
  assert.deepEqual(parseFileName("nubank-pf-1791581198.png"), { institution: "Nubank", owner: "PF", hint: null });
});

test("números com significado continuam na dica", () => {
  assert.deepEqual(parseFileName("inter-pj-lci-95.png"), { institution: "Banco Inter", owner: "PJ", hint: "lci 95" });
  assert.deepEqual(parseFileName("btg-pf-tesouro-ipca-2029.png"), { institution: "BTG Pactual", owner: "PF", hint: "tesouro ipca 2029" });
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

const item = (sourceFile: string, institution: string, owner: ExtractedItem["owner"]): ExtractedItem => ({
  kind: "position", sourceFile, institution, name: "CDB", ticker: null, assetClass: "caixa", subtype: "CDB",
  currency: "BRL", value: 1, quantity: null, date: null, txType: null, owner, confidence: "alta", notes: null,
});

test("applyFileReadings: sem leitura do Claude, o nome do arquivo sobrescreve o item", () => {
  const out = applyFileReadings(
    [item("itau-pf-cdb100cdi.png", "Itaú Unibanco", null), item("print.png", "Nubank", "PJ"), item("outro.png", "XP", null)],
    ["itau-pf-cdb100cdi.png", "print.png"],
  );
  assert.equal(out[0].institution, "Itaú");
  assert.equal(out[0].owner, "PF");
  assert.equal(out[1].institution, "Nubank", "sem convenção: mantém o que o modelo leu");
  assert.equal(out[1].owner, "PJ");
  assert.equal(out[2].institution, "XP", "arquivo desconhecido não é alterado");
});

test("applyFileReadings: a leitura do Claude sobre o arquivo tem prioridade", () => {
  const out = applyFileReadings(
    [item("vest-pf.png", "?", null), item("vest-pf.png", "?", "PJ"), item("print.png", "Nubank", null)],
    ["vest-pf.png", "print.png"],
    [
      { file: "vest-pf.png", institution: "Vest Investimentos", owner: null },
      { file: "print.png", institution: "Inter", owner: "PJ" },
    ],
  );
  assert.equal(out[0].institution, "Vest Investimentos", "Claude corrige o nome da instituição");
  assert.equal(out[0].owner, "PF", "Claude sem titular: usa o do nome do arquivo");
  assert.equal(out[1].owner, "PF", "o titular do arquivo vale para todos os itens dele");
  assert.equal(out[2].institution, "Inter");
  assert.equal(out[2].owner, "PJ");
});

test("applyFileReadings: com um arquivo só, itens com sourceFile errado são atribuídos a ele", () => {
  const out = applyFileReadings([item("Arquivo 1", "?", null)], ["xp-pj.png"]);
  assert.equal(out[0].sourceFile, "xp-pj.png");
  assert.equal(out[0].institution, "XP Investimentos");
  assert.equal(out[0].owner, "PJ");
});
