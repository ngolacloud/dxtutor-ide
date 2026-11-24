/* Textos de paleta de comandos (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const PALETTE_MESSAGES = {
  en: {
    noResults: "No results.",
  },
  ptAO: {
    noResults: "Sem resultados.",
  },
} satisfies Messages<string>;
