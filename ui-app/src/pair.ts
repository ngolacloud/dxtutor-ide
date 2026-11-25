/* ═════════ dxtutor IDE — PairCode (XP pair programming) ═════════
   One developer hosts and gets a token; the other joins with it. The guest sees the host's
   workspace live and follows the driver (open file, scroll, cursor). One of the two drives —
   types in the editor and the shared terminal — and control changes hands only on request and
   acceptance. A small video call (camera + audio) runs alongside over WebRTC; its signalling
   travels inside the same encrypted PairCode channel. Desktop app only.

   Fase 2 da componentização: este é o primeiro módulo TypeScript do ui-app, servido como
   <script type="module"> no FIM da cadeia boot.js → app.js (clássicos) → bridge.ts (módulo).
   O contrato com os scripts clássicos mantém-se o do pair.js: lê as globais lexicais (FS, ROOT, BRANCH, CWD,
   OPEN, cur, VIEW, MENUS, CMD, $, tabOf) e re-atribui as globais function-declaradas
   via binding do window (refresh, promptHTML, window.run, commit, checkout, …). As
   declarações em `declare global` abaixo são esse contrato, tipado. */
import type { Invoker } from "./platform/tauri/core";
import { pairClient } from "./platform/tauri/pair";
import { shellClient } from "./platform/tauri/shell";
import { fsClient } from "./platform/tauri/fs";
import { appClient } from "./platform/tauri/app";
import { bus } from "./app/bus";
import { registerActions } from "./app/actions";
import { tabMarks } from "./app/tab-marks";
import { editorStore } from "./app/store/editor";
import { drawTabs, closeTab } from "./features/tabs";
import { scrollTerm, cwd, echo, newInput } from "./features/terminal";
import { pairState } from "./app/pair-state";
import { workspaceStore } from "./app/store";

export {};

interface FsEntry { content: string; orig: string | null }
interface Tab { id: string; title?: string; kind?: string; path?: string; fixed?: boolean; a?: string; b?: string; label?: string; issue?: string }
interface MenuItem { l: string; k?: string; act?: () => unknown }
interface Menu { t: string; items?: MenuItem[] }
type CmdEntry = [string, string, () => unknown];
type Role = "host" | "guest";

/** Mensagem do canal PairCode — `t` discrimina; os campos variam por tipo (IPC, sem schema). */
interface Msg { t: string; [k: string]: any }

interface ViewMsg {
  path: string | null; top: number; line: number; col: number;
  tab?: string | null; kind?: string | null; who?: string;
}

interface DxrInfo { pairtest?: string; selftest?: string; version?: string; os?: string; home?: string }
/** O objecto R do bridge.js (window.DXR) — só os campos que o PairCode usa. */
interface Dxr {
  user?: string; name: string | null; root: string | null; git: boolean; remote?: boolean;
  disk: Record<string, unknown>; info: DxrInfo; errors: string[]; ready?: boolean;
  flush?: () => void; idle?: () => Promise<unknown>; reloadDisk?: () => Promise<void>;
}

interface TauriEvent { payload: unknown }
interface TauriLike { event: { listen(n: string, f: (e: TauriEvent) => void): Promise<unknown> } }
interface TauriFull extends TauriLike { core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<any> } }
type Inv = (cmd: string, args?: Record<string, unknown>) => Promise<any>;
/* In the browser build there is no network: pair-sim.js supplies a scripted peer with the same messages. */
interface PairSim { T: TauriLike; inv: Inv; R: Dxr; media(): MediaStream | null }

interface PairUi {
  open(): void; close(): void; tab(t: "start" | "join"): void; start(): void; join(): Promise<void> | void;
  end(): void; copy(): void; mic(): void; cam(): void; follow(): void;
  request(): void; give(): void; take(): void; answer(ok: boolean): void; min(): void;
}

interface PairState {
  role: Role | null;
  state: "idle" | "waiting" | "joining" | "connected";
  token: string | null;
  peer: unknown;
  peerName: string;
  driver: Role;
  follow: boolean;
  sent: Record<string, string>;
  backup: { fs: Record<string, FsEntry>; root: string | null; name: string | null; git: boolean; branch: string; cwd: string[] } | null;
  rtc: RTCPeerConnection | null;
  local: MediaStream | null;
  callReady: Promise<void> | null;
  cands: RTCIceCandidateInit[];
  mic: boolean;
  cam: boolean;
  mediaErr: string | null;
  lastView: string;
  pendingReq: boolean;
  min: boolean;
  log: string[];
  // preenchidos depois do arranque da sessão/chamada
  peerRtc?: boolean;
  peerView?: ViewMsg;
  peerAv?: Msg | null;
  ask?: Msg | null;
  mode?: "rtc" | "relay";
  frames?: number;
  audioIn?: number;
  sentAudio?: number;
  calls?: number;
  fakeMedia?: MediaStream | null;
  forceRelay?: boolean;
  lastFrame?: number;
  lastFrameData?: string | null;
  relayV?: HTMLVideoElement | null;
  vTimer?: number | null;
  capAc?: AudioContext | null;
  playAc?: AudioContext | null;
  capNodes?: AudioNode[] | null;
  playT?: number;
  autoMin?: boolean;
  /** Guest: the tabs the host shares (UI-PAIR-02). */
  peerTabs?: string[];
  /** The side bar is hidden, so the call lives in the status bar (UI-PAIR-03). */
  sideHidden?: boolean;
  ui?: PairUi;
}

declare global {
  // Globais lexicais (let/const top-level em boot.js/app.js): visíveis por nome, não no window.
  let BRANCH: string;
  const cur: string | null;
  const FS: Record<string, FsEntry>;
  const ROOT: string;
  const VIEW: Record<string, (...a: any[]) => void>;
  const MENUS: Menu[];
  const CMD: CmdEntry[];
  const $: (s: string) => HTMLElement | null;
  const tabOf: (id: string | null) => Tab | undefined;
  // Helpers do monólito (app.ts) publicados no window, usados por nome livre pelas features-folha.
  const short: (p: string) => string;
  const extOf: (p: string) => string;
  const hlLine: (s: string, ext: string) => string;
  const fIcon: (p: string) => string;
  var openTab: (t: Partial<Tab> & { id: string }, act?: boolean) => void;
  var drawTabs: () => void;
  var gotoLine: (n: number) => void;
  var connected: () => string[];
  // Globais lexicais/helpers do monólito usados pelas features-folha tipadas (explorer/...).
  const SECOPEN: Record<string, boolean>;
  const sel: (row: HTMLElement) => void;
  const drawTimeline: () => void;
  const palette: (pre?: string, cfg?: any) => void;
  const MISSIONS: any[];
  // `ask` (dono = features/codev.ts): porta de aprovação humana — lido por nome livre
  // pela feature `checkpoint` (gfAsk) e por v5.ts/board.ts. `v`/`pri` são polimórficos
  // (número 0/1 ou o próprio candidato escolhido), por isso ficam `any`.
  const ask: (host: HTMLElement, btns: Array<{ l: string; v: any; pri?: any; done?: string }>) => Promise<any>;
  var commitGit: (msg?: string, author?: string) => { h: string; n: number } | null; // var: o bridge.ts liga-o ao git real (ADR-0006, R1d)
  const setMode: (m: string) => void;
  var onKey: (e: KeyboardEvent) => void;
  const LANG: Record<string, string>;
  const diagnostics: () => { p: string; line: number; sev: string; msg: string }[];
  // Globais do i18n (i18n.ts): LOCALE window-backed (var → também em window.LOCALE);
  // __seen/__miss são instrumentação opcional de tradução (podem não existir).
  var LOCALE: string;
  var __seen: Set<string> | undefined;
  var __miss: Set<string> | undefined;
  // Globais do Studio (studio.ts, @ts-nocheck) lidos pelos geradores tipados; catálogos
  // heterogéneos → Record<string, any>, e os helpers de nó com assinatura fina.
  const appDir: (n: any) => string;
  // Estado do desenho do Studio (studio.ts), window-backed (var → também em window.X);
  // o resíduo/onclicks inline e generators.ts escrevem/lêem por global.
  var SD: { nodes: Array<{ id: string; tech: string; n: string; x: number; y: number; st: string }>; edges: string[][] };
  var drawStudio: () => void;
  // Globais lidos pela feature Learning Track (learn.ts). mdFull/paintEd/miniOff/stPos/
  // user/liveChat/agentPill/focusAgent/RP/LF/PANE vivem em app.ts (@ts-nocheck) e são
  // publicados no window; ONB/LT_HOOD são donos de learn.ts (window-backed → var).
  const paintEd: (p: string) => void;
  const stPos: () => void;
  const user: (msg: string) => void;
  const liveChat: (msg: string) => void;
  const focusAgent: (x?: boolean) => void;
  const RP: Record<string, () => void>;
  var PANE: string;
  const has: (p: string, re: RegExp) => boolean;
  // Globais function-declaradas (vivem no window): re-atribuíveis a partir do módulo.
  var refresh: (fromEd?: boolean, force?: boolean) => unknown;
  var promptHTML: () => string;
  var show: (id: string | null) => void;
  var openPath: (p: string, line?: number) => void;
  var scrollTerm: () => void;
  var setPanelTab: (pt: string, nofocus?: boolean) => void;
  var writeFile: (p: string, content: string) => void;
  var buildMenubar: () => void;
  var toast: (m: string) => void;
  var log: (src: string, msg: string) => void;
  var run: (raw?: string) => unknown;
  var PAIR: PairState;
  var __TAURI__: TauriFull | undefined;
  var __PAIRSIM__: PairSim | undefined;
  var DXR: Dxr | undefined;
  var webkitAudioContext: typeof AudioContext | undefined;
}

