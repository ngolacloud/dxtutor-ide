/* ═════════ dxtutor IDE — `codev.ask` registry (A2.4) ═════════
   The one way other features ask Co-Dev, without a window global: the Co-Dev feature
   registers its implementation here; the editor menu, the shortcuts and the panel import
   this module and call it. Unset (Co-Dev not loaded) → the calls do nothing. */

import type { AskRequest } from "../features/codev/domain/ask";

let impl: ((r: AskRequest) => Promise<void>) | null = null;
let fromEditor: (() => void) | null = null;

export const codevAsk = {
  /** Co-Dev: registers the implementation. */
  register(ask: (r: AskRequest) => Promise<void>, editor: () => void): void {
    impl = ask;
    fromEditor = editor;
  },
  available: (): boolean => impl !== null,
  /** Ask Co-Dev: intent + context + scope (see features/codev/domain/ask.ts). */
  ask(r: AskRequest): Promise<void> {
    return impl ? impl(r) : Promise.resolve();
  },
  /** Ctrl+I / «Enviar selecção ao Co-Dev»: the editor's selection (or file) as context. */
  fromEditor(): void {
    fromEditor?.();
  },
};
