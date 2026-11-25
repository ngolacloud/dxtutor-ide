/* ═══════════ feature `debug` — ui: the floating toolbar and the exception card in the editor (r23 F2) ═══════════
   UI-DBG-07: `#dbg-tb` floats over the editor (top centre of `#ebody`) while a session runs; the
   grip drags it (the place is kept until the page reloads). UI-DBG-09: `#dbg-exc` is the exception
   helper, inside the editor's `.ed-wrap` (positioned) under the line that panicked — the same
   technique as the comments box — so it scrolls with the code and survives repaints of
   `#ed-hl`. UI-DBG-11: the console's input keys (Enter evaluates, ↑/↓ walk the history).
   DOM only: the markup comes from `dbgx-view.ts`, the actions go through the delegated listener. */

import { onResize, viewport } from "../infrastructure/legacy-bridge";

let dragged: { x: number; y: number } | null = null;
let wired = false;

function place(tb: HTMLElement): void {
  const eb = document.getElementById("ebody");
  if (!eb || !eb.offsetWidth) { tb.style.display = "none"; return; }
  tb.style.display = "flex";
  if (dragged) { tb.style.left = `${dragged.x}px`; tb.style.top = `${dragged.y}px`; return; }
  const r = eb.getBoundingClientRect();
  tb.style.top = `${r.top + 6}px`;
  tb.style.left = `${Math.max(r.left + 4, r.left + r.width / 2 - tb.offsetWidth / 2)}px`;
}

function wire(): void {
  if (wired) return;
  wired = true;
  onResize(() => { const tb = document.getElementById("dbg-tb"); if (tb) place(tb); });
  document.addEventListener("pointerdown", (e) => {
    const grip = (e.target as HTMLElement | null)?.closest("#dbg-tb .grip");
    const tb = document.getElementById("dbg-tb");
    if (!grip || !tb) return;
    e.preventDefault();
    const r = tb.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m: PointerEvent): void => {
      const vp = viewport();
      dragged = { x: Math.max(0, Math.min(vp.w - r.width, m.clientX - dx)), y: Math.max(0, Math.min(vp.h - r.height, m.clientY - dy)) };
      place(tb);
    };
    const up = (): void => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

/** Shows the toolbar with this inside (null: removes it). */
export function renderToolbar(html: string | null): void {
  let tb = document.getElementById("dbg-tb");
  if (html === null) { tb?.remove(); return; }
  wire();
  if (!tb) {
    tb = document.createElement("div");
    tb.id = "dbg-tb";
    tb.setAttribute("role", "toolbar");
    document.body.appendChild(tb);
  }
  tb.innerHTML = html;
  place(tb);
}

const lineHeight = (): number => {
  const ta = document.getElementById("ed-ta");
  const lh = ta ? parseFloat(getComputedStyle(ta).lineHeight) : NaN;
  return lh > 0 ? lh : 22;
};

/** Shows the exception card under `line` of the file in the editor (null: removes it). */
export function renderExceptionCard(html: string | null, line: number): void {
  const wrap = document.getElementById("ed-ta")?.parentElement ?? null;
  let el = document.getElementById("dbg-exc");
  if (html === null || !wrap) { el?.remove(); return; }
  if (el && el.parentElement !== wrap) { el.remove(); el = null; }
  if (!el) {
    el = document.createElement("div");
    el.id = "dbg-exc";
    el.setAttribute("role", "alert");
    wrap.appendChild(el);
  }
  el.innerHTML = html;
  el.style.top = `${line * lineHeight() + 4}px`;
}

/** The console's keys: Enter evaluates the input, ↑/↓ put the history in it. */
export function bindConsoleKeys(h: { evaluate(expr: string): void; history(dir: -1 | 1): string }): void {
  const doc = document as Document & { __dbgConKeys__?: EventListener };
  if (doc.__dbgConKeys__) document.removeEventListener("keydown", doc.__dbgConKeys__);
  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const inp = e.target as HTMLInputElement | null;
    if (!inp || inp.id !== "dbg-con-in") return;
    if (e.key === "Enter") { e.preventDefault(); const v = inp.value; inp.value = ""; h.evaluate(v); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); inp.value = h.history(e.key === "ArrowUp" ? -1 : 1); }
  };
  doc.__dbgConKeys__ = onKey;
  document.addEventListener("keydown", onKey);
}
