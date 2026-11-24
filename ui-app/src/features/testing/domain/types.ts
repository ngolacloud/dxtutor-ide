/* ═══════════ feature `testing` — domain: tipos (ADR-0006, R2a) ═══════════
   Formas puras do pane «Testing». Espelham os contratos do backend (`tutor_eval::testnav`,
   comandos `list_tests`/`run_test`/`run_all_tests`) e o estado de cada teste na vista.
   PURO: sem DOM, sem `window`, sem Tauri. */

/** Um teste descoberto (`testnav::TestItem`, camelCase). `path` é como o runner o
 *  endereça (Rust: caminho com módulos, p.ex. `tests::falha`; Go/Python: o nome). */
export interface TestItem {
  name: string;
  path: string;
  file: string;
  line: number;
  ignored: boolean;
  lang: string;
}

/** O resultado de uma corrida (`testnav::TestRun`): `ran` é falso quando não chegou a
 *  correr (timeout, falha a lançar, suíte inexistente). */
export interface TestRun {
  ran: boolean;
  passed: boolean;
  output: string;
}

/** O estado de um teste na vista. `idle` = ainda sem resultado (ou desconhecido). */
export type TestStatus = "idle" | "running" | "passed" | "failed" | "ignored";

export interface TestState {
  status: TestStatus;
  /** Saída da última corrida individual deste teste (run_test). */
  output?: string;
}

/** Os testes de um ficheiro, pela ordem da descoberta. */
export interface FileGroup {
  file: string;
  items: TestItem[];
}

export interface Counts {
  passed: number;
  failed: number;
  ignored: number;
  total: number;
}
