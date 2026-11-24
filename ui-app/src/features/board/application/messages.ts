/* Textos que o motor do quadro emite nos cartões do Co-Dev (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const BOARD_ENGINE_MESSAGES = {
  en: {
    noChanges: "no changes",
    testsPassed: "tests passed",
    waitingForYourFunctional: "waiting for your functional validation on the board.",
    nextIssue: "Next issue:",
    eachIssueIsOn: "Each issue is on its own branch",
    theMergeInto: "; the merge into",
    happensWhenYouValidate: "happens when you validate.",
    validateOnTheBoard: "Validate on the board",
    viewTheGraph: "View the graph",
  },
  ptAO: {
    noChanges: "sem alterações",
    testsPassed: "testes passaram",
    waitingForYourFunctional: "à espera da tua validação funcional no quadro.",
    nextIssue: "Próxima issue:",
    eachIssueIsOn: "Cada issue está no seu ramo",
    theMergeInto: "; o merge em",
    happensWhenYouValidate: "acontece quando validares.",
    validateOnTheBoard: "Validar no quadro",
    viewTheGraph: "Ver o grafo",
  },
} satisfies Messages<string>;
export type BoardEngineKey = keyof typeof BOARD_ENGINE_MESSAGES.en;
