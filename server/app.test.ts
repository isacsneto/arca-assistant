import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, mapPool, type Deps } from "./app";
import { ClaudeError } from "./claude";
import { withDefaults } from "./store";
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
    authStatus: async () => ({ loggedIn: true, account: "Claude Max" }),
    extractFromFiles: async () => ({ items: [], warnings: [] }),
    scanClass: async (c) => fakeScan(c),
    refreshValues: async () => ({ runAt: "", usdBrl: null, lines: [] }),
    projectPortfolio: async () => {
      throw new Error("não usado");
    },
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
  await withServer({ authStatus: async () => ({ loggedIn: false }) }, async (base) => {
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
      extractFromFiles: async (files, model, effort) => {
        seen = [files.length, model, effort];
        return { items: [], warnings: ["ok"] };
      },
    },
    async (base) => {
      assert.equal((await fetch(`${base}/api/import`, json({ files: [] }))).status, 400);
      const r = await fetch(`${base}/api/import`, json({ files: [{ name: "a.csv", kind: "text", data: "x" }] }));
      assert.deepEqual(await r.json(), { items: [], warnings: ["ok"] });
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
  positions: [{ id: "p1", name: "PETR4", institution: "XP", assetClass: "acoes", subtype: "", currency: "BRL", value: 10, updatedAt: "", source: "" }],
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
