/* ═════════ feature `lsp` — completion no editor (teclado) ═════════
   Quando abre a lista:
     • Ctrl+Espaço (pedido explícito);
     • sozinha, ao escrever: depois de `.` ou com ≥ 2 letras de um nome (com uma pausa curta).
   Com a lista aberta: escrever filtra-a (e volta a perguntar se o servidor disse que a lista
   era parcial); ↑/↓ escolhem; Enter ou Tab aceitam; Escape fecha. Estas teclas são apanhadas
   na fase de CAPTURA do `document`, antes do `onkeydown` do editor (que usaria o Tab para
   indentar ou para os snippets das extensões). Aceitar aplica o item ao texto da textarea e
   dispara `input` — o editor actualiza o `FS`, repinta, e o servidor recebe o `didChange`.
   Sem sugestões do servidor (não há servidor, ou respondeu sem nenhuma), as palavras dos ficheiros
   abertos (LSP P5, `words`): a mesma lista e as mesmas teclas, com uma linha a dizer que são palavras;
   nunca se juntam às do servidor. Uma palavra igual ao que já está escrito não aparece.
   Não toca em `window`. */

import { applyCompletion, autoTrigger, filterCompletions, type CompletionItem } from "../domain/completion";
import { pointOfOffset } from "../domain/positions";
import type { CompletionResult } from "../application/lsp-client";
import { metricsOf } from "./editor-hooks";
import { closeCompletions, completionOpen, moveCompletion, selectedCompletion, showCompletions } from "./completion-view";

export interface CompletionHooksDeps {
  completionAt(offset: number, triggerCharacter: string | null): Promise<CompletionResult | null>;
  enabled(): boolean;
  /** LSP P5: as palavras dos ficheiros abertos para o nome que acaba em `offset` de `text`, quando o
   *  servidor não sugere nada (`explicit`: Ctrl+Espaço) */
  words?(text: string, offset: number, explicit: boolean): CompletionResult | null;
  /** a linha por cima da lista de palavras */
  wordsNote?(): string;
}

const KEY = "__lspCompletionHooks__";
const AUTO_DELAY_MS = 180;

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

/** Instala os listeners. Idempotente. */
export function bindCompletionHooks(d: CompletionHooksDeps): void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();

  /** A sessão aberta: as sugestões do servidor e onde começa o nome a completar. */
  let session: { all: CompletionItem[]; incomplete: boolean; wordStart: number; words: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let applying = false;

  const close = (): void => {
    session = null;
    seq++;
    if (timer) clearTimeout(timer);
    timer = null;
    closeCompletions();
  };

  const place = (ta: HTMLTextAreaElement, offset: number): { x: number; y: number } => {
    const r = ta.getBoundingClientRect(), m = metricsOf(ta), p = pointOfOffset(ta.value, offset, m);
    return { x: r.left + p.x - 22, y: r.top + p.y + m.lineHeight + 2 };
  };

  /** Mostra as sugestões da sessão filtradas pelo que está escrito; fecha se não sobra nada. */
  const refresh = (ta: HTMLTextAreaElement): void => {
    if (!session) return;
    const caret = ta.selectionStart;
    if (caret < session.wordStart) return close();
    const prefix = ta.value.slice(session.wordStart, caret);
    if (/[^\p{L}\p{N}_$]/u.test(prefix)) return close();
    // uma palavra igual ao que já está escrito não acrescenta nada (e o Enter seria dela, não da linha nova)
    const shown = filterCompletions(session.all, prefix).filter((i) => !session!.words || i.label !== prefix);
    if (!shown.length) return close();
    const p = place(ta, session.wordStart);
    showCompletions(shown, p.x, p.y, (item) => accept(ta, item), session.words ? (d.wordsNote?.() ?? "") : undefined);
  };

  const request = async (ta: HTMLTextAreaElement, trigger: string | null, explicit = false): Promise<void> => {
    const mine = ++seq;
    const res = await d.completionAt(ta.selectionStart, trigger);
    if (mine !== seq || document.activeElement !== ta) return; // entretanto escreveu-se mais / saiu
    if (res && res.items.length) {
      session = { all: res.items, incomplete: res.incomplete, wordStart: res.wordStart, words: false };
      return refresh(ta);
    }
    // o servidor não sugeriu nada (ou não há servidor): as palavras dos ficheiros abertos
    const w = d.words?.(ta.value, ta.selectionStart, explicit) ?? null;
    if (!w || !w.items.length) return close();
    session = { all: w.items, incomplete: false, wordStart: w.wordStart, words: true };
    refresh(ta);
  };

  function accept(ta: HTMLTextAreaElement, item: CompletionItem): void {
    if (!session) return;
    const { text, caret } = applyCompletion(ta.value, item, ta.selectionStart, session.wordStart);
    close();
    applying = true;
    ta.value = text;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    applying = false;
  }

  const onInput = (e: Event): void => {
    if (!isEditor(e.target) || applying || !d.enabled()) return;
    const ta = e.target;
    if (session) {
      refresh(ta);
      if (session?.incomplete) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void request(ta, null), AUTO_DELAY_MS);
      }
      return;
    }
    const t = autoTrigger(ta.value, ta.selectionStart);
    if (!t) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void request(ta, t.trigger), AUTO_DELAY_MS);
  };

  const onKeyCapture = (e: KeyboardEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    const ta = e.target;
    if ((e.ctrlKey || e.metaKey) && (e.key === " " || e.code === "Space")) {
      e.preventDefault();
      e.stopPropagation();
      void request(ta, null, true);
      return;
    }
    if (!completionOpen()) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      stop();
      moveCompletion(e.key === "ArrowDown" ? 1 : -1);
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
      const item = selectedCompletion();
      if (!item) return close();
      stop();
      accept(ta, item);
    } else if (e.key === "Escape") {
      stop();
      close();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
      close();
    }
  };

  const onBlur = (e: FocusEvent): void => {
    if (isEditor(e.target)) close();
  };
  const onDown = (e: MouseEvent): void => {
    if (completionOpen() && !(e.target as HTMLElement | null)?.closest?.("#lsp-complete")) close();
  };

  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeyCapture, true);
  document.addEventListener("focusout", onBlur);
  document.addEventListener("mousedown", onDown, true);
  doc[KEY] = () => {
    close();
    document.removeEventListener("input", onInput);
    document.removeEventListener("keydown", onKeyCapture, true);
    document.removeEventListener("focusout", onBlur);
    document.removeEventListener("mousedown", onDown, true);
  };
}
