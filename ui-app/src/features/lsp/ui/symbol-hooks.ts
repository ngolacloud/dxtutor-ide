/* ═════════ feature `lsp` — Go to Symbol (Ctrl+Shift+O) ═════════
   No editor, Ctrl+Shift+O pede ao servidor os símbolos do ficheiro activo e mostra-os num
   cartão com filtro (`ui/popups.ts`, `#lsp-symbols`) no topo da vista; escolher leva ao
   símbolo. A paleta de comandos chama a acção devolvida (o bridge regista a entrada). A tecla
   é apanhada na fase de CAPTURA do `document`. Não toca em `window`. */

import type { SymbolEntry } from "../domain/symbols";
import { closePopup, showSymbolPicker } from "./popups";

export interface SymbolHooksDeps {
  /** A chave do ficheiro activo (`null` se o separador não é um ficheiro). */
  currentFileKey(): string | null;
  symbolsFor(key: string): Promise<SymbolEntry[] | null>;
  open(key: string, line: number, character: number): void;
  notify(message: string): void;
  enabled(): boolean;
}

const KEY = "__lspSymbolHooks__";

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

/** Instala o atalho (idempotente) e devolve a acção para a paleta. */
export function bindSymbolHooks(d: SymbolHooksDeps): () => void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();
  let seq = 0;

  const goToSymbol = (): void => {
    const key = d.currentFileKey();
    if (!key || !d.enabled()) {
      d.notify("Go to Symbol: open a file of the folder first");
      return;
    }
    const mine = ++seq;
    void d.symbolsFor(key).then((syms) => {
      if (mine !== seq || d.currentFileKey() !== key) return; // pedido antigo, ou mudou de ficheiro
      if (syms === null) {
        d.notify("Go to Symbol: no language server for this file");
        return;
      }
      const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
      const r = (ta?.closest(".ed") ?? ta)?.getBoundingClientRect();
      const w = 440;
      const x = r ? r.left + Math.max(8, (r.width - w) / 2) : 80;
      const y = r ? r.top + 6 : 60;
      const back = (): void => ta?.focus({ preventScroll: true });
      showSymbolPicker(syms, x, y, (s) => d.open(key, s.line, s.character), back);
    });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    if (!(e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key.toLowerCase() === "o" || e.code === "KeyO"))) return;
    e.preventDefault();
    e.stopPropagation();
    goToSymbol();
  };
  document.addEventListener("keydown", onKey, true);
  doc[KEY] = () => {
    document.removeEventListener("keydown", onKey, true);
    closePopup("lsp-symbols");
  };
  return goToSymbol;
}
