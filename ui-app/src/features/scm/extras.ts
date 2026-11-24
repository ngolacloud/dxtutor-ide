/* ═════════ feature scm — composition of the A4 git work (docs/v2/UI-AUDIT.md item 9) ═════════
   Wires the use case (application/git-extras.ts) to the backend (infrastructure/tauri.ts), to
   the desktop and the monolith (infrastructure/legacy-bridge.ts), to Co-Dev (`codev.ask`) and
   to the editor's line annotation (app/line-annotation.ts); registers the «File history»,
   «Compare», «Interactive rebase» and text tabs, and the `gx-*` actions the residue
   (features/scm.ts) binds with its own. Only in the desktop app with a git repository: in the
   browser and in the goldens `active()` is false and nothing shows. No window here. */

import { VIEW } from "../../app/store/registry";
import { lineAnnotation } from "../../app/line-annotation";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { makeGitExtras } from "./application/git-extras";
import { tauriGitExtras } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { GIT_MESSAGES, type GitKey } from "./ui/git-messages";
import { blameText, renderCompare, renderHistory, renderRebase, renderSide, renderText } from "./ui/git-views";
import type { ActionTable } from "./ui/actions";
import type { RebaseAction } from "./domain/git-extras";

const t = translator(GIT_MESSAGES);
const say = (k: string, p?: Record<string, string | number>): string => t(k as GitKey, p);

/** A path of the editor (the FS key = ROOT + relative path) as a project path, or null. */
const relOf = (p: string): string | null => { const r = B.rootKey(); return r && p.startsWith(r) ? p.slice(r.length) : null; };

export const gitExtras = makeGitExtras({
  git: tauriGitExtras(),
  ws: {
    root: () => B.gitRoot(),
    project: () => B.projectName(),
    save: () => B.saveToDisk(),
    changed: () => B.reloadFromGit(),
    branches: () => Object.keys(B.git().refs),
    current: () => B.branch(),
    cursor: () => B.editorCursor(),
    commitMessage: () => B.commitMsg(),
    open: (p, l) => B.openRel(p, l),
  },
  human: {
    confirm: (m) => B.confirmBox(m),
    text: (ph, verb, initial) => new Promise((res) => { B.palette(initial ?? "", { ph, verb, text: (q) => res(q) }); }),
    pick: (ph, items) => new Promise((res) => { B.palette("", { ph, items: items.map((i) => ({ l: i.label, d: i.detail, run: () => res(i.value) })) }); }),
    toast: (m) => B.toast(m),
  },
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  tabs: { open: (id, title, kind) => B.openTab({ id, title, kind }), repaint: (kind) => paint(kind) },
  say,
});

/** The A4 git work is on (desktop app, the open folder is a git repository). */
export const active = (): boolean => B.gitRoot() !== null;

