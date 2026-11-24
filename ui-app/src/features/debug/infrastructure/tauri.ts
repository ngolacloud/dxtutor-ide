/* ═════════ feature `debug` — adaptador Tauri (ADR-0006, R4) ═════════
   O motor gdb/MI do backend (src-tauri/src/commands/debug_cmds.rs): `debug_available`,
   `debug_launch`, `debug_break`, `debug_run`, `debug_continue`, `debug_step`, `debug_locals`,
   `debug_stack`, `debug_stop`. Não toca em `window` (o cliente tipado é que o faz). */

import { invoke, isDesktop, type Invoker } from "../../../platform/tauri/core";
import type { DebugPort } from "../application/ports";
import type { Frame, Stop, Var } from "../domain/session";

export const tauriDebug = (inv: Invoker = invoke, desktop: () => boolean = isDesktop): DebugPort => ({
  available: async () => (desktop() ? inv<boolean>("debug_available") : false),
  launch: (id, program, cwd) => inv<void>("debug_launch", { id, program, cwd }),
  breakAt: (id, file, line) => inv<number>("debug_break", { id, file, line }),
  run: (id) => inv<Stop>("debug_run", { id }),
  cont: (id) => inv<Stop>("debug_continue", { id }),
  step: (id, into) => inv<Stop>("debug_step", { id, into }),
  locals: (id) => inv<Var[]>("debug_locals", { id }),
  stack: (id) => inv<Frame[]>("debug_stack", { id }),
  stop: (id) => inv<void>("debug_stop", { id }),
});
