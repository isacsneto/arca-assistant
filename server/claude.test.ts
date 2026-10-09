import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeError, explainError, jsonSchema } from "./claude";
import { ExtractionResultSchema, ScanReportSchema } from "../shared/types";

test("jsonSchema gera schema que o CLI aceita (sem $schema 2020-12)", () => {
  for (const schema of [ExtractionResultSchema, ScanReportSchema]) {
    const s = jsonSchema(schema);
    assert.equal(s.$schema, undefined);
    assert.equal(s.type, "object");
    assert.ok(Array.isArray(s.required));
  }
});

test("schema de extração marca campos anuláveis como obrigatórios (com null permitido)", () => {
  const s = jsonSchema(ExtractionResultSchema) as {
    properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } };
  };
  const item = s.properties.items.items;
  assert.ok(item.required.includes("ticker"));
  assert.match(JSON.stringify(item.properties.ticker), /null/);
});

test("explainError traduz falhas comuns em mensagens úteis", () => {
  assert.equal(explainError(new Error("Invalid API key · Please run /login")).status, 401);
  assert.equal(explainError(new Error("Not logged in")).status, 401);
  assert.equal(explainError(new Error("You've hit your usage limit")).status, 429);
  assert.match(explainError(new Error("spawn claude ENOENT")).message, /Claude Code/);
  const own = new ClaudeError("x", 418);
  assert.equal(explainError(own), own);
  assert.equal(explainError("texto").message, "texto");
});
