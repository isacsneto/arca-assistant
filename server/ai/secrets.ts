import fs from "node:fs";
import path from "node:path";
import { PROVIDER_IDS, type ProviderId } from "../../shared/ai";
import { L } from "../../shared/i18n";

/*
 * Chaves de API dos provedores. Ficam só no servidor (arquivo fora do git,
 * permissão restrita); o navegador só sabe SE há chave, nunca o valor.
 * Variáveis de ambiente valem como alternativa.
 */

const ENV: Record<ProviderId, string[]> = {
  claude: ["ANTHROPIC_API_KEY"],
  codex: ["CODEX_API_KEY", "OPENAI_API_KEY"],
  cursor: ["CURSOR_API_KEY"],
};

export interface SecretStore {
  get(provider: ProviderId): string | undefined;
  set(provider: ProviderId, key: string | null): void;
  has(provider: ProviderId): boolean;
}

export function fileSecrets(file: string, env: NodeJS.ProcessEnv = process.env): SecretStore {
  const read = (): Partial<Record<ProviderId, string>> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const get = (p: ProviderId) => read()[p]?.trim() || ENV[p].map((k) => env[k]?.trim()).find(Boolean);
  return {
    get,
    has: (p) => Boolean(get(p)),
    set(p, key) {
      if (!PROVIDER_IDS.includes(p)) throw new Error(L("Provedor inválido.", "Invalid provider."));
      const all = read();
      const clean = key?.trim();
      if (clean) all[p] = clean;
      else delete all[p];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}

/** Variáveis de ambiente que cada provedor usa para a chave (para limpar no modo "login local"). */
export const keyEnvVars = (p: ProviderId) => ENV[p];
