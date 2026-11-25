/* ═════════ feature `debug` — adaptador Tauri (ADR-0006, R4; A7) ═════════
   O motor do backend (src-tauri/src/commands/debug_cmds.rs): `debug_available`, `debug_launch`
   (DAP com um adaptador no PATH, senão gdb/MI), `debug_break`, `debug_run`, `debug_continue`,
   `debug_step`, `debug_locals`, `debug_stack`, `debug_stop`; e, só com DAP (A7),
   `debug_set_breakpoints`, `debug_stop_on_panic`, `debug_threads`, `debug_variables`,
   `debug_evaluate`, `debug_pause` e o evento `debug://output`. A porta do projecto: os breakpoints
   guardados (`breakpoints_load`/`breakpoints_save`), o snapshot (`debug_snapshot`) e as issues
   abertas (`project_load`). Não toca em `window` (o cliente tipado é que o faz).
   r23 F2: `debug_capabilities` (o host: adaptador e rr), `debug_launch` com `args`, `debug_evaluate`
   com `context`, `debug_run_to`, `debug_restart_frame`, `debug_data_breakpoints`, `debug_read_memory`,
   `debug_exception_filters` e `debug_test_targets`. */

import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import type { DebugPort, ProjectDebugPort } from "../application/ports";
import type { Frame, Stop, Var } from "../domain/session";
import type { BpMeta, DapThread, DataBp, LaunchInfo, VarNode } from "../domain/dap";
import type { HostCaps } from "../domain/caps";
import type { TestBinary } from "../domain/console";
import type { Position, Recording, WriteHit } from "../domain/replay";

export const tauriDebug = (inv: Invoker = invoke, desktop: () => boolean = isDesktop): DebugPort => ({
  available: async () => (desktop() ? inv<boolean>("debug_available") : false),
  launch: (id, program, cwd, args) => inv<LaunchInfo | null>("debug_launch", args && args.length ? { id, program, cwd, args } : { id, program, cwd }).then((r) => r ?? undefined),
  capabilities: () => inv<HostCaps>("debug_capabilities"),
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
  evaluate: (id, expression, frame, context) => inv<VarNode>("debug_evaluate", context ? { id, expression, frame, context } : { id, expression, frame }),
  runTo: (id, file, line) => inv<Stop>("debug_run_to", { id, file, line }),
  restartFrame: (id, frame) => inv<Stop>("debug_restart_frame", { id, frame }),
  dataBreakpoints: (id, add, remove) => inv<DataBp[]>("debug_data_breakpoints", { id, add, remove }),
  readMemory: (id, memoryReference, offset, count) => inv<{ address: string; bytes: number[]; unreadable: number }>("debug_read_memory", { id, memoryReference, offset, count }),
  exceptionFilters: (id, filters) => inv<string[]>("debug_exception_filters", { id, filters }),
  testTargets: (root) => inv<TestBinary[]>("debug_test_targets", { root }),
  record: (id, program, args, cwd) => inv<Recording>("debug_record", { id, program, args, cwd }),
  replay: (id, trace, program, cwd) => inv<LaunchInfo>("debug_replay", { id, trace, program, cwd }),
  reverse: (id, kind) => inv<Stop>("debug_reverse", { id, kind }),
  position: (id) => inv<Position>("debug_position", { id }),
  travel: (id, event, ticks, file, line, watch) => inv<Stop>("debug_travel", watch ? { id, event, ticks, file, line, watch } : { id, event, ticks, file, line }),
  lastWrite: (id, frame, expression) => inv<Stop>("debug_last_write", { id, frame, expression }),
  writes: (id, frame, expression, max) => inv<WriteHit[]>("debug_writes", max === undefined ? { id, frame, expression } : { id, frame, expression, max }),
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
