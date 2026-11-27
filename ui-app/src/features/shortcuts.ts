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
import { codevAsk } from "../app/codev-ask";
import { closePal } from "./palette";
import { closeMenus } from "./menus";
import { openSettings } from "./codev";
import { nextProblem } from "./diagnostics";
import { vizFromEditor } from "./visualizer";
import { startDebug, dbgStop, dbgStep, dbgStepInto, toggleBp, dbgStepOut, dbgRunToCursor, dbgStepBack, dbgReverseContinue, dbgRestart } from "./debug";
import { explainCmd, reviewCmd } from "./codereview";
import { services } from "../app/services";
import { dxRun } from "./stack";

interface ShortcutGlobals {
  hoodCmd: () => void;
  goPane: (p: string) => void;
  tabOf: (id: string | null) => { path?: string } | undefined; cur: string | null;
  vsxFmt: () => void;
}
const G = window as unknown as ShortcutGlobals;

/** O foco está no editor de um ficheiro (a textarea da vista `file`, com a chave em `data-path`): aí o Ctrl+Shift+A
 *  é o Toggle Block Comment do editor (LSP P5), como no VS Code no Linux (noutro sítio abre o assistente), e o
 *  Shift+Alt+F é do formatador do servidor de linguagem quando ele está ligado. */
const inFileEditor = (e: KeyboardEvent): boolean => e.target instanceof HTMLTextAreaElement && e.target.id === "ed-ta" && !!e.target.dataset.path;

/** Instante em que se carregou Ctrl+K (0 = sem acorde pendente). */
let CHORD = 0;
const chordLabel = (t: string): void => { ($("#st-chord") as HTMLElement).textContent = t; };

document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey, go = (f: () => void): void => { e.preventDefault(); e.stopPropagation(); f(); };
  if (services.panel?.termOwnsKey(e)) return; /* foco num terminal real (features/panel): a tecla é da shell */
  if (CHORD && Date.now() - CHORD < 1600) {
    CHORD = 0; chordLabel("");
    if (k === "e") return go(() => explainCmd()); if (k === "r") return go(reviewCmd); if (k === "u") return go(G.hoodCmd);
    if (k === "d") return go(() => startDebug()); if (k === "v") return go(() => vizFromEditor());
  }
  if (c && !e.shiftKey && !e.altKey && k === "i" && codevAsk.available()) return go(() => codevAsk.fromEditor());
  if (c && !e.shiftKey && !e.altKey && k === "k") { go(() => { CHORD = Date.now(); chordLabel("(Ctrl+K) waiting for second key…"); }); return; }
  /* r23 F2 (UI-DBG-07): Ctrl+Shift+F5 restart, Shift+F11 step out, Ctrl+F10 run to cursor, Shift+F10 step back,
     Shift+F9 reverse continue — antes dos F5/F9/F10 simples, que não olham para os modificadores */
  if (e.key === "F5" && c && e.shiftKey) return go(() => { void dbgRestart(); }); if (e.key === "F11" && e.shiftKey) return go(() => { void dbgStepOut(); });
  if (e.key === "F10" && c) return go(() => { void dbgRunToCursor(); }); if (e.key === "F10" && e.shiftKey) return go(() => { void dbgStepBack(); }); if (e.key === "F9" && e.shiftKey) return go(() => { void dbgReverseContinue(); });
  if (e.key === "F5" && c) return go(dxRun); if (e.key === "F5" && e.shiftKey) return go(dbgStop);
  if (e.key === "F5") return go(() => startDebug()); if (e.key === "F10") return go(dbgStep); if (e.key === "F11") return go(dbgStepInto);
  if (e.key === "F9") { const t = G.tabOf(G.cur), ta = $("#ed-ta") as HTMLTextAreaElement | null; if (t && t.path && ta) go(() => toggleBp(t.path as string, ta.value.slice(0, ta.selectionStart).split("\n").length)); return; }
  if (c && e.shiftKey && k === "d") return go(() => G.goPane("debug")); if (c && e.shiftKey && k === "x") return go(() => G.goPane("ext")); if (c && e.shiftKey && k === "t") return go(() => G.goPane("tasks"));
  /* Format Document do dxtutor, sempre (era só com o «Prettier» instalado — ADR-0006, R6b). No editor de um ficheiro, com o
     formatador do servidor de linguagem ligado (desktop com pasta), a tecla é dele — que cai neste quando não há servidor
     (LSP P5; antes corriam os dois: este primeiro, porque o listener dele vem depois deste no mesmo nó) */
  if (e.shiftKey && e.altKey && k === "f") { if (inFileEditor(e) && services.lspFormat?.handles()) return; return go(() => G.vsxFmt()); }
}, true);

export {};

/* ───── os atalhos globais que viviam no app.ts (ADR-0004, U4j5a) ─────
   F1/Ctrl+Shift+P, F8, Ctrl+Shift+E/F/G/M/A, Ctrl+P/B/J/`/,/L/G/S e o Escape (fecha a paleta, os menus e as
   notificações). Listener de captura no document, registado a seguir ao de cima — entre este módulo e o app.ts
   nenhum outro regista teclado, por isso a ordem dos dois é a mesma; as teclas tratadas são disjuntas. Cada
   acção lê a função publicada no acto (fachada `KW`), como o app.ts fazia por nome livre. Os `go(f)` com uma
   referência (nextProblem, toggleSide, …) lêem-na ao premir, como o original (que resolvia o global ao premir). */
const KW = window as unknown as {
  CMD: [string, string, () => unknown][];
  closePal: () => void; palette: (q: string) => void;
  goPane: (p: string) => void; setPanelTab: (pt: string) => void; toggleSide: () => void; togglePanel: () => void;
  focusAgent: () => void; toast: (m: string) => void;
};
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey,go=(f: () => unknown)=>{e.preventDefault();f();};const cmd=(l: string)=>()=>KW.CMD.find(x=>x[0]===l)![2]();
  if(services.panel?.termOwnsKey(e))return;/* foco num terminal real (features/panel): a tecla é da shell */
  if(e.key==='Escape'){if($('#pal')!.classList.contains('show'))closePal();closeMenus();$('#notes')!.classList.remove('show');return;}
  if(e.key==='F1'||(c&&e.shiftKey&&k==='p'))go(()=>KW.palette('>'));else if(e.key==='F8')go(nextProblem);
  else if(c&&e.shiftKey){if(k==='e')go(()=>KW.goPane('explorer'));else if(k==='f')go(cmd('Ver: Pesquisa'));else if(k==='g')go(()=>KW.goPane('scm'));else if(k==='m')go(()=>KW.setPanelTab('problems'));else if(k==='a'&&!inFileEditor(e))go(()=>KW.goPane('codev'));}
  else if(c){if(k==='p')go(()=>KW.palette(''));else if(k==='b')go(KW.toggleSide);else if(k==='j')go(KW.togglePanel);else if(k==='`')go(()=>KW.setPanelTab('terminal'));else if(k===',')go(openSettings);else if(k==='l')go(()=>KW.focusAgent());else if(k==='g')go(()=>KW.palette(':'));else if(k==='s')go(()=>KW.toast('Auto Save activo — já está guardado'));}
},true);
