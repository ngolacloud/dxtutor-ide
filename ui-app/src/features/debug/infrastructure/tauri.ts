/* ═════════ feature `debug` — adaptador Tauri (ADR-0006, R4; A7) ═════════
   O motor do backend (src-tauri/src/commands/debug_cmds.rs): `debug_available`, `debug_launch`
   (DAP com um adaptador no PATH, senão gdb/MI), `debug_break`, `debug_run`, `debug_continue`,
   `debug_step`, `debug_locals`, `debug_stack`, `debug_stop`; e, só com DAP (A7),
   `debug_set_breakpoints`, `debug_stop_on_panic`, `debug_threads`, `debug_variables`,
   `debug_evaluate`, `debug_pause` e o evento `debug://output`. A porta do projecto: os breakpoints
   guardados (`breakpoints_load`/`breakpoints_save`), o snapshot (`debug_snapshot`) e as issues
   abertas (`project_load`). Não toca em `window` (o cliente tipado é que o faz). */

import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import type { DebugPort, ProjectDebugPort } from "../application/ports";
import type { Frame, Stop, Var } from "../domain/session";
import type { BpMeta, DapThread, LaunchInfo, VarNode } from "../domain/dap";

export const tauriDebug = (inv: Invoker = invoke, desktop: () => boolean = isDesktop): DebugPort => ({
  available: async () => (desktop() ? inv<boolean>("debug_available") : false),
  launch: (id, program, cwd) => inv<LaunchInfo | null>("debug_launch", { id, program, cwd }).then((r) => r ?? undefined),
  breakAt: (id, file, line) => inv<number>("debug_break", { id, file, line }),
  run: (id) => inv<Stop>("debug_run", { id }),
  cont: (id) => inv<Stop>("debug_continue", { id }),
  step: (id, into, kind) => inv<Stop>("debug_step", kind ? { id, into, kind } : { id, into }),
  locals: (id) => inv<Var[]>("debug_locals", { id }),
  stack: (id, thread) => inv<Frame[]>("debug_stack", thread === undefined ? { id } : { id, thread }),
  stop: (id) => inv<void>("debug_stop", { id }),
  setBreakpoints: (id, file, breakpoints) => inv<Array<{ line: number; verified: boolean; message: string | null }>>("debug_set_breakpoints", { id, file, breakpoints }),
  stopOnPanic: (id, on) => inv<boolean>("debug_stop_on_panic", { id, on }),
  threads: (id) => inv<DapThread[]>("debug_threads", { id }),
  variables: (id, frame, reference) => inv<VarNode[]>("debug_variables", { id, frame, reference: reference ?? null }),
  evaluate: (id, expression, frame) => inv<VarNode>("debug_evaluate", { id, expression, frame }),
  pause: (id) => inv<void>("debug_pause", { id }),
  attachTargets: (target) => inv<{ ok: boolean; places: string[]; processes: Array<{ pid: number; command: string }>; adapter: string | null; notes: string }>("debug_attach_targets", { target }),
  attach: (id, target, pid, adapter, root, remoteRoot) => inv<LaunchInfo>("debug_attach", { id, target, pid, adapter, root, remoteRoot }),
  onOutput: (f) => {
    if (!desktop()) return;
    void listen("debug://output", (p) => {
      const o = p as { id?: string; category?: string; text?: string };
      if (o && typeof o.id === "string") f(o.id, o.category ?? "console", o.text ?? "");
    });
  },
});

type KeptBp = { file: string; line: number } & BpMeta;

export const tauriProjectDebug = (inv: Invoker = invoke): ProjectDebugPort => ({
  load: (root) => inv<KeptBp[]>("breakpoints_load", { root }),
  save: (root, file, breakpoints) => inv<void>("breakpoints_save", { root, file, breakpoints }),
  snapshot: (root, id, issue, title, markdown) => inv<void>("debug_snapshot", { root, id, issue, title, markdown }),
  issues: async (root) => {
    const p = await inv<{ issues?: Array<{ key: string; title: string; state?: string }> }>("project_load", { root });
    return (p.issues ?? []).filter((i) => i.state !== "done").map((i) => ({ key: i.key, title: i.title }));
  },
});
