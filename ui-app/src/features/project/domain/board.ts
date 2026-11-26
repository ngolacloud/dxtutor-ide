/* ═════════ feature `project` — methods and board selectors (PROJ-02/03) ═════════
   The four methods share the five canonical states; each names them, limits them and
   brings its own practices and views. The selectors turn a project into what the board
   draws: columns, swimlanes, quick filters, WIP status, the sprint summary. Pure. */

import { STATES, type Cos, type Issue, type Method, type Project, type Sprint, type State } from "./types";

export interface MethodInfo {
  name: string;
  /** What a time box is called (`Sprint`, `Iteration`), or `null` for continuous flow. */
  box: string | null;
  labels: Record<State, string>;
  desc: string;
}

export const METHOD_INFO: Record<Method, MethodInfo> = {
  kanban: {
    name: "Kanban",
    box: null,
    labels: { todo: "Ready", progress: "In Progress", review: "Review", accept: "Testing", done: "Done" },
    desc: "Continuous flow. WIP limits per column, classes of service, lead and cycle time, cumulative flow.",
  },
  scrum: {
    name: "Scrum",
    box: "Sprint",
    labels: { todo: "To Do", progress: "In Progress", review: "In Review", accept: "Testing", done: "Done" },
    desc: "Time-boxed sprints with a goal. Planning, daily, review and retrospective; burndown and velocity.",
  },
  xp: {
    name: "XP",
    box: "Iteration",
    labels: { todo: "Planned", progress: "Pairing (TDD)", review: "Review", accept: "Acceptance tests", done: "Done" },
    desc: "Short iterations and the planning game. Pair programming, TDD, acceptance tests, small releases.",
  },
  scrumxp: {
    name: "Scrum + XP",
    box: "Sprint",
    labels: { todo: "To Do", progress: "Pairing (TDD)", review: "In Review", accept: "Acceptance", done: "Done" },
    desc: "Scrum for the process (sprints, roles, events), XP for engineering (pairing, TDD, CI, acceptance tests).",
  },
};

export type View = "board" | "backlog" | "planning" | "releases" | "reports" | "retro" | "settings";

/** The views a method uses, in nav order. */
export function viewsFor(m: Method): View[] {
  const v: View[] = ["board", "backlog"];
  if (m !== "kanban") v.push("planning");
  v.push("releases", "reports");
  if (m !== "kanban") v.push("retro");
  v.push("settings");
  return v;
}

export const VIEW_LABEL: Record<View, string> = {
  board: "Board",
  backlog: "Backlog",
  planning: "Planning",
  releases: "Releases",
  reports: "Reports",
  retro: "Retro",
  settings: "Settings",
};

export const stepOf = (s: State): number => STATES.indexOf(s);
export const nextState = (s: State): State | null => STATES[stepOf(s) + 1] ?? null;
export const prevState = (s: State): State | null => (stepOf(s) > 0 ? STATES[stepOf(s) - 1] : null);

export const activeSprint = (p: Project): Sprint | null => p.sprints.find((s) => s.state === "active") ?? null;

export type QuickFilter = "mine" | "bugs" | "blocked";
export interface Filters {
  q: string;
  quick: QuickFilter[];
  /** Who "mine" means. */
  me: string;
}

/** Issues the board shows: the active sprint's (Scrum/XP with a sprint running) or all the
 *  unfinished-or-recent ones (Kanban), narrowed by the search and quick filters. */
export function boardIssues(p: Project, f: Filters): Issue[] {
  const sprint = p.method === "kanban" ? null : activeSprint(p);
  const q = f.q.trim().toLowerCase();
  return p.issues.filter((i) => {
    if (sprint && i.sprint !== sprint.id) return false;
    if (q && !`${i.key} ${i.title} ${i.epic} ${i.assignee}`.toLowerCase().includes(q)) return false;
    if (f.quick.includes("mine") && i.assignee !== f.me && i.pair !== f.me) return false;
    if (f.quick.includes("bugs") && i.kind !== "bug") return false;
    if (f.quick.includes("blocked") && !i.blocked) return false;
    return true;
  });
}

export type Swim = "epic" | "assignee" | "none";

export interface Lane {
  name: string;
  columns: Record<State, Issue[]>;
  count: number;
}

const emptyColumns = (): Record<State, Issue[]> => ({ todo: [], progress: [], review: [], accept: [], done: [] });

/** Kanban orders cards by class of service (Board B, the same order as `methods::cos_rank`): expedite
 *  first, then fixed date, standard, intangible. */
export const COS_ORDER: Record<Cos, number> = { expedite: 0, fixed: 1, standard: 2, intangible: 3 };

