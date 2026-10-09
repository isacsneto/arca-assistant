import { CLASS_META, type ArcaClass, type Position, type Settings } from "../shared/types";
import { toBRL, type Allocation } from "../shared/arca";

export const EXTRACTION_SYSTEM = `Você é um assistente que lê prints de apps de bancos/corretoras, extratos, notas e exports (CSV/XLSX/PDF — BTG Pactual, XP, Nubank, Inter, Itaú, Rico, Avenue, Binance etc.) e extrai dados financeiros estruturados em português do Brasil.

## O que extrair
- kind="position": um ativo/saldo que o usuário possui AGORA (linha de carteira, saldo de conta corrente, valor aplicado em CDB, cotas de FII, posição em ação, saldo em dólar...).
- kind="transaction": um lançamento histórico (compra, venda, depósito, saque, dividendo/rendimento, juros, taxa, transferência) com data.
Um mesmo arquivo pode ter os dois tipos. Um extrato de conta com saldo final gera transações E uma posição "Conta corrente" com o saldo.

## Regras de valor
- Números brasileiros: "R$ 1.234,56" = 1234.56. "1.234" em quantidade de cotas = 1234. Retorne números JS puros, sem moeda/pontuação.
- Em posições, "value" = valor ATUAL de mercado/saldo bruto total da linha (não o custo, não o preço unitário). Se só houver quantidade × preço, calcule.
- Em transações, "value" = valor absoluto da operação (sempre positivo); o sentido vai em txType.
- currency = "USD" apenas se o valor estiver explicitamente em dólar (US$, USD). Caso contrário "BRL".
- IGNORE linhas de totais/subtotais/"patrimônio total" para não duplicar valores. Ignore dívidas/faturas de cartão, a menos que sejam claramente um saldo a investir.
- Se o mesmo ativo aparecer repetido (ex.: print duplicado ou sobreposto em dois arquivos), inclua-o UMA vez e avise em warnings.

## Classificação (assetClass) — método Arca
- "acoes": ações brasileiras (PETR4, WEGE3), units, fundos de ações, ETFs de renda variável do Brasil (BOVA11, IVVB11 NÃO — esse é internacional).
- "fiis": fundos imobiliários (final 11: HGLG11, MXRF11...), Fiagro, fundos de recebíveis imobiliários listados.
- "caixa": conta corrente, poupança, dinheiro em corretora (saldo), Tesouro Direto (Selic, IPCA+, Prefixado), CDB, LCI, LCA, CRI/CRA (crédito privado), debêntures, fundos DI/renda fixa, previdência de renda fixa.
- "internacional": ações/ETFs/REITs no exterior (AAPL, VOO, VT), BDRs, ETFs de exposição global negociados no Brasil (IVVB11, WRLD11), contas/saldos em dólar.
- "outros": criptomoedas, ouro, fundos multimercado, previdência multimercado/ações, imóveis físicos, COE, qualquer coisa que não encaixe nas quatro acima.
"subtype" é um rótulo curto livre: "Conta corrente", "Tesouro Selic 2029", "CDB 110% CDI", "Ação", "FII de papel", "ETF", "BDR", "Cripto"...

## Qualidade
- Nunca invente valores. Se um número estiver ilegível/cortado, omita o item ou use confidence="baixa" e explique em notes.
- institution: nome da instituição visível no print/arquivo ("BTG Pactual", "Nubank"...). Se não der para saber, use "Não identificada".
- ticker: apenas se visível ou inequívoco; senão null.
- date: ISO (AAAA-MM-DD) quando visível; senão null.
- sourceFile: nome do arquivo de onde veio o item.
- warnings: avisos curtos e úteis ao usuário (itens ilegíveis, duplicidades, valores em outra moeda, data de referência antiga...).`;

