/* ═════════ feature `visualizer` (Visualize execution): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `visualizer` autorizado a ler ou escrever `window.*`
   (invariante A8 do arch-check, agora que `visualizer` entra em FEATURES). Os
   ficheiros TIPADOS da subárvore (`ui/actions.ts` e, se preciso, `application/`)
   importam daqui em vez de usar nomes globais livres.

   Como os bridges do Co-Dev/scm/debug/board, os acessores lêem `window`/`G` NO ACTO
   da chamada, nunca no import: a feature avalia ANTES de `app.ts`/`v5.ts`/`v6.ts`
   publicarem os seus globais (LS/FS/VZS/VZ e os controlos do overlay). Capturar um
   valor ansiosamente aqui (`const x = window.x`) congelaria em `undefined`. Funções
   e getters são seguros porque só correm depois do arranque (cliques, delegações).

   `G` é a válvula de escape deliberada: a maioria dos globais do monólito/camadas é
   declarada solta (não em `interface Window`), logo `window.x` não tipa. Cada acessor
   exportado tem mesmo assim uma assinatura concreta e não-`any` (regra «zero any fora
   do bridge»).

   NOTA de fronteira: o domínio puro (`domain/`: vzLex/vzParse/vzHints/vzRun/vzTell)
   NÃO passa por aqui — é puro e importa-se directamente. O overlay (vzRender/vzArrows/
   vizOpen…) e `boot7` continuam a viver no resíduo `features/visualizer.ts` (@ts-nocheck,
   fora da subárvore governada), como o markup do board/scm/debug; este bridge serve o
   `publish()` do resíduo e os controlos que o `ui/actions.ts` delega na Fase 4. */

const G = window as unknown as Record<string, any>;

/** Estado do overlay (reatribuído por `vizOpen`, window-backed). Só os campos que
 *  os handlers do overlay lêem/escrevem; o resto do objecto é opaco aqui. */
export interface VizState {
  i: number;
  timer: ReturnType<typeof setInterval> | null;
  depth: "basic" | "memory" | "machine";
  predict: boolean;
  speed: number;
  pending: unknown;
  res: { steps: unknown[] } | null;
  origin: string | null;
  title: string;
}

export interface FileEntry { content: string }

export const files = (): Record<string, FileEntry> => G.FS;

/* ───── preferências persistidas (porta de armazenamento do monólito) ───── */
export const lsGet = <T>(k: string, d: T): T => G.LS.get(k, d);
export const lsSet = (k: string, v: unknown): void => { G.LS.set(k, v); };


/* ───── publicação da superfície pública no `window` ─────
   Os nomes reais resolvem os `onclick` inline (escopo global), o arranque `boot7`
   (startup.ts), e os consumidores que resolvem por global (i18n, menus/CMD). */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
