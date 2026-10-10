import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Landmark, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { openFinanceSettings, type OpenFinanceConnection, type OpenFinanceSettings as OFSettings } from "../../shared/openFinance";
import { OWNERS, type Owner } from "../../shared/types";
import { api, type OpenFinanceItem, type OpenFinanceStatus } from "../api";
import { useStore } from "../store";
import { getLang, L, locale } from "../../shared/i18n";

/** Ajustes → Open Finance: credenciais do Meu Pluggy (só no servidor) e conexões a importar. */
export function OpenFinanceSettings() {
  const { state, update } = useStore();
  const of = openFinanceSettings(state!.settings.openFinance);
  const [status, setStatus] = useState<OpenFinanceStatus | null>(null);
  const [found, setFound] = useState<OpenFinanceItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newId, setNewId] = useState("");

  const set = (patch: Partial<OFSettings>) =>
    update((s) => ({ ...s, settings: { ...s.settings, openFinance: { ...openFinanceSettings(s.settings.openFinance), ...patch } } }));
  const setConnections = (connections: OpenFinanceConnection[]) => set({ connections });

  const loadStatus = useCallback(() => api.openFinanceStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => void loadStatus(), [loadStatus]);

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const discover = () =>
    act("discover", async () => {
      const { items } = await api.openFinanceItems();
      setFound(items);
      const fresh = items.filter((i) => !of.connections.some((c) => c.itemId === i.id) && i.status !== "NOT_FOUND");
      if (fresh.length) setConnections([...of.connections, ...fresh.map((i) => ({ itemId: i.id, owner: "PF" as Owner }))]);
      return fresh.length
        ? L(
            `${fresh.length} ${fresh.length === 1 ? "conexão encontrada e adicionada" : "conexões encontradas e adicionadas"} — confira o titular de cada uma.`,
            `${fresh.length} ${fresh.length === 1 ? "connection found and added" : "connections found and added"} — check the owner of each one.`,
          )
        : items.length
          ? L("Nenhuma conexão nova.", "No new connections.")
          : L(
              "A Pluggy não listou conexões para esta conta. Cole o itemId de cada banco abaixo (fica em meu.pluggy.ai, na conexão).",
              "Pluggy didn't list any connections for this account. Paste each bank's itemId below (found at meu.pluggy.ai, in the connection).",
            );
    });

  const add = () => {
    const id = newId.trim();
    if (!id || of.connections.some((c) => c.itemId === id)) return;
    setConnections([...of.connections, { itemId: id, owner: "PF" }]);
    setNewId("");
  };

  const patch = (itemId: string, changes: Partial<OpenFinanceConnection>) =>
    setConnections(of.connections.map((c) => (c.itemId === itemId ? { ...c, ...changes } : c)));
  const nameOf = (itemId: string) => found?.find((i) => i.id === itemId);

  const pluggyLink = (label: string) => <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer noopener">{label}</a>;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="row"><Landmark size={18} /> Open Finance (Meu Pluggy)</h2>
          <p className="muted small">
            {L("Puxa seus investimentos direto dos bancos pelo Open Finance, via ", "Pulls your investments straight from the banks through Open Finance, via ")}<a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer noopener">Meu Pluggy <ExternalLink size={11} /></a>{" "}
            {L("(grátis para uso pessoal: até 5 conexões do mesmo titular, atualizadas a cada 24 h). Depois é só ir em ", "(free for personal use: up to 5 connections of the same account holder, updated every 24 h). Then just go to ")}<b>{L("Importar → Open Finance", "Import → Open Finance")}</b>.
          </p>
        </div>
        {status?.configured && <span className="chip ok"><CheckCircle2 size={12} /> {L("credenciais salvas", "credentials saved")} {status.clientIdHint}</span>}
      </div>

      <ol className="small steps">
        <li>{L("Crie a conta em ", "Create an account at ")}{pluggyLink("meu.pluggy.ai")}{L(" e conecte seus bancos (você autoriza no app de cada banco).", " and connect your banks (you authorize it in each bank's app).")}</li>
        <li>{L("Copie o ", "Copy your application's ")}<b>Client ID</b>{L(" e o ", " and ")}<b>Client Secret</b>{L(" da sua aplicação e cole abaixo.", " and paste them below.")}</li>
        <li>
          {getLang() === "pt"
            ? <>Clique em <b>Buscar conexões</b> (ou cole o <b>itemId</b> de cada banco) e marque se a conta é PF ou PJ.</>
            : <>Click <b>Find connections</b> (or paste each bank's <b>itemId</b>) and mark whether the account is PF or PJ.</>}
        </li>
      </ol>

      <CredentialsForm configured={!!status?.configured} busy={busy} onSave={(c) => act("save", async () => {
        await api.setOpenFinanceCredentials(c);
        await loadStatus();
        return c
          ? L("Credenciais conferidas com a Pluggy e salvas.", "Credentials verified with Pluggy and saved.")
          : L("Credenciais removidas.", "Credentials removed.");
      })} />

      <div className="card-head" style={{ marginTop: 18 }}>
        <h3>{L("Conexões", "Connections")}</h3>
        <button className="btn sm" disabled={!status?.configured || !!busy} onClick={() => void discover()}>
          {busy === "discover" ? <Loader2 size={14} className="spin" /> : <Search size={14} />} {L("Buscar conexões", "Find connections")}
        </button>
      </div>

      {of.connections.length > 0 ? (
        <div className="table-wrap">
          <table className="mc t-of">
            <thead><tr><th>{L("Conexão (itemId)", "Connection (itemId)")}</th><th>{L("Instituição na carteira", "Institution in portfolio")}</th><th>{L("Titular", "Owner")}</th><th /></tr></thead>
            <tbody>
              {of.connections.map((c) => {
                const info = nameOf(c.itemId);
                return (
                  <tr key={c.itemId}>
                    <td className="small ga-main" style={{ wordBreak: "break-all" }}>
                      {info?.name && <b>{info.name} </b>}
                      <code>{c.itemId}</code>
                      {info?.status === "NOT_FOUND" && <span className="chip bad">{L("não encontrada", "not found")}</span>}
                    </td>
                    <td className="ga-a" data-l={L("Instituição na carteira", "Institution in portfolio")} style={{ minWidth: 180 }}>
                      <input className="cell" type="text" value={c.institution ?? ""} placeholder={info?.name ?? L("automático (nome do banco)", "automatic (bank name)")}
                        onChange={(e) => patch(c.itemId, { institution: e.target.value || undefined })} />
                    </td>
                    <td className="ga-b" data-l={L("Titular", "Owner")}>
                      <select className="cell" value={c.owner} onChange={(e) => patch(c.itemId, { owner: e.target.value as Owner })} aria-label={L("Titular", "Owner")}>
                        {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="ga-act">
                      <button className="btn icon sm ghost" title={L("Remover conexão", "Remove connection")} onClick={() => setConnections(of.connections.filter((x) => x.itemId !== c.itemId))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">{L("Nenhuma conexão ainda.", "No connections yet.")}</p>
      )}

      <form className="row wrap" style={{ gap: 8, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input type="text" value={newId} placeholder={L("itemId (ex.: 4c1f0a7e-…)", "itemId (e.g. 4c1f0a7e-…)")} spellCheck={false} style={{ maxWidth: 340 }} onChange={(e) => setNewId(e.target.value)} />
        <button className="btn sm" disabled={!/^[0-9a-f-]{10,64}$/i.test(newId.trim())}><Plus size={14} /> {L("Adicionar", "Add")}</button>
      </form>

      <label className="check small" style={{ marginTop: 14, alignItems: "flex-start" }}>
        <input type="checkbox" checked={of.sourceOfTruth} onChange={(e) => set({ sourceOfTruth: e.target.checked })} style={{ marginTop: 2 }} />
        {getLang() === "pt" ? (
          <span>
            <b>Usar o Open Finance como fonte da verdade</b> das conexões acima: ao importar, substitui o que você tem naquela instituição
            <b> e titular</b>, e o <b>Atualizar valores</b> da Carteira traz os valores de lá — inclusive ativos novos e os que saíram. Você revisa antes de aplicar.
            Cada conexão só mexe no próprio escopo: uma conexão <b>BTG PF</b> atualiza só o BTG PF; o BTG PJ fica intacto, a não ser que exista
            também uma conexão BTG PJ trazendo dados.
          </span>
        ) : (
          <span>
            <b>Use Open Finance as the source of truth</b> for the connections above: importing replaces what you have at that institution
            <b> and owner</b>, and the Portfolio's <b>Update values</b> brings the values from there — including new assets and ones that are gone. You review before applying.
            Each connection only touches its own scope: a <b>BTG PF</b> connection updates only BTG PF; BTG PJ stays intact, unless there is
            also a BTG PJ connection bringing data.
          </span>
        )}
      </label>
      <label className="check small" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={of.includeAccounts} onChange={(e) => set({ includeAccounts: e.target.checked })} />
        {L("Incluir saldo de conta corrente e poupança (como Caixa)", "Include checking and savings account balances (as Cash)")}
      </label>
      <p className="muted small" style={{ marginTop: 6 }}>
        {L(
          "Contas PJ têm outro titular (CNPJ): no plano gratuito do Meu Pluggy só entram contas do mesmo titular. Corretoras de fora do Brasil (ex.: Interactive Brokers) não fazem parte do Open Finance — continue importando por print.",
          "PJ accounts have a different account holder (CNPJ): Meu Pluggy's free plan only includes accounts of the same holder. Brokers outside Brazil (e.g. Interactive Brokers) aren't part of Open Finance — keep importing them via screenshot.",
        )}
        {of.lastSyncAt && <> {L("Última importação:", "Last import:")} {new Date(of.lastSyncAt).toLocaleString(locale())}.</>}
      </p>
      {msg && <p className="small" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</p>}
    </section>
  );
}

function CredentialsForm({ configured, busy, onSave }: {
  configured: boolean;
  busy: string | null;
  onSave: (c: { clientId: string; clientSecret: string } | null) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const valid = /^[0-9a-f-]{20,64}$/i.test(clientId.trim()) && secret.trim().length >= 8;
  return (
    <>
      <form className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}
        onSubmit={(e) => { e.preventDefault(); if (valid) void onSave({ clientId: clientId.trim(), clientSecret: secret.trim() }).then(() => { setClientId(""); setSecret(""); }); }}>
        <label className="field grow" style={{ minWidth: 220 }}>Client ID
          <input type="text" autoComplete="off" spellCheck={false} value={clientId} placeholder={configured ? L("salvo — enviar outro substitui", "saved — sending another replaces it") : "00000000-0000-0000-0000-000000000000"} onChange={(e) => setClientId(e.target.value)} />
        </label>
        <label className="field grow" style={{ minWidth: 220 }}>Client Secret
          <input type="password" autoComplete="off" spellCheck={false} value={secret} placeholder={configured ? "••••••••••••" : ""} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <button className="btn primary" disabled={!valid || !!busy}>{busy === "save" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {L("Conferir e salvar", "Verify and save")}</button>
        {configured && <button type="button" className="btn danger" disabled={!!busy} onClick={() => void onSave(null)}>{L("Remover", "Remove")}</button>}
      </form>
      <p className="muted small" style={{ marginTop: 6 }}>
        {getLang() === "pt" ? (
          <>
            Ficam só no seu computador (<code>data/secrets.json</code>, fora do git) e nunca voltam para o navegador. Também dá para usar as variáveis
            de ambiente <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code>.
          </>
        ) : (
          <>
            They stay only on your computer (<code>data/secrets.json</code>, outside git) and never go back to the browser. You can also use the environment
            variables <code>PLUGGY_CLIENT_ID</code> and <code>PLUGGY_CLIENT_SECRET</code>.
          </>
        )}
      </p>
    </>
  );
}
