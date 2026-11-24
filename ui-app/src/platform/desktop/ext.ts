/* ═════════ dxtutor IDE — desktop: extensões (JSZip embutido) (ADR-0004, U4h1) ═════════
   No desktop o JSZip vem com a app (jszip.min.js), em vez de um CDN. Era a secção
   «extensions» do bridge.ts, verbatim; é a porta `desktopPorts.ext` (U4h5b). */

import { desktopPorts } from "../../app/desktop";


export function installExt(): void {
/* ───── extensions: JSZip ships with the app ───── */
desktopPorts.ext = { loadJSZip() {
  return window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "jszip.min.js";
    s.onload = () => ok(window.JSZip);
    s.onerror = () => no(new Error("jszip.min.js missing"));
    document.head.appendChild(s);
  });
} };
}
