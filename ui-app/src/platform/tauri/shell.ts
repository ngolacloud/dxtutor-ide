/* ═════════ cliente IPC: processos (exec / shell interactiva) — ADR-0004, U2 ═════════
   Contratos de `exec`, `run_shell`, `kill_shell` (src-tauri/src/procs). */
import { invoke, type Invoker } from "./core";

/** `procs::ExecOut` (serde camelCase). */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface ExecArgs {
  program: string;
  args: string[];
  cwd?: string | null;
  env?: Record<string, string> | null;
  stdin?: string | null;
  timeoutMs?: number | null;
}

export const shellClient = (inv: Invoker = invoke) => ({
  /** Corre um programa e espera pelo fim (com timeout). */
  exec: (a: ExecArgs): Promise<ExecResult> =>
    inv<ExecResult>("exec", { program: a.program, args: a.args, cwd: a.cwd ?? null, env: a.env ?? null, stdin: a.stdin ?? null, timeoutMs: a.timeoutMs ?? null }),
  /** Arranca uma linha na shell persistente; a saída chega pelos eventos `proc-line`/`proc-exit`. */
  runShell: (a: { id: string; line: string; cwd?: string | null; env?: Record<string, string> | null }): Promise<void> =>
    inv<void>("run_shell", { id: a.id, line: a.line, cwd: a.cwd ?? null, env: a.env ?? null }),
  killShell: (id: string): Promise<boolean> => inv<boolean>("kill_shell", { id }),
});

export type ShellClient = ReturnType<typeof shellClient>;
