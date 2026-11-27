/* ═════════ feature `integration` — domínio: a autonomia delegada e os pull requests (Multi Co-Dev, fase 5) ═════════
   As regras do dono: a autonomia nunca salta a porta da fase 4 (e a aprovação funcional é sempre de um humano), e o
   revisor nunca age sozinho sem uma delegação. Quem decide é o Rust (`tutor_board::project::autonomy`,
   `crate::codev_autonomy`, `crate::codev_pr`); aqui só se estreitam as respostas de `codev_autonomy_state`,
   `codev_pr_state`/`codev_pr_open` e os eventos `codev-autonomy://event`, e se calcula o que o painel mostra. Uma
   resposta que não se lê nunca abre nada. PURO: sem DOM, sem window, sem Tauri. */

export type Action = "review" | "integrate" | "pr";
export const ACTIONS: Action[] = ["review", "integrate", "pr"];
/** As validades que o editor oferece (horas; o Rust aceita de 1 a 168). */
export const HOURS = [8, 24, 72, 168] as const;

export interface Delegation {
  id: number;
  scope: "issue" | "sprint";
  target: string;
  actions: Action[];
  provider: string | null;
  model: string | null;
  note: string;
  grantedBy: string;
  grantedAt: number;
  expiresAt: number;
  revokedBy: string | null;
  revokedAt: number | null;
  revokeReason: string | null;
}

export interface AutonomyEvent {
  id: number;
  key: string;
  delegation: number | null;
  action: string;
  trigger: string;
  outcome: string;
  code: string;
  detail: string;
  review: number | null;
  audit: number[];
  at: number;
}

export interface Switch {
  paused: boolean;
  by: string | null;
  at: number | null;
  reason: string | null;
}

export interface Overview {
  switch: Switch;
  delegations: Delegation[];
  events: AutonomyEvent[];
  used: number;
  limit: number;
  now: number;
  sprint: string | null;
  /** como a issue integra quando a porta abre: `manual`, `integrate`, `pr`, `ambiguous` */
  mode: string | null;
}

export interface GhStatus {
  installed: boolean;
  version: string;
  signedIn: boolean;
  notes: string;
}

export interface PrRecord {
  number: number;
  prUrl: string;
  branch: string;
  head: string;
  target: string;
  remote: string;
  actor: string;
  delegation: number | null;
  at: number;
}

export interface PrLive {
  number: number;
  url: string;
  state: string;
  draft: boolean;
  review: string;
  checks: { passed: number; failed: number; pending: number };
  mergedAt: string;
}

export interface PrState {
  key: string;
  gh: GhStatus | null;
  plan: string | null;
  blocked: string | null;
  record: PrRecord | null;
  live: PrLive | null;
  liveError: string | null;
}

export interface Opened {
  key: string;
  number: number;
  url: string;
  remote: string;
  branch: string;
  head: string;
  createdBranch: boolean;
}

export interface AutonomyNotice {
  root: string;
  event: AutonomyEvent;
  /** a sessão Co-Dev da issue integrada, que a interface fecha (fase 3) */
  session: string | null;
  integrated: boolean;
}

/* ───── estreitar ───── */

type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : []);
const isAction = (a: unknown): a is Action => a === "review" || a === "integrate" || a === "pr";

export function parseDelegation(v: unknown): Delegation | null {
  const o = obj(v);
  if (!o || typeof o.id !== "number" || (o.scope !== "issue" && o.scope !== "sprint") || !str(o.target)) return null;
  return {
    id: o.id,
    scope: o.scope,
    target: str(o.target),
    actions: Array.isArray(o.actions) ? o.actions.filter(isAction) : [],
    provider: strOr(o.provider),
    model: strOr(o.model),
    note: str(o.note),
    grantedBy: str(o.grantedBy),
    grantedAt: num(o.grantedAt),
    expiresAt: num(o.expiresAt),
    revokedBy: strOr(o.revokedBy),
    revokedAt: numOr(o.revokedAt),
    revokeReason: strOr(o.revokeReason),
  };
}

export function parseEvent(v: unknown): AutonomyEvent | null {
  const o = obj(v);
  if (!o || !str(o.key) || !str(o.action) || !str(o.outcome)) return null;
  return {
    id: num(o.id),
    key: str(o.key),
    delegation: numOr(o.delegation),
    action: str(o.action),
    trigger: str(o.trigger),
    outcome: str(o.outcome),
    code: str(o.code),
    detail: str(o.detail),
    review: numOr(o.review),
    audit: Array.isArray(o.audit) ? o.audit.filter((x): x is number => typeof x === "number") : [],
    at: num(o.at),
  };
}

