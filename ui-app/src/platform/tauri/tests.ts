/* ═════════ cliente IPC: testes — A0.5 (docs/v2/UI-AUDIT.md) ═════════
   Contratos de `list_tests`, `run_test`, `run_all_tests` (src-tauri/src/commands/tests.rs).
   A descoberta é sintáctica (Rust via syn, Go, Python unittest) e corre fora da thread da
   janela; cada execução tem tecto de tempo no backend. */
import { invoke, type Invoker } from "./core";

/** `tutor_eval::testnav::TestItem` (serde camelCase). */
export interface TestItem {
  name: string;
  /** como o runner endereça o teste (Rust: caminho do módulo para `--exact`; Go: nome) */
  path: string;
  file: string;
  line: number;
  ignored: boolean;
  /** "rust" | "go" | "python" */
  lang: string;
}

/** `tutor_eval::testnav::TestRun`. `ran: false` = não chegou a correr (timeout, spawn). */
export interface TestRun {
  ran: boolean;
  passed: boolean;
  output: string;
}

export const testsClient = (inv: Invoker = invoke) => ({
  list: (root: string): Promise<TestItem[]> => inv<TestItem[]>("list_tests", { root }),
  runOne: (root: string, path: string, lang: string | null): Promise<TestRun> => inv<TestRun>("run_test", { root, path, lang }),
  runAll: (root: string): Promise<TestRun> => inv<TestRun>("run_all_tests", { root }),
});

export type TestsClient = ReturnType<typeof testsClient>;

/* ── A6 (docs/v2/UI-AUDIT.md item 3): runners reais, resultados por teste e histórico ──
   Contratos de `test_runners`, `test_run`, `test_history` (`tutor_eval::testrun` e
   `tutor_board::project::testhist`, serde camelCase). */

export type RunnerKind = "cargo" | "go" | "pytest" | "unittest" | "vitest" | "jest" | "maven" | "gradle";

/** `tutor_eval::testrun::Runner`: um runner que o projecto tem de facto. */
export interface Runner {
  /** `<kind>:<dir>` */
  id: string;
  kind: RunnerKind;
  dir: string;
  command: string;
  available: boolean;
  reason: string;
}

export type CaseStatus = "passed" | "failed" | "skipped";

/** `tutor_eval::testrun::CaseResult`. */
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

/** `tutor_eval::testrun::Scope` — `changed` com `files` vazio = os ficheiros que o git vê alterados. */
export type TestScope = { kind: "all" } | { kind: "case"; name: string } | { kind: "changed"; files: string[] };

/** `tutor_eval::testrun::TestRunReport`. */
export interface TestRunReport {
  runner: string;
  kind: RunnerKind;
  command: string;
  ran: boolean;
  ok: boolean;
  durationMs: number;
  results: CaseResult[];
  output: string;
  note: string;
}

/** `testhist::RunRow`: uma execução guardada. */
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

/** `testhist::CaseStat`: os resultados recentes de um teste. */
export interface CaseStat {
  caseId: string;
  name: string;
  suite: string;
  /** letras p/f/s, mais recente primeiro */
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

export const testRunsClient = (inv: Invoker = invoke) => ({
  runners: (root: string): Promise<Runner[]> => inv<Runner[]>("test_runners", { root }),
  run: (root: string, runner: string, scope: TestScope): Promise<TestRunReport> => inv<TestRunReport>("test_run", { root, runner, scope }),
  history: (root: string): Promise<TestHistory> => inv<TestHistory>("test_history", { root }),
});
