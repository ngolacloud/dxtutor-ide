/* ═════════ feature `arch` — a tabela de acções (data-action → caso de uso) ═════════
   Construída aqui (e não na raiz de composição) para os testes ligarem exactamente a mesma
   tabela que a app. O `prompt` vem injectado (o bridge, na app; um falso, nos testes). */

import { isEdgeStyle, isGroupKind, isKind, isProtocol } from "../domain/design";
import type { ArchStudio } from "../application/studio";
import type { RulesEditor } from "../application/rules";
import { splitList } from "../domain/rules";
import type { ActionTable } from "./actions";

/** As acções que contam enquanto há uma proposta do agente à espera (o resto fica parado,
 *  para nada mudar às escondidas por baixo da proposta). */
const WHILE_PROPOSAL = new Set(["arch-accept", "arch-discard", "arch-peek"]);

export function archActions(studio: ArchStudio, prompt: (message: string, initial: string) => string | null, rules?: RulesEditor): ActionTable {
  const table = { ...actions(studio, prompt, rules), ...(rules ? rulesActions(studio, rules) : {}) };
  return Object.fromEntries(Object.entries(table).map(([name, spec]) => [name, {
    on: spec.on,
    run: (e) => { if (!studio.state().proposal || WHILE_PROPOSAL.has(name)) spec.run(e); },
  }]));
}

/** O painel «Rules» (F5.2/F5.5): abre-se no lugar do Import/Export (um de cada vez). */
function rulesActions(studio: ArchStudio, rules: RulesEditor): ActionTable {
  const i = (on: string): number => Number(on);
  return {
    "arch-rules": { on: "click", run: () => { if (studio.state().io) studio.toggleIo(); void rules.toggle(); } },
    "arch-rl-add": { on: "click", run: () => rules.addLayer() },
    "arch-rl-del": { on: "click", run: ({ on }) => rules.removeLayer(i(on)) },
    "arch-rl-name": { on: "change", run: ({ on, value }) => rules.setLayerName(i(on), value) },
    "arch-rl-paths": { on: "change", run: ({ on, value }) => rules.setLayerPaths(i(on), splitList(value)) },
    "arch-rl-uses": { on: "change", run: ({ on, value }) => rules.setLayerUses(i(on), splitList(value)) },
    "arch-rl-free": { on: "change", run: ({ on, checked }) => rules.setLayerFree(i(on), checked) },
    "arch-rl-from": { on: "click", run: () => rules.fromDesign() },
    "arch-rl-lib": { on: "change", run: ({ on, value }) => { if (on === "forbidden" || on === "approved") rules.setLibraries(on, splitList(value)); } },
    "arch-rl-naming-add": { on: "click", run: () => rules.addNaming() },
    "arch-rl-naming-del": { on: "click", run: ({ on }) => rules.removeNaming(i(on)) },
    "arch-rl-naming-paths": { on: "change", run: ({ on, value }) => rules.setNaming(i(on), { paths: splitList(value) }) },
    "arch-rl-naming-pattern": { on: "change", run: ({ on, value }) => rules.setNaming(i(on), { pattern: value }) },
    "arch-rl-exc-add": { on: "click", run: () => rules.addException() },
    "arch-rl-exc-del": { on: "click", run: ({ on }) => rules.removeException(i(on)) },
    "arch-rl-exc-adr": { on: "change", run: ({ on, value }) => rules.setException(i(on), { adr: value.trim() }) },
    "arch-rl-exc-rule": { on: "change", run: ({ on, value }) => rules.setException(i(on), { rule: value.trim() }) },
    "arch-rl-save": { on: "click", run: () => void rules.save() },
    "arch-adr-accept": { on: "click", run: ({ on }) => void rules.acceptAdr(on) },
    "arch-rl-commit": { on: "click", run: () => void rules.commit() },
  };
}

