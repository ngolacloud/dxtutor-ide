/* ═══════════ Co-Dev — application ports (ADR-0002, Phase 3) ═══════════
   The use cases in this folder (`run-mission`, `tool-executor`, `live-chat`)
   depend ONLY on `domain/` and on the interfaces declared here. They never
   touch the DOM, `window`, Tauri or the legacy bridge — those are supplied, at
   composition time (`../index.ts`), by adapters over `infrastructure/
   legacy-bridge.ts` (for workspace/terminal/scm/…) and over `ui/chat-view.ts`
   (for the presenter and the approval gate).

   This is what makes the engine testable with fakes: give a fake `Workspace`,
   a fake `MissionPresenter` and a fake `ApprovalGate` and the mission runs with
   no browser. The dependency rule points inward: ports import `domain/`, never
   the other way round.

   `throw STOP` becomes `AbortSignal`: every long-running use case receives a
   `signal`; `beat()` and the live sampler observe `signal.aborted`. (The gate
   cancellation and the thrown STOP sentinel stay as they are because the same
   low-level helpers — `window.doTool`/`ask`/`beat`/`runState` — are shared with
   `features/board.ts`, a separate feature not covered by this ADR; see
   `../index.ts`.) */

import type {
  Mode,
  Decision,
  CheckResult,
  Question,
  Candidate,
  Step,
  Requirement,
  FileEntry,
} from "../domain/types";
import type { VerifyCommand, VerifyKind } from "../domain/project-commands";
import type { AgentEvent, ApprovalRequest, Checkpoint, ExtensionsStatus, HistoryItem, SessionSummary, Todo } from "../domain/agent-events";

/* ───────── infrastructure-shaped values the use cases pass around ───────── */

/** A provider card as the council/live-chat read it (colour, name, on-state). */
export interface ProviderInfo {
  name: string;
  model: string;
  on: boolean;
  col: string;
  ep: string;
  local?: boolean;
}

/** One running tool call, as the agent constructs it (richer than the domain's
 *  `ToolCall`, which only carries what the policy needs). */
export interface RuntimeTool {
  t: "read" | "edit" | "run";
  p?: string;
  cmd?: string;
  make?: (old: string) => string;
  content?: string;
}

/** A mission's mutable runtime record. The engine pushes decisions, files and
 *  state transitions onto it; the manager page reads it back. Kept loose (`any`
 *  fields) because its shape is the monolith's, not something this ADR fixes. */
export interface Mission {
  id: number;
  title: string;
  mode: Mode;
  state: string;
  score: number | null;
  t0: number;
  decs: Decision[];
  retries: number;
  files: Set<string>;
  ck0?: number;
  councilDec?: Decision;
  dur?: number;
}

/* ───────── opaque DOM handles (tokens the use cases pass back to the view) ─────────
   The use cases never read or build markup off these; they only hold them and
   hand them back to presenter methods. Concretely they are elements, but the
   application layer treats them as opaque. */
export type ToolHost = unknown;
export type ToolRef = unknown;
export type CardRef = { readonly tools: ToolHost; readonly body: ToolHost };

export interface ClarifyHandle {
  draw(pick: number | null, clickable: boolean): void;
  awaitPick(): Promise<number>;
  foot(by: string, status: string, basis: string): void;
}

export interface PlanHandle {
  readonly card: CardRef;
  stepStart(i: number, label: string): void;
  stepDone(i: number, ok: boolean, secs: number): void;
  progress(i: number, n: number): void;
}

export interface CouncilHandle {
  readonly card: CardRef;
  candidate(c: { L: string; prov: string; title: string; sum: string }, info: ProviderInfo): ToolRef;
  score(candEl: ToolRef, tot: number, sc: Record<string, number>): void;
  markBest(candEl: ToolRef): void;
  foot(by: string): void;
}

/* ───────── workspace / terminal / providers / scm / checkpoints ───────── */

