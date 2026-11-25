/* ═══════════ feature `debug` — domain: Just My Code and PerfTips (r23 F2, UI-DBG-12, UI-DBG-08) ═══════════
   Just My Code: a frame is the human's when its source is in the open folder (and not in
   `target/`); the standard library, `~/.cargo` dependencies and frames without source are
   library frames — collapsed into one row that opens on a click. When the program stops inside
   a library (a panic stops in `rust_panic`), the view selects the first frame of the human's code.
   PerfTips: the time the program ran between two stops, shown on the current line.
   PURE: no DOM, no window. */

/** Is this frame's source in the open folder (and not a build output)? */
export function isUserFrame(file: string, root: string): boolean {
  if (!file || !root) return false;
  const r = root.replace(/\/$/, "") + "/";
  if (!file.startsWith("/")) return !/^(target|\.cargo)\//.test(file);
  return file.startsWith(r) && !file.slice(r.length).startsWith("target/");
}

/** The first frame of the human's code (-1: none). */
export function firstUserFrame(files: string[], root: string): number {
  return files.findIndex((f) => isUserFrame(f, root));
}

export type StackRow = { kind: "frame"; index: number } | { kind: "lib"; from: number; count: number };

/** The stack as rows: with Just My Code on, each run of library frames is one row (unless it was
 *  opened — `open` holds the index of the run's first frame) and the selected frame always shows. */
export function stackRows(files: string[], root: string, jmc: boolean, open: ReadonlySet<number>, selected = -1): StackRow[] {
  const rows: StackRow[] = [];
  for (let i = 0; i < files.length; i++) {
    if (!jmc || isUserFrame(files[i], root) || i === selected) { rows.push({ kind: "frame", index: i }); continue; }
    let j = i;
    while (j + 1 < files.length && !isUserFrame(files[j + 1], root) && j + 1 !== selected) j++;
    if (open.has(i)) for (let k = i; k <= j; k++) rows.push({ kind: "frame", index: k });
    else rows.push({ kind: "lib", from: i, count: j - i + 1 });
    i = j;
  }
  return rows;
}

/** A PerfTip: the time the program ran before this stop, rounded the way a human reads it. */
export function perfTip(ms: number): string {
  if (!(ms >= 0)) return "";
  if (ms < 1) return "≤ 1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
