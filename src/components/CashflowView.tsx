import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, ChevronRight, Loader2, Receipt, RefreshCw, Repeat, Sparkles, Wallet, X } from "lucide-react";
import { CATEGORIES, categoryOf, normDesc } from "../../shared/cashflow";
import type { CashflowView as View, ResolvedTx } from "../../shared/cashflowView";
import { planningOf, type Planning } from "../../shared/planning";
import { api } from "../api";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt, amt0, amtCompact, pct } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { CashflowDetail, type Detail } from "./CashflowDetail";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "2-digit" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const SOURCE = (): Record<ResolvedTx["categorySource"], string> => ({ rule: L("sua regra", "your rule"), ai: "IA", pluggy: L("banco", "bank"), default: "?" });

/** Gastos e receitas (conta e cartão, via Open Finance): tudo clicável para o detalhe — meses, faturas, recorrentes. */
export function CashflowView({ goSettings }: { goSettings: () => void }) {
  const { state, update, config, savedAt, ledgerAt } = useStore();
  const planning = planningOf(state!.planning);
  const [view, setView] = useState<View | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const setPlanning = (fn: (p: Planning) => Planning) => update((s) => ({ ...s, planning: fn(planningOf(s.planning)) }));
  const advice = useJob<{ text: string; at: string }>("/api/cashflow/advice", (r) => setPlanning((p) => ({ ...p, spendingAdvice: r })));

  // Regras mudam a categoria: recarrega a visão (o servidor resolve com as regras salvas).
  useEffect(() => {
    api.cashflow(month).then(setView).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // ledgerAt: o Open Finance trouxe transações/faturas novas.
  }, [month, state?.rev, savedAt, ledgerAt]);

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await api.cashflowSync());
      setMonth(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Abre o detalhe de um mês (troca o mês selecionado para as transações carregarem). */
  const openMonth = (m: string, side: "income" | "expense" | "net") => {
    if (m !== view?.month) setMonth(m);
    setDetail({ kind: "month", month: m, side });
  };
  // Clique numa coluna do gráfico: o recharts entrega o item com o dado original em `payload`.
  const barClick = (d: unknown, side: "income" | "expense") => {
    const m = (d as { payload?: { month?: string } }).payload?.month;
    if (m) openMonth(m, side);
  };
  const setCategory = (t: ResolvedTx, category: string) =>
    // Vale para esta e para as próximas com a mesma descrição (a IA também aprende com isso).
    setPlanning((p) => {
      const sign = t.amount >= 0 ? 1 : -1;
      const match = normDesc(t.description);
      return { ...p, categoryRules: [...p.categoryRules.filter((r) => !(normDesc(r.match) === match && (r.sign ?? sign) === sign)), { match, category, sign }] };
    });

  if (error && !view) return <Banner kind="bad">{error}</Banner>;
  if (!view) return <p className="muted">{L("Carregando…", "Loading…")}</p>;

  const head = (
    <PageHead
      title={L("Gastos", "Spending")}
      subtitle={L("Conta e cartão pelo Open Finance: para onde vai o dinheiro, quanto sobra para investir, faturas, assinaturas e a sua reserva. Clique em qualquer número para ver o detalhe.", "Accounts and cards through Open Finance: where the money goes, how much is left to invest, bills, subscriptions and your emergency fund. Click any number for details.")}
      actions={
        <>
          {view.months.length > 0 && (
            <select value={view.month} onChange={(e) => setMonth(e.target.value)} aria-label={L("Mês", "Month")}>
              {[...view.months].reverse().map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
            </select>
          )}
          <button className="btn" onClick={() => void sync()} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} {L("Sincronizar", "Sync")}</button>
        </>
      }
    />
  );

  if (!view.hasData)
    return (
      <>
        {head}
        {error && <Banner kind="bad">{error}</Banner>}
        <Banner kind="info">
          {L("Ainda não há transações. Elas vêm das conexões do Open Finance (Pluggy) e sincronizam sozinhas a cada 30 minutos.", "No transactions yet. They come from your Open Finance (Pluggy) connections and sync on their own every 30 minutes.")}{" "}
          <button className="btn sm" onClick={goSettings}>{L("Ajustes → Open Finance", "Settings → Open Finance")}</button>
        </Banner>
      </>
    );

  const current = view.months.find((m) => m.month === view.month);
  const savingsRate = current && current.income > 0 ? (current.net / current.income) * 100 : null;
  const txs = filter ? view.tx.filter((t) => t.category === filter) : view.tx;
  const openBills = view.cardBills.filter((b) => b.open);

  return (
    <>
      {head}
      {error && <Banner kind="bad">{error}</Banner>}
      {view.error && <Banner kind="warn">{L("Parte das contas não sincronizou:", "Some accounts didn't sync:")} {view.error}</Banner>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <button className="card kpi kpi-btn" onClick={() => openMonth(view.month, "income")}>
          <div className="label">{L("Receitas", "Income")} · {monthLabel(view.month)}</div><div className="value num" style={{ color: "var(--ok)" }}>{amt0(current?.income ?? 0)}</div>
          <div className="sub">{L("ver de onde veio", "see where from")} <ChevronRight size={12} /></div>
        </button>
        <button className="card kpi kpi-btn" onClick={() => openMonth(view.month, "expense")}>
          <div className="label">{L("Gastos", "Spending")}</div><div className="value num" style={{ color: "var(--bad)" }}>{amt0(current?.expenses ?? 0)}</div>
          <div className="sub">{L("ver por categoria", "see by category")} <ChevronRight size={12} /></div>
        </button>
        <button className="card kpi kpi-btn" onClick={() => openMonth(view.month, "net")}>
          <div className="label">{L("Sobra", "Left over")}</div><div className="value num" style={{ color: (current?.net ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(current?.net ?? 0)}</div>
          <div className="sub">{savingsRate != null ? `${L("taxa de poupança", "savings rate")} ${pct(savingsRate, 0)}` : ""}</div>
        </button>
        <div className="card kpi"><div className="label">{L("Sobra média para investir", "Average left to invest")}</div><div className="value num">{view.capacity ? amt0(view.capacity.average) : "—"}</div>
          <div className="sub">{L("por mês, últimos 3 meses", "per month, last 3 months")}</div></div>
        <div className="card kpi"><div className="label"><Wallet size={13} /> {L("Reserva cobre", "Emergency fund covers")}</div><div className="value num">{view.reserve.months != null ? `${view.reserve.months.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${L("meses", "months")}` : "—"}</div>
          <div className="sub">{amt0(view.reserve.value)} · {L("gasto médio", "avg spend")} {amt0(view.reserve.avgExpenses)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L("Receitas × gastos", "Income × spending")}</h2>
          <span className="muted small">{L("clique numa coluna", "click a column")}</span>
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={view.months.map((m) => ({ month: m.month, income: m.income, expenses: m.expenses }))} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <YAxis tickFormatter={(v: number) => amtCompact(v)} width={68} tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} formatter={(v, k) => [amt0(Number(v)), k === "income" ? L("Receitas", "Income") : L("Gastos", "Spending")]} labelFormatter={(m) => monthLabel(String(m))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Bar dataKey="income" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(d) => barClick(d, "income")}>
                {view.months.map((m) => <Cell key={m.month} fill="var(--ok)" fillOpacity={m.month === view.month ? 1 : 0.45} />)}
              </Bar>
              <Bar dataKey="expenses" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(d) => barClick(d, "expense")}>
                {view.months.map((m) => <Cell key={m.month} fill="var(--bad)" fillOpacity={m.month === view.month ? 1 : 0.45} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h2 className="row"><CalendarClock size={17} /> {L("Próximos meses", "Next months")}</h2></div>
          <table className="mc">
            <thead><tr><th>{L("Mês", "Month")}</th><th className="right">{L("Faturas", "Card bills")}</th><th className="right">{L("Recorrentes", "Recurring")}</th><th className="right">{L("Total", "Total")}</th><th /></tr></thead>
            <tbody>
              {view.commitments.map((c) => (
                <tr key={c.month} className="clickable" onClick={() => setDetail({ kind: "commitment", month: c.month })}>
                  <td>{monthLabel(c.month)}</td><td className="right num">{amt0(c.bills)}</td><td className="right num">{amt0(c.recurring)}</td><td className="right num"><b>{amt0(c.total)}</b></td><td className="right"><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>{L("Faturas já com as parcelas que caem nelas; meses seguintes ainda sem as compras novas.", "Bills already include the installments in them; later months don't have new purchases yet.")}</p>
        </div>

        <div className="card">
          <div className="card-head"><h2 className="row"><Receipt size={17} /> {L("Faturas abertas", "Open bills")}</h2><span className="muted small">{amt0(openBills.reduce((s, b) => s + b.total, 0))}</span></div>
          {openBills.length ? openBills.map((b) => (
            <button key={b.accountId} className="list-row" onClick={() => setDetail({ kind: "bill", accountId: b.accountId, month: b.month })}>
              <span><b>{b.accountName}</b><span className="muted small"> · {b.institution} · {L("vence", "due")} {day(b.dueDate)}</span></span>
              <span className="num"><b>{amt(b.total)}</b> <ChevronRight size={14} /></span>
            </button>
          )) : <p className="muted small">{L("Nenhuma fatura aberta.", "No open bills.")}</p>}
          {view.reserve.months != null && (
            <p className="small" style={{ marginTop: 12 }}>
              {view.reserve.months >= 6
                ? L(`✅ A reserva (${amt0(view.reserve.value)}) cobre ${view.reserve.months.toFixed(1)} meses de gasto — acima dos 6 recomendados.`, `✅ The fund (${amt0(view.reserve.value)}) covers ${view.reserve.months.toFixed(1)} months of spending — above the recommended 6.`)
                : L(`⚠️ A reserva (${amt0(view.reserve.value)}) cobre ${view.reserve.months.toFixed(1)} meses de gasto — o recomendado é 6 (${amt0(view.reserve.avgExpenses * 6)}).`, `⚠️ The fund (${amt0(view.reserve.value)}) covers ${view.reserve.months.toFixed(1)} months — 6 is recommended (${amt0(view.reserve.avgExpenses * 6)}).`)}
            </p>
          )}
        </div>
      </div>

      {view.recurring.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 className="row"><Repeat size={17} /> {L("Recorrentes detectados", "Detected recurring")}</h2>
            <span className="muted small">{amt0(view.recurring.reduce((s, r) => s + r.amount, 0))}/{L("mês", "mo")}</span>
          </div>
          <div className="table-wrap">
            <table className="mc">
              <thead><tr><th>{L("O quê", "What")}</th><th>{L("Categoria", "Category")}</th><th className="right">{L("Valor/mês", "Per month")}</th><th>{L("Próximo", "Next")}</th><th /></tr></thead>
              <tbody>
                {view.recurring.map((r) => (
                  <tr key={r.key} className="clickable" onClick={() => setDetail({ kind: "recurring", key: r.key })}>
                    <td className="ga-main"><b>{r.label}</b><div className="muted small">{r.account} · {r.months} {L("meses", "months")}</div></td>
                    <td className="small ga-side">{categoryOf(r.category).label()}</td>
                    <td className="right num ga-val">{amt(r.amount)}</td>
                    <td className="small ga-side">~{day(r.nextDate)}</td>
                    <td className="right ga-act"><ChevronRight size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L("Transações", "Transactions")} · {monthLabel(view.month)} ({txs.length})</h2>
          {filter && <button className="chip clickable-chip" onClick={() => setFilter(null)}>{categoryOf(filter).label()} <X size={12} /></button>}
        </div>
        <div className="table-wrap">
          <table className="mc t-tx">
            <thead><tr><th>{L("Data", "Date")}</th><th>{L("Descrição", "Description")}</th><th className="right">{L("Valor", "Amount")}</th><th>{L("Categoria", "Category")}</th></tr></thead>
            <tbody>
              {txs.slice(0, 400).map((t) => (
                <tr key={t.id} style={{ opacity: categoryOf(t.category).kind === "ignore" ? 0.55 : 1 }}>
                  <td className="small ga-side">{day(t.date)}</td>
                  <td className="ga-main"><b>{t.description}</b><div className="muted small">{t.accountName} · {t.institution}{t.installment ? ` · ${t.installment.n}/${t.installment.total}` : ""}{t.pending ? ` · ${L("pendente", "pending")}` : ""}</div></td>
                  <td className="right num ga-val" style={{ color: t.amount >= 0 ? "var(--ok)" : undefined }}>{amt(t.amount)}</td>
                  <td className="ga-a" style={{ minWidth: 190 }}>
                    <select className="cell" value={t.category} onChange={(e) => setCategory(t, e.target.value)} aria-label={L("Categoria", "Category")}>
                      {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label()}</option>)}
                    </select>
                    <span className={`chip ${t.categorySource === "ai" ? "warn" : ""}`} style={{ marginLeft: 4 }}>{SOURCE()[t.categorySource]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>{L("Trocar a categoria cria uma regra: vale para as próximas com a mesma descrição, e a IA usa as suas correções como exemplo. Cinza = não conta como gasto (transferência, fatura, aplicação).", "Changing the category creates a rule: it applies to future ones with the same description, and the AI uses your corrections as examples. Grey = not counted as spending (transfer, bill, investment).")}</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="row"><Sparkles size={17} /> {L("Análise dos gastos", "Spending analysis")}</h2>
          <button className="btn sm primary" disabled={advice.running || !config?.hasCredentials} onClick={() => advice.start()}>
            <Sparkles size={14} /> {planning.spendingAdvice ? L("Refazer com IA", "Redo with AI") : L("Analisar com IA", "Analyze with AI")}
          </button>
        </div>
        {advice.running && <JobProgress job={advice} onCancel={advice.cancel} />}
        {advice.error && <Banner kind="bad">{advice.error}</Banner>}
        {planning.spendingAdvice ? (
          <>
            <div className="prose small">{planning.spendingAdvice.text}</div>
            <p className="muted small" style={{ marginTop: 8 }}>{L("Escrito pela IA em", "Written by the AI on")} {new Date(planning.spendingAdvice.at).toLocaleString(locale())}.</p>
          </>
        ) : (
          !advice.running && <p className="muted small">{L("A IA aponta onde dá para economizar e quanto daria para investir por mês.", "The AI points out where to save and how much you could invest per month.")}</p>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>{L("Sincronizado", "Synced")} {view.syncedAt ? new Date(view.syncedAt).toLocaleString(locale()) : "—"} · {L("atualiza sozinho a cada 30 min", "updates on its own every 30 min")}</p>

      {detail && (
        <CashflowDetail
          detail={detail}
          view={view}
          onClose={() => setDetail(null)}
          onFilter={(c) => { setFilter(c); setDetail(null); }}
          onOpen={setDetail}
        />
      )}
    </>
  );
}
