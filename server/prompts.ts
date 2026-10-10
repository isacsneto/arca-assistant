import { CLASS_META, type ArcaClass, type Position, type Settings } from "../shared/types";
import { CURRENCIES, CURRENCY_CODES, FX_CODES, rate, type FxRates } from "../shared/currency";
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
- currency = código da moeda em que o valor está (${CURRENCY_CODES.map((c) => `"${c}" (${CURRENCIES[c].symbol})`).join(", ")}). Use outra que não "BRL" só se o valor estiver explicitamente nela (ex.: US$, USD). Caso contrário "BRL".
- IGNORE linhas de totais/subtotais/"patrimônio total" para não duplicar valores. Ignore dívidas/faturas de cartão, a menos que sejam claramente um saldo a investir.
- Se o mesmo ativo aparecer repetido (print duplicado ou sobreposto), inclua-o UMA vez (veja "Duplicados entre arquivos").

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
- sourceFile: nome EXATO do arquivo original de onde veio o item.
- owner: "PF" ou "PJ" quando o documento deixar claro (CNPJ, razão social "Ltda"/"S.A."/"ME", "conta empresa"); senão null.
- warnings: avisos curtos e úteis ao usuário (itens ilegíveis, valores em outra moeda, data de referência antiga...).

## Nomes dos arquivos (preencha "files", um por arquivo)
O usuário nomeia os arquivos como <instituição>-<pf|pj>[-<dica do produto>]. Exemplos: "vest-pf" = corretora Vest, pessoa física; "itau-pf-cdb100cdi" = Itaú, pessoa física, CDB 100% do CDI; "xp_pj_lci95" = XP, pessoa jurídica, LCI 95% do CDI. Cada arquivo vem com uma leitura automática do nome — confirme ou corrija com o seu entendimento:
- institution: nome correto e completo da instituição (ex.: "itau" → "Itaú", "bb" → "Banco do Brasil"). Se o nome do arquivo não indicar, use o que o conteúdo mostrar; se nada indicar, null.
- owner: PF/PJ do nome do arquivo; se não houver, o que o conteúdo indicar; senão null. Se o nome disser PF mas o conteúdo mostrar claramente CNPJ/empresa (ou o contrário), NÃO escolha sozinho: faça uma pergunta.
- productHint: a dica do nome traduzida para algo legível (ex.: "cdb100cdi" → "CDB 100% do CDI"); use-a para completar subtype/nome dos itens desse arquivo quando o conteúdo não mostrar a taxa. null se não houver dica ou se o resto do nome não for sobre o produto (versões como "v2", "copia", "final", datas, números de print).
- summary: uma linha dizendo o que o arquivo mostra (ex.: "Carteira de renda fixa com 3 CDBs e saldo em conta").
- Todos os itens de um arquivo herdam a instituição e o titular desse arquivo.

## Duplicados entre arquivos
Compare o conteúdo dos arquivos entre si. Se dois arquivos mostram a mesma tela/lista (mesmos ativos com os mesmos valores — prints repetidos, recortes sobrepostos, a mesma tela rolada com partes repetidas), em "files" marque duplicateOf no repetido com o nome do outro arquivo e extraia cada ativo UMA vez só. Partes repetidas entre prints sobrepostos também contam uma vez. Ativos iguais em instituições ou titulares diferentes NÃO são duplicados.

