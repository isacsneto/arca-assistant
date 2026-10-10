import { createApp } from "./app";
import { fileStore } from "./store";
import { aiStatus, setApiKey } from "./ai";
import { estimateAsset, extractFromFiles, interpretPrompt, projectWithAi, refineImport, refreshWithAi, scanClass } from "./tasks";
import { refreshValues } from "./refresh";
import { yahooQuote } from "./quotes";
import { dataDir, secretsFile } from "./paths";
import { filePluggyCredentials, pluggyClient } from "./pluggy";
import { sampleVideo } from "./video";
import { PROVIDERS, aiSettings, isAiReady } from "../shared/ai";

const store = fileStore();
const pluggyCredentials = filePluggyCredentials(secretsFile());
const app = createApp({
  store,
  aiStatus,
  setApiKey,
  extractFromFiles,
  refineImport,
  interpretPrompt,
  scanClass,
  refreshValues: (state, emit, signal) => refreshValues(state, { fetchQuote: yahooQuote, claudeRefresh: refreshWithAi }, emit, signal),
  projectPortfolio: projectWithAi,
  estimateAsset,
  pluggy: { credentials: pluggyCredentials, client: pluggyClient(() => pluggyCredentials.get()) },
  sampleVideo,
});

const port = Number(process.env.PORT) || 3001;
// Só na própria máquina: a API expõe sua carteira e usa sua IA/assinatura.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Arca Assistant em http://${host}:${port}  (dados: ${dataDir()})`);
  void aiStatus().then((status) => {
    const ai = aiSettings(store.load().settings);
    const p = PROVIDERS[ai.provider];
    const mode = ai.auth === "apiKey" ? "chave de API" : "login local";
    if (isAiReady(ai, status)) console.log(`IA: ${p.label} (${mode}${status[ai.provider].account ? ` · ${status[ai.provider].account}` : ""})`);
    else console.warn(`⚠ IA ${p.label} (${mode}) não está pronta. Configure em Ajustes → Provedor de IA.`);
  });
});
