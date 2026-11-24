/* ═════════ feature `panel` — nomes e rótulos (domínio puro) ═════════
   Título de cada instância de terminal (como na lista do VS Code: o processo em
   primeiro plano, senão a shell), cwd encurtado e URL de uma porta. */

import type { PortInfo, TerminalMeta } from "./types";

export const baseName = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** "cargo", "vim", "bash"…; para tarefas, o rótulo. */
export function terminalTitle(t: TerminalMeta): string {
  if (t.kind === "task") return t.label || "Task";
  const proc = t.process && t.process !== baseName(t.shell) ? t.process : null;
  return proc || baseName(t.shell).replace(/\.exe$/i, "");
}

/** cwd para mostrar: relativo ao workspace (`nome/sub`), `~/…` no HOME, senão absoluto. */
export function shortCwd(cwd: string | null, root: string | null, rootName: string | null, home: string | null): string {
  if (!cwd) return "";
  const c = cwd.replace(/\/+$/, "");
  if (root) {
    const r = root.replace(/\/+$/, "");
    if (c === r) return rootName || baseName(r);
    if (c.startsWith(r + "/")) return (rootName || baseName(r)) + c.slice(r.length);
  }
  if (home) {
    const h = home.replace(/\/+$/, "");
    if (c === h) return "~";
    if (c.startsWith(h + "/")) return "~" + c.slice(h.length);
  }
  return c;
}

/** URL local de uma porta (endereços curinga/loopback → localhost). */
export function portUrl(p: Pick<PortInfo, "port" | "address">): string {
  const local = ["0.0.0.0", "::", "127.0.0.1", "::1", "localhost", "*"].includes(p.address);
  const host = local ? "localhost" : p.address.includes(":") ? `[${p.address}]` : p.address;
  return `http://${host}:${p.port}`;
}

/** Duração legível de um checker: 840 ms, 3.2 s, 1 min 05 s. */
export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}
