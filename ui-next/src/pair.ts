// ═════════ PairCode (pair programming XP) — porte de ui/pair.js para o ui-next ═════════
// Um programador aloja e recebe um token; o outro junta-se com ele. O convidado vê o
// workspace do anfitrião ao vivo e segue o condutor (ficheiro aberto, scroll, cursor).
// Um dos dois conduz — escreve no editor e no terminal partilhado — e o controlo só muda
// de mãos a pedido e com aceitação. Uma chamada (câmara + áudio) corre ao lado por WebRTC
// com a sinalização dentro do canal cifrado do PairCode; sem WebRTC num dos lados
// (WebKitGTK na maioria dos Linux), a chamada é retransmitida pelo próprio canal (relay:
// JPEG a 8 fps + PCM 16 kHz — pensado para LAN/VPN). Só na app desktop; zero simulação.

import { api, listen, type AppInfo } from "./tauri";
import { t } from "./i18n";
import type { Workspace } from "./workspace";
import type { Editor } from "./editor";
import type { Terminal } from "./terminal";

/** O que o PairCode precisa da App — fecho sobre o estado real, nunca cópias. */
export interface PairCtx {
  ws: Workspace;
  editor: Editor;
  terminal: Terminal;
  openTabs(): string[];
  openTab(): string | null;
  openFile(rel: string): void;
  closeTab(rel: string): void;
  renderTree(): void;
  /** autosave da App (no anfitrião, grava as edições do convidado no disco real). */
  flush(): Promise<void>;
  notify(msg: string): void;
  /** Abre a vista PairCode na sidebar (clique no item da statusbar). */
  showPair(): void;
  /** Foca a aba Terminal do painel (um comando do convidado vai correr). */
  showTerminal(): void;
}

type Wire = { t: string } & Record<string, unknown>;
interface ViewState { path: string | null; top: number; line: number; col: number; who?: string }
interface PeerAv { mic: boolean; cam: boolean }

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));

