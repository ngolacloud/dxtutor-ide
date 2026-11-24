/* ═════════ feature `project` — domain types (docs/v2/UI-AUDIT.md, item 5) ═════════
   The shapes of the project store (`tutor_board::project`, serde camelCase) as the UI
   reads them, and the parsers that narrow the IPC payloads (`unknown`) into them.
   Pure: no DOM, no window, no Tauri. */

export type State = "todo" | "progress" | "review" | "accept" | "done";
export const STATES: readonly State[] = ["todo", "progress", "review", "accept", "done"];
export type Method = "kanban" | "scrum" | "xp" | "scrumxp";
export const METHODS: readonly Method[] = ["kanban", "scrum", "xp", "scrumxp"];
export type Kind = "story" | "bug" | "task" | "spike";
export const KINDS: readonly Kind[] = ["story", "bug", "task", "spike"];
export type Priority = "high" | "medium" | "low";
export const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];
export type Cos = "expedite" | "fixed" | "standard" | "intangible";
export const COS: readonly Cos[] = ["expedite", "fixed", "standard", "intangible"];

export interface Criterion {
  text: string;
  done: boolean;
}

export interface Link {
  kind: string;
  ref: string;
  title: string;
  at: number;
}

export interface Issue {
  key: string;
  title: string;
  kind: Kind;
  priority: Priority;
  points: number | null;
  assignee: string;
  pair: string;
  epic: string;
  cos: Cos;
  blocked: string | null;
  rank: number;
  state: State;
  sprint: string | null;
  ready: boolean;
  description: string;
  branch: string | null;
  acceptance: Criterion[];
  dodDone: boolean[];
  links: Link[];
  changeSets: number;
  created: number;
  updated: number;
  /** When it entered its current state. */
  since: number;
  /** The user story (RF-B01): «As … I want … so that …». */
  storyAs: string;
  storyWant: string;
  storySo: string;
  /** Files/folders Co-Dev may change (RF-G03). */
  scope: string[];
  /** Issues that must be Done first. */
  deps: string[];
  /** Who approved the Definition of Ready. */
  readyBy: string | null;
  /** Failed test runs after Co-Dev (RF-B07). */
  attempts: number;
  /** The criteria table Co-Dev answered (RF-B06). */
  criteriaReport: CriteriaReport | null;
  /** The prompt template version of the last run (RF-B04). */
  templateVersion: string | null;
  /** What it still lacks to be Ready (RF-B02, from the store); empty = Co-Dev may work on it. */
  missing: string[];
}

export interface CriteriaRow {
  index: number;
  criterion: string;
  met: boolean;
  evidence: string;
}

export interface CriteriaReport {
  criteria: CriteriaRow[];
  summary: string;
}

function parseReport(v: unknown): CriteriaReport | null {
  if (!isObj(v) || !Array.isArray(v.criteria)) return null;
  return {
    criteria: v.criteria.filter(isObj).map((r) => ({ index: num(r.index), criterion: str(r.criterion), met: r.met === true, evidence: str(r.evidence) })),
    summary: str(v.summary),
  };
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  start: number;
  end: number;
  state: "planned" | "active" | "closed";
  capacity: number | null;
}

export interface Release {
  version: string;
  date: number;
  goal: string;
  epic: string;
}

export interface RetroNote {
  id: number;
  sprint: string | null;
  kind: "good" | "improve" | "action";
  text: string;
  at: number;
}

export interface InboxItem {
  id: number;
  title: string;
  kind: Kind;
  points: number | null;
  source: string;
  detail: string;
  created: number;
}

export interface Project {
  root: string;
  keyPrefix: string;
  method: Method;
  iterDays: number;
  wip: Partial<Record<State, number>>;
  dor: string[];
  dod: string[];
  issues: Issue[];
  sprints: Sprint[];
  releases: Release[];
  retro: RetroNote[];
  inbox: InboxItem[];
}

export interface Activity {
  at: number;
  actor: string;
  kind: string;
  from: State | null;
  to: State | null;
  note: string;
}

export interface ChangeSetRow {
  session: string;
  call: string;
  hunk: string;
  path: string;
  start: number;
  end: number;
  added: number;
  removed: number;
  decidedBy: string;
  decidedAt: number;
}

export interface IssueDetail {
  activity: Activity[];
  changeSets: ChangeSetRow[];
}

export interface Reports {
  cycle: Array<{ key: string; days: number; doneAt: number }>;
  cycleMedian: number | null;
  cycleP85: number | null;
  throughput: Array<{ start: number; done: number }>;
  cfd: Array<{ day: number; counts: number[] }>;
  burndown: { sprint: string; start: number; end: number; total: number; days: Array<{ day: number; remaining: number }> } | null;
  velocity: Array<{ sprint: string; name: string; points: number }>;
}

/** A refused change: which rule (`code`), and whether a reason may override it. */
export interface ProjectError {
  code: string;
  message: string;
  overridable: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, set: readonly T[], d: T): T => (set.includes(v as T) ? (v as T) : d);

