/* ═══════════ Co-Dev — adaptador: AgentGateway sobre o IPC (ADR-0003, F4) ═══════════
   Implementa a porta `AgentGateway` com o cliente tipado `platform/tauri/codev-agent`
   e estreita os payloads dos eventos pelo domínio (`parse*`). O estado do monólito
   (pasta real, provedor activo, flag do harness antigo) lê-se pelo `legacy-bridge`, o
   único sítio da feature que toca no window (regra A8). */

import * as ipc from "../../../platform/tauri/codev-agent";
import { pairState } from "../../../app/pair-state";
import { isDesktop } from "../../../platform/tauri/core";
import type { AgentGateway } from "../application/ports";
import { isAgentProvider, parseAgentError, parseAgentEvent, parseApproval, parseCheckpoints, parseExtensions, parseHistory, parsePermissions, parseSessions } from "../domain/agent-events";
import * as bridge from "./legacy-bridge";

export const agentGateway: AgentGateway = {
  available: () =>
    isDesktop() && !!bridge.diskRoot() && isAgentProvider(bridge.monolith.activeProvider) && bridge.agentV2Enabled(),
  start: (o) =>
    ipc.startAgent({
      root: o.root,
      provider: o.provider,
      model: o.model,
      effort: o.effort,
      testCmd: o.testCmd,
      lintCmd: o.lintCmd,
      mode: o.mode,
      resume: o.resume ?? null,
      reviewEdits: o.reviewEdits ?? false,
      issue: o.issue ?? null,
      architecture: o.architecture ?? false,
      ...(o.worktree ? { worktree: true } : {}),
    }),
  review: (s, call, decisions) => ipc.reviewAgentHunks(s, call, decisions, pairState.driver()),
  override: (s, call, adr) => ipc.overrideAgentViolation(s, call, adr),
  sessions: async (root) => parseSessions(await ipc.listAgentSessions(root)),
  history: async (s) => parseHistory(await ipc.agentHistory(s)),
  setPlan: (s, on) => ipc.setAgentPlan(s, on),
  checkpoints: async (s) => parseCheckpoints(await ipc.listAgentCheckpoints(s)),
  rewind: (s, id, conversation) => ipc.rewindAgent(s, id, conversation ?? false),
  permissions: async (root) => parsePermissions(await ipc.agentPermissions(root)),
  savePermissions: (root, rules) => ipc.saveAgentPermissions(root, rules),
  extensions: async (root) => parseExtensions(await ipc.agentExtensions(root)),
  trust: (root, kind) => ipc.trustAgentFile(root, kind),
  send: (s, text, origin) => ipc.sendAgent(s, text, origin),
  approve: (s, id, allow, reason, remember) => ipc.approveAgent(s, id, allow, reason, remember, pairState.driver()),
  cancel: (s) => ipc.cancelAgent(s),
  setMode: (s, mode) => ipc.setAgentMode(s, mode),
  close: (s, keepWorktree) => ipc.closeAgent(s, keepWorktree),
  async subscribe(h) {
    const offs = await Promise.all([
      ipc.onAgentEvent((p) => {
        const m = parseAgentEvent(p);
        if (m) h.event(m.session, m.event);
      }),
      ipc.onAgentApproval((p) => {
        const m = parseApproval(p);
        if (m) h.approval(m.session, m.request);
      }),
      ipc.onAgentError((p) => {
        const m = parseAgentError(p);
        if (m) h.error(m.session, m.error);
      }),
    ]);
    return () => offs.forEach((off) => off());
  },
};
