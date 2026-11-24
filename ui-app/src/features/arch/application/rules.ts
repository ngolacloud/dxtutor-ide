/* ═════════ feature `arch` — caso de uso: o painel «Rules» do Studio (RF-A01/A04, F5.2/F5.5) ═════════
   Edita as regras do arquitecto (`.dxtutor/architecture.toml`) como formulário, faz nascer as
   camadas do desenho, grava pelo backend (que valida e só deixa o Arquitecto), aceita ADRs e
   propõe o commit do arquitecto só com os ficheiros que mudaram. Sem DOM e sem window. */

import { RULES_FILE, emptyRules, layersFromDesign, type Adr, type ArchRules, type RulesDoc, type RulesLayer } from "../domain/rules";
import type { Design } from "../domain/types";
import type { RulesGateway } from "./ports";

export interface RulesState {
  open: boolean;
  loading: boolean;
  doc: RulesDoc | null;
  /** O rascunho do formulário (o que «Save» grava). */
  draft: ArchRules;
  dirty: boolean;
  adrs: Adr[];
  /** Os ficheiros gravados por este painel desde o último commit (o que o commit leva). */
  changed: string[];
  error: string;
  message: string;
}

export interface RulesDeps {
  gateway: RulesGateway;
  workspace: { root(): string | null; confirm(message: string): boolean; prompt(message: string, initial: string): string | null };
  /** O desenho do Studio (para as camadas que nascem dele). */
  design(): Design;
  repaint(): void;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e));
const clone = (r: ArchRules): ArchRules => JSON.parse(JSON.stringify(r)) as ArchRules;

