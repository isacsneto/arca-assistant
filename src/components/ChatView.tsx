import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { JobProgress } from "./JobProgress";
import { Banner, PageHead } from "./ui";
import { L } from "../../shared/i18n";

interface Message {
  role: "user" | "assistant";
  text: string;
  followUps?: string[];
}

const KEY = "arca:chat";
const load = (): Message[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.slice(-40) : [];
  } catch {
    return [];
  }
};
const save = (m: Message[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m.slice(-40)));
  } catch {
    /* sem storage: a conversa só não fica guardada */
  }
};

const SUGGESTIONS = () => [
  L("Quanto rendeu minha carteira este mês e por quê?", "How did my portfolio do this month, and why?"),
  L("Minha reserva de emergência está bem dimensionada?", "Is my emergency fund the right size?"),
  L("Onde aportar R$ 10 mil hoje para voltar às metas da Arca?", "Where should I invest R$ 10k today to get back to my Arca targets?"),
  L("Quais posições estão concentradas demais em um emissor?", "Which positions are too concentrated in one issuer?"),
];

/** "Pergunte à Arca": conversa com a IA sobre os seus dados. A conversa fica só neste aparelho. */
export function ChatView() {
  const { config } = useStore();
  const [messages, setMessages] = useState<Message[]>(load);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const job = useJob<{ text: string; followUps: string[] }>("/api/chat", (r) =>
    setMessages((m) => [...m, { role: "assistant", text: r.text, followUps: r.followUps }]),
  );

  useEffect(() => save(messages), [messages]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, job.running]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || job.running) return;
    const next = [...messages, { role: "user" as const, text: q }];
    setMessages(next);
    setInput("");
    job.start({ messages: next.map(({ role, text }) => ({ role, text })) });
  };

  const last = messages.at(-1);
  return (
    <>
      <PageHead
        title={L("Pergunte à Arca", "Ask Arca")}
        subtitle={L("Converse com a IA sobre a sua carteira, histórico, metas e gastos. Ela só lê seus dados — não altera nada.", "Talk to the AI about your portfolio, history, goals and spending. It only reads your data — it never changes anything.")}
        actions={messages.length > 0 && (
          <button className="btn ghost" onClick={() => { setMessages([]); job.clear(); }}><Trash2 size={15} /> {L("Limpar conversa", "Clear chat")}</button>
        )}
      />
      {!config?.hasCredentials && <Banner kind="warn">{L("Configure a IA em Ajustes para conversar.", "Set up the AI in Settings to chat.")}</Banner>}

      <div className="card chat">
        {messages.length === 0 && (
          <div className="chat-empty">
            <Sparkles size={22} />
            <p className="muted">{L("Pergunte qualquer coisa sobre o seu dinheiro. Exemplos:", "Ask anything about your money. For example:")}</p>
            <div className="row wrap" style={{ gap: 8, justifyContent: "center" }}>
              {SUGGESTIONS().map((s) => <button key={s} className="btn sm" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble prose">{m.text}</div>
          </div>
        ))}
        {job.running && <JobProgress job={job} onCancel={job.cancel} />}
        {job.error && <Banner kind="bad">{job.error}</Banner>}
        {!job.running && last?.role === "assistant" && last.followUps?.length ? (
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            {last.followUps.map((f) => <button key={f} className="btn sm ghost" onClick={() => ask(f)}>{f}</button>)}
          </div>
        ) : null}
        <div ref={end} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <textarea
          value={input}
          rows={2}
          placeholder={L("Escreva sua pergunta…", "Type your question…")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
        />
        <button className="btn primary" disabled={!input.trim() || job.running || !config?.hasCredentials} aria-label={L("Enviar", "Send")}><Send size={16} /></button>
      </form>
    </>
  );
}
