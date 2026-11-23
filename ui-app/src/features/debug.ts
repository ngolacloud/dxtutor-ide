/* ═════════ dxtutor IDE — feature: Run and Debug (resíduo + composição) ═════════
   Feature DONA de toda a sua lógica: o motor de depuração simulado (sessão `DBG`,
   lançadores, breakpoints `BPS`, os traços e os controlos `dbg*`) MAIS o render do pane
   «Run and Debug» (`renderDebugPane`) e do assistente (`drawDbg`, #pc-dbg).

   ADR-0002 (Clean Architecture). Estado actual:
   - Fase 1 — `window.*` confinado a `features/debug/infrastructure/legacy-bridge.ts`;
     este ficheiro deixou de ser `@ts-nocheck`.
   - Fase 2 — geradores PUROS em `features/debug/domain/` (lexer-trace/crash-trace/
     launch/breakpoints); aqui ficaram wrappers finos que injectam o mundo.
   - Fase 3 — o motor da sessão (startDebug/dbgFeed/dbgApplyClone/dbgStep/dbgContinue/
     dbgFinish/dbgStop/dbgFix/toggleBp) saiu para `features/debug/application/debug-engine.ts`,
     com deps injectadas por porta (`application/ports.ts`). Este ficheiro COMPÕE o motor
     com os adaptadores do bridge, é DONO do estado (DBG/BPS) e do DOM (DBGK/drawDbg/
     refreshDbg/renderDebugPane) e RE-PUBLICA a superfície no `window`.
   - Fase 4 — os `onclick`/`onchange` inline de drawDbg/renderDebugPane deram lugar a
     `data-action`+`data-on`, servidos por um só listener delegado em
     `features/debug/ui/actions.ts`; a tabela de acções (ACTIONS, abaixo) fica aqui.

   Fronteira: a feature DETÉM o estado (DBG/BPS, window-backed). Os CONSUMIDORES do
   motor ficam no monólito/v6 e lêem por global: os `onclick` inline do pane, o keydown
   /menus/CMD de v6.ts, e as fachadas SEM substring proibido `window.dbgState()` (sessão),
   `window.dbgBreaks` (Set) e `window.dbgLaunch()` (lançadores), que v6 usa em
   paintEd/badges.

   Mecânica: avalia ANTES de `app.ts`/`v6.ts` (ordem do index.html). Nada é lido
   ansiosamente no eval — `BPS` nasce Set vazio e hidrata de `LS` PREGUIÇOSAMENTE
   (`hydrateBps`, guard-once) na primeira entrada; `DBG` espelha `window.DBG` via
   `writeSession`. */

import { $, hd, svg, esc, hhmm, toast, log, writeFile } from "../core";
import { RP } from "../app/store/registry";
import type { CodeStep, CodeTrace, CrashTrace, DbgSession, LaunchConfig, OpsStep } from "./debug/domain/types";
import { buildLexTrace } from "./debug/domain/lexer-trace";
import { buildCrashTrace } from "./debug/domain/crash-trace";
import { buildLaunchConfigs } from "./debug/domain/launch";
import { bpLine, bpPath } from "./debug/domain/breakpoints";
import { makeDebugEngine } from "./debug/application/debug-engine";
import { bindActions, type ActionTable } from "./debug/ui/actions";
import {
  readSession, writeSession, breakpoints,
  pLx, files, currentTab, pane, goPane, openPath, paintEd, setPanelTab, togglePanel, getVar, setVar, panes,
  lexVariant, lexLine,
  envState, envx, envLabels, localSecrets, urlHosts,
  isHuman, checkpoint, dlg, lsGet, lsSet, publish,
  explainDeep, openStagingSecrets,
  type EnvState,
} from "./debug/infrastructure/legacy-bridge";

/* ───── estado (window-backed; o resíduo de v6 lê por fachadas sem substring proibido) ───── */
let DBG: DbgSession | null = readSession();
writeSession(DBG);
const BPS = breakpoints();
let _bpsHydrated = false;
/** Restaura os breakpoints persistidos de `LS` uma única vez. Preguiçoso porque este
 *  módulo avalia antes de app.ts definir `LS`; chamado nas entradas (drawDbg/startDebug
 *  /toggleBp/renderDebugPane), garantindo o Set populado antes do primeiro paintEd. */
function hydrateBps(): void { if (_bpsHydrated) return; _bpsHydrated = true; try { (lsGet<string[]>("bps6", []) || []).forEach((b) => BPS.add(b)); } catch (e) { /* LS ainda não pronto */ } }
const saveBps = (): void => lsSet("bps6", [...BPS]);

