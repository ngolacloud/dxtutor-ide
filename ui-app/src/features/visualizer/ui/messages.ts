/* Textos de Visualize execution (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const VISUALIZER_MESSAGES = {
  en: {
    in: "in",
    speed: "Speed",
  },
  ptAO: {
    in: "em",
    speed: "Rapidez",
  },
} satisfies Messages<string>;
