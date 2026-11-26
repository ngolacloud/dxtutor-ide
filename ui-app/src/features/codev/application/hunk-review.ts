/* ═══════════ Co-Dev — use case: live hunks in the editor (docs/v2/RF-CODEV-STREAM.md §8) ═══════════
   Receives the turn's hunk events (through the agent chat), keeps the overlay state, types
   the new text at a readable pace, follows the hunk being written (opens its file and
   scrolls to it, until the human scrolls away), and sends the human's per-hunk decisions
   to the backend once a review is complete — after saving the editor's text, so the
   backend decides on what the human sees. When a hunk is applied, the editor reloads the
   file from disk. No DOM, no window: everything through `HunkReviewDeps`.

   Multi Co-Dev (phase 2): each session keeps its own overlay (the agent's sessions, the local
   proposals, the PairCode mirror) and its decisions go to the session that proposed them. The
   editor draws the sessions that are not hidden — a Co-Dev working in the background does not
   paint over the file you are looking at until you open its chat (`setHidden`). With one session
   it is the same as before. */

import type { AgentEvent } from "../domain/agent-events";
import type { HunkReviewDeps, HunkSink } from "./ports";
import { ptCopy } from "./messages";
import { activeHunk, choose, completeReview, initialOverlay, isOpen, mapEdit, openPaths, reduceOverlay, revealAll, revealStep, setPaused, shiftAnchors, virtualView, type OverlayState, type VView, blockedReview, overrideReview } from "../domain/hunk-overlay";

/** How often the typing advances. */
const TICK_MS = 50;