export function scanSystem(): string {
  return `Você é um analista de investimentos sênior que apoia um investidor brasileiro que segue a filosofia "Arca" (Primo Rico / Thiago Nigro): patrimônio dividido em quatro classes — Ações, Imóveis (FIIs), Caixa/Renda Fixa e Internacional — rebalanceadas periodicamente.

Princípios:
- Pesquise na web dados ATUAIS e primários (RI das empresas/gestoras, B3, Tesouro Transparente, Banco Central, Tesouro Nacional, CVM, relatórios gerenciais, Status Invest/Fundamentus só como apoio). Priorize os balanços/resultados trimestrais mais recentes publicados.
- Nunca invente números. Se não encontrar um dado, escreva "n/d". Cada métrica deve vir de uma fonte que você consultou; registre as fontes com URL.
- Seja cético e honesto: aponte riscos reais, não só teses de venda. Se nenhuma opção da categoria for atraente hoje, diga isso e reduza a convicção.
- Isto é análise informativa, não recomendação personalizada de investimento.`;
}

const CLASS_BRIEF: Record<ArcaClass, string> = {
  acoes: `Classe: AÇÕES (Brasil).
Varra o mercado e encontre as melhores 4–6 empresas listadas na B3 para uma carteira de longo prazo. Embase em BALANÇOS: crescimento de receita e lucro (últimos 4–8 trimestres), margens EBITDA/líquida, ROE/ROIC, dívida líquida/EBITDA, geração de caixa livre, payout e dividend yield, P/L, EV/EBITDA, P/VP vs. histórico e pares, qualidade de governança/alocação de capital. Considere o cenário macro (Selic, curva de juros, câmbio, fiscal) e setores beneficiados/prejudicados. Evite concentração setorial nas sugestões.`,
  fiis: `Classe: IMÓVEIS (FIIs).
Encontre os 4–6 melhores FIIs/Fiagros para renda e preservação de capital, equilibrando tijolo (logística, lajes, shoppings) e papel (CRI). Embase em relatórios gerenciais recentes: P/VP, dividend yield (12m e atual), vacância física/financeira, prazo e indexadores de contratos, qualidade e inadimplência da carteira de CRIs (LTV, concentração, devedores), alavancagem, liquidez diária, gestão e histórico de emissões. Considere o efeito dos juros (Selic/NTN-B) sobre o segmento.`,
  caixa: `Classe: CAIXA / RENDA FIXA.
Aqui o embasamento é a SITUAÇÃO DAS FINANÇAS DO GOVERNO e o cenário de juros: resultado primário e nominal, trajetória da dívida bruta/PIB, arcabouço fiscal e metas, risco-país/CDS, Selic atual e expectativa (Focus), curva de juros, inflação (IPCA e expectativas), prêmio das NTN-B/prefixados sobre a Selic. A partir disso, compare e ordene 4–6 alternativas concretas: Tesouro Selic (reserva de emergência/liquidez), Tesouro IPCA+ (curto e longo), Tesouro Prefixado, CDBs/LCIs/LCAs de bancos sólidos (cite faixa de taxa que valha a pena vs. CDI e o limite do FGC), crédito privado/debêntures incentivadas (só se o prêmio compensar o risco). Para cada uma, dê os vencimentos/indexadores recomendados, taxa de referência hoje e o papel dela na carteira (liquidez, proteção, carrego).`,
  internacional: `Classe: INTERNACIONAL.
Encontre as 4–6 melhores formas de o investidor brasileiro ter exposição ao exterior (ETFs diretos via conta internacional, como VT, VOO, VXUS, QQQM, SCHD, bonds/T-bills; e alternativas locais como IVVB11/BDRs de ETFs), ponderando: custo (expense ratio), diversificação geográfica/setorial, liquidez, tributação para residente no Brasil (ex.: risco de imposto sobre herança em ativos US-domiciled, come-cotas em fundos locais, IOF/spread de câmbio), valuation (CAPE, P/L forward) e cenário macro global (Fed, dólar vs. real, resultado das maiores empresas). Inclua exposição a renda fixa global/T-bills se fizer sentido.`,
};