/** The order a board lists cards in: by rank; in Kanban by class of service first. */
export function cardOrder(method: Method): (a: Issue, b: Issue) => number {
  return method === "kanban" ? (a, b) => COS_ORDER[a.cos] - COS_ORDER[b.cos] || a.rank - b.rank : (a, b) => a.rank - b.rank;
}

/** Groups the issues into swimlanes (by epic or assignee), each with the five columns. Kanban (`method`)
 *  lists each column by class of service, then rank. */
export function lanes(issues: Issue[], by: Swim, method: Method = "scrum"): Lane[] {
  const groups = new Map<string, Issue[]>();
  for (const i of [...issues].sort(cardOrder(method))) {
    const k = by === "epic" ? i.epic : by === "assignee" ? i.assignee : "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const out: Lane[] = [];
  for (const [name, list] of groups) {
    const columns = emptyColumns();
    for (const i of list) columns[i.state].push(i);
    out.push({ name, columns, count: list.length });
  }
  // the unnamed lane ("no epic", "unassigned") goes last
  return out.sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : a.name.localeCompare(b.name)));
}

export interface Wip {
  count: number;
  limit: number | null;
  over: boolean;
}

/** WIP of a column across the whole board (limits apply to the team, not to a lane). */
export function wipOf(p: Project, issues: Issue[], s: State): Wip {
  const count = issues.filter((i) => i.state === s).length;
  const limit = p.wip[s] ?? null;
  return { count, limit, over: limit !== null && count > limit };
}

const DAY = 86_400_000;

/** Whole days an issue has been in its current state. */
export const daysIn = (i: Issue, now: number): number => Math.max(0, Math.floor((now - i.since) / DAY));

export interface SprintSummary {
  title: string;
  goal: string;
  daysLeft: number | null;
  points: number;
  donePoints: number;
}

/** The header of the board: the running sprint, or the flow for Kanban / no sprint yet. */
export function summary(p: Project, now: number): SprintSummary {
  const box = METHOD_INFO[p.method].box;
  const s = p.method === "kanban" ? null : activeSprint(p);
  const items = s ? p.issues.filter((i) => i.sprint === s.id) : p.issues.filter((i) => i.state !== "done");
  const points = items.reduce((n, i) => n + (i.points ?? 0), 0);
  const donePoints = items.filter((i) => i.state === "done").reduce((n, i) => n + (i.points ?? 0), 0);
  if (!s) return { title: box ? `No active ${box.toLowerCase()}` : "Continuous flow", goal: "", daysLeft: null, points, donePoints };
  return { title: s.name, goal: s.goal, daysLeft: Math.max(0, Math.ceil((s.end - now) / DAY)), points, donePoints };
}

/** Board B: the points planned in a sprint against its capacity (`left` < 0: over it). */
export function sprintLoad(p: Project, sprint: Sprint): { points: number; capacity: number | null; left: number | null } {
  const points = p.issues.filter((i) => i.sprint === sprint.id).reduce((n, i) => n + (i.points ?? 0), 0);
  return { points, capacity: sprint.capacity, left: sprint.capacity === null ? null : sprint.capacity - points };
}

/** The items of the project's own DoR not ticked on the issue (Board B). */
export const dorOpen = (i: Issue, p: Project): string[] => p.dor.filter((_, k) => !i.dorDone[k]);

/** Definition of Done progress of an issue: criteria met and DoD items checked. */
export function doneProgress(i: Issue, p: Project): { done: number; total: number } {
  const crit = i.acceptance.filter((c) => c.done).length;
  const dod = p.dod.filter((_, k) => i.dodDone[k]).length;
  return { done: crit + dod, total: i.acceptance.length + p.dod.length };
}

/** A git branch name for an issue (`feature/dx-12-short-title`, `fix/…` for bugs). */
export function branchName(i: Issue): string {
  const slug = i.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return `${i.kind === "bug" ? "fix" : "feature"}/${i.key.toLowerCase()}${slug ? "-" + slug : ""}`;
}

/** Backlog order: by rank, unplanned first then by sprint. */
export function backlog(p: Project): { unplanned: Issue[]; bySprint: Array<{ sprint: Sprint; issues: Issue[] }> } {
  const open = [...p.issues].sort((a, b) => a.rank - b.rank);
  return {
    unplanned: open.filter((i) => !i.sprint && i.state !== "done"),
    bySprint: p.sprints
      .filter((s) => s.state !== "closed")
      .map((s) => ({ sprint: s, issues: open.filter((i) => i.sprint === s.id) })),
  };
}

/** The issue key a text cites (`DX-12` in a branch or commit), given the project's prefix. */
export function keyIn(text: string, prefix: string): string | null {
  const m = new RegExp(`(?:^|[^A-Za-z0-9])(${prefix}-\\d+)`, "i").exec(text);
  return m ? m[1].toUpperCase() : null;
}
