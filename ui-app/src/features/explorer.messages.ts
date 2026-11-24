/* Textos de explorer (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const EXPLORER_MESSAGES = {
  en: {
    openAFileTo: "Open a file to see its symbols.",
  },
  ptAO: {
    openAFileTo: "Abre um ficheiro para ver os símbolos.",
  },
} satisfies Messages<string>;
