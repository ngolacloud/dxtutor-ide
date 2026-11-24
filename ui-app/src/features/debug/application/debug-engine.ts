/* ═══════════ feature `debug` — application: a sessão de depuração (ADR-0002, Fase 3) ═══════════
   Puros face ao mundo: recebem as capacidades por portas (`DebugDeps`) e dependem só de
   `domain/`. Sem DOM, sem `window`, sem Tauri.

   ADR-0006, R4 — depuração real pelo gdb do backend. «Start debugging» (F5): escolhe o programa
   (num projecto Cargo, `cargo build` e o binário em `target/debug/`, perguntando qual se houver
   vários; noutro projecto, o caminho do executável), lança o gdb na pasta, põe os breakpoints
   do gutter e corre. Quando pára, a vista abre o ficheiro na linha e mostra as variáveis locais
   e a pilha que o gdb dá; Continue/Step over/Step into/Stop seguem para o gdb. Um breakpoint
   acrescentado durante a sessão vai para o gdb. Sem gdb, di-lo (com o que instalar); nada é
   simulado. Uma operação de cada vez (o gdb é sequencial). */

import { bpKey, bpLine, bpPath } from "../domain/breakpoints";
import { cargoTargets, fsKeyFor, relOf, type Session, type Stop } from "../domain/session";
import { isPlain, sessionMarkdown, specsFor, type BpMeta, type VarNode, type Watch } from "../domain/dap";
import type { DebugDeps, DebugEngine } from "./ports";

/** O que dizer quando não há motor de depuração no sistema. */
export const NO_GDB = "O gdb não está instalado: a depuração passo-a-passo usa o gdb (Rust, C, C++). Instala-o (p.ex. «sudo apt install gdb») e tenta de novo.";

