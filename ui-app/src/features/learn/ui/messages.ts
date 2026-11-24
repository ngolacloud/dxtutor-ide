/* Textos de Learning Track (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const LEARN_MESSAGES = {
  en: {
    whatDoYouWant: "What do you want to learn?",
    pickALanguageAnd: "Pick a language and we'll guide you through a hands-on track, one step at a time.",
    whatSYourLevel: "What's your level?",
    pickOneOrMore: "Pick one or more. Your track loads only the levels you choose — mix Basic and Intermediate, go straight to Advanced, or take all three. You can change this later from the gear icon.",
    back: "← Back",
    start: "Start →",
    remove: "Remove",
    underTheHood: "Under the hood",
    referenceSolution: "Reference solution",
    notYet: "✗ Not yet",
    submitted: "✓ Submitted",
    simulated: "simulated",
    hiddenTestsDecideCorrectness: "Hidden tests decide correctness in the desktop app (",
    theBrowserCannotCompile: "). The browser cannot compile, so this prototype only checks that you replaced the starter with a real implementation.",
    askTheTutor: "Ask the Tutor",
    theTutorExplainsAnd: "The Tutor explains and hints; you write the final code.",
    withClaudeLiveThe: "With Claude live, the Tutor answers questions about your own code instead of showing the step's background.",
  },
  ptAO: {
    whatDoYouWant: "O que queres aprender?",
    pickALanguageAnd: "Escolhe uma linguagem e guiamos-te por um percurso prático, um passo de cada vez.",
    whatSYourLevel: "Qual é o teu nível?",
    pickOneOrMore: "Escolhe um ou mais. O percurso carrega só os níveis que escolheres — mistura Básico e Intermédio, vai directo ao Avançado, ou faz os três. Podes mudar isto mais tarde no ícone da roda dentada.",
    back: "← Voltar",
    start: "Começar →",
    remove: "Remover",
    underTheHood: "Por baixo do capô",
    referenceSolution: "Solução de referência",
    notYet: "✗ Ainda não",
    submitted: "✓ Submetido",
    simulated: "simulado",
    hiddenTestsDecideCorrectness: "Os testes ocultos decidem a correcção na aplicação desktop (",
    theBrowserCannotCompile: "). O browser não compila, por isso este protótipo só verifica que substituíste o ponto de partida por uma implementação real.",
    askTheTutor: "Perguntar ao Tutor",
    theTutorExplainsAnd: "O Tutor explica e dá pistas; o código final escreves tu.",
    withClaudeLiveThe: "Com o Claude ao vivo, o Tutor responde a perguntas sobre o teu código em vez de mostrar o contexto do passo.",
  },
} satisfies Messages<string>;