(() => {
const SIM = !window.__TAURI__;
if (SIM ? !window.__PAIRSIM__ : !window.DXR) return;
const T: TauriLike = SIM ? window.__PAIRSIM__!.T : window.__TAURI__!;
const inv: Inv = SIM ? window.__PAIRSIM__!.inv : (c, a) => window.__TAURI__!.core.invoke(c, a || {});
/* clientes IPC tipados (platform/tauri — ADR-0004, U2) sobre o `inv` injectado (real ou simulação) */
const pairc = pairClient(inv as Invoker), shellc = shellClient(inv as Invoker), fsc = fsClient(inv as Invoker), appc = appClient(inv as Invoker);
const R: Dxr = SIM ? window.__PAIRSIM__!.R : window.DXR!;
const escH = (s: unknown): string =>
  String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
const say = (m: string) => { try { log("paircode", m); } catch { /* sem painel de output */ } };
const P: PairState = {
  role: null, state: "idle", token: null, peer: null, peerName: "", driver: "host", follow: true, sent: {}, backup: null,
  rtc: null, local: null, callReady: null, cands: [], mic: true, cam: true, mediaErr: null, lastView: "", pendingReq: false, min: false, log: [],
};
window.PAIR = P;
const myName = () => R.user || "me";
const other = (r: Role): Role => (r === "host" ? "guest" : "host");
const amDriver = () => !!P.role && P.driver === P.role;
/* RF-P03/P04: Co-Dev and the Project read who drives (no window global) */
pairState.register(() => (P.role ? { inSession: P.state === "connected", driver: P.driver, me: P.role } : null));
/* RF-S09: the host mirrors Co-Dev's live hunks to the guest (same stream, same highlight) */
pairState.registerCodevSend((e) => { if (P.role === "host" && P.state === "connected") void send({ t: "codev", e } as unknown as Msg); });
const live = () => P.state === "connected";
/* ───── what the host shares (UI-PAIR-01) ─────
   Private paths never leave the host's machine: the filter is applied to what is SENT (the
   snapshot, every file sync, the view the guest follows, the tabs it mirrors) and to what the
   guest may write, never only to what is drawn. Secret files (.env, keys) are always private;
   the host makes any tab or folder private with a right-click (and shared again the same way). */
const SECRET = /(^|\/)\.env(\.[^/]*)?$|\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i;
/** FS keys, or folder prefixes ending in "/". */
const priv = new Set<string>();
const isSecret = (k: string): boolean => SECRET.test(k);
function isPrivate(k: string): boolean {
  if (isSecret(k) || priv.has(k)) return true;
  for (const p of priv) if (p.endsWith("/") && k.startsWith(p)) return true;
  return false;
}
function togglePrivate(key: string): void {
  if (P.role !== "host") return;
  if (isSecret(key)) { toast("Secret files (.env, keys) are always private"); return; }
  const was = priv.has(key);
  if (was) priv.delete(key); else priv.add(key);
  const name = key.endsWith("/") ? key.slice(ROOT.length, -1) + "/" : key.slice(ROOT.length);
  toast(was ? `Shared again: ${name}` : `Private: ${name} is no longer shared`);
  say((was ? "shared " : "private ") + name);
  syncOut(); sendTabs(true); redrawMarks();
}
/** The view the guest may follow: nothing inside a private file. */
const sharedView = (v: ViewMsg): ViewMsg =>
  v.path && isPrivate(v.path) ? { path: null, top: 0, line: 0, col: 0, tab: null, kind: null } : v;
/* the editor's tabs (`editorStore.tabs`; the old `TABS` global is always empty) */
const openTabs = (): Tab[] => editorStore.tabs as Tab[];
function sharedTabs(): string[] {
  return openTabs().filter(t => t.kind === "file" && t.path && FS[t.path] && !isPrivate(t.path)).map(t => t.path as string);
}
let lastTabs = "";
/** Host → guest: the open tabs it shares (the guest mirrors exactly these). */
function sendTabs(force?: boolean): void {
  if (!live() || P.role !== "host") return;
  const tabs = sharedTabs(), k = JSON.stringify(tabs);
  if (!force && k === lastTabs) return;
  lastTabs = k;
  void send({ t: "tabs", tabs });
}
function applyTabs(paths: string[]): void {
  P.peerTabs = paths;
  if (P.follow) {
    openTabs().filter(t => t.kind === "file" && t.path && !paths.includes(t.path)).map(t => t.id).forEach(id => { try { closeTab(id); } catch { /* */ } });
    paths.forEach(p => { if (!tabOf(p)) openTab({ id: p, title: p.split("/").pop() || p, kind: "file", path: p }, false); });
  }
  redrawMarks();
}
function redrawMarks(): void { try { drawTabs(); } catch { /* sem separadores */ } markRows(); }
/** Private files and folders in the explorer (host). */
function markRows(): void {
  document.querySelectorAll<HTMLElement>("#exp-sections .row").forEach(r => {
    const k = r.dataset.path ?? (r.dataset.dpath ? r.dataset.dpath + "/" : "");
    r.classList.toggle("pair-private", P.role === "host" && !!k && isPrivate(k));
  });
}
document.addEventListener("contextmenu", e => {
  if (P.role !== "host") return;
  const r = (e.target as HTMLElement | null)?.closest<HTMLElement>("#exp-sections .row");
  const k = r ? r.dataset.path ?? (r.dataset.dpath ? r.dataset.dpath + "/" : "") : "";
  if (!k) return;
  e.preventDefault();
  togglePrivate(k);
});
tabMarks.set(
  (t, el) => {
    if (!live() || !t.path || t.kind !== "file") return;
    const p = P.role === "host" && isPrivate(t.path);
    el.classList.add(p ? "pair-private" : "pair-shared");
    el.insertAdjacentHTML("afterbegin", `<span class="pair-ti" title="${p ? "Only you see this tab" : "Shared with " + escH(P.peerName || "your pair")}">${p ? "🙈" : "👥"}</span>`);
    if (P.role === "host") el.oncontextmenu = e => { e.preventDefault(); togglePrivate(t.path as string); };
  },
  bar => {
    if (!live()) return;
    const host = P.role === "host", n = host ? sharedTabs().length : (P.peerTabs || []).length;
    bar.insertAdjacentHTML("beforeend", `<span class="pair-legend" title="${host ? "Right-click a tab or a folder in the explorer to make it private" : "The tabs " + escH(P.peerName || "the host") + " shares with you"}">${host ? "Shared with" : "Shared by"} ${escH(P.peerName || "your pair")} · ${n} tab${n === 1 ? "" : "s"}</span>`);
  },
);

function send(o: Msg): Promise<void> {
  if (!live()) return Promise.resolve();
  return pairc.send(JSON.stringify(o)).catch(e => say(String(e)));
}

/* ───── session ───── */
async function start(): Promise<void> {
  if (P.role) { openPanel(); return; }
  try {
    P.token = await pairc.host(myName() + (R.name ? " · " + R.name : ""));
    P.role = "host"; P.driver = "host"; P.state = "waiting"; openPanel();
    say("session started — share the token");
  } catch (e) { toast("PairCode could not start: " + e); }
}
async function join(token: string, via?: string): Promise<void> {
  token = (token || "").trim();
  if (!token) { toast("Paste the token first"); return; }
  P.role = "guest"; P.state = "joining"; P.driver = "host"; drawPanel();
  try {
    P.peerName = await pairc.join(token, via || null);
    say("connected to " + P.peerName);
  } catch (e) {
    P.role = null; P.state = "idle"; drawPanel();
    toast(String(e).slice(0, 200)); say(String(e));
  }
}
async function end(): Promise<void> { await send({ t: "bye" }); await pairc.stop(); cleanup(); }
function cleanup(): void {
  stopCall();
  if (P.role === "guest") leaveRemote();
  P.role = null; P.state = "idle"; P.token = null; P.peer = null; P.peerName = ""; P.driver = "host"; P.pendingReq = false;
  try { show(cur); } catch { /* sem tab activa */ }
  drawDock(); drawPanel(); drawStatus();
}

void T.event.listen("pair-status", e => {
  const s = (e.payload || {}) as { state?: string; peer?: unknown; error?: string; message?: string };
  if (s.state === "waiting") {
    if (P.role === "host" && P.state === "connected") {
      toast((P.peerName || "Your pair") + " left the session");
      stopCall(); P.driver = "host";
      try { show(cur); } catch { /* */ }
    }
    P.state = P.role === "host" ? "waiting" : P.state;
    P.peerName = P.role === "host" ? "" : P.peerName;
  } else if (s.state === "connected") {
    P.state = "connected"; P.peer = s.peer; closePanel();
    void send({ t: "hello", name: myName(), rtc: !!window.RTCPeerConnection });
    if (P.role === "host") sendSnapshot();
  } else if (s.state === "ended" || (s.state === "disconnected" && P.role === "guest")) {
    if (P.role === "guest") { toast("PairCode session ended"); cleanup(); }
    // RF-P05: the host's token is single use and expires — the hosting ends with it
    else if (P.role === "host" && s.state === "ended") { toast(s.message || "PairCode: a sessão terminou; o token já não serve"); cleanup(); }
  } else if (s.state === "error") {
    toast(s.error || "PairCode error");
    if (P.role === "guest") cleanup();
  } else if (s.state === "idle") { /* nada a fazer */ }
  drawPanel(); drawDock(); drawStatus();
});
void T.event.listen("pair-msg", e => {
  let m: Msg;
  try { m = JSON.parse(String(e.payload)); } catch { return; }
  handle(m).catch(err => say("message " + m.t + ": " + err));
});

async function handle(m: Msg): Promise<void> {
  if ((m as { t: string }).t === "codev") {
    // RF-S09: the host's Co-Dev writes; the guest's editor shows it live, read-only
    if (P.role === "guest") pairState.codevIn((m as unknown as { e: unknown }).e);
    return;
  }
  switch (m.t) {
    case "hello":
      P.peerName = m.name || P.peerName; P.peerRtc = !!m.rtc;
      toast(`${P.peerName} joined — PairCode`); say(P.peerName + " joined");
      drawAll(); void startCall(); break;
    /* frames de vídeo do par: só data-URLs de imagem em base64 (o valor vai para <img src>) */
    case "vf": if (isFrame(m.d)) onFrame(m.d); break;
    case "af": onAudio(m.d); break;
    /* o snapshot do workspace só flui anfitrião → convidado; no anfitrião seria o convidado a
       substituir-lhe a vista (e a soltar-lhe o R.root) */
    case "snap": if (P.role === "guest") enterRemote(m); break;
    /* edições remotas: o convidado aceita as do anfitrião (fonte de verdade); o anfitrião só as
       aceita enquanto o convidado conduz — um navigator não escreve no disco do anfitrião */
    case "files": if (P.role === "guest" || P.driver === "guest") applyFiles(m); break;
    /* os separadores partilhados pelo anfitrião (UI-PAIR-02): só chegam caminhos do snapshot */
    case "tabs":
      if (P.role === "guest" && Array.isArray(m.tabs)) applyTabs((m.tabs as unknown[]).filter((p): p is string => typeof p === "string" && !!FS[p]));
      break;
    case "view":
      P.peerView = m as unknown as ViewMsg;
      if (!amDriver()) applyView(P.peerView);
      break;
    case "ctl-req": askControl(m); break;
    /* passagem de comando. O anfitrião só aceita a devolução do controlo pelo convidado que está
       a conduzir; nunca um convidado a tomá-lo para si (o "cmd" a seguir correria no shell do
       anfitrião). O convidado aceita o que o anfitrião decidir (dar ou retomar). */
    case "ctl":
      if (m.driver !== "host" && m.driver !== "guest") break;
      if (P.role === "host" && !(P.driver === "guest" && m.driver === "host")) break;
      P.driver = m.driver; P.pendingReq = false;
      try { show(cur); } catch { /* */ }
      toast(amDriver() ? "You have control — you are driving" : `${P.peerName} is driving — you are navigating`);
      drawAll(); break;
    case "ctl-deny":
      P.pendingReq = false; toast(`${P.peerName} kept control for now`); drawAll(); break;
    case "term": if (P.role === "guest") mirrorLine(m); break;
    case "termclear":
      if (P.role === "guest") { const t = $("#term"); if (t) { t.innerHTML = ""; newInput(true); } }
      break;
    /* commands from the guest run through the host's own terminal (no pair.js, isto era um
       wrapper sobre handle; o guarda é o mesmo — fora dele a mensagem é ignorada) */
    case "cmd":
      if (P.role === "host" && P.driver === "guest" && typeof m.line === "string") {
        setPanelTab("terminal", true);
        applyingCmd = true;
        try { await window.run(m.line); } finally { applyingCmd = false; }
      }
      break;
    case "rtc-ready": if (P.role === "host") void offer(); break;
    case "rtc": await onRtc(m); break;
    case "av": P.peerAv = m; drawDock(); break;
    case "bye":
      if (P.role === "guest") { await pairc.stop(); toast("The host ended the session"); cleanup(); }
      break;
  }
}

/* ───── workspace: host is the source of truth ───── */
function realFiles(): Record<string, string> {
  const o: Record<string, string> = {};
  Object.keys(FS).forEach(k => { if (k.startsWith(ROOT) && !k.startsWith(ROOT + "learn/") && !isPrivate(k)) o[k] = FS[k].content; });
  return o;
}
function sendSnapshot(): void {
  P.sent = realFiles();
  const orig: Record<string, string | null> = {};
  Object.keys(P.sent).forEach(k => { if (FS[k].orig !== FS[k].content) orig[k] = FS[k].orig; });
  void send({ t: "snap", name: R.name || "workspace", branch: BRANCH, files: P.sent, orig, driver: P.driver, view: sharedView(viewNow()) });
  sendTabs(true);
}
function enterRemote(m: Msg): void {
  if (!P.backup) {
    try { R.flush && R.flush(); } catch { /* */ }
    P.backup = { fs: Object.assign({}, FS), root: R.root, name: R.name, git: R.git, branch: BRANCH, cwd: cwd.get().slice() };
  }
  R.root = null; R.git = false; R.remote = true; R.name = m.name;
  try { openTabs().filter(t => t.kind === "file" || t.path).map(t => t.id).forEach(id => closeTab(id)); } catch { /* */ }
  Object.keys(FS).forEach(k => { if (!k.startsWith(ROOT + "learn/")) delete FS[k]; });
  Object.entries(m.files as Record<string, string>).forEach(([k, c]) => { FS[k] = { content: c, orig: k in m.orig ? m.orig[k] : c }; });
  P.sent = Object.assign({}, m.files);
  BRANCH = m.branch || "remote";
  try { $("#st-branch-l")!.textContent = BRANCH; } catch { /* */ }
  cwd.set([m.name]); workspaceStore.openDirs.clear(); workspaceStore.openDirs.add("dxtutor"); P.driver = m.driver || "host";
  document.title = `${m.name} (PairCode with ${P.peerName}) — dxtutor IDE`;
  const t = $("#term");
  if (t) {
    t.innerHTML = "";
    echo(`<span class="ac">shared terminal</span> <span class="dim">· runs on ${escH(P.peerName)}'s machine · the driver types</span>`);
    newInput(true);
  }
  refresh(false, true);
  if (m.view) applyView(m.view, true);
  drawAll();
  say(`showing ${m.name} from ${P.peerName}: ${Object.keys(m.files).length} files`);
}
function leaveRemote(): void {
  const b = P.backup;
  if (!b) return;
  P.backup = null; R.remote = false;
  try { openTabs().filter(t => t.kind === "file" || t.path).map(t => t.id).forEach(id => closeTab(id)); } catch { /* */ }
  Object.keys(FS).forEach(k => delete FS[k]);
  Object.assign(FS, b.fs);
  R.root = b.root; R.name = b.name; R.git = b.git; BRANCH = b.branch; cwd.set(b.cwd);
  try { $("#st-branch-l")!.textContent = BRANCH; } catch { /* */ }
  document.title = (R.name ? R.name + " — " : "") + "dxtutor IDE";
  refresh(false, true);
  if (R.root) { R.reloadDisk && void R.reloadDisk(); }
  const t = $("#term");
  if (t) { t.innerHTML = ""; newInput(true); }
}
let syncT: number | undefined, applying = false;
/* U3c: envia as mudanças ao parceiro a cada mudança do workspace (antes: decorava o refresh) */
bus.on("workspace:changed", () => {
  if (live() && !applying) { clearTimeout(syncT); syncT = window.setTimeout(syncOut, 120); }
});
function syncOut(): void {
  if (!live()) return;
  const now = realFiles(), set: Record<string, string> = {}, del: string[] = [];
  Object.keys(now).forEach(k => { if (P.sent[k] !== now[k]) set[k] = now[k]; });
  Object.keys(P.sent).forEach(k => { if (!(k in now)) del.push(k); });
  if (!Object.keys(set).length && !del.length) return;
  Object.assign(P.sent, set);
  del.forEach(k => delete P.sent[k]);
  void send({ t: "files", set, del });
}
/* caminhos que um par nunca escreve/apaga no anfitrião: .git/ (hooks = execução no próximo
   commit), segmentos ".." ou vazios, absolutos e caracteres de controlo. */
const unsafeRemotePath = (k: string): boolean =>
  typeof k !== "string" || /[\0-\x1f]/.test(k) || k.startsWith("/") || /^[A-Za-z]:/.test(k) ||
  k.split(/[\\/]/).some(seg => seg === ".." || seg === "." || seg.toLowerCase() === ".git");
const isFrame = (d: unknown): d is string =>
  typeof d === "string" && d.length < 4_000_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d);
function applyFiles(m: Msg): void {
  if (P.role === "host") {
    const set = (m.set && typeof m.set === "object" ? m.set : {}) as Record<string, unknown>;
    /* nem caminhos privados: o convidado não os conhece, e não os cria nem apaga (UI-PAIR-01) */
    const bad = Object.keys(set).filter(k => unsafeRemotePath(k) || typeof set[k] !== "string" || isPrivate(k))
      .concat(((Array.isArray(m.del) ? m.del : []) as unknown[]).filter(k => unsafeRemotePath(k as string) || isPrivate(k as string)) as string[]);
    if (bad.length) { say("blocked remote edit: " + bad.slice(0, 3).join(", ")); toast("PairCode: edição remota bloqueada (" + bad.length + " caminho(s) não permitidos)"); return; }
  }
  applying = true;
  try {
    const t = tabOf(cur), open = t && t.path;
    let touched = false;
    Object.entries((m.set || {}) as Record<string, string>).forEach(([k, c]) => {
      if (FS[k]) FS[k].content = c;
      else {
        FS[k] = { content: c, orig: null };
        const d = k.split("/"); d.pop();
        while (d.length) { workspaceStore.openDirs.add(d.join("/")); d.pop(); }
      }
      P.sent[k] = c;
      if (k === open) touched = true;
    });
    /* um ficheiro que deixou de ser partilhado (ou foi apagado) fecha também o seu separador */
    ((m.del || []) as string[]).forEach(k => { delete FS[k]; delete P.sent[k]; if (P.role === "guest" && tabOf(k)) { try { closeTab(k); } catch { /* */ } } });
    if (touched && !amDriver()) {
      const eb = $("#ebody"), top = eb ? eb.scrollTop : 0;
      refresh(false, true); show(cur);
      const e2 = $("#ebody"); if (e2) e2.scrollTop = top;
    } else refresh(true, true);
    if (P.peerView) drawCaret(P.peerView);
  } finally { applying = false; }
}

/* ───── follow the driver: open file, scroll and cursor ───── */
function viewNow(): ViewMsg {
  const t = tabOf(cur), ta = $("#ed-ta") as HTMLTextAreaElement | null, eb = $("#ebody");
  return {
    path: (t && t.path) || null,
    top: eb ? Math.round(eb.scrollTop) : 0,
    line: ta ? ta.value.slice(0, ta.selectionStart).split("\n").length : 0,
    col: ta ? ta.selectionStart - ta.value.lastIndexOf("\n", ta.selectionStart - 1) - 1 : 0,
    tab: t ? t.id : null,
    kind: t ? t.kind : null,
  };
}
window.setInterval(() => {
  if (P.role === "host") markRows();
  if (!live()) return;
  sendTabs();
  const v = sharedView(viewNow()), k = JSON.stringify(v);
  if (k === P.lastView) return;
  P.lastView = k;
  void send(Object.assign({ t: "view", who: P.role }, v));
}, 200);
function applyView(v: ViewMsg, force?: boolean): void {
  if (!P.follow && !force) return;
  if (v.path && FS[v.path]) { const t = tabOf(cur); if (!t || t.path !== v.path) openPath(v.path); }
  const eb = $("#ebody");
  if (eb && v.path) eb.scrollTop = v.top;
  drawCaret(v);
}
function drawCaret(v: ViewMsg): void {
  document.querySelectorAll(".pair-caret").forEach(x => x.remove());
  const t = tabOf(cur);
  if (!live() || !t || t.path !== v.path || !v.line) return;
  const ta = $("#ed-ta"), wrap = ta && ta.parentElement;
  if (!ta || !wrap) return;
  const cs = getComputedStyle(ta), lh = parseFloat(cs.lineHeight) || 22, pt = parseFloat(cs.paddingTop) || 0;
  const d = document.createElement("div");
  d.className = "pair-caret";
  d.style.top = (pt + (v.line - 1) * lh) + "px";
  d.style.height = lh + "px";
  d.innerHTML = `<span>${escH(v.who === P.role ? "you" : P.peerName || v.who)}${P.driver === v.who ? " · driving" : ""}</span>`;
  wrap.appendChild(d);
}
const _file = VIEW.file;
VIEW.file = (t: unknown, host: unknown) => {
  _file(t, host);
  if (live() && !amDriver()) {
    const ta = $("#ed-ta") as HTMLTextAreaElement | null;
    if (ta) {
      ta.readOnly = true;
      ta.classList.add("pair-ro");
      ta.title = `${P.peerName || "Your pair"} is driving — request control to type`;
    }
  }
  if (live() && P.peerView && !amDriver()) setTimeout(() => drawCaret(P.peerView!), 0);
};
/* keystrokes from the navigator never reach the editor */
document.addEventListener("keydown", e => {
  if (!live() || amDriver()) return;
  const a = document.activeElement;
  if (a && a.id === "ed-ta" && !e.ctrlKey && !e.metaKey && e.key.length === 1) { e.preventDefault(); nudge(); }
}, true);
let nudgeT = 0;
function nudge(): void {
  if (Date.now() - nudgeT < 4000) return;
  nudgeT = Date.now();
  toast(`${P.peerName || "Your pair"} is driving — Request control to type`);
}

/* ───── control: request, accept, hand over ───── */
function requestControl(): void {
  if (!live() || amDriver()) return;
  P.pendingReq = true;
  void send({ t: "ctl-req", from: P.role, name: myName() });
  toast(`Asked ${P.peerName} for control…`);
  drawAll();
}
function giveControl(): void {
  if (!live() || !amDriver()) return;
  P.driver = other(P.role!);
  void send({ t: "ctl", driver: P.driver });
  try { show(cur); } catch { /* */ }
  toast(`${P.peerName} is driving now`);
  drawAll();
}
function takeBack(): void {
  if (P.role !== "host" || !live()) return;
  P.driver = "host";
  void send({ t: "ctl", driver: "host" });
  try { show(cur); } catch { /* */ }
  toast("You took control back");
  drawAll();
}
function askControl(m: Msg): void {
  if (!amDriver()) { void send({ t: "ctl-deny" }); return; }
  P.ask = m;
  drawDock();
  if (/^host/.test(R.info.pairtest || "")) setTimeout(() => answer(true), /slow/.test(R.info.pairtest || "") ? 3500 : 300);
}
function answer(ok: boolean): void {
  if (!P.ask) return;
  P.ask = null;
  if (ok) giveControl(); else void send({ t: "ctl-deny" });
  drawDock();
}

/* ───── shared terminal: runs on the host, the driver types ───── */
const term = $("#term");
if (term) new MutationObserver(ms => {
  if (P.role !== "host" || !live()) return;
  ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1 && (n as HTMLElement).id !== "inputwrap" && (n as HTMLElement).classList.contains("line"))
      void send({ t: "term", text: n.textContent, err: !!(n as HTMLElement).querySelector(".er") });
  }));
}).observe(term, { childList: true });
function mirrorLine(m: Msg): void {
  const t = $("#term");
  if (!t) return;
  const d = document.createElement("div");
  d.className = "line";
  d.innerHTML = m.err ? '<span class="er">' + escH(m.text) + "</span>" : escH(m.text);
  const w = $("#inputwrap");
  w ? t.insertBefore(d, w) : t.appendChild(d);
  scrollTerm();
}
const _promptHTML = promptHTML;
promptHTML = function () {
  if (!R.remote) return _promptHTML();
  return `<span class="pr"><span>${escH(P.peerName || "host")}</span><span class="at">:</span><span class="pth">${escH(cwd.get().join("/"))}</span><span class="br"> (${escH(BRANCH)})</span><span class="at">$</span></span> `;
};
const _run = window.run;
window.run = function (raw?: string) {
  if (P.role === "guest" && live()) {
    const v = (raw || "").trim();
    if (!v) { newInput(); return; }
    if (!amDriver()) { nudge(); newInput(); return; }
    void send({ t: "cmd", line: v });
    const i = $("#cmd") as HTMLInputElement | null;
    if (i) i.value = "";
    return;
  }
  if (P.role === "host" && live() && P.driver === "guest" && !applyingCmd) { nudge(); newInput(); return; }
  return _run(raw);
};
let applyingCmd = false;
/* git stays on the host's machine */
(["commit", "checkout", "gitMerge", "gfStart", "gfFinish"] as const).forEach(n => {
  const f = (window as any)[n];
  if (typeof f !== "function") return;
  (window as any)[n] = function (this: unknown, ...a: unknown[]) {
    if (P.role === "guest" && live()) {
      toast(`git runs on ${P.peerName}'s machine — use the shared terminal while you drive`);
      return null;
    }
    return f.apply(this, a);
  };
});

