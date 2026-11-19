/* ═══════════ Co-Dev — domain types (ADR-0002, Phase 2) ═══════════
   Pure TypeScript shapes for the Co-Dev domain: autonomy modes, the approval
   decision, tool calls, the mission scenarios and their verification rubric.

   Dependency rule (ADR-0002): this folder imports NOTHING — no DOM, no
   `window`, no Tauri, no `application/`/`ui/`/`infrastructure/`. Anything the
   scenarios need from the running app (file reads, test runs, workspace paths,
   seed data) arrives through the `ScenarioEnv` port, supplied by the caller;
   the domain never reaches out for it. */

/** Autonomy level chosen by the human. */
export type Mode = "manual" | "assist" | "auto";

/** Whether a tool call proceeds automatically or needs human approval first. */
export type Approval = "auto" | "ask";

/** The three tool kinds the agent can run. */
export type ToolKind = "read" | "edit" | "run";

/** A tool call, as seen by the approval policy. The engine's runtime tool
 *  objects carry more (path, `make`, `content`); the policy only needs the
 *  kind and, for `run`, the command string. */
export interface ToolCall {
  kind: ToolKind;
  cmd?: string;
}

/* ───────── scenario data ───────── */

/** A runtime tool object inside a scenario step. Mirrors the shape the engine
 *  (`doTool`/`execSteps`) consumes today; `make` is a pure text transform. */
export interface StepTool {
  t: ToolKind;
  p?: string;
  cmd?: string;
  make?: (old: string) => string;
  content?: string;
}

/** One step of a plan or fix: a label and the tools it runs. `for` tags a fix
 *  step to the id of the check it repairs (incremental strategy). */
export interface Step {
  l: string;
  tools: StepTool[];
  for?: string;
}

/** A model proposal in the council. `sc` is scored per rubric key (c/a/t/r/k). */
export interface Candidate {
  prov: string;
  title: string;
  sum: string;
  sc: Record<string, number>;
  steps?: Step[];
}

/** A clarification question put to the human (or decided by the agent). */
export interface QuestionOption {
  l: string;
  why: string;
}
export interface Question {
  q: string;
  opts: QuestionOption[];
  best: number;
  conf: number;
  basis: string;
}

/** A requirement with its acceptance criteria, shown in the "understand" phase. */
export interface Requirement {
  t: string;
  ac: string[];
}

/** One scored acceptance check. `fn` returns a truthy/falsy value the engine
 *  coerces with `!!`; it is left as `unknown` so the scenario predicates keep
 *  their exact current return values. */
export interface Check {
  id: string;
  l: string;
  w: number;
  fn: () => unknown;
  cause?: string;
  fixd?: string;
}

/** How to recover after a failed self-evaluation: switch approach (revert to
 *  the baseline checkpoint and redo) or fix incrementally. */
export interface FixSpec {
  strategy: "switch" | "inc";
  steps?: Step[];
}

/** Git-flow branch to open for this scenario. Replaces the engine's old
 *  `S.id==='a' ? 'fix' : 'feature'` branch. */
export interface FlowSpec {
  kind: "fix" | "feature" | "hotfix";
  branch: string;
}

/** A complete demonstration mission, as data. */
export interface Scenario {
  id: string;
  title: string;
  prompt: string;
  match: RegExp;
  pkg: string;
  flow: FlowSpec;
  ready: () => string | null;
  reads: string[];
  understand: string;
  reqs: Requirement[];
  questions: Question[];
  cands: Candidate[];
  best: number;
  verify: string[];
  steps?: Step[];
  fix: FixSpec;
  checks: Check[];
  done: string[];
  commit: string;
}

/* ───────── mission runtime shapes ───────── */

/** A recorded decision within a mission (clarification, council, self-fix). */
export interface Decision {
  id?: number;
  phase: string;
  q: string;
  choice: string;
  by: string;
  conf?: number;
  basis: string;
  status: "ok" | "pressuposto" | "corrigida";
  mission?: string;
}

/** One acceptance check plus the pass/fail it resolved to. */
export interface CheckResult extends Check {
  ok: boolean;
}

/** Result of one self-evaluation pass. */
export interface Evaluation {
  score: number;
  ok: boolean;
  fails: CheckResult[];
}

/* ───────── scenario port ───────── */

export interface FileEntry {
  content: string;
  orig: string | null;
}

export interface TestReport {
  build: boolean;
  err: string;
  ok: boolean;
  tests: Array<{ n: string; ok: boolean }>;
}

/** Absolute workspace paths a scenario references (owned by the app shell). */
export interface ScenarioPaths {
  root: string;
  lx: string;
  repo: string;
  mig: string;
  test: string;
  hist: string;
  adr: string;
  store: string;
}

/** Prototype workspace seed: baseline file contents + generated snippets. */
export interface ScenarioSeed {
  base: Record<string, string>;
  gen: Record<string, string>;
}

/** Everything a scenario's predicates (`ready`, `checks[].fn`) need from the
 *  running workspace. Injected by the caller so the scenario modules stay pure
 *  (no `window`, no bridge import). */
export interface ScenarioEnv {
  paths: ScenarioPaths;
  seed: ScenarioSeed;
  files(): Record<string, FileEntry>;
  has(path: string, re: RegExp): boolean;
  fileDiffStat(a: string | null, b: string): { add: number; del: number };
  runTests(pkg?: string): TestReport;
  dsLint(): unknown[];
  lexBug(): boolean;
}
