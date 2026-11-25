/* ═══════════ feature scm — application: ports of the A4 git work (docs/v2/UI-AUDIT.md item 9) ═══════════
   What `git-extras.ts` needs from the world, injected: the backend's git commands (`git_blame`,
   `git_history`, `git_show_path`, `git_compare`, `git_stash`, `git_worktree`, `git_rebase`,
   `git_amend`, plus `git_show` and `git_diff`), the open folder, the human (confirm, a line of
   text, a choice), Co-Dev and the tabs. Adapters: infrastructure/tauri.ts and legacy-bridge.ts. */

import type { Blame, Compare, HistCommit, RebaseOp, RebasePlan, StashOp, StashResult, Worktree, WorktreeOp } from "../domain/git-extras";
import type { ChangeSetGroup } from "../domain/changesets";
import type { RefsSnapshot } from "../domain/refs";

/** One file's hunks (r23 F3, UI-SCM-10): the shape of `git_hunks`. */
export interface HunkData { id: string; header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[]; added: number; removed: number }
export interface FileHunksData { path: string; staged: boolean; binary: boolean; hunks: HunkData[] }
/** Staging part of a file: read its hunks, move some into (or out of) the index. */
export interface HunksPort {
  hunks(root: string, path: string, staged: boolean): Promise<FileHunksData>;
  stageHunks(root: string, path: string, ids: string[], unstage: boolean): Promise<FileHunksData>;
}

/** The undo snapshots (r23 F3, UI-SCM-12): the shape of `git_undo_*`. */
export interface UndoEntryData { id: number; label: string; at: number; head: string | null; headSha: string | null; refs: Array<{ name: string; sha: string }>; index: string | null; worktree: string | null }
export interface UndoPlanData { entry: UndoEntryData; commands: string[][]; display: string }
export interface UndoPort {
  snapshot(root: string, label: string): Promise<UndoEntryData>;
  list(root: string): Promise<UndoEntryData[]>;
  plan(root: string, id: number): Promise<UndoPlanData>;
  restore(root: string, id: number): Promise<UndoEntryData>;
}

/** What the Commit Graph reads (r23 F3): the refs for its sidebar and a commit's patch (for its files). */
export interface GitRefsPort {
  refs(root: string): Promise<RefsSnapshot>;
  show(root: string, hash: string): Promise<string>;
}

export interface GitExtrasPort {
  blame(root: string, path: string): Promise<Blame>;
  history(root: string, path: string, start: number | null, end: number | null): Promise<HistCommit[]>;
  showPath(root: string, hash: string, path: string): Promise<string>;
  show(root: string, hash: string): Promise<string>;
  /** the staged diff (`git diff --cached`) */
  stagedDiff(root: string): Promise<string>;
  compare(root: string, base: string, target: string): Promise<Compare>;
  stash(root: string, op: StashOp): Promise<StashResult>;
  worktree(root: string, op: WorktreeOp): Promise<Worktree[]>;
  rebase(root: string, op: RebaseOp): Promise<RebasePlan>;
  amend(root: string, message: string | null, allowPublished: boolean): Promise<string>;
  /* A10 — reviewing a change */
  /** the working tree's changed files (`git_changes`) */
  changes(root: string): Promise<Array<{ path: string; status: string }>>;
  /** one file's working tree vs HEAD (`git_diff`) */
  worktreeDiff(root: string, path: string): Promise<string>;
  /** `base...target`, of one file or everything (`git_diff_range`) */
  rangeDiff(root: string, base: string, target: string, path: string | null): Promise<string>;
  /** RF-E08: the Co-Dev change sets accepted since the last commit, by issue (`project_change_sets`) */
  changeSets(root: string): Promise<ChangeSetGroup[]>;
}

export interface GitWorkspacePort {
  /** the open folder when it is a git repository (null otherwise, and in the browser) */
  root(): string | null;
  /** the folder's name (for a worktree's sibling folder) */
  project(): string;
  /** write the editor to disk and wait for the write queue (git reads the disk) */
  save(): Promise<void>;
  /** git changed the working tree or the refs: reload the files and the graph */
  changed(): Promise<void>;
  branches(): string[];
  current(): string;
  /** the file and line in the editor (relative path), with the selected line range */
  cursor(): { path: string; line: number; start: number; end: number } | null;
  /** the commit message box of the Source Control pane */
  commitMessage(): string;
  setCommitMessage(message: string): void;
  /** stage these files (relative paths; already staged ones stay staged) */
  stage(paths: string[]): void;
  /** put these files back as they are in the last commit (relative paths) */
  discard(paths: string[]): void;
  open(path: string, line?: number): void;
}

export interface HumanPort {
  confirm(message: string): boolean;
  /** a line of text (palette); null when cancelled */
  text(placeholder: string, verb: string, initial?: string): Promise<string | null>;
  /** a choice (palette); null when cancelled */
  pick(placeholder: string, items: Array<{ label: string; detail?: string; value: string }>): Promise<string | null>;
  toast(message: string): void;
}

export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "review" | "chat"; text: string; context: Array<{ kind: "hunk" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}

export interface TabsPort {
  open(id: string, title: string, kind: string): void;
  /** repaint the tab of `kind` if it is on screen */
  repaint(kind: string): void;
}
