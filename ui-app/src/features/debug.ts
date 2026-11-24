/* ═════════ dxtutor IDE — feature: Run and Debug (resíduo + composição) ═════════
   Feature DONA dos breakpoints (`BPS`), da entrada «Start debugging» e do render do pane
   «Run and Debug» (`renderDebugPane`) e do assistente (`drawDbg`, #pc-dbg).

   ADR-0002 (Clean Architecture): `window.*` confinado a
   `features/debug/infrastructure/legacy-bridge.ts`; as chaves de breakpoint são domínio
   puro (`features/debug/domain/breakpoints.ts`); os casos de uso vivem em
   `features/debug/application/debug-engine.ts`, com deps por porta. Este ficheiro COMPÕE
   o motor com os adaptadores do bridge, é DONO do estado (BPS) e do DOM e RE-PUBLICA a
   superfície no `window`. As acções do markup são `data-action`+`data-on`, servidas por
   um só listener delegado (`features/debug/ui/actions.ts`).

   ADR-0006, R1c2: sem sessões simuladas. Saíram o passo-a-passo guionado do lexer de
   demonstração (a oferta do `.clone()` do rustc, variáveis/watch/call stack inventados),
   as sondas `kubectl` inventadas a um pod em crash, os lançadores derivados dos
   ambientes simulados, e os helpers `lexVariant`/`LXL`. Não há adaptador de depuração
   ligado: o pane e o assistente dizem-no, e os breakpoints (reais, persistidos) ficam à
   espera do DAP (R4). No desktop com pasta aberta, o painel (features/panel) desenha no
   #pc-dbg o assistente real (comandos falhados e erros do workspace).

   Mecânica: avalia ANTES de `app.ts`/`v6.ts` (ordem do index.html). Nada é lido
   ansiosamente no eval — `BPS` nasce Set vazio e hidrata de `LS` PREGUIÇOSAMENTE
   (`hydrateBps`, guard-once) na primeira entrada. */

import { $, hd, svg, esc, toast } from "../core";
import { RP } from "../app/store/registry";
import { bpLine, bpPath } from "./debug/domain/breakpoints";
import { makeDebugEngine } from "./debug/application/debug-engine";
import { bindActions, type ActionTable } from "./debug/ui/actions";
import {
  breakpoints, currentTab, pane, goPane, openPath, paintEd, setPanelTab, panes, lsGet, lsSet, publish,
} from "./debug/infrastructure/legacy-bridge";

/* ───── estado (window-backed; o editor lê-o pela fachada `dbgBreaks`) ───── */
const BPS = breakpoints();
let _bpsHydrated = false;
/** Restaura os breakpoints persistidos de `LS` uma única vez. Preguiçoso porque este
 *  módulo avalia antes de app.ts definir `LS`; chamado nas entradas (drawDbg/startDebug
 *  /toggleBp/renderDebugPane), garantindo o Set populado antes do primeiro paintEd. */
function hydrateBps(): void { if (_bpsHydrated) return; _bpsHydrated = true; try { (lsGet<string[]>("bps6", []) || []).forEach((b) => BPS.add(b)); } catch (e) { /* LS ainda não pronto */ } }
const saveBps = (): void => lsSet("bps6", [...BPS]);

/* ───── DOM: o assistente (#pc-dbg) e o pane (#pane-debug) ───── */
function drawDbg(): void {
  hydrateBps(); const el = $("#pc-dbg"); if (!el) return;
  el.innerHTML = `<div class="dbg-empty">${svg("bug")}<div><b>Debug assistant</b><p>No debugger attached. When a debug adapter is connected, the assistant reads the real frames and variables of the session. With a folder open in the desktop app, this panel lists the commands that failed and the errors in the workspace.</p></div></div>`;
}
function refreshDbg(): void { drawDbg(); if (pane() === "debug") panes().debug(); }

/** Renderiza o pane «Run and Debug»: o estado do depurador e os breakpoints. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug");
  if (!el) return;
  el.innerHTML = hd("Run and Debug", "") + `<div class="sections"><div class="sec-empty">No debugger attached. Stepping through code needs a debug adapter (lldb, delve or debugpy, over the Debug Adapter Protocol), which this version does not connect yet. The breakpoints you set are kept for when it does.</div>
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${[...BPS].map((b) => { const l = bpLine(b), p = bpPath(b); return `<div class="scm-row" data-action="open-bp" data-on="${esc(b)}"><span class="bpd"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span><span class="ra" style="display:flex"><button data-action="bp-del" data-on="${esc(b)}">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}</div>`;
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) + as funções de
   desenho (resíduo) às portas do motor (application). ───── */
const engine = makeDebugEngine({
  store: { breakpoints: () => BPS, hydrate: () => hydrateBps(), save: () => saveBps() },
  editor: { currentTab: () => currentTab(), paintEd: (p) => paintEd(p) },
  shell: { goPane: (p) => goPane(p), setPanelTab: (pt, nf) => setPanelTab(pt, nf) },
  view: { refresh: () => refreshDbg() },
  notifier: { toast: (m) => toast(m) },
});
const { startDebug, dbgStep, dbgStop, toggleBp } = engine;

/* clique no gutter do editor alterna o breakpoint da linha (índice do div na coluna) */
document.addEventListener("click", (e) => { const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return; const t = currentTab(); if (!t || !t.path || t.kind !== "file") return; toggleBp(t.path, [...g.parentElement!.children].indexOf(g) + 1); });

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` por renderDebugPane) ao efeito,
   servido pelo listener delegado de `ui/actions.ts`. O payload viaja SÓ em `data-on`
   (o golden strippa data-action/data-on), escapado com `esc` à saída.
     • open-bp/bp-del — breakpoints (data-on=chave `path:line`) */
const ACTIONS: ActionTable = {
  "open-bp": { on: "click", run: (e) => openPath(bpPath(e.on), +bpLine(e.on)) },
  "bp-del": { on: "click", run: (e) => { BPS.delete(e.on); saveBps(); refreshDbg(); } },
};
bindActions(ACTIONS);

/* registo do painel (ADR-0004, U4g1 — antes era um shim no v6.ts) */
RP.debug = renderDebugPane;

/* ── publicação no window (via bridge) ──
   • `renderDebugPane` — o renderer do painel (registado acima em RP.debug).
   • `startDebug`/`dbgStep`/`dbgStop`/`toggleBp`/`drawDbg` — o keydown
     (features/shortcuts.ts), os menus/CMD e o boot6 de v6.ts e a barra de acções do
     editor (features/tabs.ts) resolvem-nos por nome livre ao disparar.
   • `dbgBreaks` (Set) — a fachada que o editor lê para pintar os breakpoints. */
publish({
  renderDebugPane,
  dbgBreaks: BPS,
  startDebug, dbgStep, dbgStop, toggleBp, drawDbg, saveBps,
});
