/* ═══════════ feature `scm` — domain: git's conflict markers (r23 F3, UI-SCM-13) ═══════════
   `<<<<<<< ours … ||||||| base … ======= … >>>>>>> theirs` blocks in a working file: whether any are left,
   and resolving every block by taking one side or both (ours then theirs). PURE. */

export type Side = "ours" | "theirs" | "both";

const START = /^<{7}(?: .*)?$/, BASE = /^\|{7}(?: .*)?$/, MID = /^={7}$/, END = /^>{7}(?: .*)?$/;

export const hasMarkers = (text: string): boolean => text.split("\n").some((l) => START.test(l) || END.test(l));

/** How many conflict blocks the text has. */
export const blockCount = (text: string): number => text.split("\n").filter((l) => START.test(l)).length;

/** Every block resolved to one side (or both, ours first). Text outside the blocks stays as it is. */
export function takeSide(text: string, side: Side): string {
  const out: string[] = [];
  let mode: "out" | "ours" | "base" | "theirs" = "out", ours: string[] = [], theirs: string[] = [];
  for (const l of text.split("\n")) {
    if (mode === "out" && START.test(l)) { mode = "ours"; ours = []; theirs = []; continue; }
    if (mode === "ours" && BASE.test(l)) { mode = "base"; continue; }
    if ((mode === "ours" || mode === "base") && MID.test(l)) { mode = "theirs"; continue; }
    if (mode === "theirs" && END.test(l)) { out.push(...(side === "ours" ? ours : side === "theirs" ? theirs : [...ours, ...theirs])); mode = "out"; continue; }
    if (mode === "ours") ours.push(l); else if (mode === "theirs") theirs.push(l); else if (mode === "out") out.push(l);
  }
  return out.join("\n");
}
