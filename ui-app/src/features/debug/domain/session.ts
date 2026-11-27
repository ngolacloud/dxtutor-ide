/* ═══════════ feature `debug` — domínio: a sessão de depuração real (ADR-0006, R4) ═══════════
   Os contratos do motor gdb/MI do backend (`debug_*`, src-tauri/src/debug.rs) e as regras PURAS
   à volta deles: que programa depurar num projecto Cargo e como passar do caminho que o gdb
   reporta para a chave do FS do editor. Sem DOM, sem `window`, sem Tauri. */

/** `debug::Stop`: onde a execução parou (breakpoint, fim de passo) ou se o programa saiu. */
export interface Stop {
  stopped: boolean;
  reason: string;
  func: string;
  file: string;
  line: number;
  exited: boolean;
  exitCode: number | null;
  /** DAP: the thread that stopped, and the adapter's explanation (an exception's text) */
  thread?: number;
  description?: string;
  /** r23 F2b: a replay's write — the watched location, to travel back to it */
  watch?: string;
}

export interface Var { name: string; value: string }
export interface Frame { level: number; func: string; file: string; line: number }

/** O estado da sessão na vista. */
export type SessionStatus = "starting" | "running" | "stopped";

export interface Session {
  id: string;
  program: string;
  status: SessionStatus;
  stop: Stop | null;
  locals: Var[];
  stack: Frame[];
  /** A7: the engine (DAP when an adapter is installed; gdb/MI otherwise) */
  engine?: "dap" | "gdb";
  adapter?: string;
  /** DAP: the selected frame, the threads, the frame's scopes and the expanded children */
  frame?: number;
  threads?: Array<{ id: number; name: string; current: boolean }>;
  scopes?: Array<{ name: string; value: string; type: string; reference: number; changed: boolean; path: string }>;
  children?: Record<number, Array<{ name: string; value: string; type: string; reference: number; changed: boolean; path: string; memoryReference?: string | null }>>;
  /* r23 F2 */
  /** what the adapter can do (DAP) */
  caps?: import("./dap").SessionCaps | null;
  /** how it was launched (Restart launches it again) */
  args?: string[];
  cwd?: string;
  /** the data breakpoints set in this session */
  dataBps?: import("./dap").DataBp[];
  /** a variable's bytes, when the human opened them */
  memory?: { name: string; address: string; bytes: number[]; unreadable: number } | null;
  /** how long the program ran before this stop (ms), and how many stops so far */
  perfMs?: number;
  stops?: number;
  /** r23 F2b: a replay of a recording (rr): where it is, the timeline's marks, the last query */
  replay?: import("./replay").ReplayState | null;
  /** «Debug Test…»: stop on panic in this session (and when it restarts) */
  panicOnStart?: boolean;
  /** the panic the program stopped on (read from its output) */
  panic?: import("./exception").Panic | null;
}

/** Os binários de um Cargo.toml: os `[[bin]] name = "…"`, senão o `[package] name`. */
export function cargoBins(toml: string): string[] {
  const bins: string[] = [];
  const sections = toml.split(/^\s*\[/m);
  for (const sec of sections) {
    const head = (sec.match(/^([^\]]+)\]/) || [])[1]?.trim();
    const name = (sec.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1];
    if (head === "[bin" && name) bins.push(name); /* `[[bin]]`: o split deixa o cabeçalho como «[bin» */
  }
  if (bins.length) return bins;
  const pkg = sections.find((s) => /^package\]/.test(s));
  const name = pkg ? (pkg.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1] : undefined;
  return name ? [name] : [];
}

/** Os binários de uma pasta Cargo (um projecto ou um workspace): os `[[bin]]` de cada
 *  Cargo.toml, ou o `[package] name` de cada crate que tenha `src/main.rs` (as bibliotecas
 *  não se correm). `files`: chave relativa → conteúdo dos Cargo.toml; `has`: o ficheiro existe? */
export function cargoTargets(tomls: Record<string, string>, has: (rel: string) => boolean): string[] {
  const out: string[] = [];
  for (const [rel, toml] of Object.entries(tomls)) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
    const explicit = /^\s*\[\[bin\]\]/m.test(toml);
    if (explicit || has(dir + "src/main.rs")) for (const b of cargoBins(toml)) if (!out.includes(b)) out.push(b);
  }
  return out;
}

/** O caminho que o gdb reporta (absoluto, ou relativo à pasta) → a chave do FS do editor
 *  (`fsRoot + relativo`); null se o ficheiro está fora da pasta aberta (std, dependências). */
export function fsKeyFor(file: string, root: string, fsRoot: string): string | null {
  if (!file) return null;
  const r = root.replace(/\/$/, "");
  if (file.startsWith("/")) return file.startsWith(r + "/") ? fsRoot + file.slice(r.length + 1) : null;
  return fsRoot + file.replace(/^\.\//, "");
}

/** A chave do FS → o caminho relativo à pasta (o que se passa ao gdb nos breakpoints). */
export const relOf = (key: string, fsRoot: string): string => (key.startsWith(fsRoot) ? key.slice(fsRoot.length) : key);