/* ───── video call (WebRTC; signalling inside PairCode) ───── */
async function startCall(): Promise<void> {
  P.calls = (P.calls || 0) + 1;
  stopCall();
  P.frames = 0; P.audioIn = 0; P.sentAudio = 0;
  let ready: () => void = () => { /* */ };
  P.callReady = new Promise<void>(r => { ready = r; });
  P.cands = []; P.mediaErr = null;
  const gum = (c: MediaStreamConstraints): Promise<MediaStream | null> => Promise.race([
    P.fakeMedia ? Promise.resolve(P.fakeMedia) : SIM ? Promise.resolve(window.__PAIRSIM__!.media()) : navigator.mediaDevices.getUserMedia(c),
    new Promise<MediaStream | null>((_, no) => setTimeout(() => no(new Error("camera/microphone did not answer")), 12000)),
  ]);
  try {
    P.local = await gum({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } }, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const er = e as (Error & { constraint?: string }) | null;
    P.mediaErr = String((er && er.name + ": " + er.message + (er.constraint ? " (" + er.constraint + ")" : "")) || e);
    try { P.local = await gum({ audio: true }); } catch { P.local = null; }
  }
  P.mode = window.RTCPeerConnection && P.peerRtc && !P.forceRelay ? "rtc" : "relay";
  if (P.mode === "relay") {
    P.mic = true;
    P.cam = !!(P.local && P.local.getVideoTracks().length);
    startRelay(); drawDock(); ready(); sendAv();
    say("call: relayed through PairCode (no WebRTC on one side)");
    return;
  }
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  P.rtc = pc;
  if (P.local) P.local.getTracks().forEach(t => pc.addTrack(t, P.local!));
  if (!P.local || !P.local.getVideoTracks().length) pc.addTransceiver("video", { direction: "recvonly" });
  if (!P.local) pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = e => {
    const v = $("#pair-remote") as HTMLVideoElement | null;
    if (v) { v.srcObject = e.streams[0] || new MediaStream([e.track]); v.play().catch(() => { /* */ }); }
  };
  pc.onicecandidate = e => { if (e.candidate) void send({ t: "rtc", cand: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => drawDock();
  P.mic = true;
  P.cam = !!(P.local && P.local.getVideoTracks().length);
  drawDock(); ready();
  if (P.role === "guest") void send({ t: "rtc-ready" });
  sendAv();
}
async function offer(): Promise<void> {
  await P.callReady;
  const pc = P.rtc;
  if (!pc) return;
  const o = await pc.createOffer();
  await pc.setLocalDescription(o);
  void send({ t: "rtc", sdp: pc.localDescription });
}
async function onRtc(m: Msg): Promise<void> {
  await P.callReady;
  const pc = P.rtc;
  if (!pc) return;
  if (m.sdp) {
    await pc.setRemoteDescription(m.sdp);
    if (m.sdp.type === "offer") {
      const a = await pc.createAnswer();
      await pc.setLocalDescription(a);
      void send({ t: "rtc", sdp: pc.localDescription });
    }
    for (const c of P.cands.splice(0)) await pc.addIceCandidate(c).catch(() => { /* */ });
  } else if (m.cand) {
    if (pc.remoteDescription) await pc.addIceCandidate(m.cand).catch(() => { /* */ });
    else P.cands.push(m.cand);
  }
}
/* relay mode: when either webview lacks WebRTC (WebKitGTK on most Linux distros), the call goes
   through the encrypted PairCode channel — JPEG frames at 8 fps and 16 kHz PCM audio. Meant for LAN/VPN. */
function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(d: string): ArrayBuffer {
  const s = atob(d), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
function startRelay(): void {
  if (!P.local) return;
  const vt = P.local.getVideoTracks()[0], at = P.local.getAudioTracks()[0];
  if (vt) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true;
    v.srcObject = new MediaStream([vt]);
    v.play().catch(() => { /* */ });
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d")!;
    P.relayV = v;
    P.vTimer = window.setInterval(() => {
      if (!P.cam || !live()) return;
      const dv = $("#pair-self") as HTMLVideoElement | null;
      const src = v.readyState >= 2 ? v : dv && dv.readyState >= 2 ? dv : null;
      if (!src) { v.play().catch(() => { /* */ }); return; }
      g.drawImage(src, 0, 0, 320, 240);
      void send({ t: "vf", d: c.toDataURL("image/jpeg", 0.55) });
    }, 125);
  }
  if (at) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC!();
      P.capAc = ac;
      const src = ac.createMediaStreamSource(new MediaStream([at])), proc = ac.createScriptProcessor(4096, 1, 1), ratio = ac.sampleRate / 16000;
      proc.onaudioprocess = e => {
        if (!P.mic || !live()) return;
        const inp = e.inputBuffer.getChannelData(0), n = Math.floor(inp.length / ratio), out = new Int16Array(n);
        for (let i = 0; i < n; i++) { const x = inp[Math.floor(i * ratio)]; out[i] = Math.max(-1, Math.min(1, x)) * 32767; }
        void send({ t: "af", d: b64(out.buffer) });
        P.sentAudio = (P.sentAudio || 0) + 1;
      };
      src.connect(proc); proc.connect(ac.destination);
      P.capNodes = [src, proc];
      if (ac.state === "suspended") ac.resume().catch(() => { /* */ });
    } catch (e) { say("audio capture: " + e); }
  }
}
function onFrame(d: string): void {
  P.lastFrame = Date.now();
  P.frames = (P.frames || 0) + 1;
  const img = $("#pair-remote-img") as HTMLImageElement | null;
  if (img && !P.min) img.src = d;
  else if (!img) drawDock();
  P.lastFrameData = d;
  if (P.frames === 1) drawDock();
}
function onAudio(d: string): void {
  P.audioIn = (P.audioIn || 0) + 1;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!P.playAc) P.playAc = new AC!();
    const ac = P.playAc;
    if (ac.state === "suspended") ac.resume().catch(() => { /* */ });
    const pcm = new Int16Array(unb64(d)), buf = ac.createBuffer(1, pcm.length, 16000), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const now = ac.currentTime;
    if (!P.playT || P.playT < now || P.playT - now > 0.6) P.playT = now + 0.08;
    const sN = ac.createBufferSource();
    sN.buffer = buf;
    sN.connect(ac.destination);
    sN.start(P.playT);
    P.playT += buf.duration;
  } catch { /* áudio indisponível */ }
}
document.addEventListener("click", () => {
  if (P.playAc && P.playAc.state === "suspended") P.playAc.resume().catch(() => { /* */ });
  if (P.capAc && P.capAc.state === "suspended") P.capAc.resume().catch(() => { /* */ });
}, true);
function stopCall(): void {
  if (P.vTimer != null) clearInterval(P.vTimer);
  P.vTimer = null;
  if (P.capNodes) { P.capNodes.forEach(n => { try { n.disconnect(); } catch { /* */ } }); P.capNodes = null; }
  if (P.capAc) { P.capAc.close().catch(() => { /* */ }); P.capAc = null; }
  if (P.playAc) { P.playAc.close().catch(() => { /* */ }); P.playAc = null; }
  P.playT = 0; P.lastFrameData = null; P.relayV = null;
  if (P.rtc) { try { P.rtc.close(); } catch { /* */ } P.rtc = null; }
  if (P.local) { P.local.getTracks().forEach(t => t.stop()); P.local = null; }
  P.peerAv = null;
}
function sendAv(): void { void send({ t: "av", mic: P.mic, cam: P.cam }); }
function toggleMic(): void {
  if (!P.local) return;
  P.mic = !P.mic;
  P.local.getAudioTracks().forEach(t => (t.enabled = P.mic));
  sendAv(); drawDock();
}
function toggleCam(): void {
  if (!P.local || !P.local.getVideoTracks().length) return;
  P.cam = !P.cam;
  P.local.getVideoTracks().forEach(t => (t.enabled = P.cam));
  sendAv(); drawDock();
}