export function makeRulesEditor(deps: RulesDeps) {
  const { gateway, workspace, repaint } = deps;
  const s: RulesState = { open: false, loading: false, doc: null, draft: emptyRules(), dirty: false, adrs: [], changed: [], error: "", message: "" };
  const say = (m: string, err = ""): void => { s.message = m; s.error = err; };
  const touched = (path: string): void => { if (!s.changed.includes(path)) s.changed.push(path); };

  async function load(): Promise<void> {
    const root = workspace.root();
    // no folder (or no backend): nothing to read, but the panel still opens and says why
    if (!root || !gateway.available()) { repaint(); return; }
    s.loading = true;
    repaint();
    try {
      const [doc, adrs] = await Promise.all([gateway.load(root), gateway.adrs(root)]);
      s.doc = doc;
      s.draft = clone(doc.rules);
      s.adrs = adrs;
      s.dirty = false;
      say("", doc.error ?? "");
    } catch (e) {
      say("", msg(e));
    }
    s.loading = false;
    repaint();
  }

  /** Muda o rascunho; `paint`: redesenhar (acrescentar/tirar linhas, caixas), não a cada letra. */
  function edit(f: (r: ArchRules) => void, paint = false): void {
    f(s.draft);
    s.dirty = true;
    s.message = "";
    if (paint) repaint();
  }
  const layer = (i: number): RulesLayer | undefined => s.draft.layers[i];

  return {
    state: (): RulesState => s,
    available: (): boolean => gateway.available() && !!workspace.root(),
    async toggle(): Promise<void> {
      s.open = !s.open;
      if (s.open) await load();
      else repaint();
    },
    close(): void {
      if (s.open) { s.open = false; repaint(); }
    },
    reload: load,

    // ── camadas ──
    addLayer(): void { edit((r) => r.layers.push({ name: "", paths: [], mayUse: [], imports: [] }), true); },
    removeLayer(i: number): void { edit((r) => r.layers.splice(i, 1), true); },
    setLayerName(i: number, name: string): void { edit(() => { const l = layer(i); if (l) l.name = name.trim(); }); },
    setLayerPaths(i: number, paths: string[]): void { edit(() => { const l = layer(i); if (l) l.paths = paths; }); },
    setLayerUses(i: number, uses: string[]): void { edit(() => { const l = layer(i); if (l && l.mayUse !== null) l.mayUse = uses; }); },
    /** `true`: pode depender de qualquer camada (sem `may_use`). */
    setLayerFree(i: number, free: boolean): void { edit(() => { const l = layer(i); if (l) l.mayUse = free ? null : []; }, true); },
    /** As camadas do desenho (grupos «Layer») e as dependências das suas setas. */
    fromDesign(): void {
      const r = layersFromDesign(deps.design(), s.draft);
      if (!r.added.length && !r.uses.length) {
        say("Nothing new in the drawing: make a group of kind «Layer» for each layer, and draw the arrows between their components.");
        repaint();
        return;
      }
      s.draft = r.rules;
      s.dirty = true;
      say([r.added.length ? `New layers: ${r.added.join(", ")} (check their paths).` : "", r.uses.length ? `May use: ${r.uses.join("; ")}.` : ""].filter(Boolean).join(" "));
      repaint();
    },

    // ── bibliotecas, nomes, excepções ──
    setLibraries(kind: "forbidden" | "approved", names: string[]): void { edit((r) => { r.libraries[kind] = names; }); },
    addNaming(): void { edit((r) => r.naming.push({ paths: [], pattern: "" }), true); },
    removeNaming(i: number): void { edit((r) => r.naming.splice(i, 1), true); },
    setNaming(i: number, patch: { paths?: string[]; pattern?: string }): void { edit((r) => { const n = r.naming[i]; if (n) Object.assign(n, patch); }); },
    addException(): void { edit((r) => r.exceptions.push({ adr: "", rule: "" }), true); },
    removeException(i: number): void { edit((r) => r.exceptions.splice(i, 1), true); },
    setException(i: number, patch: { adr?: string; rule?: string }): void { edit((r) => { const x = r.exceptions[i]; if (x) Object.assign(x, patch); }); },

    /** Grava as regras (o backend valida e verifica o papel). */
    async save(): Promise<boolean> {
      const root = workspace.root();
      if (!root) return false;
      try {
        const doc = await gateway.save(root, s.draft);
        s.doc = doc;
        s.draft = clone(doc.rules);
        s.dirty = false;
        touched(RULES_FILE);
        say(`Saved ${RULES_FILE}. Commit it when you are done.`);
        repaint();
        return true;
      } catch (e) {
        say("", msg(e));
        repaint();
        return false;
      }
    },

    /** Aceita um ADR (só o Arquitecto), depois de o humano confirmar. */
    async acceptAdr(path: string): Promise<void> {
      const root = workspace.root();
      const a = s.adrs.find((x) => x.path === path);
      if (!root || !a || a.accepted) return;
      if (!workspace.confirm(`Accept ${a.id} — ${a.title}?\n\nIts status becomes accepted and your name is written under it. Deviations that name it start to pass the architecture checks.`)) return;
      try {
        const next = await gateway.acceptAdr(root, path);
        s.adrs = s.adrs.map((x) => (x.path === path ? next : x));
        touched(path);
        say(`${next.id} accepted. Commit it when you are done.`);
      } catch (e) {
        say("", msg(e));
      }
      repaint();
    },

    /** O commit do arquitecto só com os ficheiros que este painel mudou. */
    async commit(): Promise<string | null> {
      const root = workspace.root();
      if (!root || !s.changed.length) return null;
      const onlyAdrs = !s.changed.includes(RULES_FILE);
      const ids = s.adrs.filter((a) => s.changed.includes(a.path)).map((a) => a.id);
      const initial = onlyAdrs ? `docs(adr): accept ${ids.join(", ")}` : ids.length ? `docs(arch): update the architect's rules; accept ${ids.join(", ")}` : "docs(arch): update the architect's rules";
      const message = workspace.prompt(`Commit only:\n${s.changed.join("\n")}\n\nMessage:`, initial);
      if (!message || !message.trim()) return null;
      try {
        const hash = await gateway.commit(root, [...s.changed], message.trim());
        s.changed = [];
        say(`Committed ${hash}.`);
        repaint();
        return hash;
      } catch (e) {
        say("", msg(e));
        repaint();
        return null;
      }
    },
  };
}

export type RulesEditor = ReturnType<typeof makeRulesEditor>;
