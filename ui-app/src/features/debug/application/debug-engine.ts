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
import { bpActive, isPlain, sessionMarkdown, specsFor, type BpMeta, type VarNode, type Watch } from "../domain/dap";
import { timeTravelWhy, type HostCaps } from "../domain/caps";
import { firstUserFrame, isUserFrame } from "../domain/frames";
import { isPanicStop, panicText, parsePanic } from "../domain/exception";
import { historyStep, remember, testArgs, testPicks, type ConsoleLine } from "../domain/console";
import type { AttachTarget, DebugDeps, DebugEngine, DebugSettings } from "./ports";
import { ptCopy } from "./messages";

/** O que dizer quando não há motor de depuração no sistema. */

export function makeDebugEngine(deps: DebugDeps): DebugEngine {
  const { store, dbg, workspace, editor, shell, picker, view, notifier } = deps;
  let busy = false;
  /* A7: what a DAP session adds — watches and output last across sessions */
  const meta = deps.bpMeta ?? new Map<string, BpMeta>();
  const say = deps.say ?? ((k: string) => k);
  const copy = deps.copy ?? ptCopy;
  const watches: Watch[] = [];
  const output: string[] = [];
  /* the expanded variables: by path (stable across stops — the adapter renumbers the references
     at every stop) and, for the view, by the current stop's references */
  const openPaths = new Set<string>();
  const expanded = new Set<number>();
  let stopOnPanic = false;
  let outT: ReturnType<typeof setTimeout> | undefined;
  /* r23 F2: what the host can do (asked once), the console, the settings kept per project */
  let hostCaps: HostCaps | null = null;
  let hostP: Promise<HostCaps | null> | null = null;
  const consoleLines: ConsoleLine[] = [];
  let history: string[] = [];
  let histIdx = 0;
  const groupsOff = new Set<string>();
  /** the triggers hit in this session (`path:line`): the breakpoints waiting on them are armed */
  const armed = new Set<string>();
  let jmc = true;
  const libOpen = new Set<number>();
  const excFilters = new Set<string>();
  let settingsRoot: string | null = null;
  const clock = deps.clock ?? (() => Date.now());
  let resumedAt: number | null = null;
  /** «Debug Test…» stops on panic for that session only (the human's setting is left as it was) */
  let panicThisSession = false;
  dbg.onOutput?.((id, category, text) => {
    const s = store.session();
    if (!s || s.id !== id || category === "telemetry") return;
    output.push(text);
    if (output.length > 400) output.splice(0, output.length - 400);
    /* r23 F2: the adapter can deliver the panic's message after the stop: read it when it comes */
    if (s.status === "stopped" && !s.panic && isPanicStop([s.stop?.func ?? "", ...s.stack.map((f) => f.func)])) {
      const p = parsePanic(output.join(""));
      if (p) store.setSession({ ...s, panic: p });
    }
    clearTimeout(outT);
    outT = setTimeout(() => view.refresh(), 120);
  });
  const isDap = (s: Session | null): boolean => !!s && s.engine === "dap" && !!dbg.variables;

  /** The host's capabilities: asked once, kept (null without the command or on failure). */
  function host(): Promise<HostCaps | null> {
    if (!hostP) hostP = (dbg.capabilities ? Promise.resolve().then(() => dbg.capabilities!()).catch(() => null) : Promise.resolve(null)).then((h) => { hostCaps = h; return h; });
    return hostP;
  }

  /* the settings of the open folder: read when it changes, written when one changes */
  function settings(): void {
    const root = workspace.root();
    if (!deps.settings || !root || root === settingsRoot) return;
    settingsRoot = root;
    const k = deps.settings.load(root);
    if (!k) return;
    watches.splice(0, watches.length, ...k.watches.map((expr) => ({ expr })));
    groupsOff.clear(); k.groupsOff.forEach((g) => groupsOff.add(g));
    jmc = k.jmc; stopOnPanic = k.stopOnPanic;
    excFilters.clear(); k.exceptionFilters.forEach((f) => excFilters.add(f));
    history = k.history.slice(); histIdx = history.length;
  }
  function keep(): void {
    const root = workspace.root();
    if (!deps.settings || !root) return;
    const k: DebugSettings = { watches: watches.map((w) => w.expr), groupsOff: [...groupsOff], jmc, stopOnPanic, exceptionFilters: [...excFilters], history };
    deps.settings.save(root, k);
  }

  const fail = (e: unknown): void => { store.setMessage(copy("failed", { error: e instanceof Error ? e.message : String(e) })); };

  /** O programa a depurar: num projecto (ou workspace) Cargo, constrói-o e usa o binário em
   *  target/debug/; noutro, pergunta pelo executável. */
  async function chooseProgram(root: string): Promise<string | null> {
    const pre = workspace.fsRoot(), tomls: Record<string, string> = {};
    for (const k of workspace.keys()) if (k.startsWith(pre) && /(^|\/)Cargo\.toml$/.test(k) && !/\/target\//.test(k)) tomls[k.slice(pre.length)] = workspace.content(k) || "";
    if (workspace.content(pre + "Cargo.toml") != null) {
      const bins = cargoTargets(tomls, (rel) => workspace.content(pre + rel) != null);
      if (!bins.length) { store.setMessage(copy("noBins")); return null; }
      const bin = bins.length > 1 ? await picker.choose(copy("whichBin"), bins) : bins[0] ?? null;
      if (!bin) return null;
      store.setMessage("A construir com «cargo build»…"); view.refresh();
      const b = await workspace.exec("cargo build");
      if (!b.ok) { store.setMessage(copy("buildFailed", { out: b.out.slice(-2000) })); return null; }
      return root.replace(/\/$/, "") + "/target/debug/" + bin;
    }
    const p = await picker.ask(copy("exePath"));
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
      store.setMessage(st.exited ? `O programa terminou${st.exitCode != null ? ` com o código ${st.exitCode}` : ""}.` : copy("notStopped", { reason: st.reason || copy("noReason") }));
      view.refresh();
      return;
    }
    const [locals, stack] = await Promise.all([dbg.locals(id).catch(() => []), dbg.stack(id).catch(() => [])]);
    const root = workspace.root() || "";
    /* r23 F2: the time the program ran, a panic read from its output, and — with Just My Code —
       the first frame of the human's code when it stopped inside a library (a panic stops in std) */
    const perfMs = resumedAt != null ? Math.max(0, clock() - resumedAt) : undefined;
    resumedAt = null;
    const panic = isPanicStop([st.func, ...stack.map((f) => f.func)]) ? parsePanic(output.join("")) : null;
    const user = jmc && !isUserFrame(st.file, root) ? firstUserFrame(stack.map((f) => f.file), root) : 0;
    const sel = user > 0 ? user : 0;
    store.setSession({ ...s, status: "stopped", stop: st, locals, stack, frame: sel, children: {}, perfMs, stops: (s.stops ?? 0) + 1, panic, memory: null });
    if (isDap(s)) await loadFrame(id, sel);
    store.setMessage("");
    await arm(id, st);
    const f = stack[sel], at = f && sel > 0 ? f : { file: st.file, line: st.line };
    const key = fsKeyFor(at.file, root, workspace.fsRoot());
    if (key && workspace.content(key) != null) editor.openPath(key, at.line);
    view.refresh();
  }

  /** A stop on a breakpoint arms the ones that wait for it (sent to the adapter from now on). */
  async function arm(id: string, st: Stop): Promise<void> {
    const key = fsKeyFor(st.file, workspace.root() || "", workspace.fsRoot());
    if (!key || !st.line) return;
    const k = bpKey(key, st.line);
    if (armed.has(k) || !store.breakpoints().has(k)) return;
    const waiting = [...meta.entries()].filter(([, m]) => m.trigger === k).map(([b]) => bpPath(b));
    armed.add(k);
    for (const file of new Set(waiting)) await sendFile(id, file).catch(() => undefined);
  }

  async function guarded(f: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try { await f(); } catch (e) { fail(e); const s = store.session(); if (s) { await dbg.stop(s.id).catch(() => undefined); store.setSession(null); } view.refresh(); } finally { busy = false; }
  }

  async function startDebug(): Promise<void> {
    store.hydrate(); settings();
    const s0 = store.session();
    if (s0 && s0.status === "stopped") return dbgContinue();
    if (s0) return;
    shell.goPane("debug");
    const root = workspace.root();
    if (!root) { store.setMessage(copy("openFolder")); view.refresh(); return; }
    await guarded(async () => {
      if (!(await dbg.available())) { store.setMessage(copy("noGdb")); view.refresh(); return; }
      const program = await chooseProgram(root);
      if (!program) { view.refresh(); return; }
      await launchSession(program, [], root);
    });
  }

  /** Launches `program` (with `args`, in `cwd`), sends the breakpoints and the exception settings,
   *  and runs to the first stop. Called inside `guarded`. */
  async function launchSession(program: string, args: string[], cwd: string, panic = false): Promise<void> {
    panicThisSession = panic;
    const id = deps.newId();
    armed.clear(); libOpen.clear(); consoleLines.length = 0;
    store.setSession({ id, program, status: "starting", stop: null, locals: [], stack: [], args, cwd, stops: 0, panicOnStart: panic }); store.setMessage(""); view.refresh();
    const info = await (args.length ? dbg.launch(id, program, cwd, args) : dbg.launch(id, program, cwd));
    const engine = info && info.engine === "dap" ? "dap" : "gdb";
    store.setSession({ ...store.session()!, engine, adapter: info ? info.adapter : "gdb", caps: info ? info.caps ?? null : null });
    output.length = 0;
    if (engine === "dap" && dbg.setBreakpoints) {
      for (const file of filesWithBreakpoints()) await sendFile(id, file);
      if ((stopOnPanic || panicThisSession) && dbg.stopOnPanic) await dbg.stopOnPanic(id, true).catch(() => false);
      const offered = new Set((info && info.caps?.exceptionFilters.map((f) => f.filter)) ?? []);
      const on = [...excFilters].filter((f) => offered.has(f));
      if (on.length && dbg.exceptionFilters) await dbg.exceptionFilters(id, on).catch(() => []);
    } else {
      for (const b of store.breakpoints()) await dbg.breakAt(id, relOf(bpPath(b), workspace.fsRoot()), +bpLine(b));
    }
    const s = store.session()!; store.setSession({ ...s, status: "running" }); view.refresh();
    resumedAt = clock();
    await applyStop(id, await dbg.run(id));
  }

  async function resume(f: (id: string) => Promise<Stop>): Promise<void> {
    const s = store.session();
    if (!s || s.status !== "stopped") { notifier.toast(copy(s ? "waitStop" : "noSessionF5")); return; }
    await guarded(async () => { store.setSession({ ...s, status: "running" }); view.refresh(); resumedAt = clock(); await applyStop(s.id, await f(s.id)); });
  }

  const dbgContinue = (): Promise<void> => resume((id) => dbg.cont(id));
  const dbgStep = (into = false): Promise<void> => resume((id) => dbg.step(id, into));

  async function dbgStop(): Promise<void> {
    const s = store.session();
    if (!s) { notifier.toast(copy("noSession")); return; }
    await dbg.stop(s.id).catch(() => undefined);
    store.setSession(null); store.setMessage(copy("ended")); view.refresh();
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
    const specs = specsFor(linesOf(file), (line) => {
      const k = bpKey(file, line), m = meta.get(k) ?? (store.breakpoints().has(k) ? undefined : { enabled: false });
      return m && !bpActive(m, groupsOff, armed) ? { ...m, enabled: false } : m;
    });
    await dbg.setBreakpoints(id, relOf(file, workspace.fsRoot()), specs);
  }
  /** Keeps a file's breakpoints in the project database (desktop). */
  async function persist(file: string): Promise<void> {
    const root = workspace.root();
    if (!deps.project || !root) return;
    const list = linesOf(file).map((line) => {
      const k = bpKey(file, line), m = meta.get(k);
      return { file: relOf(file, workspace.fsRoot()), line, condition: m?.condition, hitCondition: m?.hitCondition, logMessage: m?.logMessage, enabled: m ? m.enabled : store.breakpoints().has(k), ...(m?.trigger ? { trigger: relOf(m.trigger, workspace.fsRoot()) } : {}), ...(m?.group ? { group: m.group } : {}) };
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
    watches.push({ expr: e }); keep();
    const s = stopped();
    if (s && isDap(s)) await evalWatches(s.id, s.frame ?? 0);
    view.refresh();
  }
  function removeWatch(i: number): void { watches.splice(i, 1); keep(); view.refresh(); }

  async function setStopOnPanic(on: boolean): Promise<void> {
    stopOnPanic = on; panicThisSession = false; keep();
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
      const m: BpMeta = { condition: b.condition ?? undefined, hitCondition: b.hitCondition ?? undefined, logMessage: b.logMessage ?? undefined, enabled: b.enabled, ...(b.trigger ? { trigger: workspace.fsRoot() + b.trigger } : {}), ...(b.group ? { group: b.group } : {}) };
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
    const ctx = [{ kind: "frame" as const, label: `${s.stop.func} · ${s.stop.file.split("/").pop()}:${s.stop.line}`, text: markdownOf(s), ...(key ? { path: relOf(key, workspace.fsRoot()) } : {}) }];
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

  /* ───── A10: attach to a running process ───── */
  async function attach(): Promise<void> {
    store.hydrate();
    if (store.session()) { notifier.toast(say("attachBusy")); return; }
    const root = workspace.root();
    if (!dbg.attach || !dbg.attachTargets) { notifier.toast(say("needsDap")); return; }
    const kt = deps.kubeTarget?.() ?? null;
    const kinds: Array<[AttachTarget["kind"], string]> = [["local", say("attachLocal")], ["docker", say("attachDocker")], ["podman", say("attachPodman")], ...(kt ? [["kubectl", say("attachPod", { c: kt.context, n: kt.namespace })] as [AttachTarget["kind"], string]] : [])];
    const kindLabel = await picker.choose(say("attachKindPh"), kinds.map((k) => k[1]));
    if (kindLabel === null) return;
    const kind = kinds.find((k) => k[1] === kindLabel)![0];
    const target: AttachTarget = { kind, name: "", context: kt?.context ?? "", namespace: kt?.namespace ?? "", kubeconfig: kt?.kubeconfig ?? "" };
    if (kind !== "local") {
      const places = await dbg.attachTargets(target).catch((e) => ({ ok: false, places: [], processes: [], adapter: null, notes: String(e) }));
      if (!places.ok || !places.places.length) { notifier.toast(places.notes || say("attachNothing")); return; }
      const name = await picker.choose(say(kind === "kubectl" ? "attachPodPh" : "attachContainerPh"), places.places);
      if (name === null) return;
      target.name = name;
    }
    const inside = await dbg.attachTargets(target).catch((e) => ({ ok: false, places: [], processes: [], adapter: null, notes: String(e) }));
    if (!inside.ok) { notifier.toast(inside.notes); return; }
    if (!inside.adapter) { store.setMessage(inside.notes || say("attachNoAdapter")); view.refresh(); return; }
    const labels = inside.processes.map((p) => `${p.pid} · ${p.command}`);
    const pickP = await picker.choose(say("attachProcPh"), labels);
    if (pickP === null) return;
    const pid = Number(pickP.split(" · ")[0]);
    let remoteRoot: string | null = null;
    if (kind !== "local") {
      const r = await picker.ask(say("attachRemoteRootPh"));
      if (r === null) return;
      remoteRoot = r.trim() || null;
    }
    const id = deps.newId();
    const program = `${kind === "local" ? "" : `${target.name}:`}${pickP.split(" · ").slice(1).join(" · ").split(" ")[0]} (pid ${pid})`;
    store.setSession({ id, program, status: "starting", stop: null, locals: [], stack: [] }); store.setMessage(""); view.refresh();
    await guarded(async () => {
      const info = await dbg.attach!(id, target, pid, inside.adapter, root, remoteRoot);
      store.setSession({ ...store.session()!, engine: "dap", adapter: info.adapter });
      output.length = 0;
      for (const file of filesWithBreakpoints()) await sendFile(id, file);
      if (stopOnPanic && dbg.stopOnPanic) await dbg.stopOnPanic(id, true).catch(() => false);
      const s = store.session()!; store.setSession({ ...s, status: "running" }); view.refresh();
      await applyStop(id, await dbg.run(id));
    });
  }

  const dbgStepOut = (): Promise<void> => { const s = store.session(); if (!isDap(s)) { notifier.toast(say("needsDap")); return Promise.resolve(); } return resume((id) => dbg.step(id, false, "out")); };
  async function dbgPause(): Promise<void> {
    const s = store.session();
    if (!s || s.status !== "running" || !isDap(s) || !dbg.pause) return;
    await dbg.pause(s.id).catch(fail);
  }

  /* ───── r23 F2 ───── */

  const needStopped = (): Session | null => { const s = stopped(); if (!s) notifier.toast(copy(store.session() ? "waitStop" : "noSessionF5")); return s; };

  async function restart(): Promise<void> {
    const s = store.session();
    if (!s) return startDebug();
    if (s.status === "starting") return;
    await dbg.stop(s.id).catch(() => undefined);
    store.setSession(null);
    const root = workspace.root();
    if (!root) return;
    await guarded(() => launchSession(s.program, s.args ?? [], s.cwd ?? root, !!s.panicOnStart));
  }

  async function runToCursor(path: string, line: number): Promise<void> {
    const s = needStopped();
    if (!s) return;
    if (!isDap(s) || !dbg.runTo) { notifier.toast(say("needsDap")); return; }
    if (!path || line < 1) return;
    await resume((id) => dbg.runTo!(id, relOf(path, workspace.fsRoot()), line));
  }

  async function restartFrame(): Promise<void> {
    const s = needStopped();
    if (!s) return;
    if (!s.caps?.restartFrame || !dbg.restartFrame) { notifier.toast(say(isDap(s) ? "rframe-adapter" : "needs-dap", { adapter: s.adapter ?? "" })); return; }
    const level = s.frame ?? 0;
    await resume((id) => dbg.restartFrame!(id, level));
  }

  /** Time travel needs a recording (rr): without one, say what is missing. */
  async function noTimeTravel(): Promise<void> {
    const h = await host();
    const w = timeTravelWhy(h);
    notifier.toast(say(w.why, w.params));
  }
  const stepBack = (): Promise<void> => noTimeTravel();
  const reverseContinue = (): Promise<void> => noTimeTravel();

  async function consoleEval(expr: string): Promise<void> {
    const e = expr.trim();
    if (!e) return;
    history = remember(history, e); histIdx = history.length; keep();
    consoleLines.push({ kind: "in", text: e });
    const s = stopped();
    if (!s || !isDap(s) || !dbg.evaluate) consoleLines.push({ kind: "err", text: say(s ? "needsDap" : "needsStop") });
    else {
      try { const r = await dbg.evaluate(s.id, e, s.frame ?? 0, "repl"); consoleLines.push({ kind: "out", text: r.value }); }
      catch (err) { consoleLines.push({ kind: "err", text: err instanceof Error ? err.message : String(err) }); }
    }
    if (consoleLines.length > 300) consoleLines.splice(0, consoleLines.length - 300);
    view.refresh();
  }
  function consoleHistory(dir: -1 | 1): string { const r = historyStep(history, histIdx, dir); histIdx = r.idx; return r.text; }
  function consoleClear(): void { consoleLines.length = 0; view.refresh(); }

  async function debugTest(): Promise<void> {
    store.hydrate(); settings();
    if (store.session()) { notifier.toast(say("attachBusy")); return; }
    shell.goPane("debug");
    const root = workspace.root();
    if (!root) { store.setMessage(copy("openFolder")); view.refresh(); return; }
    if (!dbg.testTargets) { notifier.toast(say("needsDap")); return; }
    await guarded(async () => {
      if (!(await dbg.available())) { store.setMessage(copy("noGdb")); view.refresh(); return; }
      store.setMessage(say("buildingTests")); view.refresh();
      let bins;
      try { bins = await dbg.testTargets!(root); } catch (e) { store.setMessage(e instanceof Error ? e.message : String(e)); view.refresh(); return; }
      const picks = testPicks(bins);
      store.setMessage("");
      if (!picks.length) { store.setMessage(say("noTests")); view.refresh(); return; }
      const label = await picker.choose(say("whichTest"), picks.map((p) => p.label));
      const pick = picks.find((p) => p.label === label);
      if (!pick) { view.refresh(); return; }
      /* a failing test panics: stop there (this session only; the setting stays as the human left it) */
      await launchSession(pick.binary.executable, testArgs(pick.name), pick.binary.cwd || root, true);
    });
  }

  async function setExceptionFilter(filter: string, on: boolean): Promise<void> {
    if (filter === "rust_panic") return setStopOnPanic(on);
    if (on) excFilters.add(filter); else excFilters.delete(filter);
    keep();
    const s = store.session();
    if (isDap(s) && dbg.exceptionFilters) {
      const offered = new Set(s!.caps?.exceptionFilters.map((f) => f.filter) ?? []);
      await dbg.exceptionFilters(s!.id, [...excFilters].filter((f) => offered.has(f))).catch(fail);
    }
    view.refresh();
  }

  /** The container (a scope or a parent variable) a variable was listed in. */
  function parentOf(s: Session, reference: number, name: string): number | null {
    for (const [p, kids] of Object.entries(s.children ?? {})) if (kids.some((k) => k.reference === reference && k.name === name)) return +p;
    return null;
  }
  function nodeByPath(s: Session, path: string): { node: VarNode; parent: number | null } | null {
    for (const [p, kids] of Object.entries(s.children ?? {})) { const n = kids.find((k) => k.path === path); if (n) return { node: n, parent: +p }; }
    return null;
  }

  async function addDataBreakpoint(reference: number, name: string): Promise<void> {
    const s = needStopped();
    if (!s) return;
    if (!s.caps?.dataBreakpoints || !dbg.dataBreakpoints) { notifier.toast(say("noDataBps")); return; }
    void reference;
    const found = Object.values(s.children ?? {}).flat().find((k) => k.name === name && k.reference === reference);
    const parent = found ? parentOf(s, reference, name) : null;
    try {
      const list = await dbg.dataBreakpoints(s.id, { frame: s.frame ?? 0, reference: parent, name }, null);
      const cur = store.session(); if (cur && cur.id === s.id) store.setSession({ ...cur, dataBps: list });
      const added = list[list.length - 1];
      if (added && !added.verified) notifier.toast(added.message || say("dataBpNotSet"));
    } catch (e) { notifier.toast(e instanceof Error ? e.message : String(e)); }
    view.refresh();
  }
  async function removeDataBreakpoint(dataId: string): Promise<void> {
    const s = store.session();
    if (!s || !dbg.dataBreakpoints) return;
    const list = await dbg.dataBreakpoints(s.id, null, dataId).catch(() => (s.dataBps ?? []).filter((d) => d.dataId !== dataId));
    const cur = store.session(); if (cur && cur.id === s.id) store.setSession({ ...cur, dataBps: list });
    view.refresh();
  }

  async function viewMemory(path: string): Promise<void> {
    const s = needStopped();
    if (!s) return;
    const hit = nodeByPath(s, path);
    const ref = hit?.node.memoryReference;
    if (!s.caps?.readMemory || !dbg.readMemory || !ref) { notifier.toast(say("noMemory")); return; }
    try {
      const m = await dbg.readMemory(s.id, ref, 0, 128);
      const cur = store.session(); if (cur && cur.id === s.id) store.setSession({ ...cur, memory: { name: hit!.node.name, ...m } });
    } catch (e) { notifier.toast(e instanceof Error ? e.message : String(e)); }
    view.refresh();
  }
  function closeMemory(): void { const s = store.session(); if (s) store.setSession({ ...s, memory: null }); view.refresh(); }

  async function setTrigger(key: string, trigger: string | null): Promise<void> {
    store.hydrate();
    const cur: BpMeta = { ...(meta.get(key) ?? { enabled: true }) };
    if (trigger && trigger !== key) cur.trigger = trigger; else delete cur.trigger;
    await editBreakpoint(key, { ...cur, enabled: true });
  }
  async function setGroup(key: string, group: string | null): Promise<void> {
    store.hydrate();
    const cur: BpMeta = { ...(meta.get(key) ?? { enabled: true }) };
    if (group && group.trim()) cur.group = group.trim(); else delete cur.group;
    await editBreakpoint(key, { ...cur, enabled: cur.enabled !== false });
  }
  async function toggleGroup(name: string): Promise<void> {
    if (groupsOff.has(name)) groupsOff.delete(name); else groupsOff.add(name);
    keep();
    const s = store.session();
    if (isDap(s)) for (const [k, m] of meta) if (m.group === name) await sendFile(s!.id, bpPath(k)).catch(fail);
    const t = editor.currentTab(); if (t && t.path) editor.paintEd(t.path);
    view.refresh();
  }
  function toggleJmc(): void { jmc = !jmc; libOpen.clear(); keep(); view.refresh(); }
  function openLibFrames(from: number): void { if (libOpen.has(from)) libOpen.delete(from); else libOpen.add(from); view.refresh(); }

  function askPanic(): void {
    const s = stopped();
    if (!s || !s.panic || !deps.codev?.available()) { notifier.toast(say("needsStop")); return; }
    const p = s.panic;
    deps.codev.ask({ intent: "explain", text: say("askPanic"), send: true, context: [
      { kind: "panic", label: `${p.file.split("/").pop()}:${p.line}`, text: panicText(p), path: p.file },
      { kind: "frame", label: `${s.stop?.func ?? "?"}`, text: markdownOf(s) },
    ] });
  }
  function copyPanic(): void {
    const s = stopped();
    if (!s || !s.panic) return;
    deps.clipboard?.(panicText(s.panic) + "\n\n" + markdownOf(s));
    notifier.toast(say("copied"));
  }

  return {
    startDebug, dbgContinue, dbgStep, dbgStop, toggleBp,
    dbgStepOut, dbgPause, toggleVar, selectFrame, selectThread, addWatch, removeWatch, setStopOnPanic, editBreakpoint, removeBreakpoint, loadKept, askCodev, snapshot, attach,
    restart, runToCursor, restartFrame, stepBack, reverseContinue, consoleEval, consoleHistory, consoleClear, debugTest, setExceptionFilter,
    addDataBreakpoint, removeDataBreakpoint, viewMemory, closeMemory, setTrigger, setGroup, toggleGroup, toggleJmc, openLibFrames, askPanic, copyPanic, host,
    extra: () => ({ watches, output, stopOnPanic: stopOnPanic || (panicThisSession && !!store.session()), expanded, host: hostCaps, console: consoleLines, groupsOff, jmc, libOpen, exceptionFilters: excFilters }),
  };
}
