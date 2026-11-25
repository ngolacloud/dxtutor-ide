/* ═══════════ Co-Dev — domain: a block against the approved plan (RF-S08, docs/v2/RF-DELONIX-PLANO.md F3.3) ═══════════
   The plan `exit_plan` approved lists its steps with the files each one touches. When Co-Dev
   starts writing a block, the chat says where it is and whether that follows the plan: in its
   order, ahead of it (a file of an earlier step was not touched yet), or outside it. The blocks
   are not held back — the model calls one tool at a time and, in Assist, each waits for the human,
   so holding one would stop the turn; the agent is told to follow the order, and the chat shows
   when it does not. Pure: no DOM. */

import type { PlanStep } from "./run-state";

export type PlanPlace =
  | { kind: "none" }
  | { kind: "in-order"; step: number }
  | { kind: "ahead"; step: number; pending: string[] }
  | { kind: "outside" };

const norm = (p: string): string => p.trim().replace(/^\.\//, "").replace(/\\/g, "/");

/** The files of the plan in the order of its steps (each once). */
export function planFiles(steps: PlanStep[]): string[] {
  const out: string[] = [];
  for (const s of steps) for (const f of s.files) { const p = norm(f.path); if (p && !out.includes(p)) out.push(p); }
  return out;
}

/** Where a block on `path` falls in the plan, given the files already written in it (`touched`). */
export function placeInPlan(steps: PlanStep[], touched: string[], path: string): PlanPlace {
  const files = planFiles(steps);
  if (!files.length) return { kind: "none" };
  const p = norm(path);
  const at = files.indexOf(p);
  if (at < 0) return { kind: "outside" };
  const step = steps.findIndex((s) => s.files.some((f) => norm(f.path) === p)) + 1;
  const done = new Set(touched.map(norm));
  const pending = files.slice(0, at).filter((f) => !done.has(f));
  return pending.length ? { kind: "ahead", step, pending } : { kind: "in-order", step };
}

/** `40–52`, or `40` for one line (an insertion has `end < start`). */
export function rangeLabel(start: number, end: number): string {
  return end > start ? `${start}–${end}` : `${start}`;
}