## Perguntas (preencha "questions" só quando realmente necessário)
Se não der para classificar um item com segurança, pergunte em vez de chutar. Exemplos de quando perguntar:
- produto sem tipo claro (fundo de nome genérico: renda fixa, multimercado ou ações? previdência: PGBL/VGBL de renda fixa ou multimercado? COE?);
- ETF/fundo cuja exposição não dá para saber (Brasil ou exterior? renda fixa ou ações?);
- titular desconhecido ou conflitante quando houver arquivos de PF e PJ no mesmo lote;
- instituição não identificável;
- dica do nome do arquivo ambígua.
NÃO pergunte o que está claro no documento ou no nome do arquivo. Máximo de 6 perguntas; agrupe itens parecidos numa pergunta só. Cada pergunta: id curto ("q1"…), texto objetivo citando o ativo, itemIndexes (posições em "items", começando em 0) e 2–4 opções curtas de resposta (ex.: "Renda fixa (Caixa)", "Multimercado (Fora da Arca)"). Enquanto isso, preencha o item com o seu melhor palpite e confidence="baixa".`;

export const REFINE_SYSTEM = `Você revisa uma importação de investimentos já extraída, aplicando as respostas que o usuário deu às suas perguntas de classificação.
Regras:
- Aplique cada resposta aos itens indicados (e a outros itens claramente iguais): ajuste assetClass, subtype, name, owner, institution conforme a resposta. Mantenha valores, quantidades, datas e tickers como estão, a menos que a resposta diga o contrário.
- Itens que a resposta resolve passam a confidence="alta".
- Não remova itens, a não ser que o usuário peça explicitamente (ex.: "é duplicado", "ignore"). Não invente itens novos.
- Mantenha a mesma ordem dos itens e o mesmo "files" (atualize institution/owner/productHint se a resposta mudar).
- Use as mesmas regras de classificação Arca: acoes, fiis, caixa (renda fixa e saldos), internacional, outros (cripto, ouro, multimercado, COE, previdência não-RF).
- "questions": vazio, a menos que uma resposta tenha criado uma dúvida nova e importante (no máximo 2).
- "warnings": só o que ainda merece atenção.`;

export function refinePrompt(args: { items: unknown[]; files: unknown[]; answers: { question: string; answer: string; itemIndexes: number[] }[] }): string {
  return `Itens extraídos (o índice é a posição na lista, começando em 0):
${JSON.stringify(args.items.map((it, i) => ({ i, ...(it as object) })))}

Leitura dos arquivos:
${JSON.stringify(args.files)}

Respostas do usuário:
${args.answers.map((a) => `- Pergunta: ${a.question} (itens ${a.itemIndexes.join(", ")})\n  Resposta: ${a.answer}`).join("\n")}

Devolva a importação revisada no resultado estruturado.`;
}

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
    .sort((a, b) => toBRL(b, settings.fx) - toBRL(a, settings.fx))
    .slice(0, 25)
    .map((p) => `- ${p.ticker ? p.ticker + " · " : ""}${p.name} (${p.subtype}) — ${fmt(toBRL(p, settings.fx))}`)
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

/** "Dólar americano (USD): R$ 5,4200" — uma linha por moeda do registro. */
export function fxLine(fx: FxRates): string {
  return FX_CODES.map((c) => `${c}: R$ ${rate(fx, c).toFixed(4)}`).join(" · ");
}

export function refreshPrompt(args: { positions: Position[]; today: string; fx: FxRates }): string {
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
  return `Hoje: ${args.today}. Câmbio: ${fxLine(args.fx)}.

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
    .sort((a, b) => toBRL(b, settings.fx) - toBRL(a, settings.fx))
    .map((p) => {
      const v = toBRL(p, settings.fx);
      const w = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
      return `- positionId=${p.id} · ${p.ticker ? p.ticker + " · " : ""}${p.name} (${p.subtype}, classe ${p.assetClass}, ${p.currency}) — ${fmt(v)} (${w}%)`;
    });
  return `Data de hoje: ${today}. Câmbio: ${fxLine(settings.fx)}.
Perfil do investidor: ${settings.investorProfile}

Carteira atual (total ${fmt(total)}):
${rows.join("\n") || "(vazia)"}

Pesquise o cenário atual (fiscal, juros, inflação, câmbio, valuation das bolsas, histórico de longo prazo de cada classe) e defina as premissas dos dois cenários para estes ativos. Em "summary" explique em poucas frases o que esperar da carteira; em "scenarios.base" e "scenarios.worst" descreva cada cenário (o que acontece na economia). Responda somente com o resultado estruturado.`;
}

