/* ═════════ feature `board` (backlog/sprints/kanban): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `board` autorizado a ler ou escrever `window.*`.
   `features/board.ts` (e, nas fases seguintes, o motor em `application/`) importa daqui
   em vez de usar nomes globais livres, por isso deixa de ser `@ts-nocheck`: cada acesso
   fica tipado e o `any` confina-se a este ficheiro (regra «zero any fora do bridge»).

   Como os bridges do Co-Dev/scm/debug, os acessores lêem `window`/`G` NO ACTO da chamada,
   nunca no import: `board.ts` avalia ANTES de `app.ts`/`v5.ts`/`v6.ts` publicarem os seus
   globais (FS/AGENTS/PROV/RUN/GIT/STAGED/SD/TECH, os geradores, os helpers do co-dev
   card/tl/ask/beat/…). Capturar um valor ansiosamente aqui (`const x = window.x`)
   congelaria em `undefined`. Funções e getters são seguros porque só correm depois do
   arranque (cliques, delegações, execução de sprints).

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito/camadas é
   declarada como `let`/`const`/`function` solta (não em `interface Window`), logo
   `window.x` não tipa. Cada acessor exportado tem mesmo assim uma assinatura concreta
   e não-`any`.

   GOTCHA-decoração (particularidade do board): `runIssue`/`delegate`/`runSprint`/
   `approveIssue` são DECORADAS em runtime pelo monólito (app.ts infra, v5.ts codeGuard/
   review, v6.ts custo/ownership): `const _x=window.X; window.X=function(){…;_x(…)}`. Por
   isso as arestas internas (delegate→runIssue, runSprint→runIssue, dropIssue→approveIssue)
   têm de chamar a versão DECORADA — resolvem-se por `window.*` no ACTO (late-binding),
   via `decoratedRunIssue`/`decoratedApproveIssue` abaixo, nunca pela função local base. */

import { toast, log, rerender } from "../../../core";
import type {
  Backlog, Stage, Issue, IssueFile, Design, TechSpec,
} from "../domain/types";
export { toast, log, rerender };
export type { Backlog, Stage, Issue, IssueFile, Design, TechSpec };

const G = window as unknown as Record<string, any>;

/* ───── formas do monólito que o board lê (tipos locais do bridge) ───── */
export interface Agent { n: string; col: string; max: number; task: string }
export interface Prov { name: string }
export interface Run { active: boolean; label: string }
export interface GitRefs { refs: Record<string, string> }
export interface FileEntry { content: string }
export interface Route { p: string; why: string; by: string }
export interface Card { tools: HTMLElement; bd: HTMLElement }
export interface ToolSpec { t: string; p: string; content: string }
export interface AskBtn { l: string; v: number; pri?: number; done?: string }
export interface PalItem { l: string; d?: string; run?: () => void }
export interface PalCfg { ph?: string; verb?: string; text?: (q: string) => void; items?: PalItem[] }
export interface OpenTabArg { id: string; title?: string; kind?: string }

/* ───── estado window-backed: o resíduo publica os objectos (BL/STAGES) via `publish`;
   os onclick inline (`BL.view=…`) e as camadas v5/v6 aliasam estes nomes como globais,
   por isso o motor e o resíduo partilham a MESMA referência através destes getters. ───── */
export const backlog = (): Backlog => G.BL;
export const stages = (): Stage[] => G.STAGES;

/* ───── sistema de ficheiros virtual + catálogo de agentes/provedores/tarefas ───── */
export const files = (): Record<string, FileEntry> => G.FS;
export const agents = (): Record<string, Agent> => G.AGENTS;
export const provs = (): Record<string, Prov> => G.PROV;
export const taskProfiles = (): Record<string, { l: string }> => G.TASKP;

/* ───── estado da execução / autoria / ramo / agente activo / pane / modo ───── */
export const run = (): Run => G.RUN;
export const author = (): string => G.AUTHOR;
export const setAuthor = (a: string): void => { G.AUTHOR = a; };
export const branch = (): string => G.BRANCH;
export const setAgent = (a: string): void => { G.AGENT = a; };
export const pane = (): string => G.PANE;
export const mode = (): string => G.MODE;
export const panes = (): Record<string, () => void> => G.RP;
export const root = (): string => G.ROOT;
/** A sentinela de cancelamento do co-dev (`throw STOP` / `e === STOP`). */
export const stopSignal = (): unknown => G.STOP;

/* ───── git/scm (motor da feature scm, lido por global) ───── */
export const git = (): GitRefs => G.GIT;
export const staged = (): Set<string> => G.STAGED;
export const gfStart = (kind: string, name: string): string => G.gfStart(kind, name);
export const gfFinish = (b?: string, a?: string): { h: string } | null => G.gfFinish(b, a);
export const commitGit = (msg: string, a?: string): { h: string } | null => G.commitGit(msg, a);
export const checkout = (b: string, create?: boolean): void => { G.checkout(b, create); };
export const stOf = (p: string): string => G.stOf(p);

