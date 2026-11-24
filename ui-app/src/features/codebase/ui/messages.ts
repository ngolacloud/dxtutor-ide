/* Textos de Dependencies e Onboarding (A10) — nascem com chave (ADR-0004, U6b): en + ptAO. */
import type { Messages } from "../../../app/i18n";

export const CODEBASE_MESSAGES = {
  en: {
    depsTab: "Dependencies", mapTab: "Onboarding", depsTitle: "Dependencies",
    depsSub: "What is behind and what is vulnerable, from each ecosystem's own tools. Updating is a command you approve, run in a terminal — then run the tests.",
    online: "Ask the registries (online)", offlineNote: "Offline: Cargo only, with the local advisory database.", check: "Check", checking: "Checking…", none: "None.", noEco: "No Cargo.lock, package-lock.json or go.mod in this project.",
    vulns: "Vulnerabilities and warnings", outdated: "Behind", direct: "direct", fixed: "fixed in {v}", noFix: "no fixed version yet",
    update: "Update", upgrade: "To {v}…", plan: "✦ Plan", why: "✦ Explain", runTests: "Run the tests", ran: "Sent to the terminal: {c}",
    updateWhat: "Update {n} to {v} (within the manifest's requirement):", upgradeWhat: "Move {n} to {v} (changes the manifest; read its changelog first):", runWhat: "Run {n}:",
    confirmCmd: "{what}\n\n{cmd}\n\nRun it in a terminal?",
    askUpgrade: "Plan the upgrade of {n} from {from} to {to}: what breaks (its changelog / breaking changes), which code here must change, and propose those changes. Don't run anything.",
    askVuln: "Explain this vulnerability, whether this project is exposed (how it uses the package), and the safest fix.",
    mapTitle: "Onboarding", mapSub: "A map of this project, from the project itself: where to start, what to read, what changes most and who knows it.",
    refresh: "Refresh", loading: "Reading the project…", languages: "Languages", entries: "Entry points", docs: "Read first", hot: "Changed most (6 months)", people: "Who commits most", modules: "Largest modules",
    files: "{n} files", lines: "{n} lines", tests: "{n} test files", changes: "{n}×", commits: "{n} commits", symbols: "{n} symbols", run: "Run",
    tour: "✦ Give me a tour", mapLabel: "project map", askTour: "Give me a guided tour of this codebase from this map: what it is, where to start reading, how the parts fit, and what to watch out for. Open the files you cite.",
    needDesktop: "This reads the real project: it needs the desktop app with a folder open.",
  },
  ptAO: {
    depsTab: "Dependências", mapTab: "Onboarding", depsTitle: "Dependências",
    depsSub: "O que está atrasado e o que é vulnerável, pelas ferramentas de cada ecossistema. Actualizar é um comando que aprovas, corrido num terminal — e depois os testes.",
    online: "Perguntar aos registos (online)", offlineNote: "Offline: só o Cargo, com a base local de avisos.", check: "Verificar", checking: "A verificar…", none: "Nenhum.", noEco: "Não há Cargo.lock, package-lock.json nem go.mod neste projecto.",
    vulns: "Vulnerabilidades e avisos", outdated: "Atrasadas", direct: "directa", fixed: "corrigida em {v}", noFix: "ainda sem versão corrigida",
    update: "Actualizar", upgrade: "Para {v}…", plan: "✦ Planear", why: "✦ Explicar", runTests: "Correr os testes", ran: "Enviado para o terminal: {c}",
    updateWhat: "Actualizar {n} para {v} (dentro do requisito do manifesto):", upgradeWhat: "Passar {n} para {v} (muda o manifesto; lê primeiro o changelog):", runWhat: "Correr {n}:",
    confirmCmd: "{what}\n\n{cmd}\n\nCorrer num terminal?",
    askUpgrade: "Planeia a actualização de {n} de {from} para {to}: o que parte (changelog / breaking changes), que código daqui tem de mudar, e propõe essas alterações. Não corras nada.",
    askVuln: "Explica esta vulnerabilidade, se este projecto está exposto (como usa o pacote), e a correcção mais segura.",
    mapTitle: "Onboarding", mapSub: "Um mapa deste projecto, tirado do próprio projecto: por onde começar, o que ler, o que muda mais e quem o conhece.",
    refresh: "Actualizar", loading: "A ler o projecto…", languages: "Linguagens", entries: "Pontos de entrada", docs: "Ler primeiro", hot: "Mais mexidos (6 meses)", people: "Quem mais commita", modules: "Maiores módulos",
    files: "{n} ficheiros", lines: "{n} linhas", tests: "{n} ficheiros de teste", changes: "{n}×", commits: "{n} commits", symbols: "{n} símbolos", run: "Correr",
    tour: "✦ Faz-me uma visita guiada", mapLabel: "mapa do projecto", askTour: "Faz-me uma visita guiada a esta base de código a partir deste mapa: o que é, por onde começar a ler, como as partes encaixam, e a que ter atenção. Abre os ficheiros que citares.",
    needDesktop: "Isto lê o projecto real: precisa da app desktop com uma pasta aberta.",
  },
} satisfies Messages<string>;
export type CodebaseKey = keyof typeof CODEBASE_MESSAGES.en;
