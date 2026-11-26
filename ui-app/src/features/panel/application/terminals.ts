/* ═════════ feature `panel` — gestor de terminais (caso de uso) ═════════
   As instâncias de terminal ao estilo VS Code: criar (shell à escolha), dividir (no cwd
   da instância de onde se divide), focar, matar, e correr TAREFAS num PTY próprio que
   devolve o código de saída real (compose, deploy, testes). Recebe os eventos da
   integração de shell (cwd, comando, código) e guarda o histórico — os comandos que
   falharam alimentam o Debug assistant.

   Não conhece o DOM: a UI cria um xterm para cada instância, mede-o e chama `start`;
   os bytes do PTY chegam à UI pelo `sink`. */

import type { CommandRecord, TerminalMeta } from "../domain/types";
import type { ShellEvent } from "../domain/shell-integration";
import { terminalTitle } from "../domain/naming";
import type { Clock, PtyPort, TaskVault, WorkspacePort } from "./ports";
import type { OutputLog } from "./output";

export const TASKS_CHANNEL = "Tasks";
const HISTORY_CAP = 200;

export interface TerminalSink {
  data(id: string, data: string): void;
  exited(meta: TerminalMeta, code: number): void;
}

interface Pending {
  shell?: string | null;
  cwd?: string | null;
  command?: string | null;
  env?: Record<string, string> | null;
  vault?: TaskVault | null;
}

export interface Terminals {
  list(): readonly TerminalMeta[];
  get(id: string): TerminalMeta | undefined;
  active(): string | null;
  group(id: string): TerminalMeta[];
  create(o?: { shell?: string | null; cwd?: string | null; group?: string }): TerminalMeta;
  start(id: string, rows: number, cols: number): Promise<void>;
  runTask(command: string, o?: { label?: string; cwd?: string | null; env?: Record<string, string> | null; vault?: TaskVault | null }): Promise<number>;
  split(id?: string | null): TerminalMeta | null;
  focus(id: string): void;
  kill(id: string): Promise<void>;
  write(id: string, data: string): void;
  resize(id: string, rows: number, cols: number): void;
  shellEvent(id: string, ev: ShellEvent | { kind: "cwd"; path: string }, output?: string): void;
  refreshInfo(id: string): Promise<void>;
  history(): readonly CommandRecord[];
  failures(): CommandRecord[];
  workspaceChanged(): void;
  setSink(s: TerminalSink): void;
  subscribe(f: () => void): () => void;
}

