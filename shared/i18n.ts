/*
 * Idiomas da interface (inglês é o padrão; português selecionável em Settings).
 * Cada texto é escrito nos dois idiomas no próprio lugar onde aparece:
 *   L("Carteira", "Portfolio")
 * O idioma é global (app de um usuário só): o navegador aplica o dos ajustes ao
 * carregar/trocar e o servidor aplica o mesmo ao ler/salvar o estado.
 * Nunca chame L() no topo de um módulo — o valor ficaria congelado no idioma de
 * quando o módulo carregou. Use dentro de funções/componentes ou em getters.
 */

export type Lang = "en" | "pt";
export const LANGS: Record<Lang, { label: string; locale: string; ai: string }> = {
  en: { label: "English", locale: "en-US", ai: "English" },
  pt: { label: "Português (Brasil)", locale: "pt-BR", ai: "Brazilian Portuguese" },
};
export const DEFAULT_LANG: Lang = "en";

// Fora do app (testes, scripts) o padrão interno é português, o idioma original do código.
let current: Lang = "pt";

export const getLang = (): Lang => current;
export const toLang = (l: unknown): Lang => (l === "pt" ? "pt" : "en");
export function setLang(l: unknown) {
  current = toLang(l);
}

/** Texto no idioma atual. */
export const L = (pt: string, en: string): string => (current === "pt" ? pt : en);

/** Locale para números e datas (en-US ou pt-BR). */
export const locale = (): string => LANGS[current].locale;
