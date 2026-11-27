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
  /** A parte de `cache_creation_input_tokens` escrita com TTL de 1 hora (custa 2× a entrada). */
  cache_creation_1h_input_tokens?: number;
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

/** RF-A03/A04: an architect's rule a change under review breaks (`tutor_agent::conformance::Violation`). */
export interface RuleViolation {
  rule: string;
  message: string;
  path: string;
  line?: number | null;
}

export type AgentEvent =
  | { kind: "stream"; event: StreamEvent }
  | { kind: "retrying"; attempt: number; reason: string }
  | { kind: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; id: string; name: string; is_error: boolean; content: string }
  | { kind: "usage"; request: Usage; turn: Usage }
  | { kind: "served_by"; model: string }
  | { kind: "checkpoint"; id: number; label: string }
  | { kind: "notice"; text: string }
  /** The agent asked instead of choosing (`ask_human`, RF-G06): the human answers next. */
  | { kind: "question"; text: string }
  | { kind: "report"; title: string; markdown: string }
  | HunkEvent
  | { kind: "done"; outcome: TurnOutcome };

/* ── live hunks (docs/v2/RF-CODEV-STREAM.md §3) ── */

export type HunkOp = "replace" | "insert" | "delete" | "create";
export interface LineRange {
  start: number;
  end: number;
}
export interface ValidationCheck {
  command: string;
  ok: boolean;
  summary: string;
}
export type HunkEvent =
  | { kind: "hunk_start"; hunk: string; call: string; path: string; op: HunkOp; range: LineRange; base: string | null; old: string }
  | { kind: "hunk_chunk"; hunk: string; text: string }
  | { kind: "hunk_end"; hunk: string; text: string; lines: { added: number; removed: number } }
  | { kind: "hunk_review"; call: string; hunks: string[]; reason: string; why?: string; violations?: RuleViolation[] }
  /** `before`: the file's text before the block, when the writer already has it (local proposals write
   *  first); `null` = do not record it again for Ctrl+Z; absent = read it from the editor (the backend). */
  | { kind: "hunk_applied"; hunk: string; provisional: boolean; fingerprint: string; before?: string | null }
  | { kind: "hunk_rejected"; hunk: string; by: "human" | "validation" | "cancel"; reason: string }
  | { kind: "hunk_stale"; hunk: string; path: string }
  | { kind: "validation"; status: "running" | "passed" | "failed" | "skipped"; checks: ValidationCheck[]; baseline: ValidationCheck[] }
  /** RF-G07: the human stopped the turn and it left these files changed (keep, or back to `checkpoint`). */
  | { kind: "stop_review"; checkpoint: number; files: string[] };

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
  const known = ["stream", "retrying", "tool_start", "tool_result", "usage", "served_by", "checkpoint", "notice", "question", "report", "done", "stop_review"];
  if (str(e.kind) && HUNK_KINDS.includes(e.kind)) {
    return validHunkEvent(e) ? { session: payload.session, event: e as unknown as AgentEvent } : null;
  }
  if (!str(e.kind) || !known.includes(e.kind)) return null;
  if (e.kind === "stream" && !(isObj(e.event) && str(e.event.type))) return null;
  if ((e.kind === "tool_start" || e.kind === "tool_result") && !(str(e.id) && str(e.name))) return null;
  if (e.kind === "done" && !(isObj(e.outcome) && str(e.outcome.type))) return null;
  if (e.kind === "stop_review" && !(num(e.checkpoint) && Array.isArray(e.files) && e.files.every(str))) return null;
  return { session: payload.session, event: e as unknown as AgentEvent };
}

