// Studio de arquitectura — desenho orientado a eventos sobre o modelo REAL do backend
// (tutor_eval::arch): componentes tipados (service/store/broker/consumer/relay/gateway),
// ligações com relação inferida, e três operações honestas:
//   · validação — arch_validate (regras estruturais reais, nunca client-side);
//   · pré-visualização do scaffold — arch_scaffold_preview (lista o que SERIA escrito,
//     sem tocar no disco) — é o único caminho que o harness usa;
//   · scaffold real — arch_scaffold, SÓ por acção explícita com confirmação (escreve na
//     pasta aberta, nunca sobrepõe);
// mais «gerar backlog»: deriva user stories do desenho validado e escreve-as no Board
// (persistência SQLite real via board_save).
//
// Zero demo: o desenho NASCE VAZIO. O modelo (nós/posições) é estado do cliente
// (localStorage por raiz); a validação e o scaffold são sempre do backend.

import { api, type Architecture, type ArchComponent, type ArchConnection, type ArchFinding, type ArchKind, type ArchRelation } from "./tauri";
import { t } from "./i18n";
import type { GenBacklog, GenStory } from "./board";

interface SNode extends ArchComponent { x: number; y: number }
interface Design { components: SNode[]; connections: ArchConnection[] }

const KINDS: ArchKind[] = ["service", "store", "broker", "consumer", "relay", "gateway"];
const KIND_COLOR: Record<ArchKind, string> = {
  service: "#dea584", store: "#5cc9a7", broker: "#d7a860",
  consumer: "#7aa2f7", relay: "#b48ead", gateway: "#e06c3b",
};
const NW = 150, NH = 54, VBW = 760, VBH = 440;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Slug IGUAL ao do backend (arch.rs::scaffold): alfanumérico minúsculo, resto vira '-'. */
const slug = (s: string): string =>
  s.split("").map((c) => (/[\p{L}\p{N}]/u.test(c) ? c.toLowerCase() : "-")).join("");

/** Relação inferida dos tipos das pontas (mesma heurística do v7): escrever/ler numa store,
 * publicar/consumir num broker, encaminhar de um broker; o resto cai em `writes` (inócuo). */
function relationFor(from: ArchKind, to: ArchKind): ArchRelation {
  if (to === "store") return from === "relay" ? "reads" : "writes";
  if (to === "broker") return from === "consumer" ? "consumes" : "publishes";
  if (from === "broker") return "routes-to";
  return "writes";
}

export interface StudioDeps {
  root: () => string | null;
  ingest: (g: GenBacklog) => Promise<number>;
  openBoard: () => void;
}

export class Studio {
  private d: Design = { components: [], connections: [] };
  private loadedFor: string | null | undefined; // raiz cujo desenho está carregado
  private sel: string | null = null;
  private linking: string | null = null; // null=off; ""=à espera da origem; id=à espera do destino
  private findings: ArchFinding[] = [];
  private validating = false;
  private valError = "";
  private preview_: [string, string][] | null = null;
  private written: string[] | null = null;
  private opError = "";

  constructor(private host: HTMLElement, private deps: StudioDeps) {}

  componentCount(): number { return this.d.components.length; }

  /** Desselecciona o nó corrente (o inspector volta à visão geral com validação/resultados). */
  deselect(): void {
    this.sel = null;
    this.render();
  }
  architecture(): Architecture {
    return {
      components: this.d.components.map(({ x, y, ...c }) => { void x; void y; return c; }),
      connections: [...this.d.connections],
    };
  }

