import { createApp } from "./app";
import { fileStore } from "./store";
import { authStatus, extractFromFiles, projectWithClaude, refreshWithClaude, scanClass } from "./claude";
import { refreshValues } from "./refresh";
import { yahooQuote } from "./quotes";

const app = createApp({
  store: fileStore(),
  authStatus,
  extractFromFiles,
  scanClass,
  refreshValues: (state, emit, signal) =>
    refreshValues(state, { fetchQuote: yahooQuote, claudeRefresh: refreshWithClaude }, emit, signal),
  projectPortfolio: projectWithClaude,
});

const port = Number(process.env.PORT) || 3001;
// Só na própria máquina: a API expõe sua carteira e usa sua assinatura do Claude.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Arca Assistant API em http://${host}:${port}`);
  void authStatus().then((a) => {
    if (!a.loggedIn) console.warn("⚠ Claude Code não está logado. Rode `claude auth login` e reinicie.");
    else console.log(`Claude Code conectado${a.account ? ` (${a.account})` : ""} — usando o login local, sem API key.`);
  });
});
