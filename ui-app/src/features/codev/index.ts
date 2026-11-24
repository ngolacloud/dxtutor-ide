/* ═══════════ Co-Dev — composition root (ADR-0002, Phase 3) ═══════════
   Wires the adapters (over `infrastructure/legacy-bridge.ts`) and the
   presentation (over `ui/chat-view.ts`) into the application use cases
   (`application/*`). This is the ONE place the layers meet: the use cases stay
   pure (domain + ports only); the bridge stays the only window-toucher; the
   chat view owns the DOM.

   `features/codev.ts` imports the wired engine from here and publishes the
   `window.*` surface the rest of the app (and `features/board.ts`) still calls.
   The decision log is owned here (one source of truth) and re-published onto
   `window` by `codev.ts`. */

import * as bridge from "./infrastructure/legacy-bridge";
import { paceCps } from "./domain/composer";
import { presenter, gate, beat } from "./ui/chat-view";
import { makeDoTool } from "./application/tool-executor";
import { makeLiveChat } from "./application/live-chat";
import { makeAgentChat } from "./application/agent-chat";
import { agentGateway } from "./infrastructure/agent-gateway";
import { makeHunkReview } from "./application/hunk-review";
import { makeHunkOverlayView } from "./ui/hunk-overlay-view";
import { editorOverlay } from "../../app/editor-overlay";
import type { VView } from "./domain/hunk-overlay";
import { makeHarness } from "./application/harness";
import { makeHarnessView } from "./ui/harness-view";
import { VIEW } from "../../app/store/registry";
import type {
  Workspace,
  Terminal,
  Verify,
  ProviderGateway,
  Notifier,
  Harness,
  Clock,
  ChatStore,
  ProviderInfo,
  Sampler,
  ToolHost,
  RuntimeTool,
} from "./application/ports";
import type { CommandRules } from "./domain/policy";
import type { Decision, Mode } from "./domain/types";

/* ───── state owned by the composition root (published by codev.ts) ───── */
/** O registo de decisões que a página Team lê (`window.DECS`); sem missões guionadas
 *  (ADR-0006, R1b) fica vazio até a R3 o ligar às decisões reais do agente. */
export const decisions: Decision[] = [];

/* ───── adapters over the legacy bridge ───── */
/* Comandos de verificação detectados da tabela fixa do ecossistema (ex.: `cargo test`)
   contam como seguros no modo Assistido; os escritos por extenso num ficheiro do repo
   (.dxtutor/commands.json, scripts, Makefile) não — são texto arbitrário do repositório. */
const trustedVerify = (c: string): boolean =>
  (["test", "lint"] as const).some((k) => {
    const v = bridge.projectCommand(k);
    return !!v && v.trusted && v.cmd === c;
  });

const rules: CommandRules = {
  isSafe: (c) => bridge.safe().test(c) || trustedVerify(c),
  isDestructive: (c) => bridge.danger().test(c),
};

const workspace: Workspace = {
  files: () => bridge.files(),
  write: (path, content) => bridge.writeFile(path, content),
  diffStat: (old, nw) => bridge.fileDiffStat(old, nw),
  shortPath: (p) => bridge.shortPath(p),
  normalizePath: (p) => bridge.normalizePath(p),
  openDiff: (p, a, b, label) => bridge.openDiff(p, a, b, label),
  openTab: (tab, activate) => bridge.openTab(tab, activate),
  root: () => bridge.root(),
};

const terminal: Terminal = {
  exec: (cmd) => bridge.termExec(cmd),
  realRun: () => bridge.realExec(),
};

const verify: Verify = {
  real: () => !!bridge.realExec(),
  command: (kind) => bridge.projectCommand(kind),
};

const providers: ProviderGateway = {
  providers: () => bridge.providers() as unknown as Record<string, ProviderInfo>,
  connected: () => bridge.connected(),
  activeProvider: () => bridge.monolith.activeProvider,
  provFor: (role) => bridge.provFor(role),
  trackUsage: (key, tok) => bridge.trackUsage(key, tok),
  speakerLabel: (role) => bridge.speakerLabel(role),
  agentSys: () => bridge.agentSys(),
  activeAgentName: () => bridge.agents()[bridge.monolith.activeAgent].n,
  isDesktop: () => bridge.isDesktop(),
  sample: () => bridge.sample() as unknown as Sampler | null,
};

