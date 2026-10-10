import { useEffect, useMemo, useRef, useState } from "react";
import { CURRENCY_CODES, type CurrencyCode } from "../../shared/currency";
import {
  Copy, FileSpreadsheet, FileText, HelpCircle, Image as ImageIcon, Loader2, MessageSquare, Send, Sparkles, Upload, Video, X,
} from "lucide-react";
import type { ExtractedItem, ExtractionResult, FileReading, ImportAnswer, ImportQuestion } from "../../shared/types";
import { CLASS_META, OWNERS, type Owner } from "../../shared/types";
import { parseFileName } from "../../shared/fileHints";
import { mergeImport, posKey } from "../../shared/importMerge";
import { api } from "../api";
import { useStore } from "../store";
import type { PreparedFile } from "../lib/files";
import { useUploads } from "../lib/useUploads";
import { useAi } from "../lib/useAi";
import { money, uid } from "../lib/format";
import { Banner, ClassSelect, PageHead } from "./ui";
import { PromptImport } from "./PromptImport";
import { clearStaleFor } from "../../shared/reminders";
import { clock } from "../../shared/videoFrames";
import { OpenFinanceImport } from "./OpenFinanceImport";
import { openFinanceSettings, withSyncedConnections, type OpenFinanceImport as OfResult } from "../../shared/openFinance";
import { getLang, L } from "../../shared/i18n";

interface Draft extends ExtractedItem {
  _id: string;
  include: boolean;
}

interface Review {
  /** De onde vieram os itens: arquivos lidos pela IA ou Open Finance. */
  source: "files" | "openfinance";
  /** Open Finance: qual conexão gerou cada bloco (para gravar a instituição final). */
  ofConnections?: OfResult["connections"];
  drafts: Draft[];
  files: FileReading[];
  questions: ImportQuestion[];
  warnings: string[];
}

const toItem = ({ _id: _i, include: _c, ...item }: Draft): ExtractedItem => item;

/** Converte a resposta da IA em rascunhos editáveis. */
function toReview(res: ExtractionResult, previous?: Draft[], source: Review["source"] = "files"): Review {
  const asked = new Set(res.questions.flatMap((q) => q.itemIndexes));
  const sameShape = previous && previous.length === res.items.length;
  return {
    source,
    drafts: res.items.map((it, i) => ({
      ...it,
      _id: sameShape ? previous[i]._id : uid(),
      // Itens com pergunta pendente entram marcados: a resposta vai corrigi-los.
      include: sameShape ? previous[i].include : it.confidence !== "baixa" || asked.has(i),
    })),
    files: res.files,
    questions: res.questions,
    warnings: res.warnings,
  };
}

