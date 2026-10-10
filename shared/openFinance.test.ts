import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInvestment, institutionName, openFinanceSettings, tickerOf, toImport, type ConnectionData, type PluggyInvestment } from "./openFinance";

const inv = (o: Partial<PluggyInvestment>): PluggyInvestment => ({ id: "x", name: "Investimento", balance: 1000, ...o });

test("classifica os tipos da Pluggy nas classes da Arca", () => {
  const cases: [Partial<PluggyInvestment>, string, string][] = [
    [{ type: "FIXED_INCOME", subtype: "CDB", rateType: "CDI", rate: 110 }, "caixa", "CDB 110% CDI"],
    [{ type: "FIXED_INCOME", subtype: "TREASURY", rateType: "IPCA", fixedAnnualRate: 6.2 }, "caixa", "Tesouro Direto IPCA + 6,2%"],
    [{ type: "FIXED_INCOME", subtype: "LCI" }, "caixa", "LCI"],
    [{ type: "EQUITY", subtype: "STOCK", code: "PETR4" }, "acoes", "Ação"],
    [{ type: "EQUITY", subtype: "REAL_ESTATE_FUND", code: "HGLG11" }, "fiis", "FII"],
    [{ type: "EQUITY", subtype: "BDR", code: "AAPL34" }, "internacional", "BDR"],
    [{ type: "ETF", code: "IVVB11" }, "internacional", "ETF"],
    [{ type: "ETF", code: "LFTB11" }, "caixa", "ETF"],
    [{ type: "ETF", code: "HASH11" }, "outros", "ETF"],
    [{ type: "MUTUAL_FUND", subtype: "FIXED_INCOME_FUND" }, "caixa", "Fundo de renda fixa"],
    [{ type: "MUTUAL_FUND", subtype: "MULTIMARKET_FUND" }, "outros", "Fundo multimercado"],
    [{ type: "SECURITY", subtype: "VGBL" }, "outros", "Previdência VGBL"],
    [{ type: "COE", subtype: "STRUCTURED_NOTE" }, "outros", "COE"],
  ];
  for (const [o, cls, sub] of cases) {
    const c = classifyInvestment(inv(o));
    assert.equal(c.assetClass, cls, JSON.stringify(o));
    assert.equal(c.subtype, sub, JSON.stringify(o));
  }
});

test("fundo genérico usa o nome e deixa a confiança mais baixa", () => {
  const di = classifyInvestment(inv({ type: "MUTUAL_FUND", subtype: "INVESTMENT_FUND", name: "Itaú Privilège Referenciado DI" }));
  assert.equal(di.assetClass, "caixa");
  assert.equal(di.confidence, "media");
  assert.equal(classifyInvestment(inv({ type: "MUTUAL_FUND", subtype: "INVESTMENT_FUND", name: "BTG Pactual Crédito Corporativo FIC FIRF CP" })).assetClass, "caixa");
  const unknown = classifyInvestment(inv({ type: "MUTUAL_FUND", subtype: "INVESTMENT_FUND", name: "Fundo XPTO" }));
  assert.equal(unknown.assetClass, "outros");
  assert.equal(unknown.confidence, "baixa");
  const etf = classifyInvestment(inv({ type: "ETF", code: "BOVA11", name: "iShares Ibovespa" }));
  assert.equal(etf.assetClass, "acoes");
  assert.equal(etf.confidence, "media");
});

test("ticker só para códigos de negociação", () => {
  assert.equal(tickerOf("petr4"), "PETR4");
  assert.equal(tickerOf("HGLG11"), "HGLG11");
  assert.equal(tickerOf("12.345.678/0001-90"), null);
  assert.equal(tickerOf(null), null);
});

test("reaproveita o nome de instituição já usado na carteira", () => {
  const known = ["BTG Pactual", "Itaú", "Banco Inter"];
  const item = (name: string) => ({ id: "i", connector: { name } });
  assert.equal(institutionName({ itemId: "i", owner: "PF" }, item("Banco BTG Pactual"), known), "BTG Pactual");
  assert.equal(institutionName({ itemId: "i", owner: "PF" }, item("Itaú Unibanco"), known), "Itaú");
  assert.equal(institutionName({ itemId: "i", owner: "PJ" }, item("Inter Empresas"), known), "Banco Inter");
  assert.equal(institutionName({ itemId: "i", owner: "PF" }, item("Nu Pagamentos"), []), "Nubank");
  assert.equal(institutionName({ itemId: "i", owner: "PF", institution: "Meu BTG" }, item("BTG"), known), "Meu BTG");
  assert.equal(institutionName({ itemId: "i", owner: "PF" }, null, known), "Open Finance");
});

test("converte conexões em itens de importação, com avisos e sem itens zerados", () => {
  const data: ConnectionData[] = [
    {
      connection: { itemId: "a", owner: "PF" },
      item: { id: "a", status: "UPDATED", connector: { name: "Banco BTG Pactual" }, lastUpdatedAt: "2026-10-09T03:00:00Z" },
      investments: [
        inv({ name: "CDB BTG", type: "FIXED_INCOME", subtype: "CDB", balance: 30000.456, amount: 31000 }),
        inv({ name: "Petrobras", type: "EQUITY", subtype: "STOCK", code: "PETR4", balance: 16800, quantity: 300 }),
        inv({ name: "Resgatado", type: "FIXED_INCOME", subtype: "LCI", balance: 0, status: "TOTAL_WITHDRAWAL" }),
      ],
      accounts: [
        { id: "c", type: "BANK", subtype: "CHECKING_ACCOUNT", balance: 1200, currencyCode: "BRL" },
        { id: "d", type: "CREDIT", subtype: "CREDIT_CARD", balance: 5000 },
      ],
    },
    { connection: { itemId: "b", owner: "PJ", institution: "Inter" }, item: null, investments: [], accounts: [], error: "Conexão não encontrada na Pluggy." },
    { connection: { itemId: "c", owner: "PF" }, item: { id: "c", status: "LOGIN_ERROR", connector: { name: "Nubank" } }, investments: [], accounts: [] },
  ];
  const r = toImport(data, [{ institution: "BTG Pactual" }], { includeAccounts: true });
  assert.deepEqual(r.items.map((i) => [i.name, i.institution, i.owner, i.assetClass, i.value]), [
    ["CDB BTG", "BTG Pactual", "PF", "caixa", 30000.46],
    ["Petrobras", "BTG Pactual", "PF", "acoes", 16800],
    ["Conta corrente", "BTG Pactual", "PF", "caixa", 1200],
  ]);
  assert.equal(r.items[1].ticker, "PETR4");
  assert.equal(r.items[1].quantity, 300);
  assert.equal(r.files.length, 2);
  assert.match(r.files[0].summary, /3 itens · R\$ 48\.000,46/);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /Inter \(PJ\): Conexão não encontrada/);
  assert.match(r.warnings[1], /LOGIN_ERROR/);

  const noAccounts = toImport(data.slice(0, 1), [], { includeAccounts: false });
  assert.equal(noAccounts.items.length, 2);
});

test("ajustes do Open Finance são normalizados", () => {
  assert.deepEqual(openFinanceSettings(undefined), { connections: [], includeAccounts: true, lastSyncAt: null });
  const s = openFinanceSettings({ connections: [{ itemId: " abc ", owner: "PJ", institution: "  " }, { itemId: "", owner: "PF" }] as never, includeAccounts: false });
  assert.deepEqual(s.connections, [{ itemId: "abc", owner: "PJ" }]);
  assert.equal(s.includeAccounts, false);
});
