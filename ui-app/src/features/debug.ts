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

   ADR-0006, R4: sessões REAIS pelo gdb do backend (`debug_*`, ver application/debug-engine.ts):
   o pane mostra os controlos, onde parou, as variáveis locais e a pilha; o editor pinta a linha
   corrente (`dbgCurrent`). O texto abaixo (R1c2) descreve o que saiu antes:
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
import { fsKeyFor, type Session } from "./debug/domain/session";
import { makeDebugEngine } from "./debug/application/debug-engine";
import { tauriDebug } from "./debug/infrastructure/tauri";
import { bindActions, type ActionTable } from "./debug/ui/actions";
import {
  breakpoints, currentTab, pane, goPane, openPath, paintEd, setPanelTab, panes, lsGet, lsSet, publish,
  root, fsRoot, content, fsKeys, exec, paletteChoose, paletteAsk,
} from "./debug/infrastructure/legacy-bridge";

/* ───── estado (window-backed; o editor lê-o pela fachada `dbgBreaks`) ───── */
const BPS = breakpoints();
let _bpsHydrated = false;
/** Restaura os breakpoints persistidos de `LS` uma única vez. Preguiçoso porque este
 *  módulo avalia antes de app.ts definir `LS`; chamado nas entradas (drawDbg/startDebug
 *  /toggleBp/renderDebugPane), garantindo o Set populado antes do primeiro paintEd. */
function hydrateBps(): void { if (_bpsHydrated) return; _bpsHydrated = true; try { (lsGet<string[]>("bps6", []) || []).forEach((b) => BPS.add(b)); } catch (e) { /* LS ainda não pronto */ } }
const saveBps = (): void => lsSet("bps6", [...BPS]);

/* ───── a sessão de depuração real (ADR-0006, R4) e a última mensagem para o pane ───── */
let SESSION: Session | null = null, MSG = "";

/** Onde o gdb parou, como chave do FS do editor (null fora da pasta ou sem sessão parada). */
function dbgCurrent(): { path: string; line: number } | null {
  const st = SESSION && SESSION.status === "stopped" ? SESSION.stop : null, r = root();
  const key = st && r ? fsKeyFor(st.file, r, fsRoot()) : null;
  return key && st ? { path: key, line: st.line } : null;
}

/* ───── DOM: o assistente (#pc-dbg) e o pane (#pane-debug) ───── */
function drawDbg(): void {
  hydrateBps(); const el = $("#pc-dbg"); if (!el) return;
  const st = SESSION && SESSION.stop;
  el.innerHTML = SESSION && st
    ? `<div class="dbg-empty">${svg("bug")}<div><b>Parado em ${esc(st.func || "?")}</b><p class="notr">${esc((st.file || "").split("/").pop() || "")}:${st.line} · ${esc(st.reason)}</p>${SESSION.locals.length ? `<p class="notr">${SESSION.locals.slice(0, 8).map((v) => `${esc(v.name)} = ${esc(v.value)}`).join("<br>")}</p>` : ""}</div></div>`
    : `<div class="dbg-empty">${svg("bug")}<div><b>Debug assistant</b><p>${SESSION ? "A executar…" : "Sem sessão de depuração. Põe breakpoints no gutter (F9) e carrega em F5: o gdb corre o programa e pára neles."} Com uma pasta aberta na app desktop, este painel mostra também os comandos que falharam e os erros do workspace.</p></div></div>`;
}
function refreshDbg(): void {
  drawDbg(); if (pane() === "debug") panes().debug();
  const t = currentTab(); if (t && t.path && t.kind === "file") paintEd(t.path);
}

/** Renderiza o pane «Run and Debug»: os controlos e o estado da sessão (onde parou, variáveis,
 *  pilha), a última mensagem e os breakpoints. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug");
  if (!el) return;
  const s = SESSION, st = s && s.stop;
  const ctl = s
    ? `<div class="dbg-ctl"><button title="Continue (F5)" data-action="continue"${s.status !== "stopped" ? " disabled" : ""}>▶</button><button title="Step over (F10)" data-action="step"${s.status !== "stopped" ? " disabled" : ""}>↷</button><button title="Step into (F11)" data-action="step-into"${s.status !== "stopped" ? " disabled" : ""}>↓</button><button title="Stop (Shift+F5)" data-action="stop">■</button><span class="notr">${esc(s.program.split("/").pop() || s.program)}</span></div>`
    : `<button class="btn" data-action="start">Start debugging (F5)</button>`;
  const where = s
    ? s.status === "stopped" && st
      ? `<div class="sec-empty notr">Parado em <b>${esc(st.func || "?")}</b> · ${esc((st.file || "").split("/").pop() || "")}:${st.line} (${esc(st.reason)})</div>`
        + `<div class="scm-grp">Variables<span class="cnt">${s.locals.length}</span></div>${s.locals.map((v) => `<div class="dv"><span class="k notr">${esc(v.name)}</span><span class="v notr">${esc(v.value)}</span></div>`).join("") || '<div class="sec-empty">Sem variáveis locais neste ponto.</div>'}`
        + `<div class="scm-grp">Call stack</div>${s.stack.map((f, i) => `<div class="dv${i ? "" : " top"}" data-action="open-frame" data-on="${esc(f.file)}:${f.line}"><span class="k notr">${esc(f.func)} · ${esc((f.file || "").split("/").pop() || "")}:${f.line}</span></div>`).join("")}`
      : `<div class="sec-empty">${s.status === "starting" ? "A arrancar o gdb…" : "A executar — à espera de um breakpoint ou do fim do programa…"}</div>`
    : `<div class="sec-empty">Depuração passo-a-passo com o gdb (Rust, C, C++): num projecto Cargo constrói e corre o binário; noutro, pergunta pelo executável. Põe breakpoints no gutter ou com F9.</div>`;
  const msg = MSG ? `<div class="sec-empty" style="white-space:pre-wrap">${esc(MSG)}</div>` : "";
  el.innerHTML = hd("Run and Debug", "") + `<div class="sections">${ctl}${msg}${where}
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${[...BPS].map((b) => { const l = bpLine(b), p = bpPath(b); return `<div class="scm-row" data-action="open-bp" data-on="${esc(b)}"><span class="bpd"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span><span class="ra" style="display:flex"><button data-action="bp-del" data-on="${esc(b)}">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}</div>`;
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) + as funções de
   desenho (resíduo) às portas do motor (application). ───── */
