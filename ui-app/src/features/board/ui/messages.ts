/* Textos do quadro (kanban) (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const BOARD_MESSAGES = {
  en: {
    resume: "▶ Resume",
    validate: "✓ Validate",
    reject: "✗ Reject",
    board: "Board",
    runSprint: "▶ Run sprint",
    testsRunByThemselves: "Tests run by themselves when a card enters here. Failure → back to development.",
    onlyWhatPassedThe: "Only what passed the tests gets here. The validation is yours.",
    emptyBacklog: "Empty backlog",
    designTheArchitectureIn: "Design the architecture in the Studio and generate the backlog from the planned components.",
    openTheStudio: "Open the Studio",
    generateFromTheCurrent: "Generate from the current design",
    reviewDiff: "Review diff",
  },
  ptAO: {
    resume: "▶ Retomar",
    validate: "✓ Validar",
    reject: "✗ Rejeitar",
    board: "Quadro",
    runSprint: "▶ Executar sprint",
    testsRunByThemselves: "Ao entrar aqui os testes correm sozinhos. Falha → volta a desenvolvimento.",
    onlyWhatPassedThe: "Só chega aqui o que passou nos testes. A validação é tua.",
    emptyBacklog: "Backlog vazio",
    designTheArchitectureIn: "Desenha a arquitectura no Studio e gera o backlog a partir dos componentes planeados.",
    openTheStudio: "Abrir o Studio",
    generateFromTheCurrent: "Gerar a partir do desenho actual",
    reviewDiff: "Rever diff",
  },
} satisfies Messages<string>;
