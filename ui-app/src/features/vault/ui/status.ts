/* ═══════════ feature `vault` — ui: the status bar's token state (r23 F4c, UI-PLAT) ═══════════
   `#st-vault` after `#st-protect`/`#st-tests`: who is signed in and for how long, or that nobody is;
   hidden while no Vault is configured. A click opens the Vault tab. DOM only. */
import { esc } from "../../../core";

export function drawStatus(text: string, kind: string): void {
  let el = document.getElementById("st-vault");
  if (!el) {
    const anchor = document.getElementById("st-protect") ?? document.getElementById("st-tests");
    if (!anchor) return;
    el = document.createElement("span");
    el.id = "st-vault";
    el.className = "si";
    el.setAttribute("data-action", "vault:open-tab");
    anchor.insertAdjacentElement("afterend", el);
  }
  el.style.display = text ? "" : "none";
  el.className = `si vt-st-${kind}`;
  el.innerHTML = text ? `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg> ${esc(text)}` : "";
}
