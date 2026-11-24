/* ═══════════ feature scm — application: the A4 git work (docs/v2/UI-AUDIT.md item 9) ═══════════
   State and use cases over the real git (ports in extras-ports.ts): the blame of each file (for
   the line annotation and the status bar), a file's or a line range's history with each
   commit's diff, who knows the code, comparing two refs, stashes, worktrees, amend, an
   interactive rebase from a plan the human edits and approves, and the Co-Dev requests
   (explain a commit, write the commit message, review what is staged). No DOM, no window.

   Rules: every change to the repository asks first with the exact git command, saves the
   editor before and reloads the files and the graph after; git's own message is shown on
   failure; a newer request for a view wins over an older answer still on its way. */

import { blameAt, initialSteps, moveStep, planIsNoop, planProblem, rebaseCommand, worktreePath } from "../domain/git-extras";
import type { Blame, BlameLine, Compare, HistCommit, RebaseAction, RebasePlan, RebaseStep, Stash, Worktree } from "../domain/git-extras";
import type { CodevPort, GitExtrasPort, GitWorkspacePort, HumanPort, TabsPort } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export interface HistoryState {
  path: string;
  range: [number, number] | null;
  commits: HistCommit[];
  loading: boolean;
  error: string;
  selected: string | null;
  diff: string;
  diffLoading: boolean;
  blame: Blame | null;
}

export interface CompareState {
  base: string;
  target: string;
  result: Compare | null;
  loading: boolean;
  error: string;
}

export interface RebaseState {
  onto: string;
  plan: RebasePlan | null;
  steps: RebaseStep[];
  loading: boolean;
  running: boolean;
  error: string;
}

