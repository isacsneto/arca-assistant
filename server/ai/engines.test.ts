import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { jsonSchema } from "./claude";
import { codexArgs, codexEffort, parseCodexEvent } from "./codex";
import { cursorArgs, extractJson } from "./cursor";
import { inlineTexts, stageFiles } from "./files";
import { fileSecrets } from "./secrets";
import { AiError, configureAi, explainError, runAi } from "./index";
import { ExtractionResultSchema, ScanReportSchema } from "../../shared/types";
import type { AiTask } from "../../shared/ai";

test("jsonSchema gera schema estrito aceito pelos CLIs (sem $schema, sem campos extras)", () => {
  for (const schema of [ExtractionResultSchema, ScanReportSchema]) {
    const s = jsonSchema(schema) as { $schema?: unknown; type: string; required: string[]; additionalProperties: boolean };
    assert.equal(s.$schema, undefined);
    assert.equal(s.type, "object");
    assert.equal(s.additionalProperties, false);
    assert.ok(Array.isArray(s.required));
  }
});

test("explainError traduz falhas comuns de qualquer provedor", () => {
  assert.equal(explainError(new Error("Invalid API key · Please run /login")).status, 401);
  assert.equal(explainError(new Error("Not logged in")).status, 401);
  assert.equal(explainError(new Error("You've hit your usage limit")).status, 429);
  assert.match(explainError(new Error("spawn agent ENOENT")).message, /CLI da IA/);
  const own = new AiError("x", 418);
  assert.equal(explainError(own), own);
});

test("Codex: argumentos do codex exec (schema, saída, esforço, busca, imagens, prompt via stdin)", () => {
  const args = codexArgs({ dir: "/t", schemaPath: "/t/s.json", outPath: "/t/o.json", model: "gpt-5.5", effort: "xhigh", web: true, images: ["/t/1.png", "/t/2.jpg"] });
  assert.deepEqual(args.slice(0, 4), ["exec", "--json", "--skip-git-repo-check", "--ephemeral"]);
  assert.ok(args.join(" ").includes("-s read-only"), "nunca altera arquivos");
  assert.ok(args.includes("--output-schema") && args.includes("/t/s.json"));
  assert.ok(args.includes('model_reasoning_effort="high"'), "xhigh vira high");
  assert.ok(args.includes('web_search="live"'));
  assert.deepEqual(args.slice(-2), ["--image=/t/1.png,/t/2.jpg", "-"], "imagens com '=' e prompt pelo stdin no fim");
  const noWeb = codexArgs({ dir: "/t", schemaPath: "s", outPath: "o", effort: "low", web: false, images: [] });
  assert.ok(!noWeb.includes("-m") && !noWeb.some((a) => a.startsWith("--image")) && !noWeb.includes('web_search="live"'));
  assert.deepEqual([codexEffort("low"), codexEffort("medium"), codexEffort("max")], ["low", "medium", "high"]);
});

test("Codex: eventos JSONL viram progresso; falhas viram erro", () => {
  assert.deepEqual(parseCodexEvent('{"type":"item.completed","item":{"id":"1","type":"web_search","query":"selic hoje","action":{"type":"search"}}}'), { progress: { type: "search", query: "selic hoje" } });
  assert.deepEqual(parseCodexEvent('{"type":"item.completed","item":{"type":"web_search","query":"","action":{"type":"search","query":"ipca focus"}}}'), { progress: { type: "search", query: "ipca focus" } });
  assert.equal(parseCodexEvent('{"type":"item.started","item":{"type":"reasoning"}}')?.progress?.type, "status");
  assert.deepEqual(parseCodexEvent('{"type":"turn.failed","error":{"message":"usage limit"}}'), { error: "usage limit" });
  assert.equal(parseCodexEvent("lixo"), null);
  assert.equal(parseCodexEvent('{"type":"thread.started","thread_id":"x"}'), null);
});

test("Cursor: extrai o JSON da resposta (com ou sem bloco de código, com chaves dentro de strings)", () => {
  assert.deepEqual(extractJson('Aqui está:\n```json\n{"a": 1, "b": "x}"}\n```'), { a: 1, b: "x}" });
  assert.deepEqual(extractJson('texto antes {"a": {"b": [1, 2]}, "c": "{"} texto depois'), { a: { b: [1, 2] }, c: "{" });
  assert.throws(() => extractJson("sem json"));
  assert.throws(() => extractJson('{"a": 1'));
  assert.deepEqual(cursorArgs({ instruction: "faça" }), ["-p", "--output-format", "json", "faça"]);
  assert.deepEqual(cursorArgs({ model: "gpt-5", instruction: "faça" }), ["-p", "--output-format", "json", "--model", "gpt-5", "faça"]);
});

test("arquivos: imagens/PDFs vão para disco; texto vai inline; PDF pode virar texto", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arca-stage-"));
  const staged = await stageFiles(
    [
      { name: "itau-pf.png", kind: "image", mediaType: "image/png", data: Buffer.from("IMG").toString("base64") },
      { name: "extrato.csv", kind: "text", data: "data;valor" },
      { name: "quebrado.pdf", kind: "pdf", data: Buffer.from("não é pdf").toString("base64") },
    ],
    dir,
    { pdfAsText: true },
  );
  assert.ok(fs.existsSync(staged[0].path!));
  assert.match(staged[0].note, /Itaú/);
  assert.equal(staged[1].text, "data;valor");
  assert.match(staged[2].text!, /não foi possível extrair/);
  assert.match(inlineTexts(staged), /Arquivo 2: extrato\.csv[\s\S]*data;valor/);
});

test("segredos: arquivo tem prioridade, variável de ambiente é alternativa, remover funciona", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arca-sec-")), "sub", "secrets.json");
  const s = fileSecrets(file, { OPENAI_API_KEY: "sk-env", ANTHROPIC_API_KEY: "" });
  assert.equal(s.get("codex"), "sk-env");
  assert.equal(s.has("claude"), false, "variável vazia não conta");
  s.set("codex", " sk-file ");
  assert.equal(s.get("codex"), "sk-file");
  s.set("codex", null);
  assert.equal(s.get("codex"), "sk-env");
  assert.throws(() => s.set("xpto" as never, "k"));
});

test("runAi: escolhe o motor do provedor e exige chave no modo apiKey", async () => {
  const calls: string[] = [];
  const fake = (name: string) => (async (_req: unknown, ctx: { apiKey?: string }) => {
    calls.push(`${name}:${ctx.apiKey ?? "-"}`);
    return { data: { ok: true }, searches: 0 };
  }) as never;
  const store: Record<string, string> = { cursor: "key_123" };
  configureAi({
    secrets: { get: (p) => store[p], has: (p) => Boolean(store[p]), set: () => undefined },
    engines: { claude: fake("claude"), codex: fake("codex"), cursor: fake("cursor") },
  });
  const req = { system: "", prompt: "", schema: z.object({ ok: z.boolean() }), web: false, maxTurns: 1 };
  const task = (provider: AiTask["provider"], auth: AiTask["auth"]): AiTask => ({ task: "scan", provider, auth, effort: "low" });
  await runAi(task("codex", "local"), req);
  await runAi(task("cursor", "apiKey"), req);
  await assert.rejects(runAi(task("claude", "apiKey"), req), (e: AiError) => e.status === 401 && /Ajustes/.test(e.message));
  assert.deepEqual(calls, ["codex:-", "cursor:key_123"]);
});
