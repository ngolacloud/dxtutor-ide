/* ═══════════ Co-Dev — domínio: o protocolo do agente v2 (ADR-0003, F4) ═══════════
   O que um turno do agente Rust (`tutor-agent`) emite, espelhando o serde de
   `AgentEvent`/`StreamEvent`/`TurnOutcome` e do `ApprovalRequest` do `codev_agent`.
   Puro: sem DOM, sem Tauri. Os payloads chegam do IPC como `unknown`; `parse*` estreita-os
   e devolve `null` para formas desconhecidas (o adaptador ignora-as em vez de rebentar). */

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type StreamEvent =
  | { type: "message_start"; model: string }
  | { type: "block_start"; index: number; kind: { type: string; id?: string; name?: string } }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "tool_input_delta"; index: number; partial_json: string }
  | { type: "block_stop"; index: number }
  | { type: "usage" }
  | { type: "ping" };

export type TurnOutcome =
  | { type: "done"; truncated: boolean }
  | { type: "refused"; details: { category?: string | null; explanation?: string } | null }
  | { type: "cancelled" }
  | { type: "iteration_limit" };

export type AgentEvent =
  | { kind: "stream"; event: StreamEvent }
  | { kind: "retrying"; attempt: number; reason: string }
  | { kind: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; id: string; name: string; is_error: boolean; content: string }
  | { kind: "usage"; request: Usage; turn: Usage }
  | { kind: "served_by"; model: string }
  | { kind: "checkpoint"; id: number; label: string }
  | { kind: "notice"; text: string }
  | { kind: "done"; outcome: TurnOutcome };

export interface PendingCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  read_only: boolean;
  command: string | null;
}

export interface ApprovalRequest {
  call: PendingCall;
  reason: string;
  /** Piso de segurança: não há «permitir sempre». */
  dangerous: boolean;
  suggestedRule: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

/** `{session, event}` do evento `codev-agent://event`. */
export function parseAgentEvent(payload: unknown): { session: string; event: AgentEvent } | null {
  if (!isObj(payload) || !str(payload.session) || !isObj(payload.event)) return null;
  const e = payload.event;
  const known = ["stream", "retrying", "tool_start", "tool_result", "usage", "served_by", "checkpoint", "notice", "done"];
  if (!str(e.kind) || !known.includes(e.kind)) return null;
  if (e.kind === "stream" && !(isObj(e.event) && str(e.event.type))) return null;
  if ((e.kind === "tool_start" || e.kind === "tool_result") && !(str(e.id) && str(e.name))) return null;
  if (e.kind === "done" && !(isObj(e.outcome) && str(e.outcome.type))) return null;
  return { session: payload.session, event: e as unknown as AgentEvent };
}

/** `{session, request}` do evento `codev-agent://approval`. */
export function parseApproval(payload: unknown): { session: string; request: ApprovalRequest } | null {
  if (!isObj(payload) || !str(payload.session) || !isObj(payload.request)) return null;
  const r = payload.request;
  if (!isObj(r.call) || !str(r.call.id) || !str(r.call.name) || !str(r.reason)) return null;
  const input = isObj(r.call.input) ? r.call.input : {};
  return {
    session: payload.session,
    request: {
      call: {
        id: r.call.id,
        name: r.call.name,
        input,
        read_only: r.call.read_only === true,
        command: str(r.call.command) ? r.call.command : null,
      },
      reason: r.reason,
      dangerous: r.dangerous === true,
      suggestedRule: str(r.suggestedRule) ? r.suggestedRule : null,
    },
  };
}

/** `{session, error}` do evento `codev-agent://error`. */
export function parseAgentError(payload: unknown): { session: string; error: string } | null {
  if (!isObj(payload) || !str(payload.session)) return null;
  return { session: payload.session, error: str(payload.error) ? payload.error : "erro desconhecido" };
}

/** Rótulo curto de uma chamada para a linha de ferramenta: `$ cargo test`, `src/a.rs`, … */
export function describeCall(name: string, input: Record<string, unknown>, command?: string | null): string {
  const s = (k: string): string => (str(input[k]) ? (input[k] as string) : "");
  if (command) return "$ " + command;
  switch (name) {
    case "read":
    case "edit":
    case "write":
      return s("path");
    case "glob":
      return s("pattern") + (s("path") ? ` em ${s("path")}` : "");
    case "grep":
      return `/${s("pattern")}/` + (s("glob") ? ` ${s("glob")}` : "") + (s("path") ? ` em ${s("path")}` : "");
    case "git_diff":
      return (input.staged === true ? "--staged " : "") + s("path");
    default:
      return "";
  }
}

/** Uma linha de resumo do resultado de uma ferramenta (o detalhe fica no histórico). */
export function summarizeResult(content: string, max = 140): string {
  const first = content.split("\n").find((l) => l.trim() !== "") ?? "";
  const lines = content.split("\n").filter((l) => l.trim() !== "").length;
  const head = first.length > max ? first.slice(0, max - 1) + "…" : first;
  return lines > 1 ? `${head} (+${lines - 1} linhas)` : head;
}

/** Texto para o fim de um turno que não terminou normalmente (ou `null` se terminou). */
export function outcomeNotice(o: TurnOutcome): string | null {
  switch (o.type) {
    case "done":
      return o.truncated ? "A resposta foi cortada pelo limite de tokens." : null;
    case "refused":
      return (
        "O modelo recusou este pedido" +
        (o.details && o.details.category ? ` (categoria: ${o.details.category})` : "") +
        ". Nada desta resposta foi executado."
      );
    case "cancelled":
      return "Interrompido por ti. O histórico ficou consistente: podes continuar.";
    case "iteration_limit":
      return "Atingido o limite de passos deste turno. Envia «continua» para o agente prosseguir.";
  }
}

/** Uma sessão gravada (espelho de `tutor_agent::session::SessionSummary`, camelCase). */
export interface SessionSummary {
  id: string;
  title: string;
  messages: number;
  model: string;
  created: number;
  updated: number;
}

/** Uma entrada do histórico simplificado de uma sessão retomada. */
export interface HistoryItem {
  role: "user" | "assistant";
  text: string;
  tools: string[];
}

export function parseSessions(v: unknown): SessionSummary[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is SessionSummary =>
      isObj(s) &&
      str(s.id) &&
      str(s.title) &&
      typeof s.messages === "number" &&
      typeof s.updated === "number",
  );
}