function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(d: string): ArrayBuffer {
  const s = atob(d);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

export class Pair {
  // ── estado da sessão ──
  role: "host" | "guest" | null = null;
  state: "idle" | "waiting" | "joining" | "connected" = "idle";
  token: string | null = null;
  peerName = "";
  driver: "host" | "guest" = "host";
  follow = true;
  private pendingReq = false;
  private ask: Wire | null = null;
  private peerView: ViewState | null = null;
  private peerAv: PeerAv | null = null;
  private peerRtc = false;
  private sent: Record<string, string> = {};
  private backup: { root: string; name: string; disk: Map<string, string>; buffers: Map<string, string> } | null = null;
  private remote = false; // convidado a mostrar o workspace do anfitrião
  private applying = false;
  private applyingCmd = false;
  private lastView = "";
  private tab: "start" | "join" = "start";
  private min = false;
  readonly errors: string[] = [];
  /** Modo de teste de duas instâncias (DXTUTOR_PAIRTEST=host|guest) — liga o auto-aceitar. */
  testRole: string | null = null;
  fakeMedia: MediaStream | null = null;

  // ── chamada ──
  private rtc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private callReady: Promise<void> | null = null;
  private cands: RTCIceCandidateInit[] = [];
  mic = true;
  cam = true;
  mode: "rtc" | "relay" | "" = "";
  frames = 0;
  audioIn = 0;
  sentAudio = 0;
  private mediaErr: string | null = null;
  private lastFrameData: string | null = null;
  private vTimer: number | null = null;
  private capAc: AudioContext | null = null;
  private playAc: AudioContext | null = null;
  private capNodes: AudioNode[] | null = null;
  private playT = 0;

  private dock: HTMLElement;

  constructor(private host: HTMLElement, readonly ctx: PairCtx) {
    this.dock = document.createElement("div");
    this.dock.id = "pair-dock";
    this.dock.style.display = "none";
    document.body.appendChild(this.dock);
    void this.wireEvents();
    this.wireTerminal();
    // Um tique único: envia a vista do condutor (200 ms, como o v7) e sincroniza ficheiros.
    window.setInterval(() => this.tick(), 200);
    document.addEventListener("click", () => {
      if (this.playAc?.state === "suspended") this.playAc.resume().catch(() => { /* */ });
      if (this.capAc?.state === "suspended") this.capAc.resume().catch(() => { /* */ });
    }, true);
    this.drawPanel();
  }

  // ── pequenos predicados ──
  private live(): boolean { return this.state === "connected"; }
  amDriver(): boolean { return this.role !== null && this.driver === this.role; }
  isRemote(): boolean { return this.remote; }
  /** O convidado em sessão nunca grava no disco local — as edições viajam para o anfitrião. */
  blocksAutosave(): boolean { return this.role === "guest" && this.remote; }
  private myName(): string { return this.ctx.ws.name || "dxtutor"; }
  private say(m: string): void { if (this.errors.length < 400) this.errors.push(`[paircode] ${m}`); }
  mediaError(): string | null { return this.mediaErr; }

  private send(o: Wire): Promise<void> {
    if (!this.live()) return Promise.resolve();
    return api.pairSend(JSON.stringify(o)).catch((e) => this.say(String(e)));
  }

  // ───── sessão ─────
  async start(): Promise<void> {
    if (this.role) { this.ctx.showPair(); return; }
    try {
      this.token = await api.pairHost(this.myName());
      this.role = "host";
      this.driver = "host";
      this.state = "waiting";
      this.ctx.showPair();
      this.drawAll();
    } catch (e) {
      this.ctx.notify(t("pair.startFailed", { err: String(e).slice(0, 160) }));
    }
  }

  async join(token: string, via?: string): Promise<void> {
    token = (token || "").trim();
    if (!token) { this.ctx.notify(t("pair.needToken")); return; }
    this.role = "guest";
    this.state = "joining";
    this.driver = "host";
    this.drawPanel();
    try {
      this.peerName = await api.pairJoin(token, via?.trim() || null);
      this.say(`connected to ${this.peerName}`);
    } catch (e) {
      this.role = null;
      this.state = "idle";
      this.drawPanel();
      this.ctx.notify(String(e).slice(0, 200));
    }
  }

  async end(): Promise<void> {
    await this.send({ t: "bye" });
    await api.pairStop().catch(() => { /* já parado */ });
    this.cleanup();
  }

  private cleanup(): void {
    this.stopCall();
    if (this.role === "guest") this.leaveRemote();
    this.role = null;
    this.state = "idle";
    this.token = null;
    this.peerName = "";
    this.driver = "host";
    this.pendingReq = false;
    this.ask = null;
    this.peerView = null;
    this.peerAv = null;
    this.sent = {};
    this.applyControl();
    this.ctx.editor.remoteCaret(null, 0, "");
    this.drawAll();
  }

  private async wireEvents(): Promise<void> {
    await listen("pair-status", (p) => {
      const s = (p ?? {}) as { state?: string; peer?: string; error?: string };
      if (s.state === "waiting") {
        if (this.role === "host" && this.state === "connected") {
          this.ctx.notify(t("pair.peerLeft", { peer: this.peerName || t("pair.yourPair") }));
          this.stopCall();
          this.driver = "host";
          this.applyControl();
        }
        if (this.role === "host") { this.state = "waiting"; this.peerName = ""; }
      } else if (s.state === "connected") {
        this.state = "connected";
        void this.send({ t: "hello", name: this.myName(), rtc: !!window.RTCPeerConnection });
        if (this.role === "host") void this.sendSnapshot();
      } else if (s.state === "ended" || (s.state === "disconnected" && this.role === "guest")) {
        if (this.role === "guest") { this.ctx.notify(t("pair.sessionEnded")); this.cleanup(); }
      } else if (s.state === "error") {
        this.ctx.notify(s.error ?? "PairCode error");
        if (this.role === "guest") this.cleanup();
      }
      this.drawAll();
    });
    await listen("pair-msg", (p) => {
      let m: Wire;
      try { m = JSON.parse(String(p)) as Wire; } catch { return; }
      void this.handle(m).catch((err) => this.say(`message ${m.t}: ${String(err)}`));
    });
  }

  private async handle(m: Wire): Promise<void> {
    switch (m.t) {
      case "hello":
        this.peerName = (m.name as string) || this.peerName;
        this.peerRtc = !!m.rtc;
        this.ctx.notify(t("pair.joined", { peer: this.peerName }));
        this.drawAll();
        void this.startCall();
        break;
      case "vf": this.onFrame(m.d as string); break;
      case "af": this.onAudio(m.d as string); break;
      case "snap": this.enterRemote(m); break;
      case "files": this.applyFiles(m); break;
      case "view":
        this.peerView = m as unknown as ViewState;
        if (!this.amDriver()) this.applyView(this.peerView);
        else this.drawCaret(this.peerView);
        break;
      case "ctl-req": this.askControl(m); break;
      case "ctl":
        this.driver = m.driver as "host" | "guest";
        this.pendingReq = false;
        this.applyControl();
        this.ctx.notify(this.amDriver() ? t("pair.youDrive") : t("pair.peerDrives", { peer: this.peerName }));
        this.drawAll();
        break;
      case "ctl-deny":
        this.pendingReq = false;
        this.ctx.notify(t("pair.keptControl", { peer: this.peerName }));
        this.drawAll();
        break;
      case "term":
        if (this.role === "guest") this.ctx.terminal.echoLine(String(m.text ?? ""), !!m.err);
        break;
      case "cmd":
        // comandos do convidado correm no terminal verdadeiro do anfitrião
        if (this.role === "host" && this.driver === "guest") {
          this.ctx.showTerminal();
          this.applyingCmd = true;
          try { await this.ctx.terminal.run(String(m.line ?? "")); } finally { this.applyingCmd = false; }
        }
        break;
      case "rtc-ready": if (this.role === "host") void this.offer(); break;
      case "rtc": await this.onRtc(m); break;
      case "av": this.peerAv = { mic: !!m.mic, cam: !!m.cam }; this.drawDock(); break;
      case "bye":
        if (this.role === "guest") {
          await api.pairStop().catch(() => { /* */ });
          this.ctx.notify(t("pair.hostEnded"));
          this.cleanup();
        }
        break;
      default: break; // mensagens futuras/desconhecidas: ignorar sem partir a sessão
    }
  }

  // ───── workspace: o anfitrião é a fonte de verdade ─────
  private realFiles(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const [rel, content] of this.ctx.ws.buffers) o[rel] = content;
    return o;
  }

  private async sendSnapshot(): Promise<void> {
    this.sent = this.realFiles();
    const branch = this.ctx.ws.open ? (await api.gitBranch(this.ctx.ws.root).catch(() => null)) ?? "" : "";
    await this.send({
      t: "snap", name: this.ctx.ws.name || "workspace", branch,
      files: this.sent, driver: this.driver, view: this.viewNow(),
    });
  }

  private enterRemote(m: Wire): void {
    const ws = this.ctx.ws;
    if (!this.backup) {
      this.backup = { root: ws.root, name: ws.name, disk: new Map(ws.disk), buffers: new Map(ws.buffers) };
    }
    this.remote = true;
    [...this.ctx.openTabs()].forEach((rel) => this.ctx.closeTab(rel));
    ws.root = "";
    ws.name = String(m.name ?? "remote");
    ws.disk.clear();
    ws.buffers.clear();
    const files = (m.files ?? {}) as Record<string, string>;
    for (const [rel, content] of Object.entries(files)) {
      ws.disk.set(rel, content);
      ws.buffers.set(rel, content);
    }
    this.sent = { ...files };
    this.driver = (m.driver as "host" | "guest") ?? "host";
    document.title = `${ws.name} (PairCode · ${this.peerName}) — dxtutor`;
    this.ctx.terminal.echoLine(t("pair.sharedTerm", { peer: this.peerName }), false);
    this.ctx.renderTree();
    this.applyControl();
    if (m.view) this.applyView(m.view as unknown as ViewState, true);
    this.drawAll();
    this.say(`showing ${ws.name} from ${this.peerName}: ${Object.keys(files).length} files`);
  }

  private leaveRemote(): void {
    const b = this.backup;
    if (!b) return;
    this.backup = null;
    this.remote = false;
    const ws = this.ctx.ws;
    [...this.ctx.openTabs()].forEach((rel) => this.ctx.closeTab(rel));
    ws.root = b.root;
    ws.name = b.name;
    ws.disk.clear();
    ws.buffers.clear();
    for (const [k, v] of b.disk) ws.disk.set(k, v);
    for (const [k, v] of b.buffers) ws.buffers.set(k, v);
    document.title = `${ws.name ? ws.name + " — " : ""}dxtutor`;
    this.ctx.renderTree();
  }

  /** Tique de 200 ms: vista do condutor + sincronização de ficheiros (debounce do v7). */
  private tick(): void {
    if (!this.live() || this.applying) return;
    const v = this.viewNow();
    const k = JSON.stringify(v);
    if (k !== this.lastView) {
      this.lastView = k;
      void this.send({ t: "view", who: this.role, ...v } as unknown as Wire);
    }
    this.syncOut();
  }

  private syncOut(): void {
    const now = this.realFiles();
    const set: Record<string, string> = {};
    const del: string[] = [];
    for (const k of Object.keys(now)) if (this.sent[k] !== now[k]) set[k] = now[k];
    for (const k of Object.keys(this.sent)) if (!(k in now)) del.push(k);
    if (!Object.keys(set).length && !del.length) return;
    Object.assign(this.sent, set);
    del.forEach((k) => delete this.sent[k]);
    void this.send({ t: "files", set, del });
  }

  private applyFiles(m: Wire): void {
    this.applying = true;
    try {
      const ws = this.ctx.ws;
      const open = this.ctx.openTab();
      const set = (m.set ?? {}) as Record<string, string>;
      const del = (m.del ?? []) as string[];
      let touched = false;
      let structural = false;
      for (const [rel, content] of Object.entries(set)) {
        if (!ws.buffers.has(rel)) structural = true;
        ws.setBuffer(rel, content);
        if (this.role === "guest") ws.disk.set(rel, content); // o disco do convidado é espelho
        this.sent[rel] = content;
        if (this.ctx.editor.hasModel(rel)) {
          const top = rel === open ? this.ctx.editor.viewState().top : 0;
          this.ctx.editor.setContent(rel, content);
          if (rel === open && !this.amDriver()) this.ctx.editor.setScrollTop(top);
        }
        if (rel === open) touched = true;
      }
      for (const rel of del) {
        structural = true;
        if (this.ctx.openTabs().includes(rel)) this.ctx.closeTab(rel);
        ws.buffers.delete(rel);
        ws.disk.delete(rel);
        delete this.sent[rel];
      }
      if (structural) this.ctx.renderTree();
      if (touched && this.peerView) this.drawCaret(this.peerView);
      // No anfitrião, as edições do convidado vão já para o disco real (fonte de verdade).
      if (this.role === "host" && (Object.keys(set).length || del.length)) void this.ctx.flush();
    } finally {
      this.applying = false;
    }
  }

  // ───── seguir o condutor: ficheiro aberto, scroll e cursor ─────
  private viewNow(): ViewState {
    const path = this.ctx.openTab();
    const v = this.ctx.editor.viewState();
    return { path, top: v.top, line: v.line, col: v.col };
  }

  private applyView(v: ViewState, force = false): void {
    if (!this.follow && !force) return;
    if (v.path && this.ctx.ws.buffers.has(v.path) && this.ctx.openTab() !== v.path) this.ctx.openFile(v.path);
    if (v.path) this.ctx.editor.setScrollTop(v.top);
    this.drawCaret(v);
  }

  private drawCaret(v: ViewState | null): void {
    if (!this.live() || !v || !v.path || v.line < 1) {
      this.ctx.editor.remoteCaret(null, 0, "");
      return;
    }
    const who = (v.who as "host" | "guest" | undefined) ?? (this.role === "host" ? "guest" : "host");
    const label = `${this.peerName || who}${this.driver === who ? ` · ${t("pair.drivingTag")}` : ""}`;
    this.ctx.editor.remoteCaret(v.path, v.line, label);
  }

  /** O editor fica só-de-leitura para quem navega; chamado em cada mudança de controlo. */
  applyControl(): void {
    const ro = this.live() && !this.amDriver();
    this.ctx.editor.setReadOnly(ro, ro ? t("pair.roMsg", { peer: this.peerName || t("pair.yourPair") }) : undefined);
  }

  /** A App abriu um ficheiro: repintar o caret remoto (o readOnly é da instância, persiste). */
  onFileOpened(): void {
    if (this.live() && this.peerView) this.drawCaret(this.peerView);
  }

  // ───── controlo: pedir, aceitar, devolver ─────
  requestControl(): void {
    if (!this.live() || this.amDriver()) return;
    this.pendingReq = true;
    void this.send({ t: "ctl-req", from: this.role, name: this.myName() });
    this.ctx.notify(t("pair.askedControl", { peer: this.peerName }));
    this.drawAll();
  }

  giveControl(): void {
    if (!this.live() || !this.amDriver()) return;
    this.driver = this.role === "host" ? "guest" : "host";
    void this.send({ t: "ctl", driver: this.driver });
    this.applyControl();
    this.ctx.notify(t("pair.peerDrives", { peer: this.peerName }));
    this.drawAll();
  }

  takeBack(): void {
    if (this.role !== "host" || !this.live()) return;
    this.driver = "host";
    void this.send({ t: "ctl", driver: "host" });
    this.applyControl();
    this.ctx.notify(t("pair.tookBack"));
    this.drawAll();
  }

  private askControl(m: Wire): void {
    if (!this.amDriver()) { void this.send({ t: "ctl-deny" }); return; }
    this.ask = m;
    this.drawDock();
    // No teste de duas instâncias o anfitrião aceita sozinho (como o v7).
    if (this.testRole && /^host/.test(this.testRole)) {
      window.setTimeout(() => this.answer(true), /slow/.test(this.testRole) ? 3500 : 300);
    }
  }

  answer(ok: boolean): void {
    if (!this.ask) return;
    this.ask = null;
    if (ok) this.giveControl();
    else void this.send({ t: "ctl-deny" });
    this.drawDock();
  }

  // ───── terminal partilhado: corre no anfitrião, o condutor escreve ─────
  private wireTerminal(): void {
    // Intercepção: comandos do convidado viajam para o anfitrião; quem navega só é avisado.
    this.ctx.terminal.intercept = (cmd) => {
      if (this.role === "guest" && this.live()) {
        if (!this.amDriver()) { this.nudge(); return true; }
        void this.send({ t: "cmd", line: cmd });
        return true;
      }
      if (this.role === "host" && this.live() && this.driver === "guest" && !this.applyingCmd) {
        this.nudge();
        return true;
      }
      return false;
    };
    // Espelho: cada linha escrita no terminal do anfitrião segue para o convidado.
    const out = document.querySelector("#term .term-out");
    if (out) {
      new MutationObserver((ms) => {
        if (this.role !== "host" || !this.live()) return;
        ms.forEach((mu) => mu.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n as HTMLElement).classList.contains("term-line")) {
            void this.send({ t: "term", text: n.textContent ?? "", err: (n as HTMLElement).classList.contains("err") });
          }
        }));
      }).observe(out, { childList: true });
    }
  }

  private nudgeT = 0;
  private nudge(): void {
    if (Date.now() - this.nudgeT < 4000) return;
    this.nudgeT = Date.now();
    this.ctx.notify(t("pair.peerDrivesNudge", { peer: this.peerName || t("pair.yourPair") }));
  }

  // ───── chamada de vídeo (WebRTC; sinalização dentro do PairCode) ─────
  private async startCall(): Promise<void> {
    this.stopCall();
    this.frames = 0;
    this.audioIn = 0;
    this.sentAudio = 0;
    this.cands = [];
    this.mediaErr = null;
    let ready: () => void = () => { /* */ };
    this.callReady = new Promise<void>((r) => { ready = r; });
    const gum = (c: MediaStreamConstraints): Promise<MediaStream> =>
      Promise.race([
        this.fakeMedia ? Promise.resolve(this.fakeMedia) : navigator.mediaDevices.getUserMedia(c),
        new Promise<MediaStream>((_, no) => setTimeout(() => no(new Error("camera/microphone did not answer")), 12000)),
      ]);
    try {
      this.local = await gum({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      const er = e as Error & { constraint?: string };
      this.mediaErr = `${er.name ?? ""}: ${er.message ?? String(e)}${er.constraint ? ` (${er.constraint})` : ""}`;
      try { this.local = await gum({ audio: true }); } catch { this.local = null; }
    }
    this.mode = window.RTCPeerConnection && this.peerRtc ? "rtc" : "relay";
    if (this.mode === "relay") {
      this.mic = true;
      this.cam = !!(this.local && this.local.getVideoTracks().length);
      this.startRelay();
      this.drawDock();
      ready();
      this.sendAv();
      this.say("call: relayed through PairCode (no WebRTC on one side)");
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    this.rtc = pc;
    if (this.local) this.local.getTracks().forEach((tr) => pc.addTrack(tr, this.local!));
    if (!this.local || !this.local.getVideoTracks().length) pc.addTransceiver("video", { direction: "recvonly" });
    if (!this.local) pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (e) => {
      const v = document.getElementById("pair-remote") as HTMLVideoElement | null;
      if (v) { v.srcObject = e.streams[0] ?? new MediaStream([e.track]); v.play().catch(() => { /* */ }); }
    };
    pc.onicecandidate = (e) => { if (e.candidate) void this.send({ t: "rtc", cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => this.drawDock();
    this.mic = true;
    this.cam = !!(this.local && this.local.getVideoTracks().length);
    this.drawDock();
    ready();
    if (this.role === "guest") void this.send({ t: "rtc-ready" });
    this.sendAv();
  }

  private async offer(): Promise<void> {
    await this.callReady;
    const pc = this.rtc;
    if (!pc) return;
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    void this.send({ t: "rtc", sdp: pc.localDescription?.toJSON() });
  }

  private async onRtc(m: Wire): Promise<void> {
    await this.callReady;
    const pc = this.rtc;
    if (!pc) return;
    const sdp = m.sdp as RTCSessionDescriptionInit | undefined;
    const cand = m.cand as RTCIceCandidateInit | undefined;
    if (sdp) {
      await pc.setRemoteDescription(sdp);
      if (sdp.type === "offer") {
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        void this.send({ t: "rtc", sdp: pc.localDescription?.toJSON() });
      }
      for (const c of this.cands.splice(0)) await pc.addIceCandidate(c).catch(() => { /* */ });
    } else if (cand) {
      if (pc.remoteDescription) await pc.addIceCandidate(cand).catch(() => { /* */ });
      else this.cands.push(cand);
    }
  }

  /* relay: sem WebRTC num dos lados, vídeo/áudio seguem pelo canal cifrado do PairCode. */
  private startRelay(): void {
    if (!this.local) return;
    const vt = this.local.getVideoTracks()[0];
    const at = this.local.getAudioTracks()[0];
    if (vt) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([vt]);
      v.play().catch(() => { /* */ });
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 240;
      const g = c.getContext("2d")!;
      this.vTimer = window.setInterval(() => {
        if (!this.cam || !this.live()) return;
        const dv = document.getElementById("pair-self") as HTMLVideoElement | null;
        const src = v.readyState >= 2 ? v : dv && dv.readyState >= 2 ? dv : null;
        if (!src) { v.play().catch(() => { /* */ }); return; }
        g.drawImage(src, 0, 0, 320, 240);
        void this.send({ t: "vf", d: c.toDataURL("image/jpeg", 0.55) });
      }, 125);
    }
    if (at) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ac = new AC!();
        this.capAc = ac;
        const src = ac.createMediaStreamSource(new MediaStream([at]));
        const proc = ac.createScriptProcessor(4096, 1, 1);
        const ratio = ac.sampleRate / 16000;
        proc.onaudioprocess = (e) => {
          if (!this.mic || !this.live()) return;
          const inp = e.inputBuffer.getChannelData(0);
          const n = Math.floor(inp.length / ratio);
          const out = new Int16Array(n);
          for (let i = 0; i < n; i++) {
            const x = inp[Math.floor(i * ratio)];
            out[i] = Math.max(-1, Math.min(1, x)) * 32767;
          }
          void this.send({ t: "af", d: b64(out.buffer) });
          this.sentAudio++;
        };
        src.connect(proc);
        proc.connect(ac.destination);
        this.capNodes = [src, proc];
        if (ac.state === "suspended") ac.resume().catch(() => { /* */ });
      } catch (e) {
        this.say("audio capture: " + String(e));
      }
    }
  }

  private onFrame(d: string): void {
    this.frames++;
    const img = document.getElementById("pair-remote-img") as HTMLImageElement | null;
    if (img && !this.min) img.src = d;
    else if (!img) this.drawDock();
    this.lastFrameData = d;
    if (this.frames === 1) this.drawDock();
  }

  private onAudio(d: string): void {
    this.audioIn++;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!this.playAc) this.playAc = new AC!();
      const ac = this.playAc;
      if (ac.state === "suspended") ac.resume().catch(() => { /* */ });
      const pcm = new Int16Array(unb64(d));
      const buf = ac.createBuffer(1, pcm.length, 16000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const now = ac.currentTime;
      if (!this.playT || this.playT < now || this.playT - now > 0.6) this.playT = now + 0.08;
      const sN = ac.createBufferSource();
      sN.buffer = buf;
      sN.connect(ac.destination);
      sN.start(this.playT);
      this.playT += buf.duration;
    } catch { /* áudio indisponível */ }
  }

  private stopCall(): void {
    if (this.vTimer !== null) { clearInterval(this.vTimer); this.vTimer = null; }
    if (this.capNodes) { this.capNodes.forEach((n) => { try { n.disconnect(); } catch { /* */ } }); this.capNodes = null; }
    if (this.capAc) { this.capAc.close().catch(() => { /* */ }); this.capAc = null; }
    if (this.playAc) { this.playAc.close().catch(() => { /* */ }); this.playAc = null; }
    this.playT = 0;
    this.lastFrameData = null;
    if (this.rtc) { try { this.rtc.close(); } catch { /* */ } this.rtc = null; }
    if (this.local) {
      if (this.local !== this.fakeMedia) this.local.getTracks().forEach((tr) => tr.stop());
      this.local = null;
    }
    this.peerAv = null;
  }

  private sendAv(): void { void this.send({ t: "av", mic: this.mic, cam: this.cam }); }
  toggleMic(): void {
    if (!this.local) return;
    this.mic = !this.mic;
    this.local.getAudioTracks().forEach((tr) => (tr.enabled = this.mic));
    this.sendAv();
    this.drawDock();
  }
  toggleCam(): void {
    if (!this.local || !this.local.getVideoTracks().length) return;
    this.cam = !this.cam;
    this.local.getVideoTracks().forEach((tr) => (tr.enabled = this.cam));
    this.sendAv();
    this.drawDock();
  }
  toggleFollow(): void {
    this.follow = !this.follow;
    if (this.follow && this.peerView) this.applyView(this.peerView);
    this.drawDock();
  }

  // ───── UI: painel lateral (alojar/juntar), dock flutuante da chamada, statusbar ─────
  applyLocale(): void { this.drawAll(); }

  drawAll(): void {
    this.drawPanel();
    this.drawDock();
    this.drawStatus();
  }

  refresh(): void { this.drawPanel(); }

  private drawPanel(): void {
    const el = this.host;
    if (this.role === "host") {
      el.innerHTML = `<div class="pair-pane">
        <h3>${t("pair.hosting")}</h3>
        <div class="pair-dim">${t("pair.tokenHint")}</div>
        <textarea class="pair-tok" readonly>${esc(this.token ?? "")}</textarea>
        <div class="pair-row">
          <button class="pair-btn pri pair-copy">${t("pair.copy")}</button>
          <span class="pair-dim">${this.live() ? t("pair.connectedTo", { peer: esc(this.peerName) }) : t("pair.waiting")}</span>
        </div>
        <div class="pair-row"><button class="pair-btn pair-end">${t("pair.end")}</button></div>
        <div class="pair-dim pair-net">${t("pair.netHint")}</div>
      </div>`;
      (el.querySelector(".pair-copy") as HTMLButtonElement).onclick = () => {
        const tok = this.token ?? "";
        (navigator.clipboard?.writeText(tok) ?? Promise.reject()).then(
          () => this.ctx.notify(t("pair.copied")),
          () => {
            const ta = el.querySelector(".pair-tok") as HTMLTextAreaElement;
            ta.select();
            document.execCommand("copy");
            this.ctx.notify(t("pair.copied"));
          },
        );
      };
      (el.querySelector(".pair-end") as HTMLButtonElement).onclick = () => void this.end();
      return;
    }
    if (this.role === "guest") {
      el.innerHTML = `<div class="pair-pane">
        <h3>${this.live() ? t("pair.connectedTo", { peer: esc(this.peerName) }) : t("pair.joining")}</h3>
        <div class="pair-dim">${this.live()
          ? (this.amDriver() ? t("pair.youDriveShort") : t("pair.navigatingShort", { peer: esc(this.peerName) }))
          : ""}</div>
        <div class="pair-row"><button class="pair-btn pair-end">${t("pair.leave")}</button></div>
      </div>`;
      (el.querySelector(".pair-end") as HTMLButtonElement).onclick = () => void this.end();
      return;
    }
    el.innerHTML = `<div class="pair-pane">
      <div class="pair-dim">${t("pair.intro")}</div>
      <div class="pair-tabs">
        <button class="pair-btn ${this.tab === "start" ? "pri" : ""} pair-t-start">${t("pair.hostTab")}</button>
        <button class="pair-btn ${this.tab === "join" ? "pri" : ""} pair-t-join">${t("pair.joinTab")}</button>
      </div>
      ${this.tab === "start"
        ? `<div class="pair-dim">${t("pair.shares", { root: esc(this.ctx.ws.root || t("pair.noFolder")) })}</div>
           <div class="pair-row"><button class="pair-btn pri pair-start">${t("pair.start")}</button></div>`
        : `<textarea class="pair-in" placeholder="dxp_…"></textarea>
           <input class="pair-via" placeholder="${t("pair.viaPh")}" />
           <div class="pair-row"><button class="pair-btn pri pair-join">${t("pair.join")}</button></div>
           <div class="pair-dim">${t("pair.joinHint")}</div>`}
    </div>`;
    (el.querySelector(".pair-t-start") as HTMLButtonElement).onclick = () => { this.tab = "start"; this.drawPanel(); };
    (el.querySelector(".pair-t-join") as HTMLButtonElement).onclick = () => { this.tab = "join"; this.drawPanel(); };
    const startBtn = el.querySelector(".pair-start") as HTMLButtonElement | null;
    if (startBtn) startBtn.onclick = () => void this.start();
    const joinBtn = el.querySelector(".pair-join") as HTMLButtonElement | null;
    if (joinBtn) {
      joinBtn.onclick = () => {
        const tok = (el.querySelector(".pair-in") as HTMLTextAreaElement).value;
        const via = (el.querySelector(".pair-via") as HTMLInputElement).value;
        void this.join(tok, via);
      };
    }
  }

  private drawDock(): void {
    const d = this.dock;
    if (!this.live()) { d.style.display = "none"; return; }
    d.style.display = "";
    d.classList.toggle("min", this.min);
    const relay = this.mode === "relay";
    const remoteOn = relay ? this.frames > 0 || this.audioIn > 0 : this.rtc?.connectionState === "connected";
    const peerCam = (!this.peerAv || this.peerAv.cam) && (!relay || this.frames > 0);
    const st = relay ? "relay" : this.rtc?.connectionState ?? "";
    const keepSelf = document.getElementById("pair-self") as HTMLVideoElement | null;
    const keepRemote = document.getElementById("pair-remote") as HTMLVideoElement | null;
    d.innerHTML = `<div class="ph">
        <span class="pdot ${remoteOn ? "on" : ""}"></span><b>${esc(this.peerName || "pair")}</b>
        <span class="pair-badge ${this.amDriver() ? "" : "nav"}">${this.amDriver() ? t("pair.drivingTag") : t("pair.navigatingTag")}</span>
        <button class="pair-mini pair-minb">${this.min ? "▢" : "–"}</button>
      </div>
      <div class="vid">
        ${relay
          ? `<img id="pair-remote-img" ${this.lastFrameData ? `src="${this.lastFrameData}"` : ""}>`
          : `<video id="pair-remote" autoplay playsinline></video>`}
        ${!remoteOn || !peerCam
          ? `<div class="nov">${!remoteOn
              ? `${t("pair.connectingCall")} ${esc(st)}`
              : this.peerAv && !this.peerAv.cam
                ? t("pair.camOffPeer", { peer: esc(this.peerName) })
                : t("pair.noVideo", { peer: esc(this.peerName) }) + (relay ? ` (${t("pair.audioOnly")})` : "")}</div>`
          : ""}
        ${relay ? `<span class="vl vl-relay" title="${t("pair.relayTitle")}">relay</span>` : ""}
        <video id="pair-self" autoplay playsinline muted ${this.local && this.cam ? "" : 'style="display:none"'}></video>
        <span class="vl">${esc(this.peerName)}${this.peerAv && !this.peerAv.mic ? " 🔇" : ""}</span>
      </div>
      <div class="ctl">
        <button class="pair-mini pair-micb" ${this.local ? "" : "disabled"}>${this.mic ? "🎙" : "🔇"}</button>
        <button class="pair-mini pair-camb" ${this.local && this.local.getVideoTracks().length ? "" : "disabled"}>${this.cam ? "📷" : "🚫"}</button>
        <button class="pair-mini pair-folb" title="${t("pair.followTitle")}">${this.follow ? "◉" : "○"} ${t("pair.follow")}</button>
        <button class="pair-mini pair-endb">${this.role === "host" ? t("pair.end") : t("pair.leave")}</button>
      </div>
      <div class="ctl ctl2">
        ${this.amDriver()
          ? `<button class="pair-mini pri pair-giveb">${t("pair.give", { peer: esc(this.peerName) })}</button>`
          : `<button class="pair-mini pri pair-reqb" ${this.pendingReq ? "disabled" : ""}>${this.pendingReq ? t("pair.waitingAnswer") : t("pair.request")}</button>`}
        ${this.role === "host" && !this.amDriver() ? `<button class="pair-mini pair-takeb">${t("pair.takeBack")}</button>` : ""}
      </div>
      ${this.ask
        ? `<div class="ask"><b>${esc(this.peerName)}</b> ${t("pair.asksControl")}
           <div class="ctl"><button class="pair-mini pri pair-okb">${t("pair.giveShort")}</button>
           <button class="pair-mini pair-nob">${t("pair.notNow")}</button></div></div>`
        : ""}`;
    // os elementos de vídeo vivos sobrevivem ao repintar (a imagem não pisca)
    if (keepSelf?.srcObject) {
      document.getElementById("pair-self")?.replaceWith(keepSelf);
      keepSelf.style.display = this.local && this.cam ? "" : "none";
    }
    if (keepRemote?.srcObject && document.getElementById("pair-remote")) {
      document.getElementById("pair-remote")!.replaceWith(keepRemote);
    }
    const rv = document.getElementById("pair-remote") as HTMLVideoElement | null;
    if (rv && this.rtc && !rv.srcObject) {
      const rs = this.rtc.getReceivers().map((r) => r.track).filter((x): x is MediaStreamTrack => !!x);
      if (rs.length) { rv.srcObject = new MediaStream(rs); rv.play().catch(() => { /* */ }); }
    }
    const sv = document.getElementById("pair-self") as HTMLVideoElement | null;
    if (sv && this.local && sv.srcObject !== this.local) { sv.srcObject = this.local; sv.play().catch(() => { /* */ }); }
    (d.querySelector(".pair-minb") as HTMLButtonElement).onclick = () => { this.min = !this.min; this.drawDock(); };
    (d.querySelector(".pair-micb") as HTMLButtonElement).onclick = () => this.toggleMic();
    (d.querySelector(".pair-camb") as HTMLButtonElement).onclick = () => this.toggleCam();
    (d.querySelector(".pair-folb") as HTMLButtonElement).onclick = () => this.toggleFollow();
    (d.querySelector(".pair-endb") as HTMLButtonElement).onclick = () => void this.end();
    (d.querySelector(".pair-giveb") as HTMLButtonElement | null)?.addEventListener("click", () => this.giveControl());
    (d.querySelector(".pair-reqb") as HTMLButtonElement | null)?.addEventListener("click", () => this.requestControl());
    (d.querySelector(".pair-takeb") as HTMLButtonElement | null)?.addEventListener("click", () => this.takeBack());
    (d.querySelector(".pair-okb") as HTMLButtonElement | null)?.addEventListener("click", () => this.answer(true));
    (d.querySelector(".pair-nob") as HTMLButtonElement | null)?.addEventListener("click", () => this.answer(false));
    this.wireDrag(d, d.querySelector(".ph") as HTMLElement);
  }

  private wireDrag(el: HTMLElement, h: HTMLElement | null): void {
    if (!h) return;
    h.onmousedown = (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const mv = (ev: MouseEvent) => {
        el.style.left = `${Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx))}px`;
        el.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
      };
      const up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); };
      addEventListener("mousemove", mv);
      addEventListener("mouseup", up);
    };
  }

  private drawStatus(): void {
    const s = document.querySelector(".sb-pair") as HTMLElement | null;
    if (!s) return;
    if (!s.onclick) s.onclick = () => this.ctx.showPair();
    s.style.display = this.role ? "" : "none";
    s.textContent = this.role
      ? this.live()
        ? `👥 ${this.peerName || "pair"} · ${this.amDriver() ? t("pair.drivingTag") : t("pair.navigatingTag")}`
        : `👥 ${t("pair.waitingShort")}`
      : "";
  }
}

