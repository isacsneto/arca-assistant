import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Copy, FileSpreadsheet, FileText, HelpCircle, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";
import { useUploads } from "../lib/useUploads";
import { useAi } from "../lib/useAi";
import type { PromptPlan } from "../../shared/types";
import { applyPromptOps, previewOps } from "../../shared/promptOps";
import { clearStaleFor } from "../../shared/reminders";
import { api } from "../api";
import { useStore } from "../store";
import { money, uid } from "../lib/format";
import { Banner } from "./ui";
import { L } from "../../shared/i18n";

const examples = () => [
  L("17000.30 adicionados à caixinha cdb do inter pj", "17000.30 added to the cdb box at inter pj"),
  L("resgatei 5 mil do cdb do itaú", "withdrew 5k from the itaú cdb"),
  L("comprei 100 PETR4 a 38,50 no btg ontem", "bought 100 PETR4 at 38.50 at btg yesterday"),
  L("o saldo do nubank agora é 53.200", "the nubank balance is now 53,200"),
];

const txLabel = (): Record<string, string> => ({
  deposito: L("depósito", "deposit"), saque: L("saque", "withdrawal"), compra: L("compra", "purchase"), venda: L("venda", "sale"),
  dividendo: L("dividendo", "dividend"), juros: L("juros", "interest"), taxa: L("taxa", "fee"),
  transferencia: L("transferência", "transfer"), outro: L("lançamento", "entry"),
});

