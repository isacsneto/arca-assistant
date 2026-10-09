import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileStore, withDefaults } from "./store";
import { DEFAULT_SETTINGS } from "../shared/types";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arca-store-")), "nested", "state.json");

test("arquivo inexistente devolve estado vazio com ajustes padrão", () => {
  const s = fileStore(tmpFile()).load();
  assert.deepEqual(s.positions, []);
  assert.deepEqual(s.settings, DEFAULT_SETTINGS);
});

test("salva e recarrega (criando a pasta)", () => {
  const file = tmpFile();
  const store = fileStore(file);
  const s = store.load();
  s.settings.usdBrl = 5.12;
  store.save(s);
  assert.equal(fileStore(file).load().settings.usdBrl, 5.12);
  assert.ok(!fs.existsSync(file + ".tmp"), "escrita atômica não deixa .tmp");
});

test("JSON corrompido não derruba o servidor", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ quebrado");
  assert.deepEqual(fileStore(file).load().positions, []);
});

test("estado antigo/parcial ganha os campos novos sem perder os existentes", () => {
  const s = withDefaults({
    positions: [],
    settings: { usdBrl: 6, targets: { acoes: 40 } } as never,
  });
  assert.equal(s.settings.usdBrl, 6);
  assert.equal(s.settings.targets.acoes, 40);
  assert.equal(s.settings.targets.fiis, 25);
  assert.deepEqual(s.settings.scan, DEFAULT_SETTINGS.scan);
  assert.deepEqual(s.transactions, []);
  assert.deepEqual(s.scans, {});
});
