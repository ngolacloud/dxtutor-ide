/* Textos de conta (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const ACCOUNT_MESSAGES = {
  en: {
    providers: "Providers",
    openSettings: "Open Settings",
  },
  ptAO: {
    providers: "Provedores",
    openSettings: "Abrir Definições",
  },
} satisfies Messages<string>;
