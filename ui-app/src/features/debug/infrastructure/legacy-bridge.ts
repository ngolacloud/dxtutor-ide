/* ═════════ feature `debug` (Run and Debug): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `debug` autorizado a ler ou escrever `window.*`.
   `features/debug.ts` (e, nas fases seguintes, o motor em `application/`) importa daqui
   em vez de usar nomes globais livres, por isso deixa de ser `@ts-nocheck`: cada acesso
   fica tipado e o `any` confina-se a este ficheiro (regra «zero any fora do bridge»).

   Como os bridges do Co-Dev/scm, os acessores lêem `window`/`G` NO ACTO da chamada,
   nunca no import: `debug.ts` avalia ANTES de `app.ts`/`v6.ts` publicarem os seus
   globais (FS/RP/goPane/tabOf/getVar/… e os helpers de lexer lexVariant/LXL de v6).
   Capturar um valor ansiosamente aqui (`const x = window.x`) congelaria em `undefined`.
   Funções e getters são seguros porque só correm depois do arranque (cliques, keydown).

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito/camadas é
   declarada como `let`/`const`/`function` solta (não em `interface Window`), logo
   `window.x` não tipa. Cada acessor exportado tem mesmo assim uma assinatura concreta
   e não-`any`. */

import type { DbgSession, EnvDep, EnvState, FileEntry } from "../domain/types";
import { dlg as coreDlg } from "../../../core";
export type { EnvDep, EnvState };

const G = window as unknown as Record<string, any>;

/* ───── estado da sessão + breakpoints: window-backed ─────
   `window.DBG`/`window.BPS` transportam o estado para que os `onclick="…DBG.…"`
   inline (escopo global) e o resíduo de v6.ts (`window.dbgState()`/`dbgBreaks`) vejam
   a MESMA referência que o motor. O resíduo é dono de um `let DBG` que espelha
   `window.DBG` via `writeSession`. */

/** Lê a sessão actual de `window.DBG` (para inicializar o espelho do resíduo). */
export const readSession = (): DbgSession | null => (G.DBG ?? null) as DbgSession | null;
/** Escreve a sessão em `window.DBG` (os handlers inline resolvem `DBG` no global). */
export const writeSession = (s: DbgSession | null): void => { G.DBG = s; };
/** O Set de breakpoints (`path:line`), reutilizado se já existir no `window`. */
export const breakpoints = (): Set<string> => (G.BPS = G.BPS instanceof Set ? G.BPS : new Set<string>());

/* ───── sistema de ficheiros virtual + caminho do lexer ───── */
export const pLx = (): string => G.P_LX;
export const files = (): Record<string, FileEntry> => G.FS;

/* ───── navegação / separador actual / painel / variáveis CSS / registo de panes ───── */
export interface EditorTab { path?: string; kind?: string }
/** O separador actualmente activo (`tabOf(cur)`), ou `null`. */
export const currentTab = (): EditorTab | null => G.tabOf(G.cur) ?? null;
export const pane = (): string => G.PANE;
export const goPane = (p: string): void => G.goPane(p);
export const openPath = (p: string, line?: number): void => G.openPath(p, line);
export const paintEd = (p: string): void => G.paintEd(p);
export const setPanelTab = (pt: string, nofocus?: boolean): void => G.setPanelTab(pt, nofocus);
export const togglePanel = (): void => G.togglePanel();
export const getVar = (k: string): string => G.getVar(k);
export const setVar = (k: string, v: string): void => G.setVar(k, v);
export const panes = (): Record<string, () => void> => G.RP;

/* ───── helpers de lexer (vivem em v6.ts; publicados no window) ─────
   `lexVariant` reporta a variante do fonte do lexer; `lexLine` (LXL) devolve o nº da
   primeira linha que casa a regex. Tornam-se portas injectadas na Fase 3. */
export const lexVariant = (): string => G.lexVariant();
/** O lexer do seed tem o bug E0382 (o `for` move `chars`)? (features/diagnostics.ts) */
export const lexBug = (): boolean => G.lexBug();
export const lexLine = (re: RegExp): number => G.LXL(re);

/* ───── ambientes/segredos (infra; para os lançadores crash e `crashTrace`) ─────
   `EnvDep`/`EnvState` são formas do domínio (re-exportadas acima). */
export interface Envx {
  ns: Record<string, string>;
  sec: Record<string, Record<string, Record<string, string>>> | null;
  st: Record<string, EnvState | null>;
}
export const envState = (env: string): EnvState | null => G.envState(env);
export const envx = (): Envx => G.ENVX;
export const envLabels = (): Record<string, string> => G.ENVL;
export const localSecrets = (): Record<string, Record<string, string>> => G.localSecrets();
export const urlHosts = (v: string): string | null => G.urlHosts(v);

/* ───── acções que saltam para outras features do monólito (a partir das probes do
   feed): «explicar em profundidade» e «abrir os segredos de staging» ───── */
export const explainDeep = (): void => G.explainCmd(true);
export const openStagingSecrets = (): void => { G.openEnvs(); G.SHOWSEC = true; G.rerender("envs"); };

/* ───── humanos no comando / checkpoints / diálogo ───── */
export const isHuman = (what: string): boolean => G.isHuman(what);
export const checkpoint = (label: string): void => G.checkpoint(label);
export interface DlgOpts { title: string; body: string; ok?: string; onOk?: () => void }
export const dlg = (opts: DlgOpts): void => coreDlg(opts);  /* o diálogo é do core (era window.dlg do v6.ts; ADR-0004, U4g7) */

/* ───── persistência (LS, para os breakpoints `bps6`) ───── */
export const lsGet = <T>(key: string, def: T): T => G.LS.get(key, def);
export const lsSet = (key: string, val: unknown): void => G.LS.set(key, val);

/* ───── publicação da superfície pública da feature no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global), o keydown/menus de
   v6.ts, e as fachadas que o resíduo de v6 lê (dbgState/dbgBreaks/dbgLaunch). */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
