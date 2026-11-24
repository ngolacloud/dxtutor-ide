/* ═══════════ Co-Dev — domain: live hunks in the editor (docs/v2/RF-CODEV-STREAM.md) ═══════════
   Pure state of the hunks the agent is writing, and the editor's view of a file while
   hunks are open:

   - `reduceOverlay` folds the backend's `hunk_*`/`validation` events into the state;
   - `revealStep` advances the typing (the backend sends text as fast as the model writes
     it; the UI shows it at a readable pace, and can pause or show it all);
   - `virtualView` is what the editor shows: the file's lines, and for each open hunk its
     old lines (marked as removed) followed by the new lines written so far;
   - `mapEdit` turns an edit the human made in that view into an edit of the real file,
     and refuses edits that touch a hunk (the hunk's lines are read-only until decided).

   No DOM, no window, no Tauri. */

import type { AgentEvent, HunkOp, ValidationCheck } from "./agent-events";

export type HunkStatus = "streaming" | "proposed" | "review" | "applied" | "rejected" | "stale";

export interface HunkState {
  id: string;
  call: string;
  path: string;
  op: HunkOp;
  /** Lines `start..=end` in the file the backend computed the hunk on. */
  start: number;
  end: number;
  /** Where the hunk sits in the file as the editor has it now (1-based). */
  anchor: number;
  /** The lines the hunk replaces (with line endings). */
  old: string;
  /** New text received so far (the final text after `hunk_end`). */
  text: string;
  /** How much of `text` is shown (typing pace). */
  shown: number;
  status: HunkStatus;
  provisional: boolean;
  /** Why it was rejected, or the backend's note. */
  reason: string;
  /** The human's pending choice during a review. */
  choice: "accept" | "reject" | null;
}

export interface ReviewState {
  call: string;
  hunks: string[];
  reason: string;
}

export interface ValidationState {
  status: "running" | "passed" | "failed" | "skipped";
  checks: ValidationCheck[];
  baseline: ValidationCheck[];
}

export interface OverlayState {
  hunks: HunkState[];
  /** Calls waiting for a decision (Manual/Assist). */
  reviews: ReviewState[];
  validation: ValidationState | null;
  paused: boolean;
}

export const initialOverlay = (): OverlayState => ({ hunks: [], reviews: [], validation: null, paused: false });

/** Hunks drawn in the editor: still being written or waiting for a decision. */
export const isOpen = (h: HunkState): boolean => h.status === "streaming" || h.status === "proposed" || h.status === "review";

const map = (s: OverlayState, id: string, f: (h: HunkState) => HunkState): OverlayState => ({
  ...s,
  hunks: s.hunks.map((h) => (h.id === id ? f(h) : h)),
});

/** Lines of a text without their endings; a final newline does not open a line. */
export function linesOf(t: string): string[] {
  if (t === "") return [];
  const ls = t.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
}

const lineDelta = (h: HunkState): number => linesOf(h.text).length - linesOf(h.old).length;

export function reduceOverlay(s: OverlayState, e: AgentEvent): OverlayState {
  switch (e.kind) {
    case "hunk_start": {
      const h: HunkState = {
        id: e.hunk,
        call: e.call,
        path: e.path,
        op: e.op,
        start: e.range.start,
        end: e.range.end,
        anchor: e.range.start,
        old: e.old,
        text: "",
        shown: 0,
        status: "streaming",
        provisional: false,
        reason: "",
        choice: null,
      };
      return { ...s, hunks: [...s.hunks.filter((x) => x.id !== e.hunk), h] };
    }
    case "hunk_chunk":
      return map(s, e.hunk, (h) => ({ ...h, text: h.text + e.text }));
    case "hunk_end":
      return map(s, e.hunk, (h) => ({ ...h, text: e.text, shown: Math.min(h.shown, e.text.length), status: "proposed" }));
    case "hunk_review":
      return {
        ...s,
        hunks: s.hunks.map((h) => (e.hunks.includes(h.id) && isOpen(h) ? { ...h, status: "review" as const } : h)),
        reviews: [...s.reviews.filter((r) => r.call !== e.call), { call: e.call, hunks: e.hunks, reason: e.reason }],
      };
    case "hunk_applied": {
      const done = s.hunks.find((h) => h.id === e.hunk);
      if (!done) return s;
      // hunks after it in the same file move by the lines it added or removed
      const d = lineDelta(done);
      const hunks = s.hunks.map((h) => {
        if (h.id === e.hunk) return { ...h, status: "applied" as const, provisional: e.provisional, shown: h.text.length };
        if (isOpen(h) && h.path === done.path && h.anchor > done.anchor) return { ...h, anchor: h.anchor + d };
        return h;
      });
      return dropSettledReviews({ ...s, hunks });
    }
    case "hunk_rejected":
      return dropSettledReviews(map(s, e.hunk, (h) => ({ ...h, status: "rejected", reason: e.reason })));
    case "hunk_stale":
      return dropSettledReviews(map(s, e.hunk, (h) => ({ ...h, status: "stale", reason: "the file changed before the decision" })));
    case "validation":
      return { ...s, validation: { status: e.status, checks: e.checks, baseline: e.baseline } };
    case "done":
      return { ...s, reviews: [], paused: false };
    default:
      return s;
  }
}

