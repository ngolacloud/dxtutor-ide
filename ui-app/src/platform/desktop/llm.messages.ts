/* Textos do desktop: modelos e aprovação de comandos (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../app/i18n";

export const LLM_MESSAGES = {
  en: {
    allow: "Allow",
    deny: "Deny",
  },
  ptAO: {
    allow: "Permitir",
    deny: "Recusar",
  },
} satisfies Messages<string>;
