/* ═════════ feature `codereview` — adaptador Tauri (ADR-0006, R2e2) ═════════
   `review_code` (src-tauri/src/commands/review.rs): corre os analisadores instalados
   (clippy/rustc, go vet, ruff, …) sobre um ficheiro da pasta aberta (âmbito `file`, caminho
   relativo). Não toca em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { AnalyzerReport } from "../domain/types";

export const tauriReview = (inv: Invoker = invoke) => ({
  file: (root: string, rel: string, version?: string | null): Promise<AnalyzerReport> =>
    inv<AnalyzerReport>("review_code", { root, scope: "file", path: rel, version: version ?? null }),
});

/** `run_tests` (src-tauri/src/commands/tests.rs): a suite do projecto pelo comando detectado — o
 *  mesmo que o agente usa para verificar. O «Apply & test» do painel corre-a com o código melhorado. */
export interface SuiteRun { command: string; ok: boolean; stdout: string; stderr: string }
export const tauriSuite = (inv: Invoker = invoke) => ({
  run: (root: string): Promise<SuiteRun> => inv<SuiteRun>("run_tests", { root }),
});
