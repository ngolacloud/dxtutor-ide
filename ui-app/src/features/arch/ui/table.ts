/* ═════════ feature `arch` — a tabela de acções (data-action → caso de uso) ═════════
   Construída aqui (e não na raiz de composição) para os testes ligarem exactamente a mesma
   tabela que a app. O `prompt` vem injectado (o bridge, na app; um falso, nos testes). */

import { isEdgeStyle, isGroupKind, isKind, isProtocol } from "../domain/design";
import type { ArchStudio } from "../application/studio";
import type { ActionTable } from "./actions";

export function archActions(studio: ArchStudio, prompt: (message: string, initial: string) => string | null): ActionTable {
  const ask = (m: string): string => (prompt(m, "") ?? "").trim();
  const idx = (on: string): number => Number(on);
  return {
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
