import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Sparkles, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import { useJob } from "../lib/useJob";
import { JobProgress } from "./JobProgress";
import { Banner } from "./ui";
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
  L("Explique o que estou vendo nesta tela", "Explain what I'm looking at on this screen"),
  L("Quanto rendeu minha carteira este mês e por quê?", "How did my portfolio do this month, and why?"),
  L("Minha reserva de emergência está bem dimensionada?", "Is my emergency fund the right size?"),
  L("Onde aportar R$ 10 mil hoje para voltar às metas da Arca?", "Where should I invest R$ 10k today to get back to my Arca targets?"),
];

/**
 * "Pergunte à Arca": chat flutuante, aberto por cima de qualquer tela. Fica montado (escondido) para a
 * resposta chegar mesmo com o painel fechado; diz à IA qual tela está aberta. A conversa fica no aparelho.
 */
export function ChatFab({ screen }: { screen: string }) {
  const { config } = useStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(load);
  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const job = useJob<{ text: string; followUps: string[] }>("/api/chat", (r) => {
    setMessages((m) => [...m, { role: "assistant", text: r.text, followUps: r.followUps }]);
    if (!openRef.current) setUnread(true);
  });

  useEffect(() => save(messages), [messages]);
  useEffect(() => {
    if (open) {
      setUnread(false);
      end.current?.scrollIntoView({ block: "end" });
      setTimeout(() => field.current?.focus(), 50);
    }
  }, [open, messages, job.running]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || job.running) return;
    const next = [...messages, { role: "user" as const, text: q }];
    setMessages(next);
    setInput("");
    job.start({ messages: next.map(({ role, text }) => ({ role, text })), screen });
  };

  const last = messages.at(-1);
  return (
    <>
      <button className={`chat-fab ${open ? "hidden" : ""}`} onClick={() => setOpen(true)} aria-label={L("Pergunte à Arca", "Ask Arca")} title={L("Pergunte à Arca", "Ask Arca")}>
        <MessagesSquare size={22} />
        {(job.running || unread) && <span className={`chat-fab-dot ${job.running ? "busy" : ""}`} />}
      </button>

      <div className={`chat-panel ${open ? "open" : ""}`} role="dialog" aria-label={L("Pergunte à Arca", "Ask Arca")} aria-hidden={!open}>
        <div className="chat-panel-head">
          <div className="row" style={{ gap: 8 }}>
            <span className="chat-avatar"><Sparkles size={15} /></span>
            <div>
              <b>{L("Pergunte à Arca", "Ask Arca")}</b>
              <div className="muted small">{L("vê seus dados e a tela aberta · só lê", "sees your data and the open screen · read-only")}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 2 }}>
            {messages.length > 0 && <button className="btn icon sm ghost" onClick={() => { setMessages([]); job.clear(); }} title={L("Limpar conversa", "Clear chat")}><Trash2 size={15} /></button>}
            <button className="btn icon sm ghost" onClick={() => setOpen(false)} aria-label={L("Fechar", "Close")}><X size={17} /></button>
          </div>
        </div>

        <div className="chat-body">
          {!config?.hasCredentials && <Banner kind="warn">{L("Configure a IA em Ajustes para conversar.", "Set up the AI in Settings to chat.")}</Banner>}
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="muted small">{L("Pergunte qualquer coisa sobre o seu dinheiro:", "Ask anything about your money:")}</p>
              {SUGGESTIONS().map((s) => <button key={s} className="btn sm chat-suggest" onClick={() => ask(s)}>{s}</button>)}
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
            <div className="chat-follow">
              {last.followUps.map((f) => <button key={f} className="btn sm ghost" onClick={() => ask(f)}>{f}</button>)}
            </div>
          ) : null}
          <div ref={end} />
        </div>

        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <textarea
            ref={field}
            value={input}
            rows={1}
            placeholder={L("Escreva sua pergunta…", "Type your question…")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          />
          <button className="btn primary icon" disabled={!input.trim() || job.running || !config?.hasCredentials} aria-label={L("Enviar", "Send")}><Send size={16} /></button>
        </form>
      </div>
    </>
  );
}
