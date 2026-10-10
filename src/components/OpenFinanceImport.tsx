import { useEffect, useRef, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { openFinanceSettings, type OpenFinanceImport as OfResult } from "../../shared/openFinance";
import { api, type OpenFinanceStatus } from "../api";
import { useStore } from "../store";
import { Banner } from "./ui";

/** Importar → Open Finance: busca as conexões do Meu Pluggy e abre a mesma tela de revisão dos prints. */
export function OpenFinanceImport({ onResult, goSettings }: { onResult: (r: OfResult) => void; goSettings?: () => void }) {
  const { state } = useStore();
  const of = openFinanceSettings(state!.settings.openFinance);
  const [status, setStatus] = useState<OpenFinanceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api.openFinanceStatus().then(setStatus).catch(() => setStatus(null));
    return () => abort.current?.abort();
  }, []);

  const sync = async () => {
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      onResult(await api.openFinanceSync(abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = status?.configured && of.connections.length > 0;
  return (
    <div className="card">
      {error && <Banner kind="bad">{error}</Banner>}
      <div className="stack">
        <p className="small">
          {ready
            ? <>Vai buscar <b>{of.connections.length} {of.connections.length === 1 ? "conexão" : "conexões"}</b> ({of.connections.map((c) => `${c.institution ?? "banco"} ${c.owner}`).join(", ")}).
                Os valores vêm líquidos, como o banco informa ao Open Finance; a Pluggy atualiza uma vez por dia.</>
            : <>Configure o Meu Pluggy em <b>Ajustes → Open Finance</b>: credenciais da sua aplicação e as conexões (bancos) a importar.</>}
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          {ready ? (
            <button className="btn primary" disabled={busy} onClick={() => void sync()}>
              {busy ? <><Loader2 size={16} className="spin" /> Buscando no Open Finance…</> : <><Landmark size={16} /> Buscar investimentos</>}
            </button>
          ) : (
            <button className="btn primary" onClick={() => goSettings?.()}>Configurar Open Finance</button>
          )}
          {busy && <button className="btn" onClick={() => abort.current?.abort()}>Cancelar</button>}
        </div>
        <p className="muted small">
          Nada é salvo sem você conferir: na revisão dá para trocar a classe de cada investimento, desmarcar itens e escolher se as posições antigas
          dessas instituições que não vieram agora devem sair. Instituições fora do Open Finance continuam pelo print, vídeo ou texto.
        </p>
      </div>
    </div>
  );
}
