import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, mapPool, type Deps } from "./app";
import { AiError as ClaudeError } from "./ai";
import type { AiStatus, ProviderId } from "../shared/ai";

const readyStatus = (o: Partial<AiStatus["claude"]> = {}): AiStatus => ({
  claude: { installed: true, loggedIn: true, account: "Claude Max", hasKey: false, ...o },
  codex: { installed: true, loggedIn: true, account: "ChatGPT", hasKey: false },
  cursor: { installed: false, loggedIn: null, hasKey: false },
});
import { withDefaults } from "./store";
import type { AssetEstimate } from "../shared/assets";
import type { AppState, ArcaClass, JobEvent, ProjectionResult, RefreshResult, ScanEvent, ScanResult } from "../shared/types";

function memStore(initial: Partial<AppState> = {}) {
  let saved: AppState | null = null;
  return {
    load: () => withDefaults(initial),
    save: (s: AppState) => void (saved = structuredClone(s)),
    get saved() {
      return saved;
    },
  };
}

const fakeScan = (c: ArcaClass): ScanResult => ({
  assetClass: c, runAt: "2026-10-09T00:00:00Z", model: "m", effort: "low", searches: 1,
  summary: "s", macroContext: "m", dataAsOf: "hoje", picks: [], avoid: [], portfolioNotes: "", sources: [],
});

async function withServer(
  deps: Partial<Deps>,
  fn: (base: string, store: ReturnType<typeof memStore>) => Promise<void>,
  initial: Partial<AppState> = {},
) {
  const store = memStore(initial);
  const app = createApp({
    store,
    distDir: "__nao_existe__",
    aiStatus: async () => readyStatus(),
    setApiKey: () => undefined,
    extractFromFiles: async () => ({ items: [], files: [], questions: [], warnings: [] }),
    scanClass: async (c) => fakeScan(c),
    refineImport: async () => ({ items: [], files: [], questions: [], warnings: [] }),
    interpretPrompt: async () => ({ operations: [], questions: [], warnings: [] }),
    estimateAsset: async () => {
      throw new Error("não usado");
    },
    refreshValues: async () => ({ runAt: "", usdBrl: null, lines: [] }),
    projectPortfolio: async () => {
      throw new Error("não usado");
    },
    attachmentsDir: fs.mkdtempSync(path.join(os.tmpdir(), "arca-app-att-")),
    ...deps,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, store);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function parseSse<E = ScanEvent>(text: string): E[] {
  return text
    .split("\n\n")
    .map((c) => c.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)));
}

test("GET /api/config reflete o login local", async () => {
  await withServer({ aiStatus: async () => readyStatus({ loggedIn: false }) }, async (base) => {
    const c = await (await fetch(`${base}/api/config`)).json();
    assert.equal(c.hasCredentials, false);
    assert.ok(c.models.length >= 3);
  });
});

test("PUT /api/state valida e persiste, sem deixar o cliente sobrescrever scans", async () => {
  await withServer({}, async (base, store) => {
    const bad = await fetch(`${base}/api/state`, { ...json({ positions: "x" }), method: "PUT" });
    assert.equal(bad.status, 400);

    const state = await (await fetch(`${base}/api/state`)).json();
    const body = { ...state, positions: [{ id: "1" }], scans: { acoes: "hack" } };
    const ok = await fetch(`${base}/api/state`, { ...json(body), method: "PUT" });
    assert.equal(ok.status, 200);
    assert.deepEqual(store.saved!.positions, [{ id: "1" }]);
    assert.deepEqual(store.saved!.scans, {});
  });
});

