/* Textos de página de boas-vindas (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const WELCOME_MESSAGES = {
  en: {
    youDecideTheAssistants: "You decide; the assistants accelerate. Learn a language, or design an architecture and take it to a running stack and a local cluster.",
    build: "Build",
    learn: "Learn",
  },
  ptAO: {
    youDecideTheAssistants: "Tu decides; os assistentes aceleram. Aprende uma linguagem, ou desenha uma arquitectura e leva-a até uma stack em execução e um cluster local.",
    build: "Construir",
    learn: "Aprender",
  },
} satisfies Messages<string>;
