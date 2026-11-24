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

/** O motor de depuração do backend (gdb/MI), por sessão. */
export interface DebugPort {
  /** Há um motor instalado (o gdb no PATH)? */
  available(): Promise<boolean>;
  launch(id: string, program: string, cwd: string): Promise<void>;
  breakAt(id: string, file: string, line: number): Promise<number>;
  run(id: string): Promise<Stop>;
  cont(id: string): Promise<Stop>;
  step(id: string, into: boolean): Promise<Stop>;
  locals(id: string): Promise<Var[]>;
  stack(id: string): Promise<Frame[]>;
  stop(id: string): Promise<void>;
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
}

/** A superfície que o motor devolve. */
export interface DebugEngine {
  /** F5: sem sessão, escolhe o programa, lança o gdb, põe os breakpoints e corre; parado, continua. */
  startDebug(): Promise<void>;
  dbgContinue(): Promise<void>;
  dbgStep(into?: boolean): Promise<void>;
  dbgStop(): Promise<void>;
  toggleBp(p: string, l: number): void;
}
