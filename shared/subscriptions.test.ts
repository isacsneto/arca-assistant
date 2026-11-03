import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSubscriptions, subKeywords, subSuggestions, subsMonthly, subsOf, type Subscription } from "./subscriptions";
import type { BankTx } from "./cashflow";

const TODAY = "2026-11-03";
const sub = (o: Partial<Subscription>): Subscription => ({ id: o.service ?? "s", service: "Serviço", status: "ativa", currency: "BRL", amount: null, ...o });
const charge = (date: string, description: string, amount: number, o: Partial<BankTx> = {}): BankTx & { category: string } => ({
  id: `${date}-${description}-${amount}`, itemId: "i", accountId: "card", accountName: "VISA GOLD", accountType: "CREDIT", institution: "Banco X", owner: "PF",
  date, description, amount: -amount, currency: "BRL", pluggyCategory: null, category: "assinaturas", ...o,
});
const monthly = (description: string, amount: number, months = ["2026-08", "2026-09", "2026-10"]) => months.map((m) => charge(`${m}-12`, description, amount));

test("palavras-chave: serviço conhecido pelo apelido da fatura; outro pelo próprio nome", () => {
  assert.deepEqual(subKeywords({ service: "iCloud", keywords: null }).slice(0, 1), ["apple com bill"]);
  assert.deepEqual(subKeywords({ service: "Linkedln Premium", keywords: null }), ["linkedin"], "aceita o erro de digitação comum");
  assert.deepEqual(subKeywords({ service: "Sócio Clube Atlético", keywords: null }), ["clube atletico"]);
  assert.deepEqual(subKeywords({ service: "X", keywords: ["minha loja"] }), ["minha loja"]);
});

test("acha a cobrança na fatura e confere o valor; parada que ainda cobra vira alerta", () => {
  const subs = [sub({ service: "Netflix", amount: 59.9 }), sub({ service: "Disney Plus", status: "inativa" }), sub({ service: "Spotify", amount: 21.9 })];
  const m = matchSubscriptions(subs, [...monthly("NETFLIX.COM", 59.9), ...monthly("Disney Plus", 29.9), ...monthly("SPOTIFY", 23.9)], TODAY);
  assert.deepEqual([m.Netflix.flag, m.Netflix.cadence, m.Netflix.charges.length], ["ok", "mensal", 3]);
  assert.equal(m["Disney Plus"].flag, "cobrada-mas-parada");
  assert.deepEqual([m.Spotify.flag, m.Spotify.last!.amount], ["valor-diferente", 23.9]);
});

test("dividida: a fatura mostra o total, a lista a sua parte; compras avulsas na mesma loja ficam de fora", () => {
  const txs = [...monthly("Google YouTubePremium", 53.9), charge("2026-10-20", "Google YouTube Member", 4.99)];
  const m = matchSubscriptions([sub({ service: "Youtube Premium", amount: 10.78 })], txs, TODAY)["Youtube Premium"];
  assert.deepEqual([m.flag, m.split, m.charges.length], ["dividida", 5, 3]);
});

test("mesma descrição (Apple) para duas assinaturas: separa pelo valor", () => {
  const txs = [...monthly("APPLE.COM/BILL", 19.9), ...monthly("APPLE.COM/BILL", 9.99)];
  const m = matchSubscriptions([sub({ service: "iCloud", amount: 19.9 }), sub({ service: "Apple Music", amount: 9.99 })], txs, TODAY);
  assert.ok(m.iCloud.charges.every((c) => c.amount === 19.9) && m.iCloud.charges.length === 3);
  assert.ok(m["Apple Music"].charges.every((c) => c.amount === 9.99) && m["Apple Music"].charges.length === 3);
});

test("não achou, ou é pago hoje por outro meio: manual, como está", () => {
  const m = matchSubscriptions([sub({ service: "ChatGPT", amount: 20, currency: "USD", payment: "Wise" }), sub({ service: "Claude", amount: 550, payment: "Conta PJ" })],
    [charge("2026-07-03", "ANTHROPIC* CLAUDE SUB", 586.47)], TODAY);
  assert.equal(m.ChatGPT.flag, "nao-encontrada");
  assert.equal(m.Claude.flag, "outro-meio");
});

test("sugestões: recorrente de assinatura fora da lista", () => {
  const txs = [...monthly("NETFLIX.COM", 59.9), ...monthly("STREAMING NOVO", 15)];
  const subs = [sub({ service: "Netflix", amount: 59.9 })];
  const s = subSuggestions(subs, matchSubscriptions(subs, txs, TODAY), txs, TODAY);
  assert.deepEqual(s.map((x) => x.label), ["STREAMING NOVO"]);
});

test("total por mês: parada não entra, paga adiantado entra (como na planilha), dólar convertido", () => {
  const t = subsMonthly([sub({ amount: 50 }), sub({ amount: 20, status: "anual" }), sub({ amount: 99, status: "inativa" }), sub({ amount: 10, currency: "USD" })], 5);
  assert.deepEqual([t.brl, t.usd, t.total, t.count], [70, 10, 120, 3]);
  assert.equal(subsOf([{ id: "a", service: " X ", status: "??", currency: "EUR" }])[0].status, "ativa");
});
