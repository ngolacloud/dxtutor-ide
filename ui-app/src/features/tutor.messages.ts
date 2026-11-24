/* Textos de pane do Learning Track (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const TUTOR_MESSAGES = {
  en: {
    chooseWhatToLearn: "Choose what to learn",
    pickALanguageAnd: "Pick a language and a level to load your guided track.",
    changeLanguageOrLevel: "Change language or level",
  },
  ptAO: {
    chooseWhatToLearn: "Escolher o que aprender",
    pickALanguageAnd: "Escolhe uma linguagem e um nível para carregar o teu percurso guiado.",
    changeLanguageOrLevel: "Mudar de linguagem ou nível",
  },
} satisfies Messages<string>;
