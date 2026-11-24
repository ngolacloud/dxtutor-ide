/* Textos de pesquisa (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const SEARCH_MESSAGES = {
  en: {
    resultsIn: "results in",
    replaceAll: "Replace all",
    searchInAllFiles: "Search in all files",
    replaceWith: "Replace with…",
  },
  ptAO: {
    resultsIn: "resultados em",
    replaceAll: "Substituir tudo",
    searchInAllFiles: "Procurar em todos os ficheiros",
    replaceWith: "Substituir por…",
  },
} satisfies Messages<string>;
