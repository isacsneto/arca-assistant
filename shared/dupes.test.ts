import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDuplicates, hamming, uniqueName, type Fingerprint } from "./dupes";

const fp = (id: string, sha: string, dhash?: string): Fingerprint => ({ id, name: `${id}.png`, sha, dhash });

test("hamming conta bits diferentes", () => {
  assert.equal(hamming("0000000000000000", "0000000000000000"), 0);
  assert.equal(hamming("0000000000000000", "000000000000000f"), 4);
  assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64);
});

test("arquivo idêntico (mesmo sha) é descartado, inclusive dentro do mesmo lote", () => {
  const { accepted, exact } = checkDuplicates([fp("a", "s1", "aaaaaaaaaaaaaaaa")], [fp("b", "s1"), fp("c", "s2"), fp("d", "s2")]);
  assert.deepEqual(accepted.map((f) => f.id), ["c"]);
  assert.deepEqual(exact.map((e) => [e.file.id, e.sameAs]), [["b", "a.png"], ["d", "c.png"]]);
});

test("print quase idêntico é aceito, mas marcado com looksLike", () => {
  const { accepted, exact } = checkDuplicates(
    [fp("a", "s1", "f0f0f0f0f0f0f0f0")],
    [fp("b", "s2", "f0f0f0f0f0f0f0f1"), fp("c", "s3", "0f0f0f0f0f0f0f0f")],
  );
  assert.equal(exact.length, 0);
  assert.equal(accepted[0].looksLike, "a.png", "1 bit de diferença");
  assert.equal(accepted[1].looksLike, undefined, "imagem diferente");
});

test("proporção diferente nunca é duplicado, mesmo com hash parecido (prints de texto em fundo branco)", () => {
  const a = { ...fp("a", "s1", "f0f0f0f0f0f0f0f0"), aspect: 720 / 202 };
  const b = { ...fp("b", "s2", "f0f0f0f0f0f0f0f0"), aspect: 720 / 340 };
  const c = { ...fp("c", "s3", "f0f0f0f0f0f0f0f1"), aspect: 1440 / 404 };
  const { accepted } = checkDuplicates([a], [b, c]);
  assert.equal(accepted[0].looksLike, undefined, "alturas diferentes = telas diferentes");
  assert.equal(accepted[1].looksLike, "a.png", "mesma proporção (print redimensionado) continua sendo detectado");
});

test("limite de bits é proporcional ao tamanho do hash (256 bits → até 20)", () => {
  const zero = "0".repeat(64);
  const twenty = "f".repeat(5) + "0".repeat(59);
  const twentyFour = "f".repeat(6) + "0".repeat(58);
  assert.equal(checkDuplicates([fp("a", "s1", zero)], [fp("b", "s2", twenty)]).accepted[0].looksLike, "a.png");
  assert.equal(checkDuplicates([fp("a", "s1", zero)], [fp("b", "s2", twentyFour)]).accepted[0].looksLike, undefined);
});

test("arquivos sem dhash (PDF/CSV) só são comparados pelo sha", () => {
  const { accepted } = checkDuplicates([fp("a", "s1")], [fp("b", "s2")]);
  assert.equal(accepted[0].looksLike, undefined);
});

test("uniqueName numera nomes repetidos preservando a extensão", () => {
  const taken = new Set(["image.png", "image (2).png", "extrato"]);
  assert.equal(uniqueName("image.png", taken), "image (3).png");
  assert.equal(uniqueName("extrato", taken), "extrato (2)");
  assert.equal(uniqueName("novo.pdf", taken), "novo.pdf");
});
