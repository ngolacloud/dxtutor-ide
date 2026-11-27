/* ═════════ feature `lsp` — a lista de sugestões (completion) ═════════
   Dona do DOM de `#lsp-complete`: uma linha por sugestão (tipo, nome, detalhe), a escolhida
   realçada, e por baixo o detalhe/documentação da escolhida. Clicar numa linha escolhe-a (o
   `mousedown` não tira o foco da textarea). A navegação por teclado é do `editor-hooks`. Uma lista de
   palavras (sem servidor, LSP P5) leva por cima uma linha a dizê-lo (`.lsp-c-note`).
   Não toca em `window`. */

import { kindGlyph, type CompletionItem } from "../domain/completion";

let items: CompletionItem[] = [];
let index = 0;
let onPick: ((item: CompletionItem) => void) | null = null;
/** a linha por cima da lista (a das palavras), ou nenhuma */
let note: string | undefined;

const el = (): HTMLElement | null => document.getElementById("lsp-complete");

export const completionOpen = (): boolean => !!el();

/** A sugestão escolhida (ou `null` se a lista está fechada). */
export const selectedCompletion = (): CompletionItem | null => (el() ? items[index] ?? null : null);

export function closeCompletions(): void {
  el()?.remove();
  items = [];
  onPick = null;
}

function render(): void {
  const box = el();
  if (!box) return;
  const list = document.createElement("div");
  list.className = "lsp-c-list";
  items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "lsp-c-row" + (i === index ? " on" : "");
    row.setAttribute("role", "option");
    const kind = document.createElement("span");
    kind.className = "lsp-c-kind";
    kind.textContent = kindGlyph(it.kind);
    const label = document.createElement("span");
    label.className = "lsp-c-label";
    label.textContent = it.label;
    const detail = document.createElement("span");
    detail.className = "lsp-c-detail";
    detail.textContent = it.detail;
    row.append(kind, label, detail);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault(); // a textarea mantém o foco (e o cursor)
      index = i;
      const pick = onPick;
      const item = items[i];
      closeCompletions();
      if (pick && item) pick(item);
    });
    list.appendChild(row);
  });
  const doc = document.createElement("div");
  doc.className = "lsp-c-doc";
  const cur = items[index];
  doc.textContent = cur ? [cur.detail, cur.documentation.split("\n")[0]].filter(Boolean).join(" — ") : "";
  if (note) {
    const head = document.createElement("div");
    head.className = "lsp-c-note";
    head.textContent = note;
    box.replaceChildren(head, list, doc);
  } else box.replaceChildren(list, doc);
  box.classList.toggle("lsp-words", !!note);
  list.children[index]?.scrollIntoView({ block: "nearest" });
}

/** Abre (ou actualiza) a lista junto a (x, y); `wordsNote`: é uma lista de palavras (sem servidor), com esta linha por cima. */
export function showCompletions(next: CompletionItem[], x: number, y: number, pick: (item: CompletionItem) => void, wordsNote?: string): void {
  let box = el();
  if (!box) {
    box = document.createElement("div");
    box.id = "lsp-complete";
    box.className = "lsp-pop lsp-complete";
    box.setAttribute("role", "listbox");
    document.body.appendChild(box);
    index = 0;
  }
  const keep = items[index]?.label;
  items = next;
  index = Math.max(0, keep ? next.findIndex((i) => i.label === keep) : 0);
  onPick = pick;
  note = wordsNote;
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  render();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, r = box.getBoundingClientRect();
  if (r.right > vw - 8) box.style.left = `${Math.max(8, vw - r.width - 8)}px`;
  if (r.bottom > vh - 8) box.style.top = `${Math.max(8, y - r.height - 30)}px`;
}

/** Muda a escolhida (+1 / −1, dá a volta). */
export function moveCompletion(delta: number): void {
  if (!items.length) return;
  index = (index + delta + items.length) % items.length;
  render();
}
