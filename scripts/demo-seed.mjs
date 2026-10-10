// Carteira 100% fictícia para demonstração (npm run demo). Nenhum dado real.
import { randomUUID } from "node:crypto";

const P = (o) => ({ id: randomUUID(), source: "demo", ...o });

export function buildDemoState(now = new Date()) {
  const iso = now.toISOString();
  const daysAgo = (d) => new Date(now.getTime() - d * 86_400_000).toISOString();

  const positions = [
    // ---------------- PF · BTG Pactual ----------------
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "caixa", name: "Tesouro Selic 2029", subtype: "Tesouro Selic", currency: "BRL", value: 48200, quantity: 2.9, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "caixa", name: "Tesouro IPCA+ 2035", subtype: "Tesouro IPCA+", currency: "BRL", value: 21500, quantity: 7.1, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "caixa", name: "CDB BTG 110% CDI 2028", subtype: "CDB 110% CDI", currency: "BRL", value: 30000, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "acoes", name: "Petrobras", ticker: "PETR4", subtype: "Ação", currency: "BRL", value: 16800, quantity: 300, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "acoes", name: "Itaú Unibanco", ticker: "ITUB4", subtype: "Ação", currency: "BRL", value: 15600, quantity: 400, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "acoes", name: "WEG", ticker: "WEGE3", subtype: "Ação", currency: "BRL", value: 7700, quantity: 150, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "acoes", name: "Banco do Brasil", ticker: "BBAS3", subtype: "Ação", currency: "BRL", value: 12300, quantity: 500, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "fiis", name: "CSHG Logística", ticker: "HGLG11", subtype: "FII de tijolo", currency: "BRL", value: 9450, quantity: 60, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "fiis", name: "Kinea Renda Imobiliária", ticker: "KNRI11", subtype: "FII de tijolo", currency: "BRL", value: 7400, quantity: 50, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "fiis", name: "Maxi Renda", ticker: "MXRF11", subtype: "FII de papel", currency: "BRL", value: 14200, quantity: 1500, updatedAt: daysAgo(20) }),
    P({ institution: "BTG Pactual", owner: "PF", assetClass: "internacional", name: "iShares S&P 500", ticker: "IVVB11", subtype: "ETF", currency: "BRL", value: 17600, quantity: 40, updatedAt: daysAgo(20) }),
    // ---------------- PF · outros ----------------
    P({ institution: "Nubank", owner: "PF", assetClass: "caixa", name: "Caixinha Reserva", subtype: "CDB 100% CDI", currency: "BRL", value: 12000, updatedAt: daysAgo(12) }),
    P({ institution: "Itaú", owner: "PF", assetClass: "caixa", name: "Conta corrente", subtype: "Conta corrente", currency: "BRL", value: 3200, updatedAt: daysAgo(5) }),
    P({ institution: "Itaú", owner: "PF", assetClass: "caixa", name: "LCI Itaú 95% CDI", subtype: "LCI 95% CDI", currency: "BRL", value: 20000, updatedAt: daysAgo(30) }),
    P({ institution: "Avenue", owner: "PF", assetClass: "internacional", name: "Vanguard S&P 500 ETF", ticker: "VOO", subtype: "ETF", currency: "USD", value: 3300, quantity: 5, updatedAt: daysAgo(15) }),
    P({ institution: "Avenue", owner: "PF", assetClass: "internacional", name: "Vanguard Total World Stock", ticker: "VT", subtype: "ETF", currency: "USD", value: 2600, quantity: 20, updatedAt: daysAgo(15) }),
    P({ institution: "Binance", owner: "PF", assetClass: "outros", name: "Bitcoin", subtype: "Cripto", currency: "BRL", value: 18500, quantity: 0.045, updatedAt: daysAgo(10) }),
    // ---------------- PJ ----------------
    P({ institution: "Banco Inter", owner: "PJ", assetClass: "caixa", name: "CDB Liquidez Diária", subtype: "CDB 100% CDI", currency: "BRL", value: 85000, updatedAt: daysAgo(18) }),
    P({ institution: "XP Investimentos", owner: "PJ", assetClass: "caixa", name: "Tesouro Selic 2031", subtype: "Tesouro Selic", currency: "BRL", value: 40000, updatedAt: daysAgo(18) }),
    P({ institution: "XP Investimentos", owner: "PJ", assetClass: "caixa", name: "Investo LFTB", ticker: "LFTB11", subtype: "ETF renda fixa (LFT)", currency: "BRL", value: 38700, quantity: 300, updatedAt: daysAgo(18) }),
  ];

  const T = (o) => ({ id: randomUUID(), source: "demo", importedAt: iso, ...o });
  const transactions = [
    T({ date: daysAgo(9).slice(0, 10), type: "dividendo", description: "Rendimento MXRF11", ticker: "MXRF11", institution: "BTG Pactual", owner: "PF", assetClass: "fiis", amount: 150, currency: "BRL" }),
    T({ date: daysAgo(14).slice(0, 10), type: "compra", description: "Compra de 50 WEGE3", ticker: "WEGE3", institution: "BTG Pactual", owner: "PF", assetClass: "acoes", amount: 2560, currency: "BRL" }),
    T({ date: daysAgo(21).slice(0, 10), type: "deposito", description: "Aporte mensal na Caixinha", institution: "Nubank", owner: "PF", assetClass: "caixa", amount: 2000, currency: "BRL" }),
    T({ date: daysAgo(18).slice(0, 10), type: "deposito", description: "Sobra de caixa da empresa", institution: "Banco Inter", owner: "PJ", assetClass: "caixa", amount: 15000, currency: "BRL" }),
  ];

  const A = (o) => ({ id: randomUUID(), updatedAt: iso, owner: "PF", ...o });
  const assets = [
    A({ type: "imovel", name: "Apartamento 68 m², 2 quartos, 1 vaga — Pinheiros, São Paulo", value: 850000, notes: "Prédio de 2015, reformado em 2023" }),
    A({ type: "carro", name: "Toyota Corolla XEi 2.0 Flex 2022/2022", value: 115000, notes: "45 mil km, único dono, revisões na concessionária" }),
    A({ type: "eletronicos", name: 'MacBook Air 13" M2 16GB/512GB (2023)', value: 7500, notes: "Bateria 91%, sem marcas" }),
    A({ type: "joias", name: "Corrente de ouro 18k", value: 6000, notes: "15 g, sem pedras, com nota fiscal" }),
  ];

  return {
    positions,
    transactions,
    assets,
    scans: {},
    settings: {
      usdBrl: 5.0,
      methodology: "arca",
      targets: { acoes: 25, fiis: 25, caixa: 25, internacional: 25 },
      investorProfile: "Investidor fictício de 35 anos, horizonte de 20+ anos, tolerância moderada a volatilidade, foco em renda passiva.",
      staleInstitutions: [{ institution: "Itaú", owner: "PF", markedAt: daysAgo(3) }],
      reviewIntervalDays: 14,
      lastReviewAt: daysAgo(1),
    },
  };
}
