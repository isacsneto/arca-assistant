import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backfillHistory, historyStore, withHistory } from "./history";
import { withDefaults } from "./store";
import { parseTesouroCsv } from "./tesouro";
import type { Position } from "../shared/types";

const p = (o: Partial<Position>): Position => ({
  id: "x", name: "X", institution: "BTG Pactual", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL",
  value: 100, updatedAt: "2026-11-01T12:00:00Z", source: "", ...o,
});

test("cada gravação da carteira tira a foto do dia; estimadas só preenchem dias vazios", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arca-hist-"));
  const h = historyStore(path.join(dir, "history.json"));
  let saved = 0;
  const store = withHistory({ load: () => withDefaults({}), save: () => void (saved += 1) }, h);
  store.save(withDefaults({ positions: [p({ value: 500 })] }));
  assert.equal(saved, 1);
  const today = h.get().snapshots;
  assert.equal(today.length, 1);
  assert.equal(today[0].total, 500);
  h.addEstimated([{ ...today[0], date: "2026-01-01", total: 1, estimated: true }, { ...today[0], total: 999, estimated: true }]);
  assert.deepEqual(h.get().snapshots.map((s) => [s.total, !!s.estimated]), [[1, true], [500, false]], "não sobrescreve foto real");
  const again = historyStore(path.join(dir, "history.json"));
  assert.equal(again.get().snapshots.length, 2, "persistido em disco");
});

test("reconstrução: cotação × quantidade de hoje, PU do Tesouro e CDI desfeito; resto constante", async () => {
  const ts = (d: string) => Date.parse(`${d}T13:00:00Z`) / 1000;
  const state = withDefaults({
    positions: [
      p({ id: "petr", ticker: "PETR4", assetClass: "acoes", quantity: 10, value: 400 }),
      p({ id: "renda", name: "Tesouro Renda+ 2084", subtype: "Tesouro Renda+ · venc. 15/12/2084", quantity: 2, value: 340 }),
      p({ id: "cdb", name: "CDB", subtype: "CDB 100% CDI", value: 1001 }),
      p({ id: "cc", name: "Conta corrente", subtype: "Conta corrente", value: 50 }),
    ],
  });
  const fetchQuote = async (s: string) =>
    s === "PETR4.SA" ? { symbol: s, price: 40, currency: "BRL", history: [{ t: ts("2026-10-29"), close: 30 }, { t: ts("2026-10-30"), close: 40 }] } : null;
  const tesouro = parseTesouroCsv("h\nTesouro Renda+ Aposentadoria Extra;15/12/2084;29/10/2026;0;0;0;200,00;200,00\nTesouro Renda+ Aposentadoria Extra;15/12/2084;30/10/2026;0;0;0;170,00;170,00");
  const series = { cdi: [{ d: "2026-10-30", r: 0.001 }], ipca: new Map(), ipca12m: null, tr: new Map() };
  const snaps = await backfillHistory(state, { fetchQuote, tesouro, series, today: "2026-11-01" }, 3);
  assert.deepEqual(snaps.map((s) => s.date), ["2026-10-29", "2026-10-30", "2026-10-31"]);
  const d29 = snaps[0];
  assert.ok(d29.estimated);
  // 10 × 30 + 2 × 200 + 1001/1,001 + 50
  assert.ok(Math.abs(d29.total - (300 + 400 + 1000 + 50)) < 0.01, String(d29.total));
  assert.ok(Math.abs(snaps[2].total - (400 + 340 + 1001 + 50)) < 0.01, String(snaps[2].total));
});
