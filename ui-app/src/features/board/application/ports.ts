/* ═══════════ feature `board` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`board-engine.ts`) depende SÓ de `domain/`, de `esc` (puro) e
   das interfaces declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no
   legacy-bridge — essas capacidades são fornecidas, no acto da composição
   (`features/board.ts`, o resíduo strangler), por adaptadores sobre
   `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe acesso ao backlog,
   ao design do Studio, ao catálogo/geradores, ao git/scm, ao chat do Co-Dev, ao router,
   ao terminal e a um punhado de portas (notificações/vista/navegação/execução) e o
   runner corre sem browser. A regra de dependências aponta para dentro: as portas
   importam `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.)

   Handles opacos (`Host`): o motor constrói as STRINGS de HTML (dados, com `esc`) mas
   nunca lê nem escreve o DOM — segura os elementos devolvidos pelo chat como tokens
   opacos e devolve-os aos métodos do presenter (`toolResult`/`cardAppend`/`cardSet`),
   que fazem a escrita no adaptador da composição.

   GOTCHA-decoração: as arestas internas (delegate→runIssue, runSprint→runIssue,
   dropIssue→approveIssue) passam pela porta `orchestration`, backed pela versão
   DECORADA por window (decoratedRunIssue/decoratedApproveIssue do bridge). */

import type { Backlog, Issue, IssueFile, Design, DesignNode, TechSpec } from "../domain/types";

/** Um elemento do DOM que o motor segura como token opaco (um cartão, uma linha de
 *  ferramenta, um corpo de cartão). O motor nunca o inspecciona. */
export type Host = unknown;
/** Um cartão de conversa: o contentor das ferramentas e o corpo (ambos opacos). */
export interface Card { tools: Host; bd: Host }
/** Resultado leve do encaminhamento de modelo (router). */
export interface Route { p: string; why: string; by: string }
/** Configuração da paleta de comandos (prompt de texto). */
export interface PalCfg { ph?: string; verb?: string; text?: (q: string) => void }

/* ───── backlog em memória + design do Studio ───── */
export interface Store {
  backlog(): Backlog;
  design(): Design;
  saveDesign(): void;
}

/** Sistema de ficheiros virtual (os predicados dos testes de uma issue lêem-no). */
export interface Workspace {
  files(): Record<string, { content: string }>;
}

/** Catálogo do Studio + raiz do projecto (os geradores/decomposição lêem-no). */
export interface Catalog {
  tech(): Record<string, TechSpec>;
  kind(): Record<string, { hc?: boolean }>;
  cloud(): Record<string, { l: string }>;
  isApp(n: unknown): boolean;
  nodeSlug(n: unknown): string;
  appDir(n: unknown): string;
  root(): string;
}

/** Geradores de projecto (ficam donos do monólito; o produtor lê-os por aqui). */
export interface Generators {
  compose(d: Design, healthy: boolean): string;
  appFiles(node: unknown, d: Design, bad: boolean): IssueFile[];
  k8sYaml(node: unknown): string;
  k8sInfra(d: Design): string;
  cloudMap(d: Design): string;
  has(p: string, re: RegExp): boolean;
  validateDesign(): Array<[string, string]>;
}

/** Catálogo de agentes/provedores/perfis de tarefa. */
export interface Directory {
  agents(): Record<string, { n: string; col: string; max: number; task: string }>;
  provs(): Record<string, { name: string }>;
  taskProfiles(): Record<string, { l: string }>;
}

/** Git/scm (motor da feature scm, injectado). */
export interface Scm {
  gfStart(kind: string, name: string): string;
  gfFinish(b?: string, a?: string): { h: string } | null;
  commit(msg: string, a?: string): { h: string } | null;
  checkout(b: string): void;
  branch(): string;
  staged(): Set<string>;
  statusOf(p: string): string;
  refs(): Record<string, string>;
}

/** Controlo de execução/autoria (RUN/AUTHOR/AGENT + sentinela de paragem). */
export interface Runctl {
  active(): boolean;
  setActive(on: boolean, label?: string): void;
  label(text: string): void;
  setAuthor(a: string): void;
  setAgent(a: string): void;
  mode(): string;
  stop(): unknown;
}

