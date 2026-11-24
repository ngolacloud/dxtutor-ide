/* Textos de diagnósticos (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const DIAGNOSTICS_MESSAGES = {
  en: {
    noProblemsInThe: "No problems in the workspace.",
  },
  ptAO: {
    noProblemsInThe: "Sem problemas no workspace.",
  },
} satisfies Messages<string>;
