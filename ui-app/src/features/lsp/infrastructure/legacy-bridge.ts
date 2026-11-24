/* ═════════ feature `lsp`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/lsp/` autorizado a ler `window.*` (A8 do
   arch-check). Lê o workspace aberto pelo desktop (`DXR.root`), o prefixo das chaves
   (`ROOT`), o `FS` em memória e o separador activo (`cur` + `tabOf`); chama o pintor
   publicado (`paintEd`), o `openPath`, o `writeFile` (edições do rename; o autosave leva-as ao
   disco) e o `show` (volta a mostrar o ficheiro activo). Não publica nada no `window`. Acessores lêem
   `window` NO ACTO (a pasta abre de forma assíncrona). */

import { toast, esc } from "../../../core";
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
  writeFile?: (key: string, content: string) => void;
  show?: (id: string | null) => void;
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
  writeFile: (key, text) => G.writeFile?.(key, text),
  reload: (key) => {
    if (fileKeyOfTab(G.cur ?? null) === key) G.show?.(G.cur ?? null);
  },
  /* o aviso de servidor em falta: uma faixa no topo da vista do ficheiro (antes do `.ed`) */
  notice: (key, n, onDismiss) => {
    if (fileKeyOfTab(G.cur ?? null) !== key) return;
    const ed = document.getElementById("ed-ta")?.closest(".ed");
    if (!ed || !ed.parentElement) return;
    ed.parentElement.querySelector(":scope > #lsp-missing")?.remove();
    if (!n) return;
    const el = document.createElement("div");
    el.id = "lsp-missing"; el.className = "lsp-missing"; el.setAttribute("role", "status");
    el.innerHTML = `<b>⚠ ${esc(n.title)}</b><span class="lsp-detail">${esc(n.detail)}</span><span>To install: <code>${esc(n.install)}</code></span><button class="mini" type="button">Dismiss</button>`;
    el.querySelector("button")!.addEventListener("click", () => { el.remove(); onDismiss?.(); });
    ed.parentElement.insertBefore(el, ed);
  },
};
