import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarClock, Check, CircleDashed, Clock, Landmark, Link2, Loader2, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  EMPTY_PLAN, PLAN_OWNERS, PLAN_STATUSES, STATUS_LABEL, cardsMissing, hasLink, linkWithTx, planGrid, planYears,
  type GridCell, type MonthlyPlan, type PlanCard, type PlanCell, type PlanKind, type PlanLine, type PlanOwner, type PlanStatus,
} from "../../shared/monthlyPlan";
import { planningOf } from "../../shared/planning";
import { brDay } from "../../shared/history";
import { toBRL } from "../../shared/arca";
import { categoryOf } from "../../shared/cashflow";
import { api, type PlanAutoResponse, type PlanImportResponse, type PlanTx } from "../api";
import { useStore } from "../store";
import { amt, amt0, pct, uid } from "../lib/format";
import { Banner, Empty, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const short = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "short" }).replace(".", "");
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const KIND_LABEL = (): Record<PlanKind, string> => ({ expense: L("Conta (despesa)", "Bill (expense)"), income: L("Renda", "Income"), info: L("Só informativo", "Info only") });

function StatusIcon({ s, size = 12 }: { s: PlanStatus | null; size?: number }) {
  if (s === "pago") return <Check size={size} />;
  if (s === "iniciado") return <CircleDashed size={size} />;
  if (s === "aguardando") return <Clock size={size} />;
  if (s === "previsto") return <CalendarClock size={size} />;
  return null;
}

type Open = { kind: "cell"; lineId: string; month: string } | { kind: "line"; lineId: string } | null;

