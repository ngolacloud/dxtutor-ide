/* ═════════ dxtutor IDE — the editor's inline values registry (A7, docs/v2/UI-AUDIT.md item 4) ═════════
   While the debugger is stopped, the editor shows the variables' values at the end of the lines
   above the stop. The debug feature registers what to show for a file (line → text); the editor
   asks after each full paint. No window: both sides import this module. Paths are the editor's. */

export type InlineValues = (path: string) => Record<number, string> | null;

let provider: InlineValues | null = null;

export const inlineValues = {
  set(p: InlineValues | null): void {
    provider = p;
  },
  of(path: string): Record<number, string> | null {
    return provider ? provider(path) : null;
  },
};
