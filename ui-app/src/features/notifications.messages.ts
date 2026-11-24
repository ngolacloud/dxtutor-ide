/* Textos de notificações (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const NOTIFICATIONS_MESSAGES = {
  en: {
    noNotifications: "No notifications.",
  },
  ptAO: {
    noNotifications: "Sem notificações.",
  },
} satisfies Messages<string>;
