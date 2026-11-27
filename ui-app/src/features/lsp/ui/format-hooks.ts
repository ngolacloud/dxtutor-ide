/* ═════════ feature `lsp` — formatação no editor (Shift+Alt+F) ═════════
   No editor, Shift+Alt+F formata pelo servidor de linguagem: o documento, ou só a selecção.
   A tecla é apanhada na fase de CAPTURA do `document`. Os atalhos globais (`features/shortcuts.ts`,
   que a ligam ao «Format Document» do dxtutor) registam-se antes no mesmo nó, por isso correriam
   primeiro: cedem-na quando `services.lspFormat` (a raiz de composição) diz que este está ligado
   (LSP P5). Quando não há servidor, ou ele não formata o documento, corre o formatador do dxtutor.
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