test("JSON malformado responde 400, não 500", async () => {
  await withServer({}, async (base) => {
    const r = await fetch(`${base}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(r.status, 400);
  });
});

test("POST /api/import: sem arquivos é 400; repassa modelo/esforço dos ajustes", async () => {
  let seen: unknown[] = [];
  await withServer(
    {
      extractFromFiles: async (files, ai) => {
        seen = [files.length, ai.model, ai.effort];
        return { items: [], files: [], questions: [], warnings: ["ok"] };
      },
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/import`, json({ files: [] }))).status, 400);
      const r = await fetch(`${base}/api/import`, json({ files: [{ name: "a.csv", kind: "text", data: "x" }] }));
      assert.deepEqual(await r.json(), { items: [], files: [], questions: [], warnings: ["ok"] });
      assert.deepEqual(seen, [1, "claude-sonnet-5-5", "medium"]);
    },
  );
});

test("POST /api/import preserva o status do erro (ex.: limite de uso = 429)", async () => {
  await withServer(
    { extractFromFiles: async () => { throw new ClaudeError("Limite de uso", 429); } },
    async (base) => {
      const r = await fetch(`${base}/api/import`, json({ files: [{ name: "a", kind: "text", data: "x" }] }));
      assert.equal(r.status, 429);
      assert.equal((await r.json()).error, "Limite de uso");
    },
  );
});

test("POST /api/scan: transmite eventos, salva resultados e isola falhas por classe", async () => {
  await withServer(
    {
      scanClass: async (c, _s, emit) => {
        emit({ type: "search", assetClass: c, query: `busca ${c}` });
        if (c === "fiis") throw new Error("falhou fiis");
        return fakeScan(c);
      },
    },
    async (base, store) => {
      assert.equal((await fetch(`${base}/api/scan`, json({ classes: ["xpto"] }))).status, 400);

      const r = await fetch(`${base}/api/scan`, json({ classes: ["acoes", "fiis", "acoes", "nope"] }));
      assert.match(r.headers.get("content-type") ?? "", /text\/event-stream/);
      const events = parseSse(await r.text());

      assert.equal(events.at(-1)!.type, "done");
      assert.equal(events.filter((e) => e.type === "search").length, 2, "classe duplicada roda uma vez só");
      assert.deepEqual(events.filter((e) => e.type === "result").map((e) => (e as { assetClass: string }).assetClass), ["acoes"]);
      const err = events.find((e) => e.type === "error") as { message: string };
      assert.equal(err.message, "falhou fiis");
      assert.deepEqual(Object.keys(store.saved!.scans), ["acoes"]);

      const state = await (await fetch(`${base}/api/state`)).json();
      assert.equal(state.scans.acoes.summary, "s");
    },
  );
});

test("GET /api/fx devolve a cotação ou 502", async () => {
  await withServer({ fetchFx: async () => 5.43 }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/fx`)).json(), { usdBrl: 5.43 });
  });
  await withServer({ fetchFx: async () => { throw new Error("offline"); } }, async (base) => {
    assert.equal((await fetch(`${base}/api/fx`)).status, 502);
  });
});

test("mapPool respeita o limite de concorrência e processa tudo", async () => {
  let active = 0;
  let peak = 0;
  const done: number[] = [];
  await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    done.push(n);
    active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5]);
});

const onePosition: Partial<AppState> = {
  positions: [{ id: "p1", name: "PETR4", institution: "XP", owner: "PF", assetClass: "acoes", subtype: "", currency: "BRL", value: 10, updatedAt: "", source: "" }],
};

test("POST /api/refresh exige carteira, transmite progresso e NÃO altera o estado", async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/api/refresh`, json({}))).status, 400);
  });

  const result: RefreshResult = { runAt: "agora", usdBrl: 5.1, lines: [] };
  await withServer(
    {
      refreshValues: async (state, emit) => {
        assert.equal(state.positions.length, 1);
        emit({ type: "status", text: "Buscando cotações" });
        return result;
      },
    },
    async (base, store) => {
      const events = parseSse<JobEvent<RefreshResult>>(await (await fetch(`${base}/api/refresh`, json({}))).text());
      assert.deepEqual(events.map((e) => e.type), ["status", "result", "done"]);
      assert.deepEqual((events[1] as { result: RefreshResult }).result, result);
      assert.equal(store.saved, null, "só propõe; quem aplica é o cliente");
    },
    onePosition,
  );
});

