import { z } from "zod";
import type { AppState, JobEvent } from "../shared/types";
import { aiFor } from "../shared/ai";
import { L } from "../shared/i18n";
import type { MonthStats, Snapshot } from "../shared/history";
import { runAi } from "./ai";
import { CATEGORIES, categoryOf } from "../shared/cashflow";
import type { CashflowView } from "../shared/cashflowView";
import type { TaxView } from "../shared/taxView";
import { planningOf } from "../shared/planning";

/*
 * Análises em texto feitas pela IA sobre os dados do próprio app (histórico, metas, gastos…).
 * A conta é sempre do app; a IA explica, contextualiza (pode pesquisar na web) e sugere.
 */

const TextSchema = z.object({ text: z.string() });

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined) => (n == null ? "n/d" : `${n.toFixed(2)}%`);

export const MONTH_SUMMARY_SYSTEM = `Você é o analista da carteira de um investidor brasileiro e escreve o RESUMO DO MÊS do patrimônio dele, em português do Brasil, direto e sem jargão desnecessário.

Use os números fornecidos (eles são a fonte da verdade; não recalcule nem invente). Pesquise na web o contexto do mês (juros/curva, Ibovespa, dólar, eventos políticos e fiscais) para EXPLICAR as maiores variações por classe e por instituição.

Formato (markdown simples, no máximo ~250 palavras):
1. Uma frase com o resultado do mês (variação em R$ e %, comparado a CDI e Ibovespa).
2. "O que mais pesou": 2–4 tópicos com a causa provável de cada variação relevante.
3. "Fique de olho": 1–3 pontos práticos (sem recomendar compra/venda de ativo específico).
Se os dados do mês forem estimados (reconstruídos), diga isso em uma linha.`;

export function monthSummaryPrompt(args: { month: string; stats: MonthStats; first: Snapshot; last: Snapshot; cdi: number | null; ibov: number | null }): string {
  const { month, stats, first, last } = args;
  const diff = (a: Record<string, number>, b: Record<string, number>) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .map((k) => ({ k, d: (b[k] ?? 0) - (a[k] ?? 0), end: b[k] ?? 0 }))
      .filter((x) => Math.abs(x.d) >= 1)
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      .slice(0, 10)
      .map((x) => `- ${x.k}: ${x.d >= 0 ? "+" : ""}${brl(x.d)} (fim ${brl(x.end)})`)
      .join("\n");
  return `Mês: ${month}${stats.estimated ? " (parte dos dados é estimada)" : ""}.
Patrimônio investido: início ${brl(stats.start)} → fim ${brl(stats.end)} (variação ${brl(stats.change)}; aportes líquidos registrados ${brl(stats.flows)}; rendimento estimado ${pct(stats.returnPct)}).
CDI no mês: ${pct(args.cdi)} · Ibovespa no mês: ${pct(args.ibov)}.

Variação por classe:
${diff(first.byClass, last.byClass) || "- sem mudança"}

Variação por instituição:
${diff(first.byInstitution, last.byInstitution) || "- sem mudança"}

Escreva o resumo.`;
}

export async function monthSummaryWithAi(
  state: AppState,
  args: Parameters<typeof monthSummaryPrompt>[0],
  emit: (e: JobEvent<never>) => void,
  signal: AbortSignal,
): Promise<string> {
  emit({ type: "status", text: L("Pesquisando o contexto do mês…", "Researching the month's context…") });
  const { data } = await runAi(aiFor(state.settings, "insights"), {
    system: MONTH_SUMMARY_SYSTEM,
    prompt: monthSummaryPrompt(args),
    schema: TextSchema,
    web: true,
    maxTurns: 30,
    signal,
    onProgress: emit,
  });
  return data.text;
}

/* ---------------- metas ---------------- */

export const GOALS_SYSTEM = `Você é o planejador financeiro de um investidor brasileiro e analisa as METAS dele, em português do Brasil.

Os números (valor atual, prazo, aporte necessário, retorno real usado) já foram calculados pelo app — use-os, não recalcule. Pode pesquisar na web (ex.: juros reais atuais, inflação esperada) para julgar se as premissas são realistas.

Formato (markdown simples, até ~300 palavras):
1. Situação geral em 1–2 frases (quanto precisa aportar por mês no total para todas as metas, e se cabe).
2. Para cada meta fora do trilho: o que ajustar (aporte, prazo ou valor) com números.
3. Se as posições ligadas combinam com o prazo (ex.: reserva em ativo sem liquidez diária, aposentadoria longa toda em caixa) — sem indicar ativo específico para comprar.
4. Ordem de prioridade sugerida entre as metas, com o porquê.`;