function actions(studio: ArchStudio, prompt: (message: string, initial: string) => string | null, rules?: RulesEditor): ActionTable {
  const ask = (m: string): string => (prompt(m, "") ?? "").trim();
  const idx = (on: string): number => Number(on);
  return {
    "arch-accept": { on: "click", run: () => studio.acceptProposal() },
    "arch-discard": { on: "click", run: () => studio.discardProposal() },
    "arch-peek": { on: "click", run: () => studio.toggleShowCurrent() },
    "arch-link": { on: "click", run: () => studio.toggleLinking() },
    "arch-preview": { on: "click", run: () => void studio.preview() },
    "arch-scaffold": { on: "click", run: () => void studio.scaffold() },
    "arch-add": {
      on: "click",
      run: ({ on }) => {
        if (!isKind(on)) return;
        const name = ask("Component name:");
        if (name) studio.add(on, name);
      },
    },
    "arch-add-group": { on: "click", run: () => { const l = ask("Group label (e.g. Host, Control Plane, Node 1):"); if (l) studio.addGroup(l); } },
    "arch-arrange": { on: "click", run: () => studio.arrange() },
    "arch-io": { on: "click", run: () => { rules?.close(); studio.toggleIo(); } },
    "arch-export": { on: "click", run: ({ on }) => { if (on === "svg" || on === "png" || on === "mermaid" || on === "json") void studio.exportAs(on); } },
    "arch-import-mermaid": {
      on: "click",
      run: ({ el }) => {
        const src = el.closest("[data-arch-insp]")?.querySelector<HTMLTextAreaElement>("[data-arch-mermaid]")?.value ?? "";
        if (src.trim()) void studio.importMermaid(src);
      },
    },
    "arch-open": {
      on: "click",
      run: ({ el }) => {
        const rel = el.closest("[data-arch-insp]")?.querySelector<HTMLInputElement>("[data-arch-open]")?.value ?? "";
        void studio.openFromProject(rel);
      },
    },
    "arch-import-block": { on: "click", run: ({ on }) => void studio.importBlock(idx(on)) },
    "arch-add-view": { on: "click", run: () => { const t = ask("Panel title (e.g. Docker, Delonix):"); if (t) studio.addView(t); } },

    // componente
    "arch-name": { on: "change", run: ({ on, value }) => studio.rename(on, value) },
    "arch-kind": { on: "change", run: ({ on, value }) => { if (isKind(value)) studio.setKind(on, value); } },
    "arch-outbox": { on: "change", run: ({ on, checked }) => studio.setOutbox(on, checked) },
    "arch-code": { on: "change", run: ({ on, value }) => studio.setCode(on, value) },
    "arch-source": { on: "change", run: ({ on, value }) => studio.setSource(on, value) },
    "arch-node-group": { on: "change", run: ({ on, value }) => studio.setNodeGroup(on, value || null) },
    "arch-del": { on: "click", run: ({ on }) => studio.remove(on) },

    // ligação
    "arch-sel-edge": { on: "click", run: ({ on }) => studio.select({ t: "edge", i: idx(on) }) },
    "arch-del-conn": { on: "click", run: ({ on }) => studio.removeConnection(idx(on)) },
    "arch-edge-style": { on: "change", run: ({ on, value }) => studio.updateConnection(idx(on), { style: isEdgeStyle(value) ? value : undefined }) },
    "arch-edge-protocol": { on: "change", run: ({ on, value }) => studio.updateConnection(idx(on), { protocol: isProtocol(value) ? value : undefined }) },
    "arch-edge-label": { on: "change", run: ({ on, value }) => studio.updateConnection(idx(on), { label: value }) },
    "arch-edge-event": { on: "change", run: ({ on, value }) => studio.updateConnection(idx(on), { event: value }) },
    "arch-edge-source": { on: "change", run: ({ on, value }) => studio.updateConnection(idx(on), { source: value }) },

    // grupo
    "arch-group-label": { on: "change", run: ({ on, value }) => studio.updateGroup(on, { label: value }) },
    "arch-group-kind": { on: "change", run: ({ on, value }) => { if (isGroupKind(value)) studio.updateGroup(on, { kind: value }); } },
    "arch-group-style": { on: "change", run: ({ on, value }) => studio.updateGroup(on, { style: value === "solid" ? "solid" : "dashed" }) },
    "arch-group-parent": { on: "change", run: ({ on, value }) => studio.setGroupParent(on, value || null) },
    "arch-group-view": { on: "change", run: ({ on, value }) => studio.setGroupView(on, value || null) },
    "arch-group-source": { on: "change", run: ({ on, value }) => studio.updateGroup(on, { source: value }) },
    "arch-group-del": { on: "click", run: ({ on }) => studio.removeGroup(on) },

    // painel
    "arch-view-title": { on: "change", run: ({ on, value }) => studio.updateView(on, { title: value }) },
    "arch-view-color": { on: "change", run: ({ on, value }) => studio.updateView(on, { color: value }) },
    "arch-view-daemonless": { on: "change", run: ({ on, checked }) => studio.updateView(on, { daemonless: checked }) },
    "arch-view-strict": { on: "change", run: ({ on, checked }) => studio.updateView(on, { strict: checked }) },
    "arch-view-del": { on: "click", run: ({ on }) => studio.removeView(on) },
  };
}
