/* ═════════ feature `arch` — caso de uso do Studio de arquitectura ═════════
   Dono do estado do Studio (desenho, selecção, ligação em curso, achados, resultados) e
   das operações do backend:
     · validação — arch_validate (regras estruturais reais, nunca no cliente);
     · pré-visualização do scaffold — lista o que SERIA escrito, sem tocar no disco;
     · scaffold real — só com pasta aberta, desenho sem erros e confirmação explícita.
   Edita componentes, ligações, grupos (fronteiras aninhadas) e painéis (o modo
   comparativo). A pertença a um grupo/painel muda pela largada: soltar um cartão dentro
   de um grupo põe-no lá; soltar um grupo dentro de outro, ou dentro de um painel, idem.
   O desenho NASCE VAZIO (sem dados de demonstração) e guarda-se por raiz, na mesma chave
   do Studio original (`dxnext-studio:<raiz>`). Sem DOM e sem window: tudo passa pelas portas. */

import {
  addComponent, addGroup, addView, connect, descendants, emptyDesign, findGroup, findNode, findView,
  parseDesign, relationFor, relationTakesEvent, removeComponent, removeConnection, removeGroup, removeView,
  setGroupParent, setGroupView, toArchitecture, isEventKind,
} from "../domain/design";
import { autoLayout } from "../domain/autolayout";
import {
  EXPORT_DIR, EXPORT_EXT, EXPORT_MIME, defaultExportName, designFile, isSafeRel, mermaidBlocks, readDesignFile,
  type ExportFormat, type MermaidBlock,
} from "../domain/files";
import { center, freeGroupSpot, freeSpot, groupAt, layout, panelAt } from "../domain/geometry";
import type {
  ArchConnection, ArchFinding, ArchKind, ArchView, Design, DesignGroup, DesignNode, GroupKind, GroupStyle, Selection,
} from "../domain/types";
import type { ArchStudioDeps } from "./ports";

export interface ArchStudioState {
  design: Design;
  sel: Selection | null;
  /** `null` = não está a ligar; `""` = à espera da origem; id = à espera do destino. */
  linking: string | null;
  findings: ArchFinding[];
  validating: boolean;
  valError: string;
  preview: [string, string][] | null;
  written: string[] | null;
  opError: string;
  /** Mensagem curta para o humano (ex.: «no máximo dois painéis»). */
  notice: string;
  /** O inspector mostra «Import / Export». */
  io: boolean;
  /** Resultado da última exportação/importação (ex.: «docs/architecture/x.svg written»). */
  ioMessage: string;
  ioError: string;
  /** Avisos do último import Mermaid (o que não veio tal e qual). */
  importWarnings: string[];
  /** Os blocos Mermaid de um Markdown aberto do projecto, à espera de escolha. */
  mdBlocks: MermaidBlock[] | null;
}

export const storageKey = (root: string | null): string => `dxnext-studio:${root ?? "default"}`;

export const NEEDS_DESKTOP = "Validation and scaffolding run in the Rust backend: open the desktop app.";

type ConnPatch = Partial<Pick<ArchConnection, "style" | "protocol" | "label" | "event" | "source">>;
type GroupPatch = Partial<{ label: string; kind: GroupKind; style: GroupStyle; source: string }>;
type ViewPatch = Partial<Pick<ArchView, "title" | "color" | "daemonless" | "strict">>;