/* ------------------------------------------------------------------ */
/* Import por texto                                                    */
/* ------------------------------------------------------------------ */

export const PROMPT_IMPORT_SYSTEM = `Você transforma frases em português sobre movimentações de investimentos em operações sobre a carteira do usuário. Exemplos de frases:
- "17000.30 adicionados à caixinha cdb do inter pj" → ajustar a posição de CDB do Banco Inter (titular PJ) com delta +17000.30 e registrar transação "deposito".
- "resgatei 5 mil do cdb do itaú" → ajustar com delta −5000 e transação "saque".
- "comprei 100 PETR4 a 38,50 no btg" → ajustar PETR4 do BTG com delta +3850, quantityDelta +100, transação "compra".
- "o saldo do nubank agora é 53.200" → definir value 53200 (sem transação, a menos que a frase diga um aporte/resgate).
- "abri uma LCI 95% CDI no itaú pf com 20 mil" → criar ativo novo (classe caixa) com value 20000 e transação "deposito".
- "vendi tudo de VALE3" → remover a posição (transação "venda" com o valor atual).

Regras:
- Valores brasileiros: "17.000,30", "17000.30", "17 mil", "R$ 1,5 mi". Retorne números puros. delta e value na MOEDA DA POSIÇÃO (se a posição é em USD e a frase em reais, pergunte ou converta e explique).
- Identifique a posição pela instituição, titular (pf/pj) e produto citados, usando a lista "Carteira atual". Use o positionId EXATO da lista.
- Titular: "pj", "empresa", "cnpj" = PJ; "pf", "pessoal" = PF. Se não disser e houver posições parecidas nos dois titulares, PERGUNTE.
- Se mais de uma posição combinar e não der para escolher com segurança, PERGUNTE listando as opções (nome + valor atual), em vez de chutar. Se nenhuma combinar, crie um ativo novo — mas se nem a classe/tipo do ativo novo estiver clara, pergunte.
- Datas: se a frase disser ("ontem", "dia 5"), use AAAA-MM-DD; senão null (o app usa hoje).
- explanation: uma linha clara do que será feito, citando valores (ex.: "Aporte de R$ 17.000,30 na Caixinha CDB do Banco Inter (PJ)").
- Uma frase pode gerar várias operações. Não invente operações que a frase não pede.
- questions: só quando necessário; cada uma com id ("q1"…), pergunta objetiva e 2–4 opções curtas. Enquanto houver pergunta sobre uma operação, NÃO inclua essa operação em "operations" (inclua só as que já estão claras).
- warnings: observações úteis (ex.: "o saldo informado é menor que o atual — confirme se foi um resgate").

Anexos (comprovantes, notas de corretagem, extratos, prints), quando houver:
- Leia TODOS com a ferramenta Read e use-os para identificar valores exatos, datas, ativos, quantidades, preços e a instituição/titular (CNPJ/razão social = PJ). O nome do arquivo pode seguir a convenção banco-pf/pj-dica.
- Se só houver anexos (sem texto, ou texto genérico como "veja o anexo"), deduza as movimentações a partir deles.
- Texto e anexo descrevendo a MESMA movimentação contam UMA vez. Se o anexo contradisser o texto (outro valor, outra instituição, outra data), PERGUNTE em vez de escolher.
- Um anexo que mostre o saldo/posição atual de um ativo (e não uma movimentação) vira "definir" com esse valor.
- Na explanation, cite o anexo de onde veio o dado quando ajudar (ex.: "conforme comprovante inter-pj.png").`;

