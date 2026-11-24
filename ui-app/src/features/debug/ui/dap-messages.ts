/* Textos da depuração com DAP (A7, docs/v2/UI-AUDIT.md item 4) — nascem com chave (ADR-0004, U6b): en + ptAO.
   Os textos que vão para o Co-Dev (`ask*`) também mudam com a língua. */
import type { Messages } from "../../../app/i18n";

export const DAP_MESSAGES = {
  en: {
    stepOut: "Step out", pause: "Pause", stopOnPanic: "Stop on panic", engineDap: "DAP · {adapter}", engineGdb: "gdb/MI",
    threads: "Threads", variables: "Variables", watch: "Watch", addWatch: "Add an expression to watch", output: "Output",
    noOutput: "Nothing printed yet.", changed: "changed since the last stop", notStopped: "not evaluated (the program is running)",
    askExplain: "✦ Ask Co-Dev about this stop", askTest: "✦ Turn this into a test", snapshot: "Save snapshot…",
    bpCondition: "Add a condition…", bpHit: "Stop on the n-th hit…", bpLog: "Make it a logpoint…", bpEnable: "Enable", bpDisable: "Disable", bpRemove: "Remove",
    bpAdd: "Add breakpoint", bpEdit: "Edit breakpoint", conditionPh: "Stop only when this is true (e.g. i == 3)", hitPh: "Stop on hit number (e.g. 3)",
    logPh: "Print this instead of stopping — {expr} shows a value (e.g. i = {i})", disabled: "disabled", when: "when {c}", hit: "hit {n}", log: "log «{m}»",
    needsDap: "Conditions, hit counts and logpoints need a DAP adapter (lldb-dap); the gdb session stops on plain breakpoints.",
    needsStop: "Stop the program at a breakpoint first.", panicNotFound: "No rust_panic symbol in this program: is it a Rust binary built with debug info?",
    noIssue: "(no issue)", snapshotPick: "Keep the snapshot with which issue?", snapshotSaved: "Snapshot saved in the project.", snapshotSavedIssue: "Snapshot saved with {issue}.",
    askExplainStop: "The program stopped here. Explain why these variables have these values, the likely cause of the problem, and suggest the next breakpoint.",
    askTestFromStop: "Write a test that reproduces this state (the inputs that lead to these values) and fails while the bug exists. Propose it as a change.",
  },
  ptAO: {
    stepOut: "Sair da função", pause: "Pausar", stopOnPanic: "Parar em panic", engineDap: "DAP · {adapter}", engineGdb: "gdb/MI",
    threads: "Threads", variables: "Variáveis", watch: "Observar", addWatch: "Acrescentar uma expressão a observar", output: "Saída",
    noOutput: "Ainda nada impresso.", changed: "mudou desde a última paragem", notStopped: "não avaliada (o programa está a correr)",
    askExplain: "✦ Perguntar ao Co-Dev sobre esta paragem", askTest: "✦ Transformar isto num teste", snapshot: "Guardar snapshot…",
    bpCondition: "Acrescentar uma condição…", bpHit: "Parar à n-ésima passagem…", bpLog: "Transformar em logpoint…", bpEnable: "Activar", bpDisable: "Desactivar", bpRemove: "Remover",
    bpAdd: "Acrescentar breakpoint", bpEdit: "Editar breakpoint", conditionPh: "Parar só quando isto for verdade (p.ex. i == 3)", hitPh: "Parar na passagem número (p.ex. 3)",
    logPh: "Imprimir isto em vez de parar — {expr} mostra um valor (p.ex. i = {i})", disabled: "desactivado", when: "quando {c}", hit: "passagem {n}", log: "log «{m}»",
    needsDap: "Condições, contagens e logpoints precisam de um adaptador DAP (lldb-dap); a sessão do gdb pára nos breakpoints simples.",
    needsStop: "Pára primeiro o programa num breakpoint.", panicNotFound: "Este programa não tem o símbolo rust_panic: é um binário Rust compilado com informação de depuração?",
    noIssue: "(sem issue)", snapshotPick: "Guardar o snapshot com que issue?", snapshotSaved: "Snapshot guardado no projecto.", snapshotSavedIssue: "Snapshot guardado com a {issue}.",
    askExplainStop: "O programa parou aqui. Explica porque é que estas variáveis têm estes valores, a causa provável do problema, e sugere o próximo breakpoint.",
    askTestFromStop: "Escreve um teste que reproduza este estado (as entradas que levam a estes valores) e falhe enquanto o bug existir. Propõe-o como alteração.",
  },
} satisfies Messages<string>;
export type DapKey = keyof typeof DAP_MESSAGES.en;