export interface Workspace {
  files(): Record<string, FileEntry>;
  write(path: string, content: string): void;
  diffStat(old: string | null, nw: string): { add: number; del: number };
  shortPath(p: string): string;
  normalizePath(p: string): string;
  openDiff(p: string, a: string, b: string, label: string): void;
  openTab(tab: { id: string; title?: string; kind?: string; path?: string }, activate?: boolean): void;
  root(): string;
}

/** Resultado de um comando corrido a sério (desktop com pasta real). */
export interface RealRun {
  ok: boolean;
  code: number | null;
  sum: string;
  /** exit code + caudas de stdout/stderr, para devolver ao modelo */
  out: string;
}

export interface Terminal {
  /** Terminal simulado do protótipo (sem pasta real). */
  exec(cmd: string): { ok: boolean; sum?: string } | undefined;
  /** Execução real quando há pasta aberta no desktop; `null` no protótipo. Opcional
   *  para os fakes dos testes que não a exercitam. */
  realRun?(): ((cmd: string) => Promise<RealRun>) | null;
}

/** Comandos de verificação do projecto aberto (detectados por `domain/project-commands`). */
export interface Verify {
  /** Há pasta real aberta (os comandos detectados substituem o `cargo test` do exemplo). */
  real(): boolean;
  command(kind: VerifyKind): VerifyCommand | null;
}

export interface ProviderGateway {
  providers(): Record<string, ProviderInfo>;
  connected(): string[];
  activeProvider(): string;
  provFor(role: string): string;
  trackUsage(key: string, tok: number): void;
  speakerLabel(role: string): string;
  agentSys(): string;
  activeAgentName(): string;
  isDesktop(): boolean;
  sample(): Sampler | null;
}

export interface Scm {
  gfStart(kind: string, name: string): string;
  gfAsk(host: ToolHost, m: Mission): Promise<void>;
  commit(msg: string): { h: string; n: number } | null;
  staged(): Set<string>;
  isTracked(p: string): boolean;
  setAuthor(a: string): void;
}

export interface Checkpoints {
  create(label: string): number;
  restore(id: number, silent?: boolean): void;
}

/** The passage of time, as the engine sees it: `now()` for durations and
 *  `beat(ms, signal)` for the paced waits between tool calls. `beat` observes
 *  `signal.aborted` (the AbortSignal path) and the shared `RUN.stop`/pause
 *  state; it throws the STOP sentinel to unwind a stopped run. */
export interface Clock {
  now(): number;
  beat(ms: number, signal: AbortSignal): Promise<void>;
}

/** Everything a live-chat tool needs to delegate edits to an isolated worktree. */
export interface Harness {
  check(path: string): void;
  cmd(cmd: string): void;
  delegate(): ((writes: [string, string][]) => Promise<{ status: string; patch?: string; error?: string }>) | undefined;
}

export interface Notifier {
  log(tag: string, msg: string): void;
  note(msg: string): void;
  toast(msg: string): void;
}

/* ───────── live sampler (Claude ao vivo) ───────── */
export interface SampleMsg {
  role: string;
  content?: unknown;
}
export interface SampleOpts {
  tools?: unknown[];
  signal?: AbortSignal | null;
  onText?: (x: { text: string }) => void;
  cache?: boolean;
}
export interface SampleResult {
  text?: string;
  [k: string]: unknown;
}
export type Sampler = (input: string | SampleMsg[], o?: SampleOpts) => Promise<SampleResult>;

/* ───────── chat / live-chat state ───────── */
export interface ChatStore {
  messages(): { role: string; content: string }[];
  activeTabPath(): string | null;
}

/* ═══════════ presentation ports ═══════════
   The view owns every byte of HTML and all DOM/run-control side-effects. Each
   method mirrors a chunk that was inline in the old engine; the use cases call
   them with plain data and hold the returned handles. */

