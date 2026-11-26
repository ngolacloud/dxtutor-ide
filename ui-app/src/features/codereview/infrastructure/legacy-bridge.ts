import { services } from "../../../app/services";
import { composeServices as composeServicesImpl } from "../../stack";
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

/* ───── agente / conversa (publicados por `features/codev.ts`; resolvidos por `G`) ───── */
export const focusAgent = (nofocus?: boolean): void => G.focusAgent(nofocus);
export const liveChat = (q: string): void => G.liveChat(q);

/* ───── diagnósticos (os reais do painel Problems no desktop; tipados em `core.ts`) ───── */
export const diagnostics = (): { p: string; line: number; sev: string; msg: string }[] => services.diagnostics!.diagnostics();

/* ───── símbolos do ficheiro / selecção do editor (tipados em `core.ts`) ───── */
export const symbols = (p: string): Array<{ k: string; n: string; line: number }> => window.symbols(p);
export const selText = (): string => window.selText();
/** A linha (1-based) onde começa a selecção do editor (1 sem editor). */
export const selLine = (): number => {
  const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
  return ta ? ta.value.slice(0, ta.selectionStart).split("\n").length : 1;
};

/* ───── o painel de documento (Explain · Code review) ───── */
/** Realce de uma linha (o `hlLine` do editor, publicado por `features/syntax.ts`). */
export const hlLine = (s: string, ext: string): string => (typeof G.hlLine === "function" ? G.hlLine(s, ext) : s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
/** Escreve um ficheiro do workspace pelo editor (o autosave do desktop leva-o ao disco). */
export const writeFile = (p: string, content: string): void => window.writeFile(p, content);
/** Há um modelo pronto: no desktop, o amostrador real e algum provider ligado; no browser, o Claude ao vivo. */
export const aiReady = (): boolean => {
  if (!G.SAMPLE) return false;
  const P = G.PROV as Record<string, { on?: boolean }> | undefined;
  if (!P) return false;
  return G.DXR ? ["claude", "codex", "gemini", "ollama"].some((k) => !!P[k]?.on) : !!P.claude?.on;
};
/** Pede texto ao modelo, sem ferramentas (no desktop: o streaming real `assistant_chat_stream`). */
export const aiStream = async (prompt: string, o: { signal: AbortSignal; onText: (text: string) => void }): Promise<string> => {
  const sample = G.SAMPLE as (input: string, opts: { signal: AbortSignal; onText: (e: { text: string }) => void }) => Promise<{ text?: string }>;
  const r = await sample(prompt, { signal: o.signal, onText: ({ text }) => o.onText(text) });
  return (r && r.text) || "";
};
/** Grava o editor no disco (autosave do desktop) e espera pela fila de escrita. */
export const saveAll = async (): Promise<void> => {
  const d = G.DXR as { flush?: () => void; idle?: () => Promise<unknown> } | undefined;
  d?.flush?.();
  await d?.idle?.();
};
/** O comando de testes detectado no projecto aberto (null se nenhum). */
export const projectTestCmd = (): string | null => (G.DXR?.projectCmd?.("test")?.cmd as string | undefined) ?? null;

/* ───── serviços de um docker-compose (dono = `features/stack.ts`; tipado em `core.ts`) ───── */
export interface Svc { name: string; deps: string[]; image?: string; build?: string; port?: string; route?: string; hc?: boolean }
export const composeServices = (): Svc[] | null => composeServicesImpl() as Svc[] | null;

/* ───── a pasta aberta (desktop) e o prefixo das chaves do FS (ADR-0006, R2e2) ───── */
/** A pasta aberta no desktop (null sem pasta e no browser). */
export const desktopRoot = (): string | null => (G.DXR && G.DXR.root) || null;
/** O prefixo das chaves do `FS` (`ROOT`): `ROOT + caminho relativo` = chave. */
export const fsRoot = (): string => G.ROOT;

/* ───── publicação da superfície pública da feature no `window` ─────
   `renderCreviewView`/`renderHoodView` são o alvo dos shims `VIEW.creview`/`VIEW.hood`
   (v6.ts); `curFile`/`explainCmd`/`reviewCmd`/`hoodCmd`/`reviewFindings` são lidos por
   nome livre pelo resíduo @ts-nocheck de v6.ts (EACT, keydown, boot6/menus). */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
