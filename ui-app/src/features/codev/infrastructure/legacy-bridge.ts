/* ═════════ dxtutor IDE — Co-Dev: legacy bridge (ADR-0002, Phase 1) ═════════
   The ONLY file in the Co-Dev feature allowed to read or write `window.*`.
   `features/codev.ts` imports everything it needs from here instead of using
   free global identifiers, so it can be type-checked strictly like core.ts.

   Every accessor below reads `window`/`G` at CALL time, never at import time:
   features evaluate before `app.ts` publishes its globals (`Object.assign
   (window, {...})` runs at the end of `app.ts`'s own top-level code, after
   every imported feature module — including this one — has finished
   evaluating). Capturing a value eagerly here (`const x = window.x`) would
   freeze on `undefined`. Functions and getters are safe because they are
   only invoked after boot completes.

   `G` is the one deliberate escape hatch: most of the monolith's globals are
   declared ambiently elsewhere as bare `let`/`const`/`var` bindings, never as
   `interface Window` members, so `window.x` doesn't type-check for them. Every
   exported accessor below still has a concrete, non-`any` signature — `G` only
   appears inside the handful of lines that cross that typing gap. */

import { S, prov, provState, show, toast, log, writeFile, rerender, hhmm } from "../../../core";
import type { Prov } from "../../../core";

export type { Prov };
export { prov, provState, show, toast, log, writeFile, rerender, hhmm };

import type { RealRun } from "../application/ports";
import type { VerifyCommand, VerifyKind } from "../domain/project-commands";

const G = window as unknown as Record<string, any>;

/* ───── globals this bridge is the first to type (no existing declaration, no name collision) ───── */
declare global {
  interface Window {
    ACTIVE: string;
    CTX_ON: boolean;
    AUTHOR: string;
    AGENT: string;
    SAFE: RegExp;
    DANGER: RegExp;
  }
}

/* ───── mutable primitives owned elsewhere (get/set facade, mirrors core's `S`) ───── */
export const monolith = {
  get mode(): string { return S.MODE; },
  set mode(v: string) { S.MODE = v; },
  get threshold(): number { return S.THRESH; },
  set threshold(v: number) { S.THRESH = v; },
  get currentTabId(): string | null { return S.cur; },
  get pane(): string { return S.PANE; },
  get activeProvider(): string { return window.ACTIVE; },
  set activeProvider(v: string) { window.ACTIVE = v; },
  get contextEnabled(): boolean { return window.CTX_ON; },
  set contextEnabled(v: boolean) { window.CTX_ON = v; },
  get theme(): string { return window.THEME; },
  get activeAgent(): string { return window.AGENT; },
  set author(v: string) { window.AUTHOR = v; },
  set liveOk(v: boolean) { window.LIVE_OK = v; },
};

/** Claude-ao-vivo sampler; `null` when no live backend is wired for this view. */
export interface SampleMsg { role: string; content?: unknown }
export interface SampleOpts { tools?: unknown[]; signal?: AbortSignal | null; onText?: (x: { text: string }) => void; cache?: boolean }
export interface SampleResult { text?: string; [k: string]: unknown }
export const sample = (): ((input: string | SampleMsg[], o?: SampleOpts) => Promise<SampleResult>) | null => G.SAMPLE ?? null;

/* ───── read-only containers owned by other modules (fresh getter, never aliased at import time) ───── */
export const providers = (): Record<string, Prov> => prov();
export const chat = (): { role: string; content: string }[] => G.CHAT;
export const staged = (): Set<string> => window.STAGED;
export const agents = (): Record<string, { n: string; d: string; col: string; paths: string[] }> => window.AGENTS;
export const backlog = (): { issues: any[] } => window.BL;
export const stages = (): Array<[string, string]> => window.STAGES;
export const studioDesign = (): { nodes: Array<{ st: string }> } => window.SD;
export const themes = (): Record<string, Record<string, string>> => window.THEMES;
export const modes = (): Record<string, { l: string; d: string }> => G.MODES;
export const commands = (): Array<[string, string, () => unknown]> => G.CMD;
export const usage = (): Record<string, { calls: number; tok: number }> => G.USAGE;
export const panes = (): Record<string, () => void> => G.RP;
export const files = (): Record<string, { content: string; orig: string | null }> => window.FS;
export const danger = (): RegExp => window.DANGER;
export const safe = (): RegExp => window.SAFE;
export const stopSignal = (): unknown => G.STOP;