/* ───── geradores de traço: wrappers finos sobre o domínio PURO, injectando o mundo
   (número de linha do lexer; deps/segredos/host dos ambientes) ───── */
function lexTrace(v: string): CodeTrace { return buildLexTrace(v, lexLine); }
function crashTrace(env: string, n: string): CrashTrace {
  return buildCrashTrace({ env, n, deps: (envState(env) as EnvState).deps, sec: (envx().sec ?? {})[env] ?? {}, local: localSecrets(), ns: envx().ns[env], label: envLabels()[env], urlHosts });
}
function debugConfigs(): LaunchConfig[] {
  return buildLaunchConfigs([{ env: "staging", state: envx().st.staging }, { env: "production", state: envx().st.production }]);
}

/* ───── DOM: desenho do assistente (#pc-dbg) e do pane (#pane-debug) — donos do resíduo;
   lêem o estado DBG/BPS e entram no motor pela porta `view`. ───── */
const DBGK: Record<string, [string, string]> = { look: ["Looking at", "var(--blue)"], think: ["Analysing", "var(--accent-hover)"], evidence: ["Evidence", "var(--yellow)"], cmd: ["Probe", "var(--fg-muted)"], root: ["Root cause", "var(--red)"], ok: ["Verdict", "var(--green)"] };
function drawDbg(): void {
  hydrateBps(); const el = $("#pc-dbg"); if (!el) return; const d = DBG;
  if (!d) { el.innerHTML = `<div class="dbg-empty">${svg("bug")}<div><b>Debug assistant</b><p>Start a session (<kbd>F5</kbd>) and the assistant explains what it is looking at and why, keeps ranked hypotheses with the evidence for and against each, and suggests the next probe — like a senior engineer next to you, not a cursor jumping between lines.</p><button class="mini pri" data-action="start">Start debugging</button></div></div>`; return; }
  const hs = Object.entries(d.h || {}).sort((a, b) => b[1] - a[1]), probes: [string, string][] = []; if (d.kind === "code" && !d.done) { probes.push(["Step over (F10)", "step"], ["Continue to breakpoint (F5)", "continue"]); if (!d.watch!.includes("chars.peek()")) probes.push(["Watch chars.peek()", "watch-peek"]); }
  if (d.kind === "ops" && !d.done) probes.push(["Run next probe (F10)", "step"]); if (d.offer) probes.push(["Apply rustc's suggestion and debug it", "apply-clone"]); if (d.done && d.end!.fix) probes.push(["Apply the fix and re-run", "fix"]); if (d.done && d.end!.act) probes.push(["Open the staging secrets", "open-secrets"]); if (d.done) probes.push(["Explain this to me in depth", "explain"]);
  el.innerHTML = `<div class="dbg"><div class="dbg-feed" id="dbg-feed">${d.focus ? `<div class="dbg-focus">Now analysing: <b>${esc(d.focus)}</b></div>` : ""}${d.feed.map((f) => `<div class="df ${f.k}"><span class="dk" style="color:${DBGK[f.k][1]}">${DBGK[f.k][0]}</span><div>${f.h}</div></div>`).join("")}</div>
   <div class="dbg-side"><div class="dbg-t">Hypotheses</div>${hs.length ? hs.map(([k, v]) => `<div class="hy${v < 8 ? " out" : ""}"><div class="hy-h"><span>${d.hk![k]}</span><b>${v}%</b></div><i><b style="width:${v}%;background:${v >= 80 ? "var(--red)" : v < 8 ? "var(--fg-muted)" : "var(--accent)"}"></b></i></div>`).join("") : '<div class="sec-empty" style="padding:4px 0">Forming hypotheses once the session starts.</div>'}
   <div class="dbg-t">Next</div>${probes.map((p) => `<button class="dbg-p" data-action="${p[1]}">${p[0]}</button>`).join("")}</div></div>`; const f = $("#dbg-feed"); if (f) f.scrollTop = f.scrollHeight;
}
function refreshDbg(): void {
  drawDbg(); if (pane() === "debug") panes().debug(); const t = currentTab();
  if (t && t.path === pLx() && t.kind === "file") { paintEd(pLx()); const s = DBG && DBG.kind === "code" ? (DBG.steps[DBG.i] as CodeStep) : null; if (s) { const eb = $("#ebody"); if (eb) eb.scrollTop = Math.max(0, (s.l - 1) * 22 - 140); } }
}