export interface ExtrasState {
  stashes: Stash[];
  worktrees: Worktree[];
  sideLoaded: boolean;
  sideError: string;
  history: HistoryState | null;
  compare: CompareState | null;
  rebase: RebaseState | null;
  /** a text to read in the «git» tab (a stash's diff…) */
  text: { title: string; body: string } | null;
  /** the operation running (one at a time) */
  busy: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeGitExtras(deps: { git: GitExtrasPort; ws: GitWorkspacePort; human: HumanPort; codev: CodevPort; tabs: TabsPort; say: Say }) {
  const { git, ws, human, codev, tabs, say } = deps;
  const st: ExtrasState = { stashes: [], worktrees: [], sideLoaded: false, sideError: "", history: null, compare: null, rebase: null, text: null, busy: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  /* ── blame cache (the editor's line annotation and the status bar) ── */
  const blames = new Map<string, Blame | "loading" | "none">();
  const blameSubs = new Set<(path: string) => void>();
  function blameOf(path: string): Blame | null {
    const root = ws.root();
    if (!root) return null;
    const b = blames.get(path);
    if (b === undefined) {
      blames.set(path, "loading");
      git.blame(root, path).then(
        (r) => { if (ws.root() === root) { blames.set(path, r); blameSubs.forEach((f) => f(path)); } },
        () => { if (ws.root() === root) blames.set(path, "none"); }, // a new file, outside git…: no annotation
      );
      return null;
    }
    return typeof b === "string" ? null : b;
  }
  /** the files changed on disk or in git: their blame is stale */
  function invalidate(paths?: string[]): void {
    if (!paths) blames.clear();
    else paths.forEach((p) => blames.delete(p));
  }

  /** Runs one change to the repository: save, run, reload, refresh; git's message on failure. */
  async function change<T>(label: string, run: (root: string) => Promise<T>): Promise<T | null> {
    const root = ws.root();
    if (!root || st.busy) return null;
    st.busy = label; emit();
    try {
      await ws.save();
      const r = await run(root);
      return r;
    } catch (e) {
      human.toast(msg(e));
      return null;
    } finally {
      st.busy = null;
      invalidate();
      await ws.changed().catch(() => undefined);
      await refreshSide();
    }
  }

  async function refreshSide(): Promise<void> {
    const root = ws.root();
    if (!root) return;
    try {
      const [s, w] = await Promise.all([git.stash(root, { op: "list" }), git.worktree(root, { op: "list" })]);
      if (ws.root() !== root) return;
      st.stashes = s.stashes; st.worktrees = w; st.sideError = "";
    } catch (e) {
      st.sideError = msg(e);
    }
    st.sideLoaded = true;
    emit();
  }

  /* ── stashes ── */
  async function stashPush(untracked: boolean): Promise<void> {
    const m = await human.text(say("stashPh"), say("stashVerb"), `WIP on ${ws.current()}`);
    if (m === null) return;
    const r = await change("stash", (root) => git.stash(root, { op: "push", message: m, untracked }));
    if (r) human.toast(say("stashed"));
  }
  async function stashApply(index: number, pop: boolean): Promise<void> {
    const r = await change("stash", (root) => git.stash(root, { op: "apply", index, pop }));
    if (r) human.toast(say(pop ? "stashPopped" : "stashApplied"));
  }
  async function stashDrop(index: number): Promise<void> {
    const s = st.stashes.find((x) => x.index === index);
    if (!s || !human.confirm(say("confirmCmd", { what: say("stashDropWhat", { m: s.message }), cmd: `git stash drop stash@{${index}}` }))) return;
    await change("stash", (root) => git.stash(root, { op: "drop", index }));
  }
  async function stashShow(index: number): Promise<void> {
    const root = ws.root();
    if (!root) return;
    try {
      const r = await git.stash(root, { op: "show", index });
      const s = st.stashes.find((x) => x.index === index);
      st.text = { title: `stash@{${index}}${s ? " · " + s.message : ""}`, body: r.output || say("emptyDiff") };
      tabs.open("git-text", "stash", "git-text");
      emit();
    } catch (e) { human.toast(msg(e)); }
  }

  /* ── worktrees ── */
  async function worktreeAdd(): Promise<void> {
    const NEW = "\u0000new";
    const items = [{ label: say("newBranch"), detail: say("newBranchFromHere", { b: ws.current() }), value: NEW }, ...ws.branches().filter((b) => !st.worktrees.some((w) => w.branch === b)).map((b) => ({ label: b, value: b }))];
    const pick = await human.pick(say("worktreeBranchPh"), items);
    if (pick === null) return;
    let branch = pick, create = false;
    if (pick === NEW) {
      const b = await human.text(say("newBranchPh"), say("create"));
      if (!b || !b.trim()) return;
      branch = b.trim(); create = true;
    }
    const path = await human.text(say("worktreePathPh"), say("create"), worktreePath(ws.project(), branch));
    if (!path || !path.trim()) return;
    const cmd = create ? `git worktree add -b ${branch} ${path.trim()}` : `git worktree add ${path.trim()} ${branch}`;
    if (!human.confirm(say("confirmCmd", { what: say("worktreeAddWhat"), cmd }))) return;
    const r = await change("worktree", (root) => git.worktree(root, { op: "add", path: path.trim(), branch, create }));
    if (r) human.toast(say("worktreeReady", { path: path.trim() }));
  }
  async function worktreeRemove(path: string): Promise<void> {
    if (!human.confirm(say("confirmCmd", { what: say("worktreeRemoveWhat"), cmd: `git worktree remove ${path}` }))) return;
    await change("worktree", (root) => git.worktree(root, { op: "remove", path }));
  }

  /* ── amend ── */
  async function amend(): Promise<void> {
    const typed = ws.commitMessage().trim();
    const m = await human.text(say("amendPh"), say("amendVerb"), typed);
    if (m === null) return;
    const cmd = m.trim() ? `git commit --amend -m "${m.trim().split("\n")[0]}"` : "git commit --amend --no-edit";
    if (!human.confirm(say("confirmCmd", { what: say("amendWhat"), cmd }))) return;
    const root = ws.root();
    if (!root || st.busy) return;
    st.busy = "amend"; emit();
    let r: string | null = null;
    try {
      await ws.save();
      try {
        r = await git.amend(root, m.trim() || null, false);
      } catch (e) {
        const text = msg(e);
        if (!text.startsWith("published:")) throw e;
        if (human.confirm(say("amendPublished", { why: text.slice("published:".length).trim() }))) r = await git.amend(root, m.trim() || null, true);
      }
    } catch (e) {
      human.toast(msg(e));
    } finally {
      st.busy = null;
      invalidate();
      await ws.changed().catch(() => undefined);
      emit();
    }
    if (r) human.toast(say("amended", { h: r }));
  }

  /* ── history ── */
  let histSeq = 0;
  async function openHistory(path?: string, range?: [number, number] | null): Promise<void> {
    const root = ws.root();
    const cur = ws.cursor();
    const p = path ?? cur?.path;
    if (!root || !p) { human.toast(say("noFile")); return; }
    const r = range === undefined ? null : range;
    const seq = ++histSeq;
    st.history = { path: p, range: r, commits: [], loading: true, error: "", selected: null, diff: "", diffLoading: false, blame: null };
    tabs.open("git-history", say("historyTab", { f: p.split("/").pop() ?? p }), "git-history");
    emit();
    try {
      const [commits, blame] = await Promise.all([git.history(root, p, r ? r[0] : null, r ? r[1] : null), git.blame(root, p).catch(() => null)]);
      if (seq !== histSeq || !st.history) return;
      st.history.commits = commits; st.history.blame = blame; st.history.loading = false;
      if (commits[0]) void selectCommit(commits[0].hash);
    } catch (e) {
      if (seq !== histSeq || !st.history) return;
      st.history.error = msg(e); st.history.loading = false;
    }
    emit();
  }
  async function selectCommit(hash: string): Promise<void> {
    const root = ws.root(), h = st.history;
    if (!root || !h) return;
    h.selected = hash; h.diffLoading = true; emit();
    try {
      const d = await git.showPath(root, hash, h.path);
      if (st.history === h && h.selected === hash) h.diff = d;
    } catch (e) {
      if (st.history === h) h.diff = msg(e);
    }
    if (st.history === h) { h.diffLoading = false; emit(); }
  }
  async function explainCommit(hash: string): Promise<void> {
    const root = ws.root();
    if (!root || !codev.available()) return;
    try {
      const text = await git.show(root, hash);
      codev.ask({ intent: "explain", text: say("askExplainCommit"), context: [{ kind: "hunk", label: hash.slice(0, 8), text: text.slice(0, 16000) }], send: true });
    } catch (e) { human.toast(msg(e)); }
  }

  /* ── compare ── */
  async function openCompare(): Promise<void> {
    const bs = ws.branches();
    const cur = ws.current();
    const base = await human.pick(say("compareBasePh"), bs.map((b) => ({ label: b, detail: b === cur ? say("currentBranch") : undefined, value: b })));
    if (base === null) return;
    const target = await human.pick(say("compareTargetPh", { b: base }), bs.filter((b) => b !== base).map((b) => ({ label: b, detail: b === cur ? say("currentBranch") : undefined, value: b })));
    if (target === null) return;
    await compare(base, target);
  }
  async function compare(base: string, target: string): Promise<void> {
    const root = ws.root();
    if (!root) return;
    const c: CompareState = { base, target, result: null, loading: true, error: "" };
    st.compare = c;
    tabs.open("git-compare", say("compareTab"), "git-compare");
    emit();
    try { const r = await git.compare(root, base, target); if (st.compare === c) c.result = r; } catch (e) { if (st.compare === c) c.error = msg(e); }
    if (st.compare === c) { c.loading = false; emit(); }
  }

  /* ── interactive rebase ── */
  async function openRebase(): Promise<void> {
    const cur = ws.current();
    const bs = ws.branches().filter((b) => b !== cur);
    const pref = ["develop", "main", "master"].filter((b) => bs.includes(b));
    const ordered = [...pref, ...bs.filter((b) => !pref.includes(b))];
    const onto = await human.pick(say("rebaseOntoPh", { b: cur }), [...ordered.map((b) => ({ label: b, value: b })), { label: "HEAD~5", detail: say("lastFive"), value: "HEAD~5" }]);
    if (onto === null) return;
    await planRebase(onto);
  }
  async function planRebase(onto: string): Promise<void> {
    const root = ws.root();
    if (!root) return;
    const r: RebaseState = { onto, plan: null, steps: [], loading: true, running: false, error: "" };
    st.rebase = r;
    tabs.open("git-rebase", say("rebaseTab"), "git-rebase");
    emit();
    try { const p = await git.rebase(root, { op: "plan", onto }); if (st.rebase === r) { r.plan = p; r.steps = initialSteps(p); } } catch (e) { if (st.rebase === r) r.error = msg(e); }
    if (st.rebase === r) { r.loading = false; emit(); }
  }
  const editPlan = (f: (s: RebaseStep[]) => RebaseStep[]): void => { if (st.rebase && !st.rebase.running) { st.rebase.steps = f(st.rebase.steps); emit(); } };
  async function runRebase(): Promise<void> {
    const r = st.rebase;
    if (!r || !r.plan || r.running) return;
    const prob = planProblem(r.steps);
    if (prob) { human.toast(say("plan-" + prob)); return; }
    if (planIsNoop(r.plan, r.steps)) { human.toast(say("planNoop")); return; }
    if (r.plan.dirty) { human.toast(say("rebaseDirty")); return; }
    const warn = r.plan.published ? "\n\n" + say("rebasePublished") : "";
    if (!human.confirm(say("confirmCmd", { what: say("rebaseWhat", { b: r.plan.branch }), cmd: rebaseCommand(r.onto, r.steps) }) + warn)) return;
    r.running = true; r.error = ""; emit();
    const after = await change("rebase", (root) => git.rebase(root, { op: "run", onto: r.onto, steps: r.steps }));
    r.running = false;
    if (after && st.rebase === r) { r.plan = after; r.steps = initialSteps(after); human.toast(say("rebaseDone", { n: after.commits.length })); }
    emit();
  }

  /* ── Co-Dev and what is staged ── */
  async function stagedOr(): Promise<{ root: string; diff: string } | null> {
    const root = ws.root();
    if (!root || !codev.available()) return null;
    await ws.save();
    const diff = await git.stagedDiff(root).catch(() => "");
    if (!diff.trim()) { human.toast(say("nothingStaged")); return null; }
    return { root, diff };
  }
  async function askCommitMessage(): Promise<void> {
    const s = await stagedOr();
    if (s) codev.ask({ intent: "explain", text: say("askCommitMessage"), context: [{ kind: "hunk", label: "staged", text: s.diff.slice(0, 16000) }], send: true });
  }
  async function askReviewStaged(): Promise<void> {
    const s = await stagedOr();
    if (s) codev.ask({ intent: "review", text: say("askReviewStaged"), context: [{ kind: "hunk", label: "staged", text: s.diff.slice(0, 16000) }], send: true });
  }

  /** The editor's line: what the blame says (status bar, inline annotation). */
  const lineBlame = (path: string, line: number): BlameLine | null => blameAt(blameOf(path), line);

  return {
    state: (): ExtrasState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    onBlame: (f: (path: string) => void) => { blameSubs.add(f); return () => { blameSubs.delete(f); }; },
    lineBlame,
    invalidate,
    refreshSide,
    stashPush, stashApply, stashDrop, stashShow,
    worktreeAdd, worktreeRemove,
    amend,
    openHistory, selectCommit, explainCommit,
    openCompare, compare,
    openRebase, planRebase, runRebase,
    setAction: (i: number, a: RebaseAction) => editPlan((s) => s.map((x, j) => (j === i ? { ...x, action: a } : x))),
    setMessage: (i: number, m: string) => { if (st.rebase && !st.rebase.running) st.rebase.steps = st.rebase.steps.map((x, j) => (j === i ? { ...x, message: m } : x)); },
    move: (i: number, dir: -1 | 1) => editPlan((s) => moveStep(s, i, dir)),
    resetPlan: () => { if (st.rebase?.plan) editPlan(() => initialSteps(st.rebase!.plan!)); },
    askCommitMessage, askReviewStaged,
    busy: (): boolean => st.busy !== null,
  };
}

export type GitExtras = ReturnType<typeof makeGitExtras>;
