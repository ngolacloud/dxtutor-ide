/* ═══════════ feature `board` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`board-engine.ts`) depende SÓ de `domain/`, de `esc` (puro) e
   das interfaces declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no
   legacy-bridge — essas capacidades são fornecidas, no acto da composição
   (`features/board.ts`, o resíduo strangler), por adaptadores sobre
   `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe acesso ao backlog,
   ao design do Studio, ao catálogo, ao git/scm, ao chat do Co-Dev, ao agente real, ao
   terminal e a um punhado de portas (notificações/vista/navegação/execução) e o runner
   corre sem browser (ADR-0006, R3a: sem geradores de templates, router nem predicados
   sobre o FS — quem implementa é o agente). A regra de dependências aponta para dentro: as portas
   importam `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.)

   Handles opacos (`Host`): o motor constrói as STRINGS de HTML (dados, com `esc`) mas
   nunca lê nem escreve o DOM — segura os elementos devolvidos pelo chat como tokens
   opacos e devolve-os aos métodos do presenter (`toolResult`/`cardAppend`/`cardSet`),
   que fazem a escrita no adaptador da composição.

   GOTCHA-decoração: as arestas internas (delegate→runIssue, runSprint→runIssue,
   dropIssue→approveIssue) passam pela porta `orchestration`, backed pela versão
   DECORADA por window (decoratedRunIssue/decoratedApproveIssue do bridge). */
import type { BoardEngineKey } from "./messages";

import type { Backlog, Issue, Design, DesignNode, TechSpec } from "../domain/types";

/** Um elemento do DOM que o motor segura como token opaco (um cartão, uma linha de
 *  ferramenta, um corpo de cartão). O motor nunca o inspecciona. */
export type Host = unknown;
/** Um cartão de conversa: o contentor das ferramentas e o corpo (ambos opacos). */
export interface Card { tools: Host; bd: Host }
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

/** A validação do desenho do Studio (o «Gerar backlog» não gera a partir de um desenho com erros). */
export interface Generators {
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
  /** Os ficheiros com alterações por commitar (para commitar o que o agente mudou). */
  changes(): string[];
  /** Espera que as operações git/disco em fila terminem (no desktop o checkout, o commit e a
   *  gravação são assíncronos); no browser resolve logo. */
  settle(): Promise<void>;
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

/** O agente real do Co-Dev (desktop, pasta aberta, provedor com ferramentas). `story` lança-o em
 *  modo plano sobre a issue e resolve no fim da volta (o humano aprova o plano pelo meio);
 *  `null` se não aceitou o pedido. */
export interface Agent {
  available(): boolean;
  story(s: { id: string; title: string; type: string; pts: number; note?: string }): Promise<void> | null;
}

/** Terminal + testes + variáveis CSS. */
export interface Terminal {
  echo(html: string): void;
  echoCmd(cmd: string): void;
  newInput(nofocus?: boolean): void;
  setPanelTab(tab: string, nofocus?: boolean): void;
  getVar(k: string): string;
  /** Os comandos de testes/lint detectados no projecto aberto, corridos a sério (desktop);
   *  `[]` sem pasta ou sem comandos detectados. */
  projectTests(): Promise<Array<{ n: string; ok: boolean }>>;
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
  /** Os textos que o motor emite, na língua da interface (ADR-0004, U6c): a composição injecta `translator(…)`;
   *  o motor não conhece o `window` nem o motor de tradução. */
  copy: (key: BoardEngineKey, params?: Record<string, string | number>) => string;
  store: Store;
  catalog: Catalog;
  generators: Generators;
  directory: Directory;
  scm: Scm;
  runctl: Runctl;
  chat: Chat;
  agent: Agent;
  terminal: Terminal;
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
  genBacklog(): void;
  genBacklogIssues(plan: DesignNode[]): Issue[];
}

