/* ═══════════ feature `debug` — application: motor da sessão (ADR-0002, Fase 3) ═══════════
   Os casos de uso da depuração simulada, puros face ao mundo: recebem as capacidades
   por portas (`DebugDeps`) e dependem só de `domain/` (e de `esc`, pura, de
   `../../../core`). Sem DOM, sem `window`, sem Tauri — a composição (`features/debug.ts`)
   injecta os adaptadores do legacy-bridge e as funções de desenho.

   O comportamento é o do motor original de `features/debug.ts` (migrado 1:1): só mudou
   DE ONDE vêm o FS/estado/geradores/navegação/relógio — agora das portas, antes de
   globais `window.*`. O estado é mutado no SÍTIO (mesma referência que o resíduo
   publica em `window.DBG`/`window.BPS`), por isso os consumidores do monólito/v6
   continuam a vê-lo. */

import { esc } from "../../../core";
import { bpKey, bpLine } from "../domain/breakpoints";
import type { CodeStep, DbgSession, OpsStep } from "../domain/types";
import type { DebugDeps, DebugEngine } from "./ports";

export function makeDebugEngine(deps: DebugDeps): DebugEngine {
  const { store, workspace, lexer, scenarios, env, editor, shell, view, notifier, logger, human, checkpoint, clock } = deps;

  function dbgFeed(k: string, h: string): void { const s = store.session(); if (!s) return; s.feed.push({ k, h, t: clock.time() }); }

  function startDebug(id?: string): void {
    store.hydrate(); const ct = editor.currentTab();
    id = id || (ct && ct.path === workspace.lexPath() ? "lexer" : (scenarios.launch().find((c) => c.id.startsWith("crash")) || { id: "lexer" }).id);
    shell.goPane("debug"); if (shell.getVar("--panel-h") === "0px") shell.togglePanel(); shell.setVar("--panel-h", "300px");
    if (id === "lexer") {
      const v = lexer.variant();
      if (v === "bug") {
        const s: DbgSession = { id, kind: "pre", i: -1, steps: [], feed: [], h: {} }; store.setSession(s);
        dbgFeed("look", "Building <code>lexer</code> in debug mode…");
        dbgFeed("evidence", `<pre>error[E0382]: use of moved value: \`chars\`\n --> crates/lexer/src/lib.rs:${lexer.line(/chars\.peek\(\)/)}:8\n  |\n${lexer.line(/for c in/)} |     for c in chars {\n  |              ----- \`chars\` moved due to this implicit call to \`.into_iter()\`\n  |\nhelp: you can \`clone\` the value and consume it, but this might not be your desired behavior\n  |\n  |     for c in chars.clone() {\n  |                   ++++++++</pre>`);
        dbgFeed("think", `I cannot start a session: there is no binary until the borrow checker is satisfied. <code>rustc</code> offers <code>.clone()</code> — and even warns it “might not be your desired behavior”. That warning is the interesting part. Rather than guess, let's apply the suggestion and <b>watch what it does at runtime</b>; the test will tell us if it is right.`);
        s.offer = true; shell.setPanelTab("dbg"); view.renderPane(); view.draw(); return;
      }
      if (v === "other") { const s: DbgSession = { id, kind: "pre", i: -1, steps: [], feed: [], h: {} }; store.setSession(s); dbgFeed("think", "This edit is not one the prototype can step through. The desktop app runs the real test under <code>lldb</code> / <code>codelldb</code>, with the same assistant reading the frames."); shell.setPanelTab("dbg"); view.renderPane(); view.draw(); return; }
      const tr = scenarios.code(v); const s: DbgSession = { id, kind: "code", i: -1, steps: tr.steps, end: tr.end, feed: [], h: {}, hk: { eof: "Eof is never pushed", dig: "Digits are tokenized wrong", test: "The test expects the wrong thing" }, watch: ["chars.peek()", "tokens.len()"] }; store.setSession(s);
      const BPS = store.breakpoints(), lx = workspace.lexPath();
      if (![...BPS].some((b) => b.startsWith(lx + ":"))) BPS.add(bpKey(lx, lexer.line(/chars\.peek\(\)/))); editor.openPath(lx); dbgFeed("look", `Debugging <code>tokenize_emits_eof</code> on <code>lib.rs</code> as it is now (<code>${v === "clone" ? "for c in chars.clone()" : v === "byref" ? "for c in chars.by_ref()" : "while let"}</code>). Breakpoints: ${[...BPS].filter((b) => b.startsWith(lx)).map((b) => "line " + bpLine(b)).join(", ")}.`); dbgStep();
    } else {
      const [, e, n] = id.split(":"), tr = scenarios.ops(e, n); const s: DbgSession = { id, kind: "ops", i: -1, steps: tr.steps, end: tr.end, hk: tr.hk, feed: [], h: {} }; store.setSession(s); dbgFeed("look", `Attaching to <code>${esc(n)}</code> in ${env.label(e).toLowerCase()}. A crash-looping pod cannot be stepped like code, so I investigate the way you would: status, logs, a healthy peer, the configuration diff, then confirm. Press <kbd>F10</kbd> to run each probe.`); dbgStep();
    }
    shell.setPanelTab("dbg"); view.renderPane();
  }

  function dbgApplyClone(): void {
    if (human.owns("code")) { notifier.toast("Code is yours in this project — make the change yourself"); dbgFeed("think", `Make the change yourself on line ${lexer.line(/for c in/)}: <code>for c in chars.clone() {</code>, then press <kbd>F5</kbd>.`); editor.openPath(workspace.lexPath(), lexer.line(/for c in/)); view.draw(); return; }
    checkpoint.snapshot("Before trying rustc's .clone() suggestion"); workspace.writeFile(workspace.lexPath(), workspace.fileContent(workspace.lexPath()).replace("for c in chars {", "for c in chars.clone() {")); logger.log("debug", "applied rustc's .clone() suggestion to observe it"); startDebug("lexer");
  }

  function dbgStep(): void {
    const d = store.session(); if (!d || d.kind === "pre") return; if (d.i >= d.steps.length - 1) { dbgFinish(); return; } d.i++; const s = d.steps[d.i]; if (s.h) d.h = s.h;
    if (d.kind === "ops") { dbgFeed("cmd", `<pre class="notr">$ ${esc((s as OpsStep).cmd)}\n${esc((s as OpsStep).out)}</pre>`); dbgFeed(d.i === d.steps.length - 1 ? "evidence" : "think", s.n); } else dbgFeed((s as CodeStep).ev ? "evidence" : "think", `<span class="dbg-ln">line ${(s as CodeStep).l}</span> ${s.n}`);
    d.focus = s.focus; if (d.i >= d.steps.length - 1) dbgFinish(); view.refresh();
  }

  function dbgContinue(): void {
    const d0 = store.session(); if (!d0) { startDebug(); return; } if (d0.kind !== "code") { dbgStep(); return; } const d = d0, steps = d.steps as CodeStep[], from = d.i, lx = workspace.lexPath(), BPS = store.breakpoints();
    do {
      d.i++; if (d.i >= steps.length) { d.i = steps.length - 1; dbgFinish(); view.refresh(); return; } const s = steps[d.i]; if (s.h) d.h = s.h;
      if (s.focus === "how the loop consumes chars" && !BPS.has(bpKey(lx, s.l))) dbgFeed("think", `<span class="dbg-ln">line ${s.l} · passed</span> ${s.n}`);
      if (BPS.has(bpKey(lx, s.l)) || d.i === steps.length - 1) { const skipped = d.i - from - 1; if (skipped > 0) dbgFeed("look", `Ran ${skipped} step(s) to the next breakpoint.`); dbgFeed(s.ev ? "evidence" : "think", `<span class="dbg-ln">line ${s.l}</span> ${s.n}`); d.focus = s.focus; if (d.i >= steps.length - 1) dbgFinish(); break; }
    } while (true);
    view.refresh();
  }

  function dbgFinish(): void { const d = store.session(); if (!d || d.done) return; d.done = true; const end = d.end; if (!end) return; dbgFeed(end.ok ? "ok" : "root", `<b>${end.t}.</b> ${end.b}`); logger.log("debug", end.t); }

  function dbgStop(): void { store.setSession(null); shell.setVar("--panel-h", "230px"); view.refresh(); }

  function dbgFix(): void {
    const d = store.session(); if (!d || !d.end || !d.end.fix) return; const fix = d.end.fix; if (human.owns("code")) { notifier.toast("Code is yours in this project — apply the fix yourself"); editor.openPath(workspace.lexPath(), lexer.line(/for c in/)); return; }
    const old = workspace.fileContent(workspace.lexPath()), nw = fix(old); notifier.dlg({ title: "Apply the fix?", body: `<p>The Debug assistant proposes one line on <code>crates/lexer/src/lib.rs</code>:</p><pre class="notr">- ${esc(old.split("\n").find((l) => /for c in/.test(l))!.trim())}\n+ ${esc(nw.split("\n").find((l) => /for c in/.test(l))!.trim())}</pre><p>Then it re-runs the test under the debugger to confirm.</p>`, ok: "Apply and re-run", onOk: () => { checkpoint.snapshot("Before the Debug assistant fix"); workspace.writeFile(workspace.lexPath(), nw); startDebug("lexer"); } });
  }

  function toggleBp(p: string, l: number): void { store.hydrate(); const BPS = store.breakpoints(), k = bpKey(p, l); BPS.has(k) ? BPS.delete(k) : BPS.add(k); store.save(); view.refresh(); const t = editor.currentTab(); if (t && t.path === p) editor.paintEd(p); }

  return { startDebug, dbgFeed, dbgApplyClone, dbgStep, dbgContinue, dbgFinish, dbgStop, dbgFix, toggleBp };
}
