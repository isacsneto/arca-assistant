import { test } from "node:test";
import assert from "node:assert/strict";
import { securoClient, type Query } from "./securo";
import { PluggyError } from "./pluggy";
import { toImport } from "../shared/openFinance";

/** Banco falso: responde pela tabela citada no SQL e guarda os parâmetros. */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const query = (async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (/from assets/.test(sql)) return tables.assets ?? [];
    if (/from accounts/.test(sql)) return tables.accounts ?? [];
    return tables.bank_connections ?? [];
  }) as Query;
  return { query, calls };
}

const conn = { external_id: "item-btg", institution_name: "MeuPluggy", display_name: null, status: "active", last_sync_at: new Date("2026-11-01T09:00:00Z") };

test("conexões do Securo viram itens da Pluggy (status traduzido)", async () => {
  const { query } = fakeDb({ bank_connections: [conn, { ...conn, external_id: "item-x", status: "error", display_name: "BTG PJ" }] });
  const items = await securoClient(query).listItems();
  assert.deepEqual(items, [
    { id: "item-btg", status: "UPDATED", lastUpdatedAt: "2026-11-01T09:00:00.000Z", connector: { name: "MeuPluggy" } },
    { id: "item-x", status: "LOGIN_ERROR", lastUpdatedAt: "2026-11-01T09:00:00.000Z", connector: { name: "BTG PJ" } },
  ]);
});

test("investimentos: payload original da Pluggy remontado com o último valor sincronizado", async () => {
  const { query, calls } = fakeDb({
    assets: [{
      external_id: "inv-1", name: "PETROBRAS PN", currency: "BRL", units: "100.000000", isin: "BRPETRACNPR6", maturity_date: null,
      last_price: "36.50", amount: "3650.00", institution: "BTG Pactual",
      external_metadata: { name: "PETROBRAS PN", code: "PETR4", type: "EQUITY", subtype: "STOCK", status: "ACTIVE" },
    }, {
      external_id: "inv-2", name: "CDB BTG", currency: "BRL", units: null, isin: null, maturity_date: new Date("2031-10-09T00:00:00Z"),
      last_price: null, amount: "50401.10", institution: null,
      external_metadata: { type: "FIXED_INCOME", subtype: "CDB", rate: 103, rateType: "CDI" },
    }],
  });
  const inv = await securoClient(query).investments("item-btg");
  assert.equal(calls[0].params![0], "item-btg");
  assert.deepEqual(inv[0], { name: "PETROBRAS PN", code: "PETR4", type: "EQUITY", subtype: "STOCK", status: "ACTIVE", id: "inv-1", balance: 3650, quantity: 100, currencyCode: "BRL", dueDate: null, isin: "BRPETRACNPR6", value: 36.5 });
  assert.deepEqual([inv[1].balance, inv[1].dueDate, inv[1].rate, inv[1].quantity], [50401.1, "2031-10-09", 103, null]);

  // O resto do Arca entende como se viesse da Pluggy: ticker e classe certos.
  const r = toImport([{ connection: { itemId: "item-btg", owner: "PF", institution: "BTG Pactual" }, item: null, investments: inv, accounts: [] }], [], { includeAccounts: false });
  assert.deepEqual(r.items.map((i) => [i.ticker ?? null, i.assetClass, i.value]), [["PETR4", "acoes", 3650], [null, "caixa", 50401.1]]);
});

test("contas: tipo do Securo volta ao formato da Pluggy (poupança, corrente, cartão)", async () => {
  const { query } = fakeDb({
    accounts: [
      { external_id: "a1", name: "Conta", display_name: null, type: "checking", balance: "1200.50", currency: "BRL" },
      { external_id: "a2", name: "Poupança", display_name: "Minha poupança", type: "savings", balance: "300", currency: "BRL" },
      { external_id: "a3", name: "Cartão", display_name: null, type: "credit_card", balance: "-900", currency: "BRL" },
    ],
  });
  const acc = await securoClient(query).accounts("item-btg");
  assert.deepEqual(acc.map((a) => [a.type, a.subtype, a.name, a.balance]), [
    ["BANK", "CHECKING_ACCOUNT", "Conta", 1200.5],
    ["BANK", "SAVINGS_ACCOUNT", "Minha poupança", 300],
    ["CREDIT", "CREDIT_CARD", "Cartão", -900],
  ]);
});

test("Securo fora do ar ou conexão inexistente: erros claros; conectar banco é no Securo", async () => {
  const down = securoClient((async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:55432");
  }) as Query);
  await assert.rejects(down.check(), (e: PluggyError) => e.status === 503 && /Securo/.test(e.message));
  const { query } = fakeDb({ bank_connections: [] });
  await assert.rejects(securoClient(query).getItem("nada"), (e: PluggyError) => e.status === 404);
  await assert.rejects(securoClient(query).connectToken(), (e: PluggyError) => e.status === 400 && /localhost:3000/.test(e.message));
});
