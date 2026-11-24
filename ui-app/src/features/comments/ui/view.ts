/* ═════════ feature `comments` — vista: o botão na margem e a caixa «Start discussion» ═════════
   Os dois vivem dentro da `.ed-wrap` do editor (posicionada), fora do `#ed-gut` e do `#ed-hl` que o
   `paintEd` redesenha a cada tecla — por isso sobrevivem aos redesenhos e não apanham os cliques
   de breakpoint da margem (features/debug). A caixa flutua por baixo da linha (a `textarea` do
   editor não deixa empurrar linhas); uma faixa marca as linhas comentadas. As acções vão pelo
   despachante partilhado (`comments:*`, app/actions.ts). */

import { esc } from "../../../core";
import type { OpenComment } from "../application/line-comments";
import type { CommentKey } from "./messages";

type T = (k: CommentKey, p?: Record<string, string | number>) => string;

const ICON_COMMENT =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 3h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7l-3 2.5v-2.5H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const wrap = (): HTMLElement | null => (document.getElementById("ed-ta")?.parentElement as HTMLElement | null) ?? null;

/** Altura de linha do editor (a da `textarea`; 22px no tema). */
export function lineHeight(): number {
  const ta = document.getElementById("ed-ta");
  const lh = ta ? parseFloat(getComputedStyle(ta).lineHeight) : NaN;
  return lh > 0 ? lh : 22;
}

function ensure(id: string, cls: string): HTMLElement | null {
  const w = wrap();
  if (!w) return null;
  let el = document.getElementById(id);
  if (el && el.parentElement !== w) {
    el.remove();
    el = null;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = cls;
    w.appendChild(el);
  }
  return el;
}

/** O botão de comentar, à altura da linha `line`. */
export function showButton(line: number, t: T): void {
  const el = ensure("cmt-gutter", "cmt-gutter notr");
  if (!el) return;
  const lh = lineHeight();
  el.style.top = `${(line - 1) * lh}px`;
  el.style.height = `${lh}px`;
  const title = t("commentLine", { line });
  if (el.dataset.line !== String(line)) {
    el.dataset.line = String(line);
    el.innerHTML = `<button class="cmt-btn" type="button" title="${esc(title)}" aria-label="${esc(title)}" data-action="comments:open" data-on="${line}">${ICON_COMMENT}</button>`;
  }
  el.hidden = false;
}

export function hideButton(): void {
  const el = document.getElementById("cmt-gutter");
  if (el) el.hidden = true;
}

/** Abre a caixa por baixo da última linha comentada e põe o foco no texto. */
export function openBox(c: OpenComment, t: T): HTMLTextAreaElement | null {
  const band = ensure("cmt-band", "cmt-band");
  const box = ensure("cmt-box", "cmt-box notr");
  if (!band || !box) return null;
  const lh = lineHeight();
  band.style.top = `${(c.range.from - 1) * lh}px`;
  band.style.height = `${(c.range.to - c.range.from + 1) * lh}px`;
  band.hidden = false;
  const body = document.getElementById("ebody");
  box.style.top = `${c.range.to * lh + 2}px`;
  box.style.width = `${Math.max(280, Math.min(760, (body?.clientWidth ?? 800) - 96))}px`;
  const where = c.range.to > c.range.from ? t("commentLines", { from: c.range.from, to: c.range.to }) : t("commentLine", { line: c.range.from });
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", where);
  box.innerHTML = `<div class="cmt-head"><span class="cmt-title">${esc(t("title"))}</span><span class="cmt-where" title="${esc(where)}">${esc(c.label)}</span><button class="cmt-del" type="button" title="${esc(t("discard"))}" aria-label="${esc(t("discard"))}" data-action="comments:discard">${ICON_TRASH}</button></div>
<textarea class="cmt-input" rows="4" spellcheck="true" placeholder="${esc(t("placeholder"))}"></textarea>
<div class="cmt-foot"><span class="cmt-hint">${esc(t("hint"))}</span><button class="mini pri cmt-add" type="button" disabled data-action="comments:add">${esc(t("add"))}</button></div>`;
  box.hidden = false;
  hideButton();
  const input = box.querySelector<HTMLTextAreaElement>(".cmt-input");
  input?.focus({ preventScroll: true });
  box.scrollIntoView?.({ block: "nearest" });
  return input;
}

export function closeBox(): void {
  for (const id of ["cmt-box", "cmt-band"]) {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      if (id === "cmt-box") el.innerHTML = "";
    }
  }
}

export const boxOpen = (): boolean => {
  const el = document.getElementById("cmt-box");
  return !!el && !el.hidden;
};

export const boxText = (): string => document.querySelector<HTMLTextAreaElement>("#cmt-box .cmt-input")?.value ?? "";

/** O botão «Add Comment to Chat» só fica activo com texto. */
export function syncAddButton(): void {
  const b = document.querySelector<HTMLButtonElement>("#cmt-box .cmt-add");
  if (b) b.disabled = !boxText().trim();
}