/* ── the tabs: mounted hosts repaint on every change while on screen ── */
const hosts: Record<string, HTMLElement | null> = {};
const RENDER: Record<string, () => string> = {
  "git-history": () => renderHistory(t, gitExtras.state().history, codevAsk.available(), Date.now()),
  "git-compare": () => renderCompare(t, gitExtras.state().compare, Date.now()),
  "git-rebase": () => renderRebase(t, gitExtras.state().rebase),
  "git-text": () => renderText(gitExtras.state().text),
};
function paint(kind: string): void {
  const h = hosts[kind];
  if (!h || !h.isConnected) return;
  const a = document.activeElement;
  if (a && h.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return; // never under the typing
  h.innerHTML = RENDER[kind]();
}
for (const kind of Object.keys(RENDER)) VIEW[kind] = (_t, host) => { hosts[kind] = host; host.innerHTML = RENDER[kind](); };
gitExtras.subscribe(() => {
  Object.keys(RENDER).forEach(paint);
  /* the pane too, unless the human is typing the commit message there */
  if (active() && document.activeElement?.id !== "scm-msg") B.panes().scm?.();
});

/* ── the editor's line annotation and the status bar's blame ── */
lineAnnotation.set({
  inline: (p, line) => { const r = active() ? relOf(p) : null; const b = r ? gitExtras.lineBlame(r, line) : null; return b ? blameText(t, b, Date.now()) : null; },
  status: (p, line) => {
    const r = active() ? relOf(p) : null;
    if (!r) return null;
    const b = gitExtras.lineBlame(r, line);
    return { text: b ? blameText(t, b, Date.now()) : "", title: t("blameTitle"), open: () => { void gitExtras.openHistory(r, [line, line]); } };
  },
});
gitExtras.onBlame(() => lineAnnotation.redraw());
/* saved files and git changes make their blame stale */
document.addEventListener("dx:saved", (e) => {
  const files = (e as CustomEvent<{ files?: unknown }>).detail?.files;
  gitExtras.invalidate(Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : undefined);
  lineAnnotation.redraw();
});
document.addEventListener("dx:workspace", () => { gitExtras.invalidate(); });

/** The Source Control pane's extra sections (empty outside the desktop with a repository). */
let sideAsked = false;
export function sideSections(): string {
  if (!active()) { sideAsked = false; return ""; }
  if (!sideAsked) { sideAsked = true; void gitExtras.refreshSide(); }
  return renderSide(t, gitExtras.state(), codevAsk.available(), Date.now());
}

/** The palette's git commands (app/commands.ts): outside the desktop with a repository they say why. */
const guard = (f: () => unknown) => (): void => { if (!active()) { B.toast(t("needRepo")); return; } void f(); };
export const GIT_COMMANDS: Array<[string, () => void]> = [
  ["Git: File History", guard(() => gitExtras.openHistory())],
  ["Git: Line History (selection)", guard(() => { const c = B.editorCursor(); return c ? gitExtras.openHistory(c.path, [c.start, c.end]) : gitExtras.openHistory(); })],
  ["Git: Compare Branches…", guard(() => gitExtras.openCompare())],
  ["Git: Interactive Rebase…", guard(() => gitExtras.openRebase())],
  ["Git: Stash Changes", guard(() => gitExtras.stashPush(false))],
  ["Git: Stash Including Untracked", guard(() => gitExtras.stashPush(true))],
  ["Git: New Worktree…", guard(() => gitExtras.worktreeAdd())],
  ["Git: Amend Last Commit…", guard(() => gitExtras.amend())],
  ["Co-Dev: Write Commit Message", guard(() => gitExtras.askCommitMessage())],
  ["Co-Dev: Review Staged Changes", guard(() => gitExtras.askReviewStaged())],
];

const n = (s: string): number => Number(s) || 0;
export const GIT_ACTIONS: ActionTable = {
  "gx-stash-push": { on: "click", run: () => { void gitExtras.stashPush(false); } },
  "gx-stash-push-all": { on: "click", run: () => { void gitExtras.stashPush(true); } },
  "gx-stash-show": { on: "click", run: (e) => { void gitExtras.stashShow(n(e.on)); } },
  "gx-stash-apply": { on: "click", run: (e) => { void gitExtras.stashApply(n(e.on), false); } },
  "gx-stash-pop": { on: "click", run: (e) => { void gitExtras.stashApply(n(e.on), true); } },
  "gx-stash-drop": { on: "click", run: (e) => { void gitExtras.stashDrop(n(e.on)); } },
  "gx-wt-add": { on: "click", run: () => { void gitExtras.worktreeAdd(); } },
  "gx-wt-remove": { on: "click", run: (e) => { void gitExtras.worktreeRemove(e.on); } },
  "gx-history": { on: "click", run: () => { void gitExtras.openHistory(); } },
  "gx-history-file": { on: "click", run: (e) => { void gitExtras.openHistory(e.on, null); } },
  "gx-history-refresh": { on: "click", run: () => { const h = gitExtras.state().history; if (h) void gitExtras.openHistory(h.path, h.range); } },
  "gx-select-commit": { on: "click", run: (e) => { void gitExtras.selectCommit(e.on); } },
  "gx-select-commit-short": { on: "click", run: (e) => { const c = gitExtras.state().history?.commits.find((x) => x.hash.startsWith(e.on)); if (c) void gitExtras.selectCommit(c.hash); } },
  "gx-explain-commit": { on: "click", run: (e) => { void gitExtras.explainCommit(e.on); } },
  "gx-compare": { on: "click", run: () => { void gitExtras.openCompare(); } },
  "gx-compare-swap": { on: "click", run: () => { const c = gitExtras.state().compare; if (c) void gitExtras.compare(c.target, c.base); } },
  "gx-open-file": { on: "click", run: (e) => B.openRel(e.on) },
  "gx-rebase": { on: "click", run: () => { void gitExtras.openRebase(); } },
  "gx-rb-up": { on: "click", run: (e) => gitExtras.move(n(e.on), -1) },
  "gx-rb-down": { on: "click", run: (e) => gitExtras.move(n(e.on), 1) },
  "gx-rb-action": { on: "change", run: (e) => gitExtras.setAction(n(e.on), e.value as RebaseAction) },
  "gx-rb-msg": { on: "input", run: (e) => gitExtras.setMessage(n(e.on), e.value) },
  "gx-rb-reset": { on: "click", run: () => gitExtras.resetPlan() },
  "gx-rb-run": { on: "click", run: () => { void gitExtras.runRebase(); } },
  "gx-amend": { on: "click", run: () => { void gitExtras.amend(); } },
  "gx-ask-message": { on: "click", run: () => { void gitExtras.askCommitMessage(); } },
  "gx-ask-review": { on: "click", run: () => { void gitExtras.askReviewStaged(); } },
};
