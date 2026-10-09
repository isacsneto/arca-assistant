# Arca Assistant

Consolida seus investimentos (conta corrente, renda fixa, ações, FIIs, exterior) a partir de **prints, PDFs, CSV e XLSX** lidos pelo Claude, mostra a carteira nas classes da **Arca** (Primo Rico / Thiago Nigro), sugere como rebalancear e faz um **scan** na web das melhores opções de cada classe.

## Rodando

```bash
npm install
claude auth login          # só se ainda não estiver logado no Claude Code
npm run dev               # front em http://localhost:5173, API em :3001
```

Produção local: `npm run build && npm start` (tudo em http://localhost:3001).
Testes do cálculo de rebalanceamento: `npm test`.

## Como funciona

| Tela | O que faz |
|---|---|
| **Importar** | Arraste/cole prints (Ctrl+V), PDFs, CSV ou XLSX. O Claude extrai posições e transações; você revisa/edita e só então salva. Reimportar atualiza posições existentes (mesma instituição + ticker/nome). |
| **Carteira** | Total, alocação atual × meta, posições editáveis por classe. Dólar convertido pela cotação em Ajustes. |
| **Atualizar valores** (botão na Carteira) | Ações, FIIs, ETFs, BDRs, dólar e cripto (Bitcoin/Ethereum) pela cotação de mercado do Yahoo Finance (`quantidade × preço`; sem quantidade, ela é inferida pela cotação da data da última atualização). Renda fixa e o que não tem cotação: o Claude pesquisa CDI/Selic/IPCA e acumula desde a última atualização. Saldos em conta são mantidos. Você revisa antes/depois e aplica. |
| **Projeção** | O Claude pesquisa inflação, juros, fiscal, valuation e histórico de longo prazo e define premissas de retorno por classe (e por ativo, quando foge da média) para dois cenários: **mais provável** e **pior caso plausível** (com choque no 1º ano). O app calcula 5/10/15/20/30 anos sobre a carteira atual, nominal e em reais de hoje. |
| **Rebalancear** | Informe o aporte: divide entre as classes abaixo da meta (ou, opcionalmente, com vendas até a meta exata). Usa o último scan para sugerir a divisão por ativo. |
| **Scan de ativos** | Por classe, o Claude pesquisa na web (balanços/resultados, relatórios de FIIs, finanças e juros do governo, ETFs) e devolve ranking com tese, métricas, riscos, o que evitar e fontes. |
| **Ajustes** | Metas (padrão 25/25/25/25), modelo e esforço de cada tarefa, perfil do investidor, câmbio, backup. |

**Classes da Arca:** Ações · Imóveis (FIIs) · Caixa/Renda Fixa · Internacional. Cripto, ouro, multimercado etc. ficam em "Fora da Arca" e não entram no rebalanceamento.

## Modelos

A IA roda pelo **Claude Code instalado na sua máquina** (Claude Agent SDK), usando o login da sua assinatura — **sem API key**. Cada chamada é isolada: sem seu CLAUDE.md/hooks/MCP e só com as ferramentas mínimas (`Read` para os arquivos; `WebSearch`/`WebFetch` no scan).

Padrões (mudam em Ajustes): leitura de arquivos e atualizar valores com **Sonnet 5.5 / esforço médio**; scan e projeção com **Opus 5.5 / esforço alto**. O scan faz dezenas de buscas por categoria e consome o limite da assinatura; rode quando houver balanço novo.

## Notas

- Dados ficam em `data/state.json` (fora do git). Arquivos enviados não são armazenados.
- O scan é análise gerada por IA com dados públicos; não é recomendação de investimento.
- Estrutura: `shared/` (tipos, schemas, cálculo), `server/` (Express + Claude Agent SDK), `src/` (React + Vite).
