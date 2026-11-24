/* Textos de terminal (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const TERMINAL_MESSAGES = {
  en: {
    files: "files",
    model: "· model",
  },
  ptAO: {
    files: "ficheiros",
    model: "· modelo",
  },
} satisfies Messages<string>;