export function makeDebugEngine(deps: DebugDeps): DebugEngine {
  const { store, dbg, workspace, editor, shell, picker, view, notifier } = deps;
  let busy = false;
  /* A7: what a DAP session adds — watches and output last across sessions */
  const meta = deps.bpMeta ?? new Map<string, BpMeta>();
  const say = deps.say ?? ((k: string) => k);
  const watches: Watch[] = [];
  const output: string[] = [];
  /* the expanded variables: by path (stable across stops — the adapter renumbers the references
     at every stop) and, for the view, by the current stop's references */
  const openPaths = new Set<string>();
  const expanded = new Set<number>();
  let stopOnPanic = false;
  let outT: ReturnType<typeof setTimeout> | undefined;
  dbg.onOutput?.((id, category, text) => {
    const s = store.session();
    if (!s || s.id !== id || category === "telemetry") return;
    output.push(text);
    if (output.length > 400) output.splice(0, output.length - 400);
    clearTimeout(outT);
    outT = setTimeout(() => view.refresh(), 120);
  });
  const isDap = (s: Session | null): boolean => !!s && s.engine === "dap" && !!dbg.variables;

  const fail = (e: unknown): void => { store.setMessage("A depuração falhou: " + (e instanceof Error ? e.message : String(e))); };

  /** O programa a depurar: num projecto (ou workspace) Cargo, constrói-o e usa o binário em
   *  target/debug/; noutro, pergunta pelo executável. */
  async function chooseProgram(root: string): Promise<string | null> {
    const pre = workspace.fsRoot(), tomls: Record<string, string> = {};
    for (const k of workspace.keys()) if (k.startsWith(pre) && /(^|\/)Cargo\.toml$/.test(k) && !/\/target\//.test(k)) tomls[k.slice(pre.length)] = workspace.content(k) || "";
    if (workspace.content(pre + "Cargo.toml") != null) {
      const bins = cargoTargets(tomls, (rel) => workspace.content(pre + rel) != null);
      if (!bins.length) { store.setMessage("Este projecto Cargo não tem binários (só bibliotecas): não há programa para correr. Depura através de um binário ou de um exemplo."); return null; }
      const bin = bins.length > 1 ? await picker.choose("Que binário depurar?", bins) : bins[0] ?? null;
      if (!bin) return null;
      store.setMessage("A construir com «cargo build»…"); view.refresh();
      const b = await workspace.exec("cargo build");
      if (!b.ok) { store.setMessage("O «cargo build» falhou — corrige os erros e tenta de novo:\n" + b.out.slice(-2000)); return null; }
      return root.replace(/\/$/, "") + "/target/debug/" + bin;
    }
    const p = await picker.ask("Caminho do executável a depurar (compilado com informação de depuração, p.ex. -g)");
    if (!p || !p.trim()) return null;
    return p.trim().startsWith("/") ? p.trim() : root.replace(/\/$/, "") + "/" + p.trim();
  }

  /** Depois de cada paragem: o programa saiu, ou mostra onde parou com as variáveis e a pilha. */
  async function applyStop(id: string, st: Stop): Promise<void> {
    const s = store.session();
    if (!s || s.id !== id) return;
    if (st.exited || !st.stopped) {
      await dbg.stop(id).catch(() => undefined);
      store.setSession(null);
      store.setMessage(st.exited ? `O programa terminou${st.exitCode != null ? ` com o código ${st.exitCode}` : ""}.` : `A execução não parou num ponto conhecido (${st.reason || "sem razão"}).`);
      view.refresh();
      return;
    }
    const [locals, stack] = await Promise.all([dbg.locals(id).catch(() => []), dbg.stack(id).catch(() => [])]);
    store.setSession({ ...s, status: "stopped", stop: st, locals, stack, frame: 0, children: {} });
    if (isDap(s)) await loadFrame(id, 0);
    store.setMessage("");
    const key = fsKeyFor(st.file, workspace.root() || "", workspace.fsRoot());
    if (key && workspace.content(key) != null) editor.openPath(key, st.line);
    view.refresh();
  }

  async function guarded(f: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try { await f(); } catch (e) { fail(e); const s = store.session(); if (s) { await dbg.stop(s.id).catch(() => undefined); store.setSession(null); } view.refresh(); } finally { busy = false; }
  }

  async function startDebug(): Promise<void> {
    store.hydrate();
    const s0 = store.session();
    if (s0 && s0.status === "stopped") return dbgContinue();
    if (s0) return;
    shell.goPane("debug");
    const root = workspace.root();
    if (!root) { store.setMessage("Abre uma pasta (File → Open Folder…) para depurar o projecto."); view.refresh(); return; }
    await guarded(async () => {
      if (!(await dbg.available())) { store.setMessage(NO_GDB); view.refresh(); return; }
      const program = await chooseProgram(root);
      if (!program) { view.refresh(); return; }
      const id = deps.newId();
      store.setSession({ id, program, status: "starting", stop: null, locals: [], stack: [] }); store.setMessage(""); view.refresh();
      const info = await dbg.launch(id, program, root);
      const engine = info && info.engine === "dap" ? "dap" : "gdb";
      store.setSession({ ...store.session()!, engine, adapter: info ? info.adapter : "gdb" });
      output.length = 0;
      if (engine === "dap" && dbg.setBreakpoints) {
        for (const file of filesWithBreakpoints()) await sendFile(id, file);
        if (stopOnPanic && dbg.stopOnPanic) await dbg.stopOnPanic(id, true).catch(() => false);
      } else {
        for (const b of store.breakpoints()) await dbg.breakAt(id, relOf(bpPath(b), workspace.fsRoot()), +bpLine(b));
      }
      const s = store.session()!; store.setSession({ ...s, status: "running" }); view.refresh();
      await applyStop(id, await dbg.run(id));
    });
  }

  async function resume(f: (id: string) => Promise<Stop>): Promise<void> {
    const s = store.session();
    if (!s || s.status !== "stopped") { notifier.toast(s ? "Espera que a execução pare" : "Não há uma sessão de depuração — F5 para começar"); return; }
    await guarded(async () => { store.setSession({ ...s, status: "running" }); view.refresh(); await applyStop(s.id, await f(s.id)); });
  }

  const dbgContinue = (): Promise<void> => resume((id) => dbg.cont(id));
  const dbgStep = (into = false): Promise<void> => resume((id) => dbg.step(id, into));

  async function dbgStop(): Promise<void> {
    const s = store.session();
    if (!s) { notifier.toast("Não há uma sessão de depuração"); return; }
    await dbg.stop(s.id).catch(() => undefined);
    store.setSession(null); store.setMessage("Sessão terminada."); view.refresh();
  }

  function toggleBp(p: string, l: number): void {
    store.hydrate();
    const BPS = store.breakpoints(), k = bpKey(p, l), adding = !BPS.has(k);
    if (adding) BPS.add(k); else BPS.delete(k);
    store.save(); view.refresh();
    const t = editor.currentTab(); if (t && t.path === p) editor.paintEd(p);
    /* durante a sessão, um breakpoint novo vai já para o gdb (tirar um precisa do número do gdb:
       fica para a próxima sessão) */
    if (!adding) meta.delete(k);
    void persist(p);
    const s = store.session();
    if (isDap(s) && dbg.setBreakpoints) void sendFile(s!.id, p).catch(fail);
    else if (adding && s && s.status === "stopped") void dbg.breakAt(s.id, relOf(p, workspace.fsRoot()), l).catch(fail);
  }

  /* ───── A7: what a DAP session adds ───── */

  /** The files (FS keys) with breakpoints, enabled or not. */
  function filesWithBreakpoints(): string[] {
    return [...new Set([...store.breakpoints(), ...meta.keys()].map(bpPath))];
  }
  /** The breakpoint lines of a file (enabled ones in the Set, disabled ones only in the meta). */
  function linesOf(file: string): number[] {
    return [...new Set([...store.breakpoints(), ...meta.keys()].filter((k) => bpPath(k) === file).map((k) => +bpLine(k)))];
  }
  /** Sends a file's breakpoints (with their meta) to a live DAP session. */
  async function sendFile(id: string, file: string): Promise<void> {
    if (!dbg.setBreakpoints) return;
    const specs = specsFor(linesOf(file), (line) => meta.get(bpKey(file, line)) ?? (store.breakpoints().has(bpKey(file, line)) ? undefined : { enabled: false }));
    await dbg.setBreakpoints(id, relOf(file, workspace.fsRoot()), specs);
  }
  /** Keeps a file's breakpoints in the project database (desktop). */
  async function persist(file: string): Promise<void> {
    const root = workspace.root();
    if (!deps.project || !root) return;
    const list = linesOf(file).map((line) => {
      const k = bpKey(file, line), m = meta.get(k);
      return { file: relOf(file, workspace.fsRoot()), line, condition: m?.condition, hitCondition: m?.hitCondition, logMessage: m?.logMessage, enabled: m ? m.enabled : store.breakpoints().has(k) };
    });
    await deps.project.save(root, relOf(file, workspace.fsRoot()), list).catch(() => undefined);
  }

  /** The scopes of a frame, its locals expanded, and the watches evaluated in it. */
  async function loadFrame(id: string, level: number): Promise<void> {
    const s = store.session();
    if (!s || s.id !== id || !dbg.variables) return;
    expanded.clear();
    const [threads, scopes] = await Promise.all([dbg.threads ? dbg.threads(id).catch(() => []) : Promise.resolve([]), dbg.variables(id, level).catch(() => [] as VarNode[])]);
    const children: Record<number, VarNode[]> = {};
    const locals = scopes.find((x) => /local/i.test(x.name)) ?? scopes[0];
    if (locals) openPaths.add(locals.path);
    /* re-open what was open at the previous stop (same paths), a few levels deep */
    const open = async (nodes: VarNode[], depth: number): Promise<void> => {
      for (const n of nodes) {
        if (n.reference <= 0 || !openPaths.has(n.path) || depth > 4) continue;
        children[n.reference] = await dbg.variables!(id, level, n.reference).catch(() => []);
        expanded.add(n.reference);
        await open(children[n.reference], depth + 1);
      }
    };
    await open(scopes, 0);
    await evalWatches(id, level);
    const cur = store.session();
    if (cur && cur.id === id) store.setSession({ ...cur, frame: level, threads, scopes, children });
  }
  async function evalWatches(id: string, level: number): Promise<void> {
    if (!dbg.evaluate) return;
    for (const w of watches) {
      try { const r = await dbg.evaluate(id, w.expr, level); w.changed = w.value !== undefined && w.value !== r.value; w.value = r.value; w.error = undefined; }
      catch (e) { w.error = e instanceof Error ? e.message : String(e); w.value = undefined; }
    }
  }
  const stopped = (): Session | null => { const s = store.session(); return s && s.status === "stopped" ? s : null; };

  async function toggleVar(reference: number): Promise<void> {
    const s = stopped();
    if (!s || !dbg.variables) return;
    const all = [...(s.scopes ?? []), ...Object.values(s.children ?? {}).flat()];
    const node = all.find((n) => n.reference === reference);
    if (expanded.has(reference)) { expanded.delete(reference); if (node) openPaths.delete(node.path); view.refresh(); return; }
    expanded.add(reference);
    if (node) openPaths.add(node.path);
    if (!s.children?.[reference]) {
      const kids = await dbg.variables(s.id, s.frame ?? 0, reference).catch(() => []);
      const cur = store.session();
      if (cur && cur.id === s.id) store.setSession({ ...cur, children: { ...(cur.children ?? {}), [reference]: kids } });
    }
    view.refresh();
  }
  async function selectFrame(level: number): Promise<void> {
    const s = stopped();
    if (!s) return;
    const f = s.stack[level];
    const key = f ? fsKeyFor(f.file, workspace.root() || "", workspace.fsRoot()) : null;
    if (key && workspace.content(key) != null) editor.openPath(key, f!.line);
    if (isDap(s)) { await loadFrame(s.id, level); } else store.setSession({ ...s, frame: level });
    view.refresh();
  }
  async function selectThread(id: number): Promise<void> {
    const s = stopped();
    if (!s || !isDap(s)) return;
    const stack = await dbg.stack(s.id, id).catch(() => [] as typeof s.stack);
    store.setSession({ ...s, stack });
    await loadFrame(s.id, 0);
    view.refresh();
  }
  async function addWatch(expr: string): Promise<void> {
    const e = expr.trim();
    if (!e || watches.some((w) => w.expr === e)) return;
    watches.push({ expr: e });
    const s = stopped();
    if (s && isDap(s)) await evalWatches(s.id, s.frame ?? 0);
    view.refresh();
  }
  function removeWatch(i: number): void { watches.splice(i, 1); view.refresh(); }

  async function setStopOnPanic(on: boolean): Promise<void> {
    stopOnPanic = on;
    const s = store.session();
    if (isDap(s) && dbg.stopOnPanic) {
      const found = await dbg.stopOnPanic(s!.id, on).catch(() => false);
      if (on && !found) notifier.toast(say("panicNotFound"));
    }
    view.refresh();
  }

  async function editBreakpoint(key: string, m: BpMeta): Promise<void> {
    store.hydrate();
    if (isPlain(m)) meta.delete(key); else meta.set(key, { ...m });
    if (m.enabled) store.breakpoints().add(key); else store.breakpoints().delete(key);
    store.save();
    const file = bpPath(key);
    await persist(file);
    const s = store.session();
    if (isDap(s)) await sendFile(s!.id, file).catch(fail);
    else if (s && !isPlain(m)) notifier.toast(say("needsDap"));
    const t = editor.currentTab(); if (t && t.path === file) editor.paintEd(file);
    view.refresh();
  }

  async function removeBreakpoint(key: string): Promise<void> {
    store.hydrate();
    meta.delete(key);
    store.breakpoints().delete(key);
    store.save();
    const file = bpPath(key);
    await persist(file);
    const s = store.session();
    if (isDap(s)) await sendFile(s!.id, file).catch(fail);
    const t = editor.currentTab(); if (t && t.path === file) editor.paintEd(file);
    view.refresh();
  }

  async function loadKept(): Promise<void> {
    const root = workspace.root();
    if (!deps.project || !root) return;
    store.hydrate();
    const list = await deps.project.load(root).catch(() => []);
    for (const b of list) {
      const key = bpKey(workspace.fsRoot() + b.file, b.line);
      const m: BpMeta = { condition: b.condition ?? undefined, hitCondition: b.hitCondition ?? undefined, logMessage: b.logMessage ?? undefined, enabled: b.enabled };
      if (b.enabled) store.breakpoints().add(key);
      if (!isPlain(m)) meta.set(key, m);
    }
    if (list.length) { store.save(); view.refresh(); const t = editor.currentTab(); if (t && t.path) editor.paintEd(t.path); }
  }

  /** The variables of the selected frame for the snapshot and Co-Dev (the expanded locals, else the flat locals). */
  function frameVars(s: Session): VarNode[] {
    const loc = s.scopes?.find((x) => /local/i.test(x.name)) ?? s.scopes?.[0];
    const kids = loc ? s.children?.[loc.reference] : undefined;
    return kids ?? s.locals.map((v) => ({ name: v.name, value: v.value, type: "", reference: 0, changed: false, path: v.name }));
  }
  function markdownOf(s: Session): string {
    return sessionMarkdown({ program: s.program, stop: s.stop!, stack: s.stack, vars: frameVars(s), watches, output });
  }

  function askCodev(kind: "explain" | "test"): void {
    const s = stopped();
    if (!s || !s.stop || !deps.codev?.available()) { notifier.toast(say("needsStop")); return; }
    const key = fsKeyFor(s.stop.file, workspace.root() || "", workspace.fsRoot());
    const ctx = [{ kind: "problem" as const, label: `${s.stop.func} · ${s.stop.file.split("/").pop()}:${s.stop.line}`, text: markdownOf(s), ...(key ? { path: relOf(key, workspace.fsRoot()) } : {}) }];
    if (kind === "explain") deps.codev.ask({ intent: "explain", text: say("askExplainStop"), context: ctx, send: true });
    else deps.codev.ask({ intent: "change", text: say("askTestFromStop"), context: ctx, send: true });
  }

  async function snapshot(): Promise<void> {
    const s = stopped(), root = workspace.root();
    if (!s || !s.stop || !root || !deps.project) { notifier.toast(say("needsStop")); return; }
    const issues = await deps.project.issues(root).catch(() => []);
    const none = say("noIssue");
    const pick = await picker.choose(say("snapshotPick"), [none, ...issues.map((i) => `${i.key} — ${i.title}`)]);
    if (pick === null) return;
    const issue = pick === none ? null : pick.split(" — ")[0];
    const title = `Debug: ${s.stop.func} at ${s.stop.file.split("/").pop()}:${s.stop.line}`;
    await deps.project.snapshot(root, s.id, issue, title, markdownOf(s)).then(
      () => notifier.toast(issue ? say("snapshotSavedIssue", { issue }) : say("snapshotSaved")),
      (e) => fail(e),
    );
  }

  const dbgStepOut = (): Promise<void> => { const s = store.session(); if (!isDap(s)) { notifier.toast(say("needsDap")); return Promise.resolve(); } return resume((id) => dbg.step(id, false, "out")); };
  async function dbgPause(): Promise<void> {
    const s = store.session();
    if (!s || s.status !== "running" || !isDap(s) || !dbg.pause) return;
    await dbg.pause(s.id).catch(fail);
  }

  return {
    startDebug, dbgContinue, dbgStep, dbgStop, toggleBp,
    dbgStepOut, dbgPause, toggleVar, selectFrame, selectThread, addWatch, removeWatch, setStopOnPanic, editBreakpoint, removeBreakpoint, loadKept, askCodev, snapshot,
    extra: () => ({ watches, output, stopOnPanic, expanded }),
  };
}
