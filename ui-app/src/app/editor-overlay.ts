/* ═════════ dxtutor IDE — editor overlay registry (docs/v2/RF-CODEV-STREAM.md §8) ═════════
   How another feature draws on top of the file editor without the editor knowing it: the
   Co-Dev feature registers an overlay that, for a file with live hunks, gives the text to
   show (the file plus the proposed lines), maps the human's edits back onto the real file
   and adds its decorations after each paint. The editor registers how to repaint a file.
   No window: both sides import this module. */

export interface OverlayLine {
  kind: "ctx" | "old" | "new";
  /** Line number in the real file (ctx and old lines). */
  real?: number;
  hunk?: string;
  writing?: boolean;
}

export interface OverlayView {
  text: string;
  lines: OverlayLine[];
}

export interface EditorOverlay {
  /** The view of a file with an overlay, or `null` to show the file as it is. */
  view(path: string, real: string): OverlayView | null;
  /** The human changed the view to `next`: the new real content, or `null` to refuse. */
  edit(path: string, view: OverlayView, next: string, real: string): string | null;
  /** After the editor painted `path` with `view`: add decorations. `null`: the file is shown as it is (no
   *  open hunks any more) — the overlay removes what it drew. */
  decorate(path: string, host: { wrap: HTMLElement; hl: HTMLElement; gut: HTMLElement }, view: OverlayView | null): void;
}

let overlay: EditorOverlay | null = null;
let repaint: ((path: string) => void) | null = null;

export const editorOverlay = {
  set(o: EditorOverlay | null): void {
    overlay = o;
  },
  get: (): EditorOverlay | null => overlay,
  /** The editor: how to redraw `path` if it is the file on screen. */
  onRepaint(f: (path: string) => void): void {
    repaint = f;
  },
  /** The overlay: its view of `path` changed. */
  repaint(path: string): void {
    repaint?.(path);
  },
};
