/* ═════════ feature `panel` — adaptadores Tauri ═════════
   Implementam as portas do painel sobre o cliente IPC tipado (`platform/tauri/core`):
   pty_spawn/pty_write/pty_resize/pty_kill/pty_shells/pty_info + eventos pty://data e
   pty://exit; problems_scan + problems://check + lsp://diagnostics; ports_list.
   Não tocam em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, listen } from "../../../platform/tauri/core";
import type { CheckEvent, LspPublish, PortsPort, ProblemsPort, PtyPort } from "../application/ports";
import type { PortInfo, PtyInfo, ScanResult, ShellProfile } from "../domain/types";
import { fromRuleViolations, type RuleViolation } from "../domain/problems";

export const tauriPty: PtyPort = {
  spawn: (r) => invoke<void>("pty_spawn", { id: r.id, rows: r.rows, cols: r.cols, cwd: r.cwd ?? null, shell: r.shell ?? null, command: r.command ?? null, env: r.env ?? null }),
  write: (id, data) => invoke<void>("pty_write", { id, data }),
  resize: (id, rows, cols) => invoke<void>("pty_resize", { id, rows, cols }),
  kill: (id) => invoke<boolean>("pty_kill", { id }),
  shells: () => invoke<ShellProfile[]>("pty_shells"),
  info: (id) => invoke<PtyInfo>("pty_info", { id }),
  onData: (cb) =>
    listen("pty://data", (p) => {
      const e = p as { id?: string; data?: string };
      if (e && typeof e.id === "string") cb(e.id, String(e.data ?? ""));
    }),
  onExit: (cb) =>
    listen("pty://exit", (p) => {
      const e = p as { id?: string; code?: number };
      if (e && typeof e.id === "string") cb(e.id, typeof e.code === "number" ? e.code : -1);
    }),
};

export const tauriProblems: ProblemsPort = {
  // RF-A05: the compilers' and linters' problems, and the drift of the architect's rules
  scan: async (root) => {
    const [r, rules] = await Promise.all([
      invoke<ScanResult>("problems_scan", { root }),
      invoke<RuleViolation[] | null>("arch_conformance", { root }).catch(() => null),
    ]);
    const extra = fromRuleViolations(rules);
    return extra.length ? { ...r, problems: [...r.problems, ...extra] } : r;
  },
  onCheck: (cb) => listen("problems://check", (p) => cb(p as CheckEvent)),
  onLsp: (cb) =>
    listen("lsp://diagnostics", (p) => {
      const e = p as LspPublish;
      if (e && typeof e.uri === "string" && Array.isArray(e.diagnostics)) cb(e);
    }),
};

export const tauriPorts: PortsPort = {
  list: (root) => invoke<PortInfo[]>("ports_list", { root }),
};

/** Progresso de indexação de um language server (`$/progress` → lsp://status). */
export interface LspStatus { root?: string; server: string; kind: string; title: string; message: string; percentage: number | null }
export const onLspStatus = (cb: (s: LspStatus) => void) =>
  listen("lsp://status", (p) => {
    const s = p as Partial<LspStatus>;
    if (s && typeof s.server === "string") cb({ server: s.server, kind: s.kind ?? "", title: s.title ?? "", message: s.message ?? "", percentage: s.percentage ?? null });
  });

/** Abre um URL no browser do sistema (xdg-open / open / start), pelo comando `exec`. */
export function openExternal(url: string, os: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const [program, args]: [string, string[]] =
    os === "windows" ? ["cmd", ["/C", "start", "", url]] : os === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  void invoke("exec", { program, args, cwd: null, env: null, stdin: null, timeoutMs: 15000 }).catch(() => {});
}
