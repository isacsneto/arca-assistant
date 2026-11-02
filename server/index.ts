import { createApp } from "./app";
import { fileStore } from "./store";
import { aiStatus, setApiKey } from "./ai";
import { estimateAsset, extractFromFiles, interpretPrompt, projectWithAi, refineImport, refreshWithAi, researchAsset, scanClass } from "./tasks";
import { refreshValues } from "./refresh";
import { yahooQuote } from "./quotes";
import { tesouroSource } from "./tesouro";
import { bcbSource } from "./indexers";
import { dataDir, historyFile, ledgerFile, secretsFile } from "./paths";
import { AI_CATEGORIES_VERSION, ledgerStore, needsAi, syncLedger } from "./ledger";
import { cashflowView } from "../shared/cashflowView";
import { taxView } from "../shared/taxView";
import { categoryOf } from "../shared/cashflow";
import { backfillHistory, historyStore, withHistory } from "./history";
import { categorizeWithAi, debtsAdviceWithAi, goalsAdviceWithAi, monthSummaryWithAi, spendingAdviceWithAi, taxAdviceWithAi } from "./insights";
import { debtRows, totalDebt } from "../shared/debts";
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
const ledger = ledgerStore(ledgerFile());
// Patrimônio líquido no histórico desconta as dívidas (Open Finance + cadastradas).
const debtsOf = (s: import("../shared/types").AppState) => totalDebt(debtRows(planningOf(s.planning), ledger.get()));
const store = withHistory(fileStore(), history, debtsOf);
const pluggyCredentials = filePluggyCredentials(secretsFile());
const direct = pluggyClient(() => pluggyCredentials.get());
// Open Finance: Pluggy direto se houver credenciais no Arca; senão, lê o Securo instalado no PC (se estiver rodando).
const securo = securoClient(pgQuery(process.env.SECURO_DB_URL || SECURO_DB_URL));
const securoUp = () => securo.check().then(() => true, () => false);
const pluggy = switchingClient(() => (pluggyCredentials.get() ? direct : securo));
const tesouroPrices = tesouroSource();
const indexSeries = bcbSource();
let lastAutoAi = 0;

/** Guarda o resultado por `ms` (por argumento): consultas caras a Banco Central/Yahoo. */
function cached<A, R>(ms: number, fn: (a: A) => Promise<R>): (a: A) => Promise<R> {
  const memo = new Map<string, { at: number; value: Promise<R> }>();
  return (a) => {
    const key = JSON.stringify(a);
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.value;
    const value = fn(a).catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, { at: Date.now(), value });
    return value;
  };
}
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
        const data = await fetchConnections(pluggy, conns, { includeAccounts: of.includeAccounts, signal: sig });
        // Sem revisão, conexão que voltou vazia (item ainda atualizando, consentimento renovando…) fica de fora:
        // senão a instituição inteira "sairia" da carteira. Na revisão manual o usuário vê e decide.
        return opts?.auto ? data.filter((d) => d.error || d.investments.length > 0 || (of.includeAccounts && d.accounts.length > 0)) : data;
      },
      // Automático: posição atualizada há menos de 1 dia (ex.: valor digitado à mão) não vai para a estimativa da IA.
      skipRecentForAi: !!opts?.auto,
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
  chat: (state, messages, emit, signal, screen) => chatWithAi(state, messages, chatExtras(state), emit, signal, screen),
  goalsAdvice: goalsAdviceWithAi,
  debts: {
    // CDI ao ano a partir do último CDI diário publicado.
    cdiAnnual: async () => {
      const s = await indexSeries(brDay(new Date(Date.now() - 20 * 86_400_000)));
      const r = s?.cdi.at(-1)?.r;
      return r != null ? (Math.pow(1 + r, 252) - 1) * 100 : null;
    },
    advise: debtsAdviceWithAi,
  },
  ledger: { store: ledger, sync: (s) => syncLedgerNow(s), advise: spendingAdviceWithAi, taxAdvise: taxAdviceWithAi },
  history: {
    store: history,
    benchmarks: cached(60 * 60_000, async (from: string) => {
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
    }),
    summarize: monthSummaryWithAi,
  },
});

