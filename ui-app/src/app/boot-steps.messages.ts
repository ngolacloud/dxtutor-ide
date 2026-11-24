/* Textos do arranque (barra de estado) (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "./i18n";

export const BOOT_MESSAGES = {
  en: {
    assistantForThisConversation: "Assistant for this conversation",
    lastCommitThatTouched: "Last commit that touched this file",
    runningStack: "Running stack",
  },
  ptAO: {
    assistantForThisConversation: "Assistente da conversa",
    lastCommitThatTouched: "Último commit que tocou neste ficheiro",
    runningStack: "Stack em execução",
  },
} satisfies Messages<string>;
