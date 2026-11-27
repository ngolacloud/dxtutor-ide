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
import { tauriDebug, tauriProjectDebug } from "./debug/infrastructure/tauri";
import { bindActions, type ActionTable } from "./debug/ui/actions";
import { bpGroups, inlineValues as computeInline, type BpMeta } from "./debug/domain/dap";
import { bpLabel, bpMenu, dapButtons, dapExtras, dapStopped, outputBlock } from "./debug/ui/dap-view";
import { DAP_MESSAGES, type DapKey } from "./debug/ui/dap-messages";
import { DBGX_MESSAGES, type DbgxKey } from "./debug/ui/dbgx-messages";
import { exceptionCardHtml, exceptionsBlock, groupsBlock, perfTipText, toolbarHtml } from "./debug/ui/dbgx-view";
import { bindConsoleKeys, renderExceptionCard, renderToolbar } from "./debug/ui/toolbar";
import { toolbarFor, type ToolKey } from "./debug/domain/caps";
import { isUserFrame } from "./debug/domain/frames";
import type { InlineValue } from "../app/inline-values";
import type { DebugSettings } from "./debug/application/ports";
import { bus } from "../app/bus";
import { DEBUG_ENGINE_MESSAGES } from "./debug/application/messages";
import { translator } from "../app/i18n";
import { codevAsk } from "../app/codev-ask";
import { inlineValues } from "../app/inline-values";
import { isDesktop } from "../platform/tauri/core";
import {
  breakpoints, currentTab, pane, goPane, openPath, paintEd, setPanelTab, panes, lsGet, lsSet, root, fsRoot, content, fsKeys, exec, paletteChoose, paletteAsk, kubeTarget, copyText,
} from "./debug/infrastructure/legacy-bridge";

/* ───── estado (window-backed; o editor lê-o pela fachada `dbgBreaks`) ───── */
const BPS = breakpoints();
let _bpsHydrated = false;
/** Restaura os breakpoints persistidos de `LS` uma única vez. Preguiçoso porque este
 *  módulo avalia antes de app.ts definir `LS`; chamado nas entradas (drawDbg/startDebug
 *  /toggleBp/renderDebugPane), garantindo o Set populado antes do primeiro paintEd. */
function hydrateBps(): void { if (_bpsHydrated) return; _bpsHydrated = true; try { (lsGet<string[]>("bps6", []) || []).forEach((b) => BPS.add(b)); } catch (e) { /* LS ainda não pronto */ } }
const saveBps = (): void => lsSet("bps6", [...BPS]);
/* A7: a condição, a contagem, a mensagem (logpoint) e o on/off de cada breakpoint — `path:linha` → meta;
   no browser em LS, no desktop também na base do projecto (o motor guarda-os por ficheiro) */
const BPMETA = new Map<string, BpMeta>();
let _metaHydrated = false;
function hydrateMeta(): void { if (_metaHydrated) return; _metaHydrated = true; try { (lsGet<Array<[string, BpMeta]>>("bpmeta6", []) || []).forEach(([k, m]) => BPMETA.set(k, m)); } catch { /* LS ainda não pronto */ } }
const saveMeta = (): void => lsSet("bpmeta6", [...BPMETA]);
const tD = translator(DAP_MESSAGES);
/* r23 F2: os textos novos (barra, consola, excepções…) num catálogo à parte; o motor pede-os pela mesma porta */
const tX = translator(DBGX_MESSAGES);
const sayD = (k: string, p?: Record<string, string | number>): string => (k in DBGX_MESSAGES.en ? tX(k as DbgxKey, p) : tD(k as DapKey, p));

/* ───── a sessão de depuração real (ADR-0006, R4) e a última mensagem para o pane ───── */
let SESSION: Session | null = null, MSG = "";

/** Onde o gdb parou, como chave do FS do editor (null fora da pasta ou sem sessão parada). */
function dbgCurrent(): { path: string; line: number } | null {
  const st = SESSION && SESSION.status === "stopped" ? SESSION.stop : null, r = root();
  /* r23 F2: another frame selected (or chosen by Just My Code) → its line; frame 0 → where it stopped */
  const f = st && SESSION && (SESSION.frame ?? 0) > 0 ? SESSION.stack[SESSION.frame ?? 0] : undefined;
  const at = f && f.file ? f : st;
  const key = at && r ? fsKeyFor(at.file, r, fsRoot()) : null;
  return key && at ? { path: key, line: at.line } : null;
}

