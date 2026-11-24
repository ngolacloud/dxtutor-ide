/* Textos de Tasks (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const TASKS_MESSAGES = {
  en: {
    openTheBoard: "Open the board",
    openTheStudio: "Open the Studio",
    branch: "Branch",
    cost: "Cost",
    actions: "Actions",
    reviewDiff: "Review diff",
    reject: "✗ Reject",
  },
  ptAO: {
    openTheBoard: "Abrir o quadro",
    openTheStudio: "Abrir o Studio",
    branch: "Ramo",
    cost: "Custo",
    actions: "Acções",
    reviewDiff: "Rever diff",
    reject: "✗ Rejeitar",
  },
} satisfies Messages<string>;
