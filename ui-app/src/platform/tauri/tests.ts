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
