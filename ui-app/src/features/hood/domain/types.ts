/* ═══════════ feature `hood` — domain: the shapes of the real «under the hood» (A8, docs/v2/UI-AUDIT.md item 7) ═══════════
   They mirror the backend (serde camelCase): `hood_line_asm`, `hood_python_bytecode`, `measure_growth`
   (tutor_eval::hood), `compile_pipeline`, `run_measured`, `trace_execution`. PURE: no DOM, no window. */

export type Lang = "rust" | "python";

export interface LineCode { line: number; funcs: string[]; instructions: string[] }
export interface LineAsm { ok: boolean; profile: string; lines: LineCode[]; total: number; notes: string }

export interface LineOps { line: number; scope: string; ops: string[] }
export interface Bytecode { ok: boolean; version: string; lines: LineOps[]; notes: string }

export interface GrowthSample { n: number; ms: number }
export interface Growth {
  ok: boolean;
  samples: GrowthSample[];
  bigO: string | null;
  rSquared: number | null;
  confidence: string | null;
  ranking: Array<[string, number]>;
  baselineMs: number;
  notes: string;
}

export interface Pipeline { mir: string; llvmIr: string; asm: string; binaryBytes: number; disasm: string; notes: string }

export interface Measured {
  run: { ok: boolean; stdout: string; stderr: string };
  telemetry: { wallMs: number; cpuUserMs: number; cpuSysMs: number; peakRssKb: number; ioReadBlocks: number; ioWriteBlocks: number; exitCode: number; samples: Array<{ tMs: number; rssKb: number }> };
}

export interface TraceVar { name: string; value: string; ty: string }
export interface TraceStep { line: number; event: string; func: string; depth: number; locals: TraceVar[]; stdoutLen: number }
export interface Trace { supported: boolean; notes: string; steps: TraceStep[]; stdout: string }
