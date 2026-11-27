/* ═══════════ feature `scm` — domain: the Commit Composer (r23 F3, UI-SCM-14) ═══════════
   The working tree's changes split into commit drafts — one per theme (tests, docs, config, infra, styles, or the
   source module), each with a Conventional Commits message to finish — that the person edits: rename, move a
   file to another draft, leave a file out, then commit the drafts in order. With lanes on (experimental), a
   draft can target another branch. PURE. */

import { groupFiles, type ReviewFile } from "./review";
import { conventionalOf } from "./conventional";

export interface Draft { id: string; message: string; files: string[]; /** lanes: commit to this branch instead of HEAD's */ lane: string | null }

const TYPE: Record<string, string> = { tests: "test", docs: "docs", config: "chore", infra: "ci", styles: "style" };

/** The type and scope a group suggests (`src:crates/lexer` → `feat(lexer)`). */
export function suggestPrefix(groupKey: string): string {
  if (TYPE[groupKey]) return `${TYPE[groupKey]}: `;
  const top = groupKey.replace(/^src:/, "").split("/").pop() ?? "";
  return top && top !== "." ? `feat(${top}): ` : "feat: ";
}

export function draftsFrom(files: ReviewFile[]): Draft[] {
  return groupFiles(files).map((g, i) => ({ id: `d${i + 1}`, message: suggestPrefix(g.key), files: g.files.map((f) => f.path), lane: null }));
}

/** Moves a file to another draft (or to a new one with `to = "new"`); empty drafts disappear. */
export function moveFile(drafts: Draft[], path: string, to: string): Draft[] {
  const out = drafts.map((d) => ({ ...d, files: d.files.filter((f) => f !== path) }));
  if (to === "new") {
    const n = 1 + Math.max(0, ...drafts.map((d) => Number(d.id.slice(1)) || 0));
    out.push({ id: `d${n}`, message: "", files: [path], lane: null });
  } else {
    const d = out.find((x) => x.id === to);
    if (!d) return drafts;
    d.files.push(path);
  }
  return out.filter((d) => d.files.length);
}

/** Why a draft cannot be committed yet (null: it can): a Conventional Commits message with a subject, files. */
export function draftProblem(d: Draft, excluded: string[]): "files" | "message" | null {
  if (!d.files.some((f) => !excluded.includes(f))) return "files";
  const m = d.message.trim();
  if (!conventionalOf(m + (m.endsWith(":") ? " " : "")) || !/:\s*\S/.test(m)) return "message";
  return null;
}
