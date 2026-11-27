/* ═════════ feature `testing` — adaptador Tauri (ADR-0006, R2a) ═════════
   Implementa a porta `TestsPort` sobre o cliente IPC tipado (`platform/tauri/core`):
   `list_tests`, `run_test`, `run_all_tests` (src-tauri/src/commands/tests.rs). Não toca
   em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { ResultsPort, RunnersPort, TestsPort } from "../application/ports";
import type { Runner, TestHistory, TestItem, TestRun, TestRunReport } from "../domain/types";

export const tauriTests = (inv: Invoker = invoke): TestsPort => ({
  list: (root) => inv<TestItem[]>("list_tests", { root }),
  run: (root, path, lang) => inv<TestRun>("run_test", { root, path, lang }),
  runAll: (root) => inv<TestRun>("run_all_tests", { root }),
});

/** A6: `test_runners`, `test_run` (âmbito todos / um teste / afectados) e `test_history`. */
export const tauriRunners = (inv: Invoker = invoke): RunnersPort => ({
  runners: (root) => inv<Runner[]>("test_runners", { root }),
  run: (root, runner, scope) => inv<TestRunReport>("test_run", { root, runner, scope }),
  history: (root) => inv<TestHistory>("test_history", { root }),
});

/** r23 F3: `test_results_record` (board.rs) — o commit é decidido no backend. */
export const tauriResults = (inv: Invoker = invoke): ResultsPort => ({
  record: (root, run) => inv<boolean>("test_results_record", { root, run }),
});
