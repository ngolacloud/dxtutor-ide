/* ═══════════ feature `scm` — application: the Launchpad (r23 F3, UI-SCM-14) ═══════════
   The open pull requests that need the person — review requested, theirs — read from `gh` (read-only), ordered
   by severity; without `gh` (or signed out) it says so and lists nothing. «Checkout into a worktree» asks the
   shared approval dialog with the exact two commands, is audited, and adds the worktree. No DOM, no window. */

import { prWorktreeCommands, prWorktreePath, sortPrs, type Pr } from "../domain/launchpad";
import type { ApprovalDecision, ApprovalRequest, GhPort, GhStatusData, GitExtrasPort, ScmAuditPort } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface LaunchpadState { status: GhStatusData | null; review: Pr[] | null; mine: Pr[] | null; loading: boolean; error: string | null }

export function makeLaunchpad(deps: {
  gh: GhPort; git: Pick<GitExtrasPort, "worktree">; root: () => string | null; project: () => string; remote: () => string;
  human: { approve(r: ApprovalRequest): Promise<ApprovalDecision>; text(ph: string, verb: string, initial?: string): Promise<string | null>; toast(m: string): void };
  audit: ScmAuditPort; changed: () => Promise<void>; openTab: () => void; say: Say;
}) {
  const { gh, git, root, project, remote, human, audit, changed, openTab, say } = deps;
  const st: LaunchpadState = { status: null, review: null, mine: null, loading: false, error: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function load(): Promise<void> {
    const r = root();
    if (!r || st.loading) return;
    st.loading = true; st.error = null; emit();
    try {
      st.status = await gh.status();
      if (st.status.installed && st.status.signedIn) {
        const [review, mine] = await Promise.all([gh.prs(r, "review"), gh.prs(r, "mine")]);
        st.review = sortPrs(review); st.mine = sortPrs(mine);
      } else { st.review = null; st.mine = null; }
    } catch (e) { st.error = msg(e); }
    st.loading = false; emit();
  }

  return {
    state: (): LaunchpadState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    open: async (): Promise<void> => { openTab(); await load(); },
    load,
    checkoutWorktree: async (n: number): Promise<boolean> => {
      const r = root();
      if (!r) return false;
      const path = await human.text(say("lpWorktreePh", { n }), say("create"), prWorktreePath(project(), n));
      if (!path || !path.trim()) return false;
      const rem = remote(), command = prWorktreeCommands(n, path.trim(), rem);
      const d = await human.approve({ title: say("lpWorktreeTitle", { n }), command, scope: say("lpWorktreeScope", { r: rem }) });
      const row = { action: "git.worktree.pr", command, scope: rem, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
      if (!d.approved) { void audit.record(r, row).catch(() => undefined); return false; }
      try { await audit.record(r, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return false; }
      try {
        await git.worktree(r, { op: "add_pr", number: n, path: path.trim(), remote: rem });
        void audit.record(r, { ...row, outcome: "ok" }).catch(() => undefined);
        human.toast(say("worktreeReady", { path: path.trim() }));
        await changed();
        return true;
      } catch (e) {
        void audit.record(r, { ...row, outcome: "failed" }).catch(() => undefined);
        human.toast(msg(e));
        return false;
      }
    },
  };
}

export type Launchpad = ReturnType<typeof makeLaunchpad>;
