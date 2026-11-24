/* ═══════════ feature `hood` — domain: pure rules over what the toolchain really produced (A8) ═══════════
   Which language a file is, how hot a line is (its share of the machine code), the sizes typed for the
   growth series, the call stack and the changed locals at a step of a real trace, the output up to a
   step, and a memory sparkline. PURE: no DOM, no window, no Tauri. */

import type { Lang, LineCode, LineOps, TraceStep, TraceVar } from "./types";

export function langOf(path: string): Lang | null {
  if (/\.rs$/i.test(path)) return "rust";
  if (/\.py$/i.test(path)) return "python";
  return null;
}

/** A complete Rust program has a `fn main`; a library file cannot be built and run on its own. */
export const isProgram = (lang: Lang, text: string): boolean => lang === "python" || /\bfn\s+main\s*\(/.test(text);

/** Each line's share of the instructions (or bytecode ops), 0–1 against the busiest line. */
export function heatByLine(lines: Array<LineCode | LineOps>): Map<number, number> {
  const count = new Map<number, number>();
  for (const l of lines) count.set(l.line, (count.get(l.line) ?? 0) + ("instructions" in l ? l.instructions.length : l.ops.length));
  const max = Math.max(1, ...count.values());
  return new Map([...count].map(([k, v]) => [k, v / max]));
}

/** «1000, 2k, 4000 8000» → [1000, 2000, 4000, 8000] (k = ×1000, M = ×1 000 000), sorted and unique. */
export function parseSizes(text: string): number[] {
  const out = text
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => { const m = t.match(/^(\d+(?:\.\d+)?)(k|m)?$/); return m ? Math.round(parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1)) : NaN; })
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The call stack at step `i` (outermost first), from the trace's call/return events and depths. */
export function stackAt(steps: TraceStep[], i: number): string[] {
  if (!steps[i]) return [];
  const stack: string[] = [];
  for (let k = 0; k <= i; k++) {
    const d = Math.max(0, steps[k].depth);
    stack.length = d;
    stack[d] = steps[k].func;
  }
  return stack.filter((f) => f !== undefined && f !== "");
}

/** The locals at step `i` whose value differs from the previous step of the same function. */
export function changedAt(steps: TraceStep[], i: number): Set<string> {
  const cur = steps[i];
  const out = new Set<string>();
  if (!cur) return out;
  let prev: TraceStep | undefined;
  for (let k = i - 1; k >= 0; k--) if (steps[k].func === cur.func && steps[k].depth === cur.depth) { prev = steps[k]; break; }
  if (!prev) return out;
  const before = new Map<string, TraceVar>(prev.locals.map((v) => [v.name, v]));
  for (const v of cur.locals) if (!before.has(v.name) || before.get(v.name)!.value !== v.value) out.add(v.name);
  return out;
}

/** What the program had printed when it reached step `i`. */
export const stdoutAt = (stdout: string, steps: TraceStep[], i: number): string => stdout.slice(0, steps[i] ? steps[i].stdoutLen : 0);

/** An SVG polyline for a memory time series (width × height). */
export function sparkPoints(samples: Array<{ tMs: number; rssKb: number }>, w: number, h: number): string {
  if (samples.length < 2) return "";
  const t0 = samples[0].tMs, t1 = samples[samples.length - 1].tMs || 1, mx = Math.max(...samples.map((s) => s.rssKb), 1);
  return samples.map((s) => `${(((s.tMs - t0) / Math.max(1, t1 - t0)) * w).toFixed(1)},${(h - (s.rssKb / mx) * h).toFixed(1)}`).join(" ");
}

export function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
