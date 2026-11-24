/* Textos da sessão de depuração que o motor mostra — nasceram em português sem par no motor de tradução;
   com chave (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. O motor recebe a porta
   `copy` (a composição, `../../debug.ts`, injecta `translator(…)`); sem ela, `ptCopy` (o comportamento de antes). */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const DEBUG_ENGINE_MESSAGES = {
  en: {
    noGdb: "gdb is not installed: step-by-step debugging uses gdb (Rust, C, C++). Install it (e.g. «sudo apt install gdb») and try again.",
    failed: "Debugging failed: {error}",
    noBins: "This Cargo project has no binaries (only libraries): there is no program to run. Debug through a binary or an example.",
    whichBin: "Which binary to debug?",
    buildFailed: "«cargo build» failed — fix the errors and try again:\n{out}",
    exePath: "Path of the executable to debug (built with debug information, e.g. -g)",
    notStopped: "Execution did not stop at a known point ({reason}).", noReason: "no reason",
    openFolder: "Open a folder (File → Open Folder…) to debug the project.",
    waitStop: "Wait for the execution to stop", noSessionF5: "There is no debugging session — F5 to start", noSession: "There is no debugging session",
    ended: "Session ended.",
  },
  ptAO: {
    noGdb: "O gdb não está instalado: a depuração passo-a-passo usa o gdb (Rust, C, C++). Instala-o (p.ex. «sudo apt install gdb») e tenta de novo.",
    failed: "A depuração falhou: {error}",
    noBins: "Este projecto Cargo não tem binários (só bibliotecas): não há programa para correr. Depura através de um binário ou de um exemplo.",
    whichBin: "Que binário depurar?",
    buildFailed: "O «cargo build» falhou — corrige os erros e tenta de novo:\n{out}",
    exePath: "Caminho do executável a depurar (compilado com informação de depuração, p.ex. -g)",
    notStopped: "A execução não parou num ponto conhecido ({reason}).", noReason: "sem razão",
    openFolder: "Abre uma pasta (File → Open Folder…) para depurar o projecto.",
    waitStop: "Espera que a execução pare", noSessionF5: "Não há uma sessão de depuração — F5 para começar", noSession: "Não há uma sessão de depuração",
    ended: "Sessão terminada.",
  },
} satisfies Messages<string>;

export type DebugEngineKey = keyof typeof DEBUG_ENGINE_MESSAGES.en;
export type DebugCopy = (key: DebugEngineKey, params?: Record<string, string | number>) => string;
/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: DebugCopy = fixedCopy(DEBUG_ENGINE_MESSAGES.ptAO);
