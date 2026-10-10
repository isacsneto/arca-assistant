import { createApp } from "./app";
import { fileStore } from "./store";
import { aiStatus, setApiKey } from "./ai";
import { estimateAsset, extractFromFiles, interpretPrompt, projectWithAi, refineImport, refreshWithAi, researchAsset, scanClass } from "./tasks";
import { refreshValues } from "./refresh";
import { yahooQuote } from "./quotes";
import { dataDir, secretsFile } from "./paths";
import { fetchConnections, filePluggyCredentials, pluggyClient } from "./pluggy";
import { openFinanceSettings } from "../shared/openFinance";
import { sampleVideo } from "./video";
import { PROVIDERS, aiSettings, isAiReady } from "../shared/ai";
import { L } from "../shared/i18n";

const store = fileStore();
const pluggyCredentials = filePluggyCredentials(secretsFile());
const pluggy = pluggyClient(() => pluggyCredentials.get());
const app = createApp({
  store,
  aiStatus,
  setApiKey,
  extractFromFiles,
  refineImport,
  interpretPrompt,
  scanClass,
  refreshValues: (state, emit, signal) =>
    refreshValues(state, {
      fetchQuote: yahooQuote,
      claudeRefresh: refreshWithAi,
      // Open Finance como fonte da verdade: as instituições conectadas vêm da Pluggy.
      openFinance: async (s, sig) => {
        const of = openFinanceSettings(s.settings.openFinance);
        if (!of.sourceOfTruth || !of.connections.length || !pluggyCredentials.get()) return null;
        return fetchConnections(pluggy, of.connections, { includeAccounts: of.includeAccounts, signal: sig });
      },
    }, emit, signal),
  projectPortfolio: projectWithAi,
  researchAsset,
  estimateAsset,
  pluggy: { credentials: pluggyCredentials, client: pluggy },
  sampleVideo,
});

const port = Number(process.env.PORT) || 3001;
// Só na própria máquina: a API expõe sua carteira e usa sua IA/assinatura.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(L(`Arca Assistant em http://${host}:${port}  (dados: ${dataDir()})`, `Arca Assistant at http://${host}:${port}  (data: ${dataDir()})`));
  void aiStatus().then((status) => {
    const ai = aiSettings(store.load().settings);
    const p = PROVIDERS[ai.provider];
    const mode = ai.auth === "apiKey" ? L("chave de API", "API key") : L("login local", "local login");
    if (isAiReady(ai, status)) console.log(`IA: ${p.label} (${mode}${status[ai.provider].account ? ` · ${status[ai.provider].account}` : ""})`);
    else console.warn(L(`⚠ IA ${p.label} (${mode}) não está pronta. Configure em Ajustes → Provedor de IA.`, `⚠ AI ${p.label} (${mode}) is not ready. Set it up in Settings → AI provider.`));
  });
});
