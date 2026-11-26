/* ═══════════ feature `protect` — application: data protection in the IDE (r23 F4a, X02/X03) ═══════════
   - A folder opens: its `.env` secrets join what every LLM request is filtered for.
   - A request lost secrets (`protect://redacted`): the count shows in the status bar and the event
     goes to the audit log (who and when are the backend's).
   - A commit the secret scan blocked (`guard`): the findings in the shared approval dialog; going
     ahead needs a reason — audited before the override and with the result — and the commit runs
     again. Refused, the error says what was found, in words. Any other error passes as it was.
   - The pre-commit hook (`installHook`): the exact file and text in the shared dialog; the backend audits
     the install before writing it and never overwrites a hook that is not dxtutor's.
   No DOM, no window: ports only. */
import { findingLines, parseBlocked, type HookPlan } from "../domain/report";
import type { ProtectDeps } from "./ports";

export function makeProtect(deps: ProtectDeps) {
  let total = 0;
  const subs = new Set<() => void>();
  const emit = (): void => subs.forEach((f) => f());

  async function workspaceOpened(root: string): Promise<void> {
    total = await deps.protect.learn(root).catch(() => total);
    emit();
  }

  function redacted(origin: string, count: number, all: number): void {
    total = Math.max(total, all);
    emit();
    const root = deps.root();
    if (root && count > 0) {
      void deps.audit.record(root, { feature: "protect", action: "redact", command: `${count} secret(s) removed from a ${origin} request`, scope: origin, approved: true, outcome: "ok" }).catch(() => undefined);
    }
  }

  /** Runs `f` (a commit); if the secret scan blocked it, asks the human, and runs it again with a reason. */
  async function guard<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const report = parseBlocked(text);
      const root = deps.root();
      if (!report || !root) throw e;
      const lines = findingLines(report);
      const req = { title: deps.copy("blockedTitle", { n: report.findings.length }), command: lines.join("\n"), scope: deps.copy("blockedScope", { tool: report.tool, root }), destructive: true, reasonRequired: true };
      const d = await deps.approval.approve(req);
      const entry = { feature: "protect", action: "secret-scan.override", command: lines.join(" · "), scope: report.tool, decidedAt: d.decidedAt };
      if (!d.approved) {
        await deps.audit.record(root, { ...entry, approved: false }).catch(() => undefined);
        /* the readable refusal keeps the backend's error as its cause (ES2020: no `Error(msg, { cause })`) */
        throw Object.assign(new Error(deps.copy("refused", { list: lines.slice(0, 3).join(", ") })), { cause: e });
      }
      /* the override is audited before it is granted: without the audit, it is not */
      await deps.audit.record(root, { ...entry, approved: true, reason: d.reason, outcome: "sent" });
      await deps.protect.allow(root, d.reason);
      try {
        const out = await f();
        await deps.audit.record(root, { ...entry, approved: true, reason: d.reason, outcome: "ok" }).catch(() => undefined);
        return out;
      } catch (e2) {
        await deps.audit.record(root, { ...entry, approved: true, reason: d.reason, outcome: "failed" }).catch(() => undefined);
        throw e2;
      }
    }
  }

  /** The pre-commit hook in the open repository: shown in the shared dialog with the exact file and text,
   *  installed only when approved; the backend audits it before writing, and the result is audited too. */
  async function installHook(): Promise<void> {
    const root = deps.root();
    if (!root) { deps.toast(deps.copy("hookNoFolder")); return; }
    let plan: HookPlan;
    try { plan = await deps.protect.hookPlan(root); } catch (e) { deps.toast(deps.copy("hookFailed", { error: e instanceof Error ? e.message : String(e) })); return; }
    if (plan.state === "installed") { deps.toast(deps.copy("hookAlready", { path: plan.path })); return; }
    if (plan.state === "foreign") { deps.toast(deps.copy("hookForeign", { path: plan.path })); return; }
    const command = `write ${plan.path} (chmod 755)\n\n${plan.content}`;
    const d = await deps.approval.approve({ title: deps.copy("hookTitle"), command, scope: root });
    const entry = { feature: "protect", action: "hook.install", command: `write ${plan.path}`, scope: root, decidedAt: d.decidedAt };
    if (!d.approved) {
      await deps.audit.record(root, { ...entry, approved: false }).catch(() => undefined);
      deps.toast(deps.copy("hookDeclined"));
      return;
    }
    try {
      const done = await deps.protect.hookInstall(root);
      await deps.audit.record(root, { ...entry, approved: true, outcome: "ok" }).catch(() => undefined);
      deps.toast(deps.copy("hookInstalled", { path: done.path }));
    } catch (e) {
      await deps.audit.record(root, { ...entry, approved: true, outcome: "failed" }).catch(() => undefined);
      deps.toast(deps.copy("hookFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return {
    workspaceOpened, redacted, guard, installHook,
    total: (): number => total,
    subscribe(f: () => void): () => void { subs.add(f); return () => subs.delete(f); },
  };
}

export type Protect = ReturnType<typeof makeProtect>;