/** Prototype workspace seed (demo scenario data + root path); read once per scenario build. */
export const seed = (): { base: Record<string, string>; gen: Record<string, string> } => G.SEED;
export const root = (): string => G.ROOT;
/** Caminho absoluto da pasta real aberta no desktop (`null` no protótipo). */
export const diskRoot = (): string | null => (G.DXR && typeof G.DXR.root === "string" ? G.DXR.root : null);
/** Relê o disco para o editor (o agente v2 escreve ficheiros directamente). */
export const reloadDisk = (): Promise<void> =>
  G.DXR && typeof G.DXR.reloadDisk === "function" ? G.DXR.reloadDisk() : Promise.resolve();
/** Harness v2 do Co-Dev (agente Rust). O antigo fica atrás desta flag até a v2 ser
 *  validada: `localStorage["dx2.codevLegacy"] = "true"` volta ao harness antigo. */
/** O esforço escolhido no compositor (por omissão `high`); só vai ao Claude. */
export const effort = (): string => {
  try {
    return localStorage.getItem("dx2.effort") ?? "high";
  } catch {
    return "high";
  }
};
export const setEffort = (v: string): void => {
  try {
    localStorage.setItem("dx2.effort", v);
  } catch {
    /* armazenamento indisponível: vale só nesta execução do compositor */
  }
};

/** O assistente da conversa (features/team.ts): escolher e redesenhar o `#pill-agent`. */
export const pickPersona = (): void => G.pickAgent?.();
export const refreshPersona = (): void => G.agentPill?.();

/** O reconhecimento de voz do motor web (Chromium/Safari; o WebKitGTK não o tem). */
export const speechRecognition = (): unknown => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const agentV2Enabled = (): boolean => {
  try {
    return localStorage.getItem("dx2.codevLegacy") !== "true";
  } catch {
    return true;
  }
};
export const pathLexer = (): string => G.P_LX;
export const pathRepo = (): string => G.P_REPO;
export const pathMigration = (): string => G.P_MIG;
export const pathTest = (): string => G.P_TEST;
export const pathHistory = (): string => G.P_HIST;
export const pathAdr = (): string => G.P_ADR;
export const pathStore = (): string => G.P_STORE;

/* ───── run control (mutable object owned by codev.ts's own engine today, but published
   by app.ts; mutated in place through properties, never reassigned here) ───── */
export interface RunState {
  active: boolean;
  paused: boolean;
  stop: boolean;
  pend: (() => void) | null;
  label: string;
  t0: number;
  abort: AbortController | null;
  M: { files: Set<string> } | null;
}
export const run = (): RunState => G.RUN;

/* ───── tabs ───── */
export interface CodevTab { id: string; title?: string; kind?: string; path?: string }
export const tabOf = (id: string | null): CodevTab | undefined => G.tabOf(id);
/* Rest-tuple forwarding below (openTab/openDiff/openPath/...): calling `fn(a)` must reach
   the monolith as exactly one argument, not `fn(a, undefined)` — some callees branch on
   `arguments.length`, and the Phase 0 characterization tests assert exact call arity. */
export const openTab = (...args: [t: Partial<CodevTab> & { id: string }, act?: boolean]): void => G.openTab(...args);
export const closeTab = (id: string): void => G.closeTab(id);
export const openDiff = (...args: [p: string, a?: string, b?: string, label?: string]): void => G.openDiff(...args);
export const openPath = (...args: [p: string, line?: number]): void => G.openPath(...args);