export function promptImportPrompt(args: {
  text: string;
  today: string;
  positions: Position[];
  answers?: { question: string; answer: string }[];
  /** Trecho com os caminhos dos anexos a ler (vazio se não houver). */
  attachments?: string;
}): string {
  const rows = args.positions.map((p) =>
    JSON.stringify({
      positionId: p.id,
      instituicao: p.institution,
      titular: p.owner,
      nome: p.name,
      ticker: p.ticker ?? null,
      tipo: p.subtype,
      classe: p.assetClass,
      moeda: p.currency,
      valor: p.value,
      quantidade: p.quantity ?? null,
    }),
  );
  const qa = args.answers?.length
    ? `\n\nRespostas do usuário às suas perguntas anteriores:\n${args.answers.map((a) => `- ${a.question}\n  → ${a.answer}`).join("\n")}`
    : "";
  return `Hoje: ${args.today}.

Carteira atual (${rows.length} posições):
${rows.join("\n") || "(vazia)"}

Texto do usuário:
"""
${args.text || "(sem texto — use os anexos)"}
"""${args.attachments ? `\n\nAnexos enviados pelo usuário:${args.attachments}` : ""}${qa}

Responda somente com o resultado estruturado.`;
}

/* ------------------------------------------------------------------ */
/* Estimativa de valor de bens                                         */
/* ------------------------------------------------------------------ */

export const ASSET_ESTIMATE_SYSTEM = `Você avalia o valor de mercado de bens físicos de uma pessoa no Brasil, pesquisando anúncios e referências ATUAIS na web (com WebSearch e WebFetch). Responda em reais (BRL).

Como pesquisar, por tipo:
- Veículos: Tabela FIPE do modelo/versão/ano (fipe.org.br, sites que reproduzem a tabela), anúncios de usados do MESMO modelo, versão e ano (Webmotors, OLX, Mobiauto, iCarros, Kavak) e o preço do 0 km atual (site da montadora/concessionárias). Valor sugerido ≈ perto da FIPE e da mediana dos anúncios, descontando a margem de negociação típica (anúncio costuma ficar acima do valor de venda real).
- Eletrônicos: preço do equivalente NOVO hoje (lojas oficiais, Amazon, Magalu, Kabum) e de USADOS do mesmo modelo/configuração (Mercado Livre, OLX, Enjoei). Eletrônicos desvalorizam rápido — use o mercado de usados.
- Joias e ouro: cotação atual do grama do ouro (BRL/g) e o teor (18k = 75% de ouro). Se o peso estiver informado, valor base = peso × cotação × 0,75; joias de marca (Vivara, H.Stern…) podem ter algum ágio na revenda, mas a revenda costuma ficar perto do valor do ouro. Se o peso não for informado, estime com cautela e diga a premissa.
- Imóveis: anúncios comparáveis na mesma região/metragem (ZAP, VivaReal, QuintoAndar) e índice FipeZap do m². Sem localização/metragem, use confiança baixa e diga o que falta.
- Outros: anúncios do item novo e usado.

Regras:
- Considere o bem como USADO em bom estado, salvo indicação contrária no nome/observação.
- estimate = valor sugerido; low/high = faixa razoável. newPrice/usedPrice = referências encontradas (null se não achou).
- comparables: 3 a 8 anúncios/referências reais que você abriu ou viu nos resultados, com preço e URL; condition "novo", "usado" ou "referencia" (FIPE, cotação do ouro, índice).
- Nunca invente preços nem URLs. Se achou pouca coisa, reduza a confiança e explique em summary.
- assumptions: premissas em 1–2 frases (versão, ano, km, estado, peso…). summary: 2–3 frases explicando o número.
- Se houver anexos (fotos, nota fiscal, CRLV, laudo, certificado), use o que eles mostram (modelo exato, ano, km, peso, quilates, estado de conservação, preço pago e data da compra) e diga nas premissas o que veio dos anexos.`;

export function assetEstimatePrompt(args: { type: string; typeLabel: string; name: string; notes?: string; currentValue: number; today: string }): string {
  return `Hoje: ${args.today}.

Bem a avaliar:
- Tipo: ${args.typeLabel} (${args.type})
- Descrição: ${args.name}
- Observação do usuário: ${args.notes || "(nenhuma)"}
- Valor que o usuário registrou: R$ ${args.currentValue.toLocaleString("pt-BR")}

Pesquise e responda somente com o resultado estruturado.`;
}