/**
 * Transações, faturas, empréstimos e movimentações do Open Finance (só com a Pluggy direto). Depois de
 * sincronizar, a IA categoriza as descrições que nem regra nem a Pluggy resolvem.
 */
let ledgerRunning: Promise<void> | null = null;
function syncLedgerNow(state: import("../shared/types").AppState): Promise<void> {
  ledgerRunning ??= (async () => {
    if (!pluggyCredentials.get() || !openFinanceSettings(state.settings.openFinance).connections.length) return;
    const data = await syncLedger(direct, state, ledger.get());
    ledger.set(data);
    const todo = needsAi(data, state);
    if (todo.length) {
      try {
        const map = await categorizeWithAi(state, todo);
        const cur = ledger.get();
        ledger.set({
          ...cur,
          aiCategories: { ...cur.aiCategories, ...map },
          aiCatVersion: { ...cur.aiCatVersion, ...Object.fromEntries(Object.keys(map).map((k) => [k, AI_CATEGORIES_VERSION])) },
        });
      } catch (e) {
        console.warn(`Categorias pela IA: ${(e as Error).message}`);
      }
    }
  })().finally(() => (ledgerRunning = null));
  return ledgerRunning;
}
// Junto com a atualização automática: a cada 30 min (a primeira, 90 s depois de subir).
const ledgerTick = () => void syncLedgerNow(store.load()).catch((e: unknown) => console.warn(`Open Finance (transações): ${e instanceof Error ? e.message : String(e)}`));
setTimeout(ledgerTick, 90_000).unref();
setInterval(ledgerTick, 30 * 60_000).unref();

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
  const led = ledger.get();
  if (led.bankTx.length) {
    const v = cashflowView(state, led, null, brDay(new Date()));
    const cat = (id: string) => categoryOf(id).label();
    const months = v.months.slice(-4).map((m) => `- ${m.month}: receitas ${brl(m.income)}, gastos ${brl(m.expenses)}, sobra ${brl(m.net)}; maiores: ${Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, x]) => `${cat(c)} ${brl(x)}`).join(", ")}`);
    out.push([
      "GASTOS (conta e cartão, Open Finance):",
      ...months,
      `- Sobra média (3 meses): ${v.capacity ? brl(v.capacity.average) : "n/d"}/mês`,
      `- Recorrentes: ${v.recurring.length} (${brl(v.recurring.reduce((s, r) => s + r.amount, 0))}/mês): ${v.recurring.slice(0, 8).map((r) => `${r.label} ${brl(r.amount)}`).join("; ")}`,
      `- Reserva: ${brl(v.reserve.value)} = ${v.reserve.months?.toFixed(1) ?? "?"} meses de gasto médio (${brl(v.reserve.avgExpenses)})`,
      `- Compromissos próximos: ${v.commitments.map((c) => `${c.month} ${brl(c.total)} (faturas ${brl(c.bills)}, parcelas ${brl(c.installments)})`).join("; ")}`,
    ].join("\n"));
  }
  const debts = debtRows(planningOf(state.planning), led);
  if (debts.length) out.push(["DÍVIDAS:", ...debts.map((d) => `- ${d.name}: saldo ${brl(d.balance)}${d.ratePct != null ? `, ${d.ratePct}% a.a.` : ""}${d.installment ? `, parcela ${brl(d.installment)}` : ""}${d.remaining ? `, faltam ${d.remaining}` : ""}`)].join("\n"));
  const year = new Date().getFullYear();
  if (led.investTx.length || led.holdingsByYear?.[String(year)]) {
    const tv = taxView(state, led, year);
    out.push([
      `IR (ano-base ${year}, estimativa):`,
      `- DARF no ano: ${brl(tv.darfTotal)}; meses: ${tv.darfs.map((d) => `${d.month} vendas ações ${brl(d.stockSales)} DARF ${brl(d.darf)}`).join("; ") || "sem vendas"}`,
      `- Proventos: isentos ${brl(tv.income.exempt)}, JCP ${brl(tv.income.jcp)}`,
    ].join("\n"));
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
    history.record(state, debtsOf(state));
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
