/* ═══════════ Co-Dev — domain: a whole-file proposal as hunks for the editor ═══════════
   Some writers only have the WHOLE new file: the legacy live chat (`write_file`), the desktop
   sampler (```dxcode blocks) and the Explain / Code review panel («Apply» a suggestion, the AI
   review's improved code). The agent v2 already streams line-level hunks into the editor
   (RF-CODEV-STREAM); this turns a whole-file proposal into the SAME hunks — only the lines that
   change, each with the old lines it replaces — so the editor shows them in place (old struck
   out, new typed in) and the human accepts or rejects each one. `applyAccepted` writes back only
   the accepted ones. Pure: no DOM, no window. */

import { diffLines } from "../../diff/domain/diff";

export interface ProposalHunk {
  /** 1-based line of the first old line (for a pure insertion: the line it goes before) */
  start: number;
  /** the old lines it replaces, each ending in "\n" ("" for a pure insertion) */
  old: string;
  /** the new lines, each ending in "\n" ("" for a pure deletion) */
  text: string;
  added: number;
  removed: number;
}

const join = (ls: string[]): string => (ls.length ? ls.join("\n") + "\n" : "");

/** The blocks of change between `base` and `proposed`, top to bottom. */
export function proposalHunks(base: string, proposed: string): ProposalHunk[] {
  const rows = diffLines(base, proposed);
  const out: ProposalHunk[] = [];
  let oldLine = 1;
  let cur: { start: number; old: string[]; add: string[] } | null = null;
  const close = () => {
    if (cur && (cur.old.length || cur.add.length)) out.push({ start: cur.start, old: join(cur.old), text: join(cur.add), added: cur.add.length, removed: cur.old.length });
    cur = null;
  };
  for (const [op, tx] of rows) {
    if (op === " ") { close(); oldLine++; continue; }
    if (!cur) cur = { start: oldLine, old: [], add: [] };
    if (op === "-") { cur.old.push(tx); oldLine++; } else cur.add.push(tx);
  }
  close();
  return out;
}

/** Where `old` sits in `lines` (0-based): at `start - 1` if it is still there, else its only
 *  occurrence; `null` when it cannot be placed. A pure insertion goes at `start - 1`. */
function placeAt(lines: string[], h: { start: number; old: string }): number | null {
  const old = h.old === "" ? [] : h.old.replace(/\n$/, "").split("\n");
  const a = h.start - 1;
  if (!old.length) return Math.max(0, Math.min(lines.length, a));
  const fits = (i: number) => old.every((l, k) => lines[i + k] === l);
  if (a >= 0 && a + old.length <= lines.length && fits(a)) return a;
  let found: number | null = null;
  for (let i = 0; i + old.length <= lines.length; i++) if (fits(i)) { if (found !== null) return null; found = i; }
  return found;
}

/** `real` (the file as it is now) with only the `accepted` hunks applied. Returns the new text and
 *  the hunks that could not be placed (the file changed under them). */
export function applyAccepted(real: string, hunks: ProposalHunk[], accepted: boolean[]): { text: string; stale: number[] } {
  const lines = real.split("\n");
  const stale: number[] = [];
  const placed = hunks.map((h, i) => ({ h, i, at: accepted[i] ? placeAt(lines, h) : null }));
  for (const p of placed) if (accepted[p.i] && p.at === null) stale.push(p.i);
  // bottom-up, so the line numbers above stay valid
  for (const p of placed.filter((x) => x.at !== null).sort((x, y) => y.at! - x.at!)) {
    const oldN = p.h.removed;
    const add = p.h.text === "" ? [] : p.h.text.replace(/\n$/, "").split("\n");
    lines.splice(p.at!, oldN, ...add);
  }
  return { text: lines.join("\n"), stale };
}
