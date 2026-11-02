import { z } from "zod";
import type { AppState, JobEvent } from "../shared/types";
import { CLASS_META } from "../shared/types";
import { aiFor } from "../shared/ai";
import { classRows, computeAllocation, toBRL, withClassRules } from "../shared/arca";
import { L } from "../shared/i18n";
import { runAi } from "./ai";

/*
 * "Pergunte à Arca": conversa com a IA sobre os dados do próprio usuário. O app monta um retrato
 * compacto (carteira, alocação, histórico, metas, gastos…) e a IA responde em cima dele — com busca
 * na web para o que for de mercado. Sem ferramentas que alterem dados: é só leitura.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatReply {
  text: string;
  /** Perguntas de continuação sugeridas pela IA. */
  followUps: string[];
}

const ChatReplySchema = z.object({ text: z.string(), followUps: z.array(z.string()).max(4) });

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const CHAT_SYSTEM = `Você é a Arca, a assistente financeira pessoal de um investidor brasileiro, dentro do app dele. Responda em português do Brasil, direto, com números.

Regras:
- Os DADOS DO USUÁRIO abaixo são a fonte da verdade sobre a vida financeira dele. Use-os; não invente posições, valores ou datas. Se faltar dado, diga o que falta e como obter no app (ex.: "importe o extrato", "conecte o banco no Open Finance").
- Para mercado (juros, cotações, notícias, regras de IR) pesquise na web e cite a fonte.
- Faça as contas com cuidado e mostre o raciocínio em uma linha quando houver conta.
- Você não executa ações no app (não compra, não vende, não altera dados); quando fizer sentido, diga em qual tela o usuário faz aquilo.
- Não recomende um ativo específico como "compre X"; pode comparar alternativas, explicar riscos e mostrar o efeito na carteira.
- Formato: markdown simples, curto (até ~200 palavras, a não ser que peçam detalhe). Em followUps, sugira até 3 perguntas de continuação úteis.`;

/** Retrato compacto dos dados do usuário para o modelo (extensível por seções extras, ex.: gastos). */
export function chatContext(state: AppState, extra: string[] = []): string {
  const s = state.settings;
  const positions = withClassRules(state.positions, s);
  const total = positions.reduce((t, p) => t + toBRL(p, s.fx), 0);
  const rows = classRows(computeAllocation(positions, s.fx), s.targets);
  const lines = [...positions]
    .sort((a, b) => toBRL(b, s.fx) - toBRL(a, s.fx))
    .map((p) => `- ${p.ticker ? `${p.ticker} · ` : ""}${p.name} | ${p.subtype || "-"} | ${p.institution} ${p.owner} | ${CLASS_META[p.assetClass].label} | ${brl(toBRL(p, s.fx))}${p.currency !== "BRL" ? ` (${p.currency})` : ""}${p.quantity ? ` | qtd ${p.quantity}` : ""} | atualizado ${p.updatedAt.slice(0, 10)}${p.aiEstimate ? " (estimado pela IA)" : ""}`);
  const physical = (state.assets ?? []).map((a) => `- ${a.name} (${a.type}) ${brl(a.value ?? 0)} ${a.owner}`);
  return [
    `Hoje: ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Câmbio: US$ 1 = R$ ${s.fx.USD?.toFixed(4) ?? "?"}. Perfil: ${s.investorProfile || "não informado"}.`,
    `PATRIMÔNIO INVESTIDO: ${brl(total)} em ${positions.length} posições.`,
    `ALOCAÇÃO (metodologia ${s.methodology}; atual vs meta): ${rows.map((r) => `${CLASS_META[r.assetClass].label} ${r.currentPct.toFixed(1)}% vs ${r.targetPct}% (${brl(r.current)})`).join("; ")}.`,
    `POSIÇÕES (nome | tipo | instituição titular | classe | valor em R$):\n${lines.join("\n")}`,
    physical.length ? `BENS FÍSICOS:\n${physical.join("\n")}` : "",
    ...extra,
  ].filter(Boolean).join("\n\n");
}

export function chatPrompt(context: string, messages: ChatMessage[]): string {
  const convo = messages.slice(-12).map((m) => `${m.role === "user" ? "USUÁRIO" : "ARCA"}: ${m.text}`).join("\n\n");
  return `DADOS DO USUÁRIO\n${context}\n\nCONVERSA\n${convo}\n\nResponda à última mensagem do USUÁRIO.`;
}

export async function chatWithAi(
  state: AppState,
  messages: ChatMessage[],
  extra: string[],
  emit: (e: JobEvent<never>) => void,
  signal: AbortSignal,
): Promise<ChatReply> {
  emit({ type: "status", text: L("Pensando…", "Thinking…") });
  const { data } = await runAi(aiFor(state.settings, "chat"), {
    system: CHAT_SYSTEM,
    prompt: chatPrompt(chatContext(state, extra), messages),
    schema: ChatReplySchema,
    web: true,
    maxTurns: 25,
    signal,
    onProgress: emit,
  });
  return { text: data.text, followUps: data.followUps.slice(0, 3) };
}
