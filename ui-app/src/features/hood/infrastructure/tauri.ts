/* ═════════ feature `hood` — adaptador Tauri (A8) ═════════
   `hood_line_asm`, `hood_python_bytecode`, `measure_growth` (commands/hood.rs) e os já existentes
   `compile_pipeline`, `run_measured`, `trace_execution` (commands/missions.rs). Não toca em `window`. */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { HoodPort } from "../application/ports";
import type { Bytecode, Growth, LineAsm, Measured, Pipeline, Trace } from "../domain/types";

export const tauriHood = (inv: Invoker = invoke): HoodPort => ({
  lineAsm: (code, release) => inv<LineAsm>("hood_line_asm", { code, release }),
  pipeline: (code) => inv<Pipeline>("compile_pipeline", { code }),
  bytecode: (code) => inv<Bytecode>("hood_python_bytecode", { code }),
  measured: (code) => inv<Measured>("run_measured", { code }),
  growth: (code, sizes) => inv<Growth>("measure_growth", { code, sizes }),
  trace: (language, code) => inv<Trace>("trace_execution", { language, code }),
});
