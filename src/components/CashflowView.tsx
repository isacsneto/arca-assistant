import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, Loader2, Receipt, RefreshCw, Repeat, Sparkles, Wallet } from "lucide-react";
import { CATEGORIES, categoryOf, normDesc } from "../../shared/cashflow";
import type { CashflowView as View, ResolvedTx } from "../../shared/cashflowView";
import { planningOf, type Planning } from "../../shared/planning";
import { api } from "../api";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { amt, amt0, amtCompact, pct } from "../lib/format";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short", year: "2-digit" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const SOURCE = (): Record<ResolvedTx["categorySource"], string> => ({ rule: L("sua regra", "your rule"), ai: "IA", pluggy: L("banco", "bank"), default: "?" });

/** Gastos e receitas (conta e cartão, via Open Finance): categorias pela IA, orçamentos, recorrentes, faturas e reserva. */
export function CashflowView({ goSettings }: { goSettings: () => void }) {
  const { state, update, config } = useStore();
  const planning = planningOf(state!.planning);
  const [view, setView] = useState<View | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const setPlanning = (fn: (p: Planning) => Planning) => update((s) => ({ ...s, planning: fn(planningOf(s.planning)) }));
  const advice = useJob<{ text: string; at: string }>("/api/cashflow/advice", (r) => setPlanning((p) => ({ ...p, spendingAdvice: r })));

  // Regras mudam a categoria: recarrega a visão (o servidor resolve com as regras salvas).
  useEffect(() => {
    api.cashflow(month).then(setView).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [month, state?.rev, state?.planning]);

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

  const setCategory = (t: ResolvedTx, category: string) =>
    // Vale para esta e para as próximas com a mesma descrição (a IA também aprende com isso).
    setPlanning((p) => ({ ...p, categoryRules: [...p.categoryRules.filter((r) => normDesc(r.match) !== normDesc(t.description)), { match: normDesc(t.description), category }] }));
  const setBudget = (category: string, limit: number) =>
    setPlanning((p) => ({ ...p, budgets: limit > 0 ? [...p.budgets.filter((b) => b.category !== category), { category, limit }] : p.budgets.filter((b) => b.category !== category) }));

  const current = view?.months.find((m) => m.month === view.month);
  const cats = useMemo(() => (current ? Object.entries(current.byCategory).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]) : []), [current]);

  if (error && !view) return <Banner kind="bad">{error}</Banner>;
  if (!view) return <p className="muted">{L("Carregando…", "Loading…")}</p>;

  const head = (
    <PageHead
      title={L("Gastos", "Spending")}
      subtitle={L("Conta e cartão pelo Open Finance: para onde vai o dinheiro, quanto sobra para investir, assinaturas, faturas e a sua reserva.", "Accounts and cards through Open Finance: where the money goes, how much is left to invest, subscriptions, bills and your emergency fund.")}
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

  const savingsRate = current && current.income > 0 ? (current.net / current.income) * 100 : null;
  const txs = filter ? view.tx.filter((t) => t.category === filter) : view.tx;

  return (
    <>
      {head}
      {error && <Banner kind="bad">{error}</Banner>}
      {view.error && <Banner kind="warn">{L("Parte das contas não sincronizou:", "Some accounts didn't sync:")} {view.error}</Banner>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">{L("Receitas", "Income")} · {monthLabel(view.month)}</div><div className="value num" style={{ color: "var(--ok)" }}>{amt0(current?.income ?? 0)}</div></div>
        <div className="kpi"><div className="label">{L("Gastos", "Spending")}</div><div className="value num" style={{ color: "var(--bad)" }}>{amt0(current?.expenses ?? 0)}</div></div>
        <div className="kpi"><div className="label">{L("Sobra", "Left over")}</div><div className="value num" style={{ color: (current?.net ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(current?.net ?? 0)}</div>
          <div className="sub">{savingsRate != null ? `${L("taxa de poupança", "savings rate")} ${pct(savingsRate, 0)}` : ""}</div></div>
        <div className="kpi"><div className="label">{L("Sobra média para investir", "Average left to invest")}</div><div className="value num">{view.capacity ? amt0(view.capacity.average) : "—"}</div>
          <div className="sub">{L("por mês, últimos 3 meses", "per month, last 3 months")}</div></div>
        <div className="kpi"><div className="label"><Wallet size={13} /> {L("Reserva cobre", "Emergency fund covers")}</div><div className="value num">{view.reserve.months != null ? `${view.reserve.months.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${L("meses", "months")}` : "—"}</div>
          <div className="sub">{amt0(view.reserve.value)} {view.reserve.source === "goal" ? L("(meta de reserva)", "(emergency-fund goal)") : L("(caixa com liquidez diária)", "(cash with daily liquidity)")} · {L("gasto médio", "avg spend")} {amt0(view.reserve.avgExpenses)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h2>{L("Receitas × gastos", "Income × spending")}</h2></div>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={view.months.map((m) => ({ month: m.month, income: m.income, expenses: m.expenses }))} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <YAxis tickFormatter={(v: number) => amtCompact(v)} width={68} tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <Tooltip formatter={(v, k) => [amt0(Number(v)), k === "income" ? L("Receitas", "Income") : L("Gastos", "Spending")]} labelFormatter={(m) => monthLabel(String(m))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Bar dataKey="income" fill="var(--ok)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="expenses" fill="var(--bad)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>{L("Por categoria", "By category")}</h2>
            {view.suggestedBudgets.length > 0 && planning.budgets.length === 0 && (
              <button className="btn sm" onClick={() => setPlanning((p) => ({ ...p, budgets: view.suggestedBudgets }))} title={L("Mediana dos últimos 3 meses de cada categoria", "Median of each category over the last 3 months")}>
                {L("Criar orçamentos sugeridos", "Create suggested budgets")}
              </button>
            )}
          </div>
          <div className="cat-list">
            {cats.map(([c, v]) => {
              const b = view.budgets.find((x) => x.category === c);
              const ratio = b ? b.spent / b.limit : null;
              return (
                <div key={c} className={`cat-row ${filter === c ? "on" : ""}`}>
                  <button className="link" onClick={() => setFilter(filter === c ? null : c)}>{categoryOf(c).label()}</button>
                  <span className="num">{amt0(v)}</span>
                  {b ? (
                    <div className="bar" title={L(`Limite ${amt0(b.limit)} · no ritmo atual: ${amt0(b.projected)}`, `Limit ${amt0(b.limit)} · at this pace: ${amt0(b.projected)}`)}>
                      <div style={{ width: `${Math.min(100, (ratio ?? 0) * 100)}%`, background: (ratio ?? 0) > 1 ? "var(--bad)" : b.projected > b.limit ? "var(--warn)" : "var(--ok)" }} />
                    </div>
                  ) : <div />}
                  <input className="cell num" type="number" min={0} step={50} placeholder={L("limite", "limit")} defaultValue={b?.limit ?? ""} key={`${c}-${b?.limit ?? 0}`}
                    onBlur={(e) => setBudget(c, Number(e.target.value) || 0)} aria-label={L(`Limite de ${categoryOf(c).label()}`, `${categoryOf(c).label()} limit`)} />
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>{L("Clique na categoria para filtrar as transações. O limite vira um orçamento mensal (barra: verde ok, amarelo vai estourar no ritmo atual, vermelho estourou).", "Click a category to filter transactions. The limit becomes a monthly budget (bar: green ok, yellow will overshoot at this pace, red overshot).")}</p>
        </div>

        <div className="card">
          <div className="card-head"><h2 className="row"><CalendarClock size={17} /> {L("Próximos meses", "Next months")}</h2></div>
          <table className="mc">
            <thead><tr><th>{L("Mês", "Month")}</th><th className="right">{L("Faturas", "Bills")}</th><th className="right">{L("Parcelas", "Installments")}</th><th className="right">{L("Recorrentes", "Recurring")}</th><th className="right">{L("Total", "Total")}</th></tr></thead>
            <tbody>
              {view.commitments.map((c) => (
                <tr key={c.month}><td>{monthLabel(c.month)}</td><td className="right num">{amt0(c.bills)}</td><td className="right num">{amt0(c.installments)}</td><td className="right num">{amt0(c.recurring)}</td><td className="right num"><b>{amt0(c.total)}</b></td></tr>
              ))}
            </tbody>
          </table>
          {view.bills.some((b) => b.open) && (
            <>
              <h3 className="row" style={{ marginTop: 14 }}><Receipt size={15} /> {L("Faturas abertas", "Open bills")}</h3>
              {view.bills.filter((b) => b.open).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).map((b) => (
                <div key={b.id} className="row spread small" style={{ padding: "4px 0" }}><span>{b.accountName} · {b.institution} · {L("vence", "due")} {day(b.dueDate)}</span><b className="num">{amt(b.total)}</b></div>
              ))}
            </>
          )}
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
              <thead><tr><th>{L("O quê", "What")}</th><th>{L("Categoria", "Category")}</th><th className="right">{L("Valor/mês", "Per month")}</th><th>{L("Próximo", "Next")}</th><th>{L("Meses", "Months")}</th></tr></thead>
              <tbody>
                {view.recurring.map((r) => (
                  <tr key={r.key}><td className="ga-main"><b>{r.label}</b><div className="muted small">{r.account}</div></td><td className="small">{categoryOf(r.category).label()}</td><td className="right num">{amt(r.amount)}</td><td className="small">~{day(r.nextDate)}</td><td className="small">{r.months}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>{L("Mesmo estabelecimento em 3+ meses dos últimos 6, com valor estável. Vale revisar assinaturas esquecidas.", "Same merchant in 3+ of the last 6 months, with a stable amount. Worth reviewing forgotten subscriptions.")}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>{L("Transações", "Transactions")} · {monthLabel(view.month)}{filter ? ` · ${categoryOf(filter).label()}` : ""} ({txs.length})</h2>
          {filter && <button className="btn sm ghost" onClick={() => setFilter(null)}>{L("Ver todas", "Show all")}</button>}
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
          !advice.running && <p className="muted small">{L("A IA aponta onde dá para economizar, sugere orçamentos e quanto daria para investir por mês.", "The AI points out where to save, suggests budgets and how much you could invest per month.")}</p>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>{L("Sincronizado", "Synced")} {view.syncedAt ? new Date(view.syncedAt).toLocaleString(locale()) : "—"} · {L("atualiza sozinho a cada 30 min", "updates on its own every 30 min")}</p>
    </>
  );
}
