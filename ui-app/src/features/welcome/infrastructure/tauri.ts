/* ═════════ feature `welcome` — adaptador Tauri (r23 F6) ═════════
   `git_clone_plan`/`git_clone` (commands/git.rs) e o `audit_record` (board.rs), pelos clientes partilhados de
   `platform/tauri/`. Não toca em `window`. */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import { gitClient } from "../../../platform/tauri/git";
import { auditClient } from "../../../platform/tauri/audit";
import type { AuditPort, GitPort } from "../application/ports";

export const tauriGit = (inv: Invoker = invoke): GitPort => ({
  clonePlan: (url, parent) => gitClient(inv).clonePlan(url, parent),
  clone: (url, parent) => gitClient(inv).clone(url, parent),
});

export const tauriAudit = (inv: Invoker = invoke): AuditPort => ({
  record: (root, e) => auditClient(inv).record(root, { feature: "welcome", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? e.outcome ?? "sent" : undefined }),
});
