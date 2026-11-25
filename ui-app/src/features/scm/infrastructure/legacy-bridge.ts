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
import { editorStore } from "../../../app/store/editor";
import type { Commit, GitState, FileEntry, Author } from "../domain/types";
import { services } from "../../../app/services";
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
export const lanes = (): string[] => services.scm!.LANE;
export const staged = (): Set<string> => G.STAGED;
export const commitsList = (): Array<{ h: string; m: string; n?: number }> => G.COMMITS;

/* primitivos window-puros (escritos também pelo resíduo: AUTHOR='lead' em runIssue, …) */
export const branch = (): string => G.BRANCH;
export const setBranch = (b: string): void => { G.BRANCH = b; };
/* a mensagem do commit e o commit seleccionado no grafo: deste módulo desde a U7p3 do ADR-0004 (eram window.*) */
let COMMIT_MSG = "";
let GSEL: string | null = null;
export const commitMsg = (): string => COMMIT_MSG;
export const setCommitMsg = (m: string): void => { COMMIT_MSG = m; };
export const graphSel = (): string | null => GSEL;
export const setGraphSel = (h: string | null): void => { GSEL = h; };
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
export const decoratedMerge = (src: string, author?: string): Commit | null => services.scm!.gitMerge(src, author) as Commit | null;

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

/* ───── A4 (docs/v2/UI-AUDIT.md item 9): o que o trabalho git novo lê do desktop ───── */
interface Dxr { root?: string | null; git?: boolean; flush?: () => void; idle?: () => Promise<unknown>; reloadDisk?: () => Promise<unknown>; syncGit?: () => Promise<unknown> }
const dxr = (): Dxr | undefined => G.DXR as Dxr | undefined;
/** A pasta aberta quando é um repositório git (null sem pasta, sem repo ou no browser). */
export const gitRoot = (): string | null => { const d = dxr(); return d && d.root && d.git ? d.root : null; };
/** O nome da pasta aberta. */
export const projectName = (): string => { const r = dxr()?.root || ""; return r.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "project"; };
/** Grava o editor no disco e espera pela fila de escrita. */
export const saveToDisk = async (): Promise<void> => { const d = dxr(); d?.flush?.(); await d?.idle?.(); };
/** O git mudou a árvore ou as refs: recarrega os ficheiros e o grafo. */
export const reloadFromGit = async (): Promise<void> => { const d = dxr(); await d?.reloadDisk?.(); await d?.syncGit?.(); };
/** O ficheiro e a linha do editor (caminho relativo à pasta) e as linhas seleccionadas. */
export const editorCursor = (): { path: string; line: number; start: number; end: number } | null => {
  const t = editorStore.tabs.find((x) => x.id === editorStore.currentTabId);
  const p = t && t.kind === "file" ? (typeof t.path === "string" ? t.path : t.id) : "";
  const root = G.ROOT as string;
  if (!p || !root || !p.startsWith(root)) return null;
  const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
  const lineAt = (i: number): number => (ta ? ta.value.slice(0, i).split("\n").length : 1);
  const line = ta ? lineAt(ta.selectionStart) : 1;
  const end = ta ? lineAt(Math.max(ta.selectionStart, ta.selectionEnd - (ta.selectionEnd > ta.selectionStart ? 1 : 0))) : line;
  return { path: p.slice(root.length), line, start: Math.min(line, end), end: Math.max(line, end) };
};
/** O prefixo dos caminhos do editor (as chaves do FS são `ROOT` + caminho relativo). */
export const rootKey = (): string => (typeof G.ROOT === "string" ? G.ROOT : "");
/** O `discard` publicado (o do motor: repõe o ficheiro do último commit) de uma chave do FS. */
export const decoratedDiscard = (p: string): void => services.scm!.discard(p);
/** Abre o diff de um ficheiro (caminho relativo à pasta). */
export const openDiffRel = (rel: string): void => G.openDiff(rootKey() + rel);
/** Abre um ficheiro (caminho relativo à pasta) numa linha. */
export const openRel = (rel: string, line?: number): void => (G.openPath as (p: string, l?: number) => void)((G.ROOT as string) + rel, line);

/** r23 F3 (UI-SCM-13): a verificação do projecto antes de concluir um merge — o comando de lint (ou, sem ele, o de
 *  testes) detectado na pasta, corrido pelo desktop (`DXR.exec`). `null` sem pasta ou sem comando. */
export const projectCheck = async (): Promise<{ cmd: string; ok: boolean; summary: string } | null> => {
  const d = dxr() as unknown as { projectCmd?: (k: "lint" | "test") => { cmd: string } | null; exec?: (c: string) => Promise<{ ok: boolean; sum: string }> } | null;
  const c = d?.projectCmd?.("lint") ?? d?.projectCmd?.("test");
  if (!c || !d?.exec) return null;
  const r = await d.exec(c.cmd);
  return { cmd: c.cmd, ok: r.ok, summary: r.sum };
};
