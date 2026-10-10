import fs from "node:fs";
import path from "node:path";
import { L } from "../shared/i18n";
import type { ConnectionData, OpenFinanceConnection, PluggyAccount, PluggyInvestment, PluggyItem } from "../shared/openFinance";

/*
 * Cliente mínimo da API da Pluggy (https://docs.pluggy.ai), para o plano pessoal
 * gratuito do Meu Pluggy. Client ID/Secret ficam só no servidor (mesmo arquivo das
 * chaves de IA, fora do git) — o navegador só sabe se estão configurados.
 */

export const PLUGGY_API = "https://api.pluggy.ai";

export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface PluggyCredentialStore {
  get(): PluggyCredentials | null;
  set(creds: PluggyCredentials | null): void;
}

/** Guarda as credenciais na chave "pluggy" do arquivo de segredos (preserva as chaves de IA). */
export function filePluggyCredentials(file: string, env: NodeJS.ProcessEnv = process.env): PluggyCredentialStore {
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    get() {
      const p = read().pluggy as Partial<PluggyCredentials> | undefined;
      const clientId = p?.clientId?.trim() || env.PLUGGY_CLIENT_ID?.trim();
      const clientSecret = p?.clientSecret?.trim() || env.PLUGGY_CLIENT_SECRET?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    },
    set(creds) {
      const all = read();
      if (creds) all.pluggy = { clientId: creds.clientId.trim(), clientSecret: creds.clientSecret.trim() };
      else delete all.pluggy;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}

export class PluggyError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface PluggyClient {
  /** Autentica (valida as credenciais). */
  check(signal?: AbortSignal): Promise<void>;
  /** Conexões da aplicação, se a API permitir listar; senão, lista vazia. */
  listItems(signal?: AbortSignal): Promise<PluggyItem[]>;
  getItem(itemId: string, signal?: AbortSignal): Promise<PluggyItem>;
  investments(itemId: string, signal?: AbortSignal): Promise<PluggyInvestment[]>;
  accounts(itemId: string, signal?: AbortSignal): Promise<PluggyAccount[]>;
}

/** A apiKey da Pluggy vale 2 h; renovamos antes disso. */
const KEY_TTL_MS = 90 * 60_000;

export function pluggyClient(creds: () => PluggyCredentials | null, fetchImpl: Fetch = fetch, base = PLUGGY_API): PluggyClient {
  let cached: { key: string; at: number; clientId: string } | null = null;

  async function apiKey(signal?: AbortSignal, fresh = false): Promise<string> {
    const c = creds();
    if (!c) throw new PluggyError(L("Configure o Client ID e o Client Secret do Meu Pluggy em Ajustes → Open Finance.", "Set up the Meu Pluggy Client ID and Client Secret in Settings → Open Finance."), 400);
    if (!fresh && cached && cached.clientId === c.clientId && Date.now() - cached.at < KEY_TTL_MS) return cached.key;
    const res = await fetchImpl(`${base}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret }),
      signal: signal ?? AbortSignal.timeout(20_000),
    }).catch((e: unknown) => {
      throw new PluggyError(L(`Não foi possível falar com a Pluggy (${(e as Error).message}).`, `Couldn't reach Pluggy (${(e as Error).message}).`));
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) throw new PluggyError(L("A Pluggy recusou o Client ID/Client Secret. Confira em meu.pluggy.ai.", "Pluggy rejected the Client ID/Client Secret. Check them at meu.pluggy.ai."), 401);
    if (!res.ok) throw new PluggyError(L(`A Pluggy respondeu com erro ${res.status} na autenticação.`, `Pluggy returned error ${res.status} during authentication.`));
    const body = (await res.json()) as { apiKey?: string };
    if (!body.apiKey) throw new PluggyError(L("Resposta inesperada da Pluggy na autenticação.", "Unexpected response from Pluggy during authentication."));
    cached = { key: body.apiKey, at: Date.now(), clientId: c.clientId };
    return body.apiKey;
  }

  async function get<T>(url: string, signal?: AbortSignal, retry = true): Promise<T> {
    const key = await apiKey(signal);
    const res = await fetchImpl(`${base}${url}`, {
      headers: { "X-API-KEY": key, Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(30_000),
    }).catch((e: unknown) => {
      throw new PluggyError(L(`Não foi possível falar com a Pluggy (${(e as Error).message}).`, `Couldn't reach Pluggy (${(e as Error).message}).`));
    });
    if ((res.status === 401 || res.status === 403) && retry) {
      cached = null; // apiKey expirada: autentica de novo uma vez
      return get<T>(url, signal, false);
    }
    if (res.status === 404) throw new PluggyError(L("Conexão não encontrada na Pluggy. Confira o itemId.", "Connection not found on Pluggy. Check the itemId."), 404);
    if (!res.ok) throw new PluggyError(L(`A Pluggy respondeu com erro ${res.status}.`, `Pluggy returned error ${res.status}.`));
    return (await res.json()) as T;
  }

  /** Busca todas as páginas de um endpoint paginado. */
  async function all<T>(url: string, signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const sep = url.includes("?") ? "&" : "?";
      const body = await get<{ results?: T[]; totalPages?: number }>(`${url}${sep}page=${page}&pageSize=500`, signal);
      out.push(...(body.results ?? []));
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return out;
  }

  const id = (itemId: string) => {
    if (!/^[0-9a-f-]{10,64}$/i.test(itemId)) throw new PluggyError(L("itemId inválido.", "Invalid itemId."), 400);
    return encodeURIComponent(itemId);
  };

  return {
    async check(signal) {
      await apiKey(signal, true);
    },
    async listItems(signal) {
      try {
        const body = await get<{ results?: PluggyItem[] } | PluggyItem[]>("/items", signal);
        return Array.isArray(body) ? body : (body.results ?? []);
      } catch (e) {
        if (e instanceof PluggyError && e.status === 401) throw e;
        return []; // nem todo plano expõe a listagem; o usuário cola o itemId
      }
    },
    getItem: async (itemId, signal) => get<PluggyItem>(`/items/${id(itemId)}`, signal),
    investments: async (itemId, signal) => all<PluggyInvestment>(`/investments?itemId=${id(itemId)}`, signal),
    accounts: async (itemId, signal) => all<PluggyAccount>(`/accounts?itemId=${id(itemId)}`, signal),
  };
}

/** Busca tudo de cada conexão; uma conexão com erro não derruba as outras. */
export async function fetchConnections(
  client: PluggyClient,
  connections: OpenFinanceConnection[],
  opts: { includeAccounts: boolean; signal?: AbortSignal },
): Promise<ConnectionData[]> {
  return Promise.all(
    connections.map(async (connection): Promise<ConnectionData> => {
      try {
        const [item, investments, accounts] = await Promise.all([
          client.getItem(connection.itemId, opts.signal).catch((e: unknown) => {
            if (e instanceof PluggyError && e.status === 401) throw e;
            if (e instanceof PluggyError && e.status === 404) throw e;
            return null;
          }),
          client.investments(connection.itemId, opts.signal),
          opts.includeAccounts ? client.accounts(connection.itemId, opts.signal) : Promise.resolve([]),
        ]);
        return { connection, item, investments, accounts };
      } catch (e) {
        if (e instanceof PluggyError && e.status === 401) throw e;
        return { connection, item: null, investments: [], accounts: [], error: (e as Error).message };
      }
    }),
  );
}
