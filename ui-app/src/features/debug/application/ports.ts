/* ═══════════ feature `debug` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`debug-engine.ts`) depende SÓ de `domain/` e das interfaces
   declaradas aqui (e de `esc` de `../../../core`, função pura). Nunca toca no DOM, em
   `window`, no Tauri ou no legacy-bridge — essas capacidades são fornecidas, no acto da
   composição (`features/debug.ts`), por adaptadores sobre `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe o estado da sessão,
   o Set de breakpoints, o sistema de ficheiros, os geradores de traço e um punhado de
   portas (navegação/painel/editor/notificações/log/checkpoint/relógio/humano) e as
   sessões de depuração correm sem browser. A regra de dependências aponta para dentro:
   as portas importam `domain/`, nunca o contrário.

   O estado (DBG/BPS) é window-backed no resíduo; o motor vê-o e muta-o através da porta
   `DebugStore` (as mutações persistem porque é a MESMA referência que o resíduo publica
   em `window.*`). As funções de DESENHO (drawDbg/refreshDbg/renderDebugPane) vivem no
   resíduo (donas do DOM) e entram por `DebugView`. */

import type { CodeTrace, CrashTrace, DbgSession, LaunchConfig } from "../domain/types";

/** Acesso ao estado vivo: a sessão (reatribuível), o Set de breakpoints e a sua
 *  persistência preguiçosa/eager em LS (implementadas no resíduo sobre o bridge). */
export interface DebugStore {
  session(): DbgSession | null;
  setSession(s: DbgSession | null): void;
  breakpoints(): Set<string>;
  hydrate(): void;
  save(): void;
}

/** O sistema de ficheiros virtual + o caminho do lexer. */
export interface Workspace {
  lexPath(): string;
  fileContent(path: string): string;
  writeFile(path: string, content: string): void;
}

/** Os helpers de lexer (de v6): a variante do fonte e o nº de linha por regex. */
export interface Lexer {
  variant(): string;
  line(re: RegExp): number;
}

/** Os geradores de traço (domínio + mundo injectado na composição). */
export interface Scenarios {
  code(variant: string): CodeTrace;
  ops(env: string, n: string): CrashTrace;
  launch(): LaunchConfig[];
}

/** Etiqueta de apresentação de um ambiente (ENVL). */
export interface Env {
  label(env: string): string;
}

/** O editor: separador actual, abrir caminho (com linha opcional) e repintar gutters. */
export interface Editor {
  currentTab(): { path?: string; kind?: string } | null;
  openPath(path: string, line?: number): void;
  paintEd(path: string): void;
}

/** A casca da UI: navegação para o pane, variáveis CSS do painel e separador do painel. */
export interface Shell {
  goPane(p: string): void;
  getVar(k: string): string;
  setVar(k: string, v: string): void;
  togglePanel(): void;
  setPanelTab(pt: string, nofocus?: boolean): void;
}

/** As funções de desenho, donas do DOM (vivem no resíduo). */
export interface DebugView {
  draw(): void;
  refresh(): void;
  renderPane(): void;
}

/** Diálogo modal (forma mínima do `dlg` do monólito). */
export interface DlgLike { title: string; body: string; ok?: string; onOk?: () => void }

export interface Notifier { toast(m: string): void; dlg(opts: DlgLike): void }
export interface Logger { log(src: string, msg: string): void }
/** Quem é dono de um artefacto no projecto (código/…): decide se o motor aplica ou
 *  devolve a mudança ao humano. */
export interface Human { owns(what: string): boolean }
export interface Checkpointer { snapshot(label: string): void }
/** Relógio de apresentação (hhmm) para o carimbo dos itens do feed. */
export interface Clock { time(): string }

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface DebugDeps {
  store: DebugStore;
  workspace: Workspace;
  lexer: Lexer;
  scenarios: Scenarios;
  env: Env;
  editor: Editor;
  shell: Shell;
  view: DebugView;
  notifier: Notifier;
  logger: Logger;
  human: Human;
  checkpoint: Checkpointer;
  clock: Clock;
}

/** A superfície que o motor devolve (os casos de uso da sessão de depuração). */
export interface DebugEngine {
  startDebug(id?: string): void;
  dbgFeed(k: string, h: string): void;
  dbgApplyClone(): void;
  dbgStep(): void;
  dbgContinue(): void;
  dbgFinish(): void;
  dbgStop(): void;
  dbgFix(): void;
  toggleBp(p: string, l: number): void;
}
