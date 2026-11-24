/* Textos de extensões (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const EXT_MESSAGES = {
  en: {
    commands: "Commands",
    settings: "Settings",
    active: "active",
  },
  ptAO: {
    commands: "Comandos",
    settings: "Definições",
    active: "activo",
  },
} satisfies Messages<string>;
