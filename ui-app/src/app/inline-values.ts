/* ═════════ dxtutor IDE — the editor's inline values registry (A7, docs/v2/UI-AUDIT.md item 4) ═════════
   While the debugger is stopped, the editor shows the variables' values at the end of the lines
   above the stop. The debug feature registers what to show for a file (line → text); the editor
   asks after each full paint. No window: both sides import this module. Paths are the editor's. */

/** A line's text, or (r23 F2) a text with a class: `chg` (a value that changed at this stop), `perf` (a PerfTip). */
export type InlineValue = string | { text: string; cls?: "chg" | "perf" };
export type InlineValues = (path: string) => Record<number, InlineValue | InlineValue[]> | null;

let provider: InlineValues | null = null;

export const inlineValues = {
  set(p: InlineValues | null): void {
    provider = p;
  },
  of(path: string): Record<number, InlineValue | InlineValue[]> | null {
    return provider ? provider(path) : null;
  },
};