/* ───── UI: panel (start / join), floating call dock, status item ───── */
document.head.insertAdjacentHTML("beforeend", `<style>
#pair-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;place-items:center;z-index:900}
#pair-modal.on{display:grid}
#pair-modal .pm{width:min(560px,92vw);background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:18px 20px;box-shadow:var(--sh-pop);color:var(--fg)}
#pair-modal h3{margin:0 0 4px;font-size:16px}#pair-modal .dim{color:var(--fg-muted);font-size:12px}
#pair-modal textarea,#pair-modal input{width:100%;box-sizing:border-box;background:var(--bg-input);color:inherit;border:1px solid var(--border);border-radius:8px;padding:8px;font:12px var(--font-mono)}
#pair-modal textarea{height:74px;resize:none;word-break:break-all}
#pair-modal .row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
#pair-modal .tabs{display:flex;gap:6px;margin:12px 0}
#pair-dock{position:fixed;left:0;top:0;width:260px;background:var(--bg-elevated);border-top:1px solid var(--border-strong);z-index:800;overflow:hidden;font-size:12px;color:var(--fg);box-sizing:border-box}
#pair-dock .ph{display:flex;align-items:center;gap:6px;height:36px;box-sizing:border-box;padding:0 8px;user-select:none;border-bottom:1px solid var(--border)}
#pair-dock .ph b{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pair-dock .vid{position:relative;height:110px;background:#0c0d10}
#pair-dock video{width:100%;height:100%;object-fit:cover;display:block}
#pair-dock #pair-self{position:absolute;right:6px;bottom:6px;width:64px;height:48px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:#000;object-fit:cover}
#pair-dock .vl{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:5px}
#pair-dock .nov{position:absolute;inset:0;display:grid;place-items:center;color:var(--fg-muted);text-align:center;padding:10px}
#pair-dock .ctl{display:flex;gap:4px;padding:6px;flex-wrap:wrap}#pair-dock .ctl .mini{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pair-dock .ask{padding:8px;background:var(--accent-soft);border-top:1px solid var(--border)}
#pair-dock.min .vid,#pair-dock.min .ctl{display:none}
.pair-badge{padding:1px 6px;border-radius:9px;font-size:10.5px;background:rgba(92,201,167,.18);color:var(--green)}
.pair-badge.nav{background:rgba(110,168,255,.16);color:var(--blue)}
.pair-caret{position:absolute;left:0;right:0;border-left:2px solid var(--accent-hover);background:var(--accent-soft);pointer-events:none;z-index:3}
.pair-caret span{position:absolute;right:6px;top:-1px;font-size:10px;background:var(--accent-hover);color:var(--fg-bright);padding:0 5px;border-radius:0 0 4px 4px}
.ed-ta.pair-ro{cursor:default}
.side{box-sizing:border-box;padding-bottom:var(--pair-dock-h,0px)}
.tab .pair-ti{margin-right:4px;font-size:11px}.tab.pair-private .pair-ti{opacity:.65}.tab.pair-private .nm{font-style:italic;color:var(--fg-muted)}
.pair-legend{align-self:center;margin-left:auto;padding:1px 9px;border-radius:9px;font-size:11px;white-space:nowrap;background:rgba(92,201,167,.14);color:var(--green)}
#exp-sections .row.pair-private .nm{font-style:italic;color:var(--fg-muted)}#exp-sections .row.pair-private .nm::after{content:" · private";font-style:normal;font-size:10.5px;color:var(--fg-muted)}
#st-pair{display:none}
</style>`);
document.body.insertAdjacentHTML("beforeend", `<div id="pair-modal" data-action="pair:close"><div class="pm" id="pair-pm"></div></div><div id="pair-dock" style="display:none"></div>`);
let tab: "start" | "join" = "start";
function openPanel(t?: "start" | "join"): void {
  if (t) tab = t;
  $("#pair-modal")!.classList.add("on");
  drawPanel();
}
function closePanel(): void { $("#pair-modal")!.classList.remove("on"); }
function drawPanel(): void {
  drawPanel0();
  if (SIM) {
    const el = $("#pair-pm");
    if (el) el.insertAdjacentHTML("afterbegin", '<div class="dim" style="margin:0 0 8px;color:#e0b64a">Browser demo — the other developer is simulated. The desktop app connects for real.</div>');
  }
}
function drawPanel0(): void {
  const el = $("#pair-pm");
  if (!el) return;
  if (P.role === "host") {
    el.innerHTML = `<h3>PairCode — you are hosting</h3><div class="dim">Send this token to the other developer. It works once per session and holds the key that encrypts everything you share.</div>
    <div class="row"><textarea id="pair-tok" readonly>${escH(P.token || "")}</textarea></div>
    <div class="row"><button class="mini pri" data-action="pair:copy">Copy token</button><span class="dim">${live() ? `<b>${escH(P.peerName)}</b> is connected` : "waiting for your pair to join…"}</span><span style="flex:1"></span><button class="mini" data-action="pair:end">End session</button></div>
    <div class="dim" style="margin-top:10px">Both machines must reach each other: same network, or a VPN such as Tailscale/WireGuard. Across the internet without a VPN, forward TCP port ${escH((P.token && decodeTok(P.token).port) || 47821)} on the host's router and the guest uses "via".</div>`;
    return;
  }
  if (P.role === "guest") {
    el.innerHTML = `<h3>PairCode — ${live() ? "connected to " + escH(P.peerName) : "joining…"}</h3><div class="dim">You see ${escH(P.peerName || "the host")}'s workspace. ${amDriver() ? "You are driving." : "You are navigating — request control to type."}</div><div class="row"><span style="flex:1"></span><button class="mini" data-action="pair:end">Leave session</button></div>`;
    return;
  }
  el.innerHTML = `<h3>PairCode</h3><div class="dim">Pair programming: one drives, the other navigates. The guest sees the host's project live, both see and hear each other, and control changes hands on request.</div>
   <div class="tabs"><button class="mini ${tab === "start" ? "pri" : ""}" data-action="pair:tab" data-on="start">Host a session</button><button class="mini ${tab === "join" ? "pri" : ""}" data-action="pair:tab" data-on="join">Join with a token</button></div>
   ${tab === "start" ? `<div class="dim">Shares <b>${escH(R.root || "the sample workspace")}</b>. Your pair sees its files while the session lasts, except private ones: <b>.env</b> and key files are always private, and you can make any tab or folder private with a right-click.</div><div class="row"><button class="mini pri" data-action="pair:start">Start and get a token</button></div>`
    : `<div class="row"><textarea id="pair-in" placeholder="dxp_…"></textarea></div><div class="row"><input id="pair-via" placeholder="via (optional): host:port — for a tunnel or VPN address"></div><div class="row"><button class="mini pri" data-action="pair:join">Join</button><span class="dim">your open folder is set aside and comes back when you leave</span></div>`}`;
}
function decodeTok(t: string): { port?: number } {
  try { return JSON.parse(atob(t.slice(4).replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; }
}
function drawDock(): void {
  const d = $("#pair-dock");
  if (!d) return;
  if (!live()) { d.style.display = "none"; return; }
  d.style.display = "";
  d.classList.toggle("min", P.min);
  const relay = P.mode === "relay",
    remoteOn = relay ? !!P.frames || !!P.audioIn : P.rtc && P.rtc.connectionState === "connected",
    peerCam = (!P.peerAv || P.peerAv.cam) && (!relay || !!P.frames);
  const st = relay ? "relayed" : P.rtc ? P.rtc.connectionState : "";
  const keepSelf = $("#pair-self") as HTMLVideoElement | null, keepRemote = $("#pair-remote") as HTMLVideoElement | null;
  d.innerHTML = `<div class="ph" id="pair-drag"><span class="pdot" style="background:${remoteOn ? "var(--green,#5cc9a7)" : "#e0b64a"}"></span><b>${escH(P.peerName || "pair")}</b><span class="pair-badge ${amDriver() ? "" : "nav"}">${amDriver() ? "driving" : "navigating"}</span><button class="mini" title="Minimise" data-action="pair:min">${P.min ? "▢" : "–"}</button></div>
   <div class="vid">${relay ? `<img id="pair-remote-img" style="width:100%;height:100%;object-fit:cover;display:block" ${P.lastFrameData ? `src="${P.lastFrameData}"` : ""}>` : '<video id="pair-remote" autoplay playsinline></video>'}${!remoteOn || !peerCam ? `<div class="nov">${!remoteOn ? "connecting call… " + escH(st) : P.peerAv && !P.peerAv.cam ? escH(P.peerName) + " turned the camera off" : "no video from " + escH(P.peerName) + (relay ? " (audio only)" : "")}</div>` : ""}${relay ? '<span class="vl" style="left:auto;right:88px;top:6px;bottom:auto" title="No WebRTC on one side: video and audio go through the encrypted PairCode channel">relay</span>' : ""}
   <video id="pair-self" autoplay playsinline muted ${P.local && P.cam ? "" : 'style="display:none"'}></video><span class="vl">${escH(P.peerName)}${P.peerAv && !P.peerAv.mic ? " 🔇" : ""}</span></div>
   <div class="ctl"><button class="mini" title="${P.mic ? "Mute" : "Unmute"}" data-action="pair:mic" ${P.local ? "" : "disabled"}>${P.mic ? "🎙" : "🔇"}</button><button class="mini" title="${P.cam ? "Turn camera off" : "Turn camera on"}" data-action="pair:cam" ${P.local && P.local.getVideoTracks().length ? "" : "disabled"}>${P.cam ? "📷" : "🚫"}</button>
   <button class="mini" title="Follow the driver's file and cursor" data-action="pair:follow">${P.follow ? "◉ Follow" : "○ Follow"}</button><button class="mini" data-action="pair:end">${P.role === "host" ? "End" : "Leave"}</button></div>
   <div class="ctl" style="padding-top:0">${amDriver() ? `<button class="mini pri" data-action="pair:give">Give control to ${escH(P.peerName)}</button>` : `<button class="mini pri" data-action="pair:request" ${P.pendingReq ? "disabled" : ""}>${P.pendingReq ? "Waiting for an answer…" : "Request control"}</button>`}${P.role === "host" && !amDriver() ? `<button class="mini" data-action="pair:take">Take back</button>` : ""}</div>
   ${P.ask ? `<div class="ask"><b>${escH(P.peerName)}</b> asks for control of mouse and keyboard.<div class="ctl" style="padding:6px 0 0"><button class="mini pri" data-action="pair:answer" data-on="1">Give control</button><button class="mini" data-action="pair:answer" data-on="0">Not now</button></div></div>` : ""}`;
  /* keep the live video elements so the picture does not flash on every redraw */
  if (keepSelf && keepSelf.srcObject) {
    $("#pair-self")!.replaceWith(keepSelf);
    keepSelf.style.display = P.local && P.cam ? "" : "none";
  }
  if (keepRemote && keepRemote.srcObject && $("#pair-remote")) $("#pair-remote")!.replaceWith(keepRemote);
  const rv = $("#pair-remote") as HTMLVideoElement | null;
  if (rv && P.rtc && !rv.srcObject) {
    const rs = P.rtc.getReceivers().map(r => r.track).filter((x): x is MediaStreamTrack => !!x);
    if (rs.length) { rv.srcObject = new MediaStream(rs); rv.play().catch(() => { /* */ }); }
  }
  const sv = $("#pair-self") as HTMLVideoElement | null;
  if (sv && P.local && sv.srcObject !== P.local) { sv.srcObject = P.local; sv.play().catch(() => { /* */ }); }
  placeDock();
}
/* UI-PAIR-03: the call sits at the bottom of the side bar (whatever pane is open), at its full
   width; the side bar keeps that height free (`--pair-dock-h`), so nothing hides under it.
   Minimised it is just its 36 px header. With the side bar hidden, the call lives in the status
   bar item, which brings the side bar back. It never covers the editor or the Co-Dev chat. */
function sideRect(): DOMRect | null {
  const s = document.querySelector<HTMLElement>(".side");
  if (!s || s.offsetParent === null) return null;
  const r = s.getBoundingClientRect();
  return r.width > 40 && r.height > 80 ? r : null;
}
/* the reserved height changes the side bar's padding: write it only when it changes, so the
   ResizeObserver below does not loop on its own change */
function setDockH(px: number): void {
  const v = px + "px", root = document.documentElement;
  if (root.style.getPropertyValue("--pair-dock-h") !== v) root.style.setProperty("--pair-dock-h", v);
}
function placeDock(): void {
  const d = $("#pair-dock");
  if (!d || !live()) { setDockH(0); return; }
  const r = sideRect(), wasHidden = !!P.sideHidden;
  P.sideHidden = !r;
  if (!r) {
    d.style.display = "none";
    setDockH(0);
  } else {
    d.style.display = "";
    d.style.left = r.left + "px"; d.style.width = r.width + "px";
    d.style.top = r.bottom - d.offsetHeight + "px";
    setDockH(d.offsetHeight);
  }
  if (wasHidden !== P.sideHidden) drawStatus();
}
addEventListener("resize", placeDock);
try {
  let raf = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(placeDock); });
  [".side", "#ebody", "#agent", "#panel"].forEach(q => { const el = document.querySelector(q); if (el) ro.observe(el, { box: "border-box" }); });
} catch { /* sem ResizeObserver */ }
/* the side bar opens/closes without resizing anything we observe on some layouts: check now and then */
window.setInterval(() => { if (live()) placeDock(); }, 700);
function drawStatus(): void {
  let s = $("#st-pair");
  const anchor = $("#st-prob");
  if (!s && anchor) {
    anchor.insertAdjacentHTML("afterend", '<button class="si" id="st-pair" title="PairCode" data-action="pair:status"></button>');
    s = $("#st-pair");
  }
  if (!s) return;
  /* explicit: the stylesheet hides #st-pair by default, so "" would keep it hidden */
  s.style.display = P.role ? "inline-flex" : "none";
  s.textContent = P.role ? (live() ? `👥 ${P.peerName || "pair"} · ${amDriver() ? "driving" : "navigating"}${P.sideHidden ? " · show call" : ""}` : "👥 waiting for pair…") : "";
  s.title = live() && P.sideHidden ? "The call is in the side bar — show it" : "PairCode";
}
function drawAll(): void { drawPanel(); drawDock(); drawStatus(); redrawMarks(); }