export async function goalsAdviceWithAi(
  state: AppState,
  rows: { name: string; kind: string; target: number; targetDate: string; current: number; months: number; monthly: number; required: number; projected: number; realReturnPct: number; positions: string[] }[],
  emit: (e: JobEvent<never>) => void,
  signal: AbortSignal,
): Promise<string> {
  emit({ type: "status", text: L("Analisando as metas…", "Analyzing the goals…") });
  const lines = rows.map((g) =>
    `- ${g.name} (${g.kind}): alvo ${brl(g.target)} em ${g.targetDate} (${g.months} meses); hoje ${brl(g.current)}; aporte planejado ${brl(g.monthly)}/mês; necessário ${brl(g.required)}/mês; chega a ${brl(g.projected)} no prazo; retorno real usado ${g.realReturnPct.toFixed(1)}% a.a.; posições: ${g.positions.join(", ") || "nenhuma"}`);
  const { data } = await runAi(aiFor(state.settings, "insights"), {
    system: GOALS_SYSTEM,
    prompt: `Perfil do investidor: ${state.settings.investorProfile || "não informado"}.\n\nMETAS (valores em reais de hoje):\n${lines.join("\n")}\n\nEscreva a análise.`,
    schema: TextSchema,
    web: true,
    maxTurns: 20,
    signal,
    onProgress: emit,
  });
  return data.text;
}

/* ---------------- categorias dos gastos ---------------- */

