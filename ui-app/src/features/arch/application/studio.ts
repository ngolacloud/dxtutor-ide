/* ═════════ feature `arch` — caso de uso do Studio de arquitectura ═════════
   Dono do estado do Studio (desenho, selecção, ligação em curso, achados, resultados) e
   das três operações honestas do backend:
     · validação — arch_validate (regras estruturais reais, nunca no cliente);
     · pré-visualização do scaffold — lista o que SERIA escrito, sem tocar no disco;
     · scaffold real — só com pasta aberta, desenho sem erros e confirmação explícita.
   O desenho NASCE VAZIO (sem dados de demonstração) e guarda-se por raiz, na mesma chave
   do Studio original (`dxnext-studio:<raiz>`), para os desenhos antigos voltarem a abrir.
   Sem DOM e sem window: tudo passa pelas portas. */

import {
  addComponent, connect, emptyDesign, findNode, parseDesign, relationFor, relationTakesEvent,
  removeComponent, removeConnection, toArchitecture,
} from "../domain/design";
import type { ArchFinding, ArchKind, Design, DesignNode } from "../domain/types";
import type { ArchStudioDeps } from "./ports";

export interface ArchStudioState {
  design: Design;
  /** Componente seleccionado. */
  sel: string | null;
  /** `null` = não está a ligar; `""` = à espera da origem; id = à espera do destino. */
  linking: string | null;
  findings: ArchFinding[];
  validating: boolean;
  valError: string;
  preview: [string, string][] | null;
  written: string[] | null;
  opError: string;
}

export const storageKey = (root: string | null): string => `dxnext-studio:${root ?? "default"}`;

export const NEEDS_DESKTOP = "Validation and scaffolding run in the Rust backend: open the desktop app.";

export function makeArchStudio(deps: ArchStudioDeps) {
  const { gateway, store, workspace, repaint } = deps;
  const s: ArchStudioState = {
    design: emptyDesign(), sel: null, linking: null, findings: [], validating: false,
    valError: "", preview: null, written: null, opError: "",
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
    save();
  }

  /** Carrega o desenho da raiz actual (uma vez por raiz). Devolve `true` se trocou. */
  function ensureLoaded(): boolean {
    const key = storageKey(workspace.root());
    if (loadedFor === key) return false;
    loadedFor = key;
    s.design = parseDesign(store.load(key));
    s.sel = null;
    s.linking = null;
    s.findings = [];
    s.valError = "";
    s.preview = null;
    s.written = null;
    s.opError = "";
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

  const node = (id: string): DesignNode | undefined => findNode(s.design, id);

  /** Liga dois componentes; pede o nome do evento quando a relação publica ou consome. */
  function connectNodes(from: string, to: string): void {
    const a = node(from), b = node(to);
    if (!a || !b) return;
    const event = relationTakesEvent(relationFor(a.kind, b.kind))
      ? (workspace.prompt("Event name (routing key):", "") ?? "").trim()
      : "";
    connect(s.design, from, to, event);
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

  return {
    state: (): Readonly<ArchStudioState> => s,
    ensureLoaded,
    validate,

    add(kind: ArchKind, name: string): string {
      ensureLoaded();
      const id = addComponent(s.design, kind, name);
      s.sel = id;
      changed();
      return id;
    },

    connect: connectNodes,

    remove(id: string): void {
      removeComponent(s.design, id);
      if (s.sel === id) s.sel = null;
      changed();
    },

    removeConnection(index: number): void {
      removeConnection(s.design, index);
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

    /** Arrastar: move sem guardar (a gravação é no fim, em `endMove`). */
    move(id: string, x: number, y: number): void {
      const n = node(id);
      if (!n) return;
      n.x = x;
      n.y = y;
      repaint("canvas");
    },

    endMove(): void {
      save();
    },

    select(id: string | null): void {
      s.sel = id;
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

    preview,

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