/** A review whose hunks are all settled is gone. */
function dropSettledReviews(s: OverlayState): OverlayState {
  const open = new Set(s.hunks.filter(isOpen).map((h) => h.id));
  return { ...s, reviews: s.reviews.filter((r) => r.hunks.some((id) => open.has(id))) };
}

/** The hunk being typed now: the first open one with text still to show. */
export const activeHunk = (s: OverlayState): HunkState | null =>
  s.hunks.find((h) => isOpen(h) && (h.shown < h.text.length || h.status === "streaming")) ?? null;

/** Shows up to `chars` more characters of the active hunk (nothing while paused). */
export function revealStep(s: OverlayState, chars: number): OverlayState {
  if (s.paused) return s;
  const a = activeHunk(s);
  if (!a || a.shown >= a.text.length) return s;
  return map(s, a.id, (h) => ({ ...h, shown: Math.min(h.text.length, h.shown + Math.max(1, Math.floor(chars))) }));
}

/** "Faster": everything received so far is shown at once. */
export const revealAll = (s: OverlayState): OverlayState => ({
  ...s,
  hunks: s.hunks.map((h) => (isOpen(h) ? { ...h, shown: h.text.length } : h)),
});

export const setPaused = (s: OverlayState, paused: boolean): OverlayState => ({ ...s, paused });

/** The human's choice for one hunk of a review (sent when the review is complete). */
export const choose = (s: OverlayState, id: string, choice: "accept" | "reject"): OverlayState =>
  map(s, id, (h) => ({ ...h, choice }));

/** The review a hunk belongs to, once every one of its hunks has a choice. */
export function completeReview(s: OverlayState, id: string): ReviewState | null {
  const r = s.reviews.find((x) => x.hunks.includes(id));
  if (!r) return null;
  const byId = new Map(s.hunks.map((h) => [h.id, h]));
  const ready = r.hunks.every((h) => {
    const x = byId.get(h);
    return !x || !isOpen(x) || x.choice !== null;
  });
  return ready ? r : null;
}

// ───── the editor's view of a file with open hunks ─────

export type VLineKind = "ctx" | "old" | "new";

export interface VLine {
  text: string;
  kind: VLineKind;
  /** Line number in the real file (ctx and old lines). */
  real?: number;
  hunk?: string;
  /** The line Co-Dev is typing now. */
  writing?: boolean;
}

export interface VBlock {
  hunk: string;
  /** View lines `[from, to)` that belong to the hunk (old and new). */
  from: number;
  to: number;
}

export interface VView {
  text: string;
  lines: VLine[];
  blocks: VBlock[];
}

/** Where `old` sits in `lines` now: at `anchor` if it is still there, else its only
 *  occurrence; `null` if it cannot be placed (the backend will report it stale). */
function place(lines: string[], h: HunkState): number | null {
  const old = linesOf(h.old);
  const at = (i: number) => old.every((l, k) => lines[i + k] === l);
  const a = h.anchor - 1;
  if (old.length === 0) return Math.max(0, Math.min(lines.length, a));
  if (a >= 0 && a + old.length <= lines.length && at(a)) return a;
  let found: number | null = null;
  for (let i = 0; i + old.length <= lines.length; i++) {
    if (at(i)) {
      if (found !== null) return null;
      found = i;
    }
  }
  return found;
}

