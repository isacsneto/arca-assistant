import { useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { inView } from "../../shared/owner";
import { money } from "../lib/format";
import { ClassLabel, Empty, PageHead } from "./ui";
import { L } from "../../shared/i18n";

const INFLOW = new Set(["deposito", "venda", "dividendo", "juros"]);

/** Rótulo exibido do tipo (o valor salvo continua em português). */
function typeLabel(t: string): string {
  const labels: Record<string, string> = {
    dividendo: L("dividendo", "dividend"),
    compra: L("compra", "buy"),
    venda: L("venda", "sell"),
    deposito: L("depósito", "deposit"),
    saque: L("saque", "withdrawal"),
    juros: L("juros", "interest"),
    taxa: L("taxa", "fee"),
    transferencia: L("transferência", "transfer"),
    outro: L("outro", "other"),
  };
  return labels[t] ?? t;
}

export function Transactions() {
  const { state, update, view } = useStore();
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      inView(state!.transactions, view)
        .filter((t) => `${t.description} ${t.ticker ?? ""} ${t.institution} ${t.type} ${typeLabel(t.type)}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [state, query, view],
  );

  return (
    <>
      <PageHead title={L("Transações", "Transactions")} subtitle={L("Histórico importado de extratos e notas. Não altera suas posições automaticamente.", "History imported from statements and brokerage notes. It doesn't change your positions automatically.")} />
      <div className="card">
        {state!.transactions.length === 0 ? (
          <Empty title={L("Nenhuma transação", "No transactions")}>{L("Importe extratos ou notas de corretagem e elas aparecem aqui.", "Import statements or brokerage notes and they show up here.")}</Empty>
        ) : (
          <>
            <div className="row" style={{ width: 280, marginBottom: 12 }}>
              <Search size={16} className="muted" />
              <input type="text" placeholder={L("Filtrar…", "Filter…")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="mc t-tx">
                <thead><tr><th>{L("Data", "Date")}</th><th>{L("Tipo", "Type")}</th><th>{L("Descrição", "Description")}</th><th>{L("Instituição", "Institution")}</th><th>{L("Titular", "Owner")}</th><th>{L("Classe", "Class")}</th><th className="right">{L("Valor", "Amount")}</th><th /></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="num mc-hide">{t.date ?? "—"}</td>
                      <td className="mc-hide"><span className="chip">{typeLabel(t.type)}</span></td>
                      <td className="ga-main">{t.ticker && <b>{t.ticker} </b>}{t.description}<div className="muted small m-only">{[t.date, typeLabel(t.type)].filter(Boolean).join(" · ")}</div></td>
                      <td className="muted ga-sub">{t.institution} <span className={"chip owner-" + t.owner + " m-only"}>{t.owner}</span></td>
                      <td className="mc-hide"><span className={"chip owner-" + t.owner}>{t.owner}</span></td>
                      <td className="ga-a"><ClassLabel c={t.assetClass} /></td>
                      <td className="right num ga-val" style={{ color: INFLOW.has(t.type) ? "var(--ok)" : undefined }}>
                        {INFLOW.has(t.type) ? "+" : t.type === "compra" || t.type === "saque" || t.type === "taxa" ? "−" : ""}{money(t.amount, t.currency)}
                      </td>
                      <td className="right ga-act">
                        <button className="btn ghost icon danger" title={L("Remover", "Remove")} onClick={() => update((s) => ({ ...s, transactions: s.transactions.filter((x) => x.id !== t.id) }))}>
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
