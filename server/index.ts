import { createApp } from "./app";
import { fileStore } from "./store";
import { aiStatus, setApiKey } from "./ai";
import { estimateAsset, extractFromFiles, interpretPrompt, projectWithAi, refineImport, refreshWithAi, researchAsset, scanClass } from "./tasks";
import { refreshValues } from "./refresh";
import { yahooQuote } from "./quotes";
import { tesouroSource } from "./tesouro";
import { bcbSource } from "./indexers";
import { dataDir, historyFile, secretsFile } from "./paths";
import { backfillHistory, historyStore, withHistory } from "./history";
import { goalsAdviceWithAi, monthSummaryWithAi } from "./insights";
import { GOAL_KINDS, goalStatus, planningOf } from "../shared/planning";
import { chatWithAi } from "./chat";
import { monthlyStats } from "../shared/history";
import { brDay } from "../shared/history";
import { fetchConnections, filePluggyCredentials, pluggyClient, switchingClient } from "./pluggy";
import { pgQuery, securoClient, SECURO_APP_URL, SECURO_DB_URL } from "./securo";
import { autoSyncConnections, openFinanceSettings } from "../shared/openFinance";
import { sampleVideo } from "./video";
import { PROVIDERS, aiSettings, isAiReady } from "../shared/ai";
import { L } from "../shared/i18n";

// Cada gravação da carteira também tira a foto do dia (histórico do patrimônio).
const history = historyStore(historyFile());
const store = withHistory(fileStore(), history);
const pluggyCredentials = filePluggyCredentials(secretsFile());
const direct = pluggyClient(() => pluggyCredentials.get());
// Open Finance: Pluggy direto se houver credenciais no Arca; senão, lê o Securo instalado no PC (se estiver rodando).
const securo = securoClient(pgQuery(process.env.SECURO_DB_URL || SECURO_DB_URL));
const securoUp = () => securo.check().then(() => true, () => false);
const pluggy = switchingClient(() => (pluggyCredentials.get() ? direct : securo));
const tesouroPrices = tesouroSource();
const indexSeries = bcbSource();
let lastAutoAi = 0;
const app = createApp({
  store,
  aiStatus,
  setApiKey,
  extractFromFiles,
  refineImport,
  interpretPrompt,
  scanClass,
  refreshValues: async (state, emit, signal, opts) => {
    // Rodada automática: IA (fundos, COE) no máximo 1x por dia — a cota de fundo só muda uma vez por dia.
    const aiDue = !opts?.auto || Date.now() - lastAutoAi >= 20 * 3_600_000;
    let aiRan = false;
    const result = await refreshValues(state, {
      fetchQuote: yahooQuote,
      tesouro: tesouroPrices,
      indexSeries,
      claudeRefresh: aiDue
        ? async (...args) => {
            const r = await refreshWithAi(...args);
            aiRan = true;
            return r;
          }
        : async () => ({ updates: [], ratesUsed: "" }),
      // Open Finance como fonte da verdade: as instituições conectadas vêm da Pluggy
      // (no automático, só as conexões já revisadas numa importação).
      openFinance: async (s, sig) => {
        const of = openFinanceSettings(s.settings.openFinance);
        const conns = opts?.auto ? autoSyncConnections(of) : of.connections;
        if (!of.sourceOfTruth || !conns.length || (!pluggyCredentials.get() && !(await securoUp()))) return null;
        return fetchConnections(pluggy, conns, { includeAccounts: of.includeAccounts, signal: sig });
      },
    }, emit, signal);
    if (opts?.auto && aiRan) lastAutoAi = Date.now();
    return { ...result, aiRan };
  },
  projectPortfolio: projectWithAi,
  researchAsset,
  estimateAsset,
  pluggy: { credentials: pluggyCredentials, client: pluggy, securo: { available: securoUp, url: process.env.SECURO_APP_URL || SECURO_APP_URL } },
  // A cada 30 min: Open Finance, cotações, Tesouro e Banco Central, aplicados sem confirmação.
  autoRefresh: { everyMs: 30 * 60_000 },
  sampleVideo,
  chat: (state, messages, emit, signal) => chatWithAi(state, messages, chatExtras(state), emit, signal),
  goalsAdvice: goalsAdviceWithAi,
  history: {
    store: history,
    benchmarks: async (from) => {
      // CDI do mês = produto dos CDIs diários; Ibovespa = fechamento do mês sobre o do mês anterior.
      const cdi: Record<string, number> = {};
      const s = await indexSeries(from);
      for (const { d, r } of s?.cdi ?? []) cdi[d.slice(0, 7)] = ((1 + (cdi[d.slice(0, 7)] ?? 0) / 100) * (1 + r) - 1) * 100;
      const ibov: Record<string, number> = {};
      const q = await yahooQuote("^BVSP").catch(() => null);
      const lastClose = new Map<string, number>();
      for (const h of q?.history ?? []) lastClose.set(brDay(new Date(h.t * 1000)).slice(0, 7), h.close);
      if (q) lastClose.set(brDay(new Date()).slice(0, 7), q.price);
      const months = [...lastClose.keys()].sort();
      months.forEach((m, i) => {
        if (i > 0 && m >= from.slice(0, 7)) ibov[m] = (lastClose.get(m)! / lastClose.get(months[i - 1])! - 1) * 100;
      });
      return { cdi, ibov };
    },
    summarize: monthSummaryWithAi,
  },
});