/** Renderiza o pane «Run and Debug»: controlo da sessão, lançadores, variáveis,
 *  watch, call stack, probes e breakpoints. Render puro sobre `DBG`/`BPS`. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug"), cf = debugConfigs(), session = DBG, s = (session && session.kind === "code" ? session.steps[session.i] : null) as CodeStep | null;
  if (!el) return;
  el.innerHTML = hd("Run and Debug", `<button title="Start debugging (F5)" data-action="start">${svg("run")}</button>`) + `<div class="sections">${session ? `<div class="dbg-ctl"><button title="Continue (F5)" data-action="continue">▶</button><button title="Step over (F10)" data-action="step">↷</button><button title="Restart" data-action="restart">↻</button><button title="Stop (Shift+F5)" data-action="stop">■</button><span class="notr">${esc((cf.find((c) => c.id === session.id) || { l: session.id }).l)}</span></div>` : ""}
   ${!session ? `<div class="scm-grp">Launch</div>${cf.map((c) => `<div class="scm-row" data-action="start" data-on="${esc(c.id)}"><span class="ic" style="color:${c.id.startsWith("crash") ? "var(--red)" : "var(--green)"}">${svg(c.id.startsWith("crash") ? "bug" : "run")}</span><span class="nm notr" style="max-width:none">${esc(c.l)}</span></div><div class="sec-empty" style="padding-top:0;padding-left:34px">${esc(c.d)}</div>`).join("")}<button class="btn" data-action="start">Start debugging (F5)</button>` : ""}
   ${session && session.kind === "code" ? `<div class="scm-grp">Variables</div>${s ? Object.entries(s.v).map(([k, v]) => `<div class="dv"><span class="k notr">${esc(k)}</span><span class="v notr">${esc(v)}</span></div>`).join("") : ""}
   <div class="scm-grp">Watch</div>${session.watch!.map((w: string, i: number) => { const val = s ? (w === "chars.peek()" ? (s.v["chars.peek()"] || (/next '1'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('1')" : /next '2'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('2')" : "None")) : w === "tokens.len()" ? (s.v["tokens: Vec<Token>"].match(/len (\d+)/) || [])[1] : "not available in the prototype") : ""; return `<div class="dv"><span class="k notr">${esc(w)}</span><span class="v notr">${esc(val)}</span><button data-action="watch-del" data-on="${i}">×</button></div>`; }).join("")}<input class="inp notr" placeholder="Add expression" data-action="watch-add">
   <div class="scm-grp">Call stack</div>${s ? [`lexer::tokenize · lib.rs:${s.l}`, "lexer::tests::tokenize_emits_eof", "test::run_test · std"].map((f, i) => `<div class="dv${i ? "" : " top"}"><span class="k notr">${esc(f)}</span></div>`).join("") : ""}` : ""}
   ${session && session.kind === "ops" ? `<div class="scm-grp">Probes</div>${(session.steps as OpsStep[]).map((p, i: number) => `<div class="dv${i === session.i ? " top" : ""}"><span class="k" style="color:${i <= session.i ? "var(--green)" : "var(--fg-muted)"}">${i <= session.i ? "✓" : "○"}</span><span class="v notr" style="text-align:left">${esc(p.cmd)}</span></div>`).join("")}` : ""}
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${[...BPS].map((b) => { const l = bpLine(b), p = bpPath(b); return `<div class="scm-row" data-action="open-bp" data-on="${esc(b)}"><span class="bpd"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span><span class="ra" style="display:flex"><button data-action="bp-del" data-on="${esc(b)}">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}
   <div class="sec-empty">Sessions are simulated in the browser. The desktop app drives lldb / delve / debugpy through the Debug Adapter Protocol; the assistant reads the same frames.</div></div>`;
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) + as funções de
   desenho (resíduo) às portas do motor (application). O motor fica puro; o `window`/DOM
   ficam deste lado. O estado DBG/BPS é a MESMA referência que `publish` expõe. ───── */
const engine = makeDebugEngine({
  store: { session: () => DBG, setSession: (s) => { DBG = s; writeSession(s); }, breakpoints: () => BPS, hydrate: () => hydrateBps(), save: () => saveBps() },
  workspace: { lexPath: () => pLx(), fileContent: (p) => files()[p].content, writeFile: (p, c) => writeFile(p, c) },
  lexer: { variant: () => lexVariant(), line: (re) => lexLine(re) },
  scenarios: { code: (v) => lexTrace(v), ops: (e, n) => crashTrace(e, n), launch: () => debugConfigs() },
  env: { label: (e) => envLabels()[e] },
  editor: { currentTab: () => currentTab(), openPath: (p, l) => openPath(p, l), paintEd: (p) => paintEd(p) },
  shell: { goPane: (p) => goPane(p), getVar: (k) => getVar(k), setVar: (k, v) => setVar(k, v), togglePanel: () => togglePanel(), setPanelTab: (pt, nf) => setPanelTab(pt, nf) },
  view: { draw: () => drawDbg(), refresh: () => refreshDbg(), renderPane: () => panes().debug() },
  notifier: { toast: (m) => toast(m), dlg: (o) => dlg(o) },
  logger: { log: (s, m) => log(s, m) },
  human: { owns: (w) => isHuman(w) },
  checkpoint: { snapshot: (l) => checkpoint(l) },
  clock: { time: () => hhmm() },
});
const { startDebug, dbgFeed, dbgApplyClone, dbgStep, dbgContinue, dbgFinish, dbgStop, dbgFix, toggleBp } = engine;

