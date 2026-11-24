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
