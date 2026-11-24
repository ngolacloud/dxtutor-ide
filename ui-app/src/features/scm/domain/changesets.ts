/* ═════════ feature `scm` — domain: the Co-Dev change sets of the working tree (RF-E08) ═════════
   docs/v2/RF-DELONIX-PLANO.md F2.7: the hunks a human (or the checks, in Auto) accepted are
   recorded in the project store with the issue the turn worked on (`project_change_sets`). The
   Source Control pane groups those that are still in the working tree by issue, so a whole set
   can be staged — and committed with its issue key — or discarded. PURE. */

/** One accepted hunk, as the backend sends it. */
export interface ChangeSetRow {
  path: string;
  start: number;
  end: number;
  added: number;
  removed: number;
  decidedBy: string;
  decidedAt: number;
}

/** The change sets of one issue (`issueKey: null`: turns from the chat or the editor). */
export interface ChangeSetGroup {
  issueKey: string | null;
  title: string;
  rows: ChangeSetRow[];
}

/** One file of a set in the working tree: its line ranges, merged, and the lines it changed. */
export interface ScmChangeSetFile {
  path: string;
  ranges: Array<[number, number]>;
  added: number;
  removed: number;
  /** another set changed this file too: staging or discarding it takes both */
  shared: boolean;
}

export interface ScmChangeSet {
  issueKey: string | null;
  title: string;
  files: ScmChangeSetFile[];
  added: number;
  removed: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Narrows the backend's payload (anything malformed is left out). */
export function parseChangeSetGroups(v: unknown): ChangeSetGroup[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((g) => ({
    issueKey: typeof g.issueKey === "string" && g.issueKey ? g.issueKey : null,
    title: str(g.title),
    rows: (Array.isArray(g.rows) ? g.rows : [])
      .filter(isObj)
      .filter((r) => str(r.path) !== "")
      .map((r) => ({ path: str(r.path), start: num(r.start), end: num(r.end), added: num(r.added), removed: num(r.removed), decidedBy: str(r.decidedBy), decidedAt: num(r.decidedAt) })),
  }));
}

/** Sorted, with overlapping or touching ranges merged. */
function mergeRanges(rs: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of [...rs].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The sets whose files are still changed in the working tree (`changed`: paths relative to the
 *  repository), in the backend's order (the most recent first); a set left with no file is
 *  dropped. The files of a set are in path order. */
export function changeSetsOfWorkingTree(groups: ChangeSetGroup[], changed: string[]): ScmChangeSet[] {
  const live = new Set(changed);
  const sets = groups
    .map((g) => {
      const byPath = new Map<string, ScmChangeSetFile>();
      for (const r of g.rows) {
        if (!live.has(r.path)) continue;
        const f = byPath.get(r.path) ?? { path: r.path, ranges: [], added: 0, removed: 0, shared: false };
        f.ranges.push([r.start, Math.max(r.start, r.end)]);
        f.added += r.added;
        f.removed += r.removed;
        byPath.set(r.path, f);
      }
      const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ ...f, ranges: mergeRanges(f.ranges) }));
      return { issueKey: g.issueKey, title: g.title, files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
    })
    .filter((s) => s.files.length > 0);
  const owners = new Map<string, number>();
  for (const s of sets) for (const f of s.files) owners.set(f.path, (owners.get(f.path) ?? 0) + 1);
  for (const s of sets) for (const f of s.files) f.shared = (owners.get(f.path) ?? 0) > 1;
  return sets;
}

/** `src/a.rs 3–9, 40` — the ranges of a file, short. */
export function rangesText(f: ScmChangeSetFile): string {
  return f.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** The commit message a staged set suggests: its title with the issue key (so the commit gets the
 *  `Issue:` trailer, F4.8). Without an issue there is nothing to suggest. */
export function commitMessageFor(s: ScmChangeSet): string {
  if (!s.issueKey) return "";
  return s.title.trim() ? `${s.title.trim()} (${s.issueKey})` : s.issueKey;
}
