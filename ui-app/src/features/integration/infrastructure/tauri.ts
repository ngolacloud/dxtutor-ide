/* ═════════ feature `integration` — adaptador: a revisão Co-Dev e a porta de integração no backend ═════════
   A porta `ReviewGateway` sobre o cliente tipado `platform/tauri/codev-review`; as respostas estreitam-se no
   domínio (`domain/types.ts`) e uma resposta que não se lê é um erro (nunca uma porta aberta). Não toca no
   `window` (regra A8). */

import * as ipc from "../../../platform/tauri/codev-review";
import * as auto from "../../../platform/tauri/codev-autonomy";
import { projectClient } from "../../../platform/tauri/project";
import type { AuditRow, AutonomyGateway, ReviewGateway } from "../application/ports";
import { parseEvent, parseIntegrated, parseState } from "../domain/types";
import { parseDelegation, parseNotice, parseOpened, parseOverview, parsePrState } from "../domain/autonomy";

function must<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`resposta inválida do backend (${what})`);
  return v;
}

export const reviewGateway: ReviewGateway = {
  state: async (root, key) => must(parseState(await ipc.reviewState(root, key)), "codev_review_state"),
  request: (root, key, command, decidedAt, reviewer) => ipc.reviewRequest(root, key, command, decidedAt, reviewer),
  cancel: (root, key) => ipc.reviewCancel(root, key),
  integrate: async (root, key, command, decidedAt) => must(parseIntegrated(await ipc.reviewIntegrate(root, key, command, decidedAt)), "codev_review_integrate"),
  onEvent: (f) =>
    ipc.onReviewEvent((p) => {
      const e = parseEvent(p);
      if (e) f(e);
    }),
};

const auditRow = (v: unknown): AuditRow | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.id !== "number") return null;
  const s = (x: unknown): string => (typeof x === "string" ? x : "");
  return { id: o.id, at: typeof o.at === "number" ? o.at : 0, call: s(o.call), outcome: s(o.outcome), decidedBy: s(o.decidedBy), command: s(o.command), reason: s(o.reason) };
};

/** Multi Co-Dev, fase 5: a autonomia delegada e os pull requests sobre `platform/tauri/codev-autonomy`. */
export const autonomyGateway: AutonomyGateway = {
  overview: async (root, key) => must(parseOverview(await auto.autonomyState(root, key)), "codev_autonomy_state"),
  grant: async (root, g) => must(parseDelegation(await auto.autonomyGrant(root, g)), "codev_autonomy_grant"),
  revoke: async (root, id) => must(parseDelegation(await auto.autonomyRevoke(root, id, null)), "codev_autonomy_revoke"),
  pause: async (root, paused, reason) => {
    const r = (await auto.autonomyPause(root, paused, reason || null)) as { paused?: unknown } | null;
    if (!r || typeof r.paused !== "boolean") throw new Error("resposta inválida do backend (codev_autonomy_pause)");
    return { paused: r.paused, by: null, at: null, reason: null };
  },
  prState: async (root, key) => must(parsePrState(await auto.prState(root, key)), "codev_pr_state"),
  prOpen: async (root, key, command, decidedAt) => must(parseOpened(await auto.prOpen(root, key, command, decidedAt)), "codev_pr_open"),
  auditRows: async (root, key) => {
    const rows = await projectClient().audit(root, key);
    return Array.isArray(rows) ? rows.map(auditRow).filter((x): x is AuditRow => x !== null) : [];
  },
  onNotice: (f) =>
    auto.onAutonomyEvent((p) => {
      const n = parseNotice(p);
      if (n) f(n);
    }),
};
