/* ═════════ dxtutor IDE — desktop: o contexto partilhado (ADR-0004, U4h1) ═════════
   O que os módulos desktop partilham: os clientes IPC tipados (platform/tauri), o objecto
   `R` (publicado como `window.DXR`), os processos (`sh`/`git`/`gitOk`/`stream`), a fila de
   escrita (`enqueue`/`idle`) e os utilitários. Era o topo da closure do bridge.ts; o corpo
   é o mesmo, verbatim. Os SERVIÇOS que cada módulo define e os outros usam (`flushSave`,
   `syncGit`, `envFor`, `runInTerm`, …) são lugares tardios no contexto: cada installer
   preenche os seus, e os outros chamam-nos sempre por `ctx.x(...)` no acto (o bridge.ts
   instala os módulos pela ordem das antigas secções, antes do arranque). */

import { shellClient, type ExecResult } from "../tauri/shell";
import { fsClient } from "../tauri/fs";
import { gitClient } from "../tauri/git";
import { providersClient, type ProviderInfo } from "../tauri/providers";
import { agentTasksClient } from "../tauri/agent-tasks";
import { appClient } from "../tauri/app";
import type { Desktop, SampleMsg, SampleOpts } from "./types";

export interface RunOpts { echo?: boolean; env?: Record<string, string>; cwd?: string; errRed?: boolean }

export function createDesktopContext() {
const T = window.__TAURI__!;
/* clientes IPC tipados (platform/tauri — ADR-0004, U2): nada de invoke cru com strings soltas */
const shell = shellClient(), fsx = fsClient(), gitc = gitClient(), providers = providersClient(), tasks = agentTasksClient(), app = appClient();
const R: Desktop = { root: null, name: null, git: false, prefix: "", disk: {}, cwd: null, info: {}, keys: {}, proc: null, handlers: {}, errors: [], busy: 0 };
window.DXR = R;
window.addEventListener("error", e => R.errors.push(String(e.message || e)));
window.addEventListener("unhandledrejection", e => R.errors.push("promise: " + String((e.reason && e.reason.message) || e.reason)));

const escH = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
const ansi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
const relOf = (p: string): string => (p.startsWith(ROOT) ? p.slice(ROOT.length) : p);
const isReal = (k: string): boolean => k.startsWith(ROOT) && !k.startsWith(ROOT + "learn/");
const base = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
const say = (m: string) => { try { log("desktop", m); } catch { /* sem painel de output */ } };

/* ───── processes ───── */
async function sh(program: string, args: string[], o: { cwd?: string | null; env?: Record<string, string> | null; stdin?: string | null; timeout?: number } = {}): Promise<ExecResult> {
  return shell.exec({ program, args, cwd: o.cwd || R.root, env: o.env || null, stdin: o.stdin || null, timeoutMs: o.timeout || 120000 });
}
async function git(...args: string[]): Promise<ExecResult> { return sh("git", args); }
async function gitOk(...args: string[]): Promise<ExecResult> {
  const r = await git(...args);
  if (r.code !== 0) throw new Error(("git " + args[0] + ": " + (r.stderr || r.stdout)).trim().split("\n").slice(0, 4).join(" · "));
  return r;
}
let Q: Promise<unknown> = Promise.resolve();
const enqueue = (f: () => unknown) =>
  (Q = Q.then(async () => { R.busy++; try { return await f(); } finally { R.busy--; } })
    .catch(e => { toast(String((e && e.message) || e).slice(0, 160)); say(String((e && e.message) || e)); }));
R.idle = () => Q;

void T.event.listen("proc-line", e => { const p = e.payload as { id: string; line: string; err?: boolean }; const h = R.handlers[p.id]; if (h) h.line(p.line, p.err); });
void T.event.listen("proc-exit", e => { const p = e.payload as { id: string; code: number }; const h = R.handlers[p.id]; if (h) { delete R.handlers[p.id]; h.exit(p.code); } });
function stream(line: string, o: { line?: (l: string, err?: boolean) => void; env?: Record<string, string> | null; cwd?: string | null; onId?: (id: string) => void } = {}): Promise<number> {
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return new Promise((ok, no) => {
    R.handlers[id] = { line: o.line || (() => { /* sem sink */ }), exit: ok };
    shell.runShell({ id, line, cwd: o.cwd || R.cwd || R.root, env: o.env || ctx.envFor() }).then(() => { if (o.onId) o.onId(id); }).catch(e => { delete R.handlers[id]; no(e); });
  });
}
const missing = (n: string) => (): never => { throw new Error("desktop: o serviço " + n + " não foi instalado"); };
const ctx = {
  T, shell, fsx, gitc, providers, tasks, app, R,
  escH, ansi, relOf, isReal, base, say, sh, git, gitOk, enqueue, stream,
  /** A fila de escrita no momento da chamada (era a variável `Q` da closure). */
  idle: (): Promise<unknown> => Q,
  /* serviços tardios — preenchidos pelos installers */
  envFor: missing("envFor") as () => Record<string, string>,
  termLine: missing("termLine") as (text: string, err?: boolean) => void,
  runInTerm: missing("runInTerm") as (line: string, o?: RunOpts) => Promise<number>,
  realTerm: missing("realTerm") as (raw: string) => Promise<void>,
  reloadDisk: missing("reloadDisk") as () => Promise<void>,
  markChanged: missing("markChanged") as () => Promise<void>,
  flushSave: missing("flushSave") as () => void,
  syncGit: missing("syncGit") as () => Promise<void>,
  openFolder: missing("openFolder") as (path?: string) => Promise<boolean>,
  loadKeys: missing("loadKeys") as () => Promise<void>,
  desktopSample: missing("desktopSample") as (input: string | SampleMsg[], o?: SampleOpts) => Promise<{ text: string; provider: string; inputTokens: number; outputTokens: number }>,
  provCaps: missing("provCaps") as () => ProviderInfo[],
};
return ctx;
}
export type DesktopContext = ReturnType<typeof createDesktopContext>;
export type { ExecResult };
