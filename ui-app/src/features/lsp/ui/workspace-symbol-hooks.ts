/* ═════════ feature `lsp` — Go to Symbol in Workspace (Ctrl+T) ═════════
   Ctrl+T (no editor, ou com o foco fora de um campo de texto e do terminal) abre um cartão no
   topo da vista que pesquisa os símbolos da pasta nos servidores de linguagem que estão a
   correr (`ui/popups.ts`, `#lsp-wsymbols`); escolher abre o ficheiro no símbolo. A paleta chama
   a acção devolvida (o bridge regista a entrada). A tecla é apanhada na fase de CAPTURA do
   `document`. Não toca em `window`. */

import type { WorkspaceSymbolResult, WorkspaceSymbolSearch } from "../application/lsp-client";
import { closePopup, showWorkspaceSymbolPicker } from "./popups";

export interface WorkspaceSymbolHooksDeps {
  workspaceSymbolsFor(query: string): Promise<WorkspaceSymbolSearch | null>;
  openWorkspaceSymbol(s: WorkspaceSymbolResult): Promise<void>;
  enabled(): boolean;
}

const KEY = "__lspWorkspaceSymbolHooks__";

/** O Ctrl+T é desta feature quando o foco está no editor, ou fora de campos de texto e do
 *  terminal (aí as teclas são da shell). */
function ownsKey(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return true;
  if (t instanceof HTMLTextAreaElement && t.id === "ed-ta") return true;
  if (t.closest(".xterm")) return false;
  return !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t as HTMLElement).isContentEditable);
}

/** Instala o atalho (idempotente) e devolve a acção para a paleta. */
export function bindWorkspaceSymbolHooks(d: WorkspaceSymbolHooksDeps): () => void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();

  const open = (): void => {
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    const host = ta?.closest(".ed") ?? document.querySelector(".main, main") ?? document.body;
    const r = host.getBoundingClientRect();
    const w = 600;
    const x = r.left + Math.max(8, (r.width - w) / 2);
    const y = r.top + 6;
    const back = (): void => ta?.focus({ preventScroll: true });
    showWorkspaceSymbolPicker(x, y, d.workspaceSymbolsFor, (s) => void d.openWorkspaceSymbol(s), back);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!d.enabled() || !ownsKey(e.target)) return;
    if (!(e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === "t" || e.code === "KeyT"))) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  };
  document.addEventListener("keydown", onKey, true);
  doc[KEY] = () => {
    document.removeEventListener("keydown", onKey, true);
    closePopup("lsp-wsymbols");
  };
  return open;
}
