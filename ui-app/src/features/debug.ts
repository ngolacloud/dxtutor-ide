/* ═════════ dxtutor IDE — feature: Run and Debug (resíduo + composição) ═════════
   Feature DONA de toda a sua lógica: o motor de depuração simulado (sessão `DBG`,
   lançadores `debugConfigs`, breakpoints `BPS`, os traços `lexTrace`/`crashTrace` e os
   controlos `dbg*`) MAIS o render do pane «Run and Debug» (`renderDebugPane`) e do
   assistente (`drawDbg`, #pc-dbg).

   ADR-0002 (Clean Architecture). Estado actual:
   - Fase 1 — `window.*` confinado a `features/debug/infrastructure/legacy-bridge.ts`;
     este ficheiro deixou de ser `@ts-nocheck` (importa do bridge e de `../core`, e os
     tipos de `features/debug/domain/types.ts`).
   - Fase 2 — os geradores PUROS saíram para `features/debug/domain/`: `lexer-trace.ts`
     (buildLexTrace), `crash-trace.ts` (buildCrashTrace), `launch.ts`
     (buildLaunchConfigs) e `breakpoints.ts` (bpKey/bpLine/bpPath). Aqui ficam
     wrappers finos que injectam o mundo (lexLine/deps/segredos). A fase seguinte move
     o motor da sessão (`startDebug`/`dbg*`) para `features/debug/application/`.

   Fronteira: a feature DETÉM o estado (DBG/BPS, window-backed). Os CONSUMIDORES do
   motor ficam no monólito/v6 e lêem por global: os `onclick` inline do pane, o keydown
   /menus/CMD de v6.ts, e as fachadas SEM substring proibido `window.dbgState()` (sessão),
   `window.dbgBreaks` (Set) e `window.dbgLaunch()` (lançadores), que v6 usa em
   paintEd/badges.

   Mecânica: avalia ANTES de `app.ts`/`v6.ts` (ordem do index.html). Nada é lido
   ansiosamente no eval — o estado `BPS` nasce Set vazio e hidrata de `LS`
   PREGUIÇOSAMENTE (`hydrateBps`, guard-once) na primeira entrada; `DBG` espelha
   `window.DBG` via `writeSession`. */

