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
import { changeSetsSignal } from "../../app/change-sets-signal";
import { translator } from "../../app/i18n";
import { makeGitExtras } from "./application/git-extras";
import { tauriGitExtras } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { GIT_MESSAGES, type GitKey } from "./ui/git-messages";
import { blameText, renderCompare, renderHistory, renderRebase, renderReview, renderSide, renderText, renderUndo } from "./ui/git-views";
import type { ActionTable } from "./ui/actions";
import type { RebaseAction } from "./domain/git-extras";
import { makeHunks } from "./application/hunks";
import { tauriHunks, tauriUndo, tauriScmAudit, tauriMerge, tauriSync } from "./infrastructure/tauri";
import { makeSync } from "./application/sync";
import { makeLaunchpad } from "./application/launchpad";
import { renderLaunchpad } from "./ui/launchpad-view";
import { tauriGh, openExternal } from "./infrastructure/tauri";
import { makeMerge3 } from "./application/merge3";
import { renderMerge3 } from "./ui/merge3-view";
import { makeUndo } from "./application/undo";
import { requestApproval } from "../../app/approval";
import type { GitExtrasPort } from "./application/extras-ports";
import { HUNK_MESSAGES } from "./ui/hunk-messages";
import { renderHunks } from "./ui/hunks-view";

const t = translator(GIT_MESSAGES);
const say = (k: string, p?: Record<string, string | number>): string => t(k as GitKey, p);

/** A path of the editor (the FS key = ROOT + relative path) as a project path, or null. */
const relOf = (p: string): string | null => { const r = B.rootKey(); return r && p.startsWith(r) ? p.slice(r.length) : null; };

/* r23 F3 (UI-SCM-12): undo for git — a snapshot before each operation, an approved and audited restore */
export const undo = makeUndo({
  git: tauriUndo(), root: () => B.gitRoot(), changed: () => B.reloadFromGit(),
  human: { approve: (r) => requestApproval(r), toast: (m) => B.toast(m) },
  audit: tauriScmAudit(), say,
});
undo.subscribe(() => { if (active()) B.panes().scm?.(); });
/** The A4 commands that change the repository take a snapshot first (stash push/apply/drop, amend). */
const withUndo = (g: GitExtrasPort): GitExtrasPort => ({
  ...g,
  stash: async (root, op) => { if (op.op !== "list" && op.op !== "show") await undo.snapshot(`stash ${op.op}`); return g.stash(root, op); },
  amend: async (root, message, allowPublished) => { await undo.snapshot("amend"); return g.amend(root, message, allowPublished); },
});

export const gitExtras = makeGitExtras({
  git: withUndo(tauriGitExtras()),
  ws: {
    root: () => B.gitRoot(),
    project: () => B.projectName(),
    save: () => B.saveToDisk(),
    changed: () => B.reloadFromGit(),
    branches: () => Object.keys(B.git().refs),
    current: () => B.branch(),
    cursor: () => B.editorCursor(),
    commitMessage: () => B.commitMsg(),
    setCommitMessage: (m) => B.setCommitMsg(m),
    stage: (paths) => { const r = B.rootKey(), s = B.staged(); paths.forEach((p) => s.add(r + p)); B.panes().scm?.(); },
    discard: (paths) => { const r = B.rootKey(), fs = B.files(); void undo.snapshot(`discard ${paths.join(", ")}`).then(() => paths.forEach((p) => { if (fs[r + p]) B.decoratedDiscard(r + p); })); },
    open: (p, l) => B.openRel(p, l),
  },
  audit: tauriScmAudit(),
  human: {
    approve: (r) => requestApproval(r),
    text: (ph, verb, initial) => new Promise((res) => { B.palette(initial ?? "", { ph, verb, text: (q) => res(q) }); }),
    pick: (ph, items) => new Promise((res) => { B.palette("", { ph, items: items.map((i) => ({ l: i.label, d: i.detail, run: () => res(i.value) })) }); }),
    toast: (m) => B.toast(m),
  },
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  tabs: { open: (id, title, kind) => B.openTab({ id, title, kind }), repaint: (kind) => paint(kind) },
  say,
});

