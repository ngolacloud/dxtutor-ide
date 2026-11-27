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

import { toast, log, rerender, dlg as coreDlg } from "../../../core";
import type {
  Backlog, Stage, Issue, Design, TechSpec,
} from "../domain/types";
/* U7c do ADR-0004: estes quatro deixaram de ser lidos pelo window — o publicador avalia antes desta ponte, ninguém os decora */
import { validateDesign as validateDesignImpl, CLOUD, saveSD as saveSDImpl, appDir as appDirImpl, openStudio as openStudioImpl, TECH as TECHImpl, KIND as KINDImpl, isApp as isAppImpl, sl as slImpl } from "../../studio";
import { codeGuard as codeGuardImpl, HARN, agentPill as agentPillImpl, reviewIssue as reviewIssueImpl } from "../../team";
import { STOP, tl as tlImpl, beat as beatImpl, runLabel as runLabelImpl, runState as runStateImpl, scrollMsgs as scrollMsgsImpl } from "../../codev";
import { TASKP } from "../../router/domain/model-routing";
import { agentStore } from "../../../app/store";
import { echo as echoImpl, echoCmd as echoCmdImpl, newInput as newInputImpl } from "../../terminal";
import { note as noteImpl } from "../../notifications";
import { services } from "../../../app/services";
export { toast, log, rerender };
export type { Backlog, Stage, Issue, Design, TechSpec };

const G = window as unknown as Record<string, any>;

/* ───── formas do monólito que o board lê (tipos locais do bridge) ───── */
export interface Agent { n: string; col: string; max: number; task: string }
export interface Prov { name: string }
export interface Run { active: boolean; label: string }
export interface GitRefs { refs: Record<string, string> }
export interface FileEntry { content: string }
export interface Card { tools: HTMLElement; bd: HTMLElement }
export interface AskBtn { l: string; v: number; pri?: number; done?: string }
export interface PalItem { l: string; d?: string; run?: () => void }
export interface PalCfg { ph?: string; verb?: string; text?: (q: string) => void; items?: PalItem[] }
export interface OpenTabArg { id: string; title?: string; kind?: string }

/* ───── estado window-backed: o resíduo publica os objectos (BL/STAGES) via `publish`;
   os onclick inline (`BL.view=…`) e as camadas v5/v6 aliasam estes nomes como globais,
   por isso o motor e o resíduo partilham a MESMA referência através destes getters. ───── */
export const backlog = (): Backlog => G.BL;
/** Opção 2 (ADR-0003): o agente Co-Dev v2 está disponível (desktop + pasta real + provedor com agente, F8)? */
export const agentAvailable = (): boolean => typeof G.codevAgentAvailable === "function" && !!G.codevAgentAvailable();
/** Lança o agente Co-Dev, em modo plano, com o pedido de uma issue: a promessa resolve no fim da
 *  volta (ADR-0006, R3a — o runner espera por ela para commitar e testar). `null` se não está
 *  disponível ou não aceitou. */
export const agentStory = (s: { id: string; title: string; type: string; pts: number; note?: string }): Promise<void> | null =>
  typeof G.codevAgentStory === "function" ? ((G.codevAgentStory(s) as Promise<void> | null) ?? null) : null;
/** A pasta aberta no desktop (a chave do backlog no backend); null sem pasta e no browser. */
export const boardRoot = (): string | null => (G.DXR && G.DXR.root) || null;
/** Os ficheiros com alterações por commitar (motor scm). */
export const changes = (): string[] => G.changes();
/** Espera pela fila de operações do desktop (git, gravação no disco): `DXR.idle()`, duas vezes
 *  para apanhar o que a primeira volta acrescentou (ex.: o reread depois do checkout). */
export const settle = async (): Promise<void> => { const d = G.DXR; if (d && typeof d.idle === "function") { await d.idle(); await d.idle(); } };
export const stages = (): Stage[] => G.STAGES;

/* ───── sistema de ficheiros virtual + catálogo de agentes/provedores/tarefas ───── */
export const files = (): Record<string, FileEntry> => G.FS;
export const agents = (): Record<string, Agent> => G.AGENTS;
export const provs = (): Record<string, Prov> => G.PROV;
export const taskProfiles = (): Record<string, { l: string }> => TASKP;

