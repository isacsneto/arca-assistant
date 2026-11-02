import { z } from "zod";
import type { AppState, JobEvent } from "../shared/types";
import { aiFor } from "../shared/ai";
import { L } from "../shared/i18n";
import type { MonthStats, Snapshot } from "../shared/history";
import { runAi } from "./ai";

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
