/* ═════════ feature `integration` — domínio: a revisão Co-Dev e a porta de integração (Multi Co-Dev, fase 4) ═════════
   A regra do dono: uma mudança só entra no ramo por omissão se (1) todas as verificações obrigatórias
   passaram no candidato ACTUAL (o ramo da issue fundido na ponta actual do ramo por omissão), (2) o revisor
   Co-Dev confirmou cada critério de aceitação com evidência, para esse candidato e esses critérios, e (3) o
   responsável registou a aprovação funcional para os critérios de agora. Quem decide é o Rust
   (`tutor_board::project::integration::gate`, outra vez no clique); aqui só se estreitam as respostas de
   `codev_review_state`/`codev_review_integrate` e os eventos `codev-review://event`, e se calcula o que o
   painel mostra. PURO: sem DOM, sem window, sem Tauri. */

export type ConditionId = "checks" | "reviewer" | "functional";

/** Uma condição da porta: se vale e, como código, porquê (`items`: verificações, critérios, ficheiros…). */
export interface Condition {
  ok: boolean;
  code: string;
  items: string[];
}

export interface Gate {
  checks: Condition;
  reviewer: Condition;
  functional: Condition;
  ok: boolean;
}

export interface Tips {
  target: string;
  base: string;
  branch: string;
  head: string;
}

export interface Check {
  name: string;
  command: string;
}

export interface CheckRun extends Check {
  exit: number | null;
  passed: boolean;
  tail: string;
  ms: number;
  timedOut: boolean;
}

export interface ArchFinding {
  rule: string;
  message: string;
  path: string;
  line: number | null;
}

export interface Evidence {
  kind: string;
  ref: string;
  lines: string | null;
  detail: string | null;
}

export interface CriterionVerdict {
  index: number;
  text: string;
  status: string;
  evidence: Evidence[];
  note: string;
}

export interface Verdict {
  overall: string;
  summary: string;
  criteria: CriterionVerdict[];
}

export interface Review {
  id: number;
  key: string;
  tips: Tips;
  candidate: string;
  tree: string;
  criteria: string[];
  required: Check[];
  checks: CheckRun[];
  archRules: boolean;
  arch: ArchFinding[];
  conflicts: string[];
  /** quantos achados o secret scan do que o candidato traz deu (`null`: não correu) */
  scanFindings: number | null;
  verdict: Verdict | null;
  reviewer: string | null;
  tokensIn: number;
  tokensOut: number;
  state: string;
  error: string | null;
  actor: string;
  created: number;
  updated: number;
}

export interface ReviewState {
  key: string;
  title: string;
  review: Review | null;
  running: boolean;
  tips: Tips | null;
  tipsError: string | null;
  ahead: number;
  checks: Check[];
  criteria: string[];
  gate: Gate;
  request: string | null;
  requestBlocked: string | null;
  integrate: string | null;
  uncommitted: string[];
  session: string | null;
}

export interface Integrated {
  key: string;
  target: string;
  commit: string;
  snapshot: number;
  state: string;
  session: string | null;
  worktreeRemoved: boolean;
  worktreeKept: string[];
}

/** Um passo de uma revisão a correr. */
export interface ReviewEvent {
  root: string;
  key: string;
  review: number;
  stage: string;
  name: string | null;
  index: number | null;
  passed: boolean | null;
  tool: string | null;
  state: string | null;
}

/* ───── estreitar ───── */

type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const list = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : []);

const parseCondition = (v: unknown): Condition => {
  const o = obj(v);
  return { ok: o?.ok === true, code: str(o?.code) || "unknown", items: strs(o?.items) };
};

const parseTips = (v: unknown): Tips | null => {
  const o = obj(v);
  if (!o || !str(o.target) || !str(o.branch)) return null;
  return { target: str(o.target), base: str(o.base), branch: str(o.branch), head: str(o.head) };
};

const parseCheck = (v: unknown): Check | null => {
  const o = obj(v);
  return o && str(o.name) ? { name: str(o.name), command: str(o.command) } : null;
};

const parseRun = (v: unknown): CheckRun | null => {
  const o = obj(v);
  if (!o || !str(o.name)) return null;
  return { name: str(o.name), command: str(o.command), exit: numOr(o.exit), passed: o.passed === true, tail: str(o.tail), ms: num(o.ms), timedOut: o.timedOut === true };
};

const parseEvidence = (v: unknown): Evidence | null => {
  const o = obj(v);
  return o && str(o.kind) && str(o.ref) ? { kind: str(o.kind), ref: str(o.ref), lines: strOr(o.lines), detail: strOr(o.detail) } : null;
};

const parseVerdict = (v: unknown): Verdict | null => {
  const o = obj(v);
  if (!o || !str(o.overall)) return null;
  return {
    overall: str(o.overall),
    summary: str(o.summary),
    criteria: list(o.criteria, (c) => {
      const x = obj(c);
      return x && typeof x.index === "number"
        ? { index: x.index, text: str(x.text), status: str(x.status), evidence: list(x.evidence, parseEvidence), note: str(x.note) }
        : null;
    }),
  };
};

