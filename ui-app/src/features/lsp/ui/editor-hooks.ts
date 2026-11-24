/* ═════════ feature `lsp` — ganchos no editor (hover e «ir para a definição») ═════════
   Listeners delegados no `document`, filtrados pela textarea do editor (`#ed-ta`), para
   não mexer no `editor.ts`:
     • rato parado sobre um símbolo (~450 ms) → hover num cartão junto ao cursor;
     • F12, ou Ctrl/⌘+clique → definição do símbolo no cursor;
     • Shift+F12 → lista de referências; F2 → caixa de rename (`ui/popups.ts`);
     • Escape, escrever, deslocar ou sair da textarea → fecha o cartão.
   Dono do DOM do cartão (`#lsp-hover`). Não toca em `window`. */

import { offsetAtPoint, pointOfOffset, type EditorMetrics } from "../domain/positions";
import type { HoverBlock } from "../domain/results";
import type { Reference, RenameResult, RenameTarget } from "../application/lsp-client";
import { closePopup, showReferences, showRenameBox } from "./popups";

export interface EditorHooksDeps {
  hoverAt(offset: number): Promise<HoverBlock[]>;
  definitionAt(offset: number): Promise<void>;
  referencesAt(offset: number): Promise<Reference[] | null>;
  prepareRenameAt(offset: number): Promise<RenameTarget | null>;
  renameAt(offset: number, newName: string): Promise<RenameResult | null>;
  /** Abre uma referência escolhida na lista. */
  openReference(r: Reference): void;
  /** Só activo com uma pasta real aberta (no workspace de exemplo não há servidor). */
  enabled(): boolean;
}

const HOVER_DELAY_MS = 450;
const KEY = "__lspEditorHooks__";

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

/** Altura de linha e largura de carácter da textarea (fonte monoespaçada). */
function metricsOf(ta: HTMLTextAreaElement): EditorMetrics {
  const cs = getComputedStyle(ta);
  const lineHeight = parseFloat(cs.lineHeight) || 22;
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font};font-family:${cs.fontFamily};font-size:${cs.fontSize}`;
  document.body.appendChild(probe);
  const charWidth = probe.getBoundingClientRect().width / 100 || 7.8;
  probe.remove();
  return { lineHeight, charWidth, tabSize: parseInt(cs.tabSize, 10) || 4 };
}

function card(): HTMLElement {
  let el = document.getElementById("lsp-hover");
  if (!el) {
    el = document.createElement("div");
    el.id = "lsp-hover";
    el.className = "lsp-hover hidden";
    document.body.appendChild(el);
  }
  return el;
}

function hideCard(): void {
  document.getElementById("lsp-hover")?.classList.add("hidden");
}

/** Mostra os blocos do hover junto ao ponto (x, y) do ecrã. */
export function showHover(blocks: HoverBlock[], x: number, y: number): void {
  const el = card();
  el.replaceChildren(
    ...blocks.map((b) => {
      const n = document.createElement(b.code ? "pre" : "div");
      n.className = b.code ? "lsp-code" : "lsp-text";
      n.textContent = b.text;
      return n;
    }),
  );
  el.classList.remove("hidden");
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
  el.style.top = `${y + 18 + r.height > vh ? Math.max(8, y - r.height - 8) : y + 18}px`;
}

/** Instala os listeners. Idempotente: uma segunda chamada substitui a primeira. */
export function bindEditorHooks(d: EditorHooksDeps): void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    seq++;
  };

  const onMove = (e: MouseEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    cancel();
    hideCard();
    const ta = e.target, x = e.clientX, y = e.clientY, mine = seq;
    timer = setTimeout(() => {
      const r = ta.getBoundingClientRect();
      const offset = offsetAtPoint(ta.value, x - r.left, y - r.top, metricsOf(ta));
      if (offset == null) return;
      void d.hoverAt(offset).then((blocks) => {
        if (mine === seq && blocks.length) showHover(blocks, x, y);
      });
    }, HOVER_DELAY_MS);
  };
  const onLeave = (e: MouseEvent): void => {
    if (isEditor(e.target)) {
      cancel();
      hideCard();
    }
  };
  /** Canto do carácter `offset` no ecrã (para abrir os cartões junto ao cursor). */
  const screenPoint = (ta: HTMLTextAreaElement, offset: number): { x: number; y: number } => {
    const r = ta.getBoundingClientRect(), m = metricsOf(ta), p = pointOfOffset(ta.value, offset, m);
    return { x: r.left + p.x, y: r.top + p.y + m.lineHeight + 4 };
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!isEditor(e.target)) return;
    cancel();
    hideCard();
    if (!d.enabled()) return;
    const ta = e.target, caret = ta.selectionStart;
    if (e.key === "F12" && !e.shiftKey) {
      e.preventDefault();
      void d.definitionAt(caret);
    } else if (e.key === "F12" && e.shiftKey) {
      e.preventDefault();
      void d.referencesAt(caret).then((refs) => {
        if (!refs) return;
        const p = screenPoint(ta, caret);
        showReferences(refs, p.x, p.y, (r) => d.openReference(r), () => ta.focus());
      });
    } else if (e.key === "F2") {
      e.preventDefault();
      void d.prepareRenameAt(caret).then((t) => {
        if (!t) return;
        const p = screenPoint(ta, t.start);
        showRenameBox(t.placeholder, p.x, p.y, (name) => void d.renameAt(caret, name), () => ta.focus());
      });
    }
  };
  const onClick = (e: MouseEvent): void => {
    if (!isEditor(e.target) || !(e.ctrlKey || e.metaKey) || !d.enabled()) return;
    cancel();
    hideCard();
    // o clique já pôs o cursor no símbolo clicado
    void d.definitionAt(e.target.selectionStart);
  };
  const onScroll = (): void => {
    cancel();
    hideCard();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseout", onLeave);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  document.addEventListener("scroll", onScroll, true);
  doc[KEY] = () => {
    cancel();
    closePopup("lsp-refs");
    closePopup("lsp-rename");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseout", onLeave);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
    document.removeEventListener("scroll", onScroll, true);
  };
}