const engine = makeDebugEngine({
  store: {
    session: () => SESSION, setSession: (x) => { SESSION = x; }, setMessage: (m) => { MSG = m; },
    breakpoints: () => BPS, hydrate: () => hydrateBps(), save: () => saveBps(),
  },
  dbg: tauriDebug(),
  workspace: { root: () => root(), fsRoot: () => fsRoot(), content: (k) => content(k), keys: () => fsKeys(), exec: (c) => exec(c) },
  editor: { currentTab: () => currentTab(), openPath: (p, l) => openPath(p, l), paintEd: (p) => paintEd(p) },
  shell: { goPane: (p) => goPane(p), setPanelTab: (pt, nf) => setPanelTab(pt, nf) },
  picker: { choose: (t, items) => paletteChoose(t, items), ask: (t) => paletteAsk(t) },
  view: { refresh: () => refreshDbg() },
  notifier: { toast: (m) => toast(m) },
  newId: () => "dbg-" + Date.now().toString(36),
});
const { startDebug, dbgContinue, dbgStep, dbgStop, toggleBp } = engine;
const dbgStepInto = (): Promise<void> => dbgStep(true);

/* clique no gutter do editor alterna o breakpoint da linha (índice do div na coluna) */
document.addEventListener("click", (e) => { const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return; const t = currentTab(); if (!t || !t.path || t.kind !== "file") return; toggleBp(t.path, [...g.parentElement!.children].indexOf(g) + 1); });

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` por renderDebugPane) ao efeito,
   servido pelo listener delegado de `ui/actions.ts`. O payload viaja SÓ em `data-on`
   (o golden strippa data-action/data-on), escapado com `esc` à saída.
     • open-bp/bp-del — breakpoints (data-on=chave `path:line`) */
const ACTIONS: ActionTable = {
  start: { on: "click", run: () => { void startDebug(); } },
  continue: { on: "click", run: () => { void dbgContinue(); } },
  step: { on: "click", run: () => { void dbgStep(); } },
  "step-into": { on: "click", run: () => { void dbgStepInto(); } },
  stop: { on: "click", run: () => { void dbgStop(); } },
  /* uma linha da pilha: abre o ficheiro na linha, se for da pasta aberta */
  "open-frame": { on: "click", run: (e) => { const i = e.on.lastIndexOf(":"), r = root(), k = r ? fsKeyFor(e.on.slice(0, i), r, fsRoot()) : null; if (k && content(k) != null) openPath(k, +e.on.slice(i + 1)); } },
  "open-bp": { on: "click", run: (e) => openPath(bpPath(e.on), +bpLine(e.on)) },
  "bp-del": { on: "click", run: (e) => { BPS.delete(e.on); saveBps(); refreshDbg(); } },
};
bindActions(ACTIONS);

/* registo do painel (ADR-0004, U4g1 — antes era um shim no v6.ts) */
RP.debug = renderDebugPane;

/* ── publicação no window (via bridge) ──
   • `renderDebugPane` — o renderer do painel (registado acima em RP.debug).
   • `startDebug`/`dbgContinue`/`dbgStep`/`dbgStepInto`/`dbgStop`/`toggleBp`/`drawDbg` — o
     keydown (features/shortcuts.ts), os menus/CMD e a barra de acções do editor resolvem-nos
     por nome livre ao disparar.
   • `dbgBreaks` (Set) e `dbgCurrent()` (onde o gdb parou) — as fachadas que o editor lê para
     pintar os breakpoints e a linha corrente. */
publish({
  renderDebugPane,
  dbgBreaks: BPS, dbgCurrent,
  startDebug, dbgContinue, dbgStep: () => dbgStep(false), dbgStepInto, dbgStop, toggleBp, drawDbg, saveBps,
});