test("POST /api/projection salva o resultado no estado; erro vira evento", async () => {
  const projection = { summary: "ok", runAt: "x" } as ProjectionResult;
  await withServer(
    { projectPortfolio: async () => projection },
    async (base, store) => {
      const events = parseSse<JobEvent<ProjectionResult>>(await (await fetch(`${base}/api/projection`, json({}))).text());
      assert.deepEqual(events.map((e) => e.type), ["result", "done"]);
      assert.equal(store.saved!.projection!.summary, "ok");
      const state = await (await fetch(`${base}/api/state`)).json();
      assert.equal(state.projection.summary, "ok");
    },
    onePosition,
  );

  await withServer(
    {
      projectPortfolio: async () => {
        throw new ClaudeError("Limite de uso", 429);
      },
    },
    async (base, store) => {
      const events = parseSse<JobEvent<ProjectionResult>>(await (await fetch(`${base}/api/projection`, json({}))).text());
      assert.deepEqual(events.map((e) => e.type), ["error", "done"]);
      assert.equal(store.saved, null);
    },
    onePosition,
  );
});

test("PUT /api/state não apaga a projeção salva pelo servidor", async () => {
  await withServer(
    {},
    async (base, store) => {
      const state = await (await fetch(`${base}/api/state`)).json();
      await fetch(`${base}/api/state`, { ...json({ ...state, projection: undefined }), method: "PUT" });
      assert.equal(store.saved!.projection!.summary, "mantida");
    },
    { ...onePosition, projection: { summary: "mantida" } as ProjectionResult },
  );
});

test("POST /api/import/refine valida o pedido e repassa respostas ao Claude", async () => {
  let got: unknown = null;
  await withServer(
    {
      refineImport: async (req, ai) => {
        got = [req.answers[0].answer, ai.model];
        return { items: [], files: [], questions: [], warnings: ["revisado"] };
      },
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/import/refine`, json({ items: [], files: [], answers: [] }))).status, 400);
      const r = await fetch(`${base}/api/import/refine`, json({ items: [], files: [], answers: [{ questionId: "q1", question: "?", answer: "Renda fixa", itemIndexes: [0] }] }));
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).warnings, ["revisado"]);
      assert.deepEqual(got, ["Renda fixa", "claude-sonnet-5-5"]);
    },
  );
});

test("POST /api/import/prompt valida o texto e envia a carteira atual + respostas", async () => {
  let got: unknown = null;
  await withServer(
    {
      interpretPrompt: async (req, positions) => {
        got = [req.text, req.answers, positions.length];
        return { operations: [], questions: [], warnings: ["ok"] };
      },
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/import/prompt`, json({ text: "  " }))).status, 400);
      assert.equal((await fetch(`${base}/api/import/prompt`, json({ text: "x".repeat(4001) }))).status, 400);
      const r = await fetch(`${base}/api/import/prompt`, json({
        text: " 17000.30 adicionados à caixinha cdb do inter pj ",
        answers: [{ question: "Qual?", answer: "A do Inter" }, { question: "vazia", answer: " " }],
      }));
      assert.equal(r.status, 200);
      assert.deepEqual(got, ["17000.30 adicionados à caixinha cdb do inter pj", [{ question: "Qual?", answer: "A do Inter" }], 1]);
    },
    onePosition,
  );
});

