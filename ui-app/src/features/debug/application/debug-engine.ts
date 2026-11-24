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
import { cargoTargets, fsKeyFor, relOf, type Stop } from "../domain/session";
import type { DebugDeps, DebugEngine } from "./ports";

/** O que dizer quando não há motor de depuração no sistema. */
export const NO_GDB = "O gdb não está instalado: a depuração passo-a-passo usa o gdb (Rust, C, C++). Instala-o (p.ex. «sudo apt install gdb») e tenta de novo.";

export function makeDebugEngine(deps: DebugDeps): DebugEngine {
  const { store, dbg, workspace, editor, shell, picker, view, notifier } = deps;
  let busy = false;

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
    store.setSession({ ...s, status: "stopped", stop: st, locals, stack });
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
      await dbg.launch(id, program, root);
      for (const b of store.breakpoints()) await dbg.breakAt(id, relOf(bpPath(b), workspace.fsRoot()), +bpLine(b));
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
    const s = store.session();
    if (adding && s && s.status === "stopped") void dbg.breakAt(s.id, relOf(p, workspace.fsRoot()), l).catch(fail);
  }

  return { startDebug, dbgContinue, dbgStep, dbgStop, toggleBp };
}