export function ImportView({ done, target, goSettings }: { done: () => void; target?: { institution: string; owner: Owner } | null; goSettings?: () => void }) {
  const { state, update, config, view } = useStore();
  const ai = useAi();
  const aiName = ai.name;
  const { files, setFiles, addFiles, toUpload, error, setError, notice, progress } = useUploads();
  const [mode, setMode] = useState<"files" | "text" | "openfinance">("files");
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipQuestions, setSkipQuestions] = useState(false);
  const [removeStale, setRemoveStale] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  // Ctrl+V de prints direto da área de transferência (na aba Texto, quem cuida é o campo de texto)
  useEffect(() => {
    if (mode !== "files") return;
    const onPaste = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.files ?? [])];
      if (fs.length) {
        e.preventDefault();
        void addFiles(fs);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, mode]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async (label: string, fn: (signal: AbortSignal) => Promise<void>) => {
    setBusy(label);
    setError(null);
    abort.current = new AbortController();
    try {
      await fn(abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const processFiles = () =>
    run(L(`Lendo arquivos com ${aiName}…`, `Reading files with ${aiName}…`), async (signal) => {
      const res = await api.importFiles(toUpload(), signal);
      setReview(toReview(res));
      setAnswers({});
      setSkipQuestions(false);
    });

  const sendAnswers = () =>
    run(L(`${aiName} revisando com as suas respostas…`, `${aiName} reviewing with your answers…`), async (signal) => {
      if (!review) return;
      const payload: ImportAnswer[] = review.questions
        .filter((q) => answers[q.id]?.trim())
        .map((q) => ({ questionId: q.id, question: q.question, answer: answers[q.id].trim(), itemIndexes: q.itemIndexes }));
      const res = await api.refineImport({ items: review.drafts.map(toItem), files: review.files, answers: payload }, signal);
      setReview(toReview(res, review.drafts, review.source));
      setAnswers({});
    });

  const fallbackOwner: Owner = view === "PJ" ? "PJ" : "PF";
  const existing = useMemo(() => new Set(state!.positions.map((p) => posKey(p.owner, p.institution, p.ticker, p.name))), [state]);

  const patch = (id: string, changes: Partial<Draft>) =>
    setReview((r) => r && { ...r, drafts: r.drafts.map((d) => (d._id === id ? { ...d, ...changes } : d)) });

  /** Muda instituição/titular de um arquivo inteiro (e de todos os seus itens). */
  const patchFile = (file: string, changes: Partial<Pick<FileReading, "institution" | "owner">>) =>
    setReview((r) =>
      r && {
        ...r,
        files: r.files.map((f) => (f.file === file ? { ...f, ...changes } : f)),
        drafts: r.drafts.map((d) =>
          d.sourceFile === file
            ? { ...d, ...(changes.institution !== undefined && { institution: changes.institution ?? d.institution }), ...(changes.owner !== undefined && { owner: changes.owner }) }
            : d,
        ),
      },
    );

  // Open Finance como fonte da verdade: importar substitui tudo daquela instituição (por titular).
  const forceReplace = review?.source === "openfinance" && openFinanceSettings(state!.settings.openFinance).sourceOfTruth;

  const commit = () => {
    if (!review) return;
    const replace = removeStale || forceReplace;
    const chosen = review.drafts.filter((d) => d.include).map(toItem);
    const touched = chosen.map((d) => ({ institution: d.institution, owner: d.owner ?? fallbackOwner }));
    update((s) => ({
      ...s,
      ...mergeImport(s, chosen, { removeStale: replace, now: new Date().toISOString(), newId: uid, defaultOwner: fallbackOwner }),
      // Importou dados da instituição: ela deixa de estar desatualizada.
      settings: {
        ...s.settings,
        staleInstitutions: clearStaleFor(s.settings.staleInstitutions, touched),
        ...(review.source === "openfinance" && { openFinance: withSyncedConnections(s.settings.openFinance, review.files, review.ofConnections ?? [], new Date().toISOString()) }),
      },
    }));
    done();
  };

  /* ---------------- revisão ---------------- */
  if (review) {
    const { drafts } = review;
    const positions = drafts.filter((d) => d.kind === "position");
    const txs = drafts.filter((d) => d.kind === "transaction");
    const included = drafts.filter((d) => d.include).length;
    const pending = review.questions.length;
    const answered = review.questions.filter((q) => answers[q.id]?.trim()).length;
    const blocked = pending > 0 && !skipQuestions;
    const duplicates = review.files.filter((f) => f.duplicateOf);
    // O aviso de prints repetidos já tem banner próprio; não repetir nos avisos da IA.
    const otherWarnings = duplicates.length ? review.warnings.filter((w) => !/duplicad|repetid|idêntic|duplicat|repeat|identical/i.test(w)) : review.warnings;
    const indexOf = new Map(drafts.map((d, i) => [d._id, i]));
    const asked = new Set(review.questions.flatMap((q) => q.itemIndexes));

    return (
      <>
        <PageHead
          title={L("Revisar importação", "Review import")}
          subtitle={review.source === "openfinance"
            ? L("Dados do Open Finance (valores líquidos). Confira a classe de cada investimento e ajuste o que precisar antes de salvar.", "Open Finance data (net values). Check each investment's class and adjust what you need before saving.")
            : L("Confira como a IA entendeu cada arquivo, responda às perguntas dela e ajuste o que precisar antes de salvar.", "Check how the AI understood each file, answer its questions and adjust what you need before saving.")}
          actions={
            <>
              <button className="btn" onClick={() => setReview(null)} disabled={!!busy}>{L("Voltar", "Back")}</button>
              <button className="btn primary" disabled={!included || blocked || !!busy} onClick={commit}
                title={blocked ? L("Responda às perguntas da IA (ou marque para salvar sem responder)", "Answer the AI's questions (or check the box to save without answering)") : undefined}>
                {L(`Salvar ${included} itens`, `Save ${included} item${included === 1 ? "" : "s"}`)}
              </button>
            </>
          }
        />
        {error && <Banner kind="bad">{error}</Banner>}
        {busy && <Banner><span className="row"><Loader2 size={16} className="spin" /> {busy}</span></Banner>}

        {/* -------- perguntas -------- */}
        {pending > 0 && (
          <div className="card question-card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div>
                <h2 className="row"><HelpCircle size={18} /> {L(`${aiName} precisa de ${pending === 1 ? "uma resposta" : `${pending} respostas`}`, `${aiName} needs ${pending === 1 ? "an answer" : `${pending} answers`}`)}</h2>
                <p className="muted small">{L("Para classificar estes ativos com segurança. Escolha uma opção ou escreva a sua.", "To classify these assets reliably. Pick an option or write your own.")}</p>
              </div>
            </div>
            <div className="stack">
              {review.questions.map((q, qi) => (
                <div className="question" key={q.id}>
                  <div><b>{qi + 1}. {q.question}</b></div>
                  {q.itemIndexes.length > 0 && (
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {L("Afeta:", "Affects:")} {q.itemIndexes.map((i) => drafts[i]).filter(Boolean).map((d) => (d.ticker ? `${d.ticker} · ` : "") + d.name).join(", ")}
                    </div>
                  )}
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
            <div className="row wrap spread" style={{ marginTop: 14 }}>
              <label className="check small">
                <input type="checkbox" checked={skipQuestions} onChange={(e) => setSkipQuestions(e.target.checked)} />
                {L("Salvar sem responder (usar os palpites da IA)", "Save without answering (use the AI's guesses)")}
              </label>
              <button className="btn primary" disabled={!answered || !!busy} onClick={sendAnswers}>
                <Send size={15} /> {L(`Enviar ${answered || ""} resposta${answered === 1 ? "" : "s"} para ${aiName}`, `Send ${answered || ""} answer${answered === 1 ? "" : "s"} to ${aiName}`)}
              </button>
            </div>
          </div>
        )}

        {otherWarnings.length > 0 && (
          <Banner kind="warn">
            <b>{L("Avisos da IA:", "AI warnings:")}</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{otherWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Banner>
        )}
        {duplicates.length > 0 && (
          <Banner kind="warn">
            <b>{L("Prints repetidos:", "Repeated screenshots:")}</b> {duplicates.map((f) => L(`"${f.file}" repete "${f.duplicateOf}"`, `"${f.file}" repeats "${f.duplicateOf}"`)).join("; ")}.{" "}{L("Os ativos foram contados uma vez só.", "The assets were counted only once.")}
          </Banner>
        )}

        {/* -------- leitura dos arquivos -------- */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 className="row"><MessageSquare size={17} /> {review.source === "openfinance" ? L("O que veio de cada conexão", "What came from each connection") : L("Como a IA entendeu cada arquivo", "How the AI understood each file")}</h2>
            <span className="muted small">{review.source === "openfinance"
              ? L("mudar instituição/titular aqui vale para todos os itens da conexão", "changing institution/owner here applies to all items in the connection")
              : L("mudar instituição/titular aqui vale para todos os itens do arquivo", "changing institution/owner here applies to all items in the file")}</span>
          </div>
          <div className="table-wrap">
            <table className="mc t-files">
              <thead><tr><th>{review.source === "openfinance" ? L("Conexão", "Connection") : L("Arquivo", "File")}</th><th>{L("Instituição", "Institution")}</th><th>{L("Titular", "Owner")}</th><th>{review.source === "openfinance" ? L("Conector", "Connector") : L("Produto (nome do arquivo)", "Product (file name)")}</th><th>{L("O que mostra", "What it shows")}</th></tr></thead>
              <tbody>
                {review.files.map((f) => (
                  <tr key={f.file}>
                    <td className="ga-main" style={{ minWidth: 160 }}>
                      <b className="small">{f.file}</b>
                      {f.duplicateOf && <div><span className="chip warn"><Copy size={11} /> {L("repete", "repeats")} {f.duplicateOf}</span></div>}
                    </td>
                    <td className="ga-a" data-l={L("Instituição", "Institution")} style={{ minWidth: 150 }}>
                      <input className="cell" type="text" value={f.institution ?? ""} placeholder={L("não identificada", "not identified")}
                        onChange={(e) => patchFile(f.file, { institution: e.target.value || null })} />
                    </td>
                    <td className="ga-b" data-l={L("Titular", "Owner")} style={{ minWidth: 80 }}>
                      <select className="cell" value={f.owner ?? ""} onChange={(e) => patchFile(f.file, { owner: (e.target.value || null) as Owner | null })} aria-label={L("Titular do arquivo", "File owner")}>
                        <option value="">?</option>
                        {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="small ga-c">{f.productHint ?? <span className="muted">—</span>}</td>
                    <td className="small muted ga-d" style={{ minWidth: 200 }}>{f.summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {drafts.length === 0 && <Banner kind="warn">{review.source === "openfinance" ? L("Nenhum investimento com saldo veio do Open Finance.", "No investment with a balance came from Open Finance.") : L("Nenhum dado financeiro foi encontrado nos arquivos.", "No financial data was found in the files.")}</Banner>}

        {positions.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h2>{L("Posições", "Positions")} ({positions.length})</h2>
              <label className="check small" title={review.source === "openfinance" ? L("O Open Finance traz a carteira inteira de cada instituição; itens antigos com nome diferente seriam duplicados", "Open Finance brings each institution's whole portfolio; old items with a different name would be duplicated") : L("Útil quando o print mostra a carteira inteira daquela instituição", "Useful when the screenshot shows that institution's whole portfolio")}>
                <input type="checkbox" checked={removeStale || forceReplace} disabled={forceReplace} onChange={(e) => setRemoveStale(e.target.checked)} />
                {L("Remover posições antigas dessas instituições que não vieram aqui", "Remove old positions from these institutions that didn't come in here")}
              </label>
            </div>
            {forceReplace && (
              <p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
                {L("O Open Finance é a fonte da verdade (Ajustes → Open Finance): só é substituído o que você tinha em cada instituição ", "Open Finance is the source of truth (Settings → Open Finance): only what you had at each institution ")}<b>{L("e titular", "and owner")}</b>{L(" que veio daqui", " that came in here is replaced")}{" "}
                ({[...new Set(positions.filter((d) => d.include).map((d) => `${d.institution} ${d.owner ?? fallbackOwner}`))].join(", ") || L("nenhum", "none")}).{" "}{L("O resto da carteira fica intacto.", "The rest of the portfolio stays intact.")}
              </p>
            )}
            <div className="table-wrap">
              <table className="mc t-review">
                <thead><tr><th /><th>{L("Ativo", "Asset")}</th><th>{L("Instituição", "Institution")}</th><th>{L("Titular", "Owner")}</th><th>{L("Classe", "Class")}</th><th className="right">{L("Valor", "Value")}</th><th>{L("Moeda", "Currency")}</th><th /></tr></thead>
                <tbody>
                  {positions.map((d) => {
                    const pendingQ = asked.has(indexOf.get(d._id)!);
                    return (
                      <tr key={d._id} style={{ opacity: d.include ? 1 : 0.5 }}>
                        <td className="ga-chk"><input type="checkbox" checked={d.include} onChange={(e) => patch(d._id, { include: e.target.checked })} aria-label={L("Incluir", "Include")} /></td>
                        <td className="ga-main" style={{ minWidth: 200 }}>
                          <input className="cell" type="text" value={d.name} onChange={(e) => patch(d._id, { name: e.target.value })} />
                          <div className="muted small" style={{ paddingLeft: 6 }}>{[d.ticker, d.subtype, d.sourceFile].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="ga-a" style={{ minWidth: 150 }}><input className="cell" type="text" value={d.institution} onChange={(e) => patch(d._id, { institution: e.target.value })} /></td>
                        <td className="ga-b" style={{ minWidth: 80 }}>
                          <select className="cell" value={d.owner ?? fallbackOwner} onChange={(e) => patch(d._id, { owner: e.target.value as Owner })} aria-label={L("Titular", "Owner")}>
                            {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="ga-c" style={{ minWidth: 150 }}><ClassSelect value={d.assetClass} onChange={(assetClass) => patch(d._id, { assetClass, confidence: "alta" })} /></td>
                        <td className="ga-val" style={{ minWidth: 130 }}><input className="cell num right" type="number" step="0.01" value={d.value} onChange={(e) => patch(d._id, { value: Number(e.target.value) })} /></td>
                        <td className="ga-d">
                          <select className="cell" value={d.currency} onChange={(e) => patch(d._id, { currency: e.target.value as CurrencyCode })}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
                        </td>
                        <td className="small ga-e">
                          {pendingQ && <span className="chip warn" title={L("Há uma pergunta da IA sobre este item", "The AI has a question about this item")}>{L("pergunta", "question")}</span>}{" "}
                          {existing.has(posKey(d.owner ?? fallbackOwner, d.institution, d.ticker, d.name)) && <span className="chip">{L("atualiza", "updates")}</span>}{" "}
                          {d.confidence !== "alta" && !pendingQ && <span className={`chip ${d.confidence === "baixa" ? "bad" : "warn"}`} title={d.notes ?? ""}>{L(`confiança ${d.confidence}`, `${d.confidence === "baixa" ? "low" : d.confidence === "media" ? "medium" : d.confidence} confidence`)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {txs.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>{L("Transações", "Transactions")} ({txs.length})</h2></div>
            <div className="table-wrap">
              <table className="mc t-rtx">
                <thead><tr><th /><th>{L("Data", "Date")}</th><th>{L("Tipo", "Type")}</th><th>{L("Descrição", "Description")}</th><th>{L("Instituição", "Institution")}</th><th>{L("Titular", "Owner")}</th><th className="right">{L("Valor", "Value")}</th></tr></thead>
                <tbody>
                  {txs.map((d) => (
                    <tr key={d._id} style={{ opacity: d.include ? 1 : 0.5 }}>
                      <td className="ga-chk"><input type="checkbox" checked={d.include} onChange={(e) => patch(d._id, { include: e.target.checked })} aria-label={L("Incluir", "Include")} /></td>
                      <td className="num mc-hide">{d.date ?? "—"}</td>
                      <td className="mc-hide"><span className="chip">{d.txType ?? L("outro", "other")}</span></td>
                      <td className="ga-main">{d.ticker ? <b>{d.ticker} </b> : null}{d.name}<div className="muted small m-only">{[d.date, d.txType ?? L("outro", "other")].filter(Boolean).join(" · ")}</div></td>
                      <td className="muted ga-sub">{d.institution}</td>
                      <td className="ga-a"><span className={"chip owner-" + (d.owner ?? fallbackOwner)}>{d.owner ?? fallbackOwner}</span></td>
                      <td className="right num ga-val">{money(d.value, d.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }

  /* ---------------- upload ---------------- */
  const ex = state!.settings.extraction;
  const modelLabel = ai.modelLabel("extraction");
  const icon = (f: PreparedFile) => (f.kind === "image" ? <ImageIcon size={26} /> : f.kind === "pdf" ? <FileText size={26} /> : <FileSpreadsheet size={26} />);
  const nearDups = files.filter((f) => f.looksLike).length;

  return (
    <>
      <PageHead
        title={L("Importar", "Import")}
        subtitle={mode === "files"
          ? L("Prints ou vídeos de tela do app do banco/corretora, PDFs, CSV ou XLSX (BTG, XP, Nubank, Inter…). A IA lê, confere os nomes dos arquivos e pergunta o que não souber classificar.", "Screenshots or screen recordings of your bank/broker app, PDFs, CSV or XLSX (BTG, XP, Nubank, Inter…). The AI reads them, checks the file names and asks about anything it can't classify.")
          : mode === "text"
            ? L("Escreva o que mudou — aportes, resgates, compras, novos saldos. A IA encontra a posição certa, pergunta se tiver dúvida e você confere antes de aplicar.", "Write what changed — contributions, withdrawals, purchases, new balances. The AI finds the right position, asks if in doubt and you review before applying.")
            : L("Busca seus investimentos direto dos bancos pelo Open Finance (Meu Pluggy). Você confere tudo antes de salvar.", "Fetches your investments straight from the banks through Open Finance (Meu Pluggy). You review everything before saving.")}
        actions={
          <div className="seg" role="tablist" aria-label={L("Tipo de importação", "Import type")}>
            <button role="tab" aria-selected={mode === "files"} className={mode === "files" ? "active" : ""} onClick={() => setMode("files")}>{L("Arquivos", "Files")}</button>
            <button role="tab" aria-selected={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>{L("Texto", "Text")}</button>
            <button role="tab" aria-selected={mode === "openfinance"} className={mode === "openfinance" ? "active" : ""} onClick={() => setMode("openfinance")}>Open Finance</button>
          </div>
        }
      />
      {target && (
        <Banner>
          {L("Atualizando ", "Updating ")}<b>{target.institution}</b> <span className={"chip owner-" + target.owner}>{target.owner}</span>{L(": suba o print com um nome como", ": upload the screenshot with a name like")}{" "}
          <code>{fileSlug(target.institution)}-{target.owner.toLowerCase()}.png</code>{L(", ou descreva a mudança na aba Texto. Ao salvar, a marcação de desatualizada sai sozinha.", ", or describe the change in the Text tab. When you save, the outdated mark clears by itself.")}
        </Banner>
      )}
      {mode === "openfinance" ? (
        <OpenFinanceImport goSettings={goSettings} onResult={(res) => { setReview({ ...toReview(res, undefined, "openfinance"), ofConnections: res.connections }); setRemoveStale(true); setAnswers({}); setSkipQuestions(false); }} />
      ) : mode === "text" ? <PromptImport done={done} /> : <>
      {error && <Banner kind="bad">{error}</Banner>}
      {progress && <Banner><span className="row"><Loader2 size={16} className="spin" /> {progress}</span></Banner>}
      {notice.length > 0 && <Banner kind="warn">{notice.join(" ")}</Banner>}
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <Upload size={30} />
        <div className="big d-only">{L("Arraste arquivos, clique para escolher ou cole um print (Ctrl+V)", "Drag files, click to choose or paste a screenshot (Ctrl+V)")}</div>
        <div className="big m-only">{L("Toque para escolher prints, vídeos ou arquivos", "Tap to choose screenshots, videos or files")}</div>
        <div className="muted small">{L("PNG, JPG, WEBP, vídeo de tela (MP4, MOV, WEBM), PDF, CSV, XLSX", "PNG, JPG, WEBP, screen recording (MP4, MOV, WEBM), PDF, CSV, XLSX")}</div>
        <input ref={input} type="file" hidden multiple accept="image/*,video/*,.mov,.mkv,.pdf,.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,.ofx"
          onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <>
          {nearDups > 0 && (
            <Banner kind="warn">
              {L(
                `${nearDups === 1 ? "Um print parece" : `${nearDups} prints parecem`} quase idêntico${nearDups === 1 ? "" : "s"} a outro do lote (marcado em amarelo). Remova se for repetido — se não, a IA confere o conteúdo e conta cada ativo uma vez só.`,
                `${nearDups === 1 ? "One screenshot looks" : `${nearDups} screenshots look`} almost identical to another in the batch (marked in yellow). Remove it if it's a repeat — otherwise the AI checks the content and counts each asset only once.`,
              )}
            </Banner>
          )}
          <div className="thumbs">
            {files.map((f) => (
              <div className={"thumb" + (f.looksLike ? " dup" : "")} key={f.id}>
                {f.preview ? <img src={f.preview} alt={f.name} /> : <div className="ph">{icon(f)}</div>}
                <div className="cap" title={f.name}>{f.name}</div>
                <FileHintChips name={f.name} />
                {f.video && <div className="cap"><span className="chip" title={L("Quadro do vídeo ", "Frame from video ") + f.video.source}><Video size={11} /> {L("vídeo", "video")} {clock(f.video.at)}</span></div>}
                {f.looksLike && <div className="cap"><span className="chip warn" title={L("Hash visual quase igual", "Nearly identical visual hash")}><Copy size={11} /> {L("parece", "looks like")} {f.looksLike}</span></div>}
                <button className="btn icon sm x" title={L("Remover", "Remove")} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" disabled={!!busy || !!progress || !config!.hasCredentials} onClick={processFiles}>
              {busy ? <><Loader2 className="spin" size={16} /> {busy}</> : <><Sparkles size={16} /> {L(`Processar ${files.length} arquivo${files.length > 1 ? "s" : ""}`, `Process ${files.length} file${files.length > 1 ? "s" : ""}`)}</>}
            </button>
            {busy && <button className="btn" onClick={() => abort.current?.abort()}>{L("Cancelar", "Cancel")}</button>}
            <span className="muted small">{L(`Modelo: ${modelLabel} · esforço ${ex.effort} (altere em Ajustes)`, `Model: ${modelLabel} · effort ${ex.effort} (change in Settings)`)}</span>
          </div>
        </>
      )}
      <p className="muted small" style={{ marginTop: 22 }}>
        {getLang() === "pt" ? (
          <>Dica: para registrar um aporte ou resgate sem print, use a aba <b>Texto</b>. Em vez de vários prints, dá para gravar a tela rolando o app do banco (pause um instante em cada parte): o app escolhe um quadro por tela. Nomeie os arquivos como <b>banco-pf</b> ou <b>banco-pj-dica</b> (ex.: <code>vest-pf.png</code>, <code>itau-pf-cdb100cdi.png</code>) para já definir instituição, titular e o produto — a IA confere essa leitura. Arquivos idênticos são ignorados automaticamente e prints repetidos são contados uma vez só. Classes: </>
        ) : (
          <>Tip: to record a contribution or withdrawal without a screenshot, use the <b>Text</b> tab. Instead of several screenshots, you can record your screen while scrolling the bank app (pause for a moment on each part): the app picks one frame per screen. Name files like <b>bank-pf</b> or <b>bank-pj-hint</b> (e.g. <code>vest-pf.png</code>, <code>itau-pf-cdb100cdi.png</code>) to set institution, owner and product up front — the AI double-checks that reading. Identical files are ignored automatically and repeated screenshots are counted only once. Classes: </>
        )}
        {Object.values(CLASS_META).map((m) => m.label).join(" · ")}.
      </p>
      </>}
    </>
  );
}

/** Leitura automática do nome do arquivo (a IA confirma ou corrige na revisão). */
function FileHintChips({ name }: { name: string }) {
  const h = parseFileName(name);
  if (!h.institution && !h.owner && !h.hint) return <div className="cap muted small">{L("sem dica no nome", "no hint in name")}</div>;
  return (
    <div className="cap row wrap" style={{ gap: 4 }}>
      {h.institution && <span className="chip">{h.institution}</span>}
      {h.owner && <span className={"chip owner-" + h.owner}>{h.owner}</span>}
      {h.hint && <span className="chip" title={L("Dica repassada à IA", "Hint passed on to the AI")}>{h.hint}</span>}
    </div>
  );
}

/** "Banco Inter" → "banco-inter", para sugerir o nome do arquivo. */
function fileSlug(institution: string): string {
  return institution.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
