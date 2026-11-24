/* ═════════ feature `testing` — adaptador Tauri (ADR-0006, R2a) ═════════
   Implementa a porta `TestsPort` sobre o cliente IPC tipado (`platform/tauri/core`):
   `list_tests`, `run_test`, `run_all_tests` (src-tauri/src/commands/tests.rs). Não toca
   em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { TestsPort } from "../application/ports";
import type { TestItem, TestRun } from "../domain/types";

export const tauriTests = (inv: Invoker = invoke): TestsPort => ({
  list: (root) => inv<TestItem[]>("list_tests", { root }),
  run: (root, path, lang) => inv<TestRun>("run_test", { root, path, lang }),
  runAll: (root) => inv<TestRun>("run_all_tests", { root }),
});
