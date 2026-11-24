/* Textos de Explain · Code review · Under the hood (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const CODEREVIEW_MESSAGES = {
  en: {
    openFile: "Open file",
    underTheHood: "Under the hood",
  },
  ptAO: {
    openFile: "Abrir ficheiro",
    underTheHood: "Por baixo do capô",
  },
} satisfies Messages<string>;