const parseSwitch = (v: unknown): Switch => {
  const o = obj(v);
  // a switch that does not parse is treated as paused: the interface never offers more than the backend allows
  if (!o) return { paused: true, by: null, at: null, reason: null };
  // anything but an explicit `false` counts as paused
  return { paused: o.paused !== false, by: strOr(o.by), at: numOr(o.at), reason: strOr(o.reason) };
};

export function parseOverview(v: unknown): Overview | null {
  const o = obj(v);
  if (!o || !obj(o.switch)) return null;
  return {
    switch: parseSwitch(o.switch),
    delegations: list(o.delegations, parseDelegation),
    events: list(o.events, parseEvent),
    used: num(o.used),
    limit: num(o.limit),
    now: num(o.now),
    sprint: strOr(o.sprint),
    mode: strOr(o.mode),
  };
}

const parseGh = (v: unknown): GhStatus | null => {
  const o = obj(v);
  return o ? { installed: o.installed === true, version: str(o.version), signedIn: o.signedIn === true, notes: str(o.notes) } : null;
};

const parseRecord = (v: unknown): PrRecord | null => {
  const o = obj(v);
  if (!o || typeof o.number !== "number" || !str(o.prUrl)) return null;
  return { number: o.number, prUrl: str(o.prUrl), branch: str(o.branch), head: str(o.head), target: str(o.target), remote: str(o.remote), actor: str(o.actor), delegation: numOr(o.delegation), at: num(o.at) };
};

const parseLive = (v: unknown): PrLive | null => {
  const o = obj(v);
  if (!o || typeof o.number !== "number") return null;
  const c = obj(o.checks);
  return {
    number: o.number,
    url: str(o.url),
    state: str(o.state),
    draft: o.draft === true,
    review: str(o.review),
    checks: { passed: num(c?.passed), failed: num(c?.failed), pending: num(c?.pending) },
    mergedAt: str(o.mergedAt),
  };
};

export function parsePrState(v: unknown): PrState | null {
  const o = obj(v);
  if (!o || !str(o.key)) return null;
  return {
    key: str(o.key),
    gh: parseGh(o.gh),
    plan: strOr(o.plan),
    blocked: strOr(o.blocked),
    record: parseRecord(o.record),
    live: parseLive(o.live),
    liveError: strOr(o.liveError),
  };
}

export function parseOpened(v: unknown): Opened | null {
  const o = obj(v);
  if (!o || typeof o.number !== "number" || !str(o.url)) return null;
  return { key: str(o.key), number: o.number, url: str(o.url), remote: str(o.remote), branch: str(o.branch), head: str(o.head), createdBranch: o.createdBranch === true };
}

export function parseNotice(v: unknown): AutonomyNotice | null {
  const o = obj(v);
  const e = parseEvent(o?.event);
  if (!o || !e) return null;
  const i = obj(o.integrated);
  return { root: str(o.root), event: e, session: strOr(i?.session), integrated: !!i && !!str(i.commit) };
}

/* ───── o que o painel mostra ───── */

/** Activa: nem revogada nem expirada (o relógio do backend, `now`). */
export const isActive = (d: Delegation, now: number): boolean => d.revokedAt === null && now < d.expiresAt;

/** As delegações activas, as mais recentes primeiro. */
export const activeDelegations = (o: Overview): Delegation[] => o.delegations.filter((d) => isActive(d, o.now)).sort((a, b) => b.grantedAt - a.grantedAt || b.id - a.id);

/** O que pode ser pedido no editor: integrar e abrir um PR excluem-se (o Rust recusa os dois juntos). */
export function grantProblem(actions: Action[]): "none" | "both" | null {
  if (!actions.length) return "none";
  if (actions.includes("integrate") && actions.includes("pr")) return "both";
  return null;
}

/** Horas e minutos que faltam (para «expira em …»). */
export function remaining(d: Delegation, now: number): { h: number; m: number } {
  const ms = Math.max(0, d.expiresAt - now);
  return { h: Math.floor(ms / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) };
}

/** O botão «Open a pull request» acende só quando o backend deu o texto a aprovar. */
export const canOpenPr = (p: PrState | null): boolean => !!p && !!p.plan && !p.blocked;
