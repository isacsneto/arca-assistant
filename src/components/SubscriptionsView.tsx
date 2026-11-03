import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CreditCard, EyeOff, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { SUB_STATUSES, SUB_STATUS_LABEL, subKeywords, subsMonthly, type SubMatch, type SubStatus, type SubSuggestion, type Subscription } from "../../shared/subscriptions";
import { planningOf } from "../../shared/planning";
import { brDay } from "../../shared/history";
import { api } from "../api";
import { useStore } from "../store";
import { amt, amt0, uid } from "../lib/format";
import { Banner, Empty, PageHead } from "./ui";
import { L, locale } from "../../shared/i18n";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "2-digit" });
const money = (n: number, cur: "BRL" | "USD") => (cur === "USD" ? `US$ ${n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : amt(n));
type Filter = "all" | "active" | "stopped" | "review";
const REVIEW: SubMatch["flag"][] = ["valor-diferente", "sem-cobranca-recente", "cobrada-mas-parada"];

/** O que o banco diz de uma assinatura, numa etiqueta curta. */
function FlagChip({ s, m }: { s: Subscription; m: SubMatch | undefined }) {
  if (!m) return <span className="chip">…</span>;
  const last = m.last;
  switch (m.flag) {
    case "ok":
      return s.status === "inativa"
        ? <span className="chip">{last ? L(`parada · última ${day(last.date)}`, `stopped · last ${day(last.date)}`) : L("parada", "stopped")}</span>
        : <span className="chip ok"><Check size={11} /> {L("bate com a fatura", "matches the bill")}</span>;
    case "dividida":
      return <span className="chip ok"><Check size={11} /> {L(`dividida por ${m.split} (fatura ${amt(last!.amount)})`, `split ${m.split} ways (bill ${amt(last!.amount)})`)}</span>;
    case "valor-diferente":
      return <span className="chip warn"><AlertTriangle size={11} /> {L(`cobrado ${amt(last!.amount)}`, `charged ${amt(last!.amount)}`)}</span>;
    case "sem-cobranca-recente":
      return <span className="chip warn"><AlertTriangle size={11} /> {L(`sem cobrança desde ${day(last!.date)}`, `no charge since ${day(last!.date)}`)}</span>;
    case "cobrada-mas-parada":
      return <span className="chip bad"><AlertTriangle size={11} /> {L(`ainda cobrando (${day(last!.date)})`, `still charging (${day(last!.date)})`)}</span>;
    case "outro-meio":
      return <span className="chip" title={L(`Última cobrança achada: ${day(last!.date)} no ${last!.account}`, `Last charge found: ${day(last!.date)} on ${last!.account}`)}>{L("manual · outro meio", "manual · other method")}</span>;
    default:
      return <span className="chip">{L("manual", "manual")}</span>;
  }
}

/** Assinaturas: a lista de serviços mensais, conferida com as faturas dos cartões. */
export function SubscriptionsView() {
  const { state, update, savedAt } = useStore();
  const today = brDay(new Date());
  const planning = planningOf(state!.planning);
  const subs = planning.subscriptions ?? [];
  const ignored = planning.subsIgnored ?? [];
  const setSubs = (fn: (s: Subscription[]) => Subscription[]) =>
    update((st) => {
      const pl = planningOf(st.planning);
      return { ...st, planning: { ...pl, subscriptions: fn(pl.subscriptions ?? []) } };
    });
  const patch = (id: string, o: Partial<Subscription>) => setSubs((list) => list.map((s) => (s.id === id ? { ...s, ...o } : s)));

  const [res, setRes] = useState<{ matches: Record<string, SubMatch>; suggestions: SubSuggestion[] } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Subscription[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subsJson = JSON.stringify(subs);
  useEffect(() => {
    if (!subs.length) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api.subsMatch(subs).then((r) => alive && setRes(r)).catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsJson, savedAt]);

  const usdBrl = state!.settings.fx?.USD ?? 5;
  const monthly = subsMonthly(subs, usdBrl);
  const matches = res?.matches ?? {};
  const since30 = new Date(Date.parse(`${today}T12:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
  const charged30 = Object.values(matches).flatMap((m) => m.charges).filter((c) => c.date >= since30).reduce((s, c) => s + c.amount, 0);
  const found = subs.filter((s) => matches[s.id]?.last && matches[s.id].flag !== "outro-meio").length;
  const review = subs.filter((s) => REVIEW.includes(matches[s.id]?.flag as SubMatch["flag"]));
  const suggestions = (res?.suggestions ?? []).filter((x) => !ignored.includes(x.label));
  const rows = useMemo(() => subs.filter((s) =>
    filter === "all" ? true : filter === "active" ? s.status !== "inativa" : filter === "stopped" ? s.status === "inativa" : REVIEW.includes(matches[s.id]?.flag as SubMatch["flag"])), [subs, filter, matches]);

  const doImport = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      setPreview((await api.subsImport(file)).subscriptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const add = (o: Partial<Subscription> = {}) => {
    const id = uid();
    setSubs((list) => [...list, { id, service: L("Nova assinatura", "New subscription"), status: "ativa", currency: "BRL", amount: null, ...o }]);
    setOpen(id);
  };

  const fileInput = <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.ods" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />;
  const head = (
    <PageHead
      title={L("Assinaturas", "Subscriptions")}
      subtitle={L("Os serviços que você assina, conferidos com as faturas dos cartões. O que não aparece no banco fica como você deixou.", "The services you subscribe to, checked against your card bills. Whatever isn't in the bank stays as you left it.")}
      actions={subs.length > 0 && (
        <>
          <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {L("Importar planilha", "Import spreadsheet")}</button>
          <button className="btn sm primary" onClick={() => add()}><Plus size={14} /> {L("Nova assinatura", "New subscription")}</button>
        </>
      )}
    />
  );
  const previewModal = preview && (
    <Modal onClose={() => setPreview(null)}>
      <h2 style={{ paddingRight: 32 }}>{L(`${preview.length} assinaturas na planilha`, `${preview.length} subscriptions in the spreadsheet`)}</h2>
      <p className="muted small">{L(`${preview.filter((s) => s.status !== "inativa").length} ativas; a cor da coluna "Ativo" virou o status (verde claro = ativa, verde escuro = paga adiantado, amarelo = parada).`, `${preview.filter((s) => s.status !== "inativa").length} active; the "Ativo" column color became the status (light green = active, dark green = prepaid, yellow = stopped).`)}</p>
      <div className="plan-tx-list" style={{ marginTop: 8 }}>
        {preview.map((s) => (
          <div key={s.id} className="list-row" style={{ cursor: "default" }}>
            <span className="grow small">{s.service} <span className="muted">· {SUB_STATUS_LABEL()[s.status]}{s.payment ? ` · ${s.payment}` : ""}</span></span>
            <span className="num small">{s.amount != null ? money(s.amount, s.currency) : "—"}</span>
          </div>
        ))}
      </div>
      {subs.length > 0 && <Banner kind="warn">{L("Substitui a lista que já está aqui.", "Replaces the list already here.")}</Banner>}
      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => setPreview(null)}>{L("Cancelar", "Cancel")}</button>
        <button className="btn primary" onClick={() => { setSubs(() => preview); setPreview(null); }}>{L("Importar", "Import")}</button>
      </div>
    </Modal>
  );

  if (!subs.length) {
    return (
      <>
        {head}
        {fileInput}
        {error && <Banner kind="bad">{error}</Banner>}
        <div className="card">
          <Empty title={L("Traga a sua lista de assinaturas", "Bring your subscriptions list")}>
            <p className="muted">{L("Uma aba com Serviço, Valor e, se quiser, a conta, o cartão e observações. As que aparecem na fatura do cartão passam a ser conferidas sozinhas.", "A tab with Service and Amount and, optionally, the account, card and notes. Those that show up on your card bill get checked automatically.")}</p>
            <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {L("Importar planilha (.xlsx)", "Import spreadsheet (.xlsx)")}</button>
              <button className="btn" onClick={() => add()}><Plus size={16} /> {L("Adicionar uma", "Add one")}</button>
            </div>
          </Empty>
        </div>
        {previewModal}
      </>
    );
  }

  const editing = open ? subs.find((s) => s.id === open) : null;
  return (
    <>
      {head}
      {fileInput}
      {error && <Banner kind="bad">{error}</Banner>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="label">{L("Por mês (lista)", "Per month (list)")}</div><div className="value num">{amt0(monthly.total)}</div>
          <div className="sub">{monthly.count} {L("assinaturas", "subscriptions")}{monthly.usd > 0 ? ` · ${L("inclui", "incl.")} US$ ${monthly.usd.toFixed(2)}` : ""}</div></div>
        <div className="card kpi"><div className="label">{L("Cobrado nos últimos 30 dias", "Charged in the last 30 days")}</div><div className="value num">{res ? amt0(charged30) : "…"}</div>
          <div className="sub">{L("pelas faturas e conta", "from bills and account")}</div></div>
        <div className="card kpi"><div className="label">{L("Achadas no banco", "Found at the bank")}</div><div className="value num">{res ? `${found}/${subs.length}` : "…"}</div>
          <div className="sub">{L("o resto é manual", "the rest is manual")}</div></div>
        <button className="card kpi kpi-btn" onClick={() => setFilter("review")}><div className="label">{L("Para revisar", "To review")}</div>
          <div className="value num" style={{ color: review.length ? "var(--warn)" : "var(--ok)" }}>{res ? review.length : "…"}</div>
          <div className="sub">{L("valor mudou, parou ou ainda cobra", "price changed, stopped or still charging")}</div></button>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <div className="seg" role="radiogroup" aria-label={L("Filtro", "Filter")}>
          {([["all", L("Todas", "All")], ["active", L("Ativas", "Active")], ["stopped", L("Paradas", "Stopped")], ["review", L("Para revisar", "To review")]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table className="mc t-subs">
            <thead><tr><th>{L("Serviço", "Service")}</th><th>{L("Status", "Status")}</th><th className="right">{L("Valor (seu)", "Amount (yours)")}</th><th>{L("Pagamento", "Payment")}</th><th>{L("No banco", "At the bank")}</th><th aria-label={L("Ações", "Actions")} /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const m = matches[s.id];
                return (
                  <tr key={s.id} className={s.status === "inativa" ? "sub-off" : undefined}>
                    <td className="ga-main">
                      <button className="plan-line" onClick={() => setOpen(s.id)}><span className="plan-line-name">{s.service}</span></button>
                      {(s.account || s.note) && <div className="muted small">{[s.account, s.note].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td className="ga-a" style={{ minWidth: 165 }}>
                      <select className="cell" style={{ width: "100%" }} value={s.status} onChange={(e) => patch(s.id, { status: e.target.value as SubStatus })} aria-label={L(`Status de ${s.service}`, `Status of ${s.service}`)}>
                        {SUB_STATUSES.map((x) => <option key={x} value={x}>{SUB_STATUS_LABEL()[x]}</option>)}
                      </select>
                    </td>
                    <td className="right ga-val">
                      <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        {s.currency === "USD" && <span className="muted small">US$</span>}
                        <input className="cell num right" type="number" step="0.01" defaultValue={s.amount != null ? s.amount.toFixed(2) : ""} key={`${s.id}:${s.amount}`} placeholder="—" style={{ maxWidth: 110 }}
                          onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== s.amount && (v == null || Number.isFinite(v))) patch(s.id, { amount: v }); }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label={L(`Valor de ${s.service}`, `Amount of ${s.service}`)} />
                      </span>
                    </td>
                    <td className="ga-b small">{s.payment ?? <span className="muted">—</span>}</td>
                    <td className="ga-c">
                      <FlagChip s={s} m={m} />
                      {m?.last && m.flag !== "outro-meio" && <div className="muted small"><CreditCard size={11} /> {m.last.account} · {day(m.last.date)}{m.cadence ? ` · ${m.cadence === "mensal" ? L("mensal", "monthly") : m.cadence === "anual" ? L("anual", "yearly") : L("irregular", "irregular")}` : ""}</div>}
                    </td>
                    <td className="right ga-act"><button className="btn ghost sm" onClick={() => setOpen(s.id)}>{L("Detalhes", "Details")}</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}><b>{L("Total por mês", "Total per month")}</b></td><td className="right num"><b>{amt(monthly.brl)}</b>{monthly.usd > 0 && <div className="muted small">+ US$ {monthly.usd.toFixed(2)}</div>}</td><td colSpan={3} /></tr>
            </tfoot>
          </table>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>{L("Cobranças recorrentes fora da lista", "Recurring charges not on the list")}</h2><span className="muted small">{L("categoria assinaturas, cobradas nos últimos 45 dias", "subscriptions category, charged in the last 45 days")}</span></div>
          {suggestions.map((x) => (
            <div key={x.label} className="list-row" style={{ cursor: "default" }}>
              <span className="grow small">{x.label}<div className="muted">{x.account} · {L(`${x.months} meses`, `${x.months} months`)} · {L("última", "last")} {day(x.lastDate)}</div></span>
              <span className="num small">{amt(x.amount)}</span>
              <button className="btn sm" onClick={() => add({ service: x.label, amount: Math.round(x.amount * 100) / 100, payment: x.account, keywords: [x.label] })}><Plus size={13} /> {L("Adicionar", "Add")}</button>
              <button className="btn ghost sm" onClick={() => update((st) => { const pl = planningOf(st.planning); return { ...st, planning: { ...pl, subsIgnored: [...(pl.subsIgnored ?? []), x.label] } }; })} title={L("Não é assinatura", "Not a subscription")}><EyeOff size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {editing && <SubModal s={editing} m={matches[editing.id]} onClose={() => setOpen(null)} onSave={(o) => patch(editing.id, o)}
        onDelete={() => { setSubs((list) => list.filter((x) => x.id !== editing.id)); setOpen(null); }} />}
      {previewModal}
    </>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cf-detail" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="btn icon sm ghost cf-close" onClick={onClose} aria-label={L("Fechar", "Close")}><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

/** Uma assinatura: todos os campos, como ela aparece no extrato e as cobranças achadas. */
function SubModal({ s, m, onClose, onSave, onDelete }: { s: Subscription; m: SubMatch | undefined; onClose: () => void; onSave: (o: Partial<Subscription>) => void; onDelete: () => void }) {
  const [d, setD] = useState(s);
  const [amount, setAmount] = useState(s.amount != null ? String(s.amount) : "");
  const [keys, setKeys] = useState((s.keywords ?? []).join(", "));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (o: Partial<Subscription>) => setD((x) => ({ ...x, ...o }));
  const save = () => {
    const a = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    const k = keys.split(",").map((x) => x.trim()).filter((x) => x.length >= 3);
    onSave({ ...d, service: d.service.trim() || s.service, amount: a != null && Number.isFinite(a) ? a : null, keywords: k.length ? k : null });
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <h2 style={{ paddingRight: 32 }}>{s.service}</h2>
      <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
        <label className="field" style={{ flex: "2 1 200px" }}>{L("Serviço", "Service")}<input type="text" value={d.service} onChange={(e) => set({ service: e.target.value })} autoFocus /></label>
        <label className="field" style={{ flex: "1 1 140px" }}>{L("Status", "Status")}
          <select value={d.status} onChange={(e) => set({ status: e.target.value as SubStatus })}>{SUB_STATUSES.map((x) => <option key={x} value={x}>{SUB_STATUS_LABEL()[x]}</option>)}</select>
        </label>
      </div>
      <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
        <label className="field" style={{ flex: "1 1 120px" }}>{L("Valor por mês (a sua parte)", "Per month (your share)")}<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field" style={{ flex: "0 1 100px" }}>{L("Moeda", "Currency")}
          <select value={d.currency} onChange={(e) => set({ currency: e.target.value as "BRL" | "USD" })}><option>BRL</option><option>USD</option></select>
        </label>
        <label className="field" style={{ flex: "2 1 180px" }}>{L("Pagamento", "Payment")}<input type="text" value={d.payment ?? ""} onChange={(e) => set({ payment: e.target.value || null })} placeholder={L("cartão, Pix, Wise…", "card, Pix, Wise…")} /></label>
      </div>
      <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
        <label className="field" style={{ flex: "1 1 180px" }}>{L("Conta / login", "Account / login")}<input type="text" value={d.account ?? ""} onChange={(e) => set({ account: e.target.value || null })} /></label>
        <label className="field" style={{ flex: "2 1 220px" }}>{L("Observação", "Note")}<input type="text" value={d.note ?? ""} onChange={(e) => set({ note: e.target.value || null })} /></label>
      </div>
      <label className="field" style={{ marginTop: 8 }}>{L("Como aparece na fatura", "How it shows on the bill")}
        <input type="text" value={keys} onChange={(e) => setKeys(e.target.value)} placeholder={subKeywords({ service: d.service, keywords: null }).join(", ")} />
        <span className="hint">{L("Vazio = deduzido pelo nome. Separe por vírgula (ex.: apple com bill).", "Empty = guessed from the name. Comma-separated (e.g. apple com bill).")}</span>
      </label>

      <h3 style={{ marginTop: 16 }}><CreditCard size={14} /> {L("Cobranças achadas (13 meses)", "Charges found (13 months)")}</h3>
      {m?.charges.length ? (
        <div className="plan-tx-list">
          {m.charges.map((c) => (
            <div key={c.id} className="list-row" style={{ cursor: "default" }}>
              <span className="grow small">{day(c.date)}<span className="muted"> · {c.account} · {c.institution}</span></span>
              <span className="num small">{amt(c.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">{L("Nada nas faturas nem na conta: fica manual, como está.", "Nothing on the bills or the account: it stays manual, as it is.")}</p>
      )}
      {m?.last && amount.trim() !== "" && Math.abs(Number(amount) - m.last.amount) > 0.01 && !m.split && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAmount(String(m.last!.amount))}>{L(`Usar o valor cobrado (${amt(m.last.amount)})`, `Use the charged amount (${amt(m.last.amount)})`)}</button>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "space-between" }}>
        {confirmDel
          ? <button className="btn danger" onClick={onDelete} onBlur={() => setConfirmDel(false)} autoFocus><Trash2 size={14} /> {L("Apagar", "Delete")}</button>
          : <button className="btn ghost danger" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {L("Apagar assinatura", "Delete subscription")}</button>}
        <span className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>{L("Cancelar", "Cancel")}</button>
          <button className="btn primary" onClick={save}>{L("Salvar", "Save")}</button>
        </span>
      </div>
    </Modal>
  );
}
