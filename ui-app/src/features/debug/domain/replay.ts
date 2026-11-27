/* ═══════════ feature `debug` — domain: record and replay (r23 F2b, UI-DBG-04/13) ═══════════
   The shapes of `tutor_eval::rr`/`dapc` (a recording, where a replay is — rr's ticks and events —
   and the writes a query found) and the pure rules around them: the timeline's marks (the stops
   the human visited, the writes found, the panic), where each sits on the bar, the step position
   («event n/N»), and the expression of a variable from its path in the tree. PURE. */

export interface Recording { trace: string; program: string; exitCode: number | null; output: string }

/** Where a replay is: rr's event (global) and the ticks of the thread that runs it — ticks are per
 *  thread, so moments compare by event first (`before`). */
export interface Position { event: number; ticks: number; startEvent: number; startTicks: number; endEvent: number; endTicks: number }

export interface WriteHit { event: number; ticks: number; location: string; func: string; file: string; line: number; values: string }

export type MarkKind = "stop" | "write" | "panic";

/** A point of the recording the timeline shows (and travels to): `file:line` is where the program
 *  stopped (frame 0 — a breakpoint there brings it back); a write travels by its `watch`
 *  location instead (a watchpoint stops mid-line, where no line breakpoint does). */
export interface Mark { event: number; ticks: number; kind: MarkKind; file: string; line: number; label: string; watch?: string }

/** Is moment `a` before moment `b`? (event, then ticks) */
export const before = (a: { event: number; ticks: number }, b: { event: number; ticks: number }): boolean =>
  a.event < b.event || (a.event === b.event && a.ticks < b.ticks);
const same = (a: { event: number; ticks: number }, b: { event: number; ticks: number }): boolean => a.event === b.event && a.ticks === b.ticks;

export interface ReplayState {
  trace: string;
  position: Position | null;
  marks: Mark[];
  /** the last «every change to…» query and what it found */
  query?: { expression: string; hits: WriteHit[] } | null;
}

/** Where the moment at `event` sits on the bar (0–100), inside the recording's span (events are
 *  global; ticks are not). */
export function pct(p: Position, event: number): number {
  const span = p.endEvent - p.startEvent;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((event - p.startEvent) / span) * 100));
}

/** «event n/N», the step position the toolbar shows. */
export const stepOf = (p: Position): { n: number; total: number } => ({ n: p.event, total: p.endEvent });

/** Adds a mark (one per point: a later kind of the same point wins — a panic over a stop), sorted by time. */
export function addMark(marks: Mark[], m: Mark): Mark[] {
  const rank: Record<MarkKind, number> = { stop: 0, write: 1, panic: 2 };
  const there = marks.find((x) => same(x, m));
  if (there && rank[there.kind] >= rank[m.kind]) return marks;
  return [...marks.filter((x) => !same(x, m)), m].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
}

/** The marks of a query's hits. */
export const writeMarks = (expression: string, hits: WriteHit[]): Mark[] =>
  hits.map((h) => ({ event: h.event, ticks: h.ticks, kind: "write" as const, file: h.file, line: h.line, label: h.values || expression, watch: h.location }));

/** A variable's expression from its path in the tree: the path below its scope (`main.Locals.c.map`
 *  under scope `main.Locals` → `c.map`). Null when the variable is not under that scope. */
export function expressionOf(path: string, scopePath: string): string | null {
  return path.startsWith(scopePath + ".") ? path.slice(scopePath.length + 1) : null;
}