export interface MissionPresenter {
  /* general transcript + run control */
  scrollMsgs(): void;
  userMessage(text: string): void;
  isRunning(): boolean;
  /** Um sub-agente (`task`) arrancou ou terminou — o chip «agentes» do compositor. */
  subagent?(id: string, label: string, state: "running" | "done" | "error"): void;
  beginRun(label: string): void;
  endRun(): void;
  setMissionContext(m: Mission | null): void;
  startAbort(): AbortSignal;
  setLabel(label: string): void;
  trackFile(path: string): void;
  phase(n: number, label: string): void;
  revealTerminal(): void;
  /** The shared stop sentinel (`window.STOP`); thrown to unwind a mission the
   *  human stopped, and compared against in `runMission`'s catch. Shared with
   *  `features/board.ts`, so it stays a value rather than an `AbortError`. */
  stopValue(): unknown;

  /* tool lines */
  toolLine(host: ToolHost, name: string, arg: unknown): ToolRef;
  toolOk(ref: ToolRef): void;
  toolNoChange(host: ToolHost, shortPath: string): void;
  toolEdit(host: ToolHost, o: { create: boolean; shortPath: string; add: number; del: number; onDiff: () => void }): ToolRef;
  toolRun(host: ToolHost, cmd: string): ToolRef;
  toolRunResult(ref: ToolRef, ok: boolean, sum: string): void;

  /* mission cards */
  systemNoProvider(): void;
  scenarioReady(msg: string): void;
  understandStart(speaker: string): CardRef;
  understandDone(ref: CardRef, understand: string, reqs: Requirement[]): void;
  clarify(speaker: string, q: Question, showLowConf: boolean, pct: number): ClarifyHandle;
  councilCard(speaker: string, count: number): CouncilHandle;
  plan(speaker: string, title: string, steps: Step[]): PlanHandle;
  evalCard(speaker: string, again: boolean): CardRef;
  evalResult(ref: CardRef, o: { score: number; ok: boolean; res: CheckResult[]; threshold: number }): void;
  reflectCard(speaker: string, o: { score: number; threshold: number; fails: CheckResult[]; sw: boolean }): CardRef;
  blocked(speaker: string, score: number, threshold: number, fails: CheckResult[]): void;
  deliver(speaker: string, o: DeliverView): CardRef;
  commitConfirm(ref: CardRef, hash: string, mode: Mode, commitMsg: string): void;
  missionError(msg: string): void;
  missionStopped(): void;

  /* live chat */
  providerOff(name: string): void;
  providerSimulated(name: string, ep: string): void;
  liveUnavailable(): void;
  thinking(speaker: string): CardRef;
  assistantText(ref: CardRef, text: string): void;
  liveError(ref: CardRef, aborted: boolean, code: string | undefined, msg: string): void;
  refreshCtx(): void;
  /* agente v2 (ADR-0003, F4) — opcionais para os fakes dos testes antigos */
  /** Resumo do raciocínio do modelo (thinking `summarized`), discreto, no cartão. */
  agentReasoning?(ref: CardRef, text: string): void;
  /** Nota no rodapé do cartão: uso/custo, fallback, repetição, fim anormal. */
  agentNote?(ref: CardRef, key: string, text: string): void;
  /** Porque é que uma chamada pede aprovação (`dangerous`: piso de segurança). */
  toolReason?(ref: ToolRef, reason: string, dangerous: boolean): void;
  /** A lista de tarefas do agente (substitui a anterior no cartão). */
  agentTodos?(ref: CardRef, todos: Todo[]): void;
  /** O plano proposto (markdown), dentro do pedido de aprovação. */
  agentPlan?(ref: ToolRef, markdown: string): void;
  /** Botão «ver diff» numa linha de ferramenta. */
  toolDiffLink?(ref: ToolRef, onDiff: () => void): void;
  /** Live hunks waiting for a decision (RF-CODEV-STREAM): a bar on the tool line with
   *  «accept all / reject all / open in the editor». `settle` replaces it with the outcome
   *  when the review ends (from the chat or from the editor). */
  hunkReview?(
    ref: ToolRef,
    info: { path: string; count: number; reason: string },
    on: { acceptAll(): void; rejectAll(): void; open(): void },
  ): { settle(label: string): void };
}

export interface DeliverView {
  title: string;
  score: number;
  retries: number;
  done: string[];
  assumptions: { q: string; choice: string }[];
  decCount: number;
  fileCount: number;
}

