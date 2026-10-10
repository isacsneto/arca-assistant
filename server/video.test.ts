import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { parseDuration, sampleStep, sampleVideo, MAX_SAMPLES } from "./video";

test("lê a duração do cabeçalho do ffmpeg", () => {
  assert.equal(parseDuration("  Duration: 00:01:05.50, start: 0.000000, bitrate: 213 kb/s"), 65.5);
  assert.equal(parseDuration("Invalid data found when processing input"), null);
});

test("vídeos longos são amostrados com intervalo maior", () => {
  assert.equal(sampleStep(30, 0.5), 0.5);
  assert.ok(600 / sampleStep(600, 0.5) <= MAX_SAMPLES);
});

test("extrai amostras de um vídeo de verdade com o ffmpeg", { skip: !ffmpeg || !fs.existsSync(ffmpeg) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arca-video-test-"));
  const file = path.join(dir, "tela.mp4");
  const gen = spawnSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x640:rate=10", "-pix_fmt", "yuv420p", file]);
  assert.equal(gen.status, 0, String(gen.stderr));
  const samples = await sampleVideo(fs.readFileSync(file), { step: 0.5 });
  assert.ok(samples.length >= 5 && samples.length <= 7, `amostras: ${samples.length}`);
  assert.deepEqual(samples.slice(0, 3).map((s) => s.t), [0, 0.5, 1]);
  assert.equal(Buffer.from(samples[0].data, "base64").subarray(0, 2).toString("hex"), "ffd8", "JPEG");
  await assert.rejects(sampleVideo(Buffer.from("não é vídeo"), { step: 0.5 }), /Não consegui ler/);
});
