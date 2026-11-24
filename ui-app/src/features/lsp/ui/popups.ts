/* ═════════ feature `lsp` — a lista de referências e a caixa de rename ═════════
   Dois cartões flutuantes junto ao cursor, donos do seu DOM (`#lsp-refs`, `#lsp-rename`):
     • referências (Shift+F12): uma linha por ocorrência (`ficheiro:linha` + o texto da linha);
       clicar, ou ↑/↓ + Enter, abre-a; Escape ou clicar fora fecha;
     • rename (F2): caixa com o nome actual seleccionado; Enter aplica, Escape cancela.
   Listeners ligados aos elementos (sem `onclick` inline). Não toca em `window`. */

import type { Reference } from "../application/lsp-client";

const CLOSERS = new Map<string, () => void>();

function floating(id: string, cls: string, x: number, y: number): HTMLElement {
  closePopup(id);
  const el = document.createElement("div");
  el.id = id;
  el.className = cls;
  document.body.appendChild(el);
  const place = (): void => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
    el.style.top = `${y + r.height > vh - 8 ? Math.max(8, y - r.height - 30) : y}px`;
  };
  queueMicrotask(place);
  return el;
}

/** Fecha um cartão (e larga os seus listeners globais). */
export function closePopup(id: string): void {
  CLOSERS.get(id)?.();
  CLOSERS.delete(id);
  document.getElementById(id)?.remove();
}

/** A lista de referências junto a (x, y). `onPick` recebe a referência escolhida. */
export function showReferences(refs: readonly Reference[], x: number, y: number, onPick: (r: Reference) => void, onClose: () => void): void {
  const el = floating("lsp-refs", "lsp-pop lsp-refs", x, y);
  const head = document.createElement("div");
  head.className = "lsp-pop-h";
  const files = new Set(refs.map((r) => r.label)).size;
  head.textContent = refs.length ? `${refs.length} reference${refs.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` : "No references found";
  el.appendChild(head);
  const rows: HTMLButtonElement[] = refs.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lsp-ref";
    b.disabled = !r.key;
    const where = document.createElement("span");
    where.className = "lsp-ref-w";
    where.textContent = `${r.label}:${r.line}`;
    const what = document.createElement("span");
    what.className = "lsp-ref-t";
    what.textContent = r.key ? r.preview : "outside this folder";
    b.append(where, what);
    b.addEventListener("click", () => {
      closePopup("lsp-refs");
      onPick(r);
    });
    el.appendChild(b);
    return b;
  });
  const enabled = rows.filter((b) => !b.disabled);
  enabled[0]?.focus();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup("lsp-refs");
      onClose();
      return;
    }
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = enabled.length;
      if (n) enabled[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n].focus();
    }
  };
  const onDown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) closePopup("lsp-refs");
  };
  el.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDown, true);
  CLOSERS.set("lsp-refs", () => document.removeEventListener("mousedown", onDown, true));
}

/** A caixa de rename junto a (x, y), com `placeholder` seleccionado. */
export function showRenameBox(placeholder: string, x: number, y: number, onSubmit: (name: string) => void, onClose: () => void): void {
  const el = floating("lsp-rename", "lsp-pop lsp-rename", x, y);
  const input = document.createElement("input");
  input.className = "inp notr";
  input.value = placeholder;
  input.spellcheck = false;
  input.setAttribute("aria-label", "New name");
  const hint = document.createElement("div");
  hint.className = "lsp-pop-hint";
  hint.textContent = "Enter to rename · Esc to cancel";
  el.append(input, hint);
  input.focus();
  input.select();
  let done = false;
  const finish = (name: string | null): void => {
    if (done) return;
    done = true;
    closePopup("lsp-rename");
    onClose();
    if (name !== null && name.trim() && name.trim() !== placeholder) onSubmit(name.trim());
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  });
  input.addEventListener("blur", () => finish(null));
}