/** Import por texto: descreva o que mudou e a IA propõe as operações. */
export function PromptImport({ done }: { done: () => void }) {
  const { state, update, config } = useStore();
  const aiName = useAi().name;
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<PromptPlan | null>(null);
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => () => abort.current?.abort(), []);

  const preview = useMemo(() => (plan ? previewOps(state!.positions, plan.operations) : []), [plan, state]);

  /** Interpreta o texto com o histórico de perguntas/respostas dado (vazio = texto novo). */
  const interpret = async (all: { question: string; answer: string }[]) => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const res = await api.interpretPrompt({ text, answers: all, files: uploads.toUpload() }, abort.current.signal);
      setPlan(res);
      setHistory(all);
      setAnswers({});
      setApproved(new Set(previewOps(state!.positions, res.operations).filter((r) => !r.error).map((r) => r.index)));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Texto novo não reaproveita respostas de um texto anterior.
  const start = () => {
    setPlan(null);
    void interpret([]);
  };

  const sendAnswers = () => {
    if (!plan) return;
    const extra = plan.questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ question: q.question, answer: answers[q.id].trim() }));
    void interpret([...history, ...extra]);
  };

  const apply = () => {
    if (!plan) return;
    const now = new Date().toISOString();
    const touched = preview.filter((r) => approved.has(r.index) && !r.error && r.owner).map((r) => ({ institution: r.institution, owner: r.owner! }));
    update((s) => ({
      ...s,
      ...applyPromptOps(s, plan.operations, approved, {
        now,
        newId: uid,
        source: `texto: ${text.slice(0, 80)}${uploads.files.length ? ` + ${uploads.files.map((f) => f.name).join(", ")}` : ""}`,
      }),
      settings: { ...s.settings, staleInstitutions: clearStaleFor(s.settings.staleInstitutions, touched) },
    }));
    done();
  };

  const toggle = (i: number) =>
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const answered = plan?.questions.filter((q) => answers[q.id]?.trim()).length ?? 0;
  const canInterpret = (text.trim() || uploads.files.length > 0) && !busy && config!.hasCredentials;
  const validCount = preview.filter((r) => approved.has(r.index) && !r.error).length;

  return (
    <div className="stack-lg">
      <div
        className={"card" + (over ? " drop-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void uploads.addFiles([...e.dataTransfer.files]); }}
      >
        <label className="field">
          <span>{L("Descreva o que mudou na sua carteira", "Describe what changed in your portfolio")}</span>
          <textarea
            rows={3}
            value={text}
            placeholder={L("Ex.: 17000.30 adicionados à caixinha cdb do inter pj", "E.g.: 17000.30 added to the cdb box at inter pj")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canInterpret) start();
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                void uploads.addFiles(pasted);
              }
            }}
          />
          <span className="hint">{L("Aportes, resgates, compras, vendas, novos saldos ou ativos novos — pode escrever várias coisas de uma vez. Ctrl+Enter para enviar. Anexe comprovantes, notas ou extratos para dar contexto (arraste, cole com Ctrl+V ou use o clipe).", "Contributions, withdrawals, purchases, sales, new balances or new assets — you can write several things at once. Ctrl+Enter to send. Attach receipts, brokerage notes or statements for context (drag, paste with Ctrl+V or use the paperclip).")}</span>
        </label>

        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button type="button" className="btn sm" onClick={() => fileInput.current?.click()}>
            <Paperclip size={14} /> {L("Anexar arquivo", "Attach file")}
          </button>
          <input ref={fileInput} type="file" hidden multiple accept="image/*,video/*,.mov,.mkv,.pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,.ofx"
            onChange={(e) => { void uploads.addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          {uploads.files.map((f) => (
            <span key={f.id} className={"attach" + (f.looksLike ? " dup" : "")} title={f.looksLike ? L(`Parece igual a ${f.looksLike}`, `Looks the same as ${f.looksLike}`) : f.name}>
              {f.preview ? <img src={f.preview} alt="" /> : f.kind === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
              <span className="attach-name">{f.name}</span>
              {f.looksLike && <Copy size={12} />}
              <button type="button" className="btn ghost icon sm" onClick={() => uploads.remove(f.id)} aria-label={L(`Remover ${f.name}`, `Remove ${f.name}`)}><X size={12} /></button>
            </span>
          ))}
        </div>
        {uploads.progress && <p className="small muted row" style={{ marginTop: 6 }}><Loader2 size={13} className="spin" /> {uploads.progress}</p>}
        {uploads.error && <p className="small" style={{ color: "var(--bad)", marginTop: 6 }}>{uploads.error}</p>}
        {uploads.notice.length > 0 && <p className="small" style={{ color: "var(--warn)", marginTop: 6 }}>{uploads.notice.join(" ")}</p>}
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {examples().map((ex) => (
            <button key={ex} type="button" className="btn sm ghost example" onClick={() => setText(ex)}>{ex}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!canInterpret} onClick={start}>
            {busy
              ? <><Loader2 size={16} className="spin" /> {uploads.files.length ? L("Lendo anexos e interpretando…", "Reading attachments and interpreting…") : L("Interpretando…", "Interpreting…")}</>
              : <><Sparkles size={16} /> {L(`Interpretar com ${aiName}`, `Interpret with ${aiName}`)}{uploads.files.length ? L(` (+${uploads.files.length} anexo${uploads.files.length > 1 ? "s" : ""})`, ` (+${uploads.files.length} attachment${uploads.files.length > 1 ? "s" : ""})`) : ""}</>}
          </button>
          {busy && <button className="btn" onClick={() => abort.current?.abort()}>{L("Cancelar", "Cancel")}</button>}
        </div>
      </div>

      {error && <Banner kind="bad">{error}</Banner>}

      {plan && plan.questions.length > 0 && (
        <div className="card question-card">
          <h2 className="row" style={{ marginBottom: 10 }}><HelpCircle size={18} /> {L(`${aiName} precisa saber`, `${aiName} needs to know`)}</h2>
          <div className="stack">
            {plan.questions.map((q) => (
              <div className="question" key={q.id}>
                <b>{q.question}</b>
                <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                  {q.options.map((o) => (
                    <button key={o} type="button" className={"btn sm" + (answers[q.id] === o ? " primary" : "")}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>{o}</button>
                  ))}
                  <input type="text" placeholder={L("Outra resposta…", "Other answer…")} style={{ maxWidth: 280 }}
                    value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!answered || busy} onClick={sendAnswers}>
              <Send size={15} /> {L(`Enviar resposta${answered === 1 ? "" : "s"}`, `Send answer${answered === 1 ? "" : "s"}`)}
            </button>
          </div>
        </div>
      )}

      {plan && plan.warnings.length > 0 && (
        <Banner kind="warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner>
      )}

      {plan && preview.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>{L("Operações propostas", "Proposed operations")}</h2>
            <button className="btn primary" disabled={!validCount || plan.questions.length > 0 || busy} onClick={apply}
              title={plan.questions.length ? L("Responda às perguntas primeiro", "Answer the questions first") : undefined}>
              <Check size={15} /> {L("Aplicar", "Apply")} {validCount}
            </button>
          </div>
          <div className="table-wrap">
            <table className="mc t-ops">
              <thead><tr><th /><th>{L("O que será feito", "What will be done")}</th><th>{L("Posição", "Position")}</th><th className="right">{L("Antes", "Before")}</th><th /><th className="right">{L("Depois", "After")}</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.index} style={{ opacity: r.error || !approved.has(r.index) ? 0.55 : 1 }}>
                    <td className="ga-chk"><input type="checkbox" disabled={!!r.error} checked={approved.has(r.index) && !r.error} onChange={() => toggle(r.index)} aria-label={L("Aplicar", "Apply")} /></td>
                    <td className="ga-main" style={{ minWidth: 220 }}>
                      {r.op.explanation}
                      <div className="small">
                        {r.op.transaction && <span className="chip">{L("registra", "records")} {txLabel()[r.op.transaction.type] ?? r.op.transaction.type}</span>}{" "}
                        {r.op.action === "criar" && <span className="chip ok">{L("ativo novo", "new asset")}</span>}{" "}
                        {r.op.action === "remover" && <span className="chip bad">{L("remove", "removes")}</span>}{" "}
                        {r.error && <span className="chip bad">{r.error}</span>}
                      </div>
                    </td>
                    <td className="ga-a" style={{ minWidth: 160 }}>
                      <b>{r.label}</b>
                      <div className="muted small">{r.institution}{r.owner && <> · <span className={"chip owner-" + r.owner}>{r.owner}</span></>}</div>
                    </td>
                    <td className="right num muted mc-hide">{r.before == null ? "—" : money(r.before, r.currency)}</td>
                    <td className="muted mc-hide"><ArrowRight size={14} /></td>
                    <td className="right num ga-val"><b>{r.after == null ? "—" : money(r.after, r.currency)}</b><div className="muted small m-only">{L("antes", "before")} {r.before == null ? "—" : money(r.before, r.currency)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {plan && preview.length === 0 && plan.questions.length === 0 && (
        <Banner kind="warn">{L("A IA não encontrou nenhuma movimentação nesse texto. Tente descrever com valor, instituição e produto.", "The AI didn't find any transaction in this text. Try describing it with the amount, institution and product.")}</Banner>
      )}
    </div>
  );
}