/* ── r23 F3 (UI-SCM-10): staging part of a file, under its row in the pane (desktop with a repository only) ── */
const th = translator(HUNK_MESSAGES);
export const hunks = makeHunks({ git: tauriHunks(), root: () => B.gitRoot(), changed: async () => { B.panes().scm?.(); } });
hunks.subscribe(() => B.panes().scm?.());
/** The button on a changed file's row that opens its hunks (nothing outside the desktop: the goldens stay). */
export function hunkButton(fsKey: string): string {
  const rel = relOf(fsKey);
  if (!active() || rel === null) return "";
  return `<button title="${th("showHunks")}" data-action="scm-hunks" data-on="${escAttr(rel)}">${hunks.entry(rel) ? "▾" : "▸"}</button>`;
}
/** A changed file's hunks, when open (or nothing). */
export function hunkBox(fsKey: string): string {
  const rel = relOf(fsKey), e = rel === null ? undefined : hunks.entry(rel);
  return active() && rel !== null && e ? renderHunks(th, rel, e) : "";
}
const escAttr = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/* ── r23 F3 (UI-SCM-13): the three-way merge tab ── */
export const merge3 = makeMerge3({
  git: tauriMerge(), root: () => B.gitRoot(), changed: () => B.reloadFromGit(),
  openTab: () => B.openTab({ id: "git-merge", title: t("mergeTab"), kind: "git-merge" }),
  check: async () => { const r = await B.projectCheck(); return r ?? { cmd: null, ok: true, summary: "" }; },
  human: { approve: (r) => requestApproval(r), toast: (m) => B.toast(m) },
  audit: tauriScmAudit(),
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  say,
});
merge3.subscribe(() => paint("git-merge"));

/* ── r23 F3 (UI-SCM-14): the Launchpad ── */
export const launchpad = makeLaunchpad({
  gh: tauriGh(), git: tauriGitExtras(), root: () => B.gitRoot(), project: () => B.projectName(),
  remote: () => (graphRemote() ?? "origin"),
  human: { approve: (r) => requestApproval(r), text: (ph, verb, initial) => new Promise((res) => { B.palette(initial ?? "", { ph, verb, text: (q) => res(q) }); }), toast: (m) => B.toast(m) },
  audit: tauriScmAudit(), changed: async () => { await gitExtras.refreshSide(); },
  openTab: () => B.openTab({ id: "git-launchpad", title: "Launchpad", kind: "git-launchpad" }), say,
});
launchpad.subscribe(() => paint("git-launchpad"));
/** The remote the Launchpad fetches pull requests from: the current branch's, else origin (from the graph's refs). */
let graphRemote: () => string | null = () => null;
export const setRemoteSource = (f: () => string | null): void => { graphRemote = f; };

/* ── r23 F3: fetch, pull and push, approved and audited ── */
export const sync = makeSync({
  git: tauriSync(), root: () => B.gitRoot(), changed: () => B.reloadFromGit(), snapshot: (l) => undo.snapshot(l),
  human: { approve: (r) => requestApproval(r), toast: (m) => B.toast(m) },
  audit: tauriScmAudit(), say,
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
  "git-review": () => renderReview(t, gitExtras.state().review, codevAsk.available()),
  "git-launchpad": () => renderLaunchpad(t, launchpad.state()),
  "git-merge": () => renderMerge3(t, merge3.state(), codevAsk.available(), (p) => merge3.blocks(p)),
};
function paint(kind: string): void {
  const h = hosts[kind];
  if (!h || !h.isConnected) return;
  const a = document.activeElement;
  // never under the typing (a checkbox or a select is not typing)
  if (a && h.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && !["checkbox", "radio", "range"].includes((a as HTMLInputElement).type)))) return;
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
/* RF-E08: Co-Dev recorded change sets (a block applied, Auto's validation ended) */
changeSetsSignal.subscribe(() => { if (active()) void gitExtras.refreshChangeSets(); });

/** RF-E08: what the changed files of the editor look like (path and size) — when it changes (a
 *  Co-Dev block applied, a save, a discard, a commit), the change sets are asked again. Cheap, and
 *  it cannot loop: the answer repaints the pane with the same signature. */
const dirtySignature = (): string => {
  const r = B.rootKey(), fs = B.files();
  return Object.keys(fs).filter((k) => k.startsWith(r) && fs[k].content !== fs[k].orig).sort().map((k) => `${k}:${fs[k].content.length}`).join("|");
};
let csSig: string | null = null;

/** The Source Control pane's extra sections (empty outside the desktop with a repository). */
let sideAsked = false;
export function sideSections(): string {
  if (!active()) { sideAsked = false; csSig = null; return ""; }
  if (!sideAsked) { sideAsked = true; csSig = dirtySignature(); void gitExtras.refreshSide(); void undo.refresh(); }
  else { const sig = dirtySignature(); if (sig !== csSig) { csSig = sig; void gitExtras.refreshChangeSets(); } }
  return renderSide(t, gitExtras.state(), codevAsk.available(), Date.now()) + renderUndo(t, undo.entries(), undo.busy(), Math.floor(Date.now() / 1000));
}

/** Discarding a file from the pane: snapshot first on the desktop (the browser discards at once). */
export function discardWithUndo(fsKey: string, discard: (p: string) => void): void {
  if (!active()) { discard(fsKey); return; }
  void undo.snapshot(`discard ${relOf(fsKey) ?? fsKey}`).then(() => discard(fsKey));
}

