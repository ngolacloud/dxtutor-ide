/* ═════════ feature `lsp`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/lsp/` autorizado a ler `window.*` (A8 do
   arch-check). Lê o workspace aberto pelo desktop (`DXR.root`), o prefixo das chaves
   (`ROOT`), o `FS` em memória e o separador activo (`cur` + `tabOf`); chama o pintor
   publicado (`paintEd`) e o `openPath`. Não publica nada no `window`. Acessores lêem
   `window` NO ACTO (a pasta abre de forma assíncrona). */

import { toast } from "../../../core";
import { positionToOffset } from "../domain/positions";
import type { EditorPort, WorkspacePort } from "../application/ports";

interface Tab {
  kind?: string;
  path?: string;
}
interface Globals {
  DXR?: { root?: string | null };
  ROOT?: string;
  FS?: Record<string, { content: string } | undefined>;
  cur?: string | null;
  tabOf?: (id: string | null) => Tab | null | undefined;
  paintEd?: (key: string) => void;
  openPath?: (key: string, line?: number) => void;
  stPos?: () => void;
}
const G = window as unknown as Globals;

function fileKeyOfTab(tabId: string | null): string | null {
  const t = G.tabOf?.(tabId);
  return t && t.kind === "file" && typeof t.path === "string" ? t.path : null;
}

export const workspace: WorkspacePort = {
  diskRoot: () => G.DXR?.root ?? null,
  virtualPrefix: () => String(G.ROOT ?? ""),
  fileKeyOfTab,
  currentFileKey: () => fileKeyOfTab(G.cur ?? null),
  text: (key) => G.FS?.[key]?.content ?? null,
};

export const editor: EditorPort = {
  repaint: (key) => {
    if (fileKeyOfTab(G.cur ?? null) === key && document.getElementById("ed-ta")) G.paintEd?.(key);
  },
  open: (key, line, character) => {
    G.openPath?.(key, line);
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    if (!ta) return;
    const o = positionToOffset(ta.value, { line: line - 1, character });
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(o, o);
    G.stPos?.();
  },
  notify: (message) => toast(message),
};
