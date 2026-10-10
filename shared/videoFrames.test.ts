import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, evenly, frameName, isVideoName, pickFrames, type FrameSample } from "./videoFrames";
import { parseFileName } from "./fileHints";

/** Hash de 256 bits com os primeiros `ones` bits ligados a partir do bit `from`. */
function hash(from: number, ones: number): string {
  const bits = Array.from({ length: 256 }, (_, i) => (i >= from && i < from + ones ? 1 : 0));
  let hex = "";
  for (let i = 0; i < 256; i += 4) hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  return hex;
}

const A = hash(0, 0);
const B = hash(0, 100);
const C = hash(100, 120);
const blur = (k: number) => hash(k * 37 % 200, 40 + k);
const seq = (hashes: string[]): FrameSample[] => hashes.map((h, i) => ({ t: i * 0.5, hash: h }));

test("pega um quadro por tela parada e ignora o borrão da rolagem", () => {
  const s = seq([A, A, A, blur(1), blur(2), B, B, B, blur(3), C, C]);
  assert.deepEqual(pickFrames(s), [1, 6, 10]);
});

test("tela que não muda vira um quadro só", () => {
  assert.deepEqual(pickFrames(seq([A, A, A, A, A, A])), [1]);
});

test("rolagem contínua sem pausa ainda gera quadros a cada poucos segundos", () => {
  const moving = Array.from({ length: 20 }, (_, k) => hash((k * 13) % 200, 60));
  const picked = pickFrames(seq(moving));
  assert.ok(picked.length >= 3, `esperava vários quadros, veio ${picked.length}`);
  assert.equal(picked[picked.length - 1], 19, "inclui o fim da rolagem");
});

test("limita a quantidade de quadros mantendo o primeiro e o último", () => {
  assert.deepEqual(evenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4), [0, 3, 6, 9]);
  assert.deepEqual(evenly([1, 2], 5), [1, 2]);
  const many = Array.from({ length: 80 }, (_, k) => (k % 2 ? hash(0, 120) : A));
  const doubled = many.flatMap((h) => [h, h]);
  assert.ok(pickFrames(seq(doubled), { max: 6 }).length <= 6);
});

test("nome do quadro mantém a convenção banco-pf do vídeo", () => {
  assert.equal(frameName("btg-pf.mp4", 3), "btg-pf-quadro03.jpg");
  assert.deepEqual(parseFileName(frameName("itau-pf-cdb100cdi.mov", 12)), { institution: "Itaú", owner: "PF", hint: "cdb100cdi" });
  assert.equal(clock(65.4), "1:05");
  assert.ok(isVideoName("Gravação de tela.MOV"));
  assert.ok(!isVideoName("print.png"));
});