import { $, hd, svg, esc, hhmm, toast, log, writeFile } from "../core";
import type { CodeStep, CodeTrace, CrashTrace, DbgSession, LaunchConfig, OpsStep } from "./debug/domain/types";
import { buildLexTrace } from "./debug/domain/lexer-trace";
import { buildCrashTrace } from "./debug/domain/crash-trace";
import { buildLaunchConfigs } from "./debug/domain/launch";
import { bpKey, bpLine, bpPath } from "./debug/domain/breakpoints";
import {
  readSession, writeSession, breakpoints,
  pLx, files, currentTab, pane, goPane, openPath, paintEd, setPanelTab, togglePanel, getVar, setVar, panes,
  lexVariant, lexLine,
  envState, envx, envLabels, localSecrets, urlHosts,
  isHuman, checkpoint, dlg, lsGet, lsSet, publish,
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

/* ───── traços simulados: wrappers finos sobre os geradores PUROS do domínio,
   injectando o mundo (número de linha do lexer; deps/segredos/host dos ambientes) ───── */
function lexTrace(v: string): CodeTrace { return buildLexTrace(v, lexLine); }
function crashTrace(env: string, n: string): CrashTrace {
  return buildCrashTrace({ env, n, deps: (envState(env) as EnvState).deps, sec: (envx().sec ?? {})[env] ?? {}, local: localSecrets(), ns: envx().ns[env], label: envLabels()[env], urlHosts });
}

/* ───── lançadores + motor de sessão ───── */
function debugConfigs(): LaunchConfig[] {
  return buildLaunchConfigs([{ env: "staging", state: envx().st.staging }, { env: "production", state: envx().st.production }]);
}
function startDebug(id?: string): void {
  hydrateBps(); const ct = currentTab();
  id = id || (ct && ct.path === pLx() ? "lexer" : (debugConfigs().find((c) => c.id.startsWith("crash")) || { id: "lexer" }).id);
  goPane("debug"); if (getVar("--panel-h") === "0px") togglePanel(); setVar("--panel-h", "300px");
  if (id === "lexer") {
    const v = lexVariant();
    if (v === "bug") {
      const s: DbgSession = { id, kind: "pre", i: -1, steps: [], feed: [], h: {} }; DBG = s; writeSession(s);
      dbgFeed("look", "Building <code>lexer</code> in debug mode…");
      dbgFeed("evidence", `<pre>error[E0382]: use of moved value: \`chars\`\n --> crates/lexer/src/lib.rs:${lexLine(/chars\.peek\(\)/)}:8\n  |\n${lexLine(/for c in/)} |     for c in chars {\n  |              ----- \`chars\` moved due to this implicit call to \`.into_iter()\`\n  |\nhelp: you can \`clone\` the value and consume it, but this might not be your desired behavior\n  |\n  |     for c in chars.clone() {\n  |                   ++++++++</pre>`);
      dbgFeed("think", `I cannot start a session: there is no binary until the borrow checker is satisfied. <code>rustc</code> offers <code>.clone()</code> — and even warns it “might not be your desired behavior”. That warning is the interesting part. Rather than guess, let's apply the suggestion and <b>watch what it does at runtime</b>; the test will tell us if it is right.`);
      s.offer = true; setPanelTab("dbg"); panes().debug(); drawDbg(); return;
    }
    if (v === "other") { const s: DbgSession = { id, kind: "pre", i: -1, steps: [], feed: [], h: {} }; DBG = s; writeSession(s); dbgFeed("think", "This edit is not one the prototype can step through. The desktop app runs the real test under <code>lldb</code> / <code>codelldb</code>, with the same assistant reading the frames."); setPanelTab("dbg"); panes().debug(); drawDbg(); return; }
    const tr = lexTrace(v); const s: DbgSession = { id, kind: "code", i: -1, steps: tr.steps, end: tr.end, feed: [], h: {}, hk: { eof: "Eof is never pushed", dig: "Digits are tokenized wrong", test: "The test expects the wrong thing" }, watch: ["chars.peek()", "tokens.len()"] }; DBG = s; writeSession(s);
    if (![...BPS].some((b) => b.startsWith(pLx() + ":"))) BPS.add(bpKey(pLx(), lexLine(/chars\.peek\(\)/))); openPath(pLx()); dbgFeed("look", `Debugging <code>tokenize_emits_eof</code> on <code>lib.rs</code> as it is now (<code>${v === "clone" ? "for c in chars.clone()" : v === "byref" ? "for c in chars.by_ref()" : "while let"}</code>). Breakpoints: ${[...BPS].filter((b) => b.startsWith(pLx())).map((b) => "line " + bpLine(b)).join(", ")}.`); dbgStep();
  } else {
    const [, e, n] = id.split(":"), tr = crashTrace(e, n); const s: DbgSession = { id, kind: "ops", i: -1, steps: tr.steps, end: tr.end, hk: tr.hk, feed: [], h: {} }; DBG = s; writeSession(s); dbgFeed("look", `Attaching to <code>${esc(n)}</code> in ${envLabels()[e].toLowerCase()}. A crash-looping pod cannot be stepped like code, so I investigate the way you would: status, logs, a healthy peer, the configuration diff, then confirm. Press <kbd>F10</kbd> to run each probe.`); dbgStep();
  }
  setPanelTab("dbg"); panes().debug();
}
function dbgFeed(k: string, h: string): void { if (!DBG) return; DBG.feed.push({ k, h, t: hhmm() }); }
function dbgApplyClone(): void {
  if (isHuman("code")) { toast("Code is yours in this project — make the change yourself"); dbgFeed("think", `Make the change yourself on line ${lexLine(/for c in/)}: <code>for c in chars.clone() {</code>, then press <kbd>F5</kbd>.`); openPath(pLx(), lexLine(/for c in/)); drawDbg(); return; }
  checkpoint("Before trying rustc's .clone() suggestion"); writeFile(pLx(), files()[pLx()].content.replace("for c in chars {", "for c in chars.clone() {")); log("debug", "applied rustc's .clone() suggestion to observe it"); startDebug("lexer");
}
function dbgStep(): void {
  if (!DBG || DBG.kind === "pre") return; const d = DBG; if (d.i >= d.steps.length - 1) { dbgFinish(); return; } d.i++; const s = d.steps[d.i]; if (s.h) d.h = s.h;
  if (d.kind === "ops") { dbgFeed("cmd", `<pre class="notr">$ ${esc((s as OpsStep).cmd)}\n${esc((s as OpsStep).out)}</pre>`); dbgFeed(d.i === d.steps.length - 1 ? "evidence" : "think", s.n); } else dbgFeed((s as CodeStep).ev ? "evidence" : "think", `<span class="dbg-ln">line ${(s as CodeStep).l}</span> ${s.n}`);
  d.focus = s.focus; if (d.i >= d.steps.length - 1) dbgFinish(); refreshDbg();
}
function dbgContinue(): void {
  if (!DBG) { startDebug(); return; } if (DBG.kind !== "code") { dbgStep(); return; } const d = DBG, steps = d.steps as CodeStep[]; const from = d.i;
  do {
    d.i++; if (d.i >= steps.length) { d.i = steps.length - 1; dbgFinish(); refreshDbg(); return; } const s = steps[d.i]; if (s.h) d.h = s.h;
    if (s.focus === "how the loop consumes chars" && !BPS.has(bpKey(pLx(), s.l))) dbgFeed("think", `<span class="dbg-ln">line ${s.l} · passed</span> ${s.n}`);
    if (BPS.has(bpKey(pLx(), s.l)) || d.i === steps.length - 1) { const skipped = d.i - from - 1; if (skipped > 0) dbgFeed("look", `Ran ${skipped} step(s) to the next breakpoint.`); dbgFeed(s.ev ? "evidence" : "think", `<span class="dbg-ln">line ${s.l}</span> ${s.n}`); d.focus = s.focus; if (d.i >= steps.length - 1) dbgFinish(); break; }
  } while (true);
  refreshDbg();
}
function dbgFinish(): void { if (!DBG || DBG.done) return; const d = DBG; d.done = true; const end = d.end; if (!end) return; dbgFeed(end.ok ? "ok" : "root", `<b>${end.t}.</b> ${end.b}`); log("debug", end.t); }
function dbgStop(): void { DBG = null; writeSession(null); setVar("--panel-h", "230px"); refreshDbg(); }
function dbgFix(): void {
  if (!DBG || !DBG.end || !DBG.end.fix) return; const fix = DBG.end.fix; if (isHuman("code")) { toast("Code is yours in this project — apply the fix yourself"); openPath(pLx(), lexLine(/for c in/)); return; }
  const old = files()[pLx()].content, nw = fix(old); dlg({ title: "Apply the fix?", body: `<p>The Debug assistant proposes one line on <code>crates/lexer/src/lib.rs</code>:</p><pre class="notr">- ${esc(old.split("\n").find((l) => /for c in/.test(l))!.trim())}\n+ ${esc(nw.split("\n").find((l) => /for c in/.test(l))!.trim())}</pre><p>Then it re-runs the test under the debugger to confirm.</p>`, ok: "Apply and re-run", onOk: () => { checkpoint("Before the Debug assistant fix"); writeFile(pLx(), nw); startDebug("lexer"); } });
}
const DBGK: Record<string, [string, string]> = { look: ["Looking at", "var(--blue)"], think: ["Analysing", "var(--accent-hover)"], evidence: ["Evidence", "var(--yellow)"], cmd: ["Probe", "var(--fg-muted)"], root: ["Root cause", "var(--red)"], ok: ["Verdict", "var(--green)"] };
function drawDbg(): void {
  hydrateBps(); const el = $("#pc-dbg"); if (!el) return; const d = DBG;
  if (!d) { el.innerHTML = `<div class="dbg-empty">${svg("bug")}<div><b>Debug assistant</b><p>Start a session (<kbd>F5</kbd>) and the assistant explains what it is looking at and why, keeps ranked hypotheses with the evidence for and against each, and suggests the next probe — like a senior engineer next to you, not a cursor jumping between lines.</p><button class="mini pri" onclick="startDebug()">Start debugging</button></div></div>`; return; }
  const hs = Object.entries(d.h || {}).sort((a, b) => b[1] - a[1]), probes: [string, string][] = []; if (d.kind === "code" && !d.done) { probes.push(["Step over (F10)", "dbgStep()"], ["Continue to breakpoint (F5)", "dbgContinue()"]); if (!d.watch!.includes("chars.peek()")) probes.push(["Watch chars.peek()", "DBG.watch.push('chars.peek()');refreshDbg()"]); }
  if (d.kind === "ops" && !d.done) probes.push(["Run next probe (F10)", "dbgStep()"]); if (d.offer) probes.push(["Apply rustc's suggestion and debug it", "dbgApplyClone()"]); if (d.done && d.end!.fix) probes.push(["Apply the fix and re-run", "dbgFix()"]); if (d.done && d.end!.act) probes.push(["Open the staging secrets", d.end!.act]); if (d.done) probes.push(["Explain this to me in depth", "explainCmd(true)"]);
  el.innerHTML = `<div class="dbg"><div class="dbg-feed" id="dbg-feed">${d.focus ? `<div class="dbg-focus">Now analysing: <b>${esc(d.focus)}</b></div>` : ""}${d.feed.map((f) => `<div class="df ${f.k}"><span class="dk" style="color:${DBGK[f.k][1]}">${DBGK[f.k][0]}</span><div>${f.h}</div></div>`).join("")}</div>
   <div class="dbg-side"><div class="dbg-t">Hypotheses</div>${hs.length ? hs.map(([k, v]) => `<div class="hy${v < 8 ? " out" : ""}"><div class="hy-h"><span>${d.hk![k]}</span><b>${v}%</b></div><i><b style="width:${v}%;background:${v >= 80 ? "var(--red)" : v < 8 ? "var(--fg-muted)" : "var(--accent)"}"></b></i></div>`).join("") : '<div class="sec-empty" style="padding:4px 0">Forming hypotheses once the session starts.</div>'}
   <div class="dbg-t">Next</div>${probes.map((p) => `<button class="dbg-p" onclick="${p[1]}">${p[0]}</button>`).join("")}</div></div>`; const f = $("#dbg-feed"); if (f) f.scrollTop = f.scrollHeight;
}
function refreshDbg(): void {
  drawDbg(); if (pane() === "debug") panes().debug(); const t = currentTab();
  if (t && t.path === pLx() && t.kind === "file") { paintEd(pLx()); const s = DBG && DBG.kind === "code" ? (DBG.steps[DBG.i] as CodeStep) : null; if (s) { const eb = $("#ebody"); if (eb) eb.scrollTop = Math.max(0, (s.l - 1) * 22 - 140); } }
}
function toggleBp(p: string, l: number): void { hydrateBps(); const k = bpKey(p, l); BPS.has(k) ? BPS.delete(k) : BPS.add(k); saveBps(); refreshDbg(); const t = currentTab(); if (t && t.path === p) paintEd(p); }
document.addEventListener("click", (e) => { const g = (e.target as HTMLElement | null)?.closest("#ed-gut div"); if (!g) return; const t = currentTab(); if (!t || !t.path || t.kind !== "file") return; toggleBp(t.path, [...g.parentElement!.children].indexOf(g) + 1); });

/** Renderiza o pane «Run and Debug»: controlo da sessão, lançadores, variáveis,
 *  watch, call stack, probes e breakpoints. Render puro sobre `DBG`/`BPS`. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug"), cf = debugConfigs(), session = DBG, s = (session && session.kind === "code" ? session.steps[session.i] : null) as CodeStep | null;
  if (!el) return;
  el.innerHTML = hd("Run and Debug", `<button title="Start debugging (F5)" onclick="startDebug()">${svg("run")}</button>`) + `<div class="sections">${session ? `<div class="dbg-ctl"><button title="Continue (F5)" onclick="dbgContinue()">▶</button><button title="Step over (F10)" onclick="dbgStep()">↷</button><button title="Restart" onclick="startDebug(DBG.id)">↻</button><button title="Stop (Shift+F5)" onclick="dbgStop()">■</button><span class="notr">${esc((cf.find((c) => c.id === session.id) || { l: session.id }).l)}</span></div>` : ""}
   ${!session ? `<div class="scm-grp">Launch</div>${cf.map((c) => `<div class="scm-row" onclick="startDebug('${c.id}')"><span class="ic" style="color:${c.id.startsWith("crash") ? "var(--red)" : "var(--green)"}">${svg(c.id.startsWith("crash") ? "bug" : "run")}</span><span class="nm notr" style="max-width:none">${esc(c.l)}</span></div><div class="sec-empty" style="padding-top:0;padding-left:34px">${esc(c.d)}</div>`).join("")}<button class="btn" onclick="startDebug()">Start debugging (F5)</button>` : ""}
   ${session && session.kind === "code" ? `<div class="scm-grp">Variables</div>${s ? Object.entries(s.v).map(([k, v]) => `<div class="dv"><span class="k notr">${esc(k)}</span><span class="v notr">${esc(v)}</span></div>`).join("") : ""}
   <div class="scm-grp">Watch</div>${session.watch!.map((w: string, i: number) => { const val = s ? (w === "chars.peek()" ? (s.v["chars.peek()"] || (/next '1'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('1')" : /next '2'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('2')" : "None")) : w === "tokens.len()" ? (s.v["tokens: Vec<Token>"].match(/len (\d+)/) || [])[1] : "not available in the prototype") : ""; return `<div class="dv"><span class="k notr">${esc(w)}</span><span class="v notr">${esc(val)}</span><button onclick="DBG.watch.splice(${i},1);refreshDbg()">×</button></div>`; }).join("")}<input class="inp notr" placeholder="Add expression" onchange="if(this.value.trim()){DBG.watch.push(this.value.trim());refreshDbg()}">
   <div class="scm-grp">Call stack</div>${s ? [`lexer::tokenize · lib.rs:${s.l}`, "lexer::tests::tokenize_emits_eof", "test::run_test · std"].map((f, i) => `<div class="dv${i ? "" : " top"}"><span class="k notr">${esc(f)}</span></div>`).join("") : ""}` : ""}
   ${session && session.kind === "ops" ? `<div class="scm-grp">Probes</div>${(session.steps as OpsStep[]).map((p, i: number) => `<div class="dv${i === session.i ? " top" : ""}"><span class="k" style="color:${i <= session.i ? "var(--green)" : "var(--fg-muted)"}">${i <= session.i ? "✓" : "○"}</span><span class="v notr" style="text-align:left">${esc(p.cmd)}</span></div>`).join("")}` : ""}
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${[...BPS].map((b) => { const l = bpLine(b), p = bpPath(b); return `<div class="scm-row" onclick="openPath('${p}',${l})"><span class="bpd"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span><span class="ra" style="display:flex"><button onclick="event.stopPropagation();BPS.delete('${b}');saveBps();refreshDbg()">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}
   <div class="sec-empty">Sessions are simulated in the browser. The desktop app drives lldb / delve / debugpy through the Debug Adapter Protocol; the assistant reads the same frames.</div></div>`;
}

/* ── publicação no window (via bridge) ──
   • `renderDebugPane` — RP.debug (v6) delega (lazy, no switch de pane).
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