const HUNK_KINDS = ["hunk_start", "hunk_chunk", "hunk_end", "hunk_review", "hunk_applied", "hunk_rejected", "hunk_stale", "validation"];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checks the fields the overlay relies on, so a malformed event is dropped, not drawn. */
function validHunkEvent(e: Record<string, unknown>): boolean {
  switch (e.kind) {
    case "hunk_start":
      return (
        str(e.hunk) && str(e.call) && str(e.path) && str(e.old) &&
        ["replace", "insert", "delete", "create"].includes(e.op as string) &&
        isObj(e.range) && num(e.range.start) && num(e.range.end)
      );
    case "hunk_chunk":
    case "hunk_end":
      return str(e.hunk) && str(e.text);
    case "hunk_review":
      return str(e.call) && Array.isArray(e.hunks) && e.hunks.every(str) && str(e.reason);
    case "hunk_applied":
      return str(e.hunk) && typeof e.provisional === "boolean";
    case "hunk_rejected":
      return str(e.hunk) && ["human", "validation", "cancel"].includes(e.by as string) && str(e.reason);
    case "hunk_stale":
      return str(e.hunk) && str(e.path);
    case "validation":
      return ["running", "passed", "failed", "skipped"].includes(e.status as string) && Array.isArray(e.checks) && Array.isArray(e.baseline);
    default:
      return false;
  }
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

/** Provedores com agente v2 (F8): o backend escolhe o adaptador — Anthropic para o Claude,
 *  Chat Completions OpenAI-compatível para Codex/OpenAI, Gemini e Ollama. */
export const AGENT_PROVIDERS: readonly string[] = ["claude", "codex", "gemini", "ollama"];

export const isAgentProvider = (p: string): boolean => AGENT_PROVIDERS.includes(p);

/** Prefixo do erro de um modelo sem tool calling nativo (`codev_agent::NO_TOOLS_MARK`): a
 *  conversa recua para o protocolo de texto do harness antigo. */
export const NO_TOOLS_MARK = "[sem-ferramentas] ";

export const isNoToolsError = (e: string): boolean => e.startsWith(NO_TOOLS_MARK);

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
    case "backlog_propose":
      return `${s("title")} → .dxtutor/backlog.json (${Array.isArray(input.issues) ? input.issues.length : 0} issues)`;
    case "ide": {
      const a = input.args && typeof input.args === "object" ? (input.args as Record<string, unknown>) : {};
      // H4: the Platform/SRE/DevOps actions name a runbook step, an incident, a folder or a namespace
      const keys = ["key", "project", "filter", "sha", "path", "step", "id", "title", "severity", "kind", "dir", "env", "context", "namespace", "deployment"];
      const detail = keys.map((k) => (typeof a[k] === "string" || typeof a[k] === "number" ? String(a[k]) : "")).filter(Boolean).join(" ");
      return s("action") + (detail ? ` ${detail}` : "");
    }
    case "project_propose":
      return `${s("method") || "—"} · ${Array.isArray(input.sprints) ? input.sprints.length : 0} sprints`;
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

/** Um checkpoint de ficheiros (espelho de `codev_agent::CheckpointView`). */
export interface Checkpoint {
  id: number;
  label: string;
  created: number;
  /** A conversa também pode voltar a este ponto («Rewind to here»). */
  conversation: boolean;
}

export function parseCheckpoints(v: unknown): Checkpoint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => isObj(c) && typeof c.id === "number" && str(c.label) && typeof c.created === "number")
    .map((c) => {
      const o = c as Record<string, unknown>;
      return { id: o.id as number, label: o.label as string, created: o.created as number, conversation: o.conversation === true };
    });
}

/** As regras de permissões (espelho de `codev_agent::PermissionsView`). */
export interface Permissions {
  project: { allow: string[]; deny: string[] };
  user: { allow: string[]; deny: string[] };
  projectFile: string;
  userFile: string | null;
}

export function parsePermissions(v: unknown): Permissions {
  const o = isObj(v) ? v : {};
  const rules = (x: unknown) => {
    const r = isObj(x) ? x : {};
    const list = (a: unknown) => (Array.isArray(a) ? (a.filter(str) as string[]) : []);
    return { allow: list(r.allow), deny: list(r.deny) };
  };
  return { project: rules(o.project), user: rules(o.user), projectFile: str(o.projectFile) ? o.projectFile : "", userFile: str(o.userFile) ? o.userFile : null };
}

/** O diff a mostrar num pedido de aprovação de edit/write (`null` para as outras ferramentas). */
export function callDiff(name: string, input: Record<string, unknown>): { path: string; before: string; after: string } | null {
  const s = (k: string): string => (str(input[k]) ? (input[k] as string) : "");
  if (name === "edit") return { path: s("path"), before: s("old_string"), after: s("new_string") };
  if (name === "write") return { path: s("path"), before: "", after: s("content") };
  return null;
}

/** O que o projecto define para o agente (espelho de `codev_agent::ExtensionsStatus`). */
export interface ExtensionsStatus {
  commands: Array<{ name: string; description: string }>;
  skills: Array<{ name: string; description: string }>;
  hooks: { present: boolean; trusted: boolean };
  mcp: { present: boolean; trusted: boolean };
  /** H1: `.dxtutor/sandbox.json` (what loosens the OS sandbox counts only when trusted). */
  sandbox: { present: boolean; trusted: boolean };
  mcpServers: string[];
}

export function parseExtensions(v: unknown): ExtensionsStatus {
  const o = isObj(v) ? v : {};
  const list = (a: unknown) =>
    Array.isArray(a)
      ? a.filter((x) => isObj(x) && str(x.name)).map((x) => ({ name: (x as Record<string, unknown>).name as string, description: str((x as Record<string, unknown>).description) ? ((x as Record<string, unknown>).description as string) : "" }))
      : [];
  const ft = (x: unknown) => ({ present: isObj(x) && x.present === true, trusted: isObj(x) && x.trusted === true });
  return {
    commands: list(o.commands),
    skills: list(o.skills),
    hooks: ft(o.hooks),
    mcp: ft(o.mcp),
    sandbox: ft(o.sandbox),
    mcpServers: Array.isArray(o.mcpServers) ? (o.mcpServers.filter(str) as string[]) : [],
  };
}

/** The human request a turn answers (RF-G01, docs/v2/RF-DELONIX-PLANO.md F1.1): without one the
 *  backend blocks the turn's actions («bloqueada: sem pedido»). Who asked is filled by the backend
 *  from the project's git user. `scope`: the files the request may change (RF-G03). */
export interface AgentOrigin {
  kind: "chat" | "editor" | "issue";
  issue?: string;
  scope?: string[];
}

/** The origin of a message typed in a conversation: the issue it was opened for, or the chat. */
export const originFor = (issueKey: string | null): AgentOrigin =>
  issueKey ? { kind: "issue", issue: issueKey } : { kind: "chat" };

/** Uma issue do Board, na forma mínima que o agente precisa. */
export interface BoardStory {
  id: string;
  title: string;
  type: string;
  pts: number;
  note?: string;
}

