/* ═══════════ feature scm — domain: git beyond the basics (A4, docs/v2/UI-AUDIT.md item 9) ═══════════
   The shapes of `tutor_eval::gitx` (blame, history, compare, stash, worktrees, rebase — serde
   camelCase) and the pure rules the views need: what the blame says about one line, how old a
   line is on a 0–1 scale (the heatmap), the interactive-rebase plan the human edits (move,
   change the action, check it) and the git command it amounts to (shown before it runs).
   PURE: no DOM, no window, no Tauri. */

export interface BlameLine {
  line: number;
  /** empty for a line not committed yet */
  commit: string;
  author: string;
  /** unix seconds (0 when uncommitted) */
  time: number;
  summary: string;
}

export interface AuthorShare {
  author: string;
  lines: number;
  share: number;
  last: number;
}

export interface Blame {
  path: string;
  lines: BlameLine[];
  authors: AuthorShare[];
  uncommitted: number;
}

export interface HistCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  /** unix seconds */
  time: number;
  parents: number;
}

export interface FileStat {
  path: string;
  status: string;
  added: number | null;
  removed: number | null;
}

export interface Compare {
  base: string;
  target: string;
  ahead: HistCommit[];
  behind: HistCommit[];
  files: FileStat[];
}

export interface Stash {
  index: number;
  message: string;
  time: number;
}

export interface StashResult {
  stashes: Stash[];
  output: string;
}

export type StashOp =
  | { op: "list" }
  | { op: "push"; message: string; untracked: boolean }
  | { op: "apply"; index: number; pop: boolean }
  | { op: "drop"; index: number }
  | { op: "show"; index: number };

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
  current: boolean;
}

export type WorktreeOp = { op: "list" } | { op: "add"; path: string; branch: string; create: boolean } | { op: "remove"; path: string };

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";
export const REBASE_ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export interface RebaseStep {
  action: RebaseAction;
  hash: string;
  message?: string;
}

export interface RebasePlan {
  onto: string;
  /** oldest first */
  commits: HistCommit[];
  dirty: boolean;
  published: boolean;
  branch: string;
}

export type RebaseOp = { op: "plan"; onto: string } | { op: "run"; onto: string; steps: RebaseStep[] };

/** The blame of one line (1-based), or null when the blame does not cover it. */
export const blameAt = (b: Blame | null | undefined, line: number): BlameLine | null => b?.lines.find((l) => l.line === line) ?? null;

/** How old a line is between the oldest (0) and the newest (1) commit of the file; uncommitted = 1. */
export function heat(b: Blame, l: BlameLine): number {
  if (!l.commit) return 1;
  const ts = b.lines.filter((x) => x.commit).map((x) => x.time);
  const lo = Math.min(...ts), hi = Math.max(...ts);
  return hi === lo ? 1 : (l.time - lo) / (hi - lo);
}

/** The plan as the human starts editing it: every commit picked, in order. */
export const initialSteps = (p: RebasePlan): RebaseStep[] => p.commits.map((c) => ({ action: "pick", hash: c.hash }));

/** Moves step `i` up (-1) or down (+1). */
export function moveStep(steps: RebaseStep[], i: number, dir: -1 | 1): RebaseStep[] {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= steps.length || j >= steps.length) return steps;
  const out = [...steps];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** What is wrong with the plan before asking git (null = fine). Mirrors the backend's checks. */
export function planProblem(steps: RebaseStep[]): string | null {
  const kept = steps.filter((s) => s.action !== "drop");
  if (!kept.length) return "drop-all";
  if (kept[0].action === "squash" || kept[0].action === "fixup") return "first-squash";
  if (steps.some((s) => s.action === "reword" && !(s.message ?? "").trim())) return "reword-empty";
  return null;
}

/** The plan changes nothing (all picks in the original order). */
export const planIsNoop = (p: RebasePlan, steps: RebaseStep[]): boolean =>
  steps.length === p.commits.length && steps.every((s, i) => s.action === "pick" && s.hash === p.commits[i].hash);

/** The command the plan amounts to, with its todo (what the human approves). */
export function rebaseCommand(onto: string, steps: RebaseStep[], short: (h: string) => string = (h) => h.slice(0, 8)): string {
  const todo = steps.map((s) => `${s.action} ${short(s.hash)}${s.action === "reword" ? ` "${(s.message ?? "").trim().split("\n")[0]}"` : ""}`);
  return `git rebase -i ${onto}\n${todo.map((l) => "  " + l).join("\n")}`;
}

/** A sibling folder for a new worktree of `branch`: `../<project>-<branch slug>`. */
export function worktreePath(project: string, branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  return `../${project}-${slug}`;
}
