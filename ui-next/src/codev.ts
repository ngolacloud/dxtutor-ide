// The Co-Dev dock: a real pair-programmer with two honest paths. Conversational replies
// stream live via assistant_chat_stream (llm://token events, Stop cancels for real, model
// picked from the LIVE provider list); the governed llm_chat tool loop over the open folder —
// read_file, run_command, write_file, list_files — stays intact for real work and the gates.
// No scripted missions, no fabricated results.

import { api, listen, type ChatReq, type LlmMsg, type LlmTool, type SessionInfo, type DeliverInfo, type AsstMsg, type StreamToken, type StreamDone, type StreamError, type CoDevPolicy, type ProviderInfo } from "./tauri";
import { svg } from "./icons";
import { t } from "./i18n";

interface Provider { id: string; endpoint: string; model: string; local: boolean }

/** Uma opção do selector de modelo: provedor com streaming + um dos seus modelos reais. */
interface StreamModel { provider: string; model: string | null; label: string }

/** Resultado de um turno em streaming (resolvido no done/erro/cancel). */
export interface StreamResult { text: string; tokens: number; model: string; cancelled: boolean; error: string | null }

const PROVIDERS: Provider[] = [
  { id: "claude", endpoint: "https://api.anthropic.com", model: "claude-haiku-4-5", local: false },
  { id: "ollama", endpoint: "http://localhost:11434", model: "qwen2.5-coder:14b", local: true },
];

interface Tool {
  def: LlmTool;
  run(input: Record<string, unknown>): Promise<string>;
}

export interface CodevHooks {
  root(): string;
  readBuffer(rel: string): string | undefined;
  writeBuffer(rel: string, content: string): Promise<void>;
  listFiles(): string[];
  /** A tab activa do editor (o chip @ do composer segue-a). null sem ficheiro aberto. */
  activeTab(): string | null;
  /** Markers Monaco reais de um ficheiro — o cartão «Corrigir erro» só nasce destes. */
  markers(rel: string): { line: number; col: number; message: string; error: boolean }[];
}

/** Um bloco de contexto pendente do composer (resultado real de /test ou /lint). */
interface CtxPart { kind: "test" | "lint"; label: string; content: string }

// ── Histórico persistente: UM ficheiro JSON em <configDir>/codev-history.json (padrão
// extensions.json da F10 — ficheiro, NUNCA localStorage: o perfil WebKitGTK persiste
// entre execuções e partiria o determinismo dos gates), com uma entrada por raiz de
// workspace (padrão board «um backlog por raiz»). ──
interface HistMsg { who: "you" | "codev"; text: string }
interface HistConv { title: string; msgs: HistMsg[] }
interface HistEntry { current: HistMsg[]; past: HistConv[] }

/** Uso real acumulado da sessão: turnos llm_chat com contagens MEDIDAS pelo backend e
 * turnos de streaming completos sem contagem (llm://done não as traz). */
export interface Usage { turns: number; inputTokens: number; outputTokens: number; unmeasured: number }

export class Codev {
  private keys: Record<string, boolean> = {};
  private out: HTMLElement;
  private input: HTMLInputElement;
  private hostEl!: HTMLElement;
  // ── Streaming: UM pedido vivo de cada vez; requestId é a única verdade sobre
  // «este stream ainda é meu» — fragmentos tardios pós-cancel são ignorados por ele. ──
  private models: StreamModel[] = [];
  private streamReq: string | null = null;
  private streamEl: HTMLElement | null = null;
  private streamBuf = "";
  private streamTok = 0;
  private streamSeq = 0;
  private streamSettle: ((r: StreamResult) => void) | null = null;
  private useTools = false; // true → submit vai pelo laço de ferramentas governado
  // ── Composer rico (F13): chips de contexto + cartões accionáveis + histórico em ficheiro ──
  private ctx: CtxPart[] = [];
  private includeActive = false; // chip @: incluir o ficheiro activo no próximo turno?
  /** O prompt EXACTO (com os blocos de contexto resolvidos) enviado no último turno —
   * o arnês verifica aqui que o conteúdo REAL do ficheiro entrou no plano do turno. */
  lastPlan = "";
  private provsCache: ProviderInfo[] = [];
  private hist: HistEntry = { current: [], past: [] };
  private histPath = "";
  private histRoot = "";
  private histWrites: Promise<void> = Promise.resolve();
  mode = "assist";
  // Ceiling do harness do projecto (.dxtutor/harness.toml): o modo MAIS alto permitido no
  // dock. Governa só a UI (botões acima ficam desactivados com a explicação); a matriz
  // codev_policy do backend continua a única verdade do que cada modo pode fazer.
  private ceiling: string | null = null;
  session: SessionInfo | null = null;
  onModeChange: ((mode: string) => void) | null = null;
  onSessionChange: ((s: SessionInfo | null) => void) | null = null;
  /** Cada evento real do dock (mensagem, ferramenta) — alimenta a aba Output. */
  onEvent: ((line: string) => void) | null = null;