export function makeHunkReview(deps: HunkReviewDeps) {
  const copy = deps.copy ?? ptCopy;
  /** Each session's overlay, in the order the sessions first wrote. */
  const states = new Map<string, OverlayState>();
  /** The session of each call (decisions and overrides go to it). */
  const owner = new Map<string, string>();
  /** Sessions whose hunks are not drawn (a Co-Dev in the background). */
  let hidden: (session: string) => boolean = () => false;
  /** What the editor shows: the overlays of the visible sessions together. */
  let state: OverlayState = initialOverlay();
  let following = true;
  let stopTimer: (() => void) | null = null;
  let reloadQueued = false;
  const settled = new Map<string, (label: string) => void>();
  const overridden = new Map<string, (adr: string) => void>();
  const listeners = new Set<() => void>();

  const visible = (): string[] => [...states.keys()].filter((s) => !hidden(s));

  /** The visible overlays as one (the only one, as it is, when there is one). */
  function compose(): OverlayState {
    const vis = visible().map((s) => states.get(s)!);
    if (!vis.length) return initialOverlay();
    if (vis.length === 1) return vis[0];
    return {
      hunks: vis.flatMap((v) => v.hunks),
      reviews: vis.flatMap((v) => v.reviews),
      validation: [...vis].reverse().find((v) => v.validation)?.validation ?? null,
      paused: vis.some((v) => v.paused),
    };
  }

  /** Redraws every file that had or has open hunks, after the overlays changed. */
  function refresh(): void {
    const before = openPaths(state);
    state = compose();
    for (const p of new Set([...before, ...openPaths(state)])) deps.editor.repaint(p);
    listeners.forEach((f) => f());
    if (activeHunk(state) && !stopTimer) stopTimer = deps.every(TICK_MS, tick);
    if (!activeHunk(state) && stopTimer) {
      stopTimer();
      stopTimer = null;
    }
  }

  /** Applies a new overlay to one session and redraws. */
  function set(session: string, next: OverlayState): void {
    states.set(session, next);
    refresh();
  }

  const overlay = (session: string): OverlayState => states.get(session) ?? initialOverlay();
  /** The session that owns a hunk (by id) or a call. */
  const sessionOfHunk = (id: string): string | null => [...states].find(([, st]) => st.hunks.some((h) => h.id === id))?.[0] ?? null;
  const sessionOfCall = (call: string): string | null => owner.get(call) ?? [...states].find(([, st]) => st.hunks.some((h) => h.call === call))?.[0] ?? null;

  function tick(): void {
    // the typing goes on in the visible sessions; a hidden one waits until it is shown
    const s = visible().find((x) => activeHunk(overlay(x)));
    if (!s) return refresh();
    const before = activeHunk(overlay(s));
    set(s, revealStep(overlay(s), (deps.pace() * TICK_MS) / 1000));
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
    // the real file moved: the open hunks of every session (hidden ones too) move with it
    if (r.delta) {
      for (const [s, st] of states) states.set(s, shiftAnchors(st, path, r.line, r.delta));
      state = compose();
    }
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
    const session = sessionOfCall(call);
    if (!session) return;
    const st = overlay(session);
    const r = st.reviews.find((x) => x.call === call);
    if (!r) return;
    const byId = new Map(st.hunks.map((h) => [h.id, h]));
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
    const shown = !hidden(s);
    const wasActive = activeHunk(state);
    if (e.kind === "hunk_start" || e.kind === "hunk_review") owner.set(e.call, s);
    set(s, reduceOverlay(overlay(s), e));
    if (shown && e.kind === "hunk_start" && !wasActive) following = true;
    if (shown && e.kind === "hunk_start") follow(e.path);
    if (e.kind === "hunk_applied") {
      // RF-E07: the text before the block, for Ctrl+Z (the editor still has it: reload comes next)
      const h = overlay(s).hunks.find((x) => x.id === e.hunk);
      const before = e.before !== undefined ? e.before : h ? realOf(h.path) : null;
      if (h && before !== null) deps.applied?.(h.path, before);
      queueReload();
    }
    if (e.kind === "hunk_applied" || (e.kind === "validation" && e.status !== "running")) deps.recorded?.();
    if (e.kind === "hunk_applied" || e.kind === "hunk_rejected" || e.kind === "hunk_stale") {
      const h = overlay(s).hunks.find((x) => x.id === e.hunk);
      if (h && !overlay(s).reviews.some((r) => r.call === h.call)) settle(h.call);
    }
    if (e.kind === "done") {
      // only this session's turn ended: the other Co-Devs' reviews stay open
      for (const call of [...settled.keys()]) if (sessionOfCall(call) === s) settle(call);
      const st = overlay(s);
      states.set(s, { ...st, hunks: st.hunks.filter((h) => !isOpen(h)) });
      state = compose();
    }
  }

  /** Tells the chat bar how the call's review ended. */
  function settle(call: string): void {
    const f = settled.get(call);
    if (!f) return;
    settled.delete(call);
    const session = sessionOfCall(call);
    const hs = (session ? overlay(session) : state).hunks.filter((h) => h.call === call);
    const ok = hs.filter((h) => h.status === "applied").length;
    const stale = hs.filter((h) => h.status === "stale").length;
    const label =
      ok === hs.length ? copy("hunksApplied", { n: ok }) : ok === 0 && !stale ? copy("hunksRejected") : copy("hunksPartial", { ok, n: hs.length, stale: stale ? copy("hunksStale", { n: stale }) : "" });
    f(label);
  }

  /** RF-A03/A04: accepting a change that breaks the rules waits for the architect's override. */
  function refuseBlocked(id: string): boolean {
    const s = sessionOfHunk(id) ?? sessionOfCall(id);
    const r = blockedReview(s ? overlay(s) : state, id);
    if (!r) return false;
    deps.notify(`Viola as regras do arquitecto (${(r.violations ?? []).map((v) => v.message).join("; ")}): aceitar pede o override do Arquitecto com um ADR aceite.`);
    return true;
  }

  async function override(call: string): Promise<boolean> {
    const session = sessionOfCall(call);
    const r = session ? overlay(session).reviews.find((x) => x.call === call) : undefined;
    if (!session || !r?.violations?.length || !deps.override || !deps.askAdr) return false;
    const adr = deps.askAdr(r.violations.map((v) => v.message).join("; "))?.trim();
    if (!adr) return false;
    try {
      await deps.override(session, call, adr);
    } catch (e: unknown) {
      deps.notify(e instanceof Error ? e.message : String(e));
      return false;
    }
    set(session, overrideReview(overlay(session), call, adr));
    overridden.get(call)?.(adr);
    deps.notify(`Override com o ${adr}: já podes aceitar.`);
    return true;
  }

  function decide(id: string, accept: boolean): void {
    const s = sessionOfHunk(id);
    if (!s) return;
    if (accept && refuseBlocked(id)) return;
    set(s, choose(overlay(s), id, accept ? "accept" : "reject"));
    const r = completeReview(overlay(s), id);
    if (r) void send(r.call);
  }

  function decideAll(call: string, accept: boolean): void {
    const s = sessionOfCall(call);
    if (!s) return;
    if (accept && refuseBlocked(call)) return;
    let st = overlay(s);
    for (const h of st.hunks) if (h.call === call && isOpen(h)) st = choose(st, h.id, accept ? "accept" : "reject");
    set(s, st);
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

  /** Applies `f` to the overlay of every visible session. */
  const eachVisible = (f: (st: OverlayState) => OverlayState): void => {
    for (const s of visible()) states.set(s, f(overlay(s)));
    refresh();
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
      const paused = !state.paused;
      eachVisible((st) => setPaused(st, paused));
    },
    faster(): void {
      eachVisible(revealAll);
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
    /** Multi Co-Dev: which sessions are not drawn (a Co-Dev working in the background). Asked
     *  again on every change; call `visibilityChanged` when the answer changes. */
    setHidden(f: (session: string) => boolean): void {
      hidden = f;
      refresh();
    },
    /** The chat on screen changed: draw the sessions now visible, and open the file of the hunk being
     *  written (or waiting for a decision). */
    visibilityChanged(): void {
      refresh();
      const a = activeHunk(state) ?? state.hunks.find(isOpen);
      if (a) {
        following = true;
        follow(a.path);
      }
    },
    /** The session closed: its hunks go away (whatever it left open was refused by the backend). */
    forget(session: string): void {
      if (!states.delete(session)) return;
      for (const [call, s] of owner) if (s === session) owner.delete(call);
      refresh();
    },
  };
}

export type HunkReview = ReturnType<typeof makeHunkReview>;
