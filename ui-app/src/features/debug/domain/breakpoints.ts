/* ═══════════ feature `debug` — domain: chaves de breakpoint (ADR-0002, Fase 2) ═══════════
   Regras PURAS da chave de um breakpoint (`caminho:linha`). Sem DOM, sem `window`.
   (Antes viviam embebidas em `features/debug.ts`: `p+':'+l` no toggle e o
   `split/slice` no render.) O Set vivo e a persistência em LS ficam na infra/motor. */

/** A chave canónica de um breakpoint: `caminho:linha`. */
export const bpKey = (path: string, line: number): string => path + ":" + line;

/** A linha de uma chave de breakpoint (o segmento após o último `:`). */
export const bpLine = (key: string): string => key.split(":").pop() as string;

/** O caminho de uma chave de breakpoint (tudo antes do `:linha` final). */
export const bpPath = (key: string): string => { const l = bpLine(key); return key.slice(0, key.length - l.length - 1); };
