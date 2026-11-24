/* Textos que o motor da infra emite (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const INFRA_ENGINE_MESSAGES = {
  en: {
    type: "Type",
  },
  ptAO: {
    type: "Tipo",
  },
} satisfies Messages<string>;
export type InfraEngineKey = keyof typeof INFRA_ENGINE_MESSAGES.en;