/** Conversa do Co-Dev: cria cartões/linhas e escreve-lhes HTML (o motor dá a string). */
export interface Chat {
  card(label: string, html: string): Card;
  tl(host: Host, name: string, arg: unknown): Host;
  toolResult(row: Host, html: string): void;
  cardAppend(bd: Host, html: string): void;
  cardSet(bd: Host, html: string): void;
  ask(host: Host, btns: Array<{ l: string; v: number; pri?: number; done?: string }>): Promise<number>;
  beat(ms: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  user(t: string): void;
  focusAgent(nofocus?: boolean): void;
  agentPill(): void;
  handlePrompt(q: string): void;
  scrollMsgs(): void;
}

/** Encaminhamento de modelo + contabilização de uso. */
export interface Router {
  route(agent: string, title: string): Promise<Route>;
  use(p: string, tok: number): void;
}

/** Terminal + testes + variáveis CSS + aplicação de uma ferramenta a um ficheiro. */
export interface Terminal {
  echo(html: string): void;
  echoCmd(cmd: string): void;
  newInput(nofocus?: boolean): void;
  setPanelTab(tab: string, nofocus?: boolean): void;
  getVar(k: string): string;
  /** Os comandos de testes/lint detectados no projecto aberto, corridos a sério (desktop);
   *  `[]` sem pasta ou sem comandos detectados. */
  projectTests(): Promise<Array<{ n: string; ok: boolean }>>;
  doTool(t: { t: string; p: string; content: string }, host: Host): Promise<void>;
}

/** Escopo/autores (team) + caminho curto. */
export interface Team {
  inScope(a: string, p: string): boolean;
  ownerOf(p: string): string;
  short(p: string): string;
}

/** Re-render/refresh da UI após mudança de estado. */
export interface View {
  rerender(kind: string): void;
  refresh(): void;
  rerenderCodev(): void;
}

/** Notificações + registo de eventos. */
export interface Notifier {
  toast(m: string): void;
  note(m: string): void;
  log(src: string, msg: string): void;
}

/** Navegação / separadores / paleta de comandos. */
export interface Nav {
  openTab(t: { id: string; title?: string; kind?: string }): void;
  palette(pre: string, cfg?: PalCfg): void;
}

/** As arestas internas DECORADAS (ver GOTCHA-decoração). */
export interface Orchestration {
  runIssue(it: Issue): Promise<void>;
  approveIssue(id: string): void;
}

/* ───────── pacote de dependências entregue ao motor ───────── */
export interface BoardDeps {
  store: Store;
  workspace: Workspace;
  catalog: Catalog;
  generators: Generators;
  directory: Directory;
  scm: Scm;
  runctl: Runctl;
  chat: Chat;
  router: Router;
  terminal: Terminal;
  team: Team;
  view: View;
  notifier: Notifier;
  nav: Nav;
  orchestration: Orchestration;
}

/** A superfície que o motor devolve (os casos de uso do board). */
export interface BoardEngine {
  mkIssue(o: Partial<Issue>): Issue;
  setStage(it: Issue, st: string): void;
  autoTest(it: Issue, host: Host | null): Promise<boolean>;
  runIssue(it: Issue): Promise<void>;
  delegate(id: string): Promise<void>;
  runSprint(s: number): Promise<void>;
  approveIssue(id: string): void;
  rejectIssue(id: string): void;
  dropIssue(id: string, st: string): Promise<void>;
  newIssue(): void;
  openBoard(): void;
  genBacklog(): Promise<void>;
  genBacklogIssues(plan: DesignNode[]): Issue[];
}

/** A parte desktop do board (ADR-0004, U4h5), injectada pela app Tauri em `desktopPorts.board`:
 *  as corridas de sprint são demos guionadas — com uma pasta real aberta, avisa e não corre. */
export interface BoardDesktop {
  runSprint?(s: number, virtual: (s: number) => unknown): unknown;
}