export function parseReview(v: unknown): Review | null {
  const o = obj(v);
  const tips = parseTips(o?.tips);
  if (!o || !tips || typeof o.id !== "number") return null;
  const scan = obj(o.scan);
  return {
    id: o.id,
    key: str(o.key),
    tips,
    candidate: str(o.candidate),
    tree: str(o.tree),
    criteria: strs(o.criteria),
    required: list(o.required, parseCheck),
    checks: list(o.checks, parseRun),
    archRules: o.archRules === true,
    arch: list(o.arch, (a) => {
      const x = obj(a);
      return x ? { rule: str(x.rule), message: str(x.message), path: str(x.path), line: numOr(x.line) } : null;
    }),
    conflicts: strs(o.conflicts),
    scanFindings: scan && Array.isArray(scan.findings) ? scan.findings.length : null,
    verdict: parseVerdict(o.verdict),
    reviewer: strOr(o.reviewer),
    tokensIn: num(o.tokensIn),
    tokensOut: num(o.tokensOut),
    state: str(o.state),
    error: strOr(o.error),
    actor: str(o.actor),
    created: num(o.created),
    updated: num(o.updated),
  };
}

export function parseState(v: unknown): ReviewState | null {
  const o = obj(v);
  const g = obj(o?.gate);
  if (!o || !str(o.key) || !g) return null;
  return {
    key: str(o.key),
    title: str(o.title),
    review: parseReview(o.review),
    running: o.running === true,
    tips: parseTips(o.tips),
    tipsError: strOr(o.tipsError),
    ahead: num(o.ahead),
    checks: list(o.checks, parseCheck),
    criteria: strs(o.criteria),
    // a gate that does not parse never opens: every condition false
    gate: { checks: parseCondition(g.checks), reviewer: parseCondition(g.reviewer), functional: parseCondition(g.functional), ok: g.ok === true },
    request: strOr(o.request),
    requestBlocked: strOr(o.requestBlocked),
    integrate: strOr(o.integrate),
    uncommitted: strs(o.uncommitted),
    session: strOr(o.session),
  };
}

export function parseIntegrated(v: unknown): Integrated | null {
  const o = obj(v);
  if (!o || !str(o.commit) || !str(o.key)) return null;
  return {
    key: str(o.key),
    target: str(o.target),
    commit: str(o.commit),
    snapshot: num(o.snapshot),
    state: str(o.state),
    session: strOr(o.session),
    worktreeRemoved: o.worktreeRemoved === true,
    worktreeKept: strs(o.worktreeKept),
  };
}

export function parseEvent(v: unknown): ReviewEvent | null {
  const o = obj(v);
  if (!o || !str(o.key) || !str(o.stage)) return null;
  return {
    root: str(o.root),
    key: str(o.key),
    review: num(o.review),
    stage: str(o.stage),
    name: strOr(o.name),
    index: numOr(o.index),
    passed: typeof o.passed === "boolean" ? o.passed : null,
    tool: strOr(o.tool),
    state: strOr(o.state),
  };
}

/* ───── o que o painel mostra ───── */

/** As três condições pela ordem da regra. */
export const conditions = (g: Gate): Array<{ id: ConditionId; c: Condition }> => [
  { id: "checks", c: g.checks },
  { id: "reviewer", c: g.reviewer },
  { id: "functional", c: g.functional },
];

/** Porque é que «Integrate» está desligado: as condições que não valem (vazio: pode integrar — e só se o
 *  backend também deu o comando). */
export const blockers = (s: ReviewState): Array<{ id: ConditionId; c: Condition }> => conditions(s.gate).filter((x) => !x.c.ok);

/** O botão «Integrate» acende só com a porta aberta E o comando do backend. */
export const canIntegrate = (s: ReviewState): boolean => s.gate.ok && !!s.integrate && blockers(s).length === 0 && !s.running;

/** A evidência como uma linha: `src/pay.rs:12-30`, `test pays_a_cart`, `output tests — «ok»`. */
export function evidenceText(e: Evidence): string {
  if (e.kind === "file") return e.lines ? `${e.ref}:${e.lines}` : e.ref;
  if (e.kind === "test") return `test ${e.ref}`;
  return `output ${e.ref}${e.detail ? ` — «${e.detail}»` : ""}`;
}

/** Abreviatura de um commit. */
export const short = (sha: string): string => sha.slice(0, 8);

/** A revisão tem verificações a mostrar com o seu estado (corrida ou à espera, durante uma revisão a correr). */
export function checkRows(s: ReviewState): Array<{ name: string; command: string; run: CheckRun | null }> {
  const r = s.review;
  const required = r && r.required.length ? r.required : s.checks;
  return required.map((c) => ({ name: c.name, command: c.command, run: r?.checks.find((x) => x.name === c.name && x.command === c.command) ?? null }));
}