/* ───── DOM: o assistente (#pc-dbg) e o pane (#pane-debug) ───── */
function drawDbg(): void {
  hydrateBps(); const el = $("#pc-dbg"); if (!el) return;
  const st = SESSION && SESSION.stop;
  el.innerHTML = SESSION && st
    ? `<div class="dbg-empty">${svg("bug")}<div><b>Parado em ${esc(st.func || "?")}</b><p class="notr">${esc((st.file || "").split("/").pop() || "")}:${st.line} · ${esc(st.reason)}</p>${SESSION.locals.length ? `<p class="notr">${SESSION.locals.slice(0, 8).map((v) => `${esc(v.name)} = ${esc(v.value)}`).join("<br>")}</p>` : ""}</div></div>`
    : `<div class="dbg-empty">${svg("bug")}<div><b>Debug assistant</b><p>${tD(SESSION ? "assistRunning" : "assistIdle")} ${tD("assistDesktop")}</p></div></div>`;
}
function refreshDbg(): void {
  drawDbg(); if (pane() === "debug") panes().debug();
  const t = currentTab(); if (t && t.path && t.kind === "file") paintEd(t.path);
  drawFloating();
}

/* r23 F2: the floating toolbar over the editor and the exception card under the panicking line */
const MISS_WHY = (m: { why: string; params?: Record<string, string | number> }): string => sayD(m.why, { adapter: SESSION?.adapter ?? "", ...(m.params ?? {}) });
function drawFloating(): void {
  const s = SESSION;
  const rp = s?.replay?.position;
  renderToolbar(s ? toolbarHtml(tX, toolbarFor(s, engine.extra().host), s.stops ?? 0, MISS_WHY, rp ? { n: rp.event, total: rp.endEvent } : null) : null);
  drawExceptionCard();
}
function drawExceptionCard(): void {
  const s = SESSION, r = root(), t = currentTab();
  const p = s && s.status === "stopped" ? s.panic : null;
  if (!p || !r || !t || !t.path) { renderExceptionCard(null, 0); return; }
  const user = s!.stack.filter((f) => isUserFrame(f.file, r));
  const at = user[0] ?? null;
  const key = at ? fsKeyFor(at.file, r, fsRoot()) : null;
  if (!at || key !== t.path) { renderExceptionCard(null, 0); return; }
  const rr = { canReplay: !!engine.extra().host?.timeTravel.available, inReplay: !!s!.replay };
  renderExceptionCard(exceptionCardHtml(tX, p, user, codevAsk.available(), rr), at.line);
}

