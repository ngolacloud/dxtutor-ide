/* Textos do «Under the hood» real e do traço de execução (A8, docs/v2/UI-AUDIT.md item 7) — nascem com chave
   (ADR-0004, U6b): en + ptAO. Os textos que vão para o Co-Dev (`ask*`) também mudam com a língua. */
import type { Messages } from "../../../app/i18n";

export const HOOD_MESSAGES = {
  en: {
    hoodTab: "Hood · {f}", traceTab: "Trace · {f}", title: "Under the hood (real)", traceTitle: "Execution trace",
    needFile: "Open a Rust or Python file first.", needMain: "This Rust file has no fn main: build a program (or an example) to look under its hood.",
    needSizes: "Give at least four sizes (e.g. 1000, 2000, 4000, 8000).",
    debug: "Debug", release: "Release", machine: "Machine code", llvm: "LLVM IR", asm: "Assembly", mir: "MIR", disasm: "Disassembly", bytecode: "Bytecode",
    loading: "Building…", pickLine: "Pick a line to see the code it becomes.", noCode: "This line produced no code of its own (declarations, inlined calls, or code the optimiser removed).",
    instructions: "{n} instructions", total: "{n} instructions in your functions · {p} build", ops: "{n} ops", pyVersion: "CPython {v}",
    measure: "Run & measure", run: "Run", wall: "wall", cpu: "CPU", rss: "peak memory", exit: "exit code", memCurve: "memory while it ran",
    growth: "Growth with N", growthHelp: "Your program reads N from its first argument (std::env::args().nth(1)). It is built once and run for each N; the time to start a process is taken off.",
    measureGrowth: "Measure", fit: "fits {o}", r2: "R² {r}", confidence: "confidence: {c}", notMeasured: "Not measured yet.",
    askLine: "✦ Explain this line's code", askGrowthBtn: "✦ Why this growth?", askStepBtn: "✦ Explain this step",
    prev: "Previous step", next: "Next step", play: "Play", pause: "Pause", step: "step {i} of {n}", stack: "Stack", locals: "Locals", output: "Output", noLocals: "No locals here.",
    unsupported: "Not traced: {why}", realNote: "The real execution: every line that ran, with the frame's locals as the program saw them.",
    askLineText: "Explain what this source line becomes in the code below, instruction by instruction, and what that says about its cost.",
    askGrowthText: "The measured times fit {o}. Explain where in the code that growth comes from and how to improve it, if it can be improved.",
    askStepText: "Explain what this step of the real execution does and why the locals have these values.",
    needDesktop: "This runs the real toolchain: it needs the desktop app.", openReal: "Machine code per line (real)", openTrace: "Trace the real execution",
  },
  ptAO: {
    hoodTab: "Hood · {f}", traceTab: "Traço · {f}", title: "Por baixo do capô (real)", traceTitle: "Traço de execução",
    needFile: "Abre primeiro um ficheiro Rust ou Python.", needMain: "Este ficheiro Rust não tem fn main: constrói um programa (ou um exemplo) para ver por baixo do capô.",
    needSizes: "Dá pelo menos quatro tamanhos (p.ex. 1000, 2000, 4000, 8000).",
    debug: "Debug", release: "Release", machine: "Código máquina", llvm: "LLVM IR", asm: "Assembly", mir: "MIR", disasm: "Desmontagem", bytecode: "Bytecode",
    loading: "A construir…", pickLine: "Escolhe uma linha para ver o código em que se transforma.", noCode: "Esta linha não gerou código próprio (declarações, chamadas inline, ou código que o optimizador tirou).",
    instructions: "{n} instruções", total: "{n} instruções nas tuas funções · build {p}", ops: "{n} operações", pyVersion: "CPython {v}",
    measure: "Correr e medir", run: "Correr", wall: "tempo real", cpu: "CPU", rss: "memória de pico", exit: "código de saída", memCurve: "memória durante a execução",
    growth: "Crescimento com N", growthHelp: "O teu programa lê N do primeiro argumento (std::env::args().nth(1)). É construído uma vez e corrido para cada N; o tempo de arrancar o processo é descontado.",
    measureGrowth: "Medir", fit: "ajusta {o}", r2: "R² {r}", confidence: "confiança: {c}", notMeasured: "Ainda não medido.",
    askLine: "✦ Explicar o código desta linha", askGrowthBtn: "✦ Porquê este crescimento?", askStepBtn: "✦ Explicar este passo",
    prev: "Passo anterior", next: "Passo seguinte", play: "Reproduzir", pause: "Pausar", step: "passo {i} de {n}", stack: "Pilha", locals: "Locais", output: "Saída", noLocals: "Sem variáveis locais aqui.",
    unsupported: "Sem traço: {why}", realNote: "A execução real: cada linha que correu, com as variáveis locais tal como o programa as viu.",
    askLineText: "Explica em que se transforma esta linha de código no código abaixo, instrução a instrução, e o que isso diz do seu custo.",
    askGrowthText: "Os tempos medidos ajustam {o}. Explica de onde vem esse crescimento no código e como o melhorar, se puder ser melhorado.",
    askStepText: "Explica o que faz este passo da execução real e porque é que as variáveis locais têm estes valores.",
    needDesktop: "Isto corre a toolchain real: precisa da app desktop.", openReal: "Código máquina por linha (real)", openTrace: "Traçar a execução real",
  },
} satisfies Messages<string>;
export type HoodKey = keyof typeof HOOD_MESSAGES.en;