export function makeTerminals(deps: { pty: PtyPort; workspace: WorkspacePort; output: OutputLog; clock: Clock }): Terminals {
  const { pty, workspace, output, clock } = deps;
  const list: TerminalMeta[] = [];
  const pending = new Map<string, Pending>();
  const waiters = new Map<string, (code: number) => void>();
  const closing = new Set<string>();
  const lastCommand = new Map<string, string>();
  const history: CommandRecord[] = [];
  const subs = new Set<() => void>();
  let active: string | null = null;
  let seq = 0;
  let sink: TerminalSink = { data() {}, exited() {} };
  const emit = () => subs.forEach((f) => f());
  const nextId = () => `t${++seq}-${clock.now().toString(36)}`;
  const get = (id: string) => list.find((t) => t.id === id);

  function remove(id: string): void {
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    pending.delete(id);
    closing.delete(id);
    if (active === id) active = (list[i] ?? list[i - 1] ?? null)?.id ?? null;
    emit();
  }

  void pty.onData((id, data) => {
    if (get(id)) sink.data(id, data);
  });
  void pty.onExit((id, code) => {
    const t = get(id);
    if (!t) return;
    t.exited = code;
    const w = waiters.get(id);
    if (w) {
      waiters.delete(id);
      w(code);
    }
    if (t.kind === "task") output.append(TASKS_CHANNEL, `${code === 0 ? "✓" : "✖"} ${t.label ?? t.command} · exit ${code}`, code === 0 ? "info" : "error");
    // Matar pelo lixo, ou `exit` limpo de uma shell: a instância fecha (como no VS Code).
    if (closing.has(id) || (t.kind === "shell" && code === 0)) {
      remove(id);
      return;
    }
    sink.exited(t, code);
    emit();
  });

  function create(o: { shell?: string | null; cwd?: string | null; group?: string } = {}): TerminalMeta {
    const id = nextId();
    const t: TerminalMeta = {
      id,
      kind: "shell",
      group: o.group ?? id,
      shell: o.shell || "",
      label: null,
      process: null,
      cwd: o.cwd ?? workspace.root(),
      exited: null,
      lastExit: null,
      commands: 0,
      command: null,
    };
    pending.set(id, { shell: o.shell, cwd: t.cwd, env: workspace.env() });
    list.push(t);
    active = id;
    emit();
    return t;
  }

  return {
    list: () => list,
    get,
    active: () => active,
    group: (id) => {
      const g = get(id)?.group;
      return g ? list.filter((t) => t.group === g) : [];
    },
    create,
    async start(id, rows, cols) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      try {
        await pty.spawn({ id, rows, cols, cwd: p.cwd, shell: p.shell, command: p.command, env: p.env, ...(p.vault ? { vault: p.vault } : {}) });
        void this.refreshInfo(id); // a shell real (o «default» resolvido pelo backend)
      } catch (e) {
        const t = get(id);
        sink.data(id, `\x1b[31m${String(e)}\x1b[0m\r\n`);
        if (t) {
          t.exited = -1;
          waiters.get(id)?.(-1);
          waiters.delete(id);
          emit();
        }
      }
    },
    runTask(command, o = {}) {
      const label = o.label ?? command.split("\n")[0].slice(0, 60);
      // Reutiliza o lugar de uma tarefa terminada com o mesmo rótulo.
      for (const t of list.filter((x) => x.kind === "task" && x.label === label && x.exited !== null)) remove(t.id);
      const id = nextId();
      const t: TerminalMeta = {
        id,
        kind: "task",
        group: id,
        shell: "task",
        label,
        process: null,
        cwd: o.cwd ?? workspace.root(),
        exited: null,
        lastExit: null,
        commands: 0,
        command,
      };
      pending.set(id, { command, cwd: t.cwd, env: { ...workspace.env(), ...(o.env ?? {}) }, vault: o.vault ?? null });
      list.push(t);
      active = id;
      output.append(TASKS_CHANNEL, `▶ ${label}${label !== command ? `\n    ${command.split("\n").join("\n    ")}` : ""}`);
      const done = new Promise<number>((resolve) => waiters.set(id, resolve));
      emit();
      return done;
    },
    split(id) {
      const from = get(id ?? active ?? "");
      if (!from) return create();
      return create({ shell: from.kind === "shell" ? from.shell || null : null, cwd: from.cwd, group: from.group });
    },
    focus(id) {
      if (get(id) && active !== id) {
        active = id;
        emit();
      }
    },
    async kill(id) {
      const t = get(id);
      if (!t) return;
      if (t.exited !== null || pending.has(id)) {
        remove(id);
        return;
      }
      closing.add(id);
      const ok = await pty.kill(id).catch(() => false);
      if (!ok) remove(id);
    },
    write(id, data) {
      const t = get(id);
      if (t && t.exited === null) void pty.write(id, data).catch(() => {});
    },
    resize(id, rows, cols) {
      const t = get(id);
      if (t && t.exited === null && !pending.has(id)) void pty.resize(id, rows, cols).catch(() => {});
    },
    shellEvent(id, ev, out) {
      const t = get(id);
      if (!t) return;
      if (ev.kind === "cwd") {
        if (t.cwd !== ev.path) {
          t.cwd = ev.path;
          emit();
        }
        return;
      }
      if (ev.kind === "command") {
        lastCommand.set(id, ev.command);
        return;
      }
      const command = lastCommand.get(id) ?? "";
      lastCommand.delete(id);
      t.lastExit = ev.code;
      t.commands++;
      history.unshift({ terminalId: id, terminalTitle: terminalTitle(t), command, exitCode: ev.code, cwd: t.cwd, at: clock.now(), output: out ?? "" });
      if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
      emit();
    },
    async refreshInfo(id) {
      const t = get(id);
      if (!t || t.exited !== null || pending.has(id)) return;
      try {
        const i = await pty.info(id);
        const shell = t.kind === "shell" ? i.shell : t.shell;
        if (i.process !== t.process || (i.cwd && i.cwd !== t.cwd && t.kind === "shell") || shell !== t.shell) {
          t.process = i.process;
          t.shell = shell;
          if (i.cwd && t.kind === "shell") t.cwd = i.cwd;
          emit();
        }
      } catch {
        /* terminou entretanto: o pty://exit trata disso */
      }
    },
    history: () => history,
    failures: () => history.filter((h) => h.exitCode !== 0 && h.exitCode !== 130),
    workspaceChanged() {
      // Uma shell aberta antes da pasta, ainda sem comandos, passa a abrir na raiz nova.
      const root = workspace.root();
      for (const t of [...list]) {
        if (t.kind === "shell" && t.commands === 0 && t.exited === null && t.cwd !== root) {
          const prev = active;
          void this.kill(t.id);
          const n = create({ group: t.group });
          active = prev === t.id ? n.id : prev;
        }
      }
      emit();
    },
    setSink(s) {
      sink = s;
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
