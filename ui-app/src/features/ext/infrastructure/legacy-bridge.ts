/* ═════════ dxtutor IDE — feature `ext` (Open VSX): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `ext` autorizado a ler ou escrever `window.*`.
   `features/ext.ts` importa tudo o que precisa daqui (em vez de usar nomes globais
   livres), por isso passa a tipar-se em estrito como o `core.ts` — sem `@ts-nocheck`.

   Como o bridge do Co-Dev, todos os acessores lêem `window`/`G` NO ACTO da chamada,
   nunca no import: `ext.ts` avalia ANTES de `app.ts` publicar os seus globais
   (`CMD`/`RP`/`FS`/`tabOf`/`openTab`/… saem do `Object.assign(window,{…})` no fim do
   `app.ts`, depois de cada feature importada — incluindo esta — já ter avaliado).
   Capturar um valor ansiosamente aqui (`const x = window.x`) congelaria em `undefined`.
   Funções e getters são seguros porque só correm depois do arranque.

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito é declarada
   como `let`/`const`/`var` soltos (não como membros de `interface Window`), logo
   `window.x` não tipa para eles. Cada acessor exportado tem mesmo assim uma assinatura
   concreta e não-`any` — o `any` fica confinado a este ficheiro (regra «zero any fora
   do bridge»). */

import { toast, rerender } from "../../../core";
import type { ExsState } from "../domain/types";
import { desktopPorts } from "../../../app/desktop";
export { toast, rerender };

const G = window as unknown as Record<string, any>;

/* ───── estado instalado, window-backed (`window.EXS`) ─────
   As formas puras (`ExtItem`/`ExsState`/`ExtCmd`) vivem agora em `../domain/types`
   (Fase 2); aqui só se toca no `window` que as transporta. */
/** Estabelece (uma vez, no eval de `ext.ts`) e devolve `window.EXS` com os defaults,
 *  preservando o já existente. Eager de propósito: a rede de segurança lê `w.EXS`
 *  logo após o boot, sem render; a hidratação de `LS` é que fica preguiçosa em `ext.ts`. */
export const initExs = (): ExsState => {
  const w = window as unknown as { EXS?: ExsState };
  w.EXS = w.EXS && w.EXS.inst ? w.EXS : { inst: { "rust-lang.rust-analyzer": { on: 1 } }, vsix: [] };
  return w.EXS;
};

/* ───── armazenamento persistente (`LS`, dono do monólito; leitura preguiçosa em ext.ts) ───── */
export const lsGet = <T>(key: string, def: T): T => G.LS.get(key, def);
export const lsSet = (key: string, value: unknown): void => G.LS.set(key, value);

/* ───── paleta de comandos (`CMD`): array mutado em sítio (splice/push) pelo motor ───── */
export type CmdEntry = [string, string, (() => unknown)?, string?];
export const commands = (): CmdEntry[] => G.CMD;

/* ───── registo de panes / pane activo ───── */
export const panes = (): Record<string, () => void> => G.RP;
export const pane = (): string => window.PANE;

/* ───── sistema de ficheiros virtual + separadores ───── */
export const files = (): Record<string, { content: string; orig: string | null }> => window.FS;
export const cur = (): string | null => window.cur;
/** `tabOf` tipado mais rico que o de `core` (precisamos de `.path` além de `.kind`). */
export const tabOf = (id: string | null): { kind?: string; path?: string } | null => G.tabOf(id);
export interface OpenTabArg { id: string; title?: string; kind?: string; ext?: string }
/* Rest-tuple: `openTab(t)` tem de chegar ao monólito como UM argumento, não `openTab(t, undefined)`
   (os testes de caracterização da Fase 0 fixam a aridade exacta das chamadas). */
export const openTab = (...args: [t: OpenTabArg, act?: boolean]): void => G.openTab(...args);

/* ───── editor / diagnósticos / contexto de projecto ───── */
export const paintEd = (path: string): void => G.paintEd(path);
export const extOf = (path: string): string => G.extOf(path);
export const projectContext = (): Array<[string, string]> => window.projectContext();
export const refresh = (...args: [fromEd?: boolean, force?: boolean]): unknown => window.refresh(...args);

/* ───── acções que os comandos do catálogo disparam (resolvidas no acto) ───── */
export const doSearch = (): void => window.doSearch();
export const goPane = (p: string): void => G.goPane(p);
export const openGraph = (): void => G.openGraph();
export const runTask = (cmd: string): unknown => G.runTask(cmd);
export const dxRun = (): void => G.dxRun();
export const dxStop = (): void => G.dxStop();
export const dxDeploy = (): void => G.dxDeploy();

/* ───── VSIX: biblioteca de unzip (JSZip). Superfície mínima tipada aqui (infra). ───── */
export interface JSZipFile { async(type: string): Promise<string> }
export interface JSZipArchive { file(path: string): JSZipFile | null }
export interface JSZipLib { loadAsync(data: unknown): Promise<JSZipArchive> }
/** Carregador por omissão (fallback CDN) — o corpo toca `document`/`window.JSZip`, por
 *  isso vive aqui, na infra, e não em `ext.ts`. No desktop, `bridge.ts` sobrepõe
 *  `window.loadJSZip` por uma versão que embarca o JSZip com a app. */
const cdnLoader = (): Promise<JSZipLib> => {
  if (G.JSZip) return Promise.resolve(G.JSZip as JSZipLib);
  return new Promise<JSZipLib>((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => ok(G.JSZip as JSZipLib);
    s.onerror = () => no(new Error("could not load the unzip library"));
    document.head.appendChild(s);
  });
};
/** Publica o carregador CDN em `window.loadJSZip` (chamado no eval de `ext.ts`, como o
 *  original — o desktop sobrepõe-no depois). */
export const publishJSZipLoader = (): void => {
  /* o carregador publicado consulta a porta desktop (ADR-0004, U4h5b; antes o desktop sobrepunha o `window.loadJSZip`) */
  G.loadJSZip = (): Promise<JSZipLib> => { const d = desktopPorts.ext; return d ? (d.loadJSZip(cdnLoader) as Promise<JSZipLib>) : cdnLoader(); };
};
/** Invoca o `window.loadJSZip` CORRENTE (respeita a sobreposição do desktop). */
export const callLoadJSZip = (): Promise<JSZipLib> => G.loadJSZip();

/* ───── publicação da superfície pública da feature no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global) e as chamadas do resíduo
   @ts-nocheck de `v6.ts`; os shims de `v6` (RP.ext/VIEW.extd) delegam nestes. */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
