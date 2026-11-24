/* ═══════════ feature `testing` — application ports (ADR-0006, R2a) ═══════════
   O serviço (`testing-service.ts`) depende SÓ de `domain/` e destas interfaces. Os
   adaptadores vivem em `infrastructure/` (Tauri: `list_tests`/`run_test`/`run_all_tests`;
   legado: a pasta aberta e o comando de testes detectado, via `window.DXR`). */

import type { TestItem, TestRun } from "../domain/types";

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
}
