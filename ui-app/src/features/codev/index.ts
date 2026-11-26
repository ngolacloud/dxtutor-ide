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

import { architectureSession } from "./domain/session-kind";
import { translator as streamTranslator } from "../../app/i18n";
import { CODEV_STREAM_MESSAGES } from "./ui/stream-messages";
const streamText = streamTranslator(CODEV_STREAM_MESSAGES);
import * as bridge from "./infrastructure/legacy-bridge";
import { paceCps } from "./domain/composer";
import { pairState } from "../../app/pair-state";
import { codevUndo } from "../../app/codev-undo";
import { changeSetsSignal } from "../../app/change-sets-signal";
import { parseAgentEvent } from "./domain/agent-events";
/** The session id of the hunks mirrored from the PairCode host (RF-S09). */
const MIRROR = "pair-mirror";
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
import { makeAgentMapStore } from "./application/agent-map";
import { agentMapGateway } from "./infrastructure/agent-map-gateway";
import { makeAgentMapView } from "./ui/agent-map-view";
import { setAgentCount } from "./ui/composer";
import { makeCodevSessions } from "./application/codev-sessions";
import { makeSessionView } from "./ui/session-view";
import { makeCodevsView } from "./ui/codevs-view";
import { scopeOverlap } from "./infrastructure/scope-gateway";
import { worktreeGateway } from "./infrastructure/worktree-gateway";
import { makeWorktrees } from "./application/worktrees";
import { CODEV_WORKTREE_MESSAGES } from "./application/worktree-messages";
import { branchLabel, type WorktreeRef } from "./domain/worktrees";
import { requestApproval } from "../../app/approval";
import { auditClient } from "../../platform/tauri/audit";
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
import { currentLocale, translator } from "../../app/i18n";
import { makeLocalProposals, type ProposalResult } from "./application/local-proposals";
import { services } from "../../app/services";
import { CODEV_ENGINE_MESSAGES } from "./application/messages";

/* os textos dos casos de uso na língua da interface, e a língua em que o modelo responde (i18n dos motores) */
const copy = translator(CODEV_ENGINE_MESSAGES);
const replyLanguage = currentLocale;
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
const doTool = makeDoTool({ workspace, terminal, providers, notifier, presenter, gate, clock, rules, mode, copy,
  /* em Manual/Assistido a edição é revista no editor, bloco a bloco */
  proposals: { propose: (p, content, reason) => proposeInEditor(p, content, reason) } });

