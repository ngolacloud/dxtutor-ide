/* ═════════ dxtutor IDE — the editor's line annotation registry (A4, docs/v2/UI-AUDIT.md item 9) ═════════
   How another feature annotates the line under the caret without the editor knowing it: the
   Source Control feature registers what the blame says about a line (the text at the end of
   the line, GitLens-style, and the status bar's blame with what a click does); the editor
   asks on every caret move and paint, and registers how to redraw when the annotation
   changes (the blame arrived). No window: both sides import this module. Paths are the
   editor's (the FS key). */

export interface LineAnnotator {
  /** plain text at the end of the caret line, or null */
  inline(path: string, line: number): string | null;
  /** the status bar's blame for that line, or null to leave the editor's own */
  status(path: string, line: number): { text: string; title: string; open: () => void } | null;
}

let annotator: LineAnnotator | null = null;
let redraw: (() => void) | null = null;

export const lineAnnotation = {
  set(a: LineAnnotator | null): void {
    annotator = a;
  },
  get: (): LineAnnotator | null => annotator,
  /** The editor: how to redraw the annotation of the line on screen. */
  onRedraw(f: () => void): void {
    redraw = f;
  },
  /** The annotator: what it says changed. */
  redraw(): void {
    redraw?.();
  },
};
