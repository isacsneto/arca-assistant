import { test } from "node:test";
import assert from "node:assert/strict";
import { fileNameNote, finalizeExtraction } from "./importReview";
import type { ExtractedItem, ExtractionResult } from "./types";

const item = (o: Partial<ExtractedItem> = {}): ExtractedItem => ({
  kind: "position", sourceFile: "itau-pf-cdb100cdi.png", institution: "Itaú Unibanco", name: "CDB", ticker: null,
  assetClass: "caixa", subtype: "CDB", currency: "BRL", value: 1000, quantity: null, date: null, txType: null,
  owner: null, confidence: "alta", notes: null, ...o,
});

const result = (o: Partial<ExtractionResult> = {}): ExtractionResult => ({ items: [], files: [], questions: [], warnings: [], ...o });

test("completa a leitura de arquivos que o Claude não devolveu, com a leitura do nome", () => {
  const out = finalizeExtraction(result({ items: [item()] }), ["itau-pf-cdb100cdi.png"]);
  assert.deepEqual(out.files, [
    { file: "itau-pf-cdb100cdi.png", institution: "Itaú", owner: "PF", productHint: "cdb100cdi", summary: "", duplicateOf: null },
  ]);
  assert.equal(out.items[0].institution, "Itaú");
  assert.equal(out.items[0].owner, "PF");
});

test("usa a leitura do Claude quando existe; ignora arquivos inventados", () => {
  const out = finalizeExtraction(
    result({
      items: [item()],
      files: [
        { file: "itau-pf-cdb100cdi.png", institution: "Itaú Unibanco", owner: "PF", productHint: "CDB 100% do CDI", summary: "1 CDB", duplicateOf: null },
        { file: "nao-existe.png", institution: "X", owner: "PJ", productHint: null, summary: "", duplicateOf: null },
      ],
    }),
    ["itau-pf-cdb100cdi.png"],
  );
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].productHint, "CDB 100% do CDI");
  assert.equal(out.items[0].institution, "Itaú Unibanco");
});

test("duplicateOf só vale para outro arquivo do lote", () => {
  const f = (file: string, duplicateOf: string | null) => ({ file, institution: null, owner: null, productHint: null, summary: "", duplicateOf });
  const out = finalizeExtraction(result({ files: [f("a.png", "b.png"), f("b.png", "b.png"), f("c.png", "z.png")] }), ["a.png", "b.png", "c.png"]);
  assert.deepEqual(out.files.map((x) => x.duplicateOf), ["b.png", null, null]);
});

test("perguntas: índices inválidos saem, perguntas sem alvo caem, máximo de 6 e de 4 opções", () => {
  const q = (id: string, itemIndexes: number[], question = "Esse fundo é renda fixa ou multimercado?") => ({ id, question, itemIndexes, options: ["A", "B", "C", "D", "E"] });
  const out = finalizeExtraction(
    result({
      items: [item(), item()],
      questions: [q("q1", [0, 0, 7]), q("q2", [9]), q("q3", [], "Qual o titular do arquivo xp.png?"), q("q4", [1]), q("q5", [1]), q("q6", [1]), q("q7", [1]), q("q8", [1])],
    }),
    ["itau-pf-cdb100cdi.png"],
  );
  assert.deepEqual(out.questions[0].itemIndexes, [0]);
  assert.ok(!out.questions.some((x) => x.id === "q2"), "pergunta sobre item inexistente cai");
  assert.ok(out.questions.some((x) => x.id === "q3"), "pergunta sobre titular/arquivo pode não ter item");
  assert.equal(out.questions.length, 6);
  assert.equal(out.questions[0].options.length, 4);
});

test("fileNameNote informa a leitura do nome e a suspeita visual de duplicado", () => {
  assert.match(fileNameNote("vest-pf.png"), /instituição = Vest; titular = pessoa física/);
  assert.match(fileNameNote("Screenshot 1.png"), /sem a convenção/);
  assert.match(fileNameNote("b.png", "a.png"), /quase idêntico a "a\.png"/);
});
