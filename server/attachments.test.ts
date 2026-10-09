import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AttachmentError, MAX_ATTACHMENTS_PER_ASSET, collectGarbage, deleteAttachment, loadForClaude, readAttachment, saveAttachments,
} from "./attachments";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "arca-att-"));
const png = { name: "foto do carro.png", kind: "image" as const, mediaType: "image/png", data: Buffer.from("PNGDATA").toString("base64") };
const pdf = { name: "nota fiscal.pdf", kind: "pdf" as const, mediaType: "application/pdf", data: Buffer.from("%PDF-1.4").toString("base64") };
const txt = { name: "laudo.txt", kind: "text" as const, data: "Anel 18k, 4,2 g" };

test("salva, lê e apaga anexos com ids gerados pelo servidor", async () => {
  const root = tmp();
  const metas = await saveAttachments(root, "asset-1", [png, pdf, txt]);
  assert.equal(metas.length, 3);
  assert.match(metas[0].id, /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual(metas.map((m) => m.kind), ["image", "pdf", "text"]);
  assert.equal(metas[0].name, "foto do carro.png");

  const r = await readAttachment(root, "asset-1", metas[1].id);
  assert.equal(r.mediaType, "application/pdf");
  assert.equal(fs.readFileSync(r.path, "utf8"), "%PDF-1.4");

  await deleteAttachment(root, "asset-1", metas[1].id);
  await assert.rejects(readAttachment(root, "asset-1", metas[1].id), (e: AttachmentError) => e.status === 404);
});

test("bloqueia path traversal e ids inválidos", async () => {
  const root = tmp();
  await assert.rejects(saveAttachments(root, "../fora", [png]), AttachmentError);
  await assert.rejects(readAttachment(root, "asset-1", "../../state.json"), AttachmentError);
  await assert.rejects(readAttachment(root, "asset-1", "x.exe"), AttachmentError);
  await assert.rejects(deleteAttachment(root, "a/b", "x.png"), AttachmentError);
});

test("limite de quantidade e arquivo vazio", async () => {
  const root = tmp();
  await assert.rejects(saveAttachments(root, "a", [png], MAX_ATTACHMENTS_PER_ASSET), /Máximo/);
  await assert.rejects(saveAttachments(root, "a", [{ ...png, data: "" }]), /vazio/);
  await assert.rejects(saveAttachments(root, "a", []), /Nenhum/);
});

test("loadForClaude devolve os arquivos no formato de upload e ignora os que sumiram", async () => {
  const root = tmp();
  const metas = await saveAttachments(root, "a", [png, txt]);
  const files = await loadForClaude(root, "a", [...metas, { ...metas[0], id: "00000000-0000-0000-0000-000000000000.png" }]);
  assert.equal(files.length, 2);
  assert.equal(files[0].kind, "image");
  assert.equal(Buffer.from(files[0].data, "base64").toString(), "PNGDATA");
  assert.equal(files[1].data, "Anel 18k, 4,2 g");
});

test("coleta de lixo apaga bens removidos e arquivos órfãos — mas não uploads recentes", async () => {
  const root = tmp();
  const keep = await saveAttachments(root, "fica", [png, pdf]);
  await saveAttachments(root, "sai", [png]);
  const assets = [{ id: "fica", attachments: [keep[0]] }];

  await collectGarbage(root, assets); // tudo recém-criado: nada é apagado ainda
  assert.equal(fs.readdirSync(path.join(root, "fica")).length, 2);
  assert.ok(fs.existsSync(path.join(root, "sai")));

  await collectGarbage(root, assets, 10 * 60_000, Date.now() + 11 * 60_000);
  assert.ok(!fs.existsSync(path.join(root, "sai")));
  assert.deepEqual(fs.readdirSync(path.join(root, "fica")), [keep[0].id]);
  await collectGarbage(path.join(root, "nao-existe"), []);
});