/* clique no gutter do editor alterna o breakpoint da linha (índice do div na coluna) */
document.addEventListener("click", (e) => { const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return; const t = currentTab(); if (!t || !t.path || t.kind !== "file") return; toggleBp(t.path, [...g.parentElement!.children].indexOf(g) + 1); });

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` por drawDbg/renderDebugPane) ao
   efeito, servido pelo listener delegado de `ui/actions.ts`. Fica aqui — no resíduo,
   fora da subárvore governada por A7/A8 — porque só este ficheiro tem à mão o motor, o
   desenho e o bridge. O payload viaja SÓ em `data-on` (o golden strippa data-action/
   data-on; um `data-*` à medida vazava). Os valores interpolados em `data-on` (id do
   lançador, chave do breakpoint `path:line`, índice do watch) escapam-se com `esc` à
   saída — eram crus em literais JS dentro dos `onclick`; nos dados actuais (ids/paths/
   hashes/números) `esc` é no-op, logo a saída visível (strippada) não muda.
     • start/restart/step/continue/stop/apply-clone/fix — controlos da sessão (start lê
       o id opcional de data-on: lançador; restart relê DBG.id vivo como o onclick antigo)
     • watch-peek/watch-del/watch-add — expressões de watch (data-on=índice; add=change)
     • open-bp/bp-del — breakpoints (data-on=chave `path:line`)
     • explain/open-secrets — saltos p/ outras features (Explain em profundidade; segredos) */
const ACTIONS: ActionTable = {
  start: { on: "click", run: (e) => startDebug(e.on || undefined) },
  restart: { on: "click", run: () => startDebug(DBG ? DBG.id : undefined) },
  step: { on: "click", run: () => dbgStep() },
  continue: { on: "click", run: () => dbgContinue() },
  stop: { on: "click", run: () => dbgStop() },
  "apply-clone": { on: "click", run: () => dbgApplyClone() },
  fix: { on: "click", run: () => dbgFix() },
  explain: { on: "click", run: () => explainDeep() },
  "open-secrets": { on: "click", run: () => openStagingSecrets() },
  "watch-peek": { on: "click", run: () => { const d = DBG; if (d && d.watch) { d.watch.push("chars.peek()"); refreshDbg(); } } },
  "watch-del": { on: "click", run: (e) => { const d = DBG; if (d && d.watch) { d.watch.splice(+e.on, 1); refreshDbg(); } } },
  "watch-add": { on: "change", run: (e) => { const d = DBG; if (e.value.trim() && d && d.watch) { d.watch.push(e.value.trim()); refreshDbg(); } } },
  "open-bp": { on: "click", run: (e) => openPath(bpPath(e.on), +bpLine(e.on)) },
  "bp-del": { on: "click", run: (e) => { BPS.delete(e.on); saveBps(); refreshDbg(); } },
};
bindActions(ACTIONS);

/* registo do painel (ADR-0004, U4g1 — antes era um shim no v6.ts) */
RP.debug = renderDebugPane;

/* ── publicação no window (via bridge) ──
   • `renderDebugPane` — o renderer do painel (registado acima em RP.debug).
   • motor (`startDebug`/`dbg*`/`saveBps`/`debugConfigs`/`lexTrace`/`crashTrace`) — os
     `onclick`/keydown/menus do monólito resolvem-nos por nome livre ao disparar.
   • fachadas SEM substring proibido para o resíduo de v6.ts ler o estado:
     `dbgState()` (sessão), `dbgBreaks` (Set), `dbgLaunch()` (lançadores). */
publish({
  renderDebugPane,
  dbgState: () => DBG,
  dbgBreaks: BPS,
  dbgLaunch: debugConfigs,
  startDebug, dbgFeed, dbgApplyClone, dbgStep, dbgContinue, dbgFinish, dbgStop, dbgFix,
  drawDbg, refreshDbg, toggleBp, saveBps, debugConfigs, lexTrace, crashTrace,
});
