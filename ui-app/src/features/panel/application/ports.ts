/* ═════════ feature `panel` — portas (ADR-0002) ═════════
   O que os casos de uso precisam do mundo exterior. Os adaptadores reais vivem em
   `infrastructure/` (Tauri: pty_*, problems_scan, ports_list; legado: DXR/FS/openPath). */

import type { PortInfo, PtyInfo, ScanResult, ShellProfile, CheckReport } from "../domain/types";

export interface SpawnRequest {
  id: string;
  rows: number;
  cols: number;
  cwd?: string | null;
  shell?: string | null;
  command?: string | null;
  env?: Record<string, string> | null;
}

export type Unlisten = () => void;

/** Terminais reais (PTY no backend). */
export interface PtyPort {
  spawn(req: SpawnRequest): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, rows: number, cols: number): Promise<void>;
  kill(id: string): Promise<boolean>;
  shells(): Promise<ShellProfile[]>;
  info(id: string): Promise<PtyInfo>;
  onData(cb: (id: string, data: string) => void): Promise<Unlisten>;
  onExit(cb: (id: string, code: number) => void): Promise<Unlisten>;
}

export type CheckEvent =
  | { phase: "start"; source: string; command: string; cwd: string }
  | { phase: "done"; report: CheckReport };

/** Diagnósticos LSP publicados pelo backend (`textDocument/publishDiagnostics`). */
export interface LspPublish {
  uri: string;
  diagnostics: { range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }; severity?: number; message?: string; code?: unknown; source?: string }[];
}

export interface ProblemsPort {
  scan(root: string): Promise<ScanResult>;
  onCheck(cb: (e: CheckEvent) => void): Promise<Unlisten>;
  onLsp(cb: (p: LspPublish) => void): Promise<Unlisten>;
}

export interface PortsPort {
  list(root: string | null): Promise<PortInfo[]>;
}

/** O workspace aberto e as acções do resto da IDE. */
export interface WorkspacePort {
  root(): string | null;
  name(): string | null;
  home(): string | null;
  /** Variáveis extra para processos (DOCKER_HOST, KUBECONFIG, …). */
  env(): Record<string, string>;
  hasFile(rel: string): boolean;
  openFile(rel: string, line?: number): void;
  openUrl(url: string): void;
}

export interface Clock {
  now(): number;
  after(ms: number, f: () => void): () => void;
}
