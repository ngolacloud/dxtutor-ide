/* ═════════ dxtutor IDE — desktop: tipos partilhados (ADR-0004, U4h1) ═════════
   Os contratos do lado desktop (o objecto `DXR`, o estado git real, as opções do sampler…)
   e o `declare global` das globais do monólito que só o desktop usa. Viviam no topo do
   bridge.ts; os módulos de platform/desktop/ importam-nos daqui. */

import type { LoadedWorkspace } from "../tauri/workspace";
import type { VerifyKind, VerifyCommand } from "../../features/codev/domain/project-commands";
import type { AgentTask } from "../tauri/agent-tasks";
import type { AppInfo } from "../tauri/app";

export interface ProcHandler { line: (l: string, err?: boolean) => void; exit: (code: number) => void }
/** Workspace carregado: contrato tipado do adaptador `platform/tauri/workspace`. */
export type Workspace = LoadedWorkspace;
export interface CommitNode { h: string; m: string; p: string[]; b: string | null; a: string; t: number; files: unknown[] }
export interface GitState {
  c: Record<string, CommitNode>; order: string[]; refs: Record<string, string>;
  trees: Record<string, Record<string, string>>; base: Record<string, unknown>; tags: Record<string, string>;
}
export interface Prov { name: string; model: string; ep?: string; on?: boolean; local?: boolean; col?: string }
export interface Envs { rt: string; rtOn: boolean; sock: Record<string, string>; kube: string; k8sOn: boolean; ctx: string; ns: string }
export interface Tool { name: string; description?: string; inputSchema?: Record<string, unknown>; execute: (input: any) => unknown }
export interface SampleOpts { tools?: Tool[]; signal?: AbortSignal | null; onText?: (x: { text: string }) => void; step?: string | null; cache?: boolean; modelTier?: string; modelHint?: string }
export interface SampleMsg { role: string; content?: unknown }

/** O objecto R exposto como window.DXR — tem de continuar atribuível ao Dxr que o pair.ts declara. */
/** Resultado real de um comando corrido pelo Co-Dev: `ok` vem do código de saída. */
export interface VerifyOutcome { ok: boolean; code: number | null; sum: string; out: string }
export interface Desktop {
  root: string | null; name: string | null; git: boolean; prefix: string;
  disk: Record<string, string>; cwd: string | null; info: AppInfo;
  keys: Record<string, unknown>; proc: string | null;
  handlers: Record<string, ProcHandler>; errors: string[]; busy: number;
  remote?: boolean; ready?: boolean; user?: string; host?: string; sock?: string; kube?: string;
  idle?: () => Promise<unknown>; flush?: () => void;
  reloadDisk?: () => Promise<void>; syncGit?: () => Promise<void>;
  termLine?: (t: string, e?: boolean) => void; envFor?: () => Record<string, string>;
  gitInit?: () => unknown; approve?: (id: string, ok: boolean) => void;
  logs?: (cmd: string) => unknown; open?: (p?: string) => unknown; close?: () => void;
  delegate?: (writes: [string, string][], o?: { signal?: AbortSignal | null; onStatus?: (s: string) => void }) => Promise<DelegateResult>;
  cancelTask?: (id: string) => Promise<boolean>;
  exec?: (cmd: string) => Promise<VerifyOutcome>;
  projectCmd?: (kind: VerifyKind) => VerifyCommand | null;
  delegateReview?: (title: string, writes: [string, string][]) => Promise<void>;
  readStack?: () => Promise<void>;
  /** Terminais reais (features/panel): tarefas num PTY + canais do Output. Só no desktop. */
  term?: {
    runTask: (line: string, o?: { env?: Record<string, string>; cwd?: string; label?: string }) => Promise<number>;
    log: (channel: string, text: string, err?: boolean) => void;
    inspect: () => {
      terminals: { id: string; kind: string; label: string | null; shell: string; process: string | null; cwd: string | null; exited: number | null }[];
      failures: { command: string; exitCode: number; output: string }[];
      problems: number; scanning: boolean; scanned: boolean;
      create: (cwd?: string) => string; write: (id: string, data: string) => void; kill: (id: string) => void; text: (id: string) => string;
    };
  };
}
/** Resultado de uma delegação isolada (agent_task_* → git worktree de HEAD). */
export type DelegateResult = AgentTask;