function parseIssue(o: Record<string, unknown>): Issue {
  return {
    key: str(o.key),
    title: str(o.title),
    kind: oneOf(o.kind, KINDS, "story"),
    priority: oneOf(o.priority, PRIORITIES, "medium"),
    points: numOrNull(o.points),
    assignee: str(o.assignee),
    pair: str(o.pair),
    epic: str(o.epic),
    cos: oneOf(o.cos, COS, "standard"),
    blocked: strOrNull(o.blocked),
    rank: num(o.rank),
    state: oneOf(o.state, STATES, "todo"),
    sprint: strOrNull(o.sprint),
    ready: o.ready === true,
    description: str(o.description),
    branch: strOrNull(o.branch),
    acceptance: arr(o.acceptance).filter(isObj).map((c) => ({ text: str(c.text), done: c.done === true })),
    dodDone: arr(o.dodDone).map((b) => b === true),
    links: arr(o.links).filter(isObj).map((l) => ({ kind: str(l.kind), ref: str(l.ref), title: str(l.title), at: num(l.at) })),
    changeSets: num(o.changeSets),
    created: num(o.created),
    updated: num(o.updated),
    since: num(o.since, num(o.created)),
    storyAs: str(o.storyAs),
    storyWant: str(o.storyWant),
    storySo: str(o.storySo),
    scope: arr(o.scope).filter((x): x is string => typeof x === "string"),
    deps: arr(o.deps).filter((x): x is string => typeof x === "string"),
    readyBy: strOrNull(o.readyBy),
    attempts: num(o.attempts),
    criteriaReport: parseReport(o.criteriaReport),
    templateVersion: strOrNull(o.templateVersion),
    missing: arr(o.missing).filter((x): x is string => typeof x === "string"),
  };
}

export function parseProject(v: unknown): Project | null {
  if (!isObj(v) || typeof v.root !== "string" || !Array.isArray(v.issues)) return null;
  const wip: Partial<Record<State, number>> = {};
  if (isObj(v.wip)) for (const s of STATES) if (typeof v.wip[s] === "number") wip[s] = v.wip[s] as number;
  return {
    root: v.root,
    keyPrefix: str(v.keyPrefix, "DX"),
    method: oneOf(v.method, METHODS, "kanban"),
    iterDays: num(v.iterDays, 14),
    wip,
    dor: arr(v.dor).map((x) => str(x)).filter(Boolean),
    dod: arr(v.dod).map((x) => str(x)).filter(Boolean),
    issues: arr(v.issues).filter(isObj).map(parseIssue).filter((i) => i.key),
    sprints: arr(v.sprints)
      .filter(isObj)
      .map((s) => ({
        id: str(s.id),
        name: str(s.name),
        goal: str(s.goal),
        start: num(s.start),
        end: num(s.end),
        state: oneOf(s.state, ["planned", "active", "closed"] as const, "planned"),
        capacity: numOrNull(s.capacity),
      })),
    releases: arr(v.releases).filter(isObj).map((r) => ({ version: str(r.version), date: num(r.date), goal: str(r.goal), epic: str(r.epic) })),
    retro: arr(v.retro)
      .filter(isObj)
      .map((r) => ({ id: num(r.id), sprint: strOrNull(r.sprint), kind: oneOf(r.kind, ["good", "improve", "action"] as const, "good"), text: str(r.text), at: num(r.at) })),
    inbox: arr(v.inbox)
      .filter(isObj)
      .map((i) => ({ id: num(i.id), title: str(i.title), kind: oneOf(i.kind, KINDS, "story"), points: numOrNull(i.points), source: str(i.source), detail: str(i.detail), created: num(i.created) })),
  };
}

export function parseDetail(v: unknown): IssueDetail {
  const o = isObj(v) ? v : {};
  return {
    activity: arr(o.activity)
      .filter(isObj)
      .map((a) => ({
        at: num(a.at),
        actor: str(a.actor),
        kind: str(a.kind),
        from: STATES.includes(a.from as State) ? (a.from as State) : null,
        to: STATES.includes(a.to as State) ? (a.to as State) : null,
        note: str(a.note),
      })),
    changeSets: arr(o.changeSets)
      .filter(isObj)
      .map((c) => ({
        session: str(c.session),
        call: str(c.call),
        hunk: str(c.hunk),
        path: str(c.path),
        start: num(c.start),
        end: num(c.end),
        added: num(c.added),
        removed: num(c.removed),
        decidedBy: str(c.decidedBy),
        decidedAt: num(c.decidedAt),
      })),
  };
}

export function parseReports(v: unknown): Reports {
  const o = isObj(v) ? v : {};
  const bd = isObj(o.burndown) ? o.burndown : null;
  return {
    cycle: arr(o.cycle).filter(isObj).map((c) => ({ key: str(c.key), days: num(c.days), doneAt: num(c.doneAt) })),
    cycleMedian: numOrNull(o.cycleMedian),
    cycleP85: numOrNull(o.cycleP85),
    throughput: arr(o.throughput).filter(isObj).map((w) => ({ start: num(w.start), done: num(w.done) })),
    cfd: arr(o.cfd).filter(isObj).map((d) => ({ day: num(d.day), counts: arr(d.counts).map((n) => num(n)) })),
    burndown: bd
      ? { sprint: str(bd.sprint), start: num(bd.start), end: num(bd.end), total: num(bd.total), days: arr(bd.days).filter(isObj).map((d) => ({ day: num(d.day), remaining: num(d.remaining) })) }
      : null,
    velocity: arr(o.velocity).filter(isObj).map((x) => ({ sprint: str(x.sprint), name: str(x.name), points: num(x.points) })),
  };
}

/** A rejected IPC call as a ProjectError (rule errors carry their code; anything else is `db`). */
export function parseError(e: unknown): ProjectError {
  if (isObj(e) && typeof e.message === "string") {
    return { code: str(e.code, "db"), message: e.message, overridable: e.overridable === true };
  }
  return { code: "db", message: e instanceof Error ? e.message : String(e), overridable: false };
}
