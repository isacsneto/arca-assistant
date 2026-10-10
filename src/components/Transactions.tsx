import { useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { inView } from "../../shared/owner";
import { money } from "../lib/format";
import { ClassLabel, Empty, PageHead } from "./ui";

const INFLOW = new Set(["deposito", "venda", "dividendo", "juros"]);

export function Transactions() {
  const { state, update, view } = useStore();
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      inView(state!.transactions, view)
        .filter((t) => `${t.description} ${t.ticker ?? ""} ${t.institution} ${t.type}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [state, query, view],
  );

  return (
    <>
      <PageHead title="Transações" subtitle="Histórico importado de extratos e notas. Não altera suas posições automaticamente." />
      <div className="card">
        {state!.transactions.length === 0 ? (
          <Empty title="Nenhuma transação">Importe extratos ou notas de corretagem e elas aparecem aqui.</Empty>
        ) : (
          <>
            <div className="row" style={{ width: 280, marginBottom: 12 }}>
              <Search size={16} className="muted" />
              <input type="text" placeholder="Filtrar…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="mc t-tx">
                <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Instituição</th><th>Titular</th><th>Classe</th><th className="right">Valor</th><th /></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="num mc-hide">{t.date ?? "—"}</td>
                      <td className="mc-hide"><span className="chip">{t.type}</span></td>
                      <td className="ga-main">{t.ticker && <b>{t.ticker} </b>}{t.description}<div className="muted small m-only">{[t.date, t.type].filter(Boolean).join(" · ")}</div></td>
                      <td className="muted ga-sub">{t.institution} <span className={"chip owner-" + t.owner + " m-only"}>{t.owner}</span></td>
                      <td className="mc-hide"><span className={"chip owner-" + t.owner}>{t.owner}</span></td>
                      <td className="ga-a"><ClassLabel c={t.assetClass} /></td>
                      <td className="right num ga-val" style={{ color: INFLOW.has(t.type) ? "var(--ok)" : undefined }}>
                        {INFLOW.has(t.type) ? "+" : t.type === "compra" || t.type === "saque" || t.type === "taxa" ? "−" : ""}{money(t.amount, t.currency)}
                      </td>
                      <td className="right ga-act">
                        <button className="btn ghost icon danger" title="Remover" onClick={() => update((s) => ({ ...s, transactions: s.transactions.filter((x) => x.id !== t.id) }))}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
