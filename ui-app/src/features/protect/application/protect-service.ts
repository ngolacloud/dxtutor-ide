/* ═══════════ feature `protect` — application: data protection in the IDE (r23 F4a, X02/X03) ═══════════
   - A folder opens: its `.env` secrets join what every LLM request is filtered for.
   - A request lost secrets (`protect://redacted`): the count shows in the status bar and the event
     goes to the audit log (who and when are the backend's).
   - A commit the secret scan blocked (`guard`): the findings in the shared approval dialog; going
     ahead needs a reason — audited before the override and with the result — and the commit runs
     again. Refused, the error says what was found, in words. Any other error passes as it was.
   No DOM, no window: ports only. */
import { findingLines, parseBlocked } from "../domain/report";
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

  return {
    workspaceOpened, redacted, guard,
    total: (): number => total,
    subscribe(f: () => void): () => void { subs.add(f); return () => subs.delete(f); },
  };
}

export type Protect = ReturnType<typeof makeProtect>;
