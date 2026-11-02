import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { categoryOf } from "../../shared/cashflow";
import type { CashflowView, ResolvedTx } from "../../shared/cashflowView";
import { amt, amt0, pct } from "../lib/format";
import { L, locale } from "../../shared/i18n";

export type Detail =
  | { kind: "month"; month: string; side: "income" | "expense" | "net" }
  | { kind: "category"; category: string }
  | { kind: "commitment"; month: string }
  | { kind: "recurring"; key: string }
  | { kind: "bill"; accountId: string; month: string };

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const short = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${amt0(Math.abs(n))}`;

/** Janela com o detalhe do que foi clicado na aba Gastos (coluna do gráfico, categoria, mês futuro, recorrente). */
export function CashflowDetail({ detail, view, onClose, onFilter, onOpen }: { detail: Detail; view: CashflowView; onClose: () => void; onFilter: (category: string) => void; onOpen: (d: Detail) => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cf-detail" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="btn icon sm ghost cf-close" onClick={onClose} aria-label={L("Fechar", "Close")}><X size={16} /></button>
        {detail.kind === "month" && <MonthDetail month={detail.month} side={detail.side} view={view} onFilter={onFilter} onOpen={onOpen} />}
        {detail.kind === "category" && <CategoryDetail category={detail.category} view={view} onFilter={onFilter} />}
        {detail.kind === "commitment" && <CommitmentDetail month={detail.month} view={view} onOpen={onOpen} />}
        {detail.kind === "recurring" && <RecurringDetail k={detail.key} view={view} />}
        {detail.kind === "bill" && <BillDetail accountId={detail.accountId} month={detail.month} view={view} />}
      </div>
    </div>
  );
}

/** Média de uma categoria nos 3 meses completos anteriores ao mês. */
function prevAverage(view: CashflowView, month: string, pick: (m: CashflowView["months"][number]) => number): number | null {
  const prev = view.months.filter((m) => m.month < month).slice(-3);
  return prev.length ? prev.reduce((s, m) => s + pick(m), 0) / prev.length : null;
}

function MonthDetail({ month, side, view, onFilter, onOpen }: { month: string; side: "income" | "expense" | "net"; view: CashflowView; onFilter: (c: string) => void; onOpen: (d: Detail) => void }) {
  const m = view.months.find((x) => x.month === month);
  const [open, setOpen] = useState<string | null>(null);
  const loading = view.month !== month;
  if (!m) return <p className="muted">{L("Sem dados neste mês.", "No data for this month.")}</p>;

  if (side === "net") {
    const rate = m.income > 0 ? (m.net / m.income) * 100 : null;
    const avg = prevAverage(view, month, (x) => x.net);
    return (
      <>
        <h2>{L("Sobra de", "Left over in")} {monthLabel(month)}</h2>
        <div className="cf-sum">
          <div><span className="muted">{L("Receitas", "Income")}</span><b className="num" style={{ color: "var(--ok)" }}>{amt0(m.income)}</b></div>
          <div><span className="muted">− {L("Gastos", "Spending")}</span><b className="num" style={{ color: "var(--bad)" }}>{amt0(m.expenses)}</b></div>
          <div className="cf-total"><span>= {L("Sobra", "Left over")}</span><b className="num">{amt0(m.net)}</b></div>
        </div>
        <p className="small">
          {rate != null && <>{L("Taxa de poupança", "Savings rate")}: <b>{pct(rate, 0)}</b>. </>}
          {avg != null && <>{L("Média dos 3 meses anteriores", "Average of the previous 3 months")}: <b>{amt0(avg)}</b> ({signed(m.net - avg)}).</>}
        </p>
        <p className="muted small">{L("Transferências entre suas contas, pagamento de fatura e aplicações/resgates não entram — o gasto do cartão já conta na compra.", "Transfers between your accounts, card bill payments and investments in/out are excluded — card spending already counts when you buy.")}</p>
      </>
    );
  }

  const byCat = side === "income" ? m.incomeByCategory : m.byCategory;
  const total = side === "income" ? m.income : m.expenses;
  const rows = Object.entries(byCat).filter(([, v]) => Math.abs(v) > 0.5).sort((a, b) => b[1] - a[1]);
  const avgTotal = prevAverage(view, month, (x) => (side === "income" ? x.income : x.expenses));
  const txOf = (c: string) => view.tx.filter((t) => t.category === c);
  return (
    <>
      <h2>{side === "income" ? L("Receitas de", "Income in") : L("Gastos de", "Spending in")} {monthLabel(month)}</h2>
      <p className="cf-big num" style={{ color: side === "income" ? "var(--ok)" : "var(--bad)" }}>{amt0(total)}</p>
      {avgTotal != null && <p className="muted small">{L("Média dos 3 meses anteriores", "Previous 3-month average")}: {amt0(avgTotal)} ({signed(total - avgTotal)})</p>}
      <div className="cf-cats">
        {rows.map(([c, v]) => {
          const avg = prevAverage(view, month, (x) => (side === "income" ? x.incomeByCategory[c] : x.byCategory[c]) ?? 0);
          const isOpen = open === c;
          return (
            <div key={c}>
              <button className="cf-cat" onClick={() => setOpen(isOpen ? null : c)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="cf-cat-name">{categoryOf(c).label()}</span>
                <span className="cf-cat-bar"><span style={{ width: `${total > 0 ? Math.min(100, (v / total) * 100) : 0}%`, background: side === "income" ? "var(--ok)" : "var(--bad)" }} /></span>
                <span className="num">{amt0(v)}</span>
                <span className="muted small num cf-cat-share">{total > 0 ? pct((v / total) * 100, 0) : ""}</span>
                {avg != null && avg > 0 && <span className={`small num ${v > avg * 1.15 ? "bad-text" : v < avg * 0.85 ? "ok-text" : "muted"}`}>{signed(v - avg)}</span>}
              </button>
              {isOpen && (
                <div className="cf-tx">
                  {loading ? <p className="muted small"><Loader2 size={13} className="spin" /> {L("Carregando transações…", "Loading transactions…")}</p> : (
                    <>
                      {txOf(c).map((t) => (
                        <div key={t.id} className="row spread small cf-tx-row">
                          <span><span className="muted">{day(t.date)}</span> {t.description}{t.installment ? ` · ${t.installment.n}/${t.installment.total}` : ""} <span className="muted">· {t.accountName}</span></span>
                          <b className="num">{amt(Math.abs(t.amount))}</b>
                        </div>
                      ))}
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm ghost" onClick={() => onOpen({ kind: "category", category: c })}>{L("Histórico da categoria", "Category history")}</button>
                        <button className="btn sm ghost" onClick={() => onFilter(c)}>{L("Ver na tabela", "Show in the table")}</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>{L("Clique numa categoria para ver as transações. À direita: diferença para a média dos 3 meses anteriores.", "Click a category to see its transactions. On the right: difference from the previous 3-month average.")}</p>
    </>
  );
}

function CategoryDetail({ category, view, onFilter }: { category: string; view: CashflowView; onFilter: (c: string) => void }) {
  const income = categoryOf(category).kind === "income";
  const series = view.months.map((m) => ({ month: m.month, v: Math.max(0, (income ? m.incomeByCategory[category] : m.byCategory[category]) ?? 0) }));
  const done = series.filter((s) => s.month < new Date().toISOString().slice(0, 7));
  const avg = done.length ? done.slice(-6).reduce((s, x) => s + x.v, 0) / Math.min(6, done.length) : 0;
  const budget = view.budgets.find((b) => b.category === category);
  const tx = view.tx.filter((t) => t.category === category);
  return (
    <>
      <h2>{categoryOf(category).label()}</h2>
      <p className="muted small">{L("Média dos últimos 6 meses", "Last 6-month average")}: <b>{amt0(avg)}</b>/{L("mês", "mo")} · {L("por ano", "per year")} ≈ {amt0(avg * 12)}</p>
      <div style={{ height: 150, margin: "8px 0" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ left: 0, right: 0, top: 4 }}>
            <XAxis dataKey="month" tickFormatter={short} tick={{ fontSize: 10 }} stroke="var(--muted)" interval={0} />
            <Tooltip formatter={(v) => [amt0(Number(v)), categoryOf(category).label()]} labelFormatter={(m) => monthLabel(String(m))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }} />
            <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {series.map((s) => <Cell key={s.month} fill={s.month === view.month ? "var(--accent)" : income ? "var(--ok)" : "var(--bad)"} fillOpacity={s.month === view.month ? 1 : 0.55} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {budget && <p className="small">{L("Orçamento", "Budget")}: {amt0(budget.spent)} {L("de", "of")} {amt0(budget.limit)} ({pct(budget.pct * 100, 0)}) · {L("no ritmo atual", "at this pace")} {amt0(budget.projected)}</p>}
      <h3 style={{ marginTop: 10 }}>{monthLabel(view.month)} ({tx.length})</h3>
      <div className="cf-tx">
        {tx.map((t) => (
          <div key={t.id} className="row spread small cf-tx-row">
            <span><span className="muted">{day(t.date)}</span> {t.description} <span className="muted">· {t.accountName}</span></span>
            <b className="num">{amt(Math.abs(t.amount))}</b>
          </div>
        ))}
        {!tx.length && <p className="muted small">{L("Nada nesta categoria no mês.", "Nothing in this category this month.")}</p>}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => onFilter(category)}>{L("Filtrar a tabela por esta categoria", "Filter the table by this category")}</button>
    </>
  );
}

function CommitmentDetail({ month, view, onOpen }: { month: string; view: CashflowView; onOpen: (d: Detail) => void }) {
  const c = view.commitments.find((x) => x.month === month);
  if (!c) return null;
  const groups: [string, typeof c.items][] = [
    [L("Faturas de cartão", "Card bills"), c.items.filter((i) => i.kind === "bill")],
    [L("Recorrentes ainda não cobrados", "Recurring not yet charged"), c.items.filter((i) => i.kind === "recurring")],
  ];
  return (
    <>
      <h2>{L("Compromissos de", "Commitments for")} {monthLabel(month)}</h2>
      <p className="cf-big num">{amt0(c.total)}</p>
      {groups.filter(([, items]) => items.length).map(([title, items]) => (
        <div key={title} style={{ marginTop: 12 }}>
          <div className="row spread"><h3>{title} ({items.length})</h3><b className="num">{amt0(items.reduce((s, i) => s + i.amount, 0))}</b></div>
          <div className="cf-tx">
            {items.map((i, k) =>
              i.kind === "bill" && i.accountId ? (
                <button key={k} className="list-row small" onClick={() => onOpen({ kind: "bill", accountId: i.accountId!, month })}>
                  <span><span className="muted">{day(i.date)}</span> {i.label} <span className="muted">· {i.detail}</span></span>
                  <span className="num"><b>{amt(i.amount)}</b> <ChevronRight size={13} /></span>
                </button>
              ) : (
                <div key={k} className="row spread small cf-tx-row">
                  <span><span className="muted">{day(i.date)}</span> {i.label} <span className="muted">· {i.detail}</span></span>
                  <b className="num">{amt(i.amount)}</b>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
      <p className="muted small" style={{ marginTop: 10 }}>{L("Cada fatura soma os lançamentos que caem nela (com as parcelas), menos estornos. Faturas dos meses seguintes ainda só têm parcelas — as compras novas entram conforme você usa o cartão.", "Each bill adds up the charges that fall in it (including installments), minus refunds. Later months' bills only have installments so far — new purchases are added as you use the card.")}</p>
    </>
  );
}

function RecurringDetail({ k, view }: { k: string; view: CashflowView }) {
  const r = view.recurring.find((x) => x.key === k);
  if (!r) return null;
  const last6 = r.occurrences.slice(0, 6).reduce((s, o) => s + o.amount, 0);
  return (
    <>
      <h2>{r.label}</h2>
      <p className="muted small">{categoryOf(r.category).label()} · {r.account}</p>
      <div className="cf-sum">
        <div><span className="muted">{L("Por mês", "Per month")}</span><b className="num">{amt(r.amount)}</b></div>
        <div><span className="muted">{L("Por ano", "Per year")}</span><b className="num">{amt0(r.amount * 12)}</b></div>
        <div><span className="muted">{L("Próxima", "Next")}</span><b>~{day(r.nextDate)}</b></div>
      </div>
      <h3 style={{ marginTop: 10 }}>{L("Cobranças", "Charges")} ({r.occurrences.length})</h3>
      <div className="cf-tx">
        {r.occurrences.map((o, i) => (
          <div key={i} className="row spread small cf-tx-row"><span className="muted">{new Date(`${o.date}T12:00:00Z`).toLocaleDateString(locale())}</span><b className="num">{amt(o.amount)}</b></div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>{L(`Nos últimos 6 meses: ${amt0(last6)}. Se não usa mais, vale cancelar.`, `Last 6 months: ${amt0(last6)}. If you no longer use it, consider cancelling.`)}</p>
    </>
  );
}

function BillDetail({ accountId, month, view }: { accountId: string; month: string; view: CashflowView }) {
  const b = view.cardBills.find((x) => x.accountId === accountId && x.month === month);
  if (!b) return <p className="muted">{L("Fatura não encontrada.", "Bill not found.")}</p>;
  const purchases = b.tx.filter((t) => !t.installment);
  const installments = b.tx.filter((t) => t.installment);
  const list = (title: string, txs: typeof b.tx) =>
    txs.length > 0 && (
      <div style={{ marginTop: 12 }}>
        <div className="row spread"><h3>{title} ({txs.length})</h3><b className="num">{amt(txs.reduce((s, t) => s - t.amount, 0))}</b></div>
        <div className="cf-tx">
          {txs.map((t) => (
            <div key={t.id} className="row spread small cf-tx-row">
              <span><span className="muted">{day(t.date)}</span> {t.description}{t.installment ? ` · ${t.installment.n}/${t.installment.total}` : ""} <span className="muted">· {categoryOf((t as ResolvedTx).category ?? "outros").label()}</span></span>
              <b className="num" style={{ color: t.amount > 0 ? "var(--ok)" : undefined }}>{amt(-t.amount)}</b>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <>
      <h2>{b.accountName}</h2>
      <p className="muted small">{b.institution} · {L("fatura de", "bill for")} {monthLabel(month)} · {L("vence", "due")} {new Date(`${b.dueDate}T12:00:00Z`).toLocaleDateString(locale())}{b.open ? ` · ${L("aberta", "open")}` : ` · ${L("futura", "future")}`}</p>
      <p className="cf-big num">{amt(b.total)}</p>
      {list(L("Compras do mês", "This month's purchases"), purchases)}
      {list(L("Parcelas", "Installments"), installments)}
      <p className="muted small" style={{ marginTop: 10 }}>{L("Total = compras e parcelas da fatura menos estornos. O pagamento da fatura anterior não entra.", "Total = purchases and installments in the bill minus refunds. The previous bill's payment is excluded.")}</p>
    </>
  );
}
