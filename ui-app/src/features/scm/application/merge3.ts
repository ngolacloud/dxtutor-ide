/* ═══════════ feature `scm` — application: the three-way merge (r23 F3, UI-SCM-13) ═══════════
   A merge that conflicts stays in progress and opens here: the conflicted files; for the selected one, base,
   ours and theirs, and the result to edit (taking one side or both for every block, or by hand). Co-Dev can be
   asked for a resolution (a proposal: it lands in the composer, nothing is written). «Resolve» writes and stages
   the result (refused while markers are left). «Complete» runs the project's check and, only when it passes,
   commits — after the shared approval dialog, audited. «Abort» is approved and audited too. No DOM, no window. */

import { blockCount, hasMarkers, takeSide, type Side } from "../domain/conflicts";
import type { ConflictStagesData, MergePort, MergeStateData, ScmAuditPort, ApprovalRequest, ApprovalDecision } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
export interface CheckResult { cmd: string | null; ok: boolean; summary: string }

export interface Merge3State {
  merge: MergeStateData | null;
  /** files of the merge seen as conflicted (resolved ones stay listed, ticked) */
  files: string[];
  selected: string | null;
  stages: Record<string, ConflictStagesData>;
  draft: Record<string, string>;
  check: CheckResult | null;
  busy: string | null;
  error: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeMerge3(deps: {
  git: MergePort; root: () => string | null; changed: () => Promise<void>; openTab: () => void;
  check: () => Promise<CheckResult>;
  human: { approve(r: ApprovalRequest): Promise<ApprovalDecision>; toast(m: string): void };
  audit: ScmAuditPort;
  codev: { available(): boolean; ask(r: { intent: "change"; text: string; context: Array<{ kind: "file"; label: string; text: string; path?: string }>; send?: boolean }): void };
  say: Say;
}) {
  const { git, root, changed, openTab, check, human, audit, codev, say } = deps;
  const st: Merge3State = { merge: null, files: [], selected: null, stages: {}, draft: {}, check: null, busy: null, error: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function status(): Promise<void> {
    const r = root();
    if (!r) return;
    try {
      st.merge = await git.merge(r, { op: "status" });
      for (const f of st.merge.conflicts) if (!st.files.includes(f)) st.files.push(f);
      if (!st.merge.merging) { st.files = []; st.selected = null; st.stages = {}; st.draft = {}; st.check = null; }
      st.error = null;
    } catch (e) { st.error = msg(e); }
    emit();
  }

  async function select(path: string): Promise<void> {
    const r = root();
    if (!r) return;
    st.selected = path; emit();
    try {
      const s = await git.stages(r, path);
      st.stages[path] = s;
      if (!(path in st.draft)) st.draft[path] = s.working ?? s.ours ?? "";
    } catch (e) { st.error = msg(e); }
    emit();
  }

  /** Approval + audit; resolves with `done(ok)` or null (refused / not auditable: nothing runs). */
  async function approved(action: string, title: string, command: string, scope: string, destructive = false): Promise<((ok: boolean) => void) | null> {
    const r = root();
    if (!r) return null;
    const d = await human.approve({ title, command, scope, destructive });
    const row = { action, command, scope, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(r, row).catch(() => undefined); return null; }
    try { await audit.record(r, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return null; }
    return (ok) => { void audit.record(r, { ...row, outcome: ok ? "ok" : "failed" }).catch(() => undefined); };
  }

  return {
    state: (): Merge3State => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    /** a merge stopped on conflicts (or the palette asked): read where it stands and open the tab */
    open: async (): Promise<void> => { await status(); if (st.merge?.merging) { openTab(); if (!st.selected && st.files[0]) await select(st.files[0]); } else human.toast(say("mergeNone")); },
    status, select,
    setDraft: (path: string, text: string): void => { st.draft[path] = text; },
    take: (path: string, side: Side): void => {
      const s = st.stages[path];
      const base = st.draft[path] ?? s?.working ?? "";
      st.draft[path] = hasMarkers(base) ? takeSide(base, side) : side === "ours" ? s?.ours ?? base : side === "theirs" ? s?.theirs ?? base : base;
      emit();
    },
    blocks: (path: string): number => blockCount(st.draft[path] ?? ""),
    resolve: async (path: string): Promise<void> => {
      const r = root(), text = st.draft[path];
      if (!r || text === undefined || st.busy) return;
      if (hasMarkers(text)) { human.toast(say("mergeMarkersLeft", { n: blockCount(text) })); return; }
      st.busy = "resolve"; emit();
      try { st.merge = await git.merge(r, { op: "resolve", path, content: text }); st.error = null; } catch (e) { st.error = msg(e); }
      st.busy = null;
      await status();
      const next = st.files.find((f) => st.merge?.conflicts.includes(f));
      if (next) await select(next);
    },
    askCodev: (path: string): void => {
      const s = st.stages[path];
      if (!s || !codev.available()) return;
      const part = (k: string, v: string | null) => `--- ${k}\n${v ?? "(absent)"}`;
      codev.ask({ intent: "change", text: say("mergeAsk", { path }), context: [{ kind: "file", label: `${path} (merge)`, text: [part("base", s.base), part("ours (HEAD)", s.ours), part("theirs", s.theirs)].join("\n"), path }], send: false });
    },
    complete: async (): Promise<boolean> => {
      const r = root();
      if (!r || st.busy || !st.merge?.merging) return false;
      if (st.merge.conflicts.length) { human.toast(say("mergeStillUnmerged", { files: st.merge.conflicts.join(", ") })); return false; }
      st.busy = "check"; emit();
      const c = await check().catch((e): CheckResult => ({ cmd: null, ok: false, summary: msg(e) }));
      st.check = c; st.busy = null; emit();
      if (c.cmd && !c.ok) { human.toast(say("mergeCheckFailed", { cmd: c.cmd, sum: c.summary })); return false; }
      const scope = c.cmd ? say("mergeCheckOk", { cmd: c.cmd, sum: c.summary }) : say("mergeNoCheck");
      const done = await approved("git.merge.commit", st.merge.message || say("mergeCommitTitle"), "git commit --no-edit", scope);
      if (!done) return false;
      st.busy = "commit"; emit();
      try { st.merge = await git.merge(r, { op: "commit" }); done(true); human.toast(say("mergeDone")); }
      catch (e) { done(false); st.error = msg(e); }
      st.busy = null;
      await changed();
      await status();
      return !st.merge?.merging;
    },
    abort: async (): Promise<void> => {
      const r = root();
      if (!r || st.busy || !st.merge?.merging) return;
      const done = await approved("git.merge.abort", say("mergeAbortTitle"), "git merge --abort", st.merge.message, true);
      if (!done) return;
      try { await git.merge(r, { op: "abort" }); done(true); } catch (e) { done(false); st.error = msg(e); }
      await changed();
      await status();
    },
  };
}

export type Merge3 = ReturnType<typeof makeMerge3>;