// ───── teste de duas instâncias (DXTUTOR_PAIRTEST=host|guest), como no v7 ─────
// O anfitrião abre um repo descartável, aloja e escreve o token num ficheiro; o convidado
// lê-o, junta-se e percorre os passos observáveis (só-leitura, follow, controlo, edição a
// chegar ao disco do anfitrião, terminal partilhado, edição do anfitrião a chegar, vídeo,
// sair com o workspace reposto). Cada instância escreve o seu relatório e termina.
export async function runPairtest(pair: Pair, ctx: PairCtx, info: AppInfo): Promise<void> {
  const role = (info.pairtest ?? "").replace("-slow", "");
  const slow = /slow/.test(info.pairtest ?? "");
  pair.testRole = info.pairtest;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, slow ? ms : 0));
  const wait = async (f: () => boolean, ms = 15000): Promise<void> => {
    const t0 = Date.now();
    while (!f()) {
      if (Date.now() - t0 > ms) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // câmara e microfone falsos, construídos uma vez, para a chamada correr sem dispositivos
  try {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const g = c.getContext("2d")!;
    let f = 0;
    const paint = () => {
      g.fillStyle = role === "host" ? "#e06c3b" : "#6ea8ff";
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = "#fff";
      g.font = "28px sans-serif";
      g.fillText(`${role} ${f++}`, 20, 130);
    };
    paint();
    setInterval(paint, 100);
    const vs = (c as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(15);
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ac = new AC!();
    const o = ac.createOscillator();
    const dst = ac.createMediaStreamDestination();
    o.connect(dst);
    o.start();
    pair.fakeMedia = new MediaStream([...vs.getVideoTracks(), ...dst.stream.getAudioTracks()]);
  } catch (e) {
    pair.errors.push("fake media: " + String(e));
  }
  const dir = (info.selftest ?? "").replace(/[\\/][^\\/]*$/, "");
  const rep: { role: string; steps: Record<string, unknown>; errors: string[] } = { role, steps: {}, errors: pair.errors };
  const live = () => pair.state === "connected";
  const step = async (n: string, f: () => Promise<unknown> | unknown): Promise<void> => {
    try { rep.steps[n] = await f(); } catch (e) { rep.steps[n] = "FAIL: " + String((e as Error).message ?? e); }
    await pause(2500);
  };
  const videoStats = () => ({
    rtc: !!window.RTCPeerConnection,
    media: !!navigator.mediaDevices?.getUserMedia,
    mode: pair.mode,
    framesIn: pair.frames,
    audioIn: pair.audioIn,
    audioOut: pair.sentAudio,
    cam: pair.cam,
    mic: pair.mic,
    err: pair.mediaError(),
  });

  if (role === "host") {
    await step("host", async () => {
      await pair.start();
      if (!pair.token) throw new Error("no token");
      await api.writeFile(dir, "token.txt", pair.token);
      return pair.token.slice(0, 12) + "…";
    });
    await step("guestJoined", async () => { await wait(live, 30000); return pair.peerName; });
    await step("controlGiven", async () => { await wait(() => pair.driver === "guest", 30000); return true; });
    await step("guestEditOnDisk", async () => {
      await wait(() => (ctx.ws.buffers.get("main.rs") ?? "").includes("from guest"), 20000);
      await ctx.flush();
      return (await api.exec("cat", ["main.rs"], ctx.ws.root)).stdout.trim();
    });
    await step("guestCommandRan", async () => {
      const onDisk = async () => (await api.exec("cat", ["shared.txt"], ctx.ws.root)).code === 0;
      const t0 = Date.now();
      while (!(await onDisk()) && Date.now() - t0 < 15000) await sleep(300);
      return (await api.exec("cat", ["shared.txt"], ctx.ws.root)).stdout.trim();
    });
    await step("hostEditReachesGuest", async () => {
      pair.takeBack();
      await sleep(300);
      ctx.ws.setBuffer("host-note.md", "# from host\n");
      ctx.renderTree();
      await ctx.flush();
      await sleep(4000);
      return true;
    });
    await step("video", videoStats);
  } else {
    await step("join", async () => {
      let tok = "";
      const t0 = Date.now();
      while (!tok && Date.now() - t0 < 30000) {
        const r = await api.exec("cat", ["token.txt"], dir).catch(() => null);
        tok = r && r.code === 0 ? r.stdout.trim() : "";
        if (!tok) await sleep(300);
      }
      await pair.join(tok);
      await wait(() => live() && ctx.ws.buffers.has("main.rs"), 30000);
      return { peer: pair.peerName, files: [...ctx.ws.buffers.keys()], driver: pair.driver };
    });
    await step("readOnlyWhileNavigating", async () => {
      ctx.openFile("main.rs");
      await sleep(200);
      return ctx.editor.isReadOnly();
    });
    await step("followsHost", () => ctx.openTab());
    await step("control", async () => {
      pair.requestControl();
      await wait(() => pair.amDriver(), 20000);
      await sleep(200);
      return { driver: pair.driver, editable: !ctx.editor.isReadOnly() };
    });
    await step("edit", async () => {
      ctx.editor.setContent("main.rs", "// from guest\nfn main() {}\n");
      await sleep(600);
      return true;
    });
    await step("sharedTerminal", async () => {
      void ctx.terminal.run("echo shared-term > shared.txt && echo done-on-host");
      await wait(() => {
        const out = document.querySelector("#term .term-out")?.textContent ?? "";
        return out.includes("done-on-host");
      }, 20000);
      return true;
    });
    await step("hostEditArrives", async () => {
      await wait(() => ctx.ws.buffers.has("host-note.md"), 20000);
      return { content: (ctx.ws.buffers.get("host-note.md") ?? "").trim(), driver: pair.driver };
    });
    await step("video", videoStats);
    await step("leave", async () => {
      await pair.end();
      await sleep(300);
      return { restored: !pair.isRemote(), files: ctx.ws.buffers.size };
    });
  }
  await pause(3000);
  rep.errors = pair.errors;
  await api.selftestReport(rep);
}
