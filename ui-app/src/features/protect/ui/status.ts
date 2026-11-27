/* ═══════════ feature `protect` — ui: the status bar's count (r23 F4a, UI-PLAT-08) ═══════════
   `#st-protect`, next to the tests' count: how many secrets left the requests to models (hidden
   while none). DOM only. */
import { esc } from "../../../core";

const SHIELD = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.5l5 2v4c0 3.2-2.2 5.6-5 6.9-2.8-1.3-5-3.7-5-6.9v-4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

export function drawStatus(total: number, label: string, title: string): void {
  let el = document.getElementById("st-protect");
  if (!el) {
    const anchor = document.getElementById("st-tests");
    if (!anchor) return;
    el = document.createElement("span");
    el.id = "st-protect";
    el.className = "si";
    anchor.insertAdjacentElement("afterend", el);
  }
  el.style.display = total > 0 ? "" : "none";
  el.innerHTML = total > 0 ? `${SHIELD} ${esc(label)}` : "";
  el.title = title;
}