/* ───── estado da execução / autoria / ramo / agente activo / pane / modo ───── */
export const run = (): Run => agentStore.run as unknown as Run;
export const author = (): string => G.AUTHOR;
export const setAuthor = (a: string): void => { G.AUTHOR = a; };
export const branch = (): string => G.BRANCH;
export const setAgent = (a: string): void => { agentStore.persona = a; };
export const pane = (): string => G.PANE;
export const mode = (): string => agentStore.mode;
export const panes = (): Record<string, () => void> => G.RP;
export const root = (): string => G.ROOT;
/** A sentinela de cancelamento do co-dev (`throw STOP` / `e === STOP`). */
export const stopSignal = (): unknown => STOP;

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
export const saveDesign = (): void => saveSDImpl();
export const validateDesign = (): Array<[string, string]> => validateDesignImpl() as Array<[string, string]>;
export const tech = (): Record<string, TechSpec> => TECHImpl as Record<string, TechSpec>;
export const kindTable = (): Record<string, { hc?: boolean }> => KINDImpl as Record<string, { hc?: boolean }>;
export const cloudTable = (): Record<string, { l: string }> => CLOUD;
export const isApp = (n: unknown): boolean => isAppImpl(n as never);
export const nodeSlug = (n: unknown): string => slImpl(n as never);
export const appDir = (n: unknown): string => appDirImpl(n);

/* ───── helpers de conversa do Co-Dev (cartões, passos, perguntas, ritmo) ───── */
export const card = (label: string, html: string): Card => G.card(label, html);
export const tl = (host: HTMLElement, name: string, arg: unknown): HTMLElement => tlImpl(host, name, arg) as HTMLElement;
export const ask = (host: HTMLElement, btns: AskBtn[]): Promise<number> => G.ask(host, btns);
export const beat = (ms: number): Promise<void> => beatImpl(ms);
export const sleep = (ms: number): Promise<void> => G.sleep(ms);
export const user = (t: string): void => G.user(t);
export const note = (m: string): void => noteImpl(m);
export const runLabel = (): void => runLabelImpl();
export const runState = (on: boolean, label?: string): void => runStateImpl(on, label);
export const focusAgent = (nofocus?: boolean): void => G.focusAgent(nofocus);
export const agentPill = (): void => agentPillImpl();
export const handlePrompt = (q: string): void => G.handlePrompt(q);
export const scrollMsgs = (): void => scrollMsgsImpl();

/* ───── terminal + testes + variáveis CSS + aplicação de uma ferramenta ───── */
export const echo = (html: string): void => echoImpl(html);
export const echoCmd = (cmd: string): void => echoCmdImpl(cmd);
export const newInput = (nofocus?: boolean): void => newInputImpl(nofocus);
export const setPanelTab = (tab: string, nofocus?: boolean): void => G.setPanelTab(tab, nofocus);
export const getVar = (k: string): string => services.shell!.getVar(k);
/** Testes e lint do projecto aberto pelos comandos detectados (`DXR.projectCmd`), corridos a sério
 *  (`DXR.exec`, código de saída real). Sem desktop ou sem pasta, não há testes: `[]`. */
export const projectTests = async (): Promise<Array<{ n: string; ok: boolean }>> => {
  const dxr = G.DXR;
  if (!dxr || !dxr.root || typeof dxr.exec !== "function" || typeof dxr.projectCmd !== "function") return [];
  const out: Array<{ n: string; ok: boolean }> = [];
  for (const kind of ["test", "lint"]) {
    const c = dxr.projectCmd(kind) as { cmd: string } | null;
    if (c) out.push({ n: c.cmd, ok: !!(await dxr.exec(c.cmd)).ok });
  }
  return out;
};

/* ───── navegação / separadores / paleta de comandos / refresh ───── */
export const openTab = (t: OpenTabArg): void => G.openTab(t);
export const openGraph = (sel?: string): void => G.openGraph(sel);
export const openStudio = (): void => openStudioImpl();
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

/* ───── colaboradores das políticas que decoram o runner (ADR-0004, U4g3) ─────
   O harness do projecto (HARN, reviewIssue, codeGuard — features/team.ts), a vista de
   issue (openIssue — features/tasks.ts), o design do Studio (SD/saveSD), o diálogo (dlg —
   v6.ts) e o uso por provedor (USAGE — agentStore). Lidos no acto, como as decorações do app.ts/v5/v6 os liam por nome livre. */
export interface Harness { review?: boolean; explain?: boolean; tpl: string }
export interface StudioNode { id: string; st: string }
export interface DlgOpts {
  title: string; body: string; input?: string; ok?: string;
  validate?: (v: string) => string; onOk?: (v: string) => void;
}
export const harness = (): Harness => HARN as Harness;
export const reviewIssue = (id: string): void => reviewIssueImpl(id);
export const codeGuard = (what: string): boolean => codeGuardImpl(what);
export const openIssue = (id: string): void => G.openIssue(id);
export const studioNodes = (): StudioNode[] => G.SD.nodes;
export const saveSD = (): void => saveSDImpl();
export const dlg = (o: DlgOpts): void => coreDlg(o);  /* o diálogo é do core (era window.dlg do v6.ts; ADR-0004, U4g7) */
export const usage = (): Record<string, { tok: number }> => agentStore.usage;
export const commitNotes = (): Record<string, { note?: string }> => G.GIT.c;

/* ───── publicação da superfície pública no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global), os decoradores de
   app.ts/v5/v6 e os consumidores (studio/router/codev/tasks) que resolvem por global. */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
