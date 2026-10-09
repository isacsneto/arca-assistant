import { useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { money } from "../lib/format";
import { ClassLabel, Empty, PageHead } from "./ui";

const INFLOW = new Set(["deposito", "venda", "dividendo", "juros"]);

export function Transactions() {
  const { state, update } = useStore();
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      state!.transactions
        .filter((t) => `${t.description} ${t.ticker ?? ""} ${t.institution} ${t.type}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [state, query],
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
              <table>
                <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Instituição</th><th>Classe</th><th className="right">Valor</th><th /></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="num">{t.date ?? "—"}</td>
                      <td><span className="chip">{t.type}</span></td>
                      <td>{t.ticker && <b>{t.ticker} </b>}{t.description}</td>
                      <td className="muted">{t.institution}</td>
                      <td><ClassLabel c={t.assetClass} /></td>
                      <td className="right num" style={{ color: INFLOW.has(t.type) ? "var(--ok)" : undefined }}>
                        {INFLOW.has(t.type) ? "+" : t.type === "compra" || t.type === "saque" || t.type === "taxa" ? "−" : ""}{money(t.amount, t.currency)}
                      </td>
                      <td className="right">
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
