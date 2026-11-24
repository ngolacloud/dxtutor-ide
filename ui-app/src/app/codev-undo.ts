/* ═════════ dxtutor IDE — Ctrl+Z undoes Co-Dev's last block (RF-E07, docs/v2/RF-DELONIX-PLANO.md F2.6) ═════════
   When a Co-Dev hunk is applied, the file's text from before is remembered here (the editor is
   reloaded from disk afterwards, so the textarea's own undo cannot reach it). Ctrl+Z in the
   editor then puts that text back — exactly — while the human has not typed in the file since;
   typing forgets it (the textarea's undo is the human's again). Co-Dev registers how to turn the
   editor's file key into the project path its events use. No window global. */

const stacks = new Map<string, string[]>();
let relOf: (fileKey: string) => string = (k) => k;

export const codevUndo = {
  /** Co-Dev: how the editor's file key maps to the path of its hunk events. */
  setRel(f: (fileKey: string) => string): void {
    relOf = f;
  },
  /** Co-Dev: a hunk was applied to `path` (project path); `before` is the text it replaced. */
  remember(path: string, before: string): void {
    const s = stacks.get(path) ?? [];
    // several hunks of one change land before the reload: one step back
    if (s[s.length - 1] !== before) s.push(before);
    stacks.set(path, s);
  },
  /** The editor: the human typed in the file — Ctrl+Z is theirs again. */
  forget(fileKey: string): void {
    stacks.delete(relOf(fileKey));
  },
  /** The editor (Ctrl+Z): the text before Co-Dev's last block, or `null` when there is none. */
  take(fileKey: string): string | null {
    const path = relOf(fileKey);
    const s = stacks.get(path);
    const v = s?.pop() ?? null;
    if (s && !s.length) stacks.delete(path);
    return v;
  },
};
