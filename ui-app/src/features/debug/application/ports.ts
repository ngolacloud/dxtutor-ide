/* ═══════════ feature `debug` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`debug-engine.ts`) depende SÓ de `domain/` e das interfaces
   declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no legacy-bridge — essas
   capacidades são fornecidas, no acto da composição (`features/debug.ts`), por
   adaptadores sobre `infrastructure/` (Tauri: `debug_*`; legado: a pasta, o FS, o editor).

   ADR-0006, R4: depuração real. O motor do backend é o gdb sobre a Machine Interface
   (`debug_launch`/`debug_break`/`debug_run`/`debug_continue`/`debug_step`/`debug_locals`/
   `debug_stack`/`debug_stop`): breakpoints, passos, variáveis e pilha vêm do gdb. O Set de
   breakpoints continua window-backed no resíduo (MESMA referência que o editor pinta). */

import type { Frame, Session, Stop, Var } from "../domain/session";
import type { BpMeta, BreakpointSpec, DapThread, LaunchInfo, VarNode, Watch } from "../domain/dap";

/** O motor de depuração do backend (gdb/MI), por sessão. */
export interface DebugPort {
  /** Há um motor instalado (o gdb no PATH)? */
  available(): Promise<boolean>;
  /** Starts a session: DAP when an adapter is installed, gdb otherwise (A7). */
  launch(id: string, program: string, cwd: string): Promise<LaunchInfo | void>;
  breakAt(id: string, file: string, line: number): Promise<number>;
  run(id: string): Promise<Stop>;
  cont(id: string): Promise<Stop>;
  step(id: string, into: boolean, kind?: "out"): Promise<Stop>;
  locals(id: string): Promise<Var[]>;
  stack(id: string, thread?: number): Promise<Frame[]>;
  stop(id: string): Promise<void>;
  /* ── A7, DAP only ── */
  setBreakpoints?(id: string, file: string, specs: BreakpointSpec[]): Promise<Array<{ line: number; verified: boolean; message: string | null }>>;
  stopOnPanic?(id: string, on: boolean): Promise<boolean>;
  threads?(id: string): Promise<DapThread[]>;
  variables?(id: string, frame: number, reference?: number): Promise<VarNode[]>;
  evaluate?(id: string, expression: string, frame: number): Promise<VarNode>;
  pause?(id: string): Promise<void>;
  /** the program's output as it comes (unsubscribe with the returned function) */
  onOutput?(f: (id: string, category: string, text: string) => void): void;
}

/** A7: the gutter's breakpoints kept per project (SQLite) and a session's snapshot with an issue. */
export interface ProjectDebugPort {
  load(root: string): Promise<Array<{ file: string; line: number } & BpMeta>>;
  save(root: string, file: string, list: Array<{ file: string; line: number } & BpMeta>): Promise<void>;
  snapshot(root: string, id: string, issue: string | null, title: string, markdown: string): Promise<void>;
  /** the project's open issues, to pick one for the snapshot */
  issues(root: string): Promise<Array<{ key: string; title: string }>>;
}

/** A7: Co-Dev with the session's real frames as context. */
export interface DebugCodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "change"; text: string; context: Array<{ kind: "problem" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}

/** A pasta aberta, o FS (chaves `fsRoot + relativo`) e um comando de construção na pasta. */
export interface Workspace {
  /** A pasta aberta (null sem pasta e no browser). */
  root(): string | null;
  fsRoot(): string;
  content(key: string): string | null;
  /** As chaves do FS (para encontrar os Cargo.toml de um workspace). */
  keys(): string[];
  /** Corre um comando na pasta (código de saída real) — p.ex. `cargo build`. */
  exec(cmd: string): Promise<{ ok: boolean; out: string }>;
}

/** O estado vivo: a sessão (reatribuível), o Set de breakpoints e a sua persistência em LS. */
export interface DebugStore {
  session(): Session | null;
  setSession(s: Session | null): void;
  breakpoints(): Set<string>;
  hydrate(): void;
  save(): void;
  /** A última mensagem para o pane (erro, fim do programa, falta do gdb); "" para limpar. */
  setMessage(m: string): void;
}

/** O editor: separador actual, abrir na linha, repintar gutters. */
export interface Editor {
  currentTab(): { path?: string; kind?: string } | null;
  openPath(path: string, line?: number): void;
  paintEd(path: string): void;
}

/** A casca da UI: navegação para o pane e separador do painel inferior. */
export interface Shell {
  goPane(p: string): void;
  setPanelTab(pt: string, nofocus?: boolean): void;
}

/** Escolher um de vários (binários) ou escrever um caminho (executável): resolve com a escolha,
 *  ou null se o humano desistiu. */
export interface Picker {
  choose(title: string, items: string[]): Promise<string | null>;
  ask(title: string): Promise<string | null>;
}

/** As funções de desenho, donas do DOM (vivem no resíduo). */
export interface DebugView {
  refresh(): void;
}

export interface Notifier { toast(m: string): void }

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface DebugDeps {
  store: DebugStore;
  dbg: DebugPort;
  workspace: Workspace;
  editor: Editor;
  shell: Shell;
  picker: Picker;
  view: DebugView;
  notifier: Notifier;
  /** Gerador de ids de sessão (injectado para os testes). */
  newId(): string;
  /* A7 (opcionais: os testes antigos não os dão) */
  project?: ProjectDebugPort;
  codev?: DebugCodevPort;
  /** the meta (condition, hit count, log message, on/off) of the breakpoints, by key `path:line` */
  bpMeta?: Map<string, BpMeta>;
  /** the texts of the A7 messages (the view's catalog) */
  say?: (key: string, params?: Record<string, string | number>) => string;
}

/** A superfície que o motor devolve. */
export interface DebugEngine {
  /** F5: sem sessão, escolhe o programa, lança o gdb, põe os breakpoints e corre; parado, continua. */
  startDebug(): Promise<void>;
  dbgContinue(): Promise<void>;
  dbgStep(into?: boolean): Promise<void>;
  dbgStop(): Promise<void>;
  toggleBp(p: string, l: number): void;
  /* ── A7 ── */
  dbgStepOut(): Promise<void>;
  dbgPause(): Promise<void>;
  /** expand/collapse a variable or a scope */
  toggleVar(reference: number): Promise<void>;
  selectFrame(level: number): Promise<void>;
  selectThread(id: number): Promise<void>;
  addWatch(expr: string): Promise<void>;
  removeWatch(i: number): void;
  setStopOnPanic(on: boolean): Promise<void>;
  /** change a breakpoint's condition / hit count / log message / on-off (and send it to a live session) */
  editBreakpoint(key: string, meta: BpMeta): Promise<void>;
  /** remove a breakpoint, enabled or not, with its meta */
  removeBreakpoint(key: string): Promise<void>;
  /** the kept breakpoints of the open folder (SQLite), merged into the gutter's */
  loadKept(): Promise<void>;
  askCodev(kind: "explain" | "test"): void;
  snapshot(): Promise<void>;
  /** what the view reads besides the session */
  extra(): { watches: Watch[]; output: string[]; stopOnPanic: boolean; expanded: Set<number> };
}