const liveChat = makeLiveChat({
  replyLanguage,
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
  copy,
  applied: (path, before) => codevUndo.remember(path, before),
  recorded: () => changeSetsSignal.notify(),
  // RF-P03: in a PairCode session the navigator's decisions are refusals
  review: (s, call, d) =>
    localProposals.isLocal(s)
      ? localProposals.review(s, call, d)
      : s === MIRROR
      ? Promise.reject(new Error("Estes hunks são do Co-Dev do anfitrião: decide-os quem conduz, do lado dele."))
      : agentGateway.review(s, call, pairState.canDrive() ? d : d.map((x) => ({ hunk: x.hunk, accept: false, reason: "na sessão PairCode só quem conduz aceita" }))),
  // RF-A03/A04: the architect's override of a change that breaks the rules (the host's session only)
  override: (s, call, adr) =>
    s === MIRROR
      ? Promise.reject(new Error("Estes hunks são do Co-Dev do anfitrião: o override é do lado dele."))
      : agentGateway.override
        ? agentGateway.override(s, call, adr)
        : Promise.reject(new Error("o override só existe na app desktop")),
  askAdr: (violations) => bridge.prompt(streamText("adrPrompt", { violations }), ""),
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
/* Whole-file proposals (the legacy live chat, the Explain / Code review panel) reviewed in the editor
   with the same live hunks as the agent v2: only the changed lines, in place, Accept / Reject each. */
export const localProposals = makeLocalProposals({
  emit: (session, e) => hunkReview.sink.event(session, e),
  read: (rel) => bridge.files()[bridge.root() + rel]?.content ?? null,
  write: (rel, content) => bridge.writeFile(bridge.root() + rel, content),
  flush: () => bridge.flushSave(),
});
/** Review `content` for the file `key` (an editor/FS key) in the editor, block by block. */
export function proposeInEditor(key: string, content: string, reason: string): Promise<ProposalResult> {
  const pre = bridge.root();
  return localProposals.propose(key.startsWith(pre) ? key.slice(pre.length) : key, content, reason);
}
services.proposals = { proposeInEditor };

/* RF-S09: in a PairCode session the guest mirrors the host's live hunks (read-only there: the
   decisions belong to the host's agent session) */
pairState.onCodev((e) => {
  const ev = parseAgentEvent({ session: MIRROR, event: e });
  if (ev) hunkReview.sink.event(MIRROR, ev.event);
});
codevUndo.setRel(relPath);
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
  copy,
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

/* ───── the Agent map: every agent session and its sub-agents (the composer's «● N agents» chip) ───── */
export const agentMapStore = makeAgentMapStore({
  gateway: agentMapGateway,
  primary: () => sessionOf(),
  now: () => Date.now(),
});
export const agentMapView = makeAgentMapView(agentMapStore, {
  base: () => bridge.agents()?.[bridge.monolith.activeAgent]?.n ?? "Co-Dev",
  showInChat: (session) => {
    // Multi Co-Dev: a sessão de outra issue mostra a conversa dela
    if (session) codevSessions.selectSession(session);
    presenter.scrollMsgs();
    document.getElementById("ag-input")?.focus();
  },
  inChat: (session) => codevSessions.has(session),
  openRun: () => openCodevRun(),
  now: () => Date.now(),
  every: (ms, f) => {
    const id = setInterval(f, ms);
    return () => clearInterval(id);
  },
});
agentMapStore.onChange(() => setAgentCount(agentMapStore.working()));
void agentMapStore.start();

/* ───── Multi Co-Dev (fase 3): as worktrees do Co-Dev e as reservas de ficheiros ───── */
const wtCopy = translator(CODEV_WORKTREE_MESSAGES);
const audits = auditClient();
export const worktrees = makeWorktrees({
  copy: wtCopy,
  gateway: worktreeGateway,
  root: () => bridge.diskRoot(),
  approve: (r) => requestApproval(r),
  audit: (root, entry) => audits.record(root, entry),
  guard: (f) => (services.protect ? services.protect.guard(f) : f()),
  openReadOnly: (abs, before, after, label) => bridge.openDiff(abs, before, after, label),
  ask: async (q, initial) => bridge.prompt(q, initial),
  notify: (m) => bridge.toast(m),
});
/* ao abrir uma pasta: as worktrees de uma execução anterior (só na app desktop) */
if (bridge.isDesktop()) document.addEventListener("dx:workspace", () => void worktrees.workspaceOpened());

/* ───── Multi Co-Dev (fase 2): uma conversa por sessão; a à vista é a seleccionada ───── */
let firstSession = true;
export const codevSessions = makeCodevSessions({
  copy,
  make: (ctx) => {
    const view = makeSessionView(
      {
        label: ctx.label,
        notify: (label) => bridge.toast(copy("bgDecision", { label })),
        changed: () => codevSessions.touch(),
      },
      firstSession,
    );
    firstSession = false;
    const chat = makeAgentChat({
      copy,
      confirm: (m) => bridge.confirm(m),
      gateway: agentGateway,
      presenter: view.presenter,
      gate: view.gate,
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
         `ctx` da barra de estado, como as voltas do chat ao vivo (ADR-0006, R3c) — o `ctx` é o da
         conversa à vista */
      onUsage: (input, output, detail) => {
        const provider = bridge.monolith.activeProvider;
        bridge.recordUsage(provider, input + output);
        if (ctx.selected()) document.dispatchEvent(new CustomEvent("dx:llm-usage", { detail: { provider, input, output, ...detail } }));
      },
      /* conjunto 9: só as sessões de arquitectura levam `arch_propose` */
      architecture: (first) => architectureSession(bridge.studioOpen(), first),
      // RF-S09: the live hunks also go to a PairCode guest (same stream, same highlight)
      hunks: {
        ...hunkReview.sink,
        event: (s, e) => {
          hunkReview.sink.event(s, e);
          pairState.codevOut(e);
        },
        // fase 3: os blocos de uma sessão numa worktree são de outra árvore — vêem-se só de leitura
        open: (path) => {
          const wt = ctx.worktree();
          const session = chat.sessionId();
          if (wt && session) void worktrees.openProposal(wt, path, (now) => hunkReview.proposal(session, path, now));
          else hunkReview.sink.open(path);
        },
      },
      /* fase 3: a revisão de hunks diz em que worktree a sessão trabalha */
      where: () => {
        const wt = ctx.worktree();
        return wt ? `${branchLabel(wt)} · worktree` : null;
      },
      flush: () => bridge.flushSave(),
      // the «Co-Dev run» tab follows the conversation on screen
      run: {
        event: (s, e) => {
          if (ctx.selected()) codevRun.event(s, e);
        },
        turnStarted: () => {
          if (ctx.selected()) codevRun.turnStarted();
        },
      },
      agentMap: agentMapStore.sink,
    });
    return { chat, view };
  },
  overlap: async (key, running) => {
    const root = bridge.diskRoot();
    return root ? scopeOverlap(root, key, running) : [];
  },
  wtCopy,
  // fase 3: só a app desktop tem worktrees (no browser não há agente v2)
  ...(bridge.isDesktop() ? { worktree: { prepare: (key: string, needed: boolean) => worktrees.prepare(key, needed), sessionClosed: (ref: WorktreeRef) => void worktrees.sessionClosed(ref) } } : {}),
  hunks: hunkReview,
  confirm: (m) => bridge.confirm(m),
  notify: (m) => bridge.toast(m),
});
/** A conversa à vista. */
const agentChat = (): ReturnType<typeof makeAgentChat> => codevSessions.current();
sessionOf = () => codevSessions.sessionId();
stopTurn = () => agentChat().cancel();
/** A faixa «Co-Devs» por cima da conversa (só com mais de uma sessão). */
export const codevsView = makeCodevsView(codevSessions, agentMapStore, {
  worktrees,
  pick: (ph, items) => bridge.palette("", { ph, items: items.map((i) => ({ l: i.label, d: i.detail, run: i.run })) }),
  now: () => Date.now(),
  every: (ms, f) => {
    const id = setInterval(f, ms);
    return () => clearInterval(id);
  },
});

/** Conversa livre: o agente v2 quando disponível (desktop + pasta real + Claude/Codex/
 *  Gemini/Ollama), senão o harness antigo (protótipo, a flag `dx2.codevLegacy`, ou um modelo
 *  sem tool calling nativo — descoberto no 1.º pedido, a mensagem é reenviada por aqui). */
const chat = async (q: string): Promise<void> => {
  const c = agentChat();
  if (!c.available()) return liveChat(q);
  if (await c.send(q)) return;
  return liveChat(q, { echoed: true }); // o agente já mostrou a mensagem
};

/* ───── the wired engine (codev.ts publishes these onto window) ───── */
export const codevEngine = {
  doTool: doTool as (t: RuntimeTool, host: ToolHost, role?: string, signal?: AbortSignal) => Promise<unknown>,
  liveChat,
  chat,
  /** A modebar mudou: vale para todas as sessões abertas (o modo é um só). */
  agentModeChanged: (mode: string): void => codevSessions.chats().forEach((c) => c.modeChanged(mode)),
  agentReset: (): void => codevSessions.resetCurrent(),
  /** `/retomar`: lista e retoma uma conversa anterior do agente v2 (se disponível). */
  agentResume: (): Promise<void> | null => (agentChat().available() ? agentChat().resumeMenu() : null),
  /** `/plano <pedido>` e `/reverter` (agente v2). */
  agentPlan: (q: string): Promise<void> | null => (agentChat().available() ? agentChat().plan(q) : null),
  agentRewind: (): Promise<void> | null => (agentChat().available() ? agentChat().rewindMenu() : null),
  agentCommands: (): Promise<void> | null => (agentChat().available() ? agentChat().commandsMenu() : null),
  /** Board (opção 2): a issue vai ao agente em modo plano. `null` se o agente v2 não está disponível. */
  agentStory: (s: { id: string; title: string; type: string; pts: number; note?: string }): Promise<void> | null =>
    agentChat().available() ? agentChat().story(s) : null,
  agentAvailable: (): boolean => agentChat().available(),
  /** F4: «Work on it with Co-Dev» sends the issue's exact prompt (from `project_issue_prompt`). Multi Co-Dev
   *  (phase 2): another issue opens another session — only when its scope overlaps no running issue's. */
  agentIssue: (r: { key: string; text: string; scope: string[]; template: string }): Promise<boolean> | null =>
    agentChat().available() ? codevSessions.issue(r) : null,
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
