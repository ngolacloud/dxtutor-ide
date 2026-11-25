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

/* ── RF-G08 (sessão de fecho, bloco 2): o bloco contra as LINHAS que o passo do plano deu ── */

/** Lines of slack around a planned range: earlier blocks of the same turn shift the lines, and the
 *  plan's lines are the model's estimate before it wrote anything. */
export const PLAN_LINE_SLACK = 3;

export type LinesCheck = { kind: "unknown" } | { kind: "in" } | { kind: "out"; planned: Array<[number, number]> };

/** The line ranges the plan gave for `path` (steps that name the file without lines add none). */
export function plannedLines(steps: PlanStep[], path: string): Array<[number, number]> {
  const p = norm(path);
  const out: Array<[number, number]> = [];
  for (const s of steps)
    for (const f of s.files) {
      if (norm(f.path) !== p || typeof f.start !== "number") continue;
      const r: [number, number] = [f.start, Math.max(f.start, typeof f.end === "number" ? f.end : f.start)];
      if (!out.some(([a, b]) => a === r[0] && b === r[1])) out.push(r);
    }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Does a block on `path` at `start`–`end` fall in the lines the plan gave for that file? `unknown`
 *  when the plan gave none for it (no plan, the file is not in it, or it came without lines). */
export function linesInPlan(steps: PlanStep[], path: string, start: number, end: number, slack = PLAN_LINE_SLACK): LinesCheck {
  const planned = plannedLines(steps, path);
  if (!planned.length) return { kind: "unknown" };
  const a = start, b = Math.max(start, end);
  return planned.some(([ps, pe]) => b >= ps - slack && a <= pe + slack) ? { kind: "in" } : { kind: "out", planned };
}

/** `40–52, 90` — the planned ranges, short. */
export function plannedLabel(planned: Array<[number, number]>): string {
  return planned.map(([a, b]) => rangeLabel(a, b)).join(", ");
}