/* ───── workspace / diagnostics / tests ───── */
export const shortPath = (p: string): string => window.short(p);
export const normalizePath = (p: string): string => G.norm(p);
export const has = (p: string, re: RegExp): boolean => window.has(p, re);
export const fIcon = (p: string): string => window.fIcon(p);
export const fileDiffStat = (a: string | null, b: string): { add: number; del: number } => G.diffStat(a, b);
export const runTests = (...args: [pkg?: string]): { build: boolean; err: string; ok: boolean; tests: Array<{ n: string; ok: boolean }> } =>
  window.runTests(...args);
export const runTask = (cmd: string): { ok: boolean; sum?: string } | undefined => G.runTask(cmd);
export const termExec = (v: string): { ok: boolean; sum?: string } | undefined => G.termExec(v);
/** Desktop com pasta real: corre o comando a sério (bridge `DXR.exec`) — o `ok` vem do
 *  exit code. `null` no protótipo/sem pasta, onde vale o terminal simulado. */
export const realExec = (): ((cmd: string) => Promise<RealRun>) | null =>
  G.DXR && G.DXR.root && typeof G.DXR.exec === "function" ? (cmd: string) => G.DXR.exec(cmd) : null;
/** O comando de testes/lint detectado do projecto aberto (`null` sem pasta real). */
export const projectCommand = (kind: VerifyKind): VerifyCommand | null =>
  G.DXR && G.DXR.root && typeof G.DXR.projectCmd === "function" ? G.DXR.projectCmd(kind) : null;
export const dsLint = (): { p: string; line: number; hex: string }[] => window.dsLint();
export const lexBug = (): boolean => window.lexBug();

/* ───── SCM / checkpoints ───── */
export const checkpoint = (label: string): number => G.checkpoint(label);
export const restoreCkpt = (...args: [id: number, silent?: boolean]): void => G.restoreCkpt(...args);
export const gfStart = (kind: string, name: string): string => G.gfStart(kind, name);
export const gfAsk = (host: Element, M: { files: Set<string> }): Promise<void> => G.gfAsk(host, M);
export const commitGit = (...args: [msg?: string, author?: string]): { h: string; n: number } | null =>
  window.commitGit(...args) as { h: string; n: number } | null;
export const stOf = (p: string): unknown => window.stOf(p);

/* ───── team / harness ───── */
export const harnessCheck = (p: string): void => G.harnessCheck(p);
export const harnessCmd = (c: string): void => G.harnessCmd(c);
export const agentSys = (): string => G.agentSys();
export const openTeam = (): void => G.openTeam();
export const openBoard = (): void => G.openBoard();
export const openStudio = (): void => G.openStudio();

/* ───── misc monolith helpers ───── */
export const connected = (): string[] => G.connected();
export const speakerLabel = (role: string): string => G.who(role);
export const trackUsage = (providerKey: string, tok: number): void => G.use(providerKey, tok);
export const save = (): void => window.save();
export const setTheme = (n: string): void => window.setTheme(n);
export const provFor = (role: string): string => window.provFor(role);
export const setPanelTab = (...args: [pt: string, nofocus?: boolean]): void => G.setPanelTab(...args);
export const goToPane = (p: string): void => G.goPane(p);
export const palette = (...args: [pre?: string, cfg?: unknown]): void => G.palette(...args);
export const getVar = (k: string): string => G.getVar(k);
export const setVar = (k: string, v: string): void => G.setVar(k, v);
export const note = (m: string): void => window.note(m);
export const badges = (): void => window.badges();
export const refresh = (...args: [fromEd?: boolean, force?: boolean]): unknown => window.refresh(...args);
export const isDesktop = (): boolean => !!window.__TAURI__;
export const delegateIsolated = (): ((writes: [string, string][]) => Promise<{ status: string; patch?: string; error?: string }>) | undefined =>
  G.DXR?.delegate;
