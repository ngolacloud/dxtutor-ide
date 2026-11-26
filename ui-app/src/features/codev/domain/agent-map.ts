/* ═══════════ Co-Dev — domínio: o mapa de agentes ═══════════
   Quem está a trabalhar agora: as sessões do agente v2 (hoje a da conversa; numa sprint, um
   Co-Dev por issue) e os sub-agentes de cada uma (a ferramenta `task`). O mapa constrói-se só a
   partir dos eventos do agente (`codev-agent://event` de TODAS as sessões, com o progresso dos
   sub-agentes em `{kind: "subagent", call, step}`) e da lista das sessões abertas
   (`codev_agent_live`). Puro: sem DOM, sem window, sem Tauri; o relógio entra por argumento. */

import type { AgentEvent, Usage } from "./agent-events";
import { describeCall } from "./agent-events";

export type AgentStatus = "running" | "done" | "failed";

/** Uma ferramenta que um agente correu (as últimas ficam no detalhe). */
export interface ToolRun {
  id: string;
  name: string;
  label: string;
  status: "running" | "ok" | "error";
}

/** Um sub-agente: uma chamada `task` de uma sessão. */
export interface SubAgent {
  /** O id da chamada `task` (o mesmo do `tool_start`/`tool_result`). */
  id: string;
  session: string;
  label: string;
  role: string;
  /** O que lhe pediram (o `prompt` da chamada). */
  prompt: string;
  status: AgentStatus;
  started: number;
  ended: number | null;
  usage: Usage;
  tools: ToolRun[];
  /** O relatório que devolveu (ou o erro), sem a linha de contagem do backend. */
  summary: string;
}

/** Uma sessão do agente (um Co-Dev). */
export interface AgentSession {
  id: string;
  issue: string | null;
  model: string;
  status: AgentStatus;
  started: number;
  ended: number | null;
  /** O pedido do turno em curso (ou do último), quando a UI o conhece. */
  request: string;
  /** Tokens dos turnos já terminados + os do turno em curso (`turn`). */
  prior: Usage;
  turn: Usage;
  tools: ToolRun[];
  /** O texto da última resposta do modelo (a cauda). */
  lastText: string;
  /** Como acabou o último turno, quando não foi normal (`cancelled`, `refused`, …). */
  outcome: string | null;
  agents: SubAgent[];
}

export interface AgentMap {
  sessions: AgentSession[];
}

/** Uma sessão aberta no backend (`codev_agent_live`, camelCase). */
export interface LiveSession {
  id: string;
  root: string;
  model: string;
  issue: string | null;
  busy: boolean;
  opened: number;
}

export const emptyMap = (): AgentMap => ({ sessions: [] });

export const zeroUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
});

/** Todos os tokens (entrada, saída e cache), como o «270.5k tokens» do mapa. */
export const totalTokens = (u: Usage): number =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;

export const sessionUsage = (s: AgentSession): Usage => addUsage(s.prior, s.turn);

/** As ferramentas guardadas por agente (as mais recentes). */
export const MAX_TOOLS = 40;
/** A cauda do texto guardada da última resposta. */
export const MAX_TEXT = 4000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseUsage(v: unknown): Usage | null {
  if (!isObj(v)) return null;
  const n = (k: string): number => (num(v[k]) ? (v[k] as number) : 0);
  return {
    input_tokens: n("input_tokens"),
    output_tokens: n("output_tokens"),
    cache_read_input_tokens: n("cache_read_input_tokens"),
    cache_creation_input_tokens: n("cache_creation_input_tokens"),
  };
}

/** Um passo de um sub-agente (o `step` do evento `subagent`), estreitado; `null` se desconhecido. */
export type SubagentStep =
  | { type: "started"; role: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; is_error: boolean }
  | { type: "usage"; turn: Usage };

