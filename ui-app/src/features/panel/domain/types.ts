/* ═════════ feature `panel` — tipos do domínio ═════════
   Contratos do painel inferior (Terminal · Problems · Output · Services · Debug assistant).
   Os que espelham o backend (Problem/CheckReport/ScanResult/PortInfo/ShellProfile/PtyInfo)
   seguem o serde camelCase de `src-tauri/src/{problems,ports,pty}.rs`. PURO: sem DOM. */

export type Severity = "error" | "warning" | "info";

/** Um diagnóstico; `file` é relativo à raiz do workspace, com `/`. */
export interface Problem {
  file: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: Severity;
  message: string;
  code: string | null;
  source: string;
}

/** O que aconteceu a um checker (cargo/tsc/go vet/ruff/eslint). */
export interface CheckReport {
  source: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  millis: number;
  count: number;
  error: string | null;
}

export interface ScanResult {
  problems: Problem[];
  checks: CheckReport[];
  skipped: string[];
}

/** Uma porta TCP em escuta de um processo do utilizador. */
export interface PortInfo {
  port: number;
  address: string;
  pid: number | null;
  process: string | null;
  command: string | null;
  cwd: string | null;
  inWorkspace: boolean;
}

export interface ShellProfile {
  name: string;
  path: string;
  default: boolean;
}

export interface PtyInfo {
  shell: string;
  shellPid: number | null;
  process: string | null;
  cwd: string | null;
}

/** shell = interactiva; task = um comando num PTY (compose, deploy, testes do Co-Dev). */
export type TermKind = "shell" | "task";

/** Um comando terminado, reportado pela integração de shell (OSC 633 E + D). */
export interface CommandRecord {
  terminalId: string;
  terminalTitle: string;
  command: string;
  exitCode: number;
  cwd: string | null;
  at: number;
  /** Cauda da saída do comando, lida do buffer do terminal. */
  output: string;
}

/** Metadados de uma instância de terminal (o xterm em si é da UI). */
export interface TerminalMeta {
  id: string;
  kind: TermKind;
  /** Grupo de divisão: instâncias do mesmo grupo aparecem lado a lado. */
  group: string;
  /** Programa da shell, ou o rótulo da tarefa. */
  shell: string;
  label: string | null;
  /** Processo em primeiro plano (do backend), ex. "cargo", "vim". */
  process: string | null;
  cwd: string | null;
  /** Código de saída do processo do PTY quando terminou; null enquanto vivo. */
  exited: number | null;
  /** Código do último comando terminado (integração de shell). */
  lastExit: number | null;
  commands: number;
  /** Comando de uma tarefa (para o cabeçalho e para reutilizar a instância). */
  command: string | null;
}

export type OutputLevel = "info" | "warn" | "error";

export interface OutputLine {
  at: number;
  text: string;
  level: OutputLevel;
}
