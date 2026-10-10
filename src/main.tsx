import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StoreProvider, useStore } from "./store";
import { setLang, toLang } from "../shared/i18n";
import "./styles.css";

/** Aplica o idioma dos ajustes e remonta o app quando ele muda. */
function LangRoot() {
  const { state } = useStore();
  // Antes de carregar o estado, usa o idioma do navegador só para a tela "Carregando…".
  const lang = toLang(state?.settings.language ?? (navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en"));
  setLang(lang);
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  return <App key={lang} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <LangRoot />
    </StoreProvider>
  </StrictMode>,
);