declare global {
  // Globais lexicais (let/const em boot.js/app.js) que o pair.ts não declara.
  const STAGED: Set<string>;
  const GIT: GitState;
  const COMMITS: { h: string; m: string }[];
  const LS: { get: (k: string, d?: any) => any; set: (k: string, v: unknown) => void };
  const TREE: { projects: { children: Record<string, unknown> } };
  const PROV: Record<string, Prov>;
  const ENVS: Envs;
  const RTN: Record<string, string>;
  const KCTX: string[];
  const AGENTS: Record<string, { n: string }>;
  const STOP: unknown;
  let MODE: string; // mutável — o boot5 (app.ts) reatribui (MODE=HARN.ceiling) e o auto-teste também
  var ACTIVE: string;
  const COMMIT_MSG: string;
  const isFlow: (b: string) => boolean;
  // Motor do grafo de commits (dono = features/scm.ts), lido por nome livre pela
  // feature strict features/graph.ts (e pelos consumidores do monólito).
  const graphLayout: () => { rows: { h: string; col: number; pl: number[] }[]; idx: Record<string, number>; max: number };
  const LANE: string[];
  const authorOf: (a: string) => { n: string; col: string };
  const rel: (t: number) => string;
  let GSEL: string | null;
  const changes: () => string[];
  const stOf: (p: string) => unknown;
  const use: (p: string, tok: number) => void;
  const infraDraw: () => void;
  const goPane: (p: string) => void;
  const saveEnv: () => void;
  // Lexicais que o bridge re-atribui (let em app.js).
  let STACK: { name: string; src: string; url: string; state: string }[] | null;
  let DEVC: unknown;
  let K8S: unknown;
  let SAMPLE: ((input: string | SampleMsg[], o?: SampleOpts) => Promise<any>) | null;
  let LIVE_OK: boolean;
  let provState: (k: string) => string;
  // Globais function-declaradas (vivem no window): re-atribuíveis a partir do módulo.
  var termRefreshPrompt: () => void;
  var echoCmd: (v?: string) => void;
  var rerender: (k: string) => void;
  var card: (w: string, html: string) => { el: HTMLElement; bd: HTMLElement; tools: HTMLElement };
  var syncTree: (...a: any[]) => void;
  var commit: (msg?: string, author?: string) => unknown;
  var checkout: (b: string, create?: boolean) => boolean;
  var stage: (p: string) => void;
  var gitMerge: (src: string, author?: string) => CommitNode | null;
  var gfStart: (kind: string, name: string) => string;
  var gfFinish: (b?: string, author?: string) => CommitNode | null;
  var updateAgentUI: (...a: any[]) => void;
  var testProv: (k: string, btn: HTMLElement) => unknown;
  var rtConnect: () => unknown;
  var k8sConnect: () => unknown;
  var dxRun: (term?: unknown) => { ok: boolean; sum?: string };
  var dxStop: (term?: unknown) => void;
  var dxDeploy: () => { ok: boolean; sum?: string };
  var drawStack: (...a: any[]) => void;
  var k8sDocs: () => any[];
  var needRt: () => unknown;
  var dcAttach: () => unknown;
  var dcDetach: () => unknown;
  var drawRemote: () => void;
  var hydrateEnvs: () => void;
  var runMission: (S: any, text?: any) => unknown;
  var runSprint: (s: any) => unknown;
  var loadJSZip: () => Promise<unknown>;
  var termExec: (v: string) => unknown;
  var JSZip: unknown;
  // Donas de features/checkpoint.ts, lidas por nome livre pelo selftest (passo `checkpoint`).
  var checkpoint: (label: string) => number;
  var restoreCkpt: (id: number, silent?: boolean) => void;
  var gfAsk: (host: HTMLElement, M: { files: Set<string> }) => Promise<void>;
  // Dona de features/graph.ts, lida pelo selftest (passo `graph`).
  var renderGraphView: (tab: unknown, host: HTMLElement) => void;
  // Dona de features/termgit.ts, lida pelo selftest (passo `termgit`).
  var gitCmd: (a: string[], raw: string) => { ok: boolean } | undefined;
  // Donas de features/codereview.ts, lidas pelo selftest (passo `codereview`).
  var reviewFindings: (p: string) => { l: number; sev: string; t: string; why: string; fix: string }[];
  var renderCreviewView: (tab: unknown, host: HTMLElement) => void;
  var renderHoodView: (tab: unknown, host: HTMLElement) => void;
  var explainCmd: (fromDebug?: boolean) => void;
}
