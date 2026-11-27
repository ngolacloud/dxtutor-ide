/* ═════════ cliente IPC: git (leitura) — ADR-0004, U2 ═════════
   Contratos de `git_log`, `git_show`, `git_changes` (src-tauri/src/commands/git.rs). */
import { invoke, type Invoker } from "./core";

/** `tutor_eval::git::GitCommit` (o último `max` de `git log --all`, mais recente primeiro). */
export interface GitCommit {
  hash: string;
  short: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

/** `tutor_eval::git::GitChange` (porcelain: estado, índice, árvore). */
export interface GitChange {
  path: string;
  status: string;
  index: string;
  work: string;
}

export const gitClient = (inv: Invoker = invoke) => ({
  log: (root: string, max?: number): Promise<GitCommit[]> => inv<GitCommit[]>("git_log", { root, max: max ?? null }),
  show: (root: string, hash: string): Promise<string> => inv<string>("git_show", { root, hash }),
  changes: (root: string): Promise<GitChange[]> => inv<GitChange[]>("git_changes", { root }),
  /** o comando exacto e a pasta de um clone, antes da aprovação (r23 F6) */
  clonePlan: (url: string, parentDir: string): Promise<ClonePlan> => inv<ClonePlan>("git_clone_plan", { url, parentDir }),
  /** clona para `parentDir/<nome>` (como o plano mostra) e devolve a pasta nova */
  clone: (url: string, parentDir: string): Promise<string> => inv<string>("git_clone", { url, parentDir }),
});

/** `tutor_eval::git::ClonePlan` (r23 F6). */
export interface ClonePlan { url: string; parent: string; name: string; target: string; exists: boolean; command: string }

export type GitClient = ReturnType<typeof gitClient>;
