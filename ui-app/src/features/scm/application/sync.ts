/* ═══════════ feature `scm` — application: fetch, pull and push (r23 F3) ═══════════
   The backend builds the exact command (never --force); the shared approval dialog shows it with the branch,
   its upstream and how far ahead/behind it is; it is audited before it runs (not auditable: not run) and with
   its result; the backend runs it only if the command is still the approved one. A pull takes an undo snapshot
   first. No DOM, no window. */

import type { ApprovalDecision, ApprovalRequest, ScmAuditPort, SyncOp, SyncPort } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeSync(deps: {
  git: SyncPort; root: () => string | null; changed: () => Promise<void>; snapshot: (label: string) => Promise<void>;
  human: { approve(r: ApprovalRequest): Promise<ApprovalDecision>; toast(m: string): void };
  audit: ScmAuditPort; say: Say;
}) {
  const { git, root, changed, snapshot, human, audit, say } = deps;
  let busy: SyncOp | null = null;
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function run(op: SyncOp): Promise<boolean> {
    const r = root();
    if (!r || busy) return false;
    let plan;
    try { plan = await git.plan(r, op); } catch (e) { human.toast(msg(e)); return false; }
    const where = plan.upstream ? say("syncScope", { b: plan.branch ?? "HEAD", u: plan.upstream, a: plan.ahead, n: plan.behind }) : say("syncScopeNew", { b: plan.branch ?? "HEAD", r: plan.remote ?? "" });
    const d = await human.approve({ title: say(`sync-${op}`), command: plan.display, scope: where });
    const row = { action: `git.${op}`, command: plan.display, scope: where, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(r, row).catch(() => undefined); return false; }
    try { await audit.record(r, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return false; }
    busy = op; emit();
    try {
      if (op === "pull") await snapshot(`pull ${plan.upstream ?? ""}`.trim());
      const out = await git.run(r, op, plan.display);
      void audit.record(r, { ...row, outcome: "ok" }).catch(() => undefined);
      human.toast(say("syncDone", { cmd: plan.display, out: out.split("\n").filter(Boolean).slice(-1)[0] ?? "" }));
      return true;
    } catch (e) {
      void audit.record(r, { ...row, outcome: "failed" }).catch(() => undefined);
      human.toast(say("syncFailed", { e: msg(e) }));
      return false;
    } finally {
      busy = null; emit();
      await changed();
    }
  }

  return { busy: (): SyncOp | null => busy, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; }, run };
}

export type Sync = ReturnType<typeof makeSync>;