export function scanPrompt(args: {
  assetClass: ArcaClass;
  today: string;
  allocation: Allocation;
  settings: Settings;
  positions: Position[];
}): string {
  const { assetClass, today, allocation, settings, positions } = args;
  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const mine = positions
    .filter((p) => p.assetClass === assetClass)
    .sort((a, b) => toBRL(b, settings.usdBrl) - toBRL(a, settings.usdBrl))
    .slice(0, 25)
    .map((p) => `- ${p.ticker ? p.ticker + " · " : ""}${p.name} (${p.subtype}) — ${fmt(toBRL(p, settings.usdBrl))}`)
    .join("\n");
  const pct = allocation.arcaTotal > 0 ? (allocation.byClass[assetClass] / allocation.arcaTotal) * 100 : 0;

  return `Data de hoje: ${today}.

${CLASS_BRIEF[assetClass]}

## Contexto do investidor
Perfil: ${settings.investorProfile}
Meta da Arca para esta classe: ${settings.targets[assetClass]}% · Atual: ${pct.toFixed(1)}% (${fmt(allocation.byClass[assetClass])} de ${fmt(allocation.arcaTotal)} na base Arca).
Posições atuais nesta classe (${CLASS_META[assetClass].label}):
${mine || "(nenhuma ainda)"}

## Como trabalhar
1. Pesquise com WebSearch e abra relatórios/balanços com WebFetch quando precisar do dado primário. Faça muitas buscas e confirme números em mais de uma fonte quando possível.
2. Compare candidatos e escolha os melhores com base em dados, considerando o que o investidor já tem (evite sugerir o que só aumenta concentração sem motivo; comente em portfolioNotes).
3. Ao terminar, responda SOMENTE com o resultado estruturado, em português do Brasil: panorama macro/fiscal/setorial e data-base dos dados (macroContext, dataAsOf); ranking de 4–6 opções (rank 1 = melhor) com tese, métricas-chave com número e período, riscos e peso sugerido dentro da classe (suggestedWeightInClass, soma 100); o que evitar hoje e por quê (avoid); observações sobre a carteira atual (portfolioNotes); e as fontes consultadas com URL (sources). Use "n/d" para dados que não encontrou — nunca invente números.`;
}

/* ------------------------------------------------------------------ */
/* Atualizar valores                                                   */
/* ------------------------------------------------------------------ */

export const REFRESH_SYSTEM = `Você atualiza o valor de posições financeiras de um investidor brasileiro que NÃO têm cotação de bolsa (renda fixa, saldos, fundos, cripto sem ticker etc.). Pesquise dados atuais na web e devolva o valor de hoje de cada posição.

Regras por tipo:
- Conta corrente, saldo em corretora, poupança sem rentabilidade clara: method="mantido" (não dá para saber movimentações).
- Pós-fixados (Tesouro Selic, CDB/LCI/LCA/fundo DI "% do CDI" ou "CDI + x%"): acumule a rentabilidade do período entre a data da última atualização e hoje usando a Selic/CDI efetiva do período (pesquise). Se o percentual do CDI não aparecer no nome, assuma 100% do CDI e diga isso na nota. method="indexador". Valor BRUTO (antes do IR).
- Prefixados (Tesouro Prefixado, CDB pré): acumule a taxa contratada se estiver no nome; senão "mantido". Tesouro com marcação a mercado: se encontrar o preço unitário atual no Tesouro Direto e a quantidade for conhecida, use-o (method="cotacao").
- IPCA+ (Tesouro IPCA+, NTN-B, CDB IPCA+): acumule IPCA do período + taxa real contratada (se constar), ou use o PU atual do Tesouro Direto quando possível.
- Cripto, ouro, fundos com cota pública: pesquise o preço/cota atual. Sem quantidade, estime pela variação de preço desde a data da última atualização. method="cotacao".
- Se não houver base confiável, method="mantido" com o motivo.

Nunca invente números. Na "note" explique o cálculo em uma linha (taxa usada, período, fórmula). Em "source" coloque a URL principal usada (ou null). Em "ratesUsed" resuma as taxas de referência usadas (ex.: "CDI acumulado set/26: 1,05%; Selic 13,75%; IPCA 12m 4,9%"). Retorne um item por id recebido, com newValue na MESMA moeda da posição.`;