P.ui = {
  open: () => openPanel(),
  close: closePanel,
  tab: t => { tab = t; drawPanel(); },
  start: () => void start(),
  join: () => join(($("#pair-in") as HTMLTextAreaElement | null)?.value ?? "", ($("#pair-via") as HTMLInputElement | null)?.value).then(() => { if (live() || P.state === "connected") closePanel(); }),
  end: () => { void end(); closePanel(); },
  copy: () => {
    const t = $("#pair-tok") as HTMLTextAreaElement | null;
    ((navigator.clipboard && navigator.clipboard.writeText(P.token ?? "")) || Promise.reject()).then(() => toast("Token copied")).catch(() => { t!.select(); document.execCommand("copy"); toast("Token copied"); });
  },
  mic: toggleMic,
  cam: toggleCam,
  follow: () => { P.follow = !P.follow; if (P.follow && P.peerView) applyView(P.peerView); drawDock(); },
  request: requestControl,
  give: giveControl,
  take: takeBack,
  answer,
  min: () => { P.min = !P.min; drawDock(); },
};

/* os botões do painel, da doca e da barra de estado chamam `PAIR.ui` no acto (eram `onclick="PAIR.ui.f()"` — ADR-0004, U5b) */
const ui = (): PairUi => window.PAIR.ui!;
registerActions({
  "pair:close": { click: (c) => { if (c.ev.target === c.el) ui().close(); } },
  ...Object.fromEntries((["copy", "end", "start", "join", "min", "mic", "cam", "follow", "give", "request", "take", "open"] as const)
    .map((f) => [`pair:${f}`, { click: () => void ui()[f]() }])),
  "pair:tab": { click: (c) => ui().tab(c.on as "start" | "join") },
  "pair:answer": { click: (c) => ui().answer(c.on === "1") },
  /* com a barra lateral escondida, o item de estado traz a chamada de volta (UI-PAIR-03) */
  "pair:status": { click: () => { if (live() && P.sideHidden) { toggleSide(); setTimeout(placeDock, 50); } else ui().open(); } },
});

