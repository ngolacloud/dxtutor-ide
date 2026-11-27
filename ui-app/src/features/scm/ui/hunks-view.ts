/* ═════════ feature `scm` — ui: a file's hunks in the Source Control pane (r23 F3, UI-SCM-10) ═════════
   Under the file's row: the hunks not staged (unticked) and those in the index (ticked), each with its header,
   the +/− counts and the first lines. Ticking stages that hunk, unticking takes it out (`scm-hunk`,
   `data-on="path|id|stage|unstage"`). Markup only. */

import type { HunkEntry } from "../application/hunks";
import type { HunkData } from "../application/extras-ports";
import type { HunkKey } from "./hunk-messages";

export type T = (k: HunkKey, p?: Record<string, string | number>) => string;
const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const PREVIEW = 8;

function hunk(t: T, path: string, h: HunkData, staged: boolean, busy: boolean): string {
  const body = h.lines.filter((l) => !l.startsWith("\\")).slice(0, PREVIEW)
    .map((l) => `<span class="hk-l${l[0] === "+" ? " add" : l[0] === "-" ? " del" : ""}">${esc(l)}</span>`).join("\n");
  return `<label class="hk"><input type="checkbox" data-action="scm-hunk" data-on="${esc(`${path}|${h.id}|${staged ? "unstage" : "stage"}`)}"${staged ? " checked" : ""}${busy ? " disabled" : ""} title="${esc(t(staged ? "unstageHunk" : "stageHunk"))}">`
    + `<span class="hk-h"><code>${esc(h.header.replace(/^(@@[^@]*@@).*$/, "$1"))}</code><span class="hk-n"><span class="add">+${h.added}</span> <span class="del">−${h.removed}</span></span></span>`
    + `<pre class="hk-pre">${body}${h.lines.length > PREVIEW ? "\n…" : ""}</pre></label>`;
}

export function renderHunks(t: T, path: string, e: HunkEntry): string {
  if (e.error) return `<div class="hk-box"><div class="hk-err">${esc(e.error)}</div></div>`;
  if (!e.unstaged || !e.staged) return `<div class="hk-box"><div class="hk-dim">${esc(t("reading"))}</div></div>`;
  if (e.unstaged.binary || e.staged.binary) return `<div class="hk-box"><div class="hk-dim">${esc(t("binary"))}</div></div>`;
  const un = e.unstaged.hunks, st = e.staged.hunks;
  if (!un.length && !st.length) return `<div class="hk-box"><div class="hk-dim">${esc(t("none"))}</div></div>`;
  return `<div class="hk-box">${un.length ? `<div class="hk-grp">${esc(t("notStaged"))}</div>${un.map((h) => hunk(t, path, h, false, e.busy)).join("")}` : ""}`
    + `${st.length ? `<div class="hk-grp">${esc(t("inIndex"))}</div>${st.map((h) => hunk(t, path, h, true, e.busy)).join("")}` : ""}</div>`;
}