/** The view of `real` (the file as the editor has it) with the open hunks of `path`. */
export function virtualView(real: string, path: string, s: OverlayState): VView {
  const lines = real.split("\n");
  const active = activeHunk(s);
  const placed = s.hunks
    .filter((h) => h.path === path && isOpen(h))
    .map((h) => ({ h, at: place(lines, h) }))
    .filter((x): x is { h: HunkState; at: number } => x.at !== null)
    .sort((x, y) => x.at - y.at);
  const out: VLine[] = [];
  const blocks: VBlock[] = [];
  let i = 0;
  const emitHunk = (h: HunkState) => {
    const from = out.length;
    const old = linesOf(h.old);
    for (let k = 0; k < old.length; k++, i++) out.push({ text: lines[i], kind: "old", real: i + 1, hunk: h.id });
    const shown = h.text.slice(0, h.shown);
    const typing = h === active || (active !== null && h.id === active.id);
    const fresh = shown === "" ? [] : shown.endsWith("\n") ? linesOf(shown) : shown.split("\n");
    fresh.forEach((t, k) => out.push({ text: t, kind: "new", hunk: h.id, writing: typing && k === fresh.length - 1 }));
    if (typing && fresh.length === 0) out.push({ text: "", kind: "new", hunk: h.id, writing: true });
    blocks.push({ hunk: h.id, from, to: out.length });
  };
  let p = 0;
  while (i < lines.length || p < placed.length) {
    if (p < placed.length && placed[p].at <= i) {
      // two hunks on the same lines cannot both be drawn: the later one waits
      if (placed[p].at === i) emitHunk(placed[p].h);
      p++;
      continue;
    }
    if (i >= lines.length) break;
    out.push({ text: lines[i], kind: "ctx", real: i + 1 });
    i++;
  }
  return { text: out.map((l) => l.text).join("\n"), lines: out, blocks };
}

/** Index of the view line holding character `off` of `text`. */
function lineAt(text: string, off: number): number {
  let n = 0;
  for (let k = 0; k < off && k < text.length; k++) if (text.charCodeAt(k) === 10) n++;
  return n;
}

export interface RealEdit {
  /** The real file after the edit. */
  real: string;
  /** First real line touched, and how many lines it added (negative: removed). */
  line: number;
  delta: number;
}

/** The human edited the view: the same edit on the real file, or `null` when it touches
 *  a hunk's lines (refused: they stay as Co-Dev proposed until the human decides). */
export function mapEdit(view: VView, next: string, real: string): RealEdit | null {
  const prev = view.text;
  if (prev === next) return { real, line: 1, delta: 0 };
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let q = 0;
  while (q < prev.length - a && q < next.length - a && prev[prev.length - 1 - q] === next[next.length - 1 - q]) q++;
  const b = prev.length - q;
  const inserted = next.slice(a, next.length - q);
  // lines the change touches; removing a line ending also touches the next line
  const la = lineAt(prev, a);
  const lb = lineAt(prev, b);
  if (view.blocks.some((bl) => bl.from <= lb && la < bl.to)) return null;
  // the real file is the view without the new lines: shift the offsets past them
  let skip = 0;
  for (let k = 0; k < la; k++) if (view.lines[k].kind === "new") skip += view.lines[k].text.length + 1;
  const ra = a - skip;
  const rb = b - skip;
  if (ra < 0 || rb > real.length) return null;
  const out = real.slice(0, ra) + inserted + real.slice(rb);
  const removed = prev.slice(a, b).split("\n").length - 1;
  const added = inserted.split("\n").length - 1;
  const firstReal = view.lines[la]?.real ?? 1;
  return { real: out, line: firstReal, delta: added - removed };
}

/** After a human edit, open hunks below it move with their lines. */
export function shiftAnchors(s: OverlayState, path: string, line: number, delta: number): OverlayState {
  if (!delta) return s;
  return {
    ...s,
    hunks: s.hunks.map((h) => (isOpen(h) && h.path === path && h.anchor > line ? { ...h, anchor: Math.max(1, h.anchor + delta) } : h)),
  };
}

/** Files that have open hunks, in the order Co-Dev started them. */
export function openPaths(s: OverlayState): string[] {
  const seen: string[] = [];
  for (const h of s.hunks) if (isOpen(h) && !seen.includes(h.path)) seen.push(h.path);
  return seen;
}