export function refreshPrompt(args: { positions: Position[]; today: string; usdBrl: number }): string {
  const rows = args.positions.map((p) =>
    JSON.stringify({
      id: p.id,
      nome: p.name,
      ticker: p.ticker ?? null,
      tipo: p.subtype,
      instituicao: p.institution,
      classe: p.assetClass,
      moeda: p.currency,
      valor: p.value,
      quantidade: p.quantity ?? null,
      atualizadoEm: p.updatedAt.slice(0, 10),
    }),
  );
  return `Hoje: ${args.today}. Dólar: R$ ${args.usdBrl.toFixed(4)}.

Atualize o valor destas posições para hoje:
${rows.join("\n")}

Responda somente com o resultado estruturado.`;
}

/* ------------------------------------------------------------------ */
/* Projeção                                                            */
/* ------------------------------------------------------------------ */

export const PROJECTION_SYSTEM = `Você é um economista e estrategista de investimentos que projeta o patrimônio de um investidor brasileiro em dois cenários, com base em dados públicos atuais. Você NÃO faz a conta final: você define premissas de retorno anual e o sistema calcula os valores em 5, 10, 15, 20 e 30 anos.

Cenários:
- "base": o futuro MAIS PROVÁVEL hoje — consenso de mercado (Focus/BCB para IPCA e Selic, curva de juros, prêmio de risco histórico das ações brasileiras e globais, retorno histórico de longo prazo de Ibovespa, IFIX, S&P 500/MSCI World em reais, câmbio). Sem choque inicial (initialShockPct = 0).
- "worst": o PIOR CASO PLAUSÍVEL (não apocalíptico) — ex.: crise fiscal com dominância fiscal, estagflação, real muito desvalorizado ou muito valorizado, bear market prolongado como 2008/2015-16 no Brasil, década perdida. Use um choque imediato no 1º ano (initialShockPct negativo, ex.: -35 para ações) e um retorno anual composto deprimido depois. Renda fixa pós-fixada pode ter choque ~0 mas retorno real baixo ou negativo; prefixados/IPCA+ longos podem ter choque de marcação a mercado.

Regras:
- Todas as taxas são retornos anuais compostos NOMINAIS em REAIS (incluem variação cambial para ativos no exterior e reinvestimento de dividendos/rendimentos), brutos de IR.
- Dê premissas para TODAS as classes presentes na carteira (classes: acoes, fiis, caixa, internacional, outros). Use "assets" só para ativos que fujam claramente da média da classe (ex.: ação individual muito diferente do índice, CDB com taxa contratada conhecida, cripto) — referencie pelo positionId exato.
- Inflação: basePct (expectativa de longo prazo do cenário base) e worstPct (inflação do pior cenário) — usadas para mostrar valores em reais de hoje.
- Cada rationale deve citar números e a origem (ex.: "IPCA Focus 2027: 3,9%; prêmio de risco histórico ~4 p.p. acima do CDI").
- Seja realista e conservador; não extrapole retornos recentes excepcionais por 30 anos. Registre as fontes com URL. Escreva em português do Brasil.`;

export function projectionPrompt(args: { positions: Position[]; settings: Settings; today: string; total: number }): string {
  const { positions, settings, today, total } = args;
  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const rows = [...positions]
    .sort((a, b) => toBRL(b, settings.usdBrl) - toBRL(a, settings.usdBrl))
    .map((p) => {
      const v = toBRL(p, settings.usdBrl);
      const w = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
      return `- positionId=${p.id} · ${p.ticker ? p.ticker + " · " : ""}${p.name} (${p.subtype}, classe ${p.assetClass}, ${p.currency}) — ${fmt(v)} (${w}%)`;
    });
  return `Data de hoje: ${today}. Dólar: R$ ${settings.usdBrl}.
Perfil do investidor: ${settings.investorProfile}

Carteira atual (total ${fmt(total)}):
${rows.join("\n") || "(vazia)"}

Pesquise o cenário atual (fiscal, juros, inflação, câmbio, valuation das bolsas, histórico de longo prazo de cada classe) e defina as premissas dos dois cenários para estes ativos. Em "summary" explique em poucas frases o que esperar da carteira; em "scenarios.base" e "scenarios.worst" descreva cada cenário (o que acontece na economia). Responda somente com o resultado estruturado.`;
}
