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

/* ── A6 (docs/v2/UI-AUDIT.md item 3): os runners reais, o resultado de cada teste e o histórico ──
   Espelham `tutor_eval::testrun` (`test_runners`, `test_run`) e `tutor_board::project::testhist`
   (`test_history`), serde camelCase. */

export type RunnerKind = "cargo" | "go" | "pytest" | "unittest" | "vitest" | "jest" | "maven" | "gradle";

/** Um runner que o projecto tem de facto (`testrun::Runner`); `id` = `<kind>:<pasta>`. */
export interface Runner {
  id: string;
  kind: RunnerKind;
  dir: string;
  command: string;
  available: boolean;
  /** porque não está disponível (a ferramenta não está instalada…) */
  reason: string;
}

export type CaseStatus = "passed" | "failed" | "skipped";

/** O resultado de um teste (`testrun::CaseResult`); `id` é estável entre corridas. */
export interface CaseResult {
  id: string;
  name: string;
  suite: string;
  file: string | null;
  status: CaseStatus;
  durationMs: number | null;
  message: string | null;
  output: string | null;
}

/** O que correr (`testrun::Scope`): `changed` com `files` vazio = o que o git vê alterado. */
export type TestScope = { kind: "all" } | { kind: "case"; name: string } | { kind: "changed"; files: string[] };

/** Uma corrida de um runner (`testrun::TestRunReport`). */
export interface TestRunReport {
  runner: string;
  kind: RunnerKind;
  command: string;
  ran: boolean;
  ok: boolean;
  durationMs: number;
  results: CaseResult[];
  output: string;
  /** o que a corrida não conseguiu fazer (timeout, nada a ver com os ficheiros alterados…) */
  note: string;
}

/** Uma corrida guardada (`testhist::RunRow`); a lista vem da mais recente para a mais antiga. */
export interface RunRow {
  id: number;
  at: number;
  runner: string;
  command: string;
  scope: string;
  ok: boolean;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** Os resultados recentes de um teste (`testhist::CaseStat`); `recent` = letras p/f/s, a mais recente primeiro. */
export interface CaseStat {
  caseId: string;
  name: string;
  suite: string;
  recent: string;
  last: string;
  flips: number;
  flaky: boolean;
  avgMs: number | null;
  lastMessage: string | null;
}

export interface TestHistory {
  runs: RunRow[];
  cases: CaseStat[];
}

/** O contexto que um pedido ao Co-Dev leva (a forma do `codev.ask`, sem depender da feature Co-Dev). */
export interface AskContext {
  kind: "test" | "file";
  label: string;
  text: string;
  path?: string;
}
