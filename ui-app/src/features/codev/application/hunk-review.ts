/* ═══════════ Co-Dev — use case: live hunks in the editor (docs/v2/RF-CODEV-STREAM.md §8) ═══════════
   Receives the turn's hunk events (through the agent chat), keeps the overlay state, types
   the new text at a readable pace, follows the hunk being written (opens its file and
   scrolls to it, until the human scrolls away), and sends the human's per-hunk decisions
   to the backend once a review is complete — after saving the editor's text, so the
   backend decides on what the human sees. When a hunk is applied, the editor reloads the
   file from disk. No DOM, no window: everything through `HunkReviewDeps`. */

import type { AgentEvent } from "../domain/agent-events";
import type { HunkReviewDeps, HunkSink } from "./ports";
import { ptCopy } from "./messages";
import { activeHunk, choose, completeReview, initialOverlay, isOpen, mapEdit, openPaths, reduceOverlay, revealAll, revealStep, setPaused, shiftAnchors, virtualView, type OverlayState, type VView, blockedReview, overrideReview } from "../domain/hunk-overlay";

/** How often the typing advances. */
const TICK_MS = 50;

export function makeHunkReview(deps: HunkReviewDeps) {
  const copy = deps.copy ?? ptCopy;
  let state: OverlayState = initialOverlay();
  let session: string | null = null;
  let following = true;
  let stopTimer: (() => void) | null = null;
  let reloadQueued = false;
  const settled = new Map<string, (label: string) => void>();
  const overridden = new Map<string, (adr: string) => void>();
  const listeners = new Set<() => void>();

  /** Applies a new state and redraws every file that had or has open hunks. */
  function set(next: OverlayState): void {
    const before = openPaths(state);
    state = next;
    for (const p of new Set([...before, ...openPaths(state)])) deps.editor.repaint(p);
    listeners.forEach((f) => f());
    if (activeHunk(state) && !stopTimer) stopTimer = deps.every(TICK_MS, tick);
    if (!activeHunk(state) && stopTimer) {
      stopTimer();
      stopTimer = null;
    }
  }

  function tick(): void {
    const before = activeHunk(state);
    set(revealStep(state, (deps.pace() * TICK_MS) / 1000));
    if (before) follow(before.path);
  }

  /** Keeps the hunk being written on screen while the human follows Co-Dev. */
  function follow(path: string): void {
    if (!following) return;
    // a new file is not on disk (nor in the editor) until it is accepted
    if (state.hunks.some((h) => h.path === path && isOpen(h) && h.op === "create")) return;
    if (deps.editor.current() !== path) deps.editor.open(path);
    const v = viewOf(path);
    const line = v?.lines.findIndex((l) => l.writing) ?? -1;
    if (line >= 0) deps.editor.reveal(line);
  }

  let realOf: (path: string) => string | null = () => null;
  const viewOf = (path: string): VView | null => {
    const real = realOf(path);
    return real === null ? null : view(path, real);
  };

  function view(path: string, real: string): VView | null {
    if (!state.hunks.some((h) => h.path === path && isOpen(h))) return null;
    return virtualView(real, path, state);
  }

  function edit(path: string, v: VView, next: string, real: string): string | null {
    const r = mapEdit(v, next, real);
    if (!r) return null;
    if (r.delta) state = shiftAnchors(state, path, r.line, r.delta);
    return r.real;
  }

  function queueReload(): void {
    if (reloadQueued) return;
    reloadQueued = true;
    queueMicrotask(() => {
      reloadQueued = false;
      deps.reloadFromDisk().catch(() => undefined);
    });
  }

  async function send(call: string): Promise<void> {
    if (!session) return;
    const r = state.reviews.find((x) => x.call === call);
    if (!r) return;
    const byId = new Map(state.hunks.map((h) => [h.id, h]));
    const decisions = r.hunks.map((id) => {
      const h = byId.get(id);
      const accept = h?.choice === "accept";
      return accept ? { hunk: id, accept } : { hunk: id, accept, reason: "rejeitado no editor" };
    });
    try {
      await deps.flush();
      await deps.review(session, call, decisions);
    } catch (e: unknown) {
      deps.notify(e instanceof Error ? e.message : String(e));
    }
  }

  function event(s: string, e: AgentEvent): void {
    session = s;
    const wasActive = activeHunk(state);
    set(reduceOverlay(state, e));
    if (e.kind === "hunk_start" && !wasActive) following = true;
    if (e.kind === "hunk_start") follow(e.path);
    if (e.kind === "hunk_applied") {
      // RF-E07: the text before the block, for Ctrl+Z (the editor still has it: reload comes next)
      const h = state.hunks.find((x) => x.id === e.hunk);
      const before = h ? realOf(h.path) : null;
      if (h && before !== null) deps.applied?.(h.path, before);
      queueReload();
    }
    if (e.kind === "hunk_applied" || (e.kind === "validation" && e.status !== "running")) deps.recorded?.();
    if (e.kind === "hunk_applied" || e.kind === "hunk_rejected" || e.kind === "hunk_stale") {
      const h = state.hunks.find((x) => x.id === e.hunk);
      if (h && !state.reviews.some((r) => r.call === h.call)) settle(h.call);
    }
    if (e.kind === "done") {
      for (const call of [...settled.keys()]) settle(call);
      state = { ...state, hunks: state.hunks.filter((h) => !isOpen(h)) };
    }
  }

  /** Tells the chat bar how the call's review ended. */
  function settle(call: string): void {
    const f = settled.get(call);
    if (!f) return;
    settled.delete(call);
    const hs = state.hunks.filter((h) => h.call === call);
    const ok = hs.filter((h) => h.status === "applied").length;
    const stale = hs.filter((h) => h.status === "stale").length;
    const label =
      ok === hs.length ? copy("hunksApplied", { n: ok }) : ok === 0 && !stale ? copy("hunksRejected") : copy("hunksPartial", { ok, n: hs.length, stale: stale ? copy("hunksStale", { n: stale }) : "" });
    f(label);
  }

  /** RF-A03/A04: accepting a change that breaks the rules waits for the architect's override. */
  function refuseBlocked(id: string): boolean {
    const r = blockedReview(state, id);
    if (!r) return false;
    deps.notify(`Viola as regras do arquitecto (${(r.violations ?? []).map((v) => v.message).join("; ")}): aceitar pede o override do Arquitecto com um ADR aceite.`);
    return true;
  }

  async function override(call: string): Promise<boolean> {
    const r = state.reviews.find((x) => x.call === call);
    if (!session || !r?.violations?.length || !deps.override || !deps.askAdr) return false;
    const adr = deps.askAdr(r.violations.map((v) => v.message).join("; "))?.trim();
    if (!adr) return false;
    try {
      await deps.override(session, call, adr);
    } catch (e: unknown) {
      deps.notify(e instanceof Error ? e.message : String(e));
      return false;
    }
    set(overrideReview(state, call, adr));
    overridden.get(call)?.(adr);
    deps.notify(`Override com o ${adr}: já podes aceitar.`);
    return true;
  }

  function decide(id: string, accept: boolean): void {
    if (accept && refuseBlocked(id)) return;
    set(choose(state, id, accept ? "accept" : "reject"));
    const r = completeReview(state, id);
    if (r) void send(r.call);
  }

  function decideAll(call: string, accept: boolean): void {
    if (accept && refuseBlocked(call)) return;
    let s = state;
    for (const h of s.hunks) if (h.call === call && isOpen(h)) s = choose(s, h.id, accept ? "accept" : "reject");
    set(s);
    void send(call);
  }

  const sink: HunkSink = {
    event,
    decideAll,
    open: (path) => {
      following = true;
      const created = state.hunks.find((h) => h.path === path && isOpen(h) && h.op === "create");
      if (created) deps.editor.preview(path, created.text);
      else deps.editor.open(path);
    },
    onSettled: (call, f) => settled.set(call, f),
    override,
    onOverridden: (call, f) => overridden.set(call, f),
  };

  return {
    sink,
    state: (): OverlayState => state,
    /** The editor's real text of a file (set by the composition root). */
    readFrom(f: (path: string) => string | null): void {
      realOf = f;
    },
    view,
    edit,
    decide,
    decideAll,
    override,
    togglePause(): void {
      set(setPaused(state, !state.paused));
    },
    faster(): void {
      set(revealAll(state));
    },
    stop(): void {
      deps.cancel();
    },
    /** The human scrolled away from the hunk being written. */
    stopFollowing(): void {
      if (following && activeHunk(state)) {
        following = false;
        listeners.forEach((f) => f());
      }
    },
    /** «Back to Co-Dev». */
    backToCodev(): void {
      following = true;
      const a = activeHunk(state) ?? state.hunks.find(isOpen);
      if (a) follow(a.path);
      listeners.forEach((f) => f());
    },
    following: (): boolean => following,
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

export type HunkReview = ReturnType<typeof makeHunkReview>;