/** The palette's git commands (app/commands.ts): outside the desktop with a repository they say why. */
const guard = (f: () => unknown) => (): void => { if (!active()) { B.toast(t("needRepo")); return; } void f(); };
export const GIT_COMMANDS: Array<[string, () => void]> = [
  ["Git: File History", guard(() => gitExtras.openHistory())],
  ["Git: Line History (selection)", guard(() => { const c = B.editorCursor(); return c ? gitExtras.openHistory(c.path, [c.start, c.end]) : gitExtras.openHistory(); })],
  ["Git: Compare Branches…", guard(() => gitExtras.openCompare())],
  ["Git: Interactive Rebase…", guard(() => gitExtras.openRebase())],
  ["Git: Undo Last Operation", guard(() => undo.undoLast())],
  ["Git: Resolve Merge Conflicts", guard(() => merge3.open())],
  ["Git: Launchpad (pull requests)", guard(() => launchpad.open())],
  ["Git: Fetch", guard(() => sync.run("fetch"))],
  ["Git: Pull", guard(() => sync.run("pull"))],
  ["Git: Push", guard(() => sync.run("push"))],
  ["Git: Stash Changes", guard(() => gitExtras.stashPush(false))],
  ["Git: Stash Including Untracked", guard(() => gitExtras.stashPush(true))],
  ["Git: New Worktree…", guard(() => gitExtras.worktreeAdd())],
  ["Git: Amend Last Commit…", guard(() => gitExtras.amend())],
  ["Co-Dev: Write Commit Message", guard(() => gitExtras.askCommitMessage())],
  ["Git: Review Changes (working tree)", guard(() => gitExtras.openReview("worktree"))],
  ["Git: Review Branch…", guard(() => gitExtras.openReview("branch"))],
  ["Co-Dev: Review Staged Changes", guard(() => gitExtras.askReviewStaged())],
];

const n = (s: string): number => Number(s) || 0;
export const GIT_ACTIONS: ActionTable = {
  "gx-merge-file": { on: "click", run: (e) => { void merge3.select(e.on); } },
  "gx-merge-draft": { on: "input", run: (e) => merge3.setDraft(e.on, e.value) },
  "gx-merge-take": { on: "click", run: (e) => { const [p, side] = e.on.split("|"); merge3.take(p, side as "ours" | "theirs" | "both"); } },
  "gx-merge-ask": { on: "click", run: (e) => merge3.askCodev(e.on) },
  "gx-merge-resolve": { on: "click", run: (e) => { void merge3.resolve(e.on); } },
  "gx-merge-complete": { on: "click", run: () => { void merge3.complete(); } },
  "gx-merge-abort": { on: "click", run: () => { void merge3.abort(); } },
  "gx-lp-open": { on: "click", run: (e) => openExternal(e.on, B.desktopOs()) },
  "gx-lp-refresh": { on: "click", run: () => { void launchpad.load(); } },
  "gx-lp-worktree": { on: "click", run: (e) => { void launchpad.checkoutWorktree(n(e.on)); } },
  "gx-launchpad": { on: "click", run: () => { void launchpad.open(); } },
  "gx-undo": { on: "click", run: (e) => { void undo.undo(n(e.on)); } },
  "scm-hunks": { on: "click", run: (e) => { void hunks.toggle(e.on); } },
  "scm-hunk": { on: "change", run: (e) => { const [path, id, op] = e.on.split("|"); void (op === "unstage" ? hunks.unstage(path, id) : hunks.stage(path, id)); } },
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
  "gx-review": { on: "click", run: () => { void gitExtras.openReview("worktree"); } },
  "gx-review-mode": { on: "click", run: (e) => { void gitExtras.openReview(e.on === "branch" ? "branch" : "worktree"); } },
  "gx-review-file": { on: "click", run: (e) => { void gitExtras.toggleReviewFile(e.on); } },
  "gx-review-mark": { on: "change", run: (e) => gitExtras.markReviewed(e.on, (e.el as HTMLInputElement).checked) },
  "gx-review-group": { on: "click", run: (e) => { void gitExtras.askReviewGroup(e.on); } },
  "gx-review-summary": { on: "click", run: () => gitExtras.askSummary() },
  /* RF-E08: a Co-Dev change set (data-on = the issue key, empty without one) and its files */
  "gx-cs-stage": { on: "click", run: (e) => gitExtras.stageSet(e.on) },
  "gx-cs-discard": { on: "click", run: (e) => { void gitExtras.discardSet(e.on); } },
  "gx-cs-open": { on: "click", run: (e) => B.openDiffRel(e.on) },
};