export async function categorizeWithAi(
  state: AppState,
  items: { desc: string; sample: string; amount: number; pluggyCategory: string | null; count: number }[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (!items.length) return {};
  const ids = CATEGORIES.map((c) => c.id) as [string, ...string[]];
  const schema = z.object({ items: z.array(z.object({ desc: z.string(), category: z.enum(ids) })) });
  const rules = planningOf(state.planning).categoryRules;
  const catalog = CATEGORIES.map((c) => `- ${c.id} (${c.kind === "expense" ? "gasto" : c.kind === "income" ? "receita" : "não é gasto nem receita"}): ${c.label()}`).join("\n");
  const examples = rules.slice(-40).map((r) => `- "${r.match}" → ${r.category}`).join("\n");
  const { data } = await runAi(aiFor(state.settings, "refresh"), {
    system: `Você classifica transações bancárias brasileiras (conta e cartão) em categorias. Responda só com o resultado estruturado: para cada "desc" recebida, uma categoria do catálogo.

Catálogo:
${catalog}

Dicas: PIX/TED para a própria pessoa ou entre contas dela = transferencia; PIX para outra pessoa ou empresa = o gasto correspondente (se não der para saber, "outros"); "APLICAÇÃO", "RESGATE", "CDB", "TESOURO", corretora = investimento; pagamento de fatura = fatura; valor positivo de salário/pró-labore = salario. Use as correções do usuário como exemplo do gosto dele.`,
    prompt: `${examples ? `Correções do usuário (siga o padrão):\n${examples}\n\n` : ""}Transações (desc normalizada | exemplo original | sinal | categoria do banco | ocorrências):\n${items
      .map((i) => `- ${i.desc} | ${i.sample} | ${i.amount < 0 ? "saída" : "entrada"} | ${i.pluggyCategory ?? "-"} | ${i.count}`)
      .join("\n")}`,
    schema,
    web: false,
    maxTurns: 4,
    signal,
  });
  const valid = new Set(items.map((i) => i.desc));
  return Object.fromEntries(data.items.filter((i) => valid.has(i.desc)).map((i) => [i.desc, i.category]));
}

/* ---------------- análise dos gastos ---------------- */

export async function spendingAdviceWithAi(state: AppState, view: CashflowView, emit: (e: JobEvent<never>) => void, signal: AbortSignal): Promise<string> {
  emit({ type: "status", text: L("Analisando os gastos…", "Analyzing spending…") });
  const label = (id: string) => categoryOf(id).label();
  const months = view.months.slice(-6).map((m) => `- ${m.month}: receitas ${brl(m.income)}, gastos ${brl(m.expenses)}, sobra ${brl(m.net)}; maiores: ${Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => `${label(c)} ${brl(v)}`).join(", ")}`);
  const rec = view.recurring.slice(0, 15).map((r) => `- ${r.label} (${label(r.category)}): ${brl(r.amount)}/mês`);
  const { data } = await runAi(aiFor(state.settings, "insights"), {
    system: `Você é o consultor financeiro pessoal de um brasileiro e analisa os GASTOS dele (conta e cartão, via Open Finance), em português do Brasil. Os números já foram calculados pelo app — use-os.

Formato (markdown simples, até ~300 palavras):
1. Retrato em 2 frases: quanto entra, quanto sai, quanto sobra por mês e a taxa de poupança.
2. "Onde dá para economizar": 2–4 pontos concretos com valor estimado por mês (categorias acima do comum para a renda, assinaturas que parecem esquecidas/duplicadas, tarifas e juros).
3. "Orçamento sugerido": limite mensal para as 5–8 maiores categorias.
4. Uma frase ligando a sobra aos investimentos (quanto daria para aportar por mês).
Sem julgamento moral; seja prático.`,
    prompt: `MESES:\n${months.join("\n")}\n\nSOBRA MÉDIA (3 meses): ${view.capacity ? brl(view.capacity.average) : "n/d"}\nRESERVA: ${brl(view.reserve.value)} (${view.reserve.months?.toFixed(1) ?? "?"} meses de gasto)\n\nRECORRENTES:\n${rec.join("\n") || "- nenhum detectado"}\n\nEscreva a análise.`,
    schema: TextSchema,
    web: false,
    maxTurns: 6,
    signal,
    onProgress: emit,
  });
  return data.text;
}

/* ---------------- IR ---------------- */

export async function taxAdviceWithAi(state: AppState, view: TaxView, emit: (e: JobEvent<never>) => void, signal: AbortSignal): Promise<string> {
  emit({ type: "status", text: L("Montando o checklist do IR…", "Building the tax checklist…") });
  const bens = view.bens.slice(0, 60).map((b) => `- [${b.kind}] ${b.text}`).join("\n");
  const darfs = view.darfs.map((d) => `- ${d.month}: vendas de ações ${brl(d.stockSales)} (${d.stocksExempt ? "isento" : "tributável"}); base comum ${brl(d.taxableCommon)}, FII ${brl(d.taxableFii)}; DARF ${brl(d.darf)} vence ${d.dueDate}`).join("\n");
  const { data } = await runAi(aiFor(state.settings, "insights"), {
    system: `Você é um contador especializado em IR de pessoa física e investimentos no Brasil. Monte um CHECKLIST prático para a declaração do ano-base informado, em português do Brasil.

Pesquise na web a tabela VIGENTE de grupos/códigos da ficha Bens e Direitos e as regras do ano (não confie na memória) e cite a fonte.

Formato (markdown simples, até ~450 palavras):
1. "Bens e Direitos": como lançar cada TIPO de investimento listado (grupo/código, o que vai em Discriminação, CNPJ da instituição/emissor quando pedido, situação em 31/12 = custo de aquisição).
2. "Rendimentos": onde lançar dividendos e rendimentos de FII (isentos), JCP (exclusiva), renda fixa (exclusiva, informe do banco).
3. "Renda variável": meses com DARF devido ou prejuízo a declarar; se houver DARF em atraso, como pagar com multa/juros (Sicalc).
4. "Confira": 3–5 pontos onde costuma dar erro para esse perfil.
Não invente valores: use os dados fornecidos e diga quando faltar algo (ex.: informe de rendimentos do banco).`,
    prompt: `Ano-base: ${view.year}.\nMovimentações de investimento disponíveis desde: ${view.historyFrom ?? "n/d"}${view.approx ? " (parte do custo médio veio da corretora)" : ""}.\n\nBENS (pessoa física):\n${bens || "- nenhum"}\n\nDARFs / renda variável:\n${darfs || "- nenhuma venda registrada"}\n\nPROVENTOS: isentos ${brl(view.income.exempt)}; JCP ${brl(view.income.jcp)}.\n\nMonte o checklist.`,
    schema: TextSchema,
    web: true,
    maxTurns: 30,
    signal,
    onProgress: emit,
  });
  return data.text;
}

/* ---------------- dívidas ---------------- */

export async function debtsAdviceWithAi(
  state: AppState,
  rows: { name: string; balance: number; ratePct: number | null; installment: number | null; remaining: number | null }[],
  ctx: { cdiPct: number | null; netPct: number | null; liquid: number; monthlySurplus: number | null },
  emit: (e: JobEvent<never>) => void,
  signal: AbortSignal,
): Promise<string> {
  emit({ type: "status", text: L("Simulando amortizar × investir…", "Simulating prepay × invest…") });
  const { data } = await runAi(aiFor(state.settings, "insights"), {
    system: `Você é um planejador financeiro brasileiro e compara AMORTIZAR DÍVIDAS × INVESTIR para o usuário, em português do Brasil.

Use os números fornecidos; se faltar a taxa de uma dívida, diga como descobrir (contrato, app do banco, CET). Considere: juro efetivo da dívida vs rendimento líquido de IR do investimento, reduzir prazo vs reduzir parcela (SAC/Price), manter a reserva de emergência intacta, e o efeito na sobra mensal.

Formato (markdown simples, até ~300 palavras): veredito por dívida com o ganho estimado por ano a cada R$ 10 mil; ordem para quitar (maior custo primeiro); quanto do caixa/sobra mensal usar sem mexer na reserva.`,
    prompt: `CDI atual: ${ctx.cdiPct?.toFixed(2) ?? "n/d"}% a.a. · rendimento líquido de referência (CDI −15% IR): ${ctx.netPct?.toFixed(2) ?? "n/d"}% a.a.\nCaixa com liquidez: ${brl(ctx.liquid)} · Sobra média por mês: ${ctx.monthlySurplus != null ? brl(ctx.monthlySurplus) : "n/d"}\n\nDÍVIDAS:\n${rows.map((r) => `- ${r.name}: saldo ${brl(r.balance)}; juros ${r.ratePct != null ? `${r.ratePct}% a.a.` : "não informado"}; parcela ${r.installment != null ? brl(r.installment) : "n/d"}; faltam ${r.remaining ?? "n/d"} parcelas`).join("\n")}\n\nFaça a análise.`,
    schema: TextSchema,
    web: true,
    maxTurns: 12,
    signal,
    onProgress: emit,
  });
  return data.text;
}