/** The approval gate: the human say-so on edits, commands, plans and council
 *  picks. Backed by `window.ask` (shared with board.ts), so its cancellation
 *  stays on the legacy `RUN.pend` path rather than taking a signal. */
export interface ApprovalGate {
  ask<T>(host: ToolHost, btns: Array<{ l: string; v: T; pri?: unknown; done?: string }>): Promise<T>;
}

/* ───────── composed dependency bundles handed to the use cases ───────── */

export interface ToolDeps {
  workspace: Workspace;
  terminal: Terminal;
  providers: ProviderGateway;
  notifier: Notifier;
  presenter: MissionPresenter;
  gate: ApprovalGate;
  clock: Clock;
  rules: import("../domain/policy").CommandRules;
  mode(): Mode;
}

export interface MissionDeps extends ToolDeps {
  scm: Scm;
  checkpoints: Checkpoints;
  missions: Mission[];
  decisions: Decision[];
  nextId(): number;
  threshold(): number;
  refresh(): void;
  tool(t: RuntimeTool, host: ToolHost, role?: string, signal?: AbortSignal): Promise<unknown>;
}

/** O agente v2 em Rust (comandos `codev_agent_*` e os seus eventos). */
export interface AgentGateway {
  /** Desktop, pasta real aberta, provedor com agente v2 e harness v2 ligado (o antigo fica
   *  atrás de uma flag). */
  available(): boolean;
  start(o: {
    root: string;
    /** `claude`/`codex`/`gemini`/`ollama` (F8). Numa retoma vale o gravado na sessão. */
    provider: string;
    model: string;
    effort: string;
    testCmd: string | null;
    lintCmd: string | null;
    mode: string;
    resume?: string | null;
    /** Live hunks: edits stream into the editor and are decided hunk by hunk. */
    reviewEdits?: boolean;
  }): Promise<string>;
  /** Decides the hunks of a `hunk_review` (hunks without a decision count as rejected). */
  review(session: string, call: string, decisions: Array<{ hunk: string; accept: boolean; reason?: string }>): Promise<void>;
  /** As sessões gravadas do projecto. */
  sessions(root: string): Promise<SessionSummary[]>;
  /** O histórico simplificado de uma sessão aberta. */
  history(session: string): Promise<HistoryItem[]>;
  setPlan(session: string, on: boolean): Promise<void>;
  checkpoints(session: string): Promise<Checkpoint[]>;
  rewind(session: string, checkpoint: number): Promise<string>;
  extensions(root: string): Promise<ExtensionsStatus>;
  trust(root: string, kind: "hooks" | "mcp"): Promise<void>;
  send(session: string, text: string | null): Promise<void>;
  approve(session: string, toolUseId: string, allow: boolean, reason?: string, remember?: boolean): Promise<boolean>;
  cancel(session: string): Promise<boolean>;
  setMode(session: string, mode: string): Promise<boolean>;
  close(session: string): Promise<boolean>;
  /** Liga os três eventos do agente; devolve a função que os desliga. */
  subscribe(h: {
    event(session: string, e: AgentEvent): void;
    approval(session: string, r: ApprovalRequest): void;
    error(session: string, message: string): void;
  }): Promise<() => void>;
}

export interface AgentChatDeps {
  gateway: AgentGateway;
  presenter: MissionPresenter;
  gate: ApprovalGate;
  verify: Verify;
  workspace: Pick<Workspace, "root">;
  /** O agente escreve no disco: depois de cada turno a árvore do editor relê-o. */
  reloadFromDisk(): Promise<void>;
  /** O provedor activo (o seletor de modelo da conversa). */
  provider(): string;
  /** O esforço escolhido no compositor (só o Claude o usa). Por omissão `high`. */
  effort?(): string;
  model(): string;
  mode(): string;
  speaker(): string;
  /** Segundos desde a época (relógio injectado para os testes). */
  nowSecs(): number;
  /** Abre um diff (antes/depois) numa tab do editor. */
  openDiff(path: string, before: string, after: string, label: string): void;
  /** Live hunks in the editor (RF-CODEV-STREAM); absent → edits are approved per call. */
  hunks?: HunkSink;
  /** Saves what the editor has to disk before the agent reads it (autosave flush). */
  flush?(): Promise<void>;
}

