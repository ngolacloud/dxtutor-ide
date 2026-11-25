/* ═══════════ feature `scm` — application: the Commit Composer (r23 F3, UI-SCM-14) ═══════════
   The working tree's changes as commit drafts the person shapes: messages (Conventional Commits), files moved
   between drafts or left out, Co-Dev asked for a grouping (a proposal in the composer, nothing applied), then
   the drafts committed in order — each one only its files (`git_commit_paths`), after an undo snapshot. With
   lanes on (experimental, off by default), a draft can go to another branch without a checkout
   (`git_lane_commit`). Local and undoable, so no approval dialog. No DOM, no window. */

import { draftProblem, draftsFrom, moveFile, type Draft } from "../domain/composer";
import { diffStat, type ReviewFile } from "../domain/review";
import type { GitExtrasPort } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface CommitPathsPort {
  commitPaths(root: string, paths: string[], message: string): Promise<string>;
  laneCommit(root: string, branch: string, paths: string[], message: string): Promise<string>;
}

export interface ComposerState { files: ReviewFile[]; drafts: Draft[]; excluded: string[]; loading: boolean; busy: boolean; error: string | null; done: string[] }

export function makeComposer(deps: {
  git: Pick<GitExtrasPort, "changes" | "worktreeDiff">; commits: CommitPathsPort; root: () => string | null;
  snapshot: (label: string) => Promise<void>; changed: () => Promise<void>; lanesOn: () => boolean; openTab: () => void;
  codev: { available(): boolean; ask(r: { intent: "chat"; text: string; context: Array<{ kind: "file"; label: string; text: string }>; send?: boolean }): void };
  toast: (m: string) => void; say: Say;
}) {
  const { git, commits, root, snapshot, changed, lanesOn, openTab, codev, toast, say } = deps;
  let st: ComposerState = { files: [], drafts: [], excluded: [], loading: false, busy: false, error: null, done: [] };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function load(): Promise<void> {
    const r = root();
    if (!r || st.loading) return;
    st = { ...st, loading: true, error: null }; emit();
    try {
      const ch = (await git.changes(r)).slice(0, 200);
      const files: ReviewFile[] = await Promise.all(ch.map(async (c) => ({ path: c.path, status: c.status, ...diffStat(await git.worktreeDiff(r, c.path).catch(() => "")) })));
      st = { files, drafts: draftsFrom(files), excluded: [], loading: false, busy: false, error: null, done: [] };
    } catch (e) { st = { ...st, loading: false, error: msg(e) }; }
    emit();
  }

  return {
    state: (): ComposerState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    open: async (): Promise<void> => { openTab(); await load(); },
    load,
    setMessage: (id: string, m: string): void => { const d = st.drafts.find((x) => x.id === id); if (d) d.message = m; },
    setLane: (id: string, lane: string | null): void => { const d = st.drafts.find((x) => x.id === id); if (d && lanesOn()) { d.lane = lane || null; emit(); } },
    move: (path: string, to: string): void => { st = { ...st, drafts: moveFile(st.drafts, path, to) }; emit(); },
    toggle: (path: string): void => { st = { ...st, excluded: st.excluded.includes(path) ? st.excluded.filter((p) => p !== path) : [...st.excluded, path] }; emit(); },
    problem: (d: Draft) => draftProblem(d, st.excluded),
    askCodev: (): void => {
      if (!codev.available() || !st.files.length) return;
      const list = st.files.map((f) => `${f.status} ${f.path} +${f.added} -${f.removed}`).join("\n");
      codev.ask({ intent: "chat", text: say("composerAsk"), context: [{ kind: "file", label: say("composerFilesLabel", { n: st.files.length }), text: list }], send: false });
    },
    commitAll: async (): Promise<number> => {
      const r = root();
      if (!r || st.busy) return 0;
      const ready = st.drafts.filter((d) => !draftProblem(d, st.excluded));
      if (!ready.length) { toast(say("composerNothing")); return 0; }
      st = { ...st, busy: true, error: null }; emit();
      let n = 0;
      try {
        for (const d of ready) {
          const paths = d.files.filter((f) => !st.excluded.includes(f));
          await snapshot(`commit: ${d.message.trim()}`);
          if (d.lane && lanesOn()) await commits.laneCommit(r, d.lane, paths, d.message.trim());
          else await commits.commitPaths(r, paths, d.message.trim());
          st.done.push(d.message.trim()); n++;
        }
      } catch (e) { st.error = msg(e); }
      st.busy = false;
      await changed();
      if (!st.error) { toast(say("composerDone", { n })); await load(); } else emit();
      return n;
    },
  };
}

export type Composer = ReturnType<typeof makeComposer>;