export function parseHistory(v: unknown): HistoryItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h) => isObj(h) && (h.role === "user" || h.role === "assistant") && str(h.text))
    .map((h) => {
      const o = h as Record<string, unknown>;
      return {
        role: o.role as "user" | "assistant",
        text: o.text as string,
        tools: Array.isArray(o.tools) ? (o.tools.filter(str) as string[]) : [],
      };
    });
}

/** Há quanto tempo, em português: «agora», «há 5 min», «há 3 h», «há 2 dias». */
export function ago(thenSecs: number, nowSecs: number): string {
  const d = Math.max(0, nowSecs - thenSecs);
  if (d < 60) return "agora";
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  const days = Math.floor(d / 86400);
  return `há ${days} dia${days === 1 ? "" : "s"}`;
}

/** Rótulo de uma sessão na lista de retoma (texto simples). */
export function describeSession(s: SessionSummary, nowSecs: number): string {
  const t = s.title.length > 60 ? s.title.slice(0, 59) + "…" : s.title;
  return `${t} · ${ago(s.updated, nowSecs)} · ${s.messages} mensagens`;
}

/** Uma tarefa da lista do agente (`todo_write`). */
export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** A lista de tarefas a partir do input de um `todo_write` (entradas inválidas ignoradas). */
export function parseTodos(input: Record<string, unknown>): Todo[] {
  const a = input.todos;
  if (!Array.isArray(a)) return [];
  return a
    .filter((t) => isObj(t) && str(t.content))
    .map((t) => {
      const o = t as Record<string, unknown>;
      const st = o.status === "completed" || o.status === "in_progress" ? o.status : "pending";
      return { content: o.content as string, status: st };
    });
}

/** Um checkpoint de ficheiros (espelho de `tutor_agent::checkpoint::Checkpoint`). */
export interface Checkpoint {
  id: number;
  label: string;
  created: number;
}

export function parseCheckpoints(v: unknown): Checkpoint[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is Checkpoint => isObj(c) && typeof c.id === "number" && str(c.label) && typeof c.created === "number");
}

/** O diff a mostrar num pedido de aprovação de edit/write (`null` para as outras ferramentas). */
export function callDiff(name: string, input: Record<string, unknown>): { path: string; before: string; after: string } | null {
  const s = (k: string): string => (str(input[k]) ? (input[k] as string) : "");
  if (name === "edit") return { path: s("path"), before: s("old_string"), after: s("new_string") };
  if (name === "write") return { path: s("path"), before: "", after: s("content") };
  return null;
}
