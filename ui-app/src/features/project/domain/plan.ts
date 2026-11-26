/* ═════════ feature `project` — the parallel sprint plan (Multi Co-Dev, phase 1) ═════════
   The answer of `project_sprint_plan`, narrowed: one lane per Co-Dev with its issues in order,
   the waves (an issue starts when the previous waves are done), what was left out and why, and
   the issues that may change the same files. The rules live in the Rust planner
   (`tutor_board::project::plan`); here only the shape and what the view needs. PURE. */

export const MAX_CODEVS = 8;

export interface PlannedIssue {
  key: string;
  title: string;
  points: number | null;
  priority: string;
  /** 1-based. */
  wave: number;
  /** Its dependencies planned in earlier waves. */
  after: string[];
  /** Issues it overlaps with that took the earlier wave it could have run in. */
  serialisedAfter: string[];
  /** Files where its branch would conflict with HEAD. */
  branchConflicts: string[];
}

export interface Lane {
  codev: number;
  points: number;
  unestimated: number;
  issues: PlannedIssue[];
}

export type LeftOutReason = "not_ready" | "in_flow" | "blocked_by_deps" | "dep_cycle" | "overlaps_in_flow";

export interface LeftOut {
  key: string;
  title: string;
  reason: LeftOutReason;
  missing: string[];
  keys: string[];
}

export interface Overlap {
  a: string;
  b: string;
  paths: string[];
  total: number;
  /** `[scope entry of a, scope entry of b]` (`known` for a file known to be touched). */
  globs: [string, string][];
}

export interface SprintPlan {
  sprint: string | null;
  codevs: number;
  lanes: Lane[];
  waves: number;
  leftOut: LeftOut[];
  overlaps: Overlap[];
  files: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const REASONS: readonly LeftOutReason[] = ["not_ready", "in_flow", "blocked_by_deps", "dep_cycle", "overlaps_in_flow"];

/** Narrows the backend's answer; `null` when it is not a plan. */
export function parseSprintPlan(v: unknown): SprintPlan | null {
  if (!isObj(v) || !Array.isArray(v.lanes)) return null;
  return {
    sprint: typeof v.sprint === "string" ? v.sprint : null,
    codevs: num(v.codevs, 1),
    lanes: v.lanes.filter(isObj).map((l) => ({
      codev: num(l.codev),
      points: num(l.points),
      unestimated: num(l.unestimated),
      issues: (Array.isArray(l.issues) ? l.issues : []).filter(isObj).map((i) => ({
        key: str(i.key),
        title: str(i.title),
        points: numOrNull(i.points),
        priority: str(i.priority),
        wave: num(i.wave, 1),
        after: strs(i.after),
        serialisedAfter: strs(i.serialisedAfter),
        branchConflicts: strs(i.branchConflicts),
      })),
    })),
    waves: num(v.waves),
    leftOut: (Array.isArray(v.leftOut) ? v.leftOut : [])
      .filter(isObj)
      .filter((l) => REASONS.includes(l.reason as LeftOutReason))
      .map((l) => ({ key: str(l.key), title: str(l.title), reason: l.reason as LeftOutReason, missing: strs(l.missing), keys: strs(l.keys) })),
    overlaps: (Array.isArray(v.overlaps) ? v.overlaps : []).filter(isObj).map((o) => ({
      a: str(o.a),
      b: str(o.b),
      paths: strs(o.paths),
      total: num(o.total),
      globs: (Array.isArray(o.globs) ? o.globs : [])
        .filter((g): g is unknown[] => Array.isArray(g) && g.length === 2)
        .map((g) => [str(g[0]), str(g[1])] as [string, string]),
    })),
    files: num(v.files),
  };
}

/** A lane's issues by wave: `cells[w-1]` is the issue the lane runs in wave `w` (or `null`). */
export function laneCells(lane: Lane, waves: number): (PlannedIssue | null)[] {
  const cells: (PlannedIssue | null)[] = Array.from({ length: Math.max(0, waves) }, () => null);
  for (const i of lane.issues) if (i.wave >= 1 && i.wave <= cells.length) cells[i.wave - 1] = i;
  return cells;
}

/** The Co-Dev count typed by the human: a whole number in 1…8, or `null` (unset) when empty. */
export function parseCodevs(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= MAX_CODEVS ? n : undefined;
}