/** Renderiza o pane «Run and Debug»: os controlos e o estado da sessão (onde parou, variáveis,
 *  pilha), a última mensagem e os breakpoints. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug");
  if (!el) return;
  const s = SESSION, st = s && s.stop;
  const dap = !!s && s.engine === "dap", x = engine.extra();
  const ctl = s
    ? `<div class="dbg-ctl"><button title="Continue (F5)" data-action="continue"${s.status !== "stopped" ? " disabled" : ""}>▶</button><button title="Step over (F10)" data-action="step"${s.status !== "stopped" ? " disabled" : ""}>↷</button><button title="Step into (F11)" data-action="step-into"${s.status !== "stopped" ? " disabled" : ""}>↓</button>${dap ? dapButtons(tD, s) : ""}<button title="Stop (Shift+F5)" data-action="stop">■</button><span class="notr">${esc(s.program.split("/").pop() || s.program)}</span>${dap ? dapExtras(tD, s.adapter || "lldb-dap", x.stopOnPanic) : ""}</div>`
    : `<button class="btn" data-action="start">Start debugging (F5)</button>${isDesktop() ? `<button class="btn ghost" data-action="attach">${tD("attach")}</button><button class="btn ghost" data-action="dbg-test">${esc(tX("debugTest"))}</button>${x.host?.timeTravel.available ? `<button class="btn ghost" data-action="dbg-record-test">${esc(tX("recordTest"))}</button>` : ""}` : ""}`;
  const where = s
    ? s.status === "stopped" && st && dap
      ? `<div class="sec-empty notr">Parado em <b>${esc(st.func || "?")}</b> · ${esc((st.file || "").split("/").pop() || "")}:${st.line} (${esc(st.reason)})</div>` + dapStopped(tD, s, x, codevAsk.available(), !!projectDebug, { tx: tX, root: root() ?? "", jmc: x.jmc, libOpen: x.libOpen, console: x.console })
    : s.status === "stopped" && st
      ? `<div class="sec-empty notr">Parado em <b>${esc(st.func || "?")}</b> · ${esc((st.file || "").split("/").pop() || "")}:${st.line} (${esc(st.reason)})</div>`
        + `<div class="scm-grp">Variables<span class="cnt">${s.locals.length}</span></div>${s.locals.map((v) => `<div class="dv"><span class="k notr">${esc(v.name)}</span><span class="v notr">${esc(v.value)}</span></div>`).join("") || '<div class="sec-empty">Sem variáveis locais neste ponto.</div>'}`
        + `<div class="scm-grp">Call stack</div>${s.stack.map((f, i) => `<div class="dv${i ? "" : " top"}" data-action="open-frame" data-on="${esc(f.file)}:${f.line}"><span class="k notr">${esc(f.func)} · ${esc((f.file || "").split("/").pop() || "")}:${f.line}</span></div>`).join("")}`
      : `<div class="sec-empty">${tD(s.status === "starting" ? "startingGdb" : "runningWait")}</div>${dap ? outputBlock(tD, x.output) : ""}`
    : `<div class="sec-empty">${tD("intro")}</div>`;
  const msg = MSG ? `<div class="sec-empty" style="white-space:pre-wrap">${esc(MSG)}</div>` : "";
  /* r23 F2: the exception settings (desktop, or in a DAP session) and the breakpoint groups (when there are) */
  const exc = isDesktop() || dap ? exceptionsBlock(tX, x.stopOnPanic, s?.caps?.exceptionFilters ?? [], x.exceptionFilters) : "";
  const groups = groupsBlock(tX, bpGroups(BPMETA.values()), x.groupsOff);
  /* the console's input survives the repaint (the output comes every 120 ms) */
  const ci = document.getElementById("dbg-con-in") as HTMLInputElement | null, cv = ci?.value ?? "", cf = !!ci && document.activeElement === ci;
  el.innerHTML = hd("Run and Debug", "") + `<div class="sections">${ctl}${msg}${where}${exc}
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${groups}${[...BPS, ...[...BPMETA.keys()].filter((k) => !BPS.has(k))].map((b) => { const l = bpLine(b), p = bpPath(b), m = BPMETA.get(b); return `<div class="scm-row${m && !m.enabled ? " bp-off" : ""}" data-action="open-bp" data-on="${esc(b)}"><span class="bpd${m ? " k-" + (m.logMessage?.trim() ? "log" : m.condition?.trim() || m.hitCondition?.trim() ? "cond" : "plain") : ""}"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span>${bpLabel(tD, m, tX)}<span class="ra" style="display:flex"><button data-action="bp-del" data-on="${esc(b)}">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}</div>`;
  const ni = document.getElementById("dbg-con-in") as HTMLInputElement | null;
  if (ni && cv) ni.value = cv;
  if (ni && cf) ni.focus();
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) + as funções de
   desenho (resíduo) às portas do motor (application). ───── */
/* A7: os breakpoints guardados por projecto e o snapshot só existem na app desktop */
const projectDebug = isDesktop() ? tauriProjectDebug() : null;
const engine = makeDebugEngine({
  store: {
    session: () => SESSION, setSession: (x) => { SESSION = x; }, setMessage: (m) => { MSG = m; },
    breakpoints: () => BPS, hydrate: () => { hydrateBps(); hydrateMeta(); }, save: () => { saveBps(); saveMeta(); },
  },
  dbg: tauriDebug(),
  workspace: { root: () => root(), fsRoot: () => fsRoot(), content: (k) => content(k), keys: () => fsKeys(), exec: (c) => exec(c) },
  editor: { currentTab: () => currentTab(), openPath: (p, l) => openPath(p, l), paintEd: (p) => paintEd(p) },
  shell: { goPane: (p) => goPane(p), setPanelTab: (pt, nf) => setPanelTab(pt, nf) },
  picker: { choose: (t, items) => paletteChoose(t, items), ask: (t) => paletteAsk(t) },
  view: { refresh: () => refreshDbg() },
  notifier: { toast: (m) => toast(m) },
  newId: () => "dbg-" + Date.now().toString(36),
  ...(projectDebug ? { project: projectDebug } : {}),
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  bpMeta: BPMETA,
  say: sayD,
  kubeTarget: () => kubeTarget(),
  copy: translator(DEBUG_ENGINE_MESSAGES),
  /* r23 F2 */
  clock: () => performance.now(),
  settings: {
    load: (r) => lsGet<DebugSettings | null>("dbgcfg:" + r, null),
    save: (r, k) => lsSet("dbgcfg:" + r, k),
  },
  clipboard: (text) => copyText(text),
});
const { startDebug, dbgContinue, dbgStep, dbgStop, toggleBp } = engine;
/** A10: «Debug: Attach to a Process…» (a paleta importa-o; não vai para o window). */
export const dbgAttach = (): Promise<void> => engine.attach();
const dbgStepInto = (): Promise<void> => dbgStep(true);

/* clique no gutter do editor alterna o breakpoint da linha (índice do div na coluna) */
document.addEventListener("click", (e) => { const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return; const t = currentTab(); if (!t || !t.path || t.kind !== "file") return; toggleBp(t.path, [...g.parentElement!.children].indexOf(g) + 1); });

/* A7: clique direito no gutter — o menu do breakpoint da linha (condição, contagem, logpoint, on/off) */
function closeBpMenu(): void { document.getElementById("bp-menu")?.remove(); }
document.addEventListener("contextmenu", (e) => {
  const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return;
  const t = currentTab(); if (!t || !t.path || t.kind !== "file") return;
  e.preventDefault(); hydrateBps(); hydrateMeta(); closeBpMenu();
  const key = t.path + ":" + ([...g.parentElement!.children].indexOf(g) + 1);
  const m = document.createElement("div");
  m.id = "bp-menu"; m.className = "menu-pop bp-menu"; m.style.left = (e as MouseEvent).clientX + "px"; m.style.top = (e as MouseEvent).clientY + "px";
  m.innerHTML = bpMenu(tD, key, BPS.has(key), BPMETA.get(key), tX);
  document.body.appendChild(m);
});
document.addEventListener("click", (e) => { if (!(e.target as HTMLElement | null)?.closest("#bp-menu")) closeBpMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBpMenu(); });
async function bpMenuRun(on: string): Promise<void> {
  const i = on.indexOf("|"), cmd = on.slice(0, i), key = on.slice(i + 1), cur: BpMeta = { ...(BPMETA.get(key) ?? { enabled: true }) };
  if (cmd === "add") { toggleBp(bpPath(key), +bpLine(key)); return; }
  if (cmd === "remove") { await engine.removeBreakpoint(key); return; }
  if (cmd === "enable" || cmd === "disable") { await engine.editBreakpoint(key, { ...cur, enabled: cmd === "enable" }); return; }
  /* r23 F2: wait for another breakpoint; put in a group */
  if (cmd === "trigger") {
    const others = [...BPS].filter((b) => b !== key), none = tX("bpTriggerNone");
    const pick = await paletteChoose(tX("bpTriggerPh"), [none, ...others.map((b) => `${bpPath(b).split("/").pop()}:${bpLine(b)} — ${b}`)]);
    if (pick === null) return;
    await engine.setTrigger(key, pick === none ? null : pick.split(" — ").pop() ?? null);
    return;
  }
  if (cmd === "group") {
    const existing = bpGroups(BPMETA.values()), none = tX("bpGroupNone"), fresh = tX("bpNewGroup");
    const pick = existing.length ? await paletteChoose(tX("bpGroupPh"), [...existing, fresh, none]) : fresh;
    if (pick === null) return;
    const name = pick === fresh ? await paletteAsk(tX("bpGroupPh")) : pick === none ? "" : pick;
    if (name === null) return;
    await engine.setGroup(key, name || null);
    return;
  }
  const ph = cmd === "condition" ? tD("conditionPh") : cmd === "hit" ? tD("hitPh") : tD("logPh");
  const v = await paletteAsk(ph);
  if (v === null) return;
  const next: BpMeta = { ...cur, enabled: true, ...(cmd === "condition" ? { condition: v } : cmd === "hit" ? { hitCondition: v } : { logMessage: v }) };
  await engine.editBreakpoint(key, next);
}

/* A7: os valores das variáveis no fim das linhas acima da paragem (o editor pede-os depois de pintar) */
/* r23 F2: os do frame seleccionado, os que mudaram nesta paragem marcados, e o PerfTip na linha corrente */
inlineValues.set((path) => {
  const cur = dbgCurrent(), s = SESSION;
  if (!cur || !s || cur.path !== path) return null;
  const loc = s.scopes?.find((x) => /local/i.test(x.name)) ?? s.scopes?.[0];
  const vars = (loc && s.children?.[loc.reference]) || s.locals;
  const text = content(path);
  if (text == null) return null;
  const changed = new Set(vars.filter((v) => "changed" in v && v.changed).map((v) => v.name));
  const out: Record<number, InlineValue | InlineValue[]> = {};
  for (const [n, txt] of Object.entries(computeInline(text.split("\n"), cur.line, vars))) {
    const mark = [...changed].some((c) => new RegExp(`(^|, )${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} = `).test(txt));
    out[+n] = mark ? { text: txt, cls: "chg" } : txt;
  }
  const tip = (s.frame ?? 0) === 0 || s.stack[s.frame ?? 0]?.line === cur.line ? perfTipText(tX, s.perfMs) : null;
  if (tip) out[cur.line] = [...(out[cur.line] ? [out[cur.line] as InlineValue] : []), { text: tip, cls: "perf" }];
  return out;
});

/* r23 F2: the exception card goes back under its line when the file view is drawn again */
bus.on("editor:file-view", () => drawExceptionCard());
bindConsoleKeys({ evaluate: (e) => { void engine.consoleEval(e); }, history: (d) => engine.consoleHistory(d) });

/* A7: ao abrir uma pasta no desktop, os breakpoints guardados do projecto voltam ao gutter */
/* r23 F2: e o que o host sabe fazer (adaptador, rr) — perguntado uma vez, para a barra dizer porquê falta algo */
/* (depois dos outros donos da abertura da pasta: o quadro carrega primeiro) */
document.addEventListener("dx:workspace", () => { void engine.loadKept(); setTimeout(() => { void engine.host().then(() => { if (SESSION) drawFloating(); }); }, 0); });

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
  "bp-del": { on: "click", run: (e) => { if (BPMETA.size || SESSION || projectDebug) void engine.removeBreakpoint(e.on); else { BPS.delete(e.on); saveBps(); refreshDbg(); } } },
  /* A7 — DAP */
  "step-out": { on: "click", run: () => { void engine.dbgStepOut(); } },
  pause: { on: "click", run: () => { void engine.dbgPause(); } },
  panic: { on: "change", run: (e) => { void engine.setStopOnPanic((e.el as HTMLInputElement).checked); } },
  "var-toggle": { on: "click", run: (e) => { void engine.toggleVar(+e.on); } },
  frame: { on: "click", run: (e) => { void engine.selectFrame(+e.on); } },
  thread: { on: "click", run: (e) => { void engine.selectThread(+e.on); } },
  "watch-add": { on: "change", run: (e) => { const v = e.value; (e.el as HTMLInputElement).value = ""; void engine.addWatch(v); } },
  "watch-del": { on: "click", run: (e) => engine.removeWatch(+e.on) },
  "ask-explain": { on: "click", run: () => engine.askCodev("explain") },
  "ask-test": { on: "click", run: () => engine.askCodev("test") },
  snapshot: { on: "click", run: () => { void engine.snapshot(); } },
  attach: { on: "click", run: () => { void engine.attach(); } },
  "bp-menu": { on: "click", run: (e) => { closeBpMenu(); void bpMenuRun(e.on); } },
  /* r23 F2 */
  "dbg-tb": { on: "click", run: (e) => { void toolbarRun(e.on as ToolKey); } },
  "dbg-test": { on: "click", run: () => { void engine.debugTest(); } },
  "dbg-con-clear": { on: "click", run: () => engine.consoleClear() },
  "dbg-exc": { on: "change", run: (e) => { void engine.setExceptionFilter(e.on, (e.el as HTMLInputElement).checked); } },
  "dbg-jmc": { on: "change", run: () => engine.toggleJmc() },
  "dbg-lib": { on: "click", run: (e) => engine.openLibFrames(+e.on) },
  "dbg-data": { on: "click", run: (e) => { const i = e.on.indexOf("|"); void engine.addDataBreakpoint(+e.on.slice(0, i), e.on.slice(i + 1)); } },
  "dbg-data-del": { on: "click", run: (e) => { void engine.removeDataBreakpoint(e.on); } },
  "dbg-mem": { on: "click", run: (e) => { void engine.viewMemory(e.on); } },
  "dbg-mem-close": { on: "click", run: () => engine.closeMemory() },
  "dbg-group": { on: "click", run: (e) => { void engine.toggleGroup(e.on); } },
  "dbg-exc-close": { on: "click", run: () => renderExceptionCard(null, 0) },
  "dbg-ask-panic": { on: "click", run: () => engine.askPanic() },
  "dbg-copy-panic": { on: "click", run: () => engine.copyPanic() },
  /* r23 F2b: record and replay */
  "dbg-record-test": { on: "click", run: () => { void engine.recordTest(); } },
  "dbg-replay-run": { on: "click", run: () => { void engine.replayThisRun(); } },
  "dbg-travel": { on: "click", run: (e) => { void engine.travelTo(+e.on); } },
  "dbg-travel-start": { on: "click", run: () => { void engine.travelStart(); } },
  "dbg-writes": { on: "change", run: (e) => { const v = e.value; (e.el as HTMLInputElement).value = ""; void engine.changesOf(v); } },
  "dbg-origin": { on: "click", run: (e) => { void engine.originOf(e.on, true); } },
  "dbg-origin-ask": { on: "click", run: () => { void paletteAsk(tX("originAskPh")).then((v) => { if (v && v.trim()) void engine.originOf(v, false); }); } },
};

/** The cursor's line in the editor (run to cursor). */
function cursorAt(): { path: string; line: number } | null {
  const t = currentTab(), ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
  if (!t || !t.path || t.kind !== "file" || !ta) return null;
  return { path: t.path, line: ta.value.slice(0, ta.selectionStart).split("\n").length };
}
const dbgRunToCursor = (): Promise<void> => { const c = cursorAt(); if (!c) { toast(tX("tb-cursor")); return Promise.resolve(); } return engine.runToCursor(c.path, c.line); };
function toolbarRun(k: ToolKey): Promise<void> {
  switch (k) {
    case "cont": return dbgContinue();
    case "over": return dbgStep(false);
    case "into": return dbgStep(true);
    case "out": return engine.dbgStepOut();
    case "cursor": return dbgRunToCursor();
    case "rframe": return engine.restartFrame();
    case "restart": return engine.restart();
    case "stop": return dbgStop();
    case "back": return engine.stepBack();
    case "rcont": return engine.reverseContinue();
  }
}
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
/* lidos por import desde a U7p5 do ADR-0004 (o editor, os atalhos, o arranque, a barra de acções dos separadores e o
   auto-teste): o dbgStep exportado é o «step over» que estava publicado */
const dbgStepOver = (): Promise<void> => dbgStep(false);
export { renderDebugPane, BPS as dbgBreaks, dbgCurrent, startDebug, dbgContinue, dbgStepOver as dbgStep, dbgStepInto, dbgStop, toggleBp, drawDbg, saveBps };
/* r23 F2: os atalhos novos (features/shortcuts.ts) e a paleta (app/commands.ts) */
export const dbgStepOut = (): Promise<void> => engine.dbgStepOut();
export const dbgRestart = (): Promise<void> => engine.restart();
export const dbgStepBack = (): Promise<void> => engine.stepBack();
export const dbgReverseContinue = (): Promise<void> => engine.reverseContinue();
export const dbgTest = (): Promise<void> => engine.debugTest();
export const dbgRecordTest = (): Promise<void> => engine.recordTest();
/* r23 F2b: o auto-teste conduz a reprodução por aqui (e lê onde está) */
export const dbgOrigin = (expression: string): Promise<void> => engine.originOf(expression, false);
export const dbgChanges = (expression: string): Promise<void> => engine.changesOf(expression);
export const dbgTravel = (index: number): Promise<void> => engine.travelTo(index);
export const dbgReplayState = (): { replay: NonNullable<Session["replay"]>; stop: Session["stop"] } | null => (SESSION && SESSION.replay ? { replay: SESSION.replay, stop: SESSION.stop } : null);
export { dbgRunToCursor };
