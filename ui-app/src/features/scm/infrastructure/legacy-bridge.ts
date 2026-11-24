/* ═════════ dxtutor IDE — feature `scm` (Source Control + git): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `scm` autorizado a ler ou escrever `window.*`.
   `features/scm.ts` importa tudo o que precisa daqui (em vez de usar nomes globais
   livres), por isso passa a tipar-se em estrito como o `core.ts` — sem `@ts-nocheck`.

   Como o bridge do Co-Dev/ext, todos os acessores lêem `window`/`G` NO ACTO da chamada,
   nunca no import: `scm.ts` avalia ANTES de `app.ts` publicar os seus globais
   (`FS`/`AGENTS`/`RP`/`openTab`/`palette`/`refresh`/… saem do monólito depois de cada
   feature importada — incluindo esta — já ter avaliado). Capturar um valor ansiosamente
   aqui (`const x = window.x`) congelaria em `undefined`. Funções e getters são seguros
   porque só correm depois do arranque.

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito é declarada
   como `let`/`const`/`var` soltos (não como membros de `interface Window`), logo
   `window.x` não tipa para eles. Cada acessor exportado tem mesmo assim uma assinatura
   concreta e não-`any` — o `any` fica confinado a este ficheiro (regra «zero any fora
   do bridge»). */

import { toast, log, rerender } from "../../../core";
import type { Commit, GitState, FileEntry, Author } from "../domain/types";
export { toast, log, rerender };

const G = window as unknown as Record<string, any>;

/* Configuração da paleta de comandos (concern de UI/infra, não de domínio): o que
   `gfPrompt` (entrada de texto) e `pickBranch` (lista de itens) lhe passam. Espelha,
   em forma mais rica, o `PalCfg` solto de `features/palette.ts`. */
export interface PalItem { l: string; d?: string; run?: () => void }
export interface PalCfg { ph?: string; verb?: string; items?: PalItem[]; text?: (q: string) => void }

/* ───── estado git/scm: window-backed (o resíduo do monólito e as camadas
   v5/v6/bridge/pair aliasam estes nomes livres como globais). Os objectos (GIT/
   STAGED/LANE/COMMITS) são DONOS da feature e publicam-se via `publish`;
   os acessores abaixo lêem o `window` que os transporta, para que o motor e o
   resíduo partilhem a MESMA referência. ───── */
export const git = (): GitState => G.GIT;
export const lanes = (): string[] => G.LANE;
export const staged = (): Set<string> => G.STAGED;
export const commitsList = (): Array<{ h: string; m: string; n?: number }> => G.COMMITS;

/* primitivos window-puros (escritos também pelo resíduo: AUTHOR='lead' em runIssue, …) */
export const branch = (): string => G.BRANCH;
export const setBranch = (b: string): void => { G.BRANCH = b; };
export const commitMsg = (): string => G.COMMIT_MSG;
export const setCommitMsg = (m: string): void => { G.COMMIT_MSG = m; };
export const graphSel = (): string | null => G.GSEL;
export const setGraphSel = (h: string): void => { G.GSEL = h; };
export const author = (): string => G.AUTHOR;

/* ───── há um repositório git real aberto? (ADR-0006, R1d) ─────
   No desktop o `bridge.ts` (window.DXR) sabe-o: `DXR.git` é verdade quando a pasta aberta
   é um repo (o pair também o actualiza). Sem DXR — o browser — não há repositório. Os
   testes do harness (sem DXR) ligam o espelho pondo `REPO` a true no window
   (tests/fixtures/sample-history.ts). */
export const repo = (): boolean => (G.DXR ? !!G.DXR.git : G.REPO === true);
/** Há app desktop com uma pasta aberta (para oferecer `git init` nela)? */
export const desktopFolder = (): boolean => !!(G.DXR && G.DXR.root);
/** `git init` na pasta aberta (só desktop; DXR.gitInit cria o repo em `main`). */
export const gitInitFolder = (): void => { if (G.DXR && G.DXR.gitInit) G.DXR.gitInit(); };

/* ───── as versões PUBLICADAS de checkout/gitMerge (no desktop, decoradas pelo bridge.ts
   com git real), resolvidas no acto — o gitflow encadeia-as por aqui ───── */
export const decoratedCheckout = (b: string, create?: boolean): boolean => G.checkout(b, create);
export const decoratedMerge = (src: string, author?: string): Commit | null => G.gitMerge(src, author);

/* ───── sistema de ficheiros virtual + agentes (catálogo de autores) ───── */
export const files = (): Record<string, FileEntry> => G.FS;
export const agents = (): Record<string, { n: string; col: string }> => G.AGENTS;

/* ───── helpers de apresentação do monólito (ícone/caminho curto/tempo relativo) ───── */
export const fIcon = (path: string): string => G.fIcon(path);
export const short = (path: string): string => G.short(path);
export const rel = (t: number): string => G.rel(t);

/* ───── navegação / separadores / paleta / terminal / refresh ───── */
export const goPane = (p: string): void => G.goPane(p);
export interface OpenTabArg { id: string; title?: string; kind?: string; path?: string }
/* Rest-tuple: `openTab(t)` chega ao monólito como UM argumento (os goldens da Fase 0
   fixam a aridade exacta das chamadas). */
export const openTab = (...args: [t: OpenTabArg, act?: boolean]): void => G.openTab(...args);
export const palette = (pre: string, cfg?: PalCfg): void => G.palette(pre, cfg);
export const refresh = (...args: [fromEd?: boolean, force?: boolean]): unknown => G.refresh(...args);
export const termRefreshPrompt = (): void => G.termRefreshPrompt();

/* ───── registo de panes (RP.scm re-render disparado por stage) ───── */
export const panes = (): Record<string, () => void> => G.RP;

/* ───── acções disparadas pelos onclick inline do pane (resolvidas no acto) ───── */
export const openDiff = (p: string): void => G.openDiff(p);
export const openPath = (p: string): void => G.openPath(p);

/* ───── publicação da superfície pública da feature no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global) e as chamadas do
   resíduo @ts-nocheck de v5/v6/bridge/pair; os consumidores VIEW.graph/XC.git/
   checkpoint resolvem o motor por global. */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};

/* Re-exportação de tipos usados pelo resíduo (evita import directo de domain lá). */
export type { Commit, GitState, FileEntry, Author };