const notifier: Notifier = {
  log: (tag, msg) => bridge.log(tag, msg),
  note: (msg) => bridge.note(msg),
  toast: (msg) => bridge.toast(msg),
};

const harness: Harness = {
  check: (path) => bridge.harnessCheck(path),
  cmd: (cmd) => bridge.harnessCmd(cmd),
  delegate: () => bridge.delegateIsolated(),
};

const chatStore: ChatStore = {
  messages: () => bridge.chat(),
  activeTabPath: () => {
    const t = bridge.tabOf(bridge.monolith.currentTabId);
    const fs = bridge.files();
    return bridge.monolith.contextEnabled && t && t.path && fs[t.path] ? t.path : null;
  },
};

const clock: Clock = {
  now: () => Date.now(),
  beat: (ms, signal) => beat(ms, signal),
};

const mode = (): Mode => bridge.monolith.mode as Mode;
/* ───── wire the use cases ───── */
const doTool = makeDoTool({ workspace, terminal, providers, notifier, presenter, gate, clock, rules, mode });

const liveChat = makeLiveChat({
  workspace,
  providers,
  notifier,
  presenter,
  harness,
  verify,
  chat: chatStore,
  modeLabel: () => bridge.modes()[bridge.monolith.mode].l,
  projectRules: () => {
    const fs = bridge.files();
    const p = bridge.root() + ".dxtutor/regras.md";
    return fs[p] ? fs[p].content : "";
  },
  setLiveOk: () => {
    bridge.monolith.liveOk = true;
  },
  refresh: () => {
    bridge.refresh();
  },
  tool: doTool,
});

/* ───── live hunks in the editor (RF-CODEV-STREAM §8) ─────
   Paths in hunk events are relative to the project; the editor's are `ROOT + rel`. */
const relPath = (p: string): string => (p.startsWith(bridge.root()) ? p.slice(bridge.root().length) : p);
let stopTurn: () => void = () => undefined;
let reveal: (line: number) => void = () => undefined;
export const hunkReview = makeHunkReview({
  review: (s, call, d) => agentGateway.review(s, call, d),
  flush: () => bridge.flushSave(),
  reloadFromDisk: () => bridge.reloadDisk(),
  editor: {
    repaint: (rel) => editorOverlay.repaint(bridge.root() + rel),
    open: (rel) => bridge.openPath(bridge.root() + rel),
    current: () => {
      const t = bridge.tabOf(bridge.monolith.currentTabId);
      return t && t.path ? relPath(t.path) : null;
    },
    reveal: (line) => reveal(line),
    preview: (rel, text) => bridge.openDiff(bridge.root() + rel, "", text, "ficheiro novo proposto pelo Co-Dev"),
  },
  every: (ms, f) => {
    const id = setInterval(f, ms);
    return () => clearInterval(id);
  },
  // RF-S02: the pace the human chose (Lento 20 / Normal 40 / Rápido 120 / Instantâneo)
  pace: () => paceCps(bridge.writePace()),
  notify: (m) => bridge.toast(m),
  cancel: () => stopTurn(),
});
hunkReview.readFrom((rel) => bridge.files()[bridge.root() + rel]?.content ?? null);
const hunkView = makeHunkOverlayView(hunkReview, (el) => bridge.translate(el));
reveal = hunkView.reveal;
editorOverlay.set({
  view: (p, real) => hunkReview.view(relPath(p), real),
  edit: (p, v, next, real) => hunkReview.edit(relPath(p), v as VView, next, real),
  decorate: (p, host, v) => hunkView.decorate(p, host, v as VView),
});

/* ───── agente v2 (ADR-0003, F4): o loop corre no backend Rust ───── */
/* ───── the harness (A3, docs/v2/UI-AUDIT.md item 11): the «Co-Dev run» tab ───── */
let sessionOf: () => string | null = () => null;
const activeModel = (): string => {
  const p = bridge.providers() as unknown as Record<string, { model?: string }>;
  const active = p[bridge.monolith.activeProvider];
  return (active && active.model) || "";
};
export const codevRun = makeHarness({
  gateway: agentGateway,
  session: () => sessionOf(),
  root: () => bridge.diskRoot() ?? "",
  reloadFromDisk: () => bridge.reloadDisk(),
  open: (rel, line) => bridge.openPath(bridge.root() + rel, line),
  confirm: (m) => bridge.confirm(m),
  notify: (m) => bridge.toast(m),
});
const harnessView = makeHarnessView(codevRun.state, (f) => void codevRun.onChange(f), activeModel, () => Date.now());
VIEW["codev-run"] = (_t, host) => {
  harnessView.mount(host);
  void codevRun.refresh();
};
/** Opens (or focuses) the «Co-Dev run» tab. */
export function openCodevRun(): void {
  bridge.openTab({ id: "codev-run", title: "Co-Dev run", kind: "codev-run" });
}

