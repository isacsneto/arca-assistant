import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchConnections, filePluggyCredentials, pluggyClient, PluggyError } from "./pluggy";
import { fileSecrets } from "./ai/secrets";

const CREDS = { clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "segredo-de-teste" };

/** fetch falso: responde por rota e guarda as chamadas. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.replace("https://api.pluggy.ai", "").startsWith(k));
    const r = key ? routes[key](init) : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

test("autentica uma vez, reaproveita a apiKey e pagina os investimentos", async () => {
  let auths = 0;
  const { impl, calls } = fakeFetch({
    "/auth": (init) => {
      auths += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), CREDS);
      return { body: { apiKey: "key-1" } };
    },
    "/investments?itemId=abcdef0123&page=1": () => ({ body: { results: [{ id: "1", name: "A" }], totalPages: 2 } }),
    "/investments?itemId=abcdef0123&page=2": () => ({ body: { results: [{ id: "2", name: "B" }], totalPages: 2 } }),
  });
  const client = pluggyClient(() => CREDS, impl);
  const list = await client.investments("abcdef0123");
  assert.deepEqual(list.map((i) => i.id), ["1", "2"]);
  assert.equal(auths, 1);
  const headers = calls.at(-1)!.init!.headers as Record<string, string>;
  assert.equal(headers["X-API-KEY"], "key-1");
});

test("apiKey expirada: autentica de novo e repete a chamada", async () => {
  let n = 0;
  let gets = 0;
  const { impl } = fakeFetch({
    "/auth": () => ({ body: { apiKey: `key-${(n += 1)}` } }),
    "/items/abcdef0123": (init) => {
      gets += 1;
      const key = (init?.headers as Record<string, string>)["X-API-KEY"];
      return key === "key-1" ? { status: 403 } : { body: { id: "abcdef0123", status: "UPDATED" } };
    },
  });
  const item = await pluggyClient(() => CREDS, impl).getItem("abcdef0123");
  assert.equal(item.status, "UPDATED");
  assert.equal(n, 2);
  assert.equal(gets, 2);
});

test("credenciais recusadas, ausentes ou itemId inválido viram erros claros", async () => {
  const { impl } = fakeFetch({ "/auth": () => ({ status: 401 }) });
  await assert.rejects(pluggyClient(() => CREDS, impl).check(), (e: PluggyError) => e.status === 401 && /recusou/.test(e.message));
  await assert.rejects(pluggyClient(() => null, impl).check(), (e: PluggyError) => e.status === 400 && /Ajustes/.test(e.message));
  await assert.rejects(pluggyClient(() => CREDS, impl).investments("../../auth"), (e: PluggyError) => e.status === 400);
});

test("listar conexões é opcional: sem permissão devolve lista vazia", async () => {
  const { impl } = fakeFetch({ "/auth": () => ({ body: { apiKey: "k" } }), "/items": () => ({ status: 405 }) });
  assert.deepEqual(await pluggyClient(() => CREDS, impl).listItems(), []);
});

test("uma conexão com erro não derruba as outras", async () => {
  const { impl } = fakeFetch({
    "/auth": () => ({ body: { apiKey: "k" } }),
    "/items/aaaaaaaaaa": () => ({ body: { id: "aaaaaaaaaa", connector: { name: "BTG" } } }),
    "/investments?itemId=aaaaaaaaaa": () => ({ body: { results: [{ id: "1", name: "CDB" }], totalPages: 1 } }),
    "/accounts?itemId=aaaaaaaaaa": () => ({ body: { results: [], totalPages: 1 } }),
  });
  const data = await fetchConnections(pluggyClient(() => CREDS, impl), [
    { itemId: "aaaaaaaaaa", owner: "PF" },
    { itemId: "bbbbbbbbbb", owner: "PJ" },
  ], { includeAccounts: true });
  assert.equal(data[0].investments.length, 1);
  assert.equal(data[0].item?.connector?.name, "BTG");
  assert.match(data[1].error ?? "", /não encontrada/);
});

test("credenciais ficam no arquivo de segredos sem apagar as chaves de IA", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arca-pluggy-")), "secrets.json");
  const ai = fileSecrets(file, {});
  ai.set("claude", "sk-ant-teste-123456");
  const store = filePluggyCredentials(file, {});
  assert.equal(store.get(), null);
  store.set(CREDS);
  assert.deepEqual(store.get(), CREDS);
  ai.set("codex", "sk-codex-teste-123");
  assert.deepEqual(store.get(), CREDS, "salvar chave de IA preserva a Pluggy");
  assert.equal(ai.get("claude"), "sk-ant-teste-123456", "salvar a Pluggy preservou a chave de IA");
  store.set(null);
  assert.equal(store.get(), null);
  assert.equal(ai.get("claude"), "sk-ant-teste-123456");
  assert.deepEqual(filePluggyCredentials(file, { PLUGGY_CLIENT_ID: "x".repeat(36), PLUGGY_CLIENT_SECRET: "y".repeat(10) }).get(), {
    clientId: "x".repeat(36), clientSecret: "y".repeat(10),
  });
});