/** `{kind: "subagent", call, step}` → `{call, step}` (o resto dos eventos passa por `parseAgentEvent`). */
export function parseSubagentEvent(e: unknown): { call: string; step: SubagentStep } | null {
  if (!isObj(e) || e.kind !== "subagent" || !str(e.call) || !isObj(e.step)) return null;
  const s = e.step;
  switch (s.type) {
    case "started":
      return { call: e.call, step: { type: "started", role: str(s.role) ? s.role : "explorer" } };
    case "tool_start":
      if (!str(s.id) || !str(s.name)) return null;
      return { call: e.call, step: { type: "tool_start", id: s.id, name: s.name, input: isObj(s.input) ? s.input : {} } };
    case "tool_result":
      if (!str(s.id) || !str(s.name)) return null;
      return { call: e.call, step: { type: "tool_result", id: s.id, name: s.name, is_error: s.is_error === true } };
    case "usage": {
      const u = parseUsage(s.turn);
      return u ? { call: e.call, step: { type: "usage", turn: u } } : null;
    }
    default:
      return null;
  }
}

/** A lista das sessões abertas (`codev_agent_live`), sem as entradas inválidas. */
export function parseLiveSessions(v: unknown): LiveSession[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => isObj(x) && str(x.id)).map((x) => ({
    id: x.id as string,
    root: str(x.root) ? x.root : "",
    model: str(x.model) ? x.model : "",
    issue: str(x.issue) && x.issue.trim() ? x.issue : null,
    busy: x.busy === true,
    opened: num(x.opened) ? x.opened : 0,
  }));
}

/** O relatório do sub-agente sem a linha `[sub-agente: N mensagens, …]` que o backend junta. */
export function subagentSummary(content: string): string {
  return content.replace(/\n*\[sub-agente: [^\]]*\]\s*$/, "").trim();
}

function newSession(id: string, now: number, model = "", issue: string | null = null): AgentSession {
  return {
    id,
    issue,
    model,
    status: "done",
    started: now,
    ended: null,
    request: "",
    prior: zeroUsage(),
    turn: zeroUsage(),
    tools: [],
    lastText: "",
    outcome: null,
    agents: [],
  };
}

const pushTool = (list: ToolRun[], t: ToolRun): ToolRun[] => [...list.filter((x) => x.id !== t.id), t].slice(-MAX_TOOLS);
const settleTool = (list: ToolRun[], id: string, ok: boolean): ToolRun[] =>
  list.map((t) => (t.id === id ? { ...t, status: ok ? "ok" : "error" } : t));

function withSession(m: AgentMap, id: string, now: number, f: (s: AgentSession) => AgentSession): AgentMap {
  const cur = m.sessions.find((s) => s.id === id);
  if (!cur) return { sessions: [...m.sessions, f(newSession(id, now))] };
  return { sessions: m.sessions.map((s) => (s.id === id ? f(s) : s)) };
}

/** Um turno novo da sessão: os sub-agentes que já acabaram saem (os do turno anterior ficam até
 *  aqui, para se poder abrir o mapa depois de terminarem), o uso do turno recomeça. */
function beginTurn(s: AgentSession, now: number, request?: string): AgentSession {
  return {
    ...s,
    status: "running",
    started: s.status === "running" ? s.started : now,
    ended: null,
    request: request ?? s.request,
    prior: addUsage(s.prior, s.turn),
    turn: zeroUsage(),
    lastText: "",
    outcome: null,
    agents: s.agents.filter((a) => a.status === "running"),
  };
}

/** A UI enviou uma mensagem a uma sessão (conhece o pedido, o modelo e a issue). */
export function turnStarted(m: AgentMap, session: string, now: number, info: { request: string; model?: string; issue?: string | null }): AgentMap {
  return withSession(m, session, now, (s) => ({
    ...beginTurn(s, now, info.request),
    model: info.model || s.model,
    issue: info.issue !== undefined ? info.issue : s.issue,
  }));
}

