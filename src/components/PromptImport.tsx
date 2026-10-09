import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Copy, FileSpreadsheet, FileText, HelpCircle, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";
import { useUploads } from "../lib/useUploads";
import type { PromptPlan } from "../../shared/types";
import { applyPromptOps, previewOps } from "../../shared/promptOps";
import { clearStaleFor } from "../../shared/reminders";
import { api } from "../api";
import { useStore } from "../store";
import { money, uid } from "../lib/format";
import { Banner } from "./ui";

const EXAMPLES = [
  "17000.30 adicionados à caixinha cdb do inter pj",
  "resgatei 5 mil do cdb do itaú",
  "comprei 100 PETR4 a 38,50 no btg ontem",
  "o saldo do nubank agora é 53.200",
];

const TX_LABEL: Record<string, string> = {
  deposito: "depósito", saque: "saque", compra: "compra", venda: "venda", dividendo: "dividendo",
  juros: "juros", taxa: "taxa", transferencia: "transferência", outro: "lançamento",
};

/** Import por texto: descreva o que mudou e o Claude propõe as operações. */
export function PromptImport({ done }: { done: () => void }) {
  const { state, update, config } = useStore();
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
          <span>Descreva o que mudou na sua carteira</span>
          <textarea
            rows={3}
            value={text}
            placeholder="Ex.: 17000.30 adicionados à caixinha cdb do inter pj"
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
          <span className="hint">Aportes, resgates, compras, vendas, novos saldos ou ativos novos — pode escrever várias coisas de uma vez. Ctrl+Enter para enviar. Anexe comprovantes, notas ou extratos para dar contexto (arraste, cole com Ctrl+V ou use o clipe).</span>
        </label>

        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button type="button" className="btn sm" onClick={() => fileInput.current?.click()}>
            <Paperclip size={14} /> Anexar arquivo
          </button>
          <input ref={fileInput} type="file" hidden multiple accept="image/*,.pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,.ofx"
            onChange={(e) => { void uploads.addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          {uploads.files.map((f) => (
            <span key={f.id} className={"attach" + (f.looksLike ? " dup" : "")} title={f.looksLike ? `Parece igual a ${f.looksLike}` : f.name}>
              {f.preview ? <img src={f.preview} alt="" /> : f.kind === "pdf" ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
              <span className="attach-name">{f.name}</span>
              {f.looksLike && <Copy size={12} />}
              <button type="button" className="btn ghost icon sm" onClick={() => uploads.remove(f.id)} aria-label={`Remover ${f.name}`}><X size={12} /></button>
            </span>
          ))}
        </div>
        {uploads.error && <p className="small" style={{ color: "var(--bad)", marginTop: 6 }}>{uploads.error}</p>}
        {uploads.notice.length > 0 && <p className="small" style={{ color: "var(--warn)", marginTop: 6 }}>{uploads.notice.join(" ")}</p>}
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="btn sm ghost example" onClick={() => setText(ex)}>{ex}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!canInterpret} onClick={start}>
            {busy
              ? <><Loader2 size={16} className="spin" /> {uploads.files.length ? "Lendo anexos e interpretando…" : "Interpretando…"}</>
              : <><Sparkles size={16} /> Interpretar com Claude{uploads.files.length ? ` (+${uploads.files.length} anexo${uploads.files.length > 1 ? "s" : ""})` : ""}</>}
          </button>
          {busy && <button className="btn" onClick={() => abort.current?.abort()}>Cancelar</button>}
        </div>
      </div>

      {error && <Banner kind="bad">{error}</Banner>}

      {plan && plan.questions.length > 0 && (
        <div className="card question-card">
          <h2 className="row" style={{ marginBottom: 10 }}><HelpCircle size={18} /> O Claude precisa saber</h2>
          <div className="stack">
            {plan.questions.map((q) => (
              <div className="question" key={q.id}>
                <b>{q.question}</b>
                <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                  {q.options.map((o) => (
                    <button key={o} type="button" className={"btn sm" + (answers[q.id] === o ? " primary" : "")}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>{o}</button>
                  ))}
                  <input type="text" placeholder="Outra resposta…" style={{ maxWidth: 280 }}
                    value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!answered || busy} onClick={sendAnswers}>
              <Send size={15} /> Enviar resposta{answered === 1 ? "" : "s"}
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
            <h2>Operações propostas</h2>
            <button className="btn primary" disabled={!validCount || plan.questions.length > 0 || busy} onClick={apply}
              title={plan.questions.length ? "Responda às perguntas primeiro" : undefined}>
              <Check size={15} /> Aplicar {validCount}
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>O que será feito</th><th>Posição</th><th className="right">Antes</th><th /><th className="right">Depois</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.index} style={{ opacity: r.error || !approved.has(r.index) ? 0.55 : 1 }}>
                    <td><input type="checkbox" disabled={!!r.error} checked={approved.has(r.index) && !r.error} onChange={() => toggle(r.index)} aria-label="Aplicar" /></td>
                    <td style={{ minWidth: 220 }}>
                      {r.op.explanation}
                      <div className="small">
                        {r.op.transaction && <span className="chip">registra {TX_LABEL[r.op.transaction.type] ?? r.op.transaction.type}</span>}{" "}
                        {r.op.action === "criar" && <span className="chip ok">ativo novo</span>}{" "}
                        {r.op.action === "remover" && <span className="chip bad">remove</span>}{" "}
                        {r.error && <span className="chip bad">{r.error}</span>}
                      </div>
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <b>{r.label}</b>
                      <div className="muted small">{r.institution}{r.owner && <> · <span className={"chip owner-" + r.owner}>{r.owner}</span></>}</div>
                    </td>
                    <td className="right num muted">{r.before == null ? "—" : money(r.before, r.currency)}</td>
                    <td className="muted"><ArrowRight size={14} /></td>
                    <td className="right num"><b>{r.after == null ? "—" : money(r.after, r.currency)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {plan && preview.length === 0 && plan.questions.length === 0 && (
        <Banner kind="warn">O Claude não encontrou nenhuma movimentação nesse texto. Tente descrever com valor, instituição e produto.</Banner>
      )}
    </div>
  );
}
