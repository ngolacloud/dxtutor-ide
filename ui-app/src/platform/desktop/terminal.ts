/* ═════════ dxtutor IDE — desktop: terminal real (ADR-0004, U4h1) ═════════
   O terminal de linha (#term) com processos reais, as tarefas num PTY quando o painel real
   está montado (`runInTerm`), o `cd` com o cwd real e o Ctrl+C. Era a secção «terminal» do
   bridge.ts, verbatim; ainda decora `window.run`/`termExec` (U4h2+: injecção no dono). */

import type { RunOpts } from "./context";
import type { DesktopContext } from "./context";

export function installTerminal(ctx: DesktopContext): void {
const { R, shell, fsx, sh, stream, escH, ansi } = ctx;
const reloadDisk = () => ctx.reloadDisk();
const syncGit = () => ctx.syncGit();
/* ───── terminal ───── */
function termLine(text: string, err?: boolean): void {
  const t = $("#term");
  if (!t) return;
  const d = document.createElement("div");
  d.className = "line";
  d.innerHTML = err ? '<span class="er">' + escH(text) + "</span>" : escH(text);
  const w = $("#inputwrap");
  w ? t.insertBefore(d, w) : t.appendChild(d);
  while (t.childElementCount > 6000) t.removeChild(t.firstChild!);
  scrollTerm();
}
/* Com os terminais reais montados (features/panel), uma tarefa corre num PTY próprio —
   cores, barras de progresso e código de saída reais, como as tasks do VS Code. O terminal
   de linha (#term) fica para o terminal partilhado do PairCode e para o browser. */
async function runInTerm(line: string, o: RunOpts = {}): Promise<number> {
  if (R.term) return R.term.runTask(line, { env: o.env, cwd: o.cwd });
  return runInLineTerm(line, o);
}
async function runInLineTerm(line: string, o: RunOpts = {}): Promise<number> {
  setPanelTab("terminal", true);
  if (R.proc) { toast("A command is still running — Ctrl+C stops it"); return -1; }
  if (o.echo !== false) echoCmd(line);
  newInput(true);
  let code = -1;
  try {
    code = await stream(line, { env: o.env, cwd: o.cwd, line: (l, err) => termLine(ansi(l), err && o.errRed !== false && /error|fatal|denied|failed/i.test(l)), onId: id => R.proc = id });
  } catch (e) { termLine(String(e), true); }
  R.proc = null;
  if (code !== 0) termLine(`exit ${code}`, true);
  termRefreshPrompt();
  return code;
}
const _run = window.run, _termExec = termExec;
async function realTerm(raw: string): Promise<void> {
  const v = raw.trim();
  if (!v) { echoCmd(""); newInput(); return; }
  if (v === "clear" || v === "cls") { $("#term")!.innerHTML = ""; newInput(); return; }
  if (/^cd(\s|$)/.test(v)) {
    echoCmd(raw);
    const target = v.slice(2).trim() || R.root;
    const tp = await fsx.expandPath(target as string);
    const r = R.info.os === "windows" ? await sh("cmd", ["/C", `cd /d "${tp}" && cd`], { cwd: R.cwd }) : await sh("sh", ["-c", 'cd -- "$1" && pwd', "sh", tp], { cwd: R.cwd });
    if (r.code === 0) {
      R.cwd = r.stdout.trim();
      CWD = [R.name!].concat(R.cwd.startsWith(R.root!) ? R.cwd.slice(R.root!.length).split(/[\\/]/).filter(Boolean) : [R.cwd]);
    } else termLine(r.stderr.trim(), true);
    newInput();
    return;
  }
  await runInLineTerm(v);
  if (/^git\s/.test(v) && R.git) { await reloadDisk(); await syncGit(); }
}
window.run = function (raw?: string) { return R.root ? realTerm(raw ?? "") : _run(raw); };
termExec = function (v: string) {
  if (!R.root) return _termExec(v);
  if (R.term) void runInTerm(v).then(async () => { if (/^git\s/.test(v.trim()) && R.git) { await reloadDisk(); await syncGit(); } });
  else void realTerm(v);
  return null;
};
document.addEventListener("keydown", e => {
  if (R.proc && e.ctrlKey && (e.key === "c" || e.key === "C") && !String(getSelection()).length && document.activeElement && document.activeElement.closest && document.activeElement.closest("#pc-terminal")) {
    e.preventDefault();
    void shell.killShell(R.proc as string);
    termLine("^C");
  }
}, true);
ctx.termLine = termLine; ctx.runInTerm = runInTerm; ctx.realTerm = realTerm;
}
