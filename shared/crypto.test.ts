import { test } from "node:test";
import assert from "node:assert/strict";
import { isCrypto } from "./crypto";
import { classRows, computeAllocation, effectiveClass, rebalance, withClassRules } from "./arca";
import { DEFAULT_TARGETS, type Position } from "./types";

const p = (o: Partial<Position>): Position => ({
  id: Math.random().toString(36).slice(2), name: "X", institution: "XP", owner: "PF", assetClass: "outros", subtype: "",
  currency: "BRL", value: 100, updatedAt: "", source: "", ...o,
});

test("isCrypto reconhece moedas, ETFs de cripto e o subtipo 'Cripto'", () => {
  assert.ok(isCrypto({ name: "Bitcoin", subtype: "Cripto" }));
  assert.ok(isCrypto({ name: "Ethereum", subtype: "" }));
  assert.ok(isCrypto({ name: "Saldo", subtype: "Criptomoeda", ticker: null }));
  assert.ok(isCrypto({ name: "Hashdex Nasdaq Crypto Index", subtype: "ETF", ticker: "HASH11" }));
  assert.ok(isCrypto({ name: "iShares Bitcoin Trust", subtype: "ETF", ticker: "IBIT" }));
  assert.ok(isCrypto({ name: "Solana", subtype: "", ticker: "SOL-USD" }));
  assert.ok(!isCrypto({ name: "Ouro", subtype: "Ouro", ticker: null }));
  assert.ok(!isCrypto({ name: "Fundo Multimercado Verde", subtype: "Multimercado" }));
  assert.ok(!isCrypto({ name: "Petrobras", subtype: "Ação", ticker: "PETR4" }));
});

test("cripto como Internacional: só muda a classe de cripto em 'Fora da Arca', e só com o ajuste ligado", () => {
  const btc = p({ name: "Bitcoin", subtype: "Cripto" });
  const gold = p({ name: "Ouro", subtype: "Ouro" });
  const hashInStocks = p({ name: "Hashdex", ticker: "HASH11", assetClass: "acoes" });
  assert.equal(effectiveClass(btc, { cryptoAsInternational: false }), "outros");
  assert.equal(effectiveClass(btc, { cryptoAsInternational: true }), "internacional");
  assert.equal(effectiveClass(gold, { cryptoAsInternational: true }), "outros");
  assert.equal(effectiveClass(hashInStocks, { cryptoAsInternational: true }), "acoes", "classe escolhida pelo usuário é respeitada");

  const list = [btc, gold];
  assert.equal(withClassRules(list, { cryptoAsInternational: false }), list, "desligado: mesmo array");
  const ruled = withClassRules(list, { cryptoAsInternational: true });
  assert.deepEqual(ruled.map((x) => x.assetClass), ["internacional", "outros"]);
  assert.equal(btc.assetClass, "outros", "não altera a posição original");
});

test("ligado, a cripto entra na base Arca, na alocação e no rebalanceamento", () => {
  const fx = { USD: 5 };
  const positions = [
    p({ assetClass: "acoes", value: 300 }),
    p({ assetClass: "fiis", value: 300 }),
    p({ assetClass: "caixa", value: 300 }),
    p({ assetClass: "internacional", value: 100 }),
    p({ name: "Bitcoin", subtype: "Cripto", value: 200 }),
  ];
  const off = computeAllocation(withClassRules(positions, { cryptoAsInternational: false }), fx);
  assert.equal(off.arcaTotal, 1000);
  assert.equal(off.outrosTotal, 200);

  const on = computeAllocation(withClassRules(positions, { cryptoAsInternational: true }), fx);
  assert.equal(on.arcaTotal, 1200);
  assert.equal(on.outrosTotal, 0);
  assert.equal(on.byClass.internacional, 300);
  assert.equal(on.grandTotal, off.grandTotal, "o patrimônio total não muda");
  assert.equal(classRows(on, DEFAULT_TARGETS).find((r) => r.assetClass === "internacional")!.currentPct, 25);
  const buyIntl = (alloc: typeof on) => rebalance(alloc, DEFAULT_TARGETS, 400, false).find((l) => l.assetClass === "internacional")!.trade;
  assert.ok(buyIntl(on) < buyIntl(off), "com a cripto contando, o internacional precisa de menos aporte");
});