export function makeArchStudio(deps: ArchStudioDeps) {
  const { gateway, store, workspace, renderer, files, repaint } = deps;
  const s: ArchStudioState = {
    design: emptyDesign(), sel: null, linking: null, findings: [], validating: false,
    valError: "", preview: null, written: null, opError: "", notice: "",
    io: false, ioMessage: "", ioError: "", importWarnings: [], mdBlocks: null,
  };
  let loadedFor: string | undefined;
  /** Cada validação tem um número: só a mais recente escreve os achados. */
  let valSeq = 0;

  const save = (): void => store.save(storageKey(workspace.root()), s.design);

  /** O desenho mudou: os resultados anteriores ficam obsoletos e não se mostram caducos. */
  function dirty(): void {
    s.preview = null;
    s.written = null;
    s.opError = "";
    s.notice = "";
    save();
  }

  /** Carrega o desenho da raiz actual (uma vez por raiz). Devolve `true` se trocou. */
  function ensureLoaded(): boolean {
    const key = storageKey(workspace.root());
    if (loadedFor === key) return false;
    loadedFor = key;
    s.design = parseDesign(store.load(key));
    Object.assign(s, { sel: null, linking: null, findings: [], valError: "", preview: null, written: null, opError: "", notice: "" });
    return true;
  }

  async function validate(): Promise<ArchFinding[]> {
    if (!gateway.available()) {
      s.findings = [];
      s.valError = NEEDS_DESKTOP;
      repaint("inspector");
      return [];
    }
    const seq = ++valSeq;
    s.validating = true;
    s.valError = "";
    repaint("inspector");
    try {
      const f = await gateway.validate(toArchitecture(s.design));
      if (seq !== valSeq) return s.findings;
      s.findings = f;
    } catch (e) {
      if (seq !== valSeq) return s.findings;
      s.findings = [];
      s.valError = String(e);
    }
    s.validating = false;
    repaint("inspector");
    return s.findings;
  }

  /** Mudança de modelo: guarda, repinta e revalida. */
  function changed(scope: "all" | "inspector" = "all"): void {
    dirty();
    repaint(scope);
    void validate();
  }

  const d = (): Design => s.design;
  const node = (id: string): DesignNode | undefined => findNode(s.design, id);
  const group = (id: string): DesignGroup | undefined => findGroup(s.design, id);
  const selectedGroup = (): string | undefined => (s.sel?.t === "group" ? s.sel.id : undefined);

  /** Liga dois componentes; pede o nome do evento quando a relação publica ou consome. */
  function connectNodes(from: string, to: string): void {
    const a = node(from), b = node(to);
    if (!a || !b) return;
    const takesEvent = isEventKind(a.kind) && isEventKind(b.kind) && relationTakesEvent(relationFor(a.kind, b.kind));
    const event = takesEvent ? (workspace.prompt("Event name (routing key):", "") ?? "").trim() : "";
    if (connect(s.design, from, to, event)) s.sel = { t: "edge", i: s.design.connections.length - 1 };
    changed();
  }

  async function preview(): Promise<[string, string][]> {
    s.opError = "";
    s.written = null;
    if (!gateway.available()) {
      s.preview = null;
      s.opError = NEEDS_DESKTOP;
      repaint("inspector");
      return [];
    }
    try {
      s.preview = await gateway.preview(toArchitecture(s.design));
    } catch (e) {
      s.preview = null;
      s.opError = String(e);
    }
    repaint("inspector");
    return s.preview ?? [];
  }

  /** Move o grupo e tudo o que está dentro dele (grupos descendentes e os seus cartões). */
  function shiftGroup(id: string, dx: number, dy: number): void {
    const inside = descendants(s.design, id);
    inside.add(id);
    for (const g of s.design.groups) if (inside.has(g.id)) { g.x += dx; g.y += dy; }
    for (const n of s.design.components) if (n.group && inside.has(n.group)) { n.x += dx; n.y += dy; }
  }

  /** Substitui o desenho por um importado (sem posições → auto-layout). Confirma se o
   *  desenho actual não está vazio. */
  function replaceDesign(next: Design, positioned: boolean): boolean {
    const current = s.design.components.length + s.design.groups.length;
    if (current && !workspace.confirm("Replace the current design with the imported one? The current design is not kept.")) return false;
    s.design = positioned ? next : autoLayout(next);
    s.sel = null;
    s.linking = null;
    changed();
    return true;
  }

  const ioFail = (e: unknown): void => {
    s.ioError = String(e).replace(/^Error:\s*/, "");
    s.ioMessage = "";
    repaint("inspector");
  };

  async function importSource(source: string): Promise<boolean> {
    s.ioError = ""; s.ioMessage = ""; s.importWarnings = [];
    if (!gateway.available()) { ioFail(NEEDS_DESKTOP); return false; }
    try {
      const r = await gateway.importMermaid(source);
      if (!replaceDesign(r.design, false)) { repaint("inspector"); return false; }
      s.io = true;
      s.importWarnings = r.warnings;
      s.ioMessage = `Imported ${r.design.components.length} components, ${r.design.connections.length} arrows and ${r.design.groups.length} groups.`;
      s.mdBlocks = null;
      repaint("inspector");
      return true;
    } catch (e) { ioFail(e); return false; }
  }

  return {
    state: (): Readonly<ArchStudioState> => s,

    // ── importar / exportar ──
    toggleIo(): void {
      s.io = !s.io;
      s.sel = null;
      repaint("all");
    },
    /** Exporta o desenho: para `docs/architecture/` no projecto (desktop, com pasta aberta,
     *  com confirmação), ou como download (browser). */
    async exportAs(format: ExportFormat): Promise<string | null> {
      s.ioError = ""; s.ioMessage = "";
      const d = s.design;
      if (!d.components.length && !d.groups.length) { ioFail("The design is empty: nothing to export."); return null; }
      let bytes: Uint8Array;
      try {
        if (format === "svg") bytes = new TextEncoder().encode(renderer.svg(d));
        else if (format === "png") bytes = await renderer.png(d);
        else if (format === "json") bytes = new TextEncoder().encode(designFile(d));
        else {
          if (!gateway.available()) { ioFail(NEEDS_DESKTOP); return null; }
          bytes = new TextEncoder().encode(await gateway.exportMermaid(toArchitecture(d)));
        }
      } catch (e) { ioFail(e); return null; }
      const name = `${defaultExportName(d)}.${EXPORT_EXT[format]}`;
      const root = workspace.root();
      if (gateway.available() && root) {
        const rel = (workspace.prompt(`Save in the project folder (${root}) as:`, `${EXPORT_DIR}/${name}`) ?? "").trim();
        if (!rel) return null;
        if (!isSafeRel(rel)) { ioFail(`«${rel}» must be a path inside the project folder.`); return null; }
        if (!workspace.confirm(`Write ${rel} in ${root}? An existing file with that name is replaced.`)) return null;
        try {
          const written = await gateway.saveExport(root, rel, bytes);
          s.ioMessage = `${written} written.`;
          repaint("inspector");
          return written;
        } catch (e) { ioFail(e); return null; }
      }
      files.download(name, bytes, EXPORT_MIME[format]);
      s.ioMessage = `${name} downloaded.`;
      repaint("inspector");
      return name;
    },
    /** Importa Mermaid colado (parse no Rust). */
    importMermaid: importSource,
    /** Abre um ficheiro do projecto: `.arch.json` (o desenho com posições), `.mmd`, ou um
     *  Markdown com blocos Mermaid (mostra-os para escolher). */
    async openFromProject(rel: string): Promise<void> {
      s.ioError = ""; s.ioMessage = ""; s.importWarnings = []; s.mdBlocks = null;
      const root = workspace.root();
      if (!gateway.available()) { ioFail(NEEDS_DESKTOP); return; }
      if (!root) { ioFail("Open a folder first: files are read from the project."); return; }
      rel = rel.trim();
      if (!isSafeRel(rel)) { ioFail(`«${rel}» must be a path inside the project folder.`); return; }
      let text: string;
      try { text = await gateway.readFile(root, rel); } catch (e) { ioFail(e); return; }
      if (/\.json$/i.test(rel)) {
        const design = readDesignFile(text);
        if (!design) { ioFail(`${rel} is not a Studio design file.`); return; }
        if (replaceDesign(design, true)) s.ioMessage = `${rel} opened.`;
        repaint("inspector");
        return;
      }
      const blocks = mermaidBlocks(text);
      if (!blocks.length) { ioFail(`${rel} has no Mermaid graph/flowchart to import (sequence diagrams are not imported).`); return; }
      if (blocks.length === 1) { await importSource(blocks[0].source); return; }
      s.mdBlocks = blocks;
      s.ioMessage = `${rel} has ${blocks.length} diagrams: choose one.`;
      repaint("inspector");
    },
    async importBlock(i: number): Promise<void> {
      const b = s.mdBlocks?.[i];
      if (b) await importSource(b.source);
    },

    ensureLoaded,
    validate,
    preview,

    // ── componentes ──
    /** Acrescenta um componente: dentro do grupo seleccionado, ou num sítio livre. */
    add(kind: ArchKind, name: string): string {
      ensureLoaded();
      const g = selectedGroup();
      const at = freeSpot(d(), layout(d()), g);
      const id = addComponent(s.design, kind, name, at, g);
      s.sel = { t: "node", id };
      changed();
      return id;
    },
    connect: connectNodes,
    remove(id: string): void {
      removeComponent(s.design, id);
      if (s.sel?.t === "node" && s.sel.id === id) s.sel = null;
      if (s.sel?.t === "edge") s.sel = null;
      changed();
    },
    rename(id: string, name: string): void {
      const n = node(id);
      if (!n || !name.trim()) return;
      n.name = name.trim();
      changed();
    },
    setKind(id: string, kind: ArchKind): void {
      const n = node(id);
      if (!n) return;
      n.kind = kind;
      if (kind !== "store") n.outbox = false;
      changed();
    },
    setOutbox(id: string, on: boolean): void {
      const n = node(id);
      if (!n) return;
      n.outbox = on;
      changed("inspector");
    },
    setCode(id: string, code: string): void {
      const n = node(id);
      if (!n) return;
      if (code.trim()) n.code = code.replace(/\s+$/, ""); else delete n.code;
      changed();
    },
    setSource(id: string, source: string): void {
      const n = node(id);
      if (!n) return;
      if (source.trim()) n.source = source.trim(); else delete n.source;
      changed("inspector");
    },
    setNodeGroup(id: string, g: string | null): void {
      const n = node(id);
      if (!n) return;
      if (g && group(g)) {
        n.group = g;
        // entra no rectângulo do grupo, para a pertença se ver
        const r = layout(d()).groups.get(g)!;
        const at = freeSpot(d(), layout(d()), g);
        if (!(n.x >= r.x && n.x <= r.x + r.w && n.y >= r.y && n.y <= r.y + r.h)) { n.x = at.x; n.y = at.y; }
      } else delete n.group;
      changed();
    },

    // ── ligações ──
    removeConnection(index: number): void {
      removeConnection(s.design, index);
      if (s.sel?.t === "edge") s.sel = null;
      changed();
    },
    updateConnection(index: number, patch: ConnPatch): void {
      const c = s.design.connections[index];
      if (!c) return;
      if ("style" in patch) { if (patch.style) c.style = patch.style; else delete c.style; }
      if ("protocol" in patch) { if (patch.protocol) c.protocol = patch.protocol; else delete c.protocol; }
      if ("label" in patch) { if (patch.label?.trim()) c.label = patch.label.trim(); else delete c.label; }
      if ("source" in patch) { if (patch.source?.trim()) c.source = patch.source.trim(); else delete c.source; }
      if ("event" in patch) c.event = (patch.event ?? "").trim();
      changed();
    },

    // ── grupos ──
    /** Um grupo novo: dentro do grupo seleccionado, ou à direita do que existe. */
    addGroup(label: string, kind: GroupKind = "boundary"): string {
      ensureLoaded();
      const parent = selectedGroup();
      const rect = freeGroupSpot(layout(d()), 220, 140, parent);
      const id = addGroup(s.design, label, rect, parent, kind);
      s.sel = { t: "group", id };
      changed();
      return id;
    },
    updateGroup(id: string, patch: GroupPatch): void {
      const g = group(id);
      if (!g) return;
      if (patch.label !== undefined && patch.label.trim()) g.label = patch.label.trim();
      if (patch.kind) g.kind = patch.kind;
      if (patch.style) g.style = patch.style;
      if (patch.source !== undefined) { if (patch.source.trim()) g.source = patch.source.trim(); else delete g.source; }
      changed();
    },
    setGroupParent(id: string, parent: string | null): void {
      if (!setGroupParent(s.design, id, parent ?? undefined)) {
        s.notice = "A group cannot be placed inside itself.";
        repaint("inspector");
        return;
      }
      changed();
    },
    setGroupView(id: string, viewId: string | null): void {
      const g = group(id);
      if (!g) return;
      if (viewId && g.parent) setGroupParent(s.design, id, undefined);
      setGroupView(s.design, id, viewId ?? undefined);
      changed();
    },
    removeGroup(id: string): void {
      removeGroup(s.design, id);
      if (s.sel?.t === "group" && s.sel.id === id) s.sel = null;
      changed();
    },

    // ── painéis ──
    /** Um painel novo, com um grupo raiz para lhe dar corpo. Máximo dois. */
    addView(title: string): string | null {
      ensureLoaded();
      const id = addView(s.design, title);
      if (!id) {
        s.notice = "The comparison mode has at most two panels.";
        repaint("inspector");
        return null;
      }
      const rect = freeGroupSpot(layout(d()), 240, 160);
      const g = addGroup(s.design, title, rect, undefined, "boundary");
      setGroupView(s.design, g, id);
      s.sel = { t: "group", id: g };
      changed();
      return id;
    },
    updateView(id: string, patch: ViewPatch): void {
      const v = findView(s.design, id);
      if (!v) return;
      if (patch.title !== undefined && patch.title.trim()) v.title = patch.title.trim();
      if (patch.color && /^#[0-9a-fA-F]{6}$/.test(patch.color)) v.color = patch.color;
      if (patch.daemonless !== undefined) v.daemonless = patch.daemonless;
      if (patch.strict !== undefined) v.strict = patch.strict;
      changed();
    },
    removeView(id: string): void {
      removeView(s.design, id);
      changed();
    },

    // ── auto-layout ──
    /** Arruma tudo por camadas, de cima para baixo. Substitui as posições à mão: pede
     *  confirmação quando já há componentes. */
    arrange(confirmed = false): boolean {
      if (!s.design.components.length && !s.design.groups.length) return false;
      if (!confirmed && !workspace.confirm("Lay out the whole design top to bottom? The positions you set by hand will be replaced.")) return false;
      const next = autoLayout(s.design);
      s.design.components = next.components;
      s.design.groups = next.groups;
      changed();
      return true;
    },

    // ── arrastar e redimensionar ──
    /** Arrastar um cartão: move sem guardar (a gravação é no fim, em `endMove`). */
    move(id: string, x: number, y: number): void {
      const n = node(id);
      if (!n) return;
      n.x = x;
      n.y = y;
      repaint("drag");
    },
    /** Fim de arrasto de um cartão: fica no grupo mais fundo debaixo do seu centro. */
    endMove(id?: string): void {
      const n = id ? node(id) : undefined;
      if (n) {
        // sem a pertença actual: um grupo cresce para conter os seus cartões, e assim nunca
        // se conseguiria tirar um cartão de lá
        const loose: Design = { ...d(), components: d().components.map((c) => (c.id === n.id ? { ...c, group: undefined } : c)) };
        const l = layout(loose);
        const target = groupAt(loose, l, center(l.nodes.get(n.id)!));
        if (target !== n.group) {
          if (target) n.group = target; else delete n.group;
          changed();
          return;
        }
      }
      save();
      repaint("canvas"); // as setas voltam a ser encaminhadas
    },
    moveGroup(id: string, dx: number, dy: number): void {
      if (!group(id)) return;
      shiftGroup(id, dx, dy);
      repaint("drag");
    },
    /** Fim de arrasto de um grupo: o pai passa a ser o grupo mais fundo debaixo do seu
     *  centro (fora dele próprio e dos seus); sem pai, entra no painel que o contém. */
    endGroupMove(id: string): void {
      const g = group(id);
      if (!g) return;
      const before = JSON.stringify([g.parent ?? null, s.design.views.map((v) => v.roots)]);
      // sem o pai actual nem o painel actual (que crescem para o conter)
      const loose: Design = { ...d(), groups: d().groups.map((x) => (x.id === id ? { ...x, parent: undefined } : x)) };
      const l = layout(loose, { excludeRoot: id });
      const exclude = descendants(s.design, id);
      exclude.add(id);
      const c = center(l.groups.get(id)!);
      const parent = groupAt(loose, l, c, exclude);
      if (parent) setGroupParent(s.design, id, parent);
      else {
        setGroupParent(s.design, id, undefined);
        setGroupView(s.design, id, panelAt(l, c));
      }
      const after = JSON.stringify([g.parent ?? null, s.design.views.map((v) => v.roots)]);
      if (after !== before) { changed(); return; }
      save();
      repaint("canvas");
    },
    resizeGroup(id: string, w: number, h: number): void {
      const g = group(id);
      if (!g) return;
      g.w = Math.max(80, w);
      g.h = Math.max(50, h);
      repaint("drag");
    },
    endResize(): void {
      save();
      repaint("canvas");
    },

    // ── selecção e ligação ──
    select(sel: Selection | null): void {
      s.sel = sel;
      s.notice = "";
      repaint("all");
    },
    toggleLinking(): void {
      s.linking = s.linking === null ? "" : null;
      repaint("all");
    },
    /** Clique num componente com a ligação activa: 1.º clique escolhe a origem, 2.º liga. */
    linkClick(id: string | null): void {
      if (s.linking === null) return;
      if (id === null) s.linking = "";
      else if (s.linking === "") s.linking = id;
      else if (s.linking !== id) {
        const from = s.linking;
        s.linking = null;
        connectNodes(from, id);
        return;
      }
      repaint("all");
    },

    /** Scaffold REAL: escreve no disco. Só com pasta aberta, sem erros de validação e com
     *  confirmação explícita (a pré-visualização mostra antes o que seria escrito). */
    async scaffold(): Promise<string[] | null> {
      const root = workspace.root();
      if (!gateway.available()) { s.opError = NEEDS_DESKTOP; repaint("inspector"); return null; }
      if (!root) { s.opError = "Open a folder first: the scaffold is written there."; repaint("inspector"); return null; }
      const findings = await validate();
      if (s.valError || findings.some((f) => f.severity === "error")) {
        s.opError = "The design has errors: fix them before generating the scaffold.";
        repaint("inspector");
        return null;
      }
      const files = s.preview ?? (await preview());
      if (s.opError) return null;
      if (!workspace.confirm(`Write ${files.length} files under ${root}? Existing files are never overwritten.`)) return null;
      s.opError = "";
      try {
        s.written = await gateway.scaffold(root, toArchitecture(s.design));
      } catch (e) {
        s.written = null;
        s.opError = String(e);
      }
      repaint("inspector");
      return s.written;
    },
  };
}

export type ArchStudio = ReturnType<typeof makeArchStudio>;
