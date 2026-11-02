import { test } from "node:test";
import assert from "node:assert/strict";
import { chatContext, chatPrompt } from "./chat";
import { withDefaults } from "./store";

test("contexto do chat: posições, alocação e seções extras; conversa só com as últimas mensagens", () => {
  const state = withDefaults({
    positions: [
      { id: "a", name: "Petrobras", ticker: "PETR4", institution: "BTG Pactual", owner: "PF", assetClass: "acoes", subtype: "Ação", currency: "BRL", value: 1000, quantity: 25, updatedAt: "2026-11-01T00:00:00Z", source: "" },
      { id: "b", name: "Fundo X", institution: "BTG Pactual", owner: "PJ", assetClass: "caixa", subtype: "Fundo", currency: "BRL", value: 3000, updatedAt: "2026-11-01T00:00:00Z", source: "", aiEstimate: true },
    ],
  });
  const ctx = chatContext(state, ["METAS:\n- Aposentadoria"]);
  assert.match(ctx, /PATRIMÔNIO INVESTIDO: R\$\s?4\.000 em 2 posições/);
  assert.match(ctx, /PETR4 · Petrobras .* qtd 25/);
  assert.match(ctx, /Fundo X .* \(estimado pela IA\)/);
  assert.match(ctx, /ALOCAÇÃO/);
  assert.match(ctx, /METAS:/);
  assert.ok(ctx.indexOf("Fundo X") < ctx.indexOf("PETR4"), "maiores primeiro");
  const msgs = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `m${i}` }));
  const p = chatPrompt("ctx", msgs);
  assert.ok(!p.includes("USUÁRIO: m0\n") && p.includes("m19"), "só as 12 últimas");
});