  constructor(host: HTMLElement, private hooks: CodevHooks) {
    this.hostEl = host;
    host.innerHTML = `
      <div class="cd-head"><span class="cd-title">${svg("sparkle", "fill")} Co-Dev</span><span class="cd-headr"><span class="cd-provchip"><span class="cd-provdot"></span><span class="cd-provtxt"></span></span><select class="cd-model hidden"></select><button class="cd-histbtn">⟲</button><button class="cd-newchat">＋</button></span></div>
      <div class="cd-hist hidden"></div>
      <div class="cd-session">
        <span class="cd-sess-label"></span>
        <span class="cd-sess-actions">
          <button class="cd-sess-new"></button>
          <button class="cd-sess-deliver hidden"></button>
          <button class="cd-sess-discard hidden">${svg("close")}</button>
        </span>
      </div>
      <div class="cd-modes">
        <button class="cd-mode" data-mode="manual"></button>
        <button class="cd-mode on" data-mode="assist"></button>
        <button class="cd-mode" data-mode="auto"></button>
      </div>
      <div class="cd-modenote"></div>
      <div class="cd-policy"><button class="cd-policy-toggle"></button><div class="cd-matrix hidden"></div></div>
      <div class="cd-cards"></div>
      <div class="cd-msgs"></div>
      <div class="cd-chips"><button class="cd-at"></button><span class="cd-ctx"></span></div>
      <div class="cd-compose">
        <button class="cd-toolsbtn">⚙</button>
        <input class="cd-input" spellcheck="false" />
        <button class="cd-stop hidden"></button>
        <button class="cd-send">${svg("run", "fill")}</button>
      </div>`;
    host.querySelectorAll<HTMLButtonElement>(".cd-mode").forEach((b) => {
      b.onclick = () => void this.setMode(b.dataset.mode ?? "assist");
    });
    const polBtn = host.querySelector(".cd-policy-toggle") as HTMLButtonElement;
    polBtn.onclick = () => {
      const box = host.querySelector(".cd-matrix") as HTMLElement;
      const show = box.classList.contains("hidden");
      box.classList.toggle("hidden", !show);
      if (show) void this.showPolicyMatrix();
    };
    (host.querySelector(".cd-histbtn") as HTMLButtonElement).onclick = () => this.toggleHist();
    (host.querySelector(".cd-newchat") as HTMLButtonElement).onclick = () => this.newChat();
    (host.querySelector(".cd-at") as HTMLButtonElement).onclick = () => this.toggleAt();
    (host.querySelector(".cd-sess-new") as HTMLButtonElement).onclick = () => void this.newSessionPrompt();
    (host.querySelector(".cd-sess-deliver") as HTMLButtonElement).onclick = () => void this.deliverPrompt();
    (host.querySelector(".cd-sess-discard") as HTMLButtonElement).onclick = () => void this.discardSession();
    this.applyLocale();
    void this.setMode("assist");
    void this.renderSession();
    this.out = host.querySelector(".cd-msgs") as HTMLElement;
    this.input = host.querySelector(".cd-input") as HTMLInputElement;
    (host.querySelector(".cd-send") as HTMLButtonElement).onclick = () => void this.submit();
    (host.querySelector(".cd-stop") as HTMLButtonElement).onclick = () => this.cancelStream();
    const toolsBtn = host.querySelector(".cd-toolsbtn") as HTMLButtonElement;
    toolsBtn.onclick = () => {
      this.useTools = !this.useTools;
      toolsBtn.classList.toggle("on", this.useTools);
    };
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.submit(); });
    // Listeners de streaming: UMA vez, vida-da-app (não acumulam); o requestId filtra tudo.
    void listen("llm://token", (p) => this.onToken(p as StreamToken));
    void listen("llm://done", (p) => this.onDone(p as StreamDone));
    void listen("llm://error", (p) => this.onStreamError(p as StreamError));
    void this.loadKeys().then(() => this.loadModels()).then(() => this.refreshDock());
  }

  /** Repinta os rótulos estáticos do dock na locale corrente (mensagens ficam como estão). */
  applyLocale(): void {
    const q = (sel: string) => this.hostEl.querySelector(sel) as HTMLElement;
    q(".cd-sess-new").textContent = t("codev.newSession");
    q(".cd-sess-new").title = t("codev.newSessionTitle");
    q(".cd-sess-deliver").textContent = t("codev.deliver");
    q(".cd-sess-deliver").title = t("codev.deliverTitle");
    q(".cd-sess-discard").title = t("codev.discardTitle");
    this.hostEl.querySelectorAll<HTMLElement>(".cd-mode").forEach((b) => {
      b.textContent = t(`mode.${b.dataset.mode}`);
    });
    (q(".cd-input") as HTMLInputElement).placeholder = t("codev.placeholder");
    q(".cd-send").title = t("codev.send");
    q(".cd-stop").textContent = t("codev.stop");
    q(".cd-stop").title = t("codev.stopTitle");
    q(".cd-toolsbtn").title = t("codev.toolsTitle");
    q(".cd-model").title = t("codev.modelTitle");
    q(".cd-histbtn").title = t("codev.histTitle");
    q(".cd-newchat").title = t("codev.newChatTitle");
    this.updateProvChip();
    this.refreshDock();
    if (!q(".cd-hist").classList.contains("hidden")) this.renderHist();
    q(".cd-policy-toggle").textContent = t("pmx.toggle");
    q(".cd-policy-toggle").title = t("pmx.toggleTitle");
    if (!q(".cd-matrix").classList.contains("hidden")) void this.showPolicyMatrix();
    void this.setMode(this.mode);
    void this.renderSession();
  }

  // ── Matriz de política dos modos: SÓ LEITURA do codev_policy (a autoridade é o
  // backend — policy.rs); cada célula é renderizada do campo correspondente, nunca
  // de uma tabela hard-coded. Sem resposta do backend, mostra o erro — não inventa. ──

  /** Lê codev_policy para manual/assist/auto e desenha a matriz no dock. */
  async showPolicyMatrix(): Promise<void> {
    const box = this.hostEl.querySelector(".cd-matrix") as HTMLElement;
    box.classList.remove("hidden");
    const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    let ps: CoDevPolicy[];
    try {
      ps = await Promise.all(["manual", "assist", "auto"].map((m) => api.codevPolicy(m)));
    } catch (e) {
      box.textContent = t("pmx.err", { e: String(e) });
      return;
    }
    const cellTxt: Record<string, string> = { ask: t("pmx.asks"), auto: t("pmx.auto"), on: "✓", off: "—" };
    const row = (f: string, label: string, val: (p: CoDevPolicy) => string): string =>
      `<tr><td class="cdx-l">${esc(label)}</td>` + ps.map((p) => {
        const v = val(p);
        return `<td class="cdx-c cdx-${v}" data-pmx="${esc(p.mode)}:${f}" data-v="${v}">${esc(cellTxt[v])}</td>`;
      }).join("") + `</tr>`;
    box.innerHTML = `<table><thead><tr><th></th>${ps.map((p) => `<th>${esc(t("mode." + p.mode))}</th>`).join("")}</tr></thead><tbody>` +
      row("edits", t("pmx.edits"), (p) => (p.editsNeedApproval ? "ask" : "auto")) +
      row("commands", t("pmx.commands"), (p) => (p.commandsNeedApproval ? "ask" : "auto")) +
      row("chains", t("pmx.chains"), (p) => (p.chains ? "on" : "off")) +
      row("destructive", t("pmx.destructive"), (p) => (p.destructiveAlwaysAsks ? "ask" : "auto")) +
      `</tbody></table><div class="cdx-note">${esc(t("pmx.note"))}</div>`;
  }

  /** O valor mostrado numa célula da matriz ("ask"/"auto"/"on"/"off") — para o arnês
   * comparar o DOM com o codev_policy fresco. null quando a matriz não está desenhada. */
  matrixCell(mode: string, field: string): string | null {
    const el = this.hostEl.querySelector<HTMLElement>(`[data-pmx="${mode}:${field}"]`);
    return el ? el.dataset.v ?? null : null;
  }

  async loadKeys(): Promise<void> {
    try {
      this.keys = await api.keysStatus();
    } catch {
      this.keys = {};
    }
  }

  private pickProvider(): Provider | null {
    // A hosted provider needs a key; a local one (Ollama) is always usable.
    return PROVIDERS.find((p) => p.local || this.keys[p.id]) ?? null;
  }

  hasProvider(): boolean {
    return this.pickProvider() !== null;
  }

  // ── Streaming (assistant_chat_stream): apresentação viva com Stop + selector de modelo.
  // O laço de ferramentas governado (chat(), llm_chat) fica intacto — são dois caminhos. ──

  /** Repovoa o selector com os provedores/modelos REAIS que fazem streaming agora
   * (list_providers: available + streaming — nada hardcoded). */
  async loadModels(): Promise<void> {
    const provs = await api.listProviders().catch(() => []);
    this.provsCache = provs;
    this.models = [];
    for (const p of provs.filter((p) => p.available && p.streaming)) {
      if (p.models.length) for (const m of p.models) this.models.push({ provider: p.id, model: m, label: `${p.id} · ${m}` });
      else this.models.push({ provider: p.id, model: null, label: p.id });
    }
    const sel = this.hostEl.querySelector(".cd-model") as HTMLSelectElement;
    sel.innerHTML = "";
    for (const [i, m] of this.models.entries()) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = m.label;
      sel.appendChild(o);
    }
    sel.classList.toggle("hidden", this.models.length === 0);
    sel.onchange = () => this.updateProvChip();
    this.updateProvChip();
  }

  /** O chip do header: provider·modelo VIVOS de list_providers — o modelo de streaming
   * escolhido quando existe, senão o primeiro provedor available; sem nenhum, diz
   * «sem provedor» (nunca se esconde, nunca inventa). */
  private updateProvChip(): void {
    const txt = this.hostEl.querySelector(".cd-provtxt") as HTMLElement;
    const dot = this.hostEl.querySelector(".cd-provdot") as HTMLElement;
    const m = this.pickedModel();
    const avail = this.provsCache.filter((p) => p.available);
    if (m) {
      txt.textContent = m.label;
      dot.className = "cd-provdot live";
    } else if (avail.length) {
      txt.textContent = avail[0].models[0] ? `${avail[0].id} · ${avail[0].models[0]}` : avail[0].id;
      dot.className = "cd-provdot live";
    } else {
      txt.textContent = t("codev.provNone");
      dot.className = "cd-provdot off";
    }
  }

  /** Há um provedor com streaming disponível AGORA? (para o arnês e o submit) */
  hasStreamModel(): boolean {
    return this.models.length > 0;
  }

  /** O modelo escolhido no selector (o primeiro por omissão). */
  private pickedModel(): StreamModel | null {
    const sel = this.hostEl.querySelector(".cd-model") as HTMLSelectElement;
    return this.models[Number(sel.value) || 0] ?? this.models[0] ?? null;
  }

  /** Um turno em streaming: os tokens pintam a bolha à medida que chegam (llm://token);
   * resolve no llm://done, no llm://error, no Stop ou num timeout honesto. Modo project —
   * a política continua a ser decidida pelo backend. */
  chatStream(prompt: string): Promise<StreamResult> {
    const m = this.pickedModel();
    if (!m) return Promise.reject(new Error(t("codev.noProvider")));
    if (this.streamReq) this.cancelStream(); // um de cada vez; o anterior é interrompido
    const rid = `cd-${++this.streamSeq}-${Date.now()}`;
    this.streamReq = rid;
    this.streamBuf = "";
    this.streamTok = 0;
    const el = document.createElement("div");
    el.className = "cd-msg cd-codev cd-stream";
    this.out.appendChild(el);
    this.streamEl = el;
    this.hostEl.querySelector(".cd-stop")?.classList.remove("hidden");
    // O contexto dos chips (conteúdo REAL do ficheiro activo, veredictos /test//lint)
    // entra no turno aqui; o requestId continua a única verdade do stream (armadilha F4).
    const composed = this.composePrompt(prompt);
    this.lastPlan = composed;
    this.ctx = [];
    this.refreshDock();
    const msgs: AsstMsg[] = [{ role: "user", content: composed }];
    return new Promise<StreamResult>((resolve) => {
      this.streamSettle = resolve;
      // Timeout de segurança: um provedor pendurado resolve como erro, nunca um gate preso.
      const timer = setTimeout(() => {
        if (this.streamReq === rid) this.settleStream({ text: this.streamBuf, tokens: this.streamTok, model: m.label, cancelled: false, error: "timeout" });
      }, 180000);
      const prev = this.streamSettle;
      this.streamSettle = (r) => { clearTimeout(timer); prev?.(r); };
      api.assistantChatStream(msgs, m.provider, m.model, rid, "project").catch((e) => {
        if (this.streamReq === rid) this.settleStream({ text: "", tokens: 0, model: m.label, cancelled: false, error: String(e) });
      });
    });
  }

  /** O Stop: cancela no backend E invalida já o requestId — fragmentos tardios são lixo. */
  cancelStream(): void {
    const rid = this.streamReq;
    if (!rid) return;
    void api.assistantCancel(rid).catch(() => { /* já terminou */ });
    this.settleStream({ text: this.streamBuf, tokens: this.streamTok, model: "", cancelled: true, error: null });
  }

  /** Fecha o stream corrente (uma vez): repõe o UI e resolve a promessa do turno. */
  private settleStream(r: StreamResult): void {
    if (!this.streamReq) return;
    this.streamReq = null;
    const el = this.streamEl;
    this.streamEl = null;
    el?.classList.remove("cd-stream");
    if (el && !el.textContent) el.remove(); // nada chegou — sem bolha vazia
    this.hostEl.querySelector(".cd-stop")?.classList.add("hidden");
    if (r.text) {
      this.onEvent?.(r.cancelled ? `${r.text} …` : r.text);
      // O texto que REALMENTE chegou (mesmo parcial, após cancel) entra no histórico.
      this.hist.current.push({ who: "codev", text: r.text });
      this.persistHistory();
    }
    const settle = this.streamSettle;
    this.streamSettle = null;
    settle?.(r);
  }

  private onToken(p: StreamToken): void {
    if (p.requestId !== this.streamReq) return; // tardio/alheio — ignorado pela guarda
    this.streamTok++;
    this.streamBuf += p.delta;
    if (this.streamEl) {
      this.streamEl.textContent = this.streamBuf;
      this.out.scrollTop = this.out.scrollHeight;
    }
  }

  private onDone(p: StreamDone): void {
    if (p.requestId !== this.streamReq) return;
    // llm://done não traz contagens de tokens — o turno fica registado como «não medido».
    this.used.unmeasured++;
    this.settleStream({ text: this.streamBuf, tokens: this.streamTok, model: p.model, cancelled: false, error: null });
  }

  private onStreamError(p: StreamError): void {
    if (p.requestId !== this.streamReq) return;
    const err = p.error;
    this.settleStream({ text: this.streamBuf, tokens: this.streamTok, model: "", cancelled: false, error: err });
    this.addMsg("codev", t("codev.streamFailed", { err }));
  }

  /** Tokens já chegados do stream vivo (para o arnês afirmar «parciais antes do fim»). */
  streamTokens(): number {
    return this.streamTok;
  }

  // ── Observabilidade (F12): acumulador de uso REAL da sessão, em MEMÓRIA (nunca
  // localStorage — o perfil WebKitGTK persiste entre runs e partiria o gate). Cada turno
  // llm_chat soma os ChatResp.inputTokens/outputTokens que o backend MEDIU; um turno de
  // streaming completo conta como «não medido» porque llm://done traz {requestId, model}
  // SEM contagens — nunca se estima por caracteres (zero-demo). ──
  private used: Usage = { turns: 0, inputTokens: 0, outputTokens: 0, unmeasured: 0 };

  private recordUsage(r: { inputTokens: number; outputTokens: number }): void {
    this.used.turns++;
    this.used.inputTokens += r.inputTokens;
    this.used.outputTokens += r.outputTokens;
  }

  /** O uso acumulado da sessão — a vista Conta/Observabilidade lê daqui, nunca reconta. */
  usage(): Usage {
    return { ...this.used };
  }

  /** O texto da bolha em streaming tal como está AGORA (estável após cancel). */
  streamTextLive(): string {
    return this.streamBuf;
  }

  private static readonly MODE_ORDER: Record<string, number> = { manual: 0, assist: 1, auto: 2 };

  /** Aplica o ceiling do harness do projecto ao dock (null = sem harness, 3 modos livres):
   * modos acima ficam desactivados com a explicação, e o modo corrente é rebaixado se o
   * exceder. */
  setCeiling(ceiling: string | null): void {
    this.ceiling = ceiling && ceiling in Codev.MODE_ORDER ? ceiling : null;
    const max = this.ceiling ? Codev.MODE_ORDER[this.ceiling] : 2;
    this.hostEl.querySelectorAll<HTMLButtonElement>(".cd-mode").forEach((b) => {
      const above = (Codev.MODE_ORDER[b.dataset.mode ?? "manual"] ?? 0) > max;
      b.disabled = above;
      b.title = above ? t("codev.ceilingNote", { ceiling: t(`mode.${this.ceiling}`) }) : "";
    });
    void this.setMode((Codev.MODE_ORDER[this.mode] ?? 0) > max ? (this.ceiling as string) : this.mode);
  }

  /** O ceiling corrente e os modos desactivados por ele — para o arnês afirmar no DOM. */
  ceilingState(): { ceiling: string | null; disabled: string[] } {
    return {
      ceiling: this.ceiling,
      disabled: [...this.hostEl.querySelectorAll<HTMLButtonElement>(".cd-mode:disabled")]
        .map((b) => b.dataset.mode ?? ""),
    };
  }

  /** Switch the Co-Dev approval mode (Manual/Assist/Auto) and show the real policy note. */
  async setMode(mode: string): Promise<void> {
    // O ceiling do harness governa o dock: um pedido acima dele é rebaixado para o tecto.
    if (this.ceiling && (Codev.MODE_ORDER[mode] ?? 0) > Codev.MODE_ORDER[this.ceiling]) mode = this.ceiling;
    this.mode = mode;
    this.hostEl.querySelectorAll<HTMLElement>(".cd-mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    const note = this.hostEl.querySelector(".cd-modenote") as HTMLElement;
    try {
      const p = await api.codevPolicy(mode);
      note.textContent = (mode === "manual"
        ? t("codev.noteManual")
        : mode === "auto"
          ? t("codev.noteAuto")
          : t("codev.noteAssist"))
        + (this.ceiling && this.ceiling !== "auto"
          ? ` · ${t("codev.ceilingNote", { ceiling: t(`mode.${this.ceiling}`) })}`
          : "");
      void p;
    } catch {
      note.textContent = "";
    }
    this.onModeChange?.(mode);
  }

  // ── Sessions (Claude-Code style): each works in its own git worktree, integrated on deliver ──

  /** The folder the tool loop acts on: the session worktree when one is open, else the project root. */
  workRoot(): string {
    return this.session?.worktree ?? this.hooks.root();
  }

  /** Start an isolated session: a git worktree on `codev/<slug>` from HEAD. Throws when the
   * project is not a git repo (honest: no isolation without git). */
  async startSession(name: string): Promise<SessionInfo> {
    const s = await api.codevSessionStart(this.hooks.root(), name);
    this.session = s;
    this.addMsg("codev", t("codev.sessionOpen", { slug: s.slug, branch: s.branch, base: s.base }));
    await this.renderSession();
    this.onSessionChange?.(s);
    return s;
  }

  /** Deliver the open session: commit + merge --no-ff into the base branch, tear down the worktree. */
  async deliver(message: string): Promise<DeliverInfo> {
    if (!this.session) throw new Error("no open session");
    // Checkpoint REAL antes de integrar: tag leve dxcp/<slug>-<n> no repo do projecto —
    // o ÚNICO ponto que cria checkpoints (disparado só por esta acção do utilizador);
    // a secção CHECKPOINTS do hub lista `git tag -l dxcp/*`. Melhor-esforço: um repo
    // sem permissão de tags não bloqueia o deliver.
    try {
      const slug = this.session.slug;
      const ls = await api.exec("git", ["tag", "-l", `dxcp/${slug}-*`], this.hooks.root());
      const n = ls.stdout.split("\n").filter(Boolean).length + 1;
      await api.exec("git", ["tag", `dxcp/${slug}-${n}`], this.hooks.root());
    } catch { /* sem tag não há checkpoint; o deliver segue */ }
    const info = await api.codevSessionDeliver(this.hooks.root(), this.session.slug, message);
    this.addMsg("codev", info.merged ? t("codev.delivered", { base: info.base, commit: info.commit }) : t("codev.sessionClosed", { note: info.note }));
    this.session = null;
    await this.renderSession();
    this.onSessionChange?.(null);
    return info;
  }

  /** Discard the open session without integrating. */
  async discardSession(): Promise<void> {
    if (!this.session) return;
    const slug = this.session.slug;
    await api.codevSessionDiscard(this.hooks.root(), slug);
    this.addMsg("codev", t("codev.sessionDiscarded", { slug }));
    this.session = null;
    await this.renderSession();
    this.onSessionChange?.(null);
  }

  private async newSessionPrompt(): Promise<void> {
    if (this.session) { this.addMsg("codev", t("codev.alreadyInSession", { slug: this.session.slug })); return; }
    const name = (prompt(t("codev.promptSessionName"), "codev") ?? "").trim();
    if (!name) return;
    try { await this.startSession(name); }
    catch (e) { this.addMsg("codev", String(e)); }
  }

  private async deliverPrompt(): Promise<void> {
    if (!this.session) return;
    const msg = (prompt(t("codev.promptDeliverMsg"), `codev: ${this.session.slug}`) ?? "").trim();
    try { await this.deliver(msg); }
    catch (e) { this.addMsg("codev", t("codev.deliverFailed", { err: String(e) })); }
  }

  private async renderSession(): Promise<void> {
    const label = this.hostEl.querySelector(".cd-sess-label") as HTMLElement;
    const neu = this.hostEl.querySelector(".cd-sess-new") as HTMLElement;
    const del = this.hostEl.querySelector(".cd-sess-deliver") as HTMLElement;
    const dis = this.hostEl.querySelector(".cd-sess-discard") as HTMLElement;
    if (this.session) {
      label.textContent = `${this.session.slug} · ${this.session.branch}`;
      label.title = t("codev.worktree", { path: this.session.worktree });
      neu.classList.add("hidden");
      del.classList.remove("hidden");
      dis.classList.remove("hidden");
    } else {
      let base = "";
      try {
        const r = await api.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], this.hooks.root());
        if (r.code === 0) base = r.stdout.trim();
      } catch { /* not a repo */ }
      label.textContent = base ? t("codev.noSessionOn", { base }) : t("codev.noSession");
      label.title = "";
      neu.classList.remove("hidden");
      del.classList.add("hidden");
      dis.classList.add("hidden");
    }
  }

  /** Explain a file's content with one governed llm_chat turn (no tool loop). For the Explain
   * panel and the harness. Throws when no provider is configured. */
  async explainFile(rel: string, content: string): Promise<{ text: string; origin: string }> {
    const prov = this.pickProvider();
    if (!prov) throw new Error(t("codev.noProvider"));
    const prompt = `Explain this file concisely for a developer new to it — its purpose, the key pieces, and how they fit. File: ${rel}\n\n\`\`\`\n${content.slice(0, 12000)}\n\`\`\``;
    const r = await api.llmChat(
      { provider: prov.id, endpoint: prov.endpoint, model: prov.model, messages: [{ role: "user", text: prompt }], tools: [], maxTokens: 1024 },
      "study",
    );
    this.recordUsage(r);
    return { text: r.text, origin: r.origin };
  }

  /** UM turno governado (llm_chat, origin tutor-llm) em modo project, sem laço de
   * ferramentas — o caminho do Debug Assistant (F14). Lança sem provedor configurado. */
  async analyzeOnce(prompt: string): Promise<{ text: string; origin: string }> {
    const prov = this.pickProvider();
    if (!prov) throw new Error(t("codev.noProvider"));
    const r = await api.llmChat(
      { provider: prov.id, endpoint: prov.endpoint, model: prov.model, messages: [{ role: "user", text: prompt }], tools: [], maxTokens: 1024 },
      "project",
    );
    this.recordUsage(r);
    return { text: r.text, origin: r.origin };
  }

  /** Write a file through the tool path — into the session worktree when one is open (so the
   * change stays isolated until Deliver), otherwise into the open workspace buffers. */
  async toolWrite(path: string, content: string): Promise<string> {
    if (this.session) {
      await api.writeFile(this.session.worktree, path, content);
      return `wrote ${path} (session ${this.session.slug})`;
    }
    await this.hooks.writeBuffer(path, content);
    return `wrote ${path}`;
  }

  private tools(): Tool[] {
    const h = this.hooks;
    return [
      {
        def: { name: "list_files", description: "List the files in the open project.", inputSchema: { type: "object", properties: {} } },
        run: async () => {
          if (this.session) {
            const r = await api.exec("sh", ["-c", "git ls-files && git ls-files --others --exclude-standard"], this.workRoot());
            return r.stdout.trim() || "(empty)";
          }
          return h.listFiles().join("\n") || "(empty)";
        },
      },
      {
        def: { name: "read_file", description: "Read a file's contents by its project-relative path.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        run: async (i) => {
          if (this.session) {
            const r = await api.exec("cat", ["--", String(i.path)], this.workRoot());
            return r.code === 0 ? r.stdout : `no such file: ${i.path}`;
          }
          return h.readBuffer(String(i.path)) ?? `no such file: ${i.path}`;
        },
      },
      {
        def: { name: "write_file", description: "Write (create or overwrite) a file by its project-relative path.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
        run: async (i) => this.toolWrite(String(i.path), String(i.content)),
      },
      {
        def: { name: "run_command", description: "Run a shell command in the project folder and return exit code, stdout and stderr.", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
        run: async (i) => {
          const r = await api.exec("sh", ["-c", String(i.command)], this.workRoot());
          return `exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout\n${r.stdout.slice(-8000)}\n--- stderr\n${r.stderr.slice(-4000)}`;
        },
      },
    ];
  }

  /** Run a full Co-Dev turn for real. Returns the final text + provenance. Used by the harness. */
  async chat(prompt: string): Promise<{ text: string; origin: string; toolsRun: string[] }> {
    const prov = this.pickProvider();
    if (!prov) throw new Error(t("codev.noProvider"));
    const tools = this.tools();
    // O contexto dos chips resolve-se AGORA (conteúdo real) e é consumido por este turno.
    const composed = this.composePrompt(prompt);
    this.lastPlan = composed;
    this.ctx = [];
    this.refreshDock();
    const msgs: LlmMsg[] = [{ role: "user", text: composed }];
    let text = "";
    let origin = "";
    const toolsRun: string[] = [];
    for (let round = 0; round < 16; round++) {
      const req: ChatReq = {
        provider: prov.id, endpoint: prov.endpoint, model: prov.model,
        messages: msgs, tools: tools.map((t) => t.def), maxTokens: 4096,
      };
      const r = await api.llmChat(req, "project");
      this.recordUsage(r);
      origin = r.origin || origin;
      if (r.text) { text = r.text; this.addMsg("codev", r.text); }
      if (!r.toolCalls.length) break;
      msgs.push({ role: "assistant", text: r.text || "", toolCalls: r.toolCalls });
      const results: { id: string; content: string }[] = [];
      for (const c of r.toolCalls) {
        const t = tools.find((x) => x.def.name === c.name);
        let outStr: string;
        try {
          outStr = t ? await t.run((c.input ?? {}) as Record<string, unknown>) : `unknown tool ${c.name}`;
        } catch (e) {
          outStr = `error: ${e}`;
        }
        toolsRun.push(c.name);
        this.addTool(c.name, outStr);
        results.push({ id: c.id, content: outStr });
      }
      msgs.push({ role: "user", toolResults: results });
    }
    return { text, origin, toolsRun };
  }

  /** Enviar: streaming por omissão (resposta viva + Stop); com ⚙ ligado — ou sem provedor
   * de streaming — vai pelo laço de ferramentas governado llm_chat (o par-programador). */
  private async submit(): Promise<void> {
    const q = this.input.value.trim();
    if (!q) return;
    this.input.value = "";
    this.addMsg("you", q);
    // Comandos do composer que o backend cumpre DE FACTO — nunca vão ao modelo.
    if (q === "/test" || q === "/lint") {
      await this.runSlash(q).catch((e) => this.addMsg("codev", String(e)));
      return;
    }
    try {
      if (!this.useTools && this.hasStreamModel()) await this.chatStream(q);
      else await this.chat(q);
    } catch (e) {
      this.addMsg("codev", String(e));
    }
  }

  /** Pinta uma bolha SEM tocar no histórico (usado ao repor a conversa do disco). */
  private paintMsg(who: "you" | "codev", text: string): void {
    const el = document.createElement("div");
    el.className = `cd-msg cd-${who}`;
    el.textContent = text;
    this.out.appendChild(el);
    this.out.scrollTop = this.out.scrollHeight;
  }

  private addMsg(who: "you" | "codev", text: string): void {
    this.paintMsg(who, text);
    this.hist.current.push({ who, text });
    this.persistHistory();
    this.refreshCards(); // a conversa deixou de estar vazia → os cartões saem
    this.onEvent?.(who === "you" ? `› ${text}` : text);
  }

  private addTool(name: string, out: string): void {
    const el = document.createElement("div");
    el.className = "cd-tool";
    const ok = !/^exit [1-9]|^error|no such file|unknown tool/.test(out);
    el.innerHTML = `<span class="cd-toolname"></span><span class="cd-toolmark ${ok ? "ok" : "bad"}">${ok ? svg("check") : svg("close")}</span>`;
    (el.querySelector(".cd-toolname") as HTMLElement).textContent = name;
    el.title = out.slice(0, 2000);
    this.out.appendChild(el);
    this.out.scrollTop = this.out.scrollHeight;
    this.onEvent?.(`⚙ ${name}: ${out.split("\n")[0].slice(0, 160)}`);
  }

  // ── Composer rico (F13): chip @ + /test + /lint + cartões accionáveis. Zero-demo:
  // cada chip/cartão liga a uma acção que o backend cumpre de facto; na dúvida, não
  // aparece. O contexto é inspeccionável (chips visíveis) e consumido pelo turno. ──

  /** Alterna a inclusão do ficheiro activo no contexto do próximo turno (chip @). */
  toggleAt(): void {
    this.includeActive = !this.includeActive;
    this.refreshDock();
  }

  /** True quando o chip @ está ligado E há ficheiro activo (o conteúdo VAI entrar no turno). */
  atIncluded(): boolean {
    return this.includeActive && this.hooks.activeTab() !== null;
  }

  /** Compõe o prompt do turno com os blocos de contexto resolvidos AGORA: o conteúdo
   * REAL do buffer do ficheiro activo (chip @) e os resultados reais de /test e /lint.
   * Puro — não envia nada; chat()/chatStream() usam-no e o arnês verifica-o. */
  composePrompt(q: string): string {
    const parts: { label: string; content: string }[] = [];
    const rel = this.hooks.activeTab();
    if (this.includeActive && rel) {
      const content = this.hooks.readBuffer(rel);
      if (content !== undefined) parts.push({ label: `@${rel}`, content });
    }
    parts.push(...this.ctx);
    if (!parts.length) return q;
    const blocks = parts.map((p) => `[contexto ${p.label}]\n${p.content}\n[/contexto]`).join("\n\n");
    return `${blocks}\n\n${q}`;
  }

  /** /test corre run_all_tests e /lint corre review_code sobre o ficheiro activo — o
   * resultado REAL (incluindo falha) entra na conversa tal-e-qual E fica como chip de
   * contexto para o próximo turno. Devolve a mensagem adicionada. */
  async runSlash(cmd: string): Promise<string> {
    if (cmd === "/test") {
      let msg: string;
      let content = "";
      try {
        const r = await api.runAllTests(this.workRoot());
        const tail = r.output.trim().split("\n").slice(-12).join("\n");
        msg = r.ran
          ? (r.passed ? t("codev.testsPassed", { tail }) : t("codev.testsFailed", { tail }))
          : t("codev.testsNotRun", { tail });
        content = `run_all_tests → ran=${r.ran} passed=${r.passed}\n${r.output.slice(-4000)}`;
      } catch (e) {
        msg = String(e);
      }
      this.addMsg("codev", msg);
      if (content) this.ctx.push({ kind: "test", label: "/test", content });
      this.refreshDock();
      return msg;
    }
    if (cmd === "/lint") {
      const rel = this.hooks.activeTab();
      if (!rel) {
        const m = t("codev.lintNoFile");
        this.addMsg("codev", m);
        return m;
      }
      let msg: string;
      let content = "";
      try {
        const root = this.hooks.root();
        const rep = await api.reviewCode(root, "file", `${root}/${rel}`);
        const ran = rep.analyzers.filter((a) => a.ran).map((a) => a.analyzer).join(", ");
        const lines = rep.findings.map((f) =>
          `${f.primary.file.split("/").pop()}:${f.primary.startLine} ${f.analyzer}${f.rule ? ` ${f.rule}` : ""}: ${f.message}`);
        msg = t("codev.lintDone", { file: rel, n: String(rep.findings.length), ran: ran || "—" }) +
          (lines.length ? `\n${lines.slice(0, 12).join("\n")}` : "");
        content = `review_code ${rel} → ${rep.findings.length} findings (${ran})\n${lines.join("\n").slice(0, 4000)}`;
      } catch (e) {
        msg = String(e);
      }
      this.addMsg("codev", msg);
      if (content) this.ctx.push({ kind: "lint", label: "/lint", content });
      this.refreshDock();
      return msg;
    }
    return "";
  }

  /** Repinta chips e cartões a partir do estado REAL corrente (tab activa, markers,
   * provedor, conversa). Chamado ao abrir/fechar ficheiros e após cada acção do dock. */
  refreshDock(): void {
    this.renderChips();
    this.refreshCards();
  }

  private renderChips(): void {
    const at = this.hostEl.querySelector(".cd-at") as HTMLButtonElement | null;
    if (!at) return;
    const rel = this.hooks.activeTab();
    at.textContent = rel ? `@${rel.split("/").pop()}` : t("codev.atNoFile");
    at.title = rel ? t("codev.atTitle", { file: rel }) : t("codev.atNoFileTitle");
    at.disabled = !rel;
    at.classList.toggle("on", this.includeActive && !!rel);
    const holder = this.hostEl.querySelector(".cd-ctx") as HTMLElement;
    holder.innerHTML = this.ctx
      .map((_, i) => `<span class="cd-chip"><span class="cd-chip-l"></span><button class="cd-chip-x" data-chip="${i}">×</button></span>`)
      .join("");
    holder.querySelectorAll(".cd-chip-l").forEach((el, i) => {
      (el as HTMLElement).textContent = this.ctx[i].label;
      (el as HTMLElement).title = this.ctx[i].content.slice(0, 1000);
    });
    holder.querySelectorAll<HTMLButtonElement>(".cd-chip-x").forEach((b) => {
      b.onclick = () => { this.ctx.splice(Number(b.dataset.chip), 1); this.renderChips(); };
    });
  }

  /** Cartões de sugestão — SÓ no estado vazio da conversa e SÓ com fonte real:
   * «Explicar» exige ficheiro activo + provedor; «Rever» exige ficheiro activo;
   * «Corrigir» exige um marker de ERRO verdadeiro do LSP e pré-preenche o composer
   * com o diagnóstico do compilador verbatim (não envia, não resume por LLM). */
  private refreshCards(): void {
    const box = this.hostEl.querySelector(".cd-cards") as HTMLElement | null;
    if (!box) return;
    box.innerHTML = "";
    if (this.hist.current.length) return;
    const rel = this.hooks.activeTab();
    const short = rel ? rel.split("/").pop() ?? rel : "";
    const cards: { cls: string; label: string; run: () => void }[] = [];
    if (rel && this.hasProvider()) cards.push({
      cls: "cd-card-explain",
      label: t("codev.cardExplain", { file: short }),
      run: () => void this.explainActive(),
    });
    if (rel) cards.push({
      cls: "cd-card-review",
      label: t("codev.cardReview", { file: short }),
      run: () => { this.addMsg("you", "/lint"); void this.runSlash("/lint"); },
    });
    const err = rel ? this.hooks.markers(rel).find((m) => m.error) : undefined;
    if (rel && err) cards.push({
      cls: "cd-card-fix",
      label: t("codev.cardFix", { file: short, line: String(err.line) }),
      run: () => { this.input.value = err.message; this.input.focus(); },
    });
    for (const c of cards) {
      const b = document.createElement("button");
      b.className = `cd-card ${c.cls}`;
      b.textContent = c.label;
      b.onclick = c.run;
      box.appendChild(b);
    }
  }

  /** O cartão «Explicar»: UM turno governado explainFile sobre o buffer activo real. */
  private async explainActive(): Promise<void> {
    const rel = this.hooks.activeTab();
    if (!rel) return;
    this.addMsg("you", t("codev.cardExplain", { file: rel.split("/").pop() ?? rel }));
    try {
      const r = await this.explainFile(rel, this.hooks.readBuffer(rel) ?? "");
      this.addMsg("codev", r.text);
    } catch (e) {
      this.addMsg("codev", String(e));
    }
  }

  // ── Histórico persistente em ficheiro (nunca localStorage): uma entrada por raiz. ──

  /** Relê do disco a conversa desta raiz e repinta o dock — chamado depois de abrir a
   * pasta e pelo «reload da vista» do arnês (instância fresca). */
  async loadHistory(): Promise<void> {
    const root = this.hooks.root();
    if (!root) return;
    this.histRoot = root;
    try {
      if (!this.histPath) this.histPath = `${(await api.appInfo()).configDir}/codev-history.json`;
    } catch { return; /* sem backend não há ficheiro — a conversa fica só em memória */ }
    let all: Record<string, HistEntry> = {};
    try {
      const raw = await api.readTextFile(this.histPath).catch(() => "");
      if (raw.trim()) all = JSON.parse(raw) as Record<string, HistEntry>;
    } catch { all = {}; }
    this.hist = all[root] ?? { current: [], past: [] };
    this.out.innerHTML = "";
    for (const m of this.hist.current) this.paintMsg(m.who, m.text);
    this.refreshDock();
  }

  /** Grava o histórico desta raiz (fila de escritas; read-merge-write para não pisar as
   * entradas de outras raízes no ficheiro partilhado). Melhor-esforço: a conversa viva
   * nunca depende da escrita. */
  private persistHistory(): void {
    const root = this.histRoot;
    const path = this.histPath;
    if (!root || !path) return;
    const snap = JSON.stringify(this.hist);
    this.histWrites = this.histWrites
      .then(async () => {
        const raw = await api.readTextFile(path).catch(() => "");
        let all: Record<string, unknown> = {};
        try { if (raw.trim()) all = JSON.parse(raw) as Record<string, unknown>; } catch { all = {}; }
        all[root] = JSON.parse(snap);
        await api.writeTextFile(path, JSON.stringify(all, null, 2) + "\n");
      })
      .catch(() => { /* melhor-esforço */ });
  }

  /** Espera as escritas pendentes do histórico (o arnês lê o ficheiro estável). */
  historyFlushed(): Promise<void> {
    return this.histWrites;
  }

  /** Arquiva a conversa corrente no histórico e começa um chat limpo. */
  newChat(): void {
    if (this.hist.current.length) {
      const first = this.hist.current.find((m) => m.who === "you") ?? this.hist.current[0];
      this.hist.past.push({ title: first.text.slice(0, 60), msgs: this.hist.current });
    }
    this.hist.current = [];
    this.out.innerHTML = "";
    this.persistHistory();
    if (!(this.hostEl.querySelector(".cd-hist") as HTMLElement).classList.contains("hidden")) this.renderHist();
    this.refreshDock();
  }

  /** Abre/fecha o painel de conversas anteriores (lidas do ficheiro — nada fabricado). */
  private toggleHist(): void {
    const box = this.hostEl.querySelector(".cd-hist") as HTMLElement;
    const show = box.classList.contains("hidden");
    box.classList.toggle("hidden", !show);
    if (show) this.renderHist();
  }

  private renderHist(): void {
    const box = this.hostEl.querySelector(".cd-hist") as HTMLElement;
    if (!this.hist.past.length) {
      box.textContent = t("codev.histEmpty");
      return;
    }
    box.innerHTML = this.hist.past
      .map((_, i) => `<button class="cd-hist-item" data-hist="${i}"><span class="cd-hist-title"></span><span class="cd-hist-n"></span></button>`)
      .join("");
    box.querySelectorAll<HTMLButtonElement>(".cd-hist-item").forEach((b, i) => {
      const c = this.hist.past[i];
      (b.querySelector(".cd-hist-title") as HTMLElement).textContent = c.title || "—";
      (b.querySelector(".cd-hist-n") as HTMLElement).textContent = t("codev.histCount", { n: String(c.msgs.length) });
      b.onclick = () => this.openPast(i);
    });
  }

  /** Repõe uma conversa anterior como corrente (a corrente, se existir, é arquivada). */
  private openPast(i: number): void {
    const conv = this.hist.past[i];
    if (!conv) return;
    this.hist.past.splice(i, 1);
    if (this.hist.current.length) {
      const first = this.hist.current.find((m) => m.who === "you") ?? this.hist.current[0];
      this.hist.past.push({ title: first.text.slice(0, 60), msgs: this.hist.current });
    }
    this.hist.current = conv.msgs;
    this.out.innerHTML = "";
    for (const m of this.hist.current) this.paintMsg(m.who, m.text);
    this.persistHistory();
    (this.hostEl.querySelector(".cd-hist") as HTMLElement).classList.add("hidden");
    this.refreshDock();
  }
}