/* menus, palette, shortcut */
const items = (): MenuItem[] => [
  { l: "PairCode: host a session…", k: "Ctrl+Alt+P", act: () => openPanel("start") },
  { l: "PairCode: join with a token…", act: () => openPanel("join") },
  { l: "PairCode: request control", act: requestControl },
  { l: "PairCode: give control", act: giveControl },
  { l: "PairCode: end session", act: () => end() },
];
MENUS.splice(MENUS.findIndex(m => m.t === "Help"), 0, { t: "Pair", get items() { return items(); } });
try { $("#menubar")!.innerHTML = ""; buildMenubar(); } catch { /* menubar ainda não montada */ }
CMD.unshift(
  ["PairCode: Host a session", "Ctrl+Alt+P", () => openPanel("start")],
  ["PairCode: Join with a token", "", () => openPanel("join")],
  ["PairCode: Request control", "", requestControl],
  ["PairCode: Give control", "", giveControl],
  ["PairCode: End session", "", () => end()],
);
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.altKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); openPanel(); }
}, true);
drawStatus();

/* ───── two-instance smoke test (DXTUTOR_PAIRTEST=host|guest) ───── */
void (async () => {
  while (!R.ready) await new Promise(r => setTimeout(r, 100));
  if (!R.info.pairtest) return;
  const role = R.info.pairtest.replace("-slow", ""), slow = /slow/.test(R.info.pairtest),
    pause = (ms: number) => new Promise(r => setTimeout(r, slow ? ms : 0));
  /* fake camera and microphone, built once, so the call pipeline runs on machines without devices */
  let fake: MediaStream | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d")!;
    let f = 0;
    const paint = () => {
      g.fillStyle = role === "host" ? "#e08a5b" : "#6ea8ff";
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#fff"; g.font = "28px sans-serif";
      g.fillText(role + " " + f++, 20, 130);
    };
    paint(); setInterval(paint, 100);
    const vs = c.captureStream(15), ac = new AudioContext(), o = ac.createOscillator(), dst = ac.createMediaStreamDestination();
    o.connect(dst); o.start();
    fake = new MediaStream([...vs.getVideoTracks(), ...dst.stream.getAudioTracks()]);
  } catch (e) { R.errors.push("fake media: " + e); }
  P.fakeMedia = fake;
  const dir = (R.info.selftest || "").replace(/[\\/][^\\/]*$/, ""),
    wait = async (f: () => unknown, ms = 15000) => {
      const t0 = Date.now();
      while (!f()) {
        if (Date.now() - t0 > ms) throw new Error("timeout");
        await new Promise(r => setTimeout(r, 100));
      }
    };
  const rep: { role: string; steps: Record<string, unknown>; errors: string[] } = { role, steps: {}, errors: R.errors };
  const step = async (n: string, f: () => unknown) => {
    try { rep.steps[n] = await f(); } catch (e) { rep.steps[n] = "FAIL: " + ((e as Error) && (e as Error).message || e); }
    await pause(2500);
  };
  if (role === "host") {
    await step("host", async () => {
      /* UI-PAIR-01: a secret and a private folder that must never reach the guest */
      writeFile(ROOT + ".env", "API_KEY=pairtest-secret\n");
      writeFile(ROOT + "notes/private.md", "# host only\n");
      R.flush!(); await R.idle!();
      await start();
      togglePrivate(ROOT + "notes/");
      openPath(ROOT + "main.rs");
      await fsc.writeFile(dir, "token.txt", P.token as string);
      if (slow) openPanel();
      return (P.token as string).slice(0, 12) + "…";
    });
    await step("guestJoined", async () => { await wait(() => live(), 30000); return P.peerName; });
    if (slow) { await pause(1500); closePanel(); }
    await step("controlGiven", async () => { await wait(() => P.driver === "guest"); return true; });
    await step("guestEditOnDisk", async () => {
      await wait(() => FS[ROOT + "main.rs"] && FS[ROOT + "main.rs"].content.includes("from guest"));
      R.flush!(); await R.idle!();
      return (await shellc.exec({ program: "cat", args: ["main.rs"], cwd: R.root })).stdout.trim();
    });
    await step("guestCommandRan", async () => {
      await wait(() => Object.keys(R.disk).includes("shared.txt") || false, 10000).catch(() => { /* */ });
      return (await shellc.exec({ program: "cat", args: ["shared.txt"], cwd: R.root })).stdout.trim();
    });
    await step("hostEditReachesGuest", async () => {
      takeBack();
      await new Promise(r => setTimeout(r, 300));
      writeFile(ROOT + "host-note.md", "# from host\n");
      await new Promise(r => setTimeout(r, 4000));
      return true;
    });
    await step("video", () => ({
      rtc: !!window.RTCPeerConnection, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      state: P.rtc && P.rtc.connectionState, mode: P.mode, framesIn: P.frames || 0, audioIn: P.audioIn || 0, audioOut: P.sentAudio || 0,
      dbg: { local: P.local && P.local.getTracks().map(t => t.kind + ":" + t.readyState + ":" + t.enabled), cap: P.capAc && P.capAc.state, vReady: P.relayV && P.relayV.readyState, cam: P.cam, mic: P.mic, calls: P.calls },
      err: P.mediaErr,
    }));
  } else {
    await step("join", async () => {
      let tok = "";
      const t0 = Date.now();
      while (!tok && Date.now() - t0 < 30000) {
        const r = await shellc.exec({ program: "cat", args: ["token.txt"], cwd: dir });
        tok = r.code === 0 ? r.stdout.trim() : "";
        if (!tok) await new Promise(r2 => setTimeout(r2, 300));
      }
      await join(tok);
      await wait(() => live() && FS[ROOT + "main.rs"]);
      return { peer: P.peerName, files: Object.keys(FS).filter(k => !k.includes("/learn/")).map(k => k.slice(ROOT.length)), driver: P.driver };
    });
    await step("privateNotShared", async () => {
      const files = Object.keys(FS).filter(k => !k.includes("/learn/")).map(k => k.slice(ROOT.length));
      const leaked = files.filter(f => f === ".env" || f.startsWith("notes/"));
      if (leaked.length) throw new Error("private files reached the guest: " + leaked.join(", "));
      return { files: files.length, leaked: 0 };
    });
    await step("sharedTabs", async () => {
      await wait(() => (P.peerTabs || []).includes(ROOT + "main.rs"));
      return { tabs: (P.peerTabs || []).map(p => p.slice(ROOT.length)), legend: ($("#tabs .pair-legend") || { textContent: "" }).textContent };
    });
    await step("readOnlyWhileNavigating", async () => {
      openPath(ROOT + "main.rs");
      await new Promise(r => setTimeout(r, 200));
      return ($("#ed-ta") as HTMLTextAreaElement).readOnly;
    });
    await step("followsHost", () => { const t = tabOf(cur); return t && t.path; });
    await step("control", async () => {
      requestControl();
      await wait(() => amDriver());
      await new Promise(r => setTimeout(r, 200));
      return { driver: P.driver, editable: !($("#ed-ta") as HTMLTextAreaElement).readOnly };
    });
    await step("edit", async () => {
      if (slow) {
        const base = FS[ROOT + "main.rs"].content, txt = "// from guest: pairing with PairCode\n";
        for (let i = 1; i <= txt.length; i += 2) {
          FS[ROOT + "main.rs"].content = txt.slice(0, i) + base;
          refresh(false, true);
          await new Promise(r => setTimeout(r, 70));
        }
      }
      FS[ROOT + "main.rs"].content = "// from guest\nfn main() {}\n" + (slow ? "\n// navigator: add a test for main next\n" : "");
      refresh(true);
      await new Promise(r => setTimeout(r, 600));
      return true;
    });
    await step("sharedTerminal", async () => {
      void window.run("echo shared-term > shared.txt && echo done-on-host");
      await wait(() => [...document.querySelectorAll("#term .line")].some(d => (d.textContent || "").trim() === "done-on-host"));
      return true;
    });
    await step("hostEditArrives", async () => {
      await wait(() => FS[ROOT + "host-note.md"]);
      return { content: FS[ROOT + "host-note.md"].content.trim(), driver: P.driver };
    });
    await step("video", () => ({
      rtc: !!window.RTCPeerConnection, media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      state: P.rtc && P.rtc.connectionState, mode: P.mode, framesIn: P.frames || 0, audioIn: P.audioIn || 0, audioOut: P.sentAudio || 0,
      dbg: { local: P.local && P.local.getTracks().map(t => t.kind + ":" + t.readyState + ":" + t.enabled), cap: P.capAc && P.capAc.state, vReady: P.relayV && P.relayV.readyState, cam: P.cam, mic: P.mic, calls: P.calls },
      err: P.mediaErr,
      img: !!($("#pair-remote-img") && ($("#pair-remote-img") as HTMLImageElement).src),
    }));
    await step("leave", async () => {
      await end();
      await new Promise(r => setTimeout(r, 300));
      return { restored: !R.remote, files: Object.keys(FS).length };
    });
  }
  await pause(3000);
  rep.errors = R.errors;
  await appc.selftestReport(rep);
})();
})();