test("POST /api/import/prompt aceita só anexos, limita a 10 e repassa os arquivos", async () => {
  let got: unknown = null;
  await withServer(
    {
      interpretPrompt: async (req) => {
        got = [req.text, req.files?.map((f) => f.name)];
        return { operations: [], questions: [], warnings: [] };
      },
    },
    async (base) => {
      const file = (name: string) => ({ name, kind: "image", mediaType: "image/png", data: "AAAA" });
      assert.equal((await fetch(`${base}/api/import/prompt`, json({ text: "", files: [] }))).status, 400);
      assert.equal((await fetch(`${base}/api/import/prompt`, json({ text: "x", files: Array.from({ length: 11 }, (_, i) => file(i + ".png")) }))).status, 400);
      const r = await fetch(`${base}/api/import/prompt`, json({ text: "", files: [file("comprovante-inter-pj.png"), { bad: true }] }));
      assert.equal(r.status, 200);
      assert.deepEqual(got, ["", ["comprovante-inter-pj.png"]]);
    },
    onePosition,
  );
});

test("PUT /api/state salva os bens; cliente sem o campo não apaga os existentes", async () => {
  const car = { id: "c1", type: "carro", name: "Tiggo 8", value: 150000, owner: "PF", updatedAt: "2026-10-10" };
  await withServer({}, async (base, store) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(state.assets, []);

    await fetch(`${base}/api/state`, { ...json({ ...state, assets: [car, { bad: 1 }] }), method: "PUT" });
    assert.deepEqual(store.saved!.assets.map((a) => a.name), ["Tiggo 8"]);

    const { assets: _drop, ...withoutAssets } = state;
    await fetch(`${base}/api/state`, { ...json(withoutAssets), method: "PUT" });
    assert.equal(store.saved!.assets.length, 1, "PUT sem 'assets' mantém os bens");
  });
});

