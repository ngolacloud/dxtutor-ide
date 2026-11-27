/* ═══════════ feature `vault` — ui: a hidden field for a pasted token (r23 F4c) ═══════════
   One small dialog with a password input: the token goes to the backend once and is not kept here
   (the field is cleared when the dialog closes). DOM only. */
import { esc } from "../../../core";

export function askSecret(title: string, ok: string, cancel: string): Promise<string | null> {
  document.getElementById("vt-secret")?.remove();
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.id = "vt-secret";
    box.className = "dlg show";
    box.innerHTML = `<div class="dlg-box"><h2>${esc(title)}</h2><input id="vt-secret-in" class="inp" type="password" autocomplete="off" spellcheck="false"><div class="dlg-f"><button class="mini" id="vt-secret-no">${esc(cancel)}</button><button class="mini pri" id="vt-secret-ok">${esc(ok)}</button></div></div>`;
    document.body.appendChild(box);
    const input = box.querySelector("#vt-secret-in") as HTMLInputElement;
    const done = (v: string | null): void => { input.value = ""; box.remove(); resolve(v); };
    box.querySelector("#vt-secret-ok")!.addEventListener("click", () => done(input.value));
    box.querySelector("#vt-secret-no")!.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value); else if (e.key === "Escape") done(null); });
    setTimeout(() => input.focus(), 0);
  });
}
