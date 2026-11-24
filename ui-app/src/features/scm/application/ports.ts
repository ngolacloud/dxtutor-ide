/* ═══════════ feature `scm` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`scm-engine.ts`) depende SÓ de `domain/` e das interfaces
   declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no legacy-bridge —
   essas capacidades são fornecidas, no acto da composição (`features/scm.ts`, o
   resíduo strangler), por adaptadores sobre `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe acesso ao
   sistema de ficheiros virtual, ao estado git e a um punhado de portas (notificações/
   log/refresh/terminal/navegação/relógio/ids) e os commits, merges e gitflow correm
   sem browser. A regra de dependências aponta para dentro: as portas importam
   `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.)

   O estado (GIT/STAGED/COMMITS/BRANCH/…) é window-backed no resíduo; o motor vê-o e
   muta-o através da porta `ScmStore` (as mutações persistem porque é a MESMA
   referência que o resíduo publica em `window.*`). */

import type { GitState, Commit, FileEntry } from "../domain/types";

/** O resultado leve de um commit que a UI mostra (hash, mensagem, nº de ficheiros).
 *  `n` é opcional: `gitInit` semeia a lista só com `{h, m}`. */
export interface CommitResult {
  h: string;
  m: string;
  n?: number;
}

/** Acesso ao sistema de ficheiros virtual (`FS`): o mapa vivo, mutado no sítio. */
export interface Workspace {
  files(): Record<string, FileEntry>;
}

/** O estado git/scm, window-backed e mutado no sítio. `setBranch` ao mudar o ramo
 *  também actualiza a etiqueta de ramo (a UI fá-lo no adaptador da composição). */
export interface ScmStore {
  git(): GitState;
  staged(): Set<string>;
  commits(): CommitResult[];
  branch(): string;
  setBranch(b: string): void;
  commitMsg(): string;
  setCommitMsg(m: string): void;
  author(): string;
}

/** Notificações de utilizador (toast) e registo de eventos (log). */
export interface Notifier {
  toast(msg: string): void;
}
export interface Logger {
  log(src: string, msg: string): void;
}

/** Re-render/refresh da UI após uma mudança de estado. `rerenderPane` re-desenha o
 *  pane Source Control; `refresh`/`rerender` são os do monólito; `drawTimeline`
 *  redesenha a mini-timeline; `focusCommitInput` leva ao pane e foca a caixa. */
export interface ScmView {
  refresh(fromEd?: boolean, force?: boolean): void;
  rerender(kind: string): void;
  rerenderPane(): void;
  drawTimeline(): void;
  focusCommitInput(): void;
}

/** Actualização do prompt do terminal após um checkout. */
export interface Terminal {
  refreshPrompt(): void;
}

/** Relógio e gerador de ids (hashes de commit) — injectados para o motor ficar
 *  determinista nos testes e sem `Date.now`/`Math.random` espalhados. */
export interface Clock {
  now(): number;
}
export interface IdGen {
  next(): string;
}

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface ScmDeps {
  workspace: Workspace;
  store: ScmStore;
  notifier: Notifier;
  logger: Logger;
  view: ScmView;
  terminal: Terminal;
  clock: Clock;
  ids: IdGen;
}

/** A superfície que o motor devolve (os casos de uso git/scm). */
/** O resultado mínimo de um merge / fim de gitflow que os consumidores lêem (o merge real
 *  devolve um nó «pending» até o git terminar). */
export interface MergeResult { h: string; m: string }

/** A parte desktop do scm (ADR-0004, U4h2), injectada pela app Tauri: com uma pasta que é um
 *  repositório git real, o commit / checkout / merge / fim de gitflow PUBLICADOS passam a git
 *  real. Cada operação recebe a versão simulada (`virtual`): sem repositório o adaptador
 *  delega nela; o commit corre-a primeiro (carimba o estado) e depois o `git commit`. */
export interface ScmDesktop {
  commit(msg: string | undefined, author: string | undefined, virtual: (msg?: string, author?: string) => CommitResult | null): CommitResult | null;
  checkout(b: string, create: boolean | undefined, virtual: (b: string, create?: boolean) => boolean): boolean;
  gitMerge(src: string, author: string | undefined, virtual: (src: string, author?: string) => MergeResult | null): MergeResult | null;
  gfFinish(b: string | undefined, author: string | undefined, virtual: (b?: string, author?: string) => MergeResult | null): MergeResult | null;
}

export interface ScmEngine {
  gitInit(): void;
  commit(msg?: string, author?: string): CommitResult | null;
  commitV2(msg?: string): CommitResult | null;
  checkout(b: string, create?: boolean): boolean;
  gitMerge(src: string, author?: string): Commit | null;
  gfStart(kind: string, name: string): string;
  gfFinish(b?: string, author?: string): Commit | null;
  stage(p: string): void;
  discard(p: string): void;
}
