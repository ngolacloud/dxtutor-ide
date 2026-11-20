/* ═════════ dxtutor IDE — feature `codereview`: legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `codereview` (Explain · Code review · Under the hood)
   autorizado a ler ou escrever `window.*`. `features/codereview.ts` importa tudo o que
   precisa daqui (em vez de usar nomes globais livres), por isso tipa-se em estrito como
   o `core.ts` — sem `@ts-nocheck` nem `any`.

   Como os bridges do Co-Dev e do `ext`, todos os acessores lêem `window`/`G` NO ACTO da
   chamada, nunca no import: `codereview.ts` avalia ANTES de `app.ts`/`v6.ts` publicarem
   os seus globais (`FS`/`tabOf`/`extOf`/`openTab`/… saem do `Object.assign(window,{…})`
   no fim de `app.ts`, depois de cada feature importada — incluindo esta — já ter
   avaliado). Capturar um valor ansiosamente aqui (`const x = window.x`) congelaria em
   `undefined`. Funções e getters são seguros porque só correm depois do arranque.

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito é declarada
   como `let`/`const`/`var` soltos (não como membros de `interface Window`), logo
   `window.x` não tipa para eles. Cada acessor exportado tem mesmo assim uma assinatura
   concreta e não-`any` — o `any` fica confinado a este ficheiro (regra «zero any fora
   do bridge»). O que já está tipado em `core.ts` (`interface Window`) lê-se directo por
   `window.X`; o resto passa por `G`. */

const G = window as unknown as Record<string, any>;

/* ───── sistema de ficheiros virtual + separador activo ─────
   `FS`/`short`/`changes` já estão tipados em `core.ts`; `cur` é o estado partilhado
   (`window.cur`). `tabOf` precisa de `.path` além de `.kind`, por isso vai por `G`
   (o `window.tabOf` de `core` só expõe `{ kind? }`). */
export const files = (): Record<string, { content: string; orig: string | null }> => window.FS;
export const currentTabId = (): string | null => window.cur;
export interface ReviewTab { id?: string; title?: string; kind?: string; path?: string }
export const tabOf = (id: string | null): ReviewTab | null => G.tabOf(id);
export const short = (p: string): string => window.short(p);
export const extOf = (p: string): string => G.extOf(p);
export const changes = (): string[] => window.changes();
/* Rest-tuple: `openTab(t)` tem de chegar ao monólito como UM argumento, não
   `openTab(t, undefined)` (a caracterização da Fase 0 fixa a aridade exacta). */
export const openTab = (...args: [t: ReviewTab & { id: string }, act?: boolean]): void => G.openTab(...args);
/* Abre um ficheiro (opcionalmente numa linha). Rest-tuple pela mesma razão do
   `openTab`: `openPath(p)` tem de chegar ao monólito como UM argumento, não
   `openPath(p, undefined)`. Consumido pela tabela de acções da Fase 4. */
export const openPath = (...args: [p: string, line?: number]): void => G.openPath(...args);

/* ───── caminhos do workspace-protótipo (donos de `app.ts`; só existem após o boot) ───── */
export const pathLexer = (): string => G.P_LX;
export const root = (): string => G.ROOT;
export const pathHistory = (): string => G.P_HIST;

/* ───── agente / conversa (publicados por `features/codev.ts`; resolvidos por `G`) ───── */
export const focusAgent = (nofocus?: boolean): void => G.focusAgent(nofocus);
export const user = (msg: string): void => G.user(msg);
export const card = (title: string, html: string): void => G.card(title, html);
export const liveChat = (q: string): void => G.liveChat(q);
export const updateAgentUI = (): void => window.updateAgentUI();
/** Provedor LLM activo (escrita); `ACTIVE` é global solto do monólito. */
export const setActiveProvider = (v: string): void => { G.ACTIVE = v; };
/** Amostrador do Claude ao vivo; `null` quando não há backend ligado nesta vista. */
export const sample = (): unknown => G.SAMPLE ?? null;

/* ───── diagnósticos / lint / lexer-protótipo (tipados em `core.ts`) ───── */
export const diagnostics = (): { p: string; line: number; sev: string; msg: string }[] => window.diagnostics();
export const dsLint = (): { p: string; line: number; hex: string }[] => window.dsLint();
export const lexBug = (): boolean => window.lexBug();
export const LXL = (re: RegExp): number => window.LXL(re);
export const lexVariant = (): string => window.lexVariant();

/* ───── símbolos do ficheiro / selecção do editor / sessão de debug (tipados em `core.ts`) ───── */
export const symbols = (p: string): Array<{ k: string; n: string; line: number }> => window.symbols(p);
export const selText = (): string => window.selText();
export const dbgState = (): { end?: { t: string; b: string }; feed: Array<{ h: string }> } | null => window.dbgState();

/* ───── serviços de um docker-compose (dono = `features/stack.ts`; tipado em `core.ts`) ───── */
export interface Svc { name: string; deps: string[]; image?: string; build?: string; port?: string; route?: string; hc?: boolean }
export const composeServices = (): Svc[] | null => window.composeServices();

/* ───── publicação da superfície pública da feature no `window` ─────
   `renderCreviewView`/`renderHoodView` são o alvo dos shims `VIEW.creview`/`VIEW.hood`
   (v6.ts); `curFile`/`explainCmd`/`reviewCmd`/`hoodCmd`/`reviewFindings` são lidos por
   nome livre pelo resíduo @ts-nocheck de v6.ts (EACT, keydown, boot6/menus) e por
   `features/debug.ts` (onclick "explainCmd(true)"). */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
