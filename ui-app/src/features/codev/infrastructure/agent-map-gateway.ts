/* ═══════════ Co-Dev — adaptador: AgentMapGateway sobre o IPC ═══════════
   O mapa de agentes ouve o `codev-agent://event` de TODAS as sessões (o progresso dos
   sub-agentes chega como `{kind: "subagent", call, step}`) e o `codev-agent://error`, e pede as
   sessões abertas (`codev_agent_live`). Os payloads estreitam-se pelo domínio. Só na app
   desktop: no browser não há backend (`available()` é falso). */

import * as ipc from "../../../platform/tauri/codev-agent";
import { isDesktop } from "../../../platform/tauri/core";
import type { AgentMapGateway } from "../application/ports";
import { parseAgentError, parseAgentEvent } from "../domain/agent-events";
import { parseLiveSessions, parseSubagentEvent } from "../domain/agent-map";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const agentMapGateway: AgentMapGateway = {
  available: () => isDesktop(),
  async subscribe(h) {
    const offs = await Promise.all([
      ipc.onAgentEvent((p) => {
        if (!isObj(p) || typeof p.session !== "string") return;
        const sub = parseSubagentEvent(p.event);
        if (sub) return h.event(p.session, null, sub);
        const m = parseAgentEvent(p);
        if (m) h.event(m.session, m.event, null);
      }),
      ipc.onAgentError((p) => {
        const m = parseAgentError(p);
        if (m) h.error(m.session, m.error);
      }),
    ]);
    return () => offs.forEach((off) => off());
  },
  live: async () => parseLiveSessions(await ipc.liveAgentSessions()),
};