test("POST /api/assets/estimate valida o bem, usa o modelo dos ajustes e transmite progresso", async () => {
  let got: unknown = null;
  const est: AssetEstimate = { estimate: 140000, low: 130000, high: 150000, newPrice: 190000, usedPrice: 145000, confidence: "media", assumptions: "", summary: "", comparables: [], at: "x", model: "m", searches: 2 };
  await withServer(
    {
      estimateAsset: async (asset, ai, emit) => {
        got = [asset.name, asset.type, ai.model];
        emit({ type: "search", query: "Tiggo 8 Max Drive 2024 FIPE" });
        return { ...est };
      },
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/assets/estimate`, json({ asset: { id: "1", name: "  " } }))).status, 400);
      const r = await fetch(`${base}/api/assets/estimate`, json({ asset: { id: "c1", type: "carro", name: "Tiggo 8 Max Drive 2024", value: 150000 } }));
      const events = parseSse<JobEvent<{ estimate: number }>>(await r.text());
      assert.deepEqual(events.map((e) => e.type), ["search", "result", "done"]);
      assert.equal((events[1] as { result: { estimate: number } }).result.estimate, 140000);
      assert.deepEqual(got, ["Tiggo 8 Max Drive 2024", "carro", "claude-sonnet-5-5"]);
    },
  );
});

test("anexos de bens: enviar, abrir, apagar; estimativa recebe os anexos salvos", async () => {
  const car = { id: "car1", type: "carro", name: "Tiggo 8", value: 150000, owner: "PF", updatedAt: "2026-10-10" };
  let filesSeen: string[] = [];
  await withServer(
    {
      estimateAsset: async (_asset, _setting, _emit, _signal, files = []) => {
        filesSeen = files.map((f) => f.name);
        return { estimate: 1, low: 1, high: 1, newPrice: null, usedPrice: null, confidence: "alta", assumptions: "", summary: "", comparables: [], at: "x", model: "m", searches: 0 };
      },
    },
    async (base) => {
      const png = { name: "crlv.png", kind: "image", mediaType: "image/png", data: Buffer.from("IMG").toString("base64") };
      assert.equal((await fetch(`${base}/api/assets/nao-existe/attachments`, json({ files: [png] }))).status, 404);

      const up = await fetch(`${base}/api/assets/car1/attachments`, json({ files: [png] }));
      assert.equal(up.status, 200);
      const { attachments } = await up.json();
      assert.equal(attachments[0].name, "crlv.png");

      const got = await fetch(`${base}/api/assets/car1/attachments/${attachments[0].id}`);
      assert.equal(got.headers.get("content-type"), "image/png");
      assert.equal(await got.text(), "IMG");
      assert.equal((await fetch(`${base}/api/assets/car1/attachments/..%2F..%2Fstate.json`)).status, 404);

      // cliente grava os metadados no bem; a estimativa usa os anexos do disco
      const state = await (await fetch(`${base}/api/state`)).json();
      state.assets[0].attachments = attachments;
      await fetch(`${base}/api/state`, { ...json(state), method: "PUT" });
      await (await fetch(`${base}/api/assets/estimate`, json({ asset: state.assets[0] }))).text();
      assert.deepEqual(filesSeen, ["crlv.png"]);

      assert.equal((await fetch(`${base}/api/assets/car1/attachments/${attachments[0].id}`, { method: "DELETE" })).status, 200);
      assert.equal((await fetch(`${base}/api/assets/car1/attachments/${attachments[0].id}`)).status, 404);
    },
    { assets: [car] } as Partial<AppState>,
  );
});

test("GET /api/config reflete o provedor escolhido; PUT /api/ai/key valida e nunca devolve a chave", async () => {
  const keys: Partial<Record<ProviderId, string | null>> = {};
  await withServer(
    {
      aiStatus: async () => ({ ...readyStatus(), codex: { installed: true, loggedIn: false, hasKey: Boolean(keys.codex) } }),
      setApiKey: (p, k) => void (keys[p] = k),
    },
    async (base) => {
      const c1 = await (await fetch(`${base}/api/config`)).json();
      assert.equal(c1.provider, "codex");
      assert.equal(c1.auth, "apiKey");
      assert.equal(c1.hasCredentials, false, "sem chave ainda");

      assert.equal((await fetch(`${base}/api/ai/key`, { ...json({ provider: "xpto", key: "sk-12345678" }), method: "PUT" })).status, 400);
      assert.equal((await fetch(`${base}/api/ai/key`, { ...json({ provider: "codex", key: "curta" }), method: "PUT" })).status, 400);
      assert.equal((await fetch(`${base}/api/ai/key`, { ...json({ provider: "codex", key: " sk-test-1234567890 " }), method: "PUT" })).status, 200);
      assert.equal(keys.codex, "sk-test-1234567890");

      const c2 = await (await fetch(`${base}/api/config`)).json();
      assert.equal(c2.hasCredentials, true);
      assert.ok(!JSON.stringify(c2).includes("sk-test"), "a chave nunca volta ao navegador");
      const st = await (await fetch(`${base}/api/state`)).json();
      assert.ok(!JSON.stringify(st).includes("sk-test"));

      await fetch(`${base}/api/ai/key`, { ...json({ provider: "codex", key: null }), method: "PUT" });
      assert.equal(keys.codex, null);
    },
    { settings: { ai: { provider: "codex", auth: "apiKey", models: { codex: { strong: "", fast: "" }, cursor: { strong: "", fast: "" } } } } } as Partial<AppState>,
  );
});

test("as tarefas recebem o provedor/modelo do Codex quando ele está escolhido", async () => {
  let seen: unknown = null;
  await withServer(
    {
      extractFromFiles: async (_files, ai) => {
        seen = ai;
        return { items: [], files: [], questions: [], warnings: [] };
      },
    },
    async (base) => {
      await fetch(`${base}/api/import`, json({ files: [{ name: "a.csv", kind: "text", data: "x" }] }));
      assert.deepEqual(seen, { task: "extraction", provider: "codex", auth: "local", model: "gpt-5.5", effort: "medium" });
    },
    { settings: { ai: { provider: "codex", auth: "local", models: { codex: { strong: "gpt-6-astra", fast: "gpt-5.5" }, cursor: { strong: "", fast: "" } } } } } as Partial<AppState>,
  );
});
