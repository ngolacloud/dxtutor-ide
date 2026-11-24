/* ═════════ dxtutor IDE — feature: atalhos globais do editor e do depurador (ADR-0004, U4g5) ═════════
   Os acordes Ctrl+K (E explain, R review, U under the hood, D debug, V visualize), F5/F9/
   F10/F11 (correr, breakpoint, passo), Ctrl+Shift+D/X/T (vistas Debug/Extensions/Tasks) e
   Shift+Alt+F (Format Document do dxtutor). Era o handler do v6.ts.

   Ordem: o listener é de captura no document. Avalia depois do visualizer (cujo listener,
   com o overlay aberto, faz stopImmediatePropagation) e antes do app.ts, cujo handler de
   captura trata teclas disjuntas destas (palette, vistas, painéis); o stopPropagation de
   cada um não impede o outro (mesmo nó), por isso a troca de ordem com o app.ts não muda o
   resultado. Os comandos resolvem-se pelo window no acto. */

import { $ } from "../core";

interface ShortcutGlobals {
  termOwnsKey?: (e: KeyboardEvent) => boolean;
  explainCmd: (deep?: boolean) => void; reviewCmd: () => void; hoodCmd: () => void;
  startDebug: (k?: string) => void; vizFromEditor: () => void;
  dxRun: () => void; dbgStop: () => void; dbgStep: () => void; dbgStepInto: () => void;
  toggleBp: (p: string, line: number) => void; goPane: (p: string) => void;
  tabOf: (id: string | null) => { path?: string } | undefined; cur: string | null;
  vsxFmt: () => void;
}
const G = window as unknown as ShortcutGlobals;

/** Instante em que se carregou Ctrl+K (0 = sem acorde pendente). */
let CHORD = 0;
const chordLabel = (t: string): void => { ($("#st-chord") as HTMLElement).textContent = t; };

document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey, go = (f: () => void): void => { e.preventDefault(); e.stopPropagation(); f(); };
  if (G.termOwnsKey && G.termOwnsKey(e)) return; /* foco num terminal real (features/panel): a tecla é da shell */
  if (CHORD && Date.now() - CHORD < 1600) {
    CHORD = 0; chordLabel("");
    if (k === "e") return go(() => G.explainCmd()); if (k === "r") return go(G.reviewCmd); if (k === "u") return go(G.hoodCmd);
    if (k === "d") return go(() => G.startDebug()); if (k === "v") return go(() => G.vizFromEditor());
  }
  if (c && !e.shiftKey && !e.altKey && k === "k") { go(() => { CHORD = Date.now(); chordLabel("(Ctrl+K) waiting for second key…"); }); return; }
  if (e.key === "F5" && c) return go(G.dxRun); if (e.key === "F5" && e.shiftKey) return go(G.dbgStop);
  if (e.key === "F5") return go(() => G.startDebug()); if (e.key === "F10") return go(G.dbgStep); if (e.key === "F11") return go(G.dbgStepInto);
  if (e.key === "F9") { const t = G.tabOf(G.cur), ta = $("#ed-ta") as HTMLTextAreaElement | null; if (t && t.path && ta) go(() => G.toggleBp(t.path as string, ta.value.slice(0, ta.selectionStart).split("\n").length)); return; }
  if (c && e.shiftKey && k === "d") return go(() => G.goPane("debug")); if (c && e.shiftKey && k === "x") return go(() => G.goPane("ext")); if (c && e.shiftKey && k === "t") return go(() => G.goPane("tasks"));
  if (e.shiftKey && e.altKey && k === "f") return go(() => G.vsxFmt()); /* Format Document do dxtutor, sempre (era só com o «Prettier» instalado — ADR-0006, R6b) */
}, true);

export {};