/** Um evento de uma sessão (`codev-agent://event`). `sub`: o mesmo evento, se for de um sub-agente. */
export function reduceAgentEvent(
  m: AgentMap,
  session: string,
  e: AgentEvent | null,
  now: number,
  sub?: { call: string; step: SubagentStep } | null,
): AgentMap {
  if (sub) return reduceSubagent(m, session, sub.call, sub.step, now);
  if (!e) return m;
  return withSession(m, session, now, (s0) => {
    // o modelo a responder ou uma ferramenta numa sessão parada: começou um turno que esta conversa não
    // enviou (ex.: o Co-Dev de uma issue numa sprint). Os avisos do anfitrião depois do turno não contam.
    const s = s0.status !== "running" && (e.kind === "stream" || e.kind === "tool_start") ? beginTurn(s0, now) : s0;
    switch (e.kind) {
      case "stream": {
        const ev = e.event;
        if (ev.type === "message_start") return { ...s, lastText: "", model: s.model || ev.model };
        if (ev.type === "text_delta") return { ...s, lastText: (s.lastText + ev.text).slice(-MAX_TEXT) };
        return s;
      }
      case "tool_start": {
        if (e.name === "task") {
          const a: SubAgent = {
            id: e.id,
            session,
            label: str(e.input.description) ? e.input.description : "",
            role: str(e.input.role) ? e.input.role : "explorer",
            prompt: str(e.input.prompt) ? e.input.prompt : "",
            status: "running",
            started: now,
            ended: null,
            usage: zeroUsage(),
            tools: [],
            summary: "",
          };
          return { ...s, agents: [...s.agents.filter((x) => x.id !== e.id), a] };
        }
        if (e.name === "todo_write") return s;
        return { ...s, tools: pushTool(s.tools, { id: e.id, name: e.name, label: describeCall(e.name, e.input), status: "running" }) };
      }
      case "tool_result": {
        if (e.name === "task") {
          return {
            ...s,
            agents: s.agents.map((a) =>
              a.id === e.id ? { ...a, status: e.is_error ? "failed" : "done", ended: now, summary: subagentSummary(e.content) } : a,
            ),
          };
        }
        return { ...s, tools: settleTool(s.tools, e.id, !e.is_error) };
      }
      case "usage":
        return { ...s, turn: e.turn };
      case "served_by":
        return { ...s, model: e.model };
      case "done": {
        const failed = e.outcome.type === "refused" || e.outcome.type === "iteration_limit";
        return {
          ...s,
          status: failed ? "failed" : "done",
          ended: now,
          outcome: e.outcome.type === "done" ? null : e.outcome.type,
          // o turno acabou: um sub-agente sem resultado não volta (cancelado com o turno)
          agents: s.agents.map((a) => (a.status === "running" ? { ...a, status: "failed", ended: now } : a)),
          tools: s.tools.map((t) => (t.status === "running" ? { ...t, status: "error" } : t)),
        };
      }
      default:
        return s;
    }
  });
}

function reduceSubagent(m: AgentMap, session: string, call: string, step: SubagentStep, now: number): AgentMap {
  return withSession(m, session, now, (s) => {
    const has = s.agents.some((a) => a.id === call);
    // o progresso chegou antes do `tool_start` (não acontece no loop, mas não se perde)
    const agents: SubAgent[] = has
      ? s.agents
      : [...s.agents, { id: call, session, label: "", role: "explorer", prompt: "", status: "running", started: now, ended: null, usage: zeroUsage(), tools: [], summary: "" }];
    return {
      ...s,
      agents: agents.map((a) => {
        if (a.id !== call) return a;
        switch (step.type) {
          case "started":
            return { ...a, role: step.role };
          case "tool_start":
            return { ...a, tools: pushTool(a.tools, { id: step.id, name: step.name, label: describeCall(step.name, step.input), status: "running" }) };
          case "tool_result":
            return { ...a, tools: settleTool(a.tools, step.id, !step.is_error) };
          case "usage":
            return { ...a, usage: step.turn };
        }
      }),
    };
  });
}

/** O turno de uma sessão falhou (`codev-agent://error`). */
export function sessionFailed(m: AgentMap, session: string, now: number, error: string): AgentMap {
  return withSession(m, session, now, (s) => ({
    ...s,
    status: "failed",
    ended: now,
    outcome: error,
    agents: s.agents.map((a) => (a.status === "running" ? { ...a, status: "failed", ended: now } : a)),
  }));
}

/** Junta a lista das sessões abertas do backend: entram as que faltam (com a issue e o modelo), saem
 *  as que já não estão abertas e não correm. */
export function mergeLive(m: AgentMap, live: LiveSession[], now: number): AgentMap {
  const ids = new Set(live.map((l) => l.id));
  const kept = m.sessions.filter((s) => ids.has(s.id) || s.status === "running");
  const sessions = kept.map((s) => {
    const l = live.find((x) => x.id === s.id);
    return l ? { ...s, model: s.model || l.model, issue: s.issue ?? l.issue } : s;
  });
  for (const l of live) {
    if (sessions.some((s) => s.id === l.id)) continue;
    const s = newSession(l.id, l.opened || now, l.model, l.issue);
    sessions.push(l.busy ? { ...s, status: "running" } : s);
  }
  return { sessions };
}

