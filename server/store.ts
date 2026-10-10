import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, methodologyOf, type AppState } from "../shared/types";
import { withOwner } from "../shared/owner";
import { sanitizeAssets } from "../shared/assets";
import { aiSettings } from "../shared/ai";
import { openFinanceSettings } from "../shared/openFinance";
import { toLang } from "../shared/i18n";
import { fxRates, toCurrency } from "../shared/currency";
import { stateFile } from "./paths";

export interface Store {
  load(): AppState;
  save(state: AppState): void;
}

function empty(): AppState {
  return { positions: [], transactions: [], assets: [], settings: structuredClone(DEFAULT_SETTINGS), scans: {} };
}

/** Normaliza um estado salvo (possivelmente de versão antiga) completando campos ausentes. */
export function withDefaults(raw: Partial<AppState>): AppState {
  const base = empty();
  return {
    positions: (raw.positions ?? base.positions).map(withOwner),
    transactions: (raw.transactions ?? base.transactions).map(withOwner),
    assets: sanitizeAssets(raw.assets),
    scans: raw.scans ?? base.scans,
    projection: raw.projection,
    settings: {
      ...base.settings,
      ...withoutLegacy(raw.settings),
      targets: { ...base.settings.targets, ...raw.settings?.targets },
      methodology: raw.settings?.methodology ?? methodologyOf({ ...base.settings.targets, ...raw.settings?.targets }),
      extraction: { ...base.settings.extraction, ...raw.settings?.extraction },
      scan: { ...base.settings.scan, ...raw.settings?.scan },
      refresh: { ...base.settings.refresh, ...raw.settings?.refresh },
      projection: { ...base.settings.projection, ...raw.settings?.projection },
      estimate: { ...base.settings.estimate, ...raw.settings?.estimate },
      ai: aiSettings({ ai: raw.settings?.ai ?? base.settings.ai }),
      openFinance: openFinanceSettings(raw.settings?.openFinance),
      language: raw.settings?.language ? toLang(raw.settings.language) : base.settings.language,
      // Estados antigos guardavam só o dólar em "usdBrl".
      fx: fxRates(raw.settings?.fx, (raw.settings as { usdBrl?: number } | undefined)?.usdBrl),
      displayCurrency: toCurrency(raw.settings?.displayCurrency),
    },
  };
}

/** Tira campos que não existem mais (ex.: usdBrl, trocado por fx). */
function withoutLegacy(s: Partial<AppState["settings"]> | undefined) {
  if (!s) return s;
  const { usdBrl: _legacy, ...rest } = s as Partial<AppState["settings"]> & { usdBrl?: number };
  return rest;
}

export function fileStore(file = stateFile()): Store {
  return {
    load() {
      try {
        return withDefaults(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppState>);
      } catch {
        return empty();
      }
    },
    save(state) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}