  async refresh(): Promise<void> {
    this.loadDesign();
    this.render();
    if (this.d.components.length) await this.validate();
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  // ── persistência do desenho (estado de cliente, por raiz) ────────────────────
  private lsKey(): string { return `dxnext-studio:${this.deps.root() ?? "default"}`; }

  private loadDesign(): void {
    const key = this.deps.root() ?? "default";
    if (this.loadedFor === key) return;
    this.loadedFor = key;
    this.d = { components: [], connections: [] };
    try {
      const raw = localStorage.getItem(this.lsKey());
      if (raw) {
        const p = JSON.parse(raw) as Partial<Design>;
        if (p && Array.isArray(p.components) && Array.isArray(p.connections)) {
          this.d = { components: p.components as SNode[], connections: p.connections as ArchConnection[] };
        }
      }
    } catch { /* desenho novo */ }
  }

  private saveDesign(): void {
    try { localStorage.setItem(this.lsKey(), JSON.stringify(this.d)); } catch { /* sem storage */ }
  }

  private dirty(): void {
    // O desenho mudou: resultados anteriores ficam obsoletos (não se mostram caducos).
    this.preview_ = null; this.written = null; this.opError = "";
    this.saveDesign();
  }

  // ── modelo ──────────────────────────────────────────────────────────────────
  private byId(id: string): SNode | undefined { return this.d.components.find((c) => c.id === id); }

  /** Acrescenta um componente; id = slug do nome (único — sufixo -2, -3… em colisão). */
  addComponent(kind: ArchKind, name: string): string {
    this.loadDesign();
    const base = slug(name) || "comp";
    let id = base;
    for (let n = 2; this.byId(id); n++) id = `${base}-${n}`;
    const k = this.d.components.length;
    this.d.components.push({ id, name, kind, outbox: false, x: 24 + (k % 4) * 180, y: 24 + Math.floor(k / 4) * 110 });
    this.sel = id;
    this.dirty();
    this.render();
    void this.validate();
    return id;
  }

  /** Liga dois componentes; a relação é inferida dos tipos; `event` nomeia o evento/rota. */
  connect(from: string, to: string, event = ""): void {
    const a = this.byId(from), b = this.byId(to);
    if (!a || !b || from === to) return;
    const relation = relationFor(a.kind, b.kind);
    if (!this.d.connections.some((c) => c.from === from && c.to === to && c.event === event)) {
      this.d.connections.push({ from, to, relation, event });
    }
    this.dirty();
    this.render();
    void this.validate();
  }

  private removeComponent(id: string): void {
    this.d.components = this.d.components.filter((c) => c.id !== id);
    this.d.connections = this.d.connections.filter((c) => c.from !== id && c.to !== id);
    if (this.sel === id) this.sel = null;
    this.dirty();
    this.render();
    void this.validate();
  }

  // ── backend real ────────────────────────────────────────────────────────────
  /** Validação REAL (arch_validate). Repinta o inspector e devolve os achados. */
  async validate(): Promise<ArchFinding[]> {
    this.validating = true; this.valError = "";
    this.paintInspector();
    try {
      this.findings = await api.archValidate(this.architecture());
    } catch (e) {
      this.findings = []; this.valError = String(e);
    }
    this.validating = false;
    this.paintInspector();
    return this.findings;
  }

  private hasErrors(): boolean {
    return this.findings.some((f) => f.severity === "error");
  }

  /** Pré-visualização do scaffold (arch_scaffold_preview) — nada é escrito no disco. */
  async preview(): Promise<[string, string][]> {
    this.opError = ""; this.written = null;
    try {
      this.preview_ = await api.archScaffoldPreview(this.architecture());
    } catch (e) {
      this.preview_ = null; this.opError = String(e);
    }
    this.paintInspector();
    return this.preview_ ?? [];
  }

  /** Scaffold REAL — escreve no disco; só corre com pasta aberta, desenho sem erros e
   * CONFIRMAÇÃO explícita do humano (a pré-visualização mostra antes o que seria escrito). */
  async scaffold(): Promise<void> {
    const root = this.deps.root();
    if (!root) { this.opError = t("studio.noFolder"); this.paintInspector(); return; }
    if (this.hasErrors()) { this.opError = t("studio.scaffoldInvalid"); this.paintInspector(); return; }
    const files = this.preview_ ?? (await this.preview());
    if (!window.confirm(t("studio.scaffoldConfirm", { n: files.length, root }))) return;
    this.opError = "";
    try {
      this.written = await api.archScaffold(root, this.architecture());
    } catch (e) {
      this.written = null; this.opError = String(e);
    }
    this.paintInspector();
  }

  /** «Gerar backlog»: deriva user stories do desenho VALIDADO (uma por componente vivo,
   * critérios de aceitação vindos das ligações reais) e escreve-as no Board (board_save). */
  async genBacklog(): Promise<number> {
    const findings = await this.validate();
    if (findings.some((f) => f.severity === "error")) {
      this.opError = t("studio.backlogInvalid"); this.paintInspector(); return 0;
    }
    const live = this.d.components.filter((c) => c.kind !== "store" && c.kind !== "broker");
    const stories: GenStory[] = live.map((c) => {
      const ac: string[] = [];
      for (const cn of this.d.connections) {
        const other = (id: string): string => this.byId(id)?.name ?? id;
        if (cn.from === c.id) {
          if (cn.relation === "publishes" && cn.event) ac.push(t("studio.acPublish", { event: cn.event, to: other(cn.to) }));
          else if (cn.relation === "consumes" && cn.event) ac.push(t("studio.acConsume", { event: cn.event, from: other(cn.to) }));
          else if (cn.relation === "writes") ac.push(t("studio.acWrite", { store: other(cn.to) }));
          else if (cn.relation === "reads") ac.push(t("studio.acRead", { store: other(cn.to) }));
        }
      }
      return {
        role: t("studio.genRole"),
        want: t("studio.genWant", { name: c.name, kind: t("studio.kind." + c.kind) }),
        soThat: t("studio.genSoThat"),
        acceptance: ac,
        points: 3,
      };
    });
    if (!stories.length) { this.opError = t("studio.backlogEmpty"); this.paintInspector(); return 0; }
    const n = await this.deps.ingest({ problem: t("studio.genProblem", { n: this.d.components.length }), stories });
    this.deps.openBoard();
    return n;
  }

  // ── render ──────────────────────────────────────────────────────────────────
  private render(): void {
    this.host.innerHTML = `<div class="studio">
      <div class="st-bar">
        <b>${esc(t("studio.title"))}</b>
        <button class="mini${this.linking !== null ? " pri" : ""}" data-link>⤳ ${esc(t("studio.connect"))}</button>
        <span class="kb-sp"></span>
        <button class="mini" data-preview>${esc(t("studio.previewBtn"))}</button>
        <button class="mini" data-scaffold>${esc(t("studio.scaffoldBtn"))}</button>
        <button class="mini pri" data-backlog>${esc(t("studio.backlogBtn"))}</button>
      </div>
      <div class="st-main">
        <div class="st-cat">
          <div class="st-ct">${esc(t("studio.catalog"))}</div>
          ${KINDS.map((k) => `<button class="st-tech" data-add="${k}"><span class="st-dot" style="background:${KIND_COLOR[k]}"></span>${esc(t("studio.kind." + k))}<i>＋</i></button>`).join("")}
        </div>
        <div class="st-canvas"><svg data-svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMinYMin meet"></svg></div>
        <div class="st-insp" data-insp></div>
      </div>
    </div>`;
    const q = <T extends HTMLElement>(sel: string): T | null => this.host.querySelector<T>(sel);
    q("[data-link]")!.onclick = () => { this.linking = this.linking === null ? "" : null; this.render(); };
    q("[data-preview]")!.onclick = () => void this.preview();
    q("[data-scaffold]")!.onclick = () => void this.scaffold();
    q("[data-backlog]")!.onclick = () => void this.genBacklog();
    this.host.querySelectorAll<HTMLElement>("[data-add]").forEach((b) => (b.onclick = () => {
      const name = (window.prompt(t("studio.namePrompt"), "") || "").trim();
      if (name) this.addComponent(b.dataset.add as ArchKind, name);
    }));
    const svg = this.host.querySelector<SVGSVGElement>("[data-svg]");
    if (svg) (svg as unknown as HTMLElement).onmousedown = (e) => this.onCanvasDown(e);
    this.paintCanvas();
    this.paintInspector();
  }

  private paintCanvas(): void {
    const svg = this.host.querySelector<SVGSVGElement>("[data-svg]");
    if (!svg) return;
    const edge = (c: ArchConnection, i: number): string => {
      const A = this.byId(c.from), B = this.byId(c.to);
      if (!A || !B) return "";
      const ax = A.x + NW / 2, ay = A.y + NH / 2, bx = B.x + NW / 2, by = B.y + NH / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const label = c.event ? `${c.relation} · ${c.event}` : c.relation;
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="var(--fg-muted)" stroke-width="1.4" marker-end="url(#st-ar)"/>` +
        `<text x="${mx}" y="${my - 4}" text-anchor="middle" fill="var(--fg-muted)" font-size="9" font-family="monospace" data-edge="${i}">${esc(label)}</text>`;
    };
    const cut = (x: string, m: number): string => (x.length > m ? x.slice(0, m - 1) + "…" : x);
    const node = (n: SNode): string => {
      const on = this.sel === n.id || this.linking === n.id;
      return `<g data-n="${esc(n.id)}" transform="translate(${n.x} ${n.y})" style="cursor:${this.linking !== null ? "crosshair" : "grab"}">` +
        `<rect width="${NW}" height="${NH}" rx="10" fill="var(--bg-elevated)" stroke="${on ? "var(--accent)" : "var(--border-strong)"}" stroke-width="${on ? 2 : 1.3}"/>` +
        `<rect width="5" height="${NH - 16}" y="8" rx="2.5" fill="${KIND_COLOR[n.kind]}"/>` +
        `<text x="14" y="18" fill="${KIND_COLOR[n.kind]}" font-size="8.5" font-weight="700" font-family="monospace" letter-spacing=".6">${esc(t("studio.kind." + n.kind).toUpperCase())}</text>` +
        `<text x="14" y="38" fill="var(--fg)" font-size="12.5" font-weight="600">${esc(cut(n.name, 19))}</text></g>`;
    };
    svg.innerHTML = `<defs><marker id="st-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--fg-muted)"/></marker><pattern id="st-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--border)"/></pattern></defs><rect width="${VBW}" height="${VBH}" fill="url(#st-grid)"/>` +
      this.d.connections.map(edge).join("") + this.d.components.map(node).join("");
  }

  private validationBlock(): string {
    if (this.validating) return `<div class="st-f"><span>…</span><div>${esc(t("studio.validating"))}</div></div>`;
    if (this.valError) return `<div class="st-f e"><span>✖</span><div>${esc(t("studio.validateFailed", { err: this.valError }))}</div></div>`;
    if (!this.d.components.length) return `<div class="st-f"><span>·</span><div>${esc(t("studio.emptyDesign"))}</div></div>`;
    if (!this.findings.length) return `<div class="st-f ok"><span>✓</span><div>${esc(t("studio.consistent"))}</div></div>`;
    return this.findings.map((f) =>
      `<div class="st-f ${f.severity === "error" ? "e" : "w"}"><span>${f.severity === "error" ? "✖" : "⚠"}</span>` +
      `<div>${esc(f.message)}<code>${esc(f.rule)}</code></div></div>`).join("");
  }

  private resultBlock(): string {
    if (this.opError) return `<div class="st-f e"><span>✖</span><div>${esc(this.opError)}</div></div>`;
    if (this.written) {
      const list = this.written.length
        ? this.written.map((p) => `<div class="st-f ok"><span>✓</span><div><code>${esc(p)}</code></div></div>`).join("")
        : `<div class="st-f"><span>·</span><div>${esc(t("studio.scaffoldNothing"))}</div></div>`;
      return `<h3>${esc(t("studio.scaffoldResult", { n: this.written.length }))}</h3>${list}`;
    }
    if (this.preview_) {
      const list = this.preview_.length
        ? this.preview_.map(([p]) => `<div class="st-f" data-previewfile><span>·</span><div><code>${esc(p)}</code></div></div>`).join("")
        : `<div class="st-f w"><span>⚠</span><div>${esc(t("studio.previewEmpty"))}</div></div>`;
      return `<h3>${esc(t("studio.previewResult", { n: this.preview_.length }))}</h3>` +
        `<div class="st-sub">${esc(t("studio.previewNote"))}</div>${list}`;
    }
    return "";
  }

  private paintInspector(): void {
    const ins = this.host.querySelector<HTMLElement>("[data-insp]");
    if (!ins) return;
    if (this.linking !== null) {
      ins.innerHTML = `<h3>${esc(t("studio.connect"))}</h3><p>${esc(this.linking === "" ? t("studio.connectFrom") : t("studio.connectTo"))}</p>`;
      return;
    }
    const n = this.sel ? this.byId(this.sel) : undefined;
    if (n) {
      const kindOpts = KINDS.map((k) => `<option value="${k}"${n.kind === k ? " selected" : ""}>${esc(t("studio.kind." + k))}</option>`).join("");
      const conns = this.d.connections.map((c, i) => (c.from === n.id || c.to === n.id)
        ? `<div class="st-e">${esc(this.byId(c.from)?.name ?? c.from)} →(${esc(c.relation)}${c.event ? " · " + esc(c.event) : ""}) ${esc(this.byId(c.to)?.name ?? c.to)}<button data-ei="${i}">×</button></div>`
        : "").join("") || `<p>${esc(t("studio.noConnections"))}</p>`;
      const outbox = n.kind === "store"
        ? `<label class="st-chk"><input type="checkbox" data-outbox${n.outbox ? " checked" : ""}/> ${esc(t("studio.outbox"))}</label>`
        : "";
      ins.innerHTML = `<h3>${esc(t("studio.component"))}</h3>` +
        `<label>${esc(t("studio.name"))}</label><input class="st-inp" data-name value="${esc(n.name)}"/>` +
        `<label>${esc(t("studio.kindLabel"))}</label><select data-kind>${kindOpts}</select>${outbox}` +
        `<label>${esc(t("studio.connections"))}</label>${conns}` +
        `<button class="mini" data-del>${esc(t("studio.delete"))}</button>`;
      const name = ins.querySelector<HTMLInputElement>("[data-name]");
      if (name) name.onchange = () => { n.name = name.value; this.dirty(); this.render(); void this.validate(); };
      const kind = ins.querySelector<HTMLSelectElement>("[data-kind]");
      if (kind) kind.onchange = () => { n.kind = kind.value as ArchKind; this.dirty(); this.render(); void this.validate(); };
      const ob = ins.querySelector<HTMLInputElement>("[data-outbox]");
      if (ob) ob.onchange = () => { n.outbox = ob.checked; this.dirty(); void this.validate(); };
      ins.querySelectorAll<HTMLElement>("[data-ei]").forEach((b) => (b.onclick = () => {
        this.d.connections.splice(Number(b.dataset.ei), 1);
        this.dirty(); this.render(); void this.validate();
      }));
      const del = ins.querySelector<HTMLElement>("[data-del]");
      if (del) del.onclick = () => this.removeComponent(n.id);
      return;
    }
    const root = this.deps.root();
    ins.innerHTML = `<h3>${esc(t("studio.design"))}</h3><p>${esc(t("studio.designHelp"))}</p>` +
      `<h3>${esc(t("studio.validation"))}</h3>${this.validationBlock()}` +
      `<div class="st-kv"><span>${esc(t("studio.components"))}</span><code>${this.d.components.length}</code></div>` +
      `<div class="st-kv"><span>${esc(t("studio.connections"))}</span><code>${this.d.connections.length}</code></div>` +
      `<div class="st-kv"><span>${esc(t("studio.target"))}</span><code>${esc(root ?? t("studio.noFolder"))}</code></div>` +
      this.resultBlock();
  }

  // ── interacção do canvas (seleccionar / ligar / arrastar) ───────────────────
  private onCanvasDown(e: MouseEvent): void {
    const svg = this.host.querySelector<SVGSVGElement>("[data-svg]");
    if (!svg) return;
    const g = (e.target as Element).closest("[data-n]") as HTMLElement | null;
    if (!g) {
      this.sel = null;
      if (this.linking !== null) this.linking = "";
      this.render();
      return;
    }
    const id = g.dataset.n!;
    const n = this.byId(id);
    if (!n) return;
    if (this.linking !== null) {
      if (this.linking === "") this.linking = id;
      else if (this.linking !== id) {
        const from = this.linking;
        this.linking = null;
        const a = this.byId(from);
        const rel = a ? relationFor(a.kind, n.kind) : "writes";
        const event = rel === "publishes" || rel === "consumes"
          ? (window.prompt(t("studio.eventPrompt"), "") || "").trim()
          : "";
        this.connect(from, id, event);
        return;
      }
      this.render();
      return;
    }
    this.sel = id;
    const r = svg.getBoundingClientRect();
    const k = VBW / r.width;
    const ox = (e.clientX - r.left) * k - n.x, oy = (e.clientY - r.top) * k - n.y;
    let moved = false;
    const mv = (ev: MouseEvent): void => {
      moved = true;
      n.x = Math.max(4, Math.min(VBW - NW - 4, (ev.clientX - r.left) * k - ox));
      n.y = Math.max(4, Math.min(VBH - NH - 4, (ev.clientY - r.top) * k - oy));
      this.paintCanvas();
    };
    const up = (): void => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      if (moved) this.saveDesign();
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
    this.render();
    e.preventDefault();
  }
}