/** Contas do mês: a planilha de contas a pagar, com o Open Finance marcando o que já saiu. */
export function MonthlyPlanView() {
  const { state, update, view, savedAt, ledgerAt } = useStore();
  const today = brDay(new Date());
  const current = today.slice(0, 7);
  const plan = planningOf(state!.planning).monthlyPlan ?? EMPTY_PLAN;
  const setPlan = (fn: (p: MonthlyPlan) => MonthlyPlan) =>
    update((s) => {
      const pl = planningOf(s.planning);
      return { ...s, planning: { ...pl, monthlyPlan: fn(pl.monthlyPlan ?? EMPTY_PLAN) } };
    });
  const patchLine = (id: string, fn: (l: PlanLine) => PlanLine) => setPlan((p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? fn(l) : l)) }));
  const setCell = (lineId: string, month: string, cell: PlanCell | null) =>
    patchLine(lineId, (l) => {
      const cells = { ...l.cells };
      if (cell && (cell.amount != null || cell.status || cell.note)) cells[month] = cell;
      else delete cells[month];
      return { ...l, cells };
    });

  const years = planYears(plan, today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [owner, setOwner] = useState<"all" | PlanOwner>(view === "all" ? "all" : view);
  const [auto, setAuto] = useState<PlanAutoResponse | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [mobileMonth, setMobileMonth] = useState(current);
  const [busy, setBusy] = useState<"import" | "suggest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanImportResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // O que o banco diz: pede de novo quando o plano muda (vínculos, valores) — com um respiro para digitação.
  const planJson = JSON.stringify(plan.lines);
  useEffect(() => {
    if (!plan.lines.length) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api.planAuto(year, plan).then((r) => alive && setAuto(r)).catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // ledgerAt: fatura/transações novas do Open Finance refazem o cruzamento.
  }, [year, planJson, savedAt, ledgerAt]);

  // Abre já no mês atual (os últimos meses ficam fora da tela à direita).
  useEffect(() => {
    const wrap = wrapRef.current;
    const th = wrap?.querySelector<HTMLElement>("thead th.now");
    const name = wrap?.querySelector<HTMLElement>("thead th.plan-name");
    if (wrap && th && name) wrap.scrollLeft = Math.max(0, th.offsetLeft - name.offsetWidth - th.offsetWidth * 3);
  }, [year, plan.lines.length]);

  const shown = useMemo(() => (owner === "all" ? plan : { ...plan, lines: plan.lines.filter((l) => l.owner === owner) }), [plan, owner]);
  const grid = useMemo(() => planGrid(shown, year, auto?.auto ?? {}, today), [shown, year, auto, today]);
  const netWorth = state!.positions.reduce((s, p) => s + toBRL(p, state!.settings.fx), 0);

  const doImport = async (file: File) => {
    setBusy("import");
    setError(null);
    try {
      setPreview(await api.planImport(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const doSuggest = async () => {
    setBusy("suggest");
    setError(null);
    try {
      const r = await api.planSuggest(plan);
      setPlan(() => r.plan);
      setNotice(r.linked ? L(`${r.linked} contas ligadas ao Open Finance.`, `${r.linked} bills linked to Open Finance.`) : L("Nenhuma conta nova para ligar: nada bateu em valor e mês com o que veio do banco.", "No new bills to link: nothing matched the bank by amount and month."));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const addLine = () => {
    const id = uid();
    setPlan((p) => ({ ...p, lines: [...p.lines, { id, name: L("Nova conta", "New bill"), owner: owner === "all" ? "PF" : owner, kind: "expense", cells: {} }] }));
    setOpen({ kind: "line", lineId: id });
  };

  const fileInput = <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.ods" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />;
  const head = (
    <PageHead
      title={L("Contas do mês", "Monthly bills")}
      subtitle={L("O que sai em cada mês, conta por conta — o Open Finance marca o que já foi pago.", "What goes out each month, bill by bill — Open Finance marks what's already paid.")}
      actions={plan.lines.length > 0 && (
        <>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={L("Ano", "Year")}>
            {[...new Set([...years, year + 1])].sort().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn sm" onClick={() => void doSuggest()} disabled={busy != null} title={L("Liga ao banco as contas que batem em valor e mês com faturas e lançamentos", "Links bills that match card bills and transactions by amount and month")}>
            {busy === "suggest" ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} {L("Ligar ao banco", "Link to bank")}
          </button>
          <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy != null}>
            {busy === "import" ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {L("Importar planilha", "Import spreadsheet")}
          </button>
          <button className="btn sm primary" onClick={addLine}><Plus size={14} /> {L("Nova conta", "New bill")}</button>
        </>
      )}
    />
  );

  if (!plan.lines.length) {
    return (
      <>
        {head}
        {fileInput}
        {error && <Banner kind="bad">{error}</Banner>}
        <div className="card">
          <Empty title={L("Traga a sua planilha de contas", "Bring your bills spreadsheet")}>
            <p className="muted">{L("Uma aba por ano, uma linha por conta e os meses nas colunas. A cor de cada célula vira o status (pago, aguardando…), e as contas que aparecem no Open Finance passam a se marcar sozinhas.", "One tab per year, one row per bill, months in columns. Each cell's color becomes the status (paid, awaiting…), and bills that show up in Open Finance start marking themselves.")}</p>
            <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy != null}>
                {busy === "import" ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {L("Importar planilha (.xlsx)", "Import spreadsheet (.xlsx)")}
              </button>
              <button className="btn" onClick={addLine}><Plus size={16} /> {L("Começar do zero", "Start from scratch")}</button>
            </div>
          </Empty>
        </div>
        {preview && <ImportPreview res={preview} replacing={false} onCancel={() => setPreview(null)} onConfirm={() => { setPlan(() => preview.plan); setYear(Number(today.slice(0, 4))); setPreview(null); }} />}
      </>
    );
  }

  const ci = grid.months.indexOf(current);
  const focus = ci >= 0 ? grid.totals[ci] : null;
  const onePct = netWorth * 0.01;
  const rowsOf = (k: PlanKind) => grid.rows.filter((r) => r.line.kind === k);
  const sections = [...new Set(rowsOf("info").map((r) => r.line.section ?? L("Outros", "Other")))];

  const cellBtn = (lineId: string, c: GridCell, isIncome = false) => (
    <button
      type="button"
      className={`plan-cell${c.status ? ` st-${c.status}` : ""}${c.forecast ? " forecast" : ""}${c.month === current ? " now" : ""}`}
      onClick={() => setOpen({ kind: "cell", lineId, month: c.month })}
      title={[c.status ? STATUS_LABEL()[c.status] : null, c.forecast ? L("previsão", "forecast") : null, c.planned != null ? L(`planejado ${amt(c.planned)}`, `planned ${amt(c.planned)}`) : null, c.auto ? L("dado do banco", "from the bank") : null, c.note].filter(Boolean).join(" · ") || undefined}
    >
      <span className="num">{c.amount == null || (c.amount === 0 && !c.status) ? "—" : amt0(c.amount)}</span>
      {!isIncome && <span className="plan-ic">{c.auto && c.statusSource === "auto" && <Landmark size={10} />}<StatusIcon s={c.status} /></span>}
    </button>
  );

  return (
    <>
      {head}
      {fileInput}
      {error && <Banner kind="bad">{error}</Banner>}
      {notice && <Banner kind="ok"><span className="row" style={{ justifyContent: "space-between", gap: 8 }}>{notice}<button className="btn ghost icon sm" onClick={() => setNotice(null)} aria-label={L("Fechar", "Close")}><X size={14} /></button></span></Banner>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {focus ? (
          <>
            <div className="card kpi"><div className="label">{L("Contas de", "Bills in")} {monthLabel(current)}</div><div className="value num">{amt0(focus.expenses)}</div>
              <div className="sub">{L("já pago", "paid")} {amt0(focus.paid)}</div></div>
            <div className="card kpi"><div className="label">{L("Falta pagar", "Still to pay")}</div><div className="value num" style={{ color: focus.open > 0 ? "var(--warn)" : "var(--ok)" }}>{amt0(focus.open)}</div>
              <div className="sub">{grid.rows.filter((r) => r.line.kind === "expense" && r.cells[ci].status && r.cells[ci].status !== "pago" && (r.cells[ci].amount ?? 0) > 0).length} {L("contas em aberto", "open bills")}</div></div>
            <div className="card kpi"><div className="label">{L("Sobra do mês", "Left this month")}</div><div className="value num" style={{ color: focus.surplus >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(focus.surplus)}</div>
              <div className="sub">{L("renda", "income")} {amt0(focus.income)}</div></div>
          </>
        ) : (
          <>
            <div className="card kpi"><div className="label">{L("Contas no ano", "Bills this year")}</div><div className="value num">{amt0(grid.year.expenses)}</div></div>
            <div className="card kpi"><div className="label">{L("Renda no ano", "Income this year")}</div><div className="value num">{amt0(grid.year.income)}</div></div>
            <div className="card kpi"><div className="label">{L("Sobra no ano", "Left this year")}</div><div className="value num" style={{ color: grid.year.surplus >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(grid.year.surplus)}</div></div>
          </>
        )}
        <div className="card kpi"><div className="label">{L("Modo contenção", "Lean mode")}</div><div className="value num">{grid.contention > 0 ? amt0(grid.contention) : "—"}</div>
          <div className="sub">{grid.contention > 0 && netWorth > 0
            ? <span style={{ color: grid.contention <= onePct ? "var(--ok)" : "var(--warn)" }}>{pct((grid.contention / netWorth) * 100, 2)} {L("do patrimônio/mês", "of net worth/mo")} · 1% = {amt0(onePct)}</span>
            : L("defina em cada conta", "set it on each bill")}</div></div>
      </div>

      <div className="row wrap plan-filters" style={{ gap: 6, marginBottom: 10 }}>
        <div className="seg" role="radiogroup" aria-label={L("Titular", "Owner")}>
          {(["all", ...PLAN_OWNERS] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={owner === o} className={owner === o ? "active" : ""} onClick={() => setOwner(o)}>{o === "all" ? L("Todas", "All") : o}</button>
          ))}
        </div>
        <span className="grow" />
        <span className="plan-legend muted small">
          {PLAN_STATUSES.map((s) => <span key={s} className={`plan-key st-${s}`}><StatusIcon s={s} /> {STATUS_LABEL()[s]}</span>)}
          <span className="plan-key"><Landmark size={11} /> {L("pelo banco", "from bank")}</span>
          <span className="plan-key forecast">{L("itálico = previsão", "italic = forecast")}</span>
        </span>
      </div>

      {/* Computador: a planilha. */}
      <div className="card plan-desk">
        <div className="table-wrap plan-wrap" ref={wrapRef}>
          <table className="plan-grid">
            <thead>
              <tr>
                <th className="plan-name">{L("Conta", "Bill")}</th>
                {grid.months.map((m) => <th key={m} className={`right${m === current ? " now" : ""}`}>{short(m)}</th>)}
                <th className="right">{L("Ano", "Year")}</th>
                <th className="right" title={L("Quanto essa conta custaria no modo contenção", "What this bill would cost in lean mode")}>{L("Contenção", "Lean")}</th>
              </tr>
            </thead>
            <tbody>
              {rowsOf("expense").map((r) => (
                <tr key={r.line.id}>
                  <th className="plan-name"><LineName line={r.line} onClick={() => setOpen({ kind: "line", lineId: r.line.id })} /></th>
                  {r.cells.map((c) => <td key={c.month}>{cellBtn(r.line.id, c)}</td>)}
                  <td className="right num muted">{amt0(r.total)}</td>
                  <td className="right num muted">{r.line.contention ? amt0(r.line.contention) : ""}</td>
                </tr>
              ))}
              <tr className="plan-total">
                <th className="plan-name">{L("Total de contas", "Total bills")}</th>
                {grid.totals.map((t) => <td key={t.month} className={`right num${t.month === current ? " now" : ""}`}>{amt0(t.expenses)}</td>)}
                <td className="right num">{amt0(grid.year.expenses)}</td>
                <td className="right num">{grid.contention ? amt0(grid.contention) : ""}</td>
              </tr>
              {rowsOf("income").map((r) => (
                <tr key={r.line.id} className="plan-income">
                  <th className="plan-name"><LineName line={r.line} onClick={() => setOpen({ kind: "line", lineId: r.line.id })} /></th>
                  {r.cells.map((c) => <td key={c.month}>{cellBtn(r.line.id, c, true)}</td>)}
                  <td className="right num muted">{amt0(r.total)}</td>
                  <td />
                </tr>
              ))}
              <tr className="plan-total">
                <th className="plan-name">{L("Sobra", "Left over")}</th>
                {grid.totals.map((t) => <td key={t.month} className={`right num${t.month === current ? " now" : ""}`} style={{ color: t.surplus >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(t.surplus)}</td>)}
                <td className="right num" style={{ color: grid.year.surplus >= 0 ? "var(--ok)" : "var(--bad)" }}>{amt0(grid.year.surplus)}</td>
                <td />
              </tr>
              {sections.map((sec) => {
                const rs = rowsOf("info").filter((r) => (r.line.section ?? L("Outros", "Other")) === sec);
                return [
                  <tr key={`h-${sec}`} className="plan-section"><th className="plan-name" colSpan={15}>{sec} <span className="muted small">· {L("fora dos totais", "not in totals")}</span></th></tr>,
                  ...rs.map((r) => (
                    <tr key={r.line.id}>
                      <th className="plan-name"><LineName line={r.line} onClick={() => setOpen({ kind: "line", lineId: r.line.id })} /></th>
                      {r.cells.map((c) => <td key={c.month}>{cellBtn(r.line.id, c, true)}</td>)}
                      <td className="right num muted">{amt0(r.total)}</td>
                      <td />
                    </tr>
                  )),
                  <tr key={`t-${sec}`} className="plan-total">
                    <th className="plan-name">{L("Total", "Total")}</th>
                    {grid.months.map((m, i) => <td key={m} className="right num">{amt0(rs.reduce((s, r) => s + (r.cells[i].amount ?? 0), 0))}</td>)}
                    <td className="right num">{amt0(rs.reduce((s, r) => s + r.total, 0))}</td>
                    <td />
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Celular: um mês por vez. */}
      <div className="card plan-mobile">
        <div className="plan-months" role="tablist">
          {grid.months.map((m) => (
            <button key={m} role="tab" aria-selected={m === mobileMonth} className={`chip-btn${m === mobileMonth ? " active" : ""}`} onClick={() => setMobileMonth(m)}>{short(m)}</button>
          ))}
        </div>
        {(() => {
          const i = Math.max(0, grid.months.indexOf(mobileMonth));
          const t = grid.totals[i];
          return (
            <>
              <div className="row" style={{ justifyContent: "space-between", margin: "10px 0 4px" }}>
                <b>{monthLabel(grid.months[i])}</b>
                <span className="num small">{amt0(t.expenses)} · <span style={{ color: t.surplus >= 0 ? "var(--ok)" : "var(--bad)" }}>{L("sobra", "left")} {amt0(t.surplus)}</span></span>
              </div>
              {grid.rows.filter((r) => r.line.kind !== "info" && r.cells[i].amount != null && (r.cells[i].amount !== 0 || r.cells[i].status)).map((r) => {
                const c = r.cells[i];
                return (
                  <button key={r.line.id} className="list-row" onClick={() => setOpen({ kind: "cell", lineId: r.line.id, month: c.month })}>
                    <span className="grow">
                      <span>{r.line.name}</span> <span className={`chip owner-${r.line.owner}`}>{r.line.owner}</span>
                      <div className="muted small">{r.line.kind === "income" ? L("renda", "income") : c.status ? STATUS_LABEL()[c.status] : ""}{c.forecast ? ` · ${L("previsão", "forecast")}` : ""}</div>
                    </span>
                    <span className={`num plan-mob-val${c.status ? ` st-${c.status}` : ""}`}>{amt0(c.amount ?? 0)} <StatusIcon s={c.status} /></span>
                  </button>
                );
              })}
            </>
          );
        })()}
      </div>

      {open?.kind === "cell" && (() => {
        const row = grid.rows.find((r) => r.line.id === open.lineId);
        const line = plan.lines.find((l) => l.id === open.lineId);
        const cell = row?.cells.find((c) => c.month === open.month);
        if (!line || !cell) return null;
        return <CellModal line={line} cell={cell} month={open.month} cards={auto?.cards ?? []} onClose={() => setOpen(null)}
          onSave={(c) => setCell(line.id, open.month, c)} onLink={(link) => patchLine(line.id, (l) => ({ ...l, link }))} onEditLine={() => setOpen({ kind: "line", lineId: line.id })} />;
      })()}
      {open?.kind === "line" && (() => {
        const line = plan.lines.find((l) => l.id === open.lineId);
        if (!line) return null;
        return <LineModal line={line} cards={auto?.cards ?? []} missing={cardsMissing(plan, auto?.cards ?? [], today)} onClose={() => setOpen(null)} onSave={(l) => patchLine(line.id, () => l)}
          onDelete={() => { setPlan((p) => ({ ...p, lines: p.lines.filter((l) => l.id !== line.id) })); setOpen(null); }} />;
      })()}
      {preview && <ImportPreview res={preview} replacing onCancel={() => setPreview(null)} onConfirm={() => { setPlan(() => preview.plan); setPreview(null); setNotice(L("Planilha importada.", "Spreadsheet imported.")); }} />}
    </>
  );
}

function LineName({ line, onClick }: { line: PlanLine; onClick: () => void }) {
  return (
    <button type="button" className="plan-line" onClick={onClick} title={line.note ?? undefined}>
      <span className={`chip owner-${line.owner}`}>{line.owner}</span>
      <span className="plan-line-name">{line.name}</span>
      {hasLink(line) && <Link2 size={12} className="muted" aria-label={L("ligada ao banco", "linked to bank")} />}
    </button>
  );
}

function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal cf-detail${wide ? " wide" : ""}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="btn icon sm ghost cf-close" onClick={onClose} aria-label={L("Fechar", "Close")}><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

/** Uma célula: valor, status, observação, o que o banco mostra e o vínculo com lançamentos. */
function CellModal({ line, cell, month, cards, onClose, onSave, onLink, onEditLine }: {
  line: PlanLine; cell: GridCell; month: string; cards: PlanAutoResponse["cards"];
  onClose: () => void; onSave: (c: PlanCell | null) => void; onLink: (l: PlanLine["link"]) => void; onEditLine: () => void;
}) {
  const own = line.cells[month];
  // Valor planejado (veio da planilha, sem status): não é "digitado" — o banco ainda pode substituir.
  const planned = own?.amount != null && !own.manual ? own.amount : null;
  const [amount, setAmount] = useState(own?.amount != null && own.manual ? String(own.amount) : "");
  const [status, setStatus] = useState<PlanStatus | "">(own?.status ?? "");
  const [note, setNote] = useState(own?.note ?? "");
  const [txs, setTxs] = useState<PlanTx[] | null>(null);
  const [q, setQ] = useState("");
  const isIncome = line.kind === "income";
  const card = line.link?.card ? cards.find((c) => c.id === line.link!.card) : null;

  const save = (over?: Partial<PlanCell>) => {
    const a = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    const c: PlanCell = {
      ...(planned != null && { amount: planned }),
      ...(a != null && Number.isFinite(a) && { amount: a, manual: true }),
      ...(status && { status }),
      ...(note.trim() && { note: note.trim() }),
      ...over,
    };
    onSave(c.amount != null || c.status || c.note ? c : null);
    onClose();
  };
  const loadTx = () => api.planTx(month).then((r) => setTxs(r.tx)).catch(() => setTxs([]));

  return (
    <Modal onClose={onClose}>
      <h2 style={{ paddingRight: 32 }}>{line.name}</h2>
      <p className="muted small" style={{ marginTop: 2 }}>
        <span className={`chip owner-${line.owner}`}>{line.owner}</span> {monthLabel(month)} · <button className="link-btn" onClick={onEditLine}>{L("editar a conta", "edit bill")}</button>
      </p>

      <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
        <label className="field" style={{ flex: "1 1 160px" }}>{L("Valor", "Amount")}
          <input type="number" step="0.01" inputMode="decimal" value={amount} placeholder={cell.amount != null ? cell.amount.toFixed(2) : ""} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </label>
        {!isIncome && line.kind !== "info" && (
          <label className="field" style={{ flex: "1 1 180px" }}>{L("Status", "Status")}
            <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus | "")}>
              <option value="">{hasLink(line) ? L("Automático (pelo banco)", "Automatic (from bank)") : L("Sem status", "No status")}</option>
              {PLAN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL()[s]}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>
        {planned != null && amount.trim() === "" && <>{L(`Planejado: ${amt(planned)}. `, `Planned: ${amt(planned)}. `)}</>}
        {amount.trim() === ""
          ? cell.amount != null
            ? L(`Sem valor digitado: vale ${amt(cell.amount)}${cell.forecast ? " (previsão)" : cell.auto ? " (do banco)" : ""}.`, `No amount typed: using ${amt(cell.amount)}${cell.forecast ? " (forecast)" : cell.auto ? " (from bank)" : ""}.`)
            : L("Vazio: sem conta neste mês.", "Empty: no bill this month.")
          : card
            ? L("Fatura de cartão: o digitado vale como previsão; quando a fatura fecha no Open Finance, vale a do banco.", "Card bill: the typed amount is a forecast; once the bill closes in Open Finance, the bank's amount wins.")
            : L("Valor digitado vale mais que o do banco. Apague para voltar ao automático.", "A typed amount wins over the bank's. Clear it to go back to automatic.")}
      </p>
      <label className="field" style={{ marginTop: 8 }}>{L("Observação", "Note")}
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("ex.: pago com PIX da PJ", "e.g. paid via company PIX")} />
      </label>
      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>{L("Cancelar", "Cancel")}</button>
        <button className="btn primary" onClick={() => save()}>{L("Salvar", "Save")}</button>
      </div>

      <h3 style={{ marginTop: 18 }}><Landmark size={14} /> {L("No banco", "At the bank")}</h3>
      {cell.auto ? (
        <>
          <p className="small">
            {cell.auto.source === "card"
              ? L(`Fatura ${card?.name ?? ""}${cell.auto.dueDate ? `, vence ${day(cell.auto.dueDate)}` : ""}: `, `Bill ${card?.name ?? ""}${cell.auto.dueDate ? `, due ${day(cell.auto.dueDate)}` : ""}: `)
              : L(`${cell.auto.tx.length} lançamento(s): `, `${cell.auto.tx.length} transaction(s): `)}
            <b className="num">{amt(cell.auto.amount)}</b>
            {cell.auto.forecast ? L(" (ainda aberta — pode crescer até fechar)", " (still open — may grow until it closes)") : ""}
            {cell.auto.status ? ` · ${STATUS_LABEL()[cell.auto.status]}` : ""}
          </p>
          {cell.auto.tx.map((t) => (
            <div key={t.id} className="list-row" style={{ cursor: "default" }}>
              <span className="grow small">{day(t.date)} · {t.description}<div className="muted">{t.account}</div></span>
              <span className="num small">{amt(Math.abs(t.amount))}</span>
            </div>
          ))}
          {cell.auto.source !== "card" && own?.amount != null && Math.abs(own.amount - cell.auto.amount) > 0.005 && (
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setAmount(""); onSave({ ...(own.status && { status: own.status }), ...(own.note && { note: own.note }), ...(month < brDay(new Date()).slice(0, 7) && { amount: cell.auto!.amount, manual: true }) }); onClose(); }}>
              {L(`Usar o valor do banco (${amt(cell.auto.amount)})`, `Use the bank's amount (${amt(cell.auto.amount)})`)}
            </button>
          )}
        </>
      ) : (
        <p className="muted small">{hasLink(line) ? L("Nada encontrado neste mês.", "Nothing found this month.") : L("Esta conta ainda não está ligada ao banco.", "This bill isn't linked to the bank yet.")}</p>
      )}

      {!card && line.kind !== "info" && (
        <>
          {txs == null ? (
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void loadTx()}><Link2 size={14} /> {L("Ligar a um lançamento deste mês", "Link to a transaction this month")}</button>
          ) : (
            <div style={{ marginTop: 8 }}>
              <p className="muted small">{L("Escolha o lançamento que é esta conta: os próximos com a mesma descrição passam a contar sozinhos.", "Pick the transaction that is this bill: future ones with the same description will count automatically.")}</p>
              <input type="search" placeholder={L("Filtrar…", "Filter…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: "6px 0" }} />
              <div className="plan-tx-list">
                {txs.filter((t) => (isIncome ? t.amount > 0 : t.amount < 0) && t.description.toLowerCase().includes(q.toLowerCase())).map((t) => (
                  <button key={t.id} className="list-row" onClick={() => { onLink(linkWithTx(line.link, t)); onClose(); }}>
                    <span className="grow small">{day(t.date)} · {t.description}<div className="muted">{t.account} · {categoryOf(t.category).label()}</div></span>
                    <span className="num small">{amt(Math.abs(t.amount))}</span>
                  </button>
                ))}
                {!txs.length && <p className="muted small">{L("Sem lançamentos de conta neste mês.", "No account transactions this month.")}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** A conta: nome, titular, tipo, contenção, observação e o vínculo com o banco. */
function LineModal({ line, cards, missing, onClose, onSave, onDelete }: {
  line: PlanLine; cards: PlanAutoResponse["cards"]; missing: PlanCard[]; onClose: () => void; onSave: (l: PlanLine) => void; onDelete: () => void;
}) {
  const [draft, setDraft] = useState(line);
  const [contention, setContention] = useState(line.contention != null ? String(line.contention) : "");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (o: Partial<PlanLine>) => setDraft((d) => ({ ...d, ...o }));
  const save = () => {
    const c = contention.trim() === "" ? null : Number(contention.replace(",", "."));
    onSave({ ...draft, name: draft.name.trim() || line.name, contention: c != null && Number.isFinite(c) ? c : null });
    onClose();
  };
  const pats = draft.link?.patterns ?? [];
  // Conta nova: os cartões do Open Finance que ainda não estão no plano viram atalhos.
  const isNew = !Object.keys(line.cells).length && !hasLink(line);
  return (
    <Modal onClose={onClose}>
      <h2 style={{ paddingRight: 32 }}>{L("Conta", "Bill")}</h2>
      {isNew && missing.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="muted small"><Landmark size={12} /> {L("Do Open Finance, ainda fora da planilha:", "From Open Finance, not in the sheet yet:")}</p>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            {missing.map((c) => (
              <button key={c.id} type="button" className={`btn sm${draft.link?.card === c.id ? " primary" : ""}`}
                onClick={() => set({ name: c.name, owner: c.owner, kind: "expense", link: { card: c.id } })}>
                {c.name} · {c.institution} <span className={`chip owner-${c.owner}`}>{c.owner}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field" style={{ marginTop: 10 }}>{L("Nome", "Name")}<input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
      <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
        <label className="field" style={{ flex: "1 1 120px" }}>{L("Titular", "Owner")}
          <select value={draft.owner} onChange={(e) => set({ owner: e.target.value as PlanOwner })}>{PLAN_OWNERS.map((o) => <option key={o}>{o}</option>)}</select>
        </label>
        <label className="field" style={{ flex: "1 1 160px" }}>{L("Tipo", "Type")}
          <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as PlanKind })}>{(["expense", "income", "info"] as PlanKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL()[k]}</option>)}</select>
        </label>
        {draft.kind === "expense" && (
          <label className="field" style={{ flex: "1 1 140px" }}>{L("Contenção (por mês)", "Lean mode (per month)")}
            <input type="number" step="0.01" value={contention} onChange={(e) => setContention(e.target.value)} placeholder="0,00" />
          </label>
        )}
        {draft.kind === "info" && (
          <label className="field" style={{ flex: "1 1 160px" }}>{L("Grupo", "Group")}<input type="text" value={draft.section ?? ""} onChange={(e) => set({ section: e.target.value || null })} /></label>
        )}
      </div>
      <label className="field" style={{ marginTop: 8 }}>{L("Observação", "Note")}<input type="text" value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value || null })} /></label>

      {draft.kind !== "info" && (
        <>
          <h3 style={{ marginTop: 16 }}><Link2 size={14} /> {L("Ligação com o banco", "Bank link")}</h3>
          {draft.kind === "expense" && (
            <label className="field" style={{ marginTop: 6 }}>{L("Fatura de cartão", "Card bill")}
              <select value={draft.link?.card ?? ""} onChange={(e) => set({ link: e.target.value ? { card: e.target.value } : pats.length ? { ...draft.link, card: null } : null })}>
                <option value="">{L("— não é fatura de cartão —", "— not a card bill —")}</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.institution}</option>)}
              </select>
            </label>
          )}
          {!draft.link?.card && (
            pats.length ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted small">{L("Lançamentos da conta com estas descrições", "Account transactions with these descriptions")}{draft.link?.min != null && draft.link?.max != null ? L(`, entre ${amt0(draft.link.min)} e ${amt0(draft.link.max)}`, `, between ${amt0(draft.link.min)} and ${amt0(draft.link.max)}`) : ""}:</p>
                {pats.map((p) => (
                  <div key={p} className="row" style={{ gap: 6, justifyContent: "space-between", padding: "4px 0" }}>
                    <code className="small">{p}</code>
                    <button className="btn ghost icon sm danger" onClick={() => { const rest = pats.filter((x) => x !== p); set({ link: rest.length ? { ...draft.link, patterns: rest } : null }); }} aria-label={L("Remover", "Remove")}><X size={14} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small" style={{ marginTop: 6 }}>{L("Sem ligação. Para ligar, abra um mês desta conta e escolha o lançamento — ou use \"Ligar ao banco\".", "Not linked. To link, open a month of this bill and pick the transaction — or use \"Link to bank\".")}</p>
            )
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "space-between" }}>
        {confirmDel ? (
          <button className="btn danger" onClick={onDelete} onBlur={() => setConfirmDel(false)} autoFocus><Trash2 size={14} /> {L("Apagar com o histórico", "Delete with history")}</button>
        ) : (
          <button className="btn ghost danger" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {L("Apagar conta", "Delete bill")}</button>
        )}
        <span className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>{L("Cancelar", "Cancel")}</button>
          <button className="btn primary" onClick={save}>{L("Salvar", "Save")}</button>
        </span>
      </div>
    </Modal>
  );
}

/** Resumo da planilha lida, antes de salvar: anos, contas e se o total bateu com o da planilha. */
function ImportPreview({ res, replacing, onCancel, onConfirm }: { res: PlanImportResponse; replacing: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ok = (a: number, b: number | null) => b == null || Math.abs(a - b) < 0.5;
  return (
    <Modal onClose={onCancel} wide>
      <h2 style={{ paddingRight: 32 }}><Sparkles size={16} /> {L("Planilha lida", "Spreadsheet read")}</h2>
      <p className="muted small">{L(`${res.plan.lines.length} contas em ${res.years.length} anos; ${res.linked} ligadas ao Open Finance pelo que bate em valor e mês.`, `${res.plan.lines.length} bills across ${res.years.length} years; ${res.linked} linked to Open Finance by matching amount and month.`)}</p>
      <div className="table-wrap">
        <table className="mc">
          <thead><tr><th>{L("Ano", "Year")}</th><th className="right">{L("Contas", "Bills")}</th><th className="right">{L("Gastos", "Spending")}</th><th className="right">{L("Renda", "Income")}</th><th>{L("Confere com a planilha", "Matches the sheet")}</th></tr></thead>
          <tbody>
            {res.years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="right num">{y.lines}</td>
                <td className="right num">{amt0(y.expenses)}</td>
                <td className="right num">{amt0(y.income)}</td>
                <td>{ok(y.expenses, y.sheetExpenses) && ok(y.income, y.sheetIncome)
                  ? <span style={{ color: "var(--ok)" }}><Check size={13} /> {L("sim", "yes")}</span>
                  : <span style={{ color: "var(--warn)" }}>{L(`planilha: ${amt0(y.sheetExpenses ?? 0)}`, `sheet: ${amt0(y.sheetExpenses ?? 0)}`)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {res.skipped.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>{L("Abas ignoradas (não são de um ano):", "Tabs skipped (not a year):")} {res.skipped.join(", ")}</p>}
      {replacing && <Banner kind="warn">{L("Substitui as contas que já estão aqui (inclusive o que você digitou).", "Replaces the bills already here (including what you typed).")}</Banner>}
      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>{L("Cancelar", "Cancel")}</button>
        <button className="btn primary" onClick={onConfirm}>{L("Importar", "Import")}</button>
      </div>
    </Modal>
  );
}