const agentChat = makeAgentChat({
  gateway: agentGateway,
  presenter,
  gate,
  verify,
  workspace: { root: () => bridge.diskRoot() ?? "" },
  reloadFromDisk: () => bridge.reloadDisk(),
  provider: () => bridge.monolith.activeProvider,
  effort: () => bridge.effort(),
  model: () => {
    const p = bridge.providers() as unknown as Record<string, { model?: string }>;
    const active = p[bridge.monolith.activeProvider];
    return (active && active.model) || "";
  },
  mode: () => bridge.monolith.mode,
  speaker: () => bridge.agents()[bridge.monolith.activeAgent].n.toLowerCase() + " · agente",
  nowSecs: () => Math.floor(Date.now() / 1000),
  openDiff: (path, before, after, label) => bridge.openDiff(bridge.root() + path, before, after, label),
  /* o uso de cada pedido do agente: o contador de uso (o custo medido das issues do Board) e o
     `ctx` da barra de estado, como as voltas do chat ao vivo (ADR-0006, R3c) */
  onUsage: (input, output) => {
    const provider = bridge.monolith.activeProvider;
    bridge.recordUsage(provider, input + output);
    document.dispatchEvent(new CustomEvent("dx:llm-usage", { detail: { provider, input, output } }));
  },
  hunks: hunkReview.sink,
  flush: () => bridge.flushSave(),
  run: { event: (s, e) => codevRun.event(s, e), turnStarted: () => codevRun.turnStarted() },
});
sessionOf = () => agentChat.sessionId();
stopTurn = () => agentChat.cancel();

/** Conversa livre: o agente v2 quando disponível (desktop + pasta real + Claude/Codex/
 *  Gemini/Ollama), senão o harness antigo (protótipo, a flag `dx2.codevLegacy`, ou um modelo
 *  sem tool calling nativo — descoberto no 1.º pedido, a mensagem é reenviada por aqui). */
const chat = async (q: string): Promise<void> => {
  if (!agentChat.available()) return liveChat(q);
  if (await agentChat.send(q)) return;
  return liveChat(q, { echoed: true }); // o agente já mostrou a mensagem
};

/* ───── the wired engine (codev.ts publishes these onto window) ───── */
export const codevEngine = {
  doTool: doTool as (t: RuntimeTool, host: ToolHost, role?: string, signal?: AbortSignal) => Promise<unknown>,
  liveChat,
  chat,
  agentModeChanged: (mode: string): void => agentChat.modeChanged(mode),
  agentReset: (): void => agentChat.reset(),
  /** `/retomar`: lista e retoma uma conversa anterior do agente v2 (se disponível). */
  agentResume: (): Promise<void> | null => (agentChat.available() ? agentChat.resumeMenu() : null),
  /** `/plano <pedido>` e `/reverter` (agente v2). */
  agentPlan: (q: string): Promise<void> | null => (agentChat.available() ? agentChat.plan(q) : null),
  agentRewind: (): Promise<void> | null => (agentChat.available() ? agentChat.rewindMenu() : null),
  agentCommands: (): Promise<void> | null => (agentChat.available() ? agentChat.commandsMenu() : null),
  /** Board (opção 2): a issue vai ao agente em modo plano. `null` se o agente v2 não está disponível. */
  agentStory: (s: { id: string; title: string; type: string; pts: number; note?: string }): Promise<void> | null =>
    agentChat.available() ? agentChat.story(s) : null,
  agentAvailable: (): boolean => agentChat.available(),
  /** F4: «Work on it with Co-Dev» sends the issue's exact prompt (from `project_issue_prompt`). */
  agentIssue: (r: { key: string; text: string; scope: string[]; template: string }): Promise<boolean> | null =>
    agentChat.available() ? agentChat.issue(r) : null,
};

/* ───── low-level transcript/run-control helpers, shared with board.ts ───── */
export {
  scrollMsgs,
  user,
  card,
  phase,
  md,
  beat,
  runState,
  runLabel,
  agCtl,
  waiting,
  ask,
  tl,
  ctxPill,
} from "./ui/chat-view";
