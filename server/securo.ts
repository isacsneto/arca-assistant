import pg from "pg";
import { L } from "../shared/i18n";
import type { PluggyAccount, PluggyInvestment, PluggyItem } from "../shared/openFinance";
import { PluggyError, type PluggyClient } from "./pluggy";

/*
 * Securo (https://github.com/securo-finance/securo) como fonte do Open Finance: o Securo conecta os bancos
 * (widget da Pluggy → MeuPluggy) e sincroniza; o Arca só LÊ o banco de dados dele, no próprio PC.
 * O Securo guarda o payload original da Pluggy de cada investimento (external_metadata) — com ele, o
 * Arca remonta exatamente o que a API da Pluggy devolveria, e todo o fluxo de Open Finance (revisão,
 * fonte da verdade, atualização automática) funciona igual. Não precisa da senha do Securo.
 */

export const SECURO_DB_URL = "postgres://postgres:postgres@127.0.0.1:55432/securo";
export const SECURO_APP_URL = "http://localhost:3000";

export type Query = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Consulta só-leitura num pool pequeno (o Securo é dono do banco). */
export function pgQuery(url = SECURO_DB_URL): Query {
  const pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000, statement_timeout: 20_000 });
  pool.on("error", () => undefined); // conexão ociosa caiu (Securo parado): a próxima consulta reconecta
  return async <T,>(sql: string, params: unknown[] = []) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const res = await client.query(sql, params);
      return res.rows as T[];
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  };
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const isoDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.slice(0, 10) : null);
const isoTime = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

type ConnRow = { external_id: string; institution_name: string | null; display_name: string | null; status: string | null; last_sync_at: unknown };
type AssetRow = {
  external_id: string; name: string; currency: string; units: unknown; isin: string | null; maturity_date: unknown;
  last_price: unknown; external_metadata: Record<string, unknown> | null; amount: unknown; institution: string | null;
};
type AccountRow = { external_id: string; name: string; display_name: string | null; type: string; balance: unknown; currency: string };

/** Status do Securo → status de item da Pluggy (o Arca mostra "login expirou" etc.). */
const ITEM_STATUS: Record<string, string> = { active: "UPDATED", error: "LOGIN_ERROR", pending: "UPDATING", syncing: "UPDATING" };

export function securoClient(query: Query): PluggyClient {
  const item = (r: ConnRow): PluggyItem => ({
    id: r.external_id,
    status: ITEM_STATUS[(r.status ?? "").toLowerCase()] ?? (r.status ?? "").toUpperCase(),
    lastUpdatedAt: isoTime(r.last_sync_at),
    connector: { name: r.display_name || r.institution_name || "Securo" },
  });
  const run = async <T,>(sql: string, params?: unknown[]) => {
    try {
      return await query<T>(sql, params);
    } catch (e) {
      throw new PluggyError(L(`Não consegui ler o Securo (${(e as Error).message}). Ele está rodando?`, `Couldn't read Securo (${(e as Error).message}). Is it running?`), 503);
    }
  };
  const CONN = `select external_id, institution_name, display_name, status, last_sync_at from bank_connections where provider = 'pluggy'`;

  return {
    async check() {
      await run("select 1 from bank_connections limit 1");
    },
    async listItems() {
      return (await run<ConnRow>(`${CONN} order by created_at`)).map(item);
    },
    async getItem(itemId) {
      const [r] = await run<ConnRow>(`${CONN} and external_id = $1`, [itemId]);
      if (!r) throw new PluggyError(L("Conexão não encontrada no Securo.", "Connection not found in Securo."), 404);
      return item(r);
    },
    async investments(itemId) {
      // Valor = último valor sincronizado (asset_values); vendidos/arquivados ficam de fora.
      const rows = await run<AssetRow>(
        `select a.external_id, a.name, a.currency, a.units, a.isin, a.maturity_date, a.last_price, a.external_metadata,
                (select v.amount from asset_values v where v.asset_id = a.id order by v.date desc limit 1) as amount,
                i.name as institution
           from assets a
           join bank_connections c on c.id = a.connection_id
           left join asset_groups g on g.id = a.group_id
           left join institutions i on i.id = g.institution_id
          where c.provider = 'pluggy' and c.external_id = $1 and a.external_id is not null
            and not a.is_archived and a.sell_date is null`,
        [itemId],
      );
      return rows.map((r): PluggyInvestment => ({
        ...(r.external_metadata ?? {}),
        id: r.external_id,
        name: r.name,
        balance: num(r.amount),
        quantity: num(r.units),
        currencyCode: r.currency,
        dueDate: isoDate(r.maturity_date),
        ...(r.isin && { isin: r.isin }),
        ...(num(r.last_price) != null && { value: num(r.last_price) }),
      }) as PluggyInvestment);
    },
    async accounts(itemId) {
      const rows = await run<AccountRow>(
        `select a.external_id, a.name, a.display_name, a.type, a.balance, a.currency
           from accounts a join bank_connections c on c.id = a.connection_id
          where c.provider = 'pluggy' and c.external_id = $1 and not a.is_closed`,
        [itemId],
      );
      // O Securo traduz o tipo da Pluggy (BANK → checking/savings, CREDIT → credit_card); volta ao formato dela.
      return rows.map((r): PluggyAccount => ({
        id: r.external_id,
        name: r.display_name || r.name,
        type: r.type === "credit_card" ? "CREDIT" : "BANK",
        subtype: r.type === "savings" ? "SAVINGS_ACCOUNT" : r.type === "credit_card" ? "CREDIT_CARD" : "CHECKING_ACCOUNT",
        balance: num(r.balance),
        currencyCode: r.currency,
      }));
    },
    // Transações, faturas, empréstimos e movimentações: só pela Pluggy direto (o Securo guarda num formato próprio).
    transactions: async () => [],
    bills: async () => [],
    loans: async () => [],
    investmentTransactions: async () => [],
    async connectToken() {
      throw new PluggyError(
        L(`Com o Securo, os bancos são conectados nele: abra ${SECURO_APP_URL} → Contas → Conectar banco → MeuPluggy.`, `With Securo, banks are connected there: open ${SECURO_APP_URL} → Accounts → Connect bank → MeuPluggy.`),
        400,
      );
    },
  };
}