/** A sessão fechou (nova conversa): sai do mapa. */
export const dropSession = (m: AgentMap, session: string): AgentMap => ({ sessions: m.sessions.filter((s) => s.id !== session) });

/** Quantos agentes trabalham agora: os sub-agentes a correr de todas as sessões e as OUTRAS sessões
 *  a correr (numa sprint, cada Co-Dev de uma issue). A sessão `primary` (a da conversa) é a raiz do
 *  mapa, não conta. */
export function workingAgents(m: AgentMap, primary: string | null): number {
  let n = 0;
  for (const s of m.sessions) {
    if (s.id !== primary && s.status === "running") n++;
    n += s.agents.filter((a) => a.status === "running").length;
  }
  return n;
}

/** Quantos agentes o mapa mostra (para o «N agentes» do cabeçalho). */
export function listedAgents(m: AgentMap, primary: string | null): number {
  return m.sessions.reduce((n, s) => n + s.agents.length + (s.id === primary ? 0 : 1), 0);
}

/* ───── a vista: uma raiz à esquerda e os agentes à direita ───── */

export interface MapCard {
  /** `s:<sessão>` ou `a:<sessão>:<chamada>` — o `data-on` do cartão. */
  key: string;
  kind: "session" | "subagent";
  label: string;
  status: AgentStatus;
  elapsedMs: number;
  tokens: number;
  /** 0 = directamente sob a raiz; 1 = sub-agente de uma sessão que não é a raiz. */
  depth: number;
}

export interface MapView {
  root: MapCard;
  cards: MapCard[];
  working: number;
}

export const elapsedOf = (x: { started: number; ended: number | null }, now: number): number => Math.max(0, (x.ended ?? now) - x.started);

/** O rótulo de uma sessão: «Co-Dev», ou «Co-Dev · DX-12» quando trabalha uma issue. */
export const sessionLabel = (s: Pick<AgentSession, "issue">, base: string): string => (s.issue ? `${base} · ${s.issue}` : base);

/** A árvore que a vista desenha. Sem sessão da conversa, a raiz é a conversa ainda sem turno. */
export function buildMapView(m: AgentMap, primary: string | null, now: number, base: string): MapView {
  const root = m.sessions.find((s) => s.id === primary) ?? null;
  const sessionCard = (s: AgentSession, depth: number): MapCard => ({
    key: `s:${s.id}`,
    kind: "session",
    label: sessionLabel(s, base),
    status: s.status,
    elapsedMs: elapsedOf(s, now),
    tokens: totalTokens(sessionUsage(s)),
    depth,
  });
  const agentCard = (a: SubAgent, depth: number): MapCard => ({
    key: `a:${a.session}:${a.id}`,
    kind: "subagent",
    label: a.label || a.role,
    status: a.status,
    elapsedMs: elapsedOf(a, now),
    tokens: totalTokens(a.usage),
    depth,
  });
  const cards: MapCard[] = [];
  if (root) for (const a of root.agents) cards.push(agentCard(a, 0));
  for (const s of m.sessions) {
    if (s.id === primary) continue;
    cards.push(sessionCard(s, 0));
    for (const a of s.agents) cards.push(agentCard(a, 1));
  }
  return {
    root: root
      ? sessionCard(root, 0)
      : { key: "s:", kind: "session", label: base, status: "done", elapsedMs: 0, tokens: 0, depth: 0 },
    cards,
    working: workingAgents(m, primary),
  };
}

/** O que um cartão aponta: a sessão e, se for um sub-agente, ele. */
export function findCard(m: AgentMap, key: string): { session: AgentSession; agent: SubAgent | null } | null {
  const [kind, sid, call] = key.split(":");
  const session = m.sessions.find((s) => s.id === sid);
  if (!session) return null;
  if (kind === "s") return { session, agent: null };
  const agent = session.agents.find((a) => a.id === call);
  return agent ? { session, agent } : null;
}

/* ───── formatos ───── */

/** «42s», «10m 16s», «1h 02m». */
export function formatElapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m}m ${String(t % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** «950», «12.3k», «270.5k», «1.2M». */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  if (n < 1_000_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  return `${(Math.floor(n / 100_000) / 10).toFixed(1)}M`;
}