/** Seções extras do contexto do chat (histórico, metas, gastos, IR…). */
function chatExtras(state: import("../shared/types").AppState): string[] {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const out: string[] = [];
  const snaps = history.get().snapshots;
  if (snaps.length > 1) {
    const months = monthlyStats(snaps).slice(-6);
    const rows = months.map((m) => `- ${m.month}: fim ${brl(m.end)}, variação ${brl(m.change)}${m.returnPct != null ? `, rendimento ${m.returnPct.toFixed(2)}%` : ""}${m.estimated ? " (estimado)" : ""}`);
    out.push(["HISTÓRICO (patrimônio investido por mês; \"estimado\" = reconstruído):", ...rows].join("\n"));
  }
  const goals = planningOf(state.planning).goals;
  if (goals.length) {
    const rows = goals.map((g) => {
      const st = goalStatus(g, state);
      return `- ${g.name} (${GOAL_KINDS()[g.kind]}): alvo ${brl(g.target)} (R$ de hoje) em ${g.targetDate}; hoje ${brl(st.current)} (${(st.progress * 100).toFixed(0)}%); aporte planejado ${brl(g.monthly)}/mês, necessário ${brl(st.required)}/mês; ${st.onTrack ? "no trilho" : "FORA do trilho"} (retorno real ${st.realReturnPct.toFixed(1)}% a.a.)`;
    });
    out.push(["METAS:", ...rows].join("\n"));
  }
  return out;
}

// Histórico novo: reconstrói ~4 meses (estimados) para o gráfico não começar vazio.
setTimeout(() => {
  if (history.get().snapshots.length >= 30) return;
  const state = store.load();
  if (!state.positions.length) return;
  const today = brDay(new Date());
  void (async () => {
    const [tes, series] = await Promise.all([tesouroPrices().catch(() => null), indexSeries(brDay(new Date(Date.now() - 125 * 86_400_000))).catch(() => null)]);
    const snaps = await backfillHistory(state, { fetchQuote: yahooQuote, tesouro: tes, series, today });
    history.addEstimated(snaps);
    history.record(state);
    console.log(L(`Histórico: ${snaps.length} dias reconstruídos (estimados).`, `History: ${snaps.length} days rebuilt (estimated).`));
  })().catch((e: unknown) => console.warn(`Histórico: ${e instanceof Error ? e.message : String(e)}`));
}, 5_000).unref();

const port = Number(process.env.PORT) || 3001;
// Só na própria máquina: a API expõe sua carteira e usa sua IA/assinatura.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(L(`Arca Assistant em http://${host}:${port}  (dados: ${dataDir()})`, `Arca Assistant at http://${host}:${port}  (data: ${dataDir()})`));
  void aiStatus().then((status) => {
    const ai = aiSettings(store.load().settings);
    const p = PROVIDERS[ai.provider];
    const mode = ai.auth === "apiKey" ? L("chave de API", "API key") : L("login local", "local login");
    if (isAiReady(ai, status)) console.log(`IA: ${p.label} (${mode}${status[ai.provider].account ? ` · ${status[ai.provider].account}` : ""})`);
    else console.warn(L(`⚠ IA ${p.label} (${mode}) não está pronta. Configure em Ajustes → Provedor de IA.`, `⚠ AI ${p.label} (${mode}) is not ready. Set it up in Settings → AI provider.`));
  });
});
