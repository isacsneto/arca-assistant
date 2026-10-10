import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, ExternalLink, KeyRound, Loader2, RefreshCw, Terminal } from "lucide-react";
import { PROVIDERS, PROVIDER_IDS, aiSettings, isAiReady, type AiSettings, type AuthMode, type ProviderId, type ProviderStatus } from "../../shared/ai";
import { api } from "../api";
import { useStore } from "../store";
import { L, getLang } from "../../shared/i18n";

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
          <h2>{L("Provedor de IA", "AI provider")}</h2>
          <p className="muted small">
            {L("Escolha qual IA o app usa para ler prints, interpretar textos, pesquisar ativos, atualizar valores, projetar e estimar bens — com o login que você já tem no computador ou com uma chave de API.",
              "Choose which AI the app uses to read screenshots, interpret text, research assets, update values, project and estimate assets — with the login you already have on this computer or with an API key.")}
          </p>
        </div>
        <button className="btn sm" onClick={() => void recheck()} disabled={checking} title={L("Verificar instalação e login de novo", "Check installation and login again")}>
          {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {L("Verificar", "Check")}
        </button>
      </div>

      <div className="providers" role="radiogroup" aria-label={L("Provedor de IA", "AI provider")}>
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
          <div className="seg" role="group" aria-label={L("Modo de acesso", "Access mode")}>
            {(["local", "apiKey"] as AuthMode[]).map((m) => (
              <button key={m} className={ai.auth === m ? "active" : ""} onClick={() => setAi({ auth: m })}>
                {m === "local" ? <><Terminal size={13} /> {L("Login local", "Local login")}</> : <><KeyRound size={13} /> {L("Chave de API", "API key")}</>}
              </button>
            ))}
          </div>
          <span className={"chip " + (ready ? "ok" : "bad")}>{ready ? L("Pronto para usar", "Ready") : L("Não está pronto", "Not ready")}</span>
        </div>

        {ai.auth === "local" ? (
          <LocalHelp id={ai.provider} status={status[ai.provider]} />
        ) : (
          <KeyForm id={ai.provider} hasKey={status[ai.provider].hasKey} onSaved={recheck} />
        )}

        {ai.auth === "apiKey" && ai.provider === "cursor" && !status.cursor.installed && (
          <p className="small" style={{ color: "var(--warn)", marginTop: 8 }}>
            {L("Mesmo com chave, o Cursor roda pelo CLI", "Even with a key, Cursor runs through the")} <code>agent</code> {L("— instale em", "CLI — install it from")}{" "}
            <a href={PROVIDERS.cursor.install} target="_blank" rel="noreferrer noopener">cursor.com/docs/cli</a>.
          </p>
        )}

        {modelProvider && (
          <div className="grid two" style={{ marginTop: 14 }}>
            <label className="field">
              {L("Modelo forte", "Strong model")} <span className="hint">{L("scan de ativos e projeção", "asset scan and projection")}</span>
              <input type="text" value={ai.models[modelProvider].strong} placeholder={L(`padrão do ${p.label}`, `${p.label} default`)}
                onChange={(e) => setAi({ models: { ...ai.models, [modelProvider]: { ...ai.models[modelProvider], strong: e.target.value } } })} />
            </label>
            <label className="field">
              {L("Modelo rápido", "Fast model")} <span className="hint">{L("ler prints, textos, atualizar valores e estimar bens", "read screenshots, text, update values and estimate assets")}</span>
              <input type="text" value={ai.models[modelProvider].fast} placeholder={L(`padrão do ${p.label}`, `${p.label} default`)}
                onChange={(e) => setAi({ models: { ...ai.models, [modelProvider]: { ...ai.models[modelProvider], fast: e.target.value } } })} />
            </label>
            <p className="muted small" style={{ gridColumn: "1 / -1", margin: 0 }}>
              {L(`Deixe em branco para usar o modelo configurado no ${p.label}. O esforço de raciocínio de cada tarefa continua valendo (ajuste abaixo).`,
                `Leave blank to use the model configured in ${p.label}. The reasoning effort for each task still applies (adjust below).`)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusLine({ status, id }: { status: ProviderStatus; id: ProviderId }) {
  const local = !status.installed
    ? { icon: <CircleDashed size={13} />, cls: "muted", text: L("CLI não instalado", "CLI not installed") }
    : status.loggedIn === false
      ? { icon: <CircleAlert size={13} />, cls: "warn-text", text: L("login local: não logado", "local login: not logged in") }
      : { icon: <CheckCircle2 size={13} />, cls: "ok-text", text: `${L("login local", "local login")}${status.account ? `: ${status.account}` : status.loggedIn ? ": ok" : ""}` };
  return (
    <span className="small provider-status">
      <span className={"row " + local.cls} style={{ gap: 4 }}>{local.icon} {local.text}</span>
      <span className={"row " + (status.hasKey ? "ok-text" : "muted")} style={{ gap: 4 }}>
        <KeyRound size={12} /> {status.hasKey ? L("chave de API salva", "API key saved") : L("sem chave de API", "no API key")}
      </span>
      {id === "codex" && status.installed && <span className="muted">{L("CLI incluso no app", "CLI bundled with the app")}</span>}
    </span>
  );
}

function LocalHelp({ id, status }: { id: ProviderId; status: ProviderStatus }) {
  const p = PROVIDERS[id];
  if (!status.installed)
    return (
      <p className="small" style={{ marginTop: 10 }}>
        {L("Instale o CLI", "Install the CLI")} ({" "}
        <a href={p.install} target="_blank" rel="noreferrer noopener">{L("instruções", "instructions")} <ExternalLink size={11} /></a>
        ), {L("faça login com", "log in with")} <code>{p.loginCmd}</code> {L("e clique em", "and click")} <b>{L("Verificar", "Check")}</b>.
      </p>
    );
  if (status.loggedIn === false)
    return (
      <p className="small" style={{ marginTop: 10 }}>
        {L("Rode", "Run")} <code>{p.loginCmd}</code> {L("no terminal (na pasta do app) e clique em", "in the terminal (in the app folder) and click")} <b>{L("Verificar", "Check")}</b>.
      </p>
    );
  return (
    <p className="small muted" style={{ marginTop: 10 }}>
      {L("Usando", "Using")} {p.local}{status.account ? ` (${status.account})` : ""}. {L("O consumo sai do limite da sua assinatura.", "Usage counts against your subscription limits.")}
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
      setMsg({ ok: true, text: value ? L("Chave salva.", "Key saved.") : L("Chave removida.", "Key removed.") });
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
          {p.keyLabel} {hasKey && <span className="hint">{L("— já existe uma chave salva; enviar outra substitui", "— a key is already saved; sending another replaces it")}</span>}
          <input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={hasKey ? "••••••••••••" : p.keyPlaceholder} onChange={(e) => setKey(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || key.trim().length < 8}>{busy ? <Loader2 size={14} className="spin" /> : null} {L("Salvar chave", "Save key")}</button>
        {hasKey && <button type="button" className="btn danger" disabled={busy} onClick={() => void save(null)}>{L("Remover", "Remove")}</button>}
      </form>
      <p className="muted small" style={{ marginTop: 6 }}>
        {getLang() === "pt" ? (
          <>A chave fica só no seu computador (<code>data/secrets.json</code>, fora do git) e nunca é enviada ao navegador. Também dá para usar a variável de
          ambiente <code>{p.keyEnv}</code>.</>
        ) : (
          <>The key stays only on your computer (<code>data/secrets.json</code>, outside git) and is never sent to the browser. You can also use the
          environment variable <code>{p.keyEnv}</code>.</>
        )}{" "}
        <a href={p.keyUrl} target="_blank" rel="noreferrer noopener">{L("Gerar chave", "Get a key")} <ExternalLink size={11} /></a>
      </p>
      {msg && <p className="small" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</p>}
    </div>
  );
}
