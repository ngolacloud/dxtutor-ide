/* ═════════ dxtutor IDE — armazenamento local (ADR-0004, U4f) ═════════
   O `localStorage` da app com o prefixo `dx2.` e JSON: `LS.get(k, omissão)` nunca lança
   (dados corrompidos ou armazenamento bloqueado → a omissão) e `LS.set` ignora falhas.
   Era a constante `LS` do app.ts; continua publicada no window (26 ficheiros lêem-na). */

export const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("dx2." + k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem("dx2." + k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível: vale só nesta execução */
    }
  },
};

Object.assign(window, { LS });
