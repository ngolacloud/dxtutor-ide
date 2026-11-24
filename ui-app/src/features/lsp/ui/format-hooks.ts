/* ═════════ feature `lsp` — formatação no editor (Shift+Alt+F) ═════════
   No editor, Shift+Alt+F formata pelo servidor de linguagem: o documento, ou só a selecção.
   A tecla é apanhada na fase de CAPTURA do `document`, antes dos atalhos globais
   (`features/shortcuts.ts`, que a ligam ao «Format Document» do dxtutor); quando não há
   servidor, ou ele não formata o documento, corre esse formatador do dxtutor como antes.
   Não toca em `window`. */

import type { FormatOutcome } from "../application/lsp-client";

export interface FormatHooksDeps {
  formatAt(start: number, end: number): Promise<FormatOutcome>;
  /** O «Format Document» do dxtutor. */
  builtinFormat(): void;
  enabled(): boolean;
}

const KEY = "__lspFormatHooks__";

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

/** Instala o listener. Idempotente. */
export function bindFormatHooks(d: FormatHooksDeps): void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();
  const onKey = (e: KeyboardEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    if (!(e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === "f" || e.code === "KeyF"))) return;
    e.preventDefault();
    e.stopPropagation();
    const ta = e.target;
    void d.formatAt(ta.selectionStart, ta.selectionEnd).then((r) => {
      if (r === "fallback") d.builtinFormat();
    });
  };
  document.addEventListener("keydown", onKey, true);
  doc[KEY] = () => document.removeEventListener("keydown", onKey, true);
}
