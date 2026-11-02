import { test } from "node:test";
import assert from "node:assert/strict";
import { LEDGER_VERSION, needsAi, syncLedger, toBankTx } from "./ledger";
import { withDefaults } from "./store";
import { EMPTY_LEDGER } from "../shared/ledger";
import type { PluggyClient } from "./pluggy";
import type { PluggyTransaction } from "../shared/openFinance";

const ptx = (o: Partial<PluggyTransaction>): PluggyTransaction => ({ id: "t", description: "X", amount: 10, date: "2026-10-10T03:00:00.000Z", type: "DEBIT", ...o });

test("transação: compra no cartão (positiva na Pluggy) vira saída; parcela e pendente", () => {
  const acc = { id: "c", name: "Visa", type: "CREDIT" as const };
  const ctx = { itemId: "i", institution: "Itaú", owner: "PF" as const };
  const t = toBankTx(ptx({ amount: 214.95, status: "PENDING", creditCardMetadata: { installmentNumber: 2, totalInstallments: 18 } }), acc, ctx);
  assert.deepEqual([t.amount, t.date, t.pending, t.installment], [-214.95, "2026-10-10", true, { n: 2, total: 18 }]);
  assert.equal(toBankTx(ptx({ amount: -50, type: "DEBIT" }), { ...acc, type: "BANK" }, ctx).amount, -50);
  assert.equal(toBankTx(ptx({ amount: 1000, type: "CREDIT" }), { ...acc, type: "BANK" }, ctx).amount, 1000);
});

function fakeClient(calls: { from: string[] }): PluggyClient {
  return {
    check: async () => undefined,
    listItems: async () => [],
    getItem: async (id) => ({ id, connector: { name: "MeuPluggy" } }),
    accounts: async () => [
      { id: "bank", type: "BANK", name: "itau", balance: 10 },
      { id: "card", type: "CREDIT", name: "LATAM ITAU VISA", balance: 3000, creditData: { balanceDueDate: "2026-11-28" } },
    ],
    investments: async () => [{ id: "inv", name: "PETROBRAS PN", code: "PETR4", type: "EQUITY", subtype: "STOCK" }],
    transactions: async (accountId, from) => {
      calls.from.push(`${accountId}:${from}`);
      return accountId === "bank" ? [ptx({ id: `b-${from}`, date: "2026-10-25T03:00:00.000Z", amount: -100, description: "PIX ENVIADO JOAO", category: "Transfer - PIX" })] : [ptx({ id: "c1", amount: 50, category: "Groceries", creditCardMetadata: { billForecastDate: "2026-11" } })];
    },
    bills: async () => [{ id: "b1", dueDate: "2026-10-28T00:00:00.000Z", totalAmount: 1500 }],
    loans: async () => [],
    investmentTransactions: async () => [{ id: "it", type: "BUY", quantity: 10, value: 30, amount: 300, tradeDate: "2026-05-02T00:00:00.000Z" }],
    connectToken: async () => "tok",
  };
}

test("sincroniza contas, cartão (faturas + aberta), movimentações; depois é incremental e troca a janela", async () => {
  const state = withDefaults({ positions: [{ id: "p", name: "x", institution: "Itaú", owner: "PF", assetClass: "caixa", subtype: "", currency: "BRL", value: 1, updatedAt: "", source: "" }], settings: { openFinance: { connections: [{ itemId: "aaaaaaaaaa", owner: "PF" }] } } as never });
  const calls = { from: [] as string[] };
  const now = new Date("2026-11-01T15:00:00Z");
  const d1 = await syncLedger(fakeClient(calls), state, structuredClone(EMPTY_LEDGER), { now });
  assert.deepEqual(calls.from, ["bank:2025-09-01", "card:2025-09-01"], "primeira vez: ~13 meses");
  assert.equal(d1.bankTx.length, 2);
  assert.equal(d1.bankTx[0].institution, "Itaú", "banco deduzido pelas contas do MeuPluggy");
  assert.deepEqual(d1.bills.map((b) => [b.dueDate, b.total, !!b.open]), [["2026-10-28", 1500, false]], "só faturas fechadas: a aberta sai dos lançamentos (o saldo do cartão é o total devedor)");
  assert.equal(d1.bankTx.find((t) => t.accountId === "card")?.billMonth, "2026-11");
  assert.equal(d1.version, LEDGER_VERSION);
  assert.deepEqual(d1.investTx.map((t) => [t.ticker, t.type, t.quantity, t.price, t.date]), [["PETR4", "BUY", 10, 30, "2026-05-02"]]);
  assert.ok(d1.lastSlowSync);

  const d2 = await syncLedger(fakeClient(calls), state, d1, { now: new Date("2026-11-02T15:00:00Z") });
  assert.deepEqual(calls.from.slice(2), ["bank:2026-10-22", "card:2026-10-22"], "depois: desde a última, com 10 dias de folga");
  assert.deepEqual(d2.bankTx.filter((t) => t.accountId === "bank").map((t) => t.id), ["b-2026-10-22"], "janela trocada (pendente → lançada não duplica)");
  assert.equal(d2.investTx.length, 1, "movimentações só 1x por dia");
  // Formato antigo (sem a fatura de cada lançamento): refaz a busca do zero uma vez.
  calls.from = [];
  await syncLedger(fakeClient(calls), state, { ...d2, version: 1 }, { now: new Date("2026-11-02T15:00:00Z") });
  assert.deepEqual(calls.from, ["bank:2025-09-01", "card:2025-09-01"]);

  const todo = needsAi(d2, state);
  assert.deepEqual(todo.map((t) => t.desc), ["pix enviado joao"], "só o que nem regra nem banco resolvem");
});

test("falha passageira não apaga o que já estava guardado; categorias antigas da IA valem até serem refeitas", async () => {
  const state = withDefaults({ settings: { openFinance: { connections: [{ itemId: "aaaaaaaaaa", owner: "PF" }] } } as never });
  const ok = fakeClient({ from: [] });
  const d1 = await syncLedger(ok, state, structuredClone(EMPTY_LEDGER), { now: new Date("2026-11-01T15:00:00Z") });
  const broken: PluggyClient = {
    ...ok,
    bills: async () => { throw new Error("503"); },
    investmentTransactions: async () => { throw new Error("503"); },
  };
  const d2 = await syncLedger(broken, state, d1, { now: new Date("2026-11-02T15:00:00Z"), slow: true });
  assert.equal(d2.bills.length, 1, "faturas anteriores ficam");
  assert.equal(d2.investTx.length, 1, "movimentações anteriores ficam");
  assert.match(d2.error ?? "", /503/);
  assert.equal(d2.lastSlowSync, d1.lastSlowSync, "não marca como sincronizado");

  const desc = "pix enviado joao";
  const old = { ...d2, aiCategories: { [desc]: "transferencia" }, aiCatVersion: {} };
  assert.deepEqual(needsAi(old, state).map((t) => t.desc), [desc], "decidida com instruções antigas: refaz");
  assert.equal(old.aiCategories[desc], "transferencia", "…mas continua valendo até a nova chegar");
  assert.deepEqual(needsAi({ ...old, aiCatVersion: { [desc]: 99 } }, state), []);
});
