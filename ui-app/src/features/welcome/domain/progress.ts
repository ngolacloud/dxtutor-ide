/* ═════════ feature `welcome` — domain: progress and the startup choice (r23 F6) ═════════
   What the viewer has done in the walkthroughs and whether the Welcome opens at startup. Kept per viewer in
   local storage (a convenience, never a source of truth). PURE: parsing is defensive, nothing throws. */

import type { Walkthrough } from "./walkthroughs";

export interface WelcomeState {
  /** `<walk>.<step>` marked done */
  done: string[];
  /** walkthroughs opened at least once (the others show «new») */
  opened: string[];
  /** open the Welcome at startup */
  show: boolean;
}

export const STORAGE_KEY = "wel.v1";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseState(raw: unknown): WelcomeState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { done: strings(o.done), opened: strings(o.opened), show: o.show !== false };
}

/** Read by the boot before anything else: a missing or broken value means «yes». */
export const showOnStartup = (raw: unknown): boolean => parseState(raw).show;

export const stepKey = (walk: string, step: string): string => `${walk}.${step}`;
export const isDone = (s: WelcomeState, walk: string, step: string): boolean => s.done.includes(stepKey(walk, step));

export function markDone(s: WelcomeState, walk: string, step: string): WelcomeState {
  const k = stepKey(walk, step);
  return s.done.includes(k) ? s : { ...s, done: [...s.done, k] };
}
export function markOpened(s: WelcomeState, walk: string): WelcomeState {
  return s.opened.includes(walk) ? s : { ...s, opened: [...s.opened, walk] };
}
export const setShow = (s: WelcomeState, show: boolean): WelcomeState => ({ ...s, show });

export interface Progress { done: number; total: number; pct: number }
export function progressOf(s: WelcomeState, w: Walkthrough): Progress {
  const done = w.steps.filter((st) => isDone(s, w.id, st.id)).length, total = w.steps.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The first step not done yet (the one a walkthrough opens on), or the last. */
export function currentStep(s: WelcomeState, w: Walkthrough): number {
  const i = w.steps.findIndex((st) => !isDone(s, w.id, st.id));
  return i < 0 ? w.steps.length - 1 : i;
}
