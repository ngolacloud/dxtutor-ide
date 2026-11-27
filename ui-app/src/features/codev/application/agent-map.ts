/* ═══════════ Co-Dev — caso de uso: o mapa de agentes ═══════════
   Ouve os eventos de TODAS as sessões do agente v2 (a conversa só segue a sua) e mantém o mapa:
   as sessões e os sub-agentes de cada uma, com estado, tempo e tokens. A conversa diz-lhe o que
   pediu a cada sessão (`AgentMapSink`) e a sessão que é a raiz (`primary`); a lista das sessões
   abertas vem do backend quando o mapa abre. Sem DOM, sem window, sem Tauri: tudo pelas portas. */

import type { AgentMapGateway, AgentMapSink } from "./ports";
import {
  buildMapView,
  dropSession,
  emptyMap,
  mergeLive,
  reduceAgentEvent,
  sessionFailed,
  turnStarted,
  workingAgents,
  type AgentMap,
  type MapView,
} from "../domain/agent-map";

export interface AgentMapDeps {
  gateway: AgentMapGateway;
  /** A sessão da conversa (a raiz do mapa), ou `null` antes do primeiro turno. */
  primary(): string | null;
  /** Milissegundos desde a época (relógio injectado para os testes). */
  now(): number;
}

export function makeAgentMapStore(deps: AgentMapDeps) {
  let map: AgentMap = emptyMap();
  let off: (() => void) | null = null;
  let starting: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (m: AgentMap): void => {
    if (m === map) return;
    map = m;
    for (const f of [...listeners]) f();
  };

  /** Começa a ouvir (idempotente; no browser não há backend e o mapa fica vazio). */
  function start(): Promise<void> {
    if (off || !deps.gateway.available()) return Promise.resolve();
    if (!starting) {
      starting = deps.gateway
        .subscribe({
          event: (s, e, sub) => set(reduceAgentEvent(map, s, e, deps.now(), sub)),
          error: (s, message) => set(sessionFailed(map, s, deps.now(), message)),
        })
        .then((u) => {
          off = u;
        })
        .catch(() => undefined)
        .finally(() => {
          starting = null;
        });
    }
    return starting;
  }

  /** Junta as sessões abertas no backend (ao abrir o mapa: as de uma sprint, ou depois de recarregar a janela). */
  async function refresh(): Promise<void> {
    if (!deps.gateway.available()) return;
    try {
      set(mergeLive(map, await deps.gateway.live(), deps.now()));
    } catch {
      /* sem a lista, o mapa mostra o que os eventos já disseram */
    }
  }

  const sink: AgentMapSink = {
    turn: (session, info) => set(turnStarted(map, session, deps.now(), info)),
    closed: (session) => set(dropSession(map, session)),
  };

  return {
    start,
    refresh,
    sink,
    snapshot: (): AgentMap => map,
    primary: (): string | null => deps.primary(),
    /** Quantos agentes trabalham agora (o chip do compositor). */
    working: (): number => workingAgents(map, deps.primary()),
    /** A árvore a desenhar; `base` é o nome da raiz («Co-Dev»). */
    view: (base: string): MapView => buildMapView(map, deps.primary(), deps.now(), base),
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    stop(): void {
      off?.();
      off = null;
    },
  };
}

export type AgentMapStore = ReturnType<typeof makeAgentMapStore>;
