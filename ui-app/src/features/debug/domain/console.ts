/* ═══════════ feature `debug` — domain: the debug console, the memory view and the test picker (r23 F2) ═══════════
   UI-DBG-11: a console that evaluates in the selected frame, with history (↑/↓, like a shell:
   the newest first, back to an empty line past the newest). The adapter may run code to answer
   (lldb calls functions): the view says so, nothing promises otherwise.
   UI-DBG-14: a variable's bytes as hex rows with their address and the printable characters.
   «Debug this test»: the test binaries of the project as picker items.
   PURE: no DOM, no window. */

export type ConsoleKind = "in" | "out" | "err";
export interface ConsoleLine { kind: ConsoleKind; text: string }

/** One step through the history: `idx` is the current position (`hist.length` = the empty line). */
export function historyStep(hist: string[], idx: number, dir: -1 | 1): { idx: number; text: string } {
  const n = Math.max(0, Math.min(hist.length, idx + dir));
  return { idx: n, text: n === hist.length ? "" : hist[n] };
}

/** Adds an expression to the history (no repeats in a row), keeping the last `max`. */
export function remember(hist: string[], expr: string, max = 100): string[] {
  const e = expr.trim();
  if (!e) return hist;
  const next = hist[hist.length - 1] === e ? hist.slice() : [...hist, e];
  return next.slice(-max);
}

export interface HexRow { address: string; hex: string; ascii: string }

/** Hex rows of `width` bytes from the address the adapter gave (`0x…`). */
export function hexRows(address: string, bytes: number[], width = 16): HexRow[] {
  let base: bigint;
  try { base = BigInt(address); } catch { base = 0n; }
  const rows: HexRow[] = [];
  for (let i = 0; i < bytes.length; i += width) {
    const chunk = bytes.slice(i, i + width);
    rows.push({
      address: "0x" + (base + BigInt(i)).toString(16).padStart(12, "0"),
      hex: chunk.map((b) => b.toString(16).padStart(2, "0")).join(" "),
      ascii: chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·")).join(""),
    });
  }
  return rows;
}

export interface TestBinary { target: string; kind: string; executable: string; cwd: string; tests: string[] }
export interface TestPick { label: string; binary: TestBinary; name: string }

/** The tests of the project as picker items: `name — target (kind)` (the target only when there are several). */
export function testPicks(bins: TestBinary[]): TestPick[] {
  const many = new Set(bins.map((b) => b.target + b.kind)).size > 1;
  return bins.flatMap((b) => b.tests.map((name) => ({ label: many ? `${name} — ${b.target} (${b.kind})` : name, binary: b, name })));
}

/** The arguments that run exactly one test with its output shown (`testbins::test_args`). */
export const testArgs = (name: string): string[] => ["--exact", name, "--nocapture"];
