import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, ExternalLink, KeyRound, Loader2, RefreshCw, Terminal } from "lucide-react";
import { PROVIDERS, PROVIDER_IDS, aiSettings, isAiReady, type AiSettings, type AuthMode, type ProviderId, type ProviderStatus } from "../../shared/ai";
import { api } from "../api";
import { useStore } from "../store";

/** Escolha do provedor de IA (Claude, Codex, Cursor) e do modo de acesso (login local ou chave de API). */
export function AiProviderSettings() {
  const { state, config, update, refreshConfig } = useStore();
  const ai = aiSettings(state!.settings);
  const status = config!.aiStatus;
  const [checking, setChecking] = useState(false);

  const setAi = (patch: Partial<AiSettings>) =>
    update((s) => ({ ...s, settings: { ...s.settings, ai: { ...aiSettings(s.settings), ...patch } } }));
  const recheck = async () => {
    setChecking(true);
    try {
      await refreshConfig();
    } finally {
      setChecking(false);
    }
  };

  const ready = isAiReady(ai, status);
  const p = PROVIDERS[ai.provider];
  /** Codex/Cursor têm modelos forte/rápido; no Claude o modelo é por tarefa. */
  const modelProvider = ai.provider === "claude" ? null : ai.provider;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Provedor de IA</h2>
          <p className="muted small">
            Escolha qual IA o app usa para ler prints, interpretar textos, pesquisar ativos, atualizar valores, projetar e estimar bens —
            com o login que você já tem no computador ou com uma chave de API.
          </p>
        </div>
        <button className="btn sm" onClick={() => void recheck()} disabled={checking} title="Verificar instalação e login de novo">
          {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Verificar
        </button>
      </div>

      <div className="providers" role="radiogroup" aria-label="Provedor de IA">
        {PROVIDER_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={ai.provider === id}
            className={"provider" + (ai.provider === id ? " active" : "")} onClick={() => setAi({ provider: id })}>
            <b>{PROVIDERS[id].label}</b>
            <span className="muted small">{PROVIDERS[id].vendor}</span>
            <StatusLine status={status[id]} id={id} />
          </button>
        ))}
      </div>

      <div className="provider-detail">
        <div className="row wrap spread" style={{ gap: 12 }}>
          <div className="seg" role="group" aria-label="Modo de acesso">
            {(["local", "apiKey"] as AuthMode[]).map((m) => (
              <button key={m} className={ai.auth === m ? "active" : ""} onClick={() => setAi({ auth: m })}>
                {m === "local" ? <><Terminal size={13} /> Login local</> : <><KeyRound size={13} /> Chave de API</>}
              </button>
            ))}
          </div>
          <span className={"chip " + (ready ? "ok" : "bad")}>{ready ? "Pronto para usar" : "Não está pronto"}</span>
        </div>

        {ai.auth === "local" ? (
          <LocalHelp id={ai.provider} status={status[ai.provider]} />
        ) : (
          <KeyForm id={ai.provider} hasKey={status[ai.provider].hasKey} onSaved={recheck} />
        )}

        {ai.auth === "apiKey" && ai.provider === "cursor" && !status.cursor.installed && (
          <p className="small" style={{ color: "var(--warn)", marginTop: 8 }}>
            Mesmo com chave, o Cursor roda pelo CLI <code>agent</code> — instale em{" "}
            <a href={PROVIDERS.cursor.install} target="_blank" rel="noreferrer noopener">cursor.com/docs/cli</a>.
          </p>
        )}

        {modelProvider && (
          <div className="grid two" style={{ marginTop: 14 }}>
            <label className="field">
              Modelo forte <span className="hint">scan de ativos e projeção</span>
              <input type="text" value={ai.models[modelProvider].strong} placeholder={`padrão do ${p.label}`}
                onChange={(e) => setAi({ models: { ...ai.models, [modelProvider]: { ...ai.models[modelProvider], strong: e.target.value } } })} />
            </label>
            <label className="field">
              Modelo rápido <span className="hint">ler prints, textos, atualizar valores e estimar bens</span>
              <input type="text" value={ai.models[modelProvider].fast} placeholder={`padrão do ${p.label}`}
                onChange={(e) => setAi({ models: { ...ai.models, [modelProvider]: { ...ai.models[modelProvider], fast: e.target.value } } })} />
            </label>
            <p className="muted small" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Deixe em branco para usar o modelo configurado no {p.label}. O esforço de raciocínio de cada tarefa continua valendo (ajuste abaixo).
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusLine({ status, id }: { status: ProviderStatus; id: ProviderId }) {
  const local = !status.installed
    ? { icon: <CircleDashed size={13} />, cls: "muted", text: "CLI não instalado" }
    : status.loggedIn === false
      ? { icon: <CircleAlert size={13} />, cls: "warn-text", text: "login local: não logado" }
      : { icon: <CheckCircle2 size={13} />, cls: "ok-text", text: `login local${status.account ? `: ${status.account}` : status.loggedIn ? ": ok" : ""}` };
  return (
    <span className="small provider-status">
      <span className={"row " + local.cls} style={{ gap: 4 }}>{local.icon} {local.text}</span>
      <span className={"row " + (status.hasKey ? "ok-text" : "muted")} style={{ gap: 4 }}>
        <KeyRound size={12} /> {status.hasKey ? "chave de API salva" : "sem chave de API"}
      </span>
      {id === "codex" && status.installed && <span className="muted">CLI incluso no app</span>}
    </span>
  );
}

function LocalHelp({ id, status }: { id: ProviderId; status: ProviderStatus }) {
  const p = PROVIDERS[id];
  if (!status.installed)
    return (
      <p className="small" style={{ marginTop: 10 }}>
        Instale o CLI ({" "}
        <a href={p.install} target="_blank" rel="noreferrer noopener">instruções <ExternalLink size={11} /></a>
        ), faça login com <code>{p.loginCmd}</code> e clique em <b>Verificar</b>.
      </p>
    );
  if (status.loggedIn === false)
    return (
      <p className="small" style={{ marginTop: 10 }}>
        Rode <code>{p.loginCmd}</code> no terminal (na pasta do app) e clique em <b>Verificar</b>.
      </p>
    );
  return (
    <p className="small muted" style={{ marginTop: 10 }}>
      Usando {p.local}{status.account ? ` (${status.account})` : ""}. O consumo sai do limite da sua assinatura.
    </p>
  );
}

function KeyForm({ id, hasKey, onSaved }: { id: ProviderId; hasKey: boolean; onSaved: () => Promise<void> }) {
  const p = PROVIDERS[id];
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (value: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.setAiKey(id, value);
      setKey("");
      await onSaved();
      setMsg({ ok: true, text: value ? "Chave salva." : "Chave removida." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <form className="row wrap" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(key); }}>
        <label className="field grow" style={{ minWidth: 240 }}>
          {p.keyLabel} {hasKey && <span className="hint">— já existe uma chave salva; enviar outra substitui</span>}
          <input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={hasKey ? "••••••••••••" : p.keyPlaceholder} onChange={(e) => setKey(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || key.trim().length < 8}>{busy ? <Loader2 size={14} className="spin" /> : null} Salvar chave</button>
        {hasKey && <button type="button" className="btn danger" disabled={busy} onClick={() => void save(null)}>Remover</button>}
      </form>
      <p className="muted small" style={{ marginTop: 6 }}>
        A chave fica só no seu computador (<code>data/secrets.json</code>, fora do git) e nunca é enviada ao navegador. Também dá para usar a variável de
        ambiente <code>{p.keyEnv}</code>. <a href={p.keyUrl} target="_blank" rel="noreferrer noopener">Gerar chave <ExternalLink size={11} /></a>
      </p>
      {msg && <p className="small" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</p>}
    </div>
  );
}