/** Where the agent chat sends the hunk events of a turn. */
export interface HunkSink {
  event(session: string, e: AgentEvent): void;
  /** Accept or reject every open hunk of a call (the chat's review bar). */
  decideAll(call: string, accept: boolean): void;
  /** Shows a file's hunks in the editor. */
  open(path: string): void;
  /** Registers what to do when a call's review ends (to settle the chat bar). */
  onSettled(call: string, f: (label: string) => void): void;
}

/** What the live-hunk use case needs from the world. */
export interface HunkReviewDeps {
  review(session: string, call: string, decisions: Array<{ hunk: string; accept: boolean; reason?: string }>): Promise<void>;
  flush(): Promise<void>;
  reloadFromDisk(): Promise<void>;
  editor: {
    /** The view of a file changed: redraw it if it is on screen. */
    repaint(path: string): void;
    /** Opens a file of the project (relative path) in the editor. */
    open(path: string): void;
    /** The relative path of the file on screen, or `null`. */
    current(): string | null;
    /** Scrolls so view line `line` (0-based) is visible. */
    reveal(line: number): void;
    /** Shows a proposed new file (it does not exist on disk until accepted). */
    preview(path: string, text: string): void;
  };
  /** Runs `f` every `ms`; returns how to stop it. */
  every(ms: number, f: () => void): () => void;
  /** Characters per second of the typing (40 by default). */
  pace(): number;
  notify(msg: string): void;
  /** Stops the turn (Esc). */
  cancel(): void;
}
export interface LiveDeps {
  workspace: Workspace;
  providers: ProviderGateway;
  notifier: Notifier;
  presenter: MissionPresenter;
  harness: Harness;
  /** Opcional: sem ele, run_tests/design_lint mantêm o comportamento do exemplo. */
  verify?: Verify;
  chat: ChatStore;
  modeLabel(): string;
  projectRules(): string;
  setLiveOk(): void;
  refresh(): void;
  tool: (t: RuntimeTool, host: ToolHost, role?: string, signal?: AbortSignal) => Promise<unknown>;
}

export type { Candidate };

/* ───────── ditado local (whisper.cpp no backend) ───────── */
export interface DictationStatus {
  ready: boolean;
  binary: string | null;
  model: string | null;
  recorder: string | null;
  missing: string[];
  recording: boolean;
  device: number | null;
}

/** Microfone → texto sem sair da máquina. `available()` é falso fora do desktop. */
export interface DictationPort {
  available(): boolean;
  status(): Promise<DictationStatus>;
  start(): Promise<void>;
  /** Pára e transcreve (`lang`: `pt`, `en`, … ou `auto`). */
  stop(lang: string): Promise<string>;
  cancel(): Promise<void>;
}

/** A parte desktop do Co-Dev (ADR-0004, U4h5), injectada pela app Tauri em `desktopPorts.codev`.
 *  Os membros são opcionais (preenchem-nos módulos desktop diferentes: os modelos reais e as
 *  demos) e cada um recebe a versão simulada (`virtual`). */
export interface CodevDesktop {
  /** a nota «desktop» por baixo do painel do agente */
  updateAgentUI?(virtual: () => void): void;
  /** «Test connection» contra o modelo real */
  testProv?(k: string, btn: HTMLElement, virtual: (k: string, btn: HTMLElement) => void): unknown;
  /** estado de cada provedor (local / live / no key) */
  provState?(k: string, virtual: (k: string) => string): string;
  /** a página Settings com as chaves reais (providers.json) e as capacidades do backend */
  settings?(t: unknown, host: HTMLElement, virtual: (t: unknown, host: HTMLElement) => void): void;
  /** as missões são demos guionadas: com uma pasta real aberta, avisa e não corre */
  runMission?<S>(scenario: S, text: string, virtual: (scenario: S, text: string) => unknown): unknown;
}
