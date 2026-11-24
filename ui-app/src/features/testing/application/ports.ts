/* ═══════════ feature `testing` — application ports (ADR-0006, R2a) ═══════════
   O serviço (`testing-service.ts`) depende SÓ de `domain/` e destas interfaces. Os
   adaptadores vivem em `infrastructure/` (Tauri: `list_tests`/`run_test`/`run_all_tests`;
   legado: a pasta aberta e o comando de testes detectado, via `window.DXR`). */

import type { AskContext, Runner, TestHistory, TestItem, TestRun, TestRunReport, TestScope } from "../domain/types";

/** Os comandos de testes do backend, sobre a pasta `root`. */
export interface TestsPort {
  list(root: string): Promise<TestItem[]>;
  run(root: string, path: string, lang: string): Promise<TestRun>;
  runAll(root: string): Promise<TestRun>;
}

/** A pasta aberta (null sem pasta, ou no browser). */
export interface WorkspacePort {
  root(): string | null;
  /** Grava o que o editor tem no disco e espera pela fila de escrita: o backend lê o disco, e
   *  tem de testar o que o editor mostra (vindo da porta de testes do A0.5). */
  save?(): Promise<void>;
  /** O ficheiro activo no editor (relativo à pasta), para «Write a missing test» (A6). */
  currentFile?(): { path: string; text: string } | null;
}

/** A6: os runners reais do projecto, as corridas com resultado por teste e o histórico
 *  (`test_runners`, `test_run`, `test_history`). */
export interface RunnersPort {
  runners(root: string): Promise<Runner[]>;
  run(root: string, runner: string, scope: TestScope): Promise<TestRunReport>;
  history(root: string): Promise<TestHistory>;
}

/** A6: pedir ao Co-Dev (o `codev.ask` partilhado). */
export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "fix" | "change"; text: string; context: AskContext[]; send?: boolean }): void;
}
