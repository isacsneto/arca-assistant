import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AI, aiFor, aiLabel, aiSettings, isAiReady, type AiStatus } from "./ai";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const settings = (ai?: Partial<Settings["ai"]>): Settings => ({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_AI, ...ai } as Settings["ai"] });

test("Claude: modelo e esforço vêm da configuração de cada tarefa", () => {
  const s = settings();
  assert.deepEqual(aiFor(s, "scan"), { task: "scan", provider: "claude", auth: "local", model: "claude-opus-5-5", effort: "high", language: "en" });
  assert.equal(aiFor(s, "extraction").model, "claude-sonnet-5-5");
  assert.equal(aiFor(s, "prompt").model, aiFor(s, "extraction").model, "import por texto usa o modelo de leitura");
  assert.equal(aiFor(s, "refine").effort, "medium");
});

test("Codex/Cursor: modelo por força (forte/rápido), vazio = padrão do CLI; esforço continua por tarefa", () => {
  const s = settings({ provider: "codex", auth: "apiKey", models: { codex: { strong: "gpt-6-astra", fast: " " }, cursor: { strong: "", fast: "" } } });
  assert.deepEqual(aiFor(s, "projection"), { task: "projection", provider: "codex", auth: "apiKey", model: "gpt-6-astra", effort: "high", language: "en" });
  assert.equal(aiFor(s, "estimate").model, undefined);
  assert.equal(aiFor(settings({ provider: "cursor" }), "scan").model, undefined);
});

test("aiSettings tolera estado antigo/parcial", () => {
  assert.deepEqual(aiSettings({ ai: undefined as never }), DEFAULT_AI);
  assert.deepEqual(aiSettings({ ai: { provider: "xpto" } as never }), DEFAULT_AI);
  const s = aiSettings({ ai: { provider: "cursor", auth: "weird", models: { codex: { strong: "x" } } } as never });
  assert.equal(s.auth, "local");
  assert.deepEqual(s.models.codex, { strong: "x", fast: "" });
});

test("aiLabel e prontidão do provedor", () => {
  assert.equal(aiLabel({ provider: "codex", model: undefined }), "Codex (ChatGPT)");
  assert.equal(aiLabel({ provider: "claude", model: "claude-opus-5-5" }), "Claude · claude-opus-5-5");
  const st = (o: Partial<AiStatus["claude"]>): AiStatus => ({
    claude: { installed: true, loggedIn: true, hasKey: false, ...o },
    codex: { installed: true, loggedIn: false, hasKey: true },
    cursor: { installed: false, loggedIn: null, hasKey: true },
  });
  assert.equal(isAiReady(DEFAULT_AI, st({})), true);
  assert.equal(isAiReady(DEFAULT_AI, st({ loggedIn: false })), false);
  assert.equal(isAiReady(DEFAULT_AI, st({ loggedIn: null })), true, "sem como verificar: deixa tentar");
  assert.equal(isAiReady({ ...DEFAULT_AI, provider: "codex", auth: "apiKey" }, st({})), true);
  assert.equal(isAiReady({ ...DEFAULT_AI, provider: "codex", auth: "local" }, st({})), false);
  assert.equal(isAiReady({ ...DEFAULT_AI, provider: "cursor", auth: "apiKey" }, st({})), false, "Cursor precisa do CLI mesmo com chave");
});
