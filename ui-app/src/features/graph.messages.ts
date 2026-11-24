/* Textos de grafo de commits (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const GRAPH_MESSAGES = {
  en: {
    goToDevelop: "Go to develop",
  },
  ptAO: {
    goToDevelop: "Ir para develop",
  },
} satisfies Messages<string>;
