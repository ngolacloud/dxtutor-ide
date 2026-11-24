/* ═════════ feature scm — adaptador Tauri da A4 (docs/v2/UI-AUDIT.md item 9) ═════════
   Implementa a porta `GitExtrasPort` sobre o cliente IPC tipado (`platform/tauri/core`):
   `git_blame`, `git_history`, `git_show_path`, `git_compare`, `git_stash`, `git_worktree`,
   `git_rebase`, `git_amend` (src-tauri/src/commands/git.rs) e os já existentes `git_show` e
   `git_diff`. Não toca em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { GitExtrasPort } from "../application/extras-ports";
import type { Blame, Compare, HistCommit, RebasePlan, StashResult, Worktree } from "../domain/git-extras";

export const tauriGitExtras = (inv: Invoker = invoke): GitExtrasPort => ({
  blame: (root, path) => inv<Blame>("git_blame", { root, path }),
  history: (root, path, start, end) => inv<HistCommit[]>("git_history", { root, path, start, end, max: 200 }),
  showPath: (root, hash, path) => inv<string>("git_show_path", { root, hash, path }),
  show: (root, hash) => inv<string>("git_show", { root, hash }),
  stagedDiff: (root) => inv<string>("git_diff", { root, file: null, staged: true }),
  compare: (root, base, target) => inv<Compare>("git_compare", { root, base, target }),
  stash: (root, op) => inv<StashResult>("git_stash", { root, op }),
  worktree: (root, op) => inv<Worktree[]>("git_worktree", { root, op }),
  rebase: (root, op) => inv<RebasePlan>("git_rebase", { root, op }),
  amend: (root, message, allowPublished) => inv<string>("git_amend", { root, message, allowPublished }),
});
