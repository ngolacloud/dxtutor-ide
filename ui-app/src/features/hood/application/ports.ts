/* ═══════════ feature `hood` — application ports (A8) ═══════════
   The service (`hood-service.ts`) depends only on `domain/` and these interfaces. Adapters: the backend
   (infrastructure/tauri.ts) and the editor/shell (infrastructure/legacy-bridge.ts). */

import type { Bytecode, Growth, LineAsm, Measured, Pipeline, Trace } from "../domain/types";

export interface HoodPort {
  lineAsm(code: string, release: boolean): Promise<LineAsm>;
  pipeline(code: string): Promise<Pipeline>;
  bytecode(code: string): Promise<Bytecode>;
  measured(code: string): Promise<Measured>;
  growth(code: string, sizes: number[]): Promise<Growth>;
  trace(language: string, code: string): Promise<Trace>;
}

/** The file on screen in the editor. */
export interface SourcePort {
  current(): { path: string; text: string } | null;
  open(path: string, line: number): void;
}

export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain"; text: string; context: Array<{ kind: "selection" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}

export interface TabsPort { open(id: string, title: string, kind: string): void }
export interface NotifierPort { toast(m: string): void }