/* ───── design do Studio + catálogo + geradores (ficam donos do monólito; o produtor
   genBacklogIssues lê-os por global — decisão do dono: geradores FICAM) ───── */
export const design = (): Design => G.SD;
export const saveDesign = (): void => G.saveSD();
export const validateDesign = (): Array<[string, string]> => G.validateDesign();
export const tech = (): Record<string, TechSpec> => G.TECH;
export const kindTable = (): Record<string, { hc?: boolean }> => G.KIND;
export const cloudTable = (): Record<string, { l: string }> => G.CLOUD;
export const isApp = (n: unknown): boolean => G.isApp(n);
export const nodeSlug = (n: unknown): string => G.sl(n);
export const appDir = (n: unknown): string => G.appDir(n);
export const composeYaml = (d: Design, healthy: boolean): string => G.composeYaml(d, healthy);
export const appFiles = (node: unknown, d: Design, bad: boolean): IssueFile[] => G.appFiles(node, d, bad);
export const k8sYaml = (node: unknown): string => G.k8sYaml(node);
export const k8sInfra = (d: Design): string => G.k8sInfra(d);
export const cloudMap = (d: Design): string => G.cloudMap(d);
export const has = (p: string, re: RegExp): boolean => G.has(p, re);

/* ───── helpers de conversa do Co-Dev (cartões, passos, perguntas, ritmo) ───── */
export const card = (label: string, html: string): Card => G.card(label, html);
export const tl = (host: HTMLElement, name: string, arg: unknown): HTMLElement => G.tl(host, name, arg);
export const ask = (host: HTMLElement, btns: AskBtn[]): Promise<number> => G.ask(host, btns);
export const beat = (ms: number): Promise<void> => G.beat(ms);
export const sleep = (ms: number): Promise<void> => G.sleep(ms);
export const user = (t: string): void => G.user(t);
export const note = (m: string): void => G.note(m);
export const runLabel = (): void => G.runLabel();
export const runState = (on: boolean, label?: string): void => G.runState(on, label);
export const focusAgent = (nofocus?: boolean): void => G.focusAgent(nofocus);
export const agentPill = (): void => G.agentPill();
export const handlePrompt = (q: string): void => G.handlePrompt(q);
export const scrollMsgs = (): void => G.scrollMsgs();

/* ───── encaminhamento de modelo (router) ───── */
export const routeModel = (agent: string, title: string): Promise<Route> => G.routeModel(agent, title);
export const use = (p: string, tok: number): void => G.use(p, tok);

/* ───── terminal + testes + variáveis CSS + aplicação de uma ferramenta ───── */
export const echo = (html: string): void => G.echo(html);
export const echoCmd = (cmd: string): void => G.echoCmd(cmd);
export const newInput = (nofocus?: boolean): void => G.newInput(nofocus);
export const setPanelTab = (tab: string, nofocus?: boolean): void => G.setPanelTab(tab, nofocus);
export const getVar = (k: string): string => G.getVar(k);
export const runTests = (): { ok: boolean } => G.runTests();
export const dsLint = (): unknown[] => G.dsLint();
export const doTool = (t: ToolSpec, host: HTMLElement): Promise<void> => G.doTool(t, host);

/* ───── escopo/autores (team) + caminho curto ───── */
export const inScope = (a: string, p: string): boolean => G.inScope(a, p);
export const ownerOf = (p: string): string => G.ownerOf(p);
export const short = (p: string): string => G.short(p);

/* ───── navegação / separadores / paleta de comandos / refresh ───── */
export const openTab = (t: OpenTabArg): void => G.openTab(t);
export const openGraph = (sel?: string): void => G.openGraph(sel);
export const openStudio = (): void => G.openStudio();
export const palette = (pre: string, cfg?: PalCfg): void => G.palette(pre, cfg);
export const refresh = (): void => G.refresh();

/* ───── GOTCHA-decoração: resolvem a versão DECORADA por window no ACTO ─────
   As arestas internas do motor (delegate/runSprint→runIssue, dropIssue→approveIssue) e os
   handlers de acção do pane (data-action delegate/run-sprint/approve) têm de acertar na
   versão que o monólito (app.ts/v5/v6) decorou, não na função local base — tal como os
   `onclick` inline antigos resolviam `window.X` ao clicar. `delegate`/`runSprint` são
   async; descartamos a promessa (fire-and-forget, como o onclick fazia). */
export const decoratedRunIssue = (it: Issue): Promise<void> => G.runIssue(it);
export const decoratedApproveIssue = (id: string): void => { G.approveIssue(id); };
export const decoratedDelegate = (id: string): void => { G.delegate(id); };
export const decoratedRunSprint = (s: number): void => { G.runSprint(s); };

/* ───── publicação da superfície pública no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global), os decoradores de
   app.ts/v5/v6 e os consumidores (studio/router/codev/tasks) que resolvem por global. */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
