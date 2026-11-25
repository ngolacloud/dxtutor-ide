/* ═════════ feature scm — adaptador Tauri da A4 (docs/v2/UI-AUDIT.md item 9) ═════════
   Implementa a porta `GitExtrasPort` sobre o cliente IPC tipado (`platform/tauri/core`):
   `git_blame`, `git_history`, `git_show_path`, `git_compare`, `git_stash`, `git_worktree`,
   `git_rebase`, `git_amend` (src-tauri/src/commands/git.rs) e os já existentes `git_show` e
   `git_diff`. Não toca em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { GhPort, GhRun, GhStatusData, LifecyclePort, SyncOp, SyncPlanData, SyncPort, ConflictPrediction, ConflictStagesData, MergePort, MergeStateData, FileHunksData, GitExtrasPort, GitRefsPort, HunksPort, UndoEntryData, UndoPlanData, UndoPort } from "../application/extras-ports";
import { auditClient } from "../../../platform/tauri/audit";
import { shellClient } from "../../../platform/tauri/shell";
import type { RefsSnapshot } from "../domain/refs";
import type { Pr } from "../domain/launchpad";
import type { Blame, Compare, HistCommit, RebasePlan, StashResult, Worktree } from "../domain/git-extras";
import { parseChangeSetGroups } from "../domain/changesets";

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
  changes: (root) => inv<Array<{ path: string; status: string }>>("git_changes", { root }),
  worktreeDiff: (root, path) => inv<string>("git_diff", { root, file: path, staged: false }),
  rangeDiff: (root, base, target, path) => inv<string>("git_diff_range", { root, base, target, path }),
  changeSets: async (root) => parseChangeSetGroups(await inv<unknown>("project_change_sets", { root })),
});

/** O Commit Graph (r23 F3): `git_refs` e o `git_show` de um commit. */
export const tauriGitRefs = (inv: Invoker = invoke): GitRefsPort => ({
  refs: (root) => inv<RefsSnapshot>("git_refs", { root }),
  predict: (root, branches) => inv<ConflictPrediction[]>("git_predict_conflicts", { root, branches }),
  show: (root, hash) => inv<string>("git_show", { root, hash }),
});

/** O staging por hunk (r23 F3, UI-SCM-10): `git_hunks` e `git_stage_hunks`. */
export const tauriHunks = (inv: Invoker = invoke): HunksPort => ({
  hunks: (root, path, staged) => inv<FileHunksData>("git_hunks", { root, path, staged }),
  stageHunks: (root, path, ids, unstage) => inv<FileHunksData>("git_stage_hunks", { root, path, ids, unstage }),
});

/** O undo (r23 F3, UI-SCM-12): as fotografias `git_undo_*`. */
export const tauriUndo = (inv: Invoker = invoke): UndoPort => ({
  snapshot: (root, label) => inv<UndoEntryData>("git_undo_snapshot", { root, label }),
  list: (root) => inv<UndoEntryData[]>("git_undo_list", { root }),
  plan: (root, id) => inv<UndoPlanData>("git_undo_plan", { root, id }),
  restore: (root, id) => inv<UndoEntryData>("git_undo_restore", { root, id }),
});

/** O registo de auditoria das operações git do IDE (r23 F1), com feature `scm`. */
export const tauriScmAudit = (inv: Invoker = invoke) => ({
  record: (root: string, e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void> =>
    auditClient(inv).record(root, { feature: "scm", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? e.outcome ?? "sent" : undefined }),
});

/** O merge a três (r23 F3, UI-SCM-13): `git_merge` e `git_conflict_stages`. */
export const tauriMerge = (inv: Invoker = invoke): MergePort => ({
  merge: (root, op) => inv<MergeStateData>("git_merge", { root, op }),
  stages: (root, path) => inv<ConflictStagesData>("git_conflict_stages", { root, path }),
});

/** O sync (r23 F3): `git_sync_plan` e `git_sync`. */
export const tauriSync = (inv: Invoker = invoke): SyncPort => ({
  plan: (root, op) => inv<SyncPlanData>("git_sync_plan", { root, op }),
  run: (root, op: SyncOp, expected) => inv<string>("git_sync", { root, op, expected }),
});

/** O GitHub CLI, só leitura (r23 F3): `gh_status`, `gh_prs`, `gh_runs_for`, `gh_prs_for`. */
export const tauriGh = (inv: Invoker = invoke): GhPort => ({
  status: () => inv<GhStatusData>("gh_status"),
  prs: (root, filter) => inv<Pr[]>("gh_prs", { root, filter }),
  runsFor: (root, sha) => inv<GhRun[]>("gh_runs_for", { root, sha }),
  prsFor: (root, sha) => inv<Pr[]>("gh_prs_for", { root, sha }),
});

/** Abre um URL https no browser do sistema (o mesmo caminho do terminal do painel): nunca dentro da janela da app. */
export function openExternal(url: string, os: string, inv: Invoker = invoke): void {
  if (!/^https:\/\//.test(url)) return;
  const [program, args]: [string, string[]] = os === "windows" ? ["cmd", ["/C", "start", "", url]] : os === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  void shellClient(inv).exec({ program, args, timeoutMs: 15000 }).catch(() => undefined);
}

/** O ciclo de vida de um commit (r23 F3, UI-SCM-09): os testes gravados (`test_results_for`) e o gh. */
export const tauriLifecycle = (inv: Invoker = invoke): LifecyclePort => ({
  testsFor: (root, shas) => inv<import("../domain/lifecycle").TestResultRow[]>("test_results_for", { root, shas }),
  ghStatus: () => inv<GhStatusData>("gh_status"),
  runsFor: (root, sha) => inv<GhRun[]>("gh_runs_for", { root, sha }),
  prsFor: (root, sha) => inv<Pr[]>("gh_prs_for", { root, sha }),
});

