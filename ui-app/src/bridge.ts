/* ═════════ dxtutor IDE — desktop bridge (Tauri) ═════════
   Loaded after the IDE script. In the browser it does nothing; inside the desktop app it
   swaps the simulated parts for real ones: folders on disk, autosave, a real terminal,
   real git, real LLM providers, docker/podman compose and kubectl.

   Fase 3 da componentização: segundo módulo TypeScript do ui-app, servido como
   <script type="module"> DEPOIS dos clássicos boot.js/app.js e ANTES do pair.ts
   (módulos correm por ordem de documento, após os clássicos). O `declare global`
   abaixo acrescenta ao contrato do pair.ts as globais que só o bridge usa — as
   partilhadas (FS, ROOT, BRANCH, refresh, promptHTML, …) já são ambiente. */

export {};

interface ExecResult { code: number; stdout: string; stderr: string; timedOut?: boolean }
interface ProcHandler { line: (l: string, err?: boolean) => void; exit: (code: number) => void }
interface AppInfo {
  version?: string; os?: string; home?: string; configDir?: string;
  openAtStart?: string; selftest?: string; pairtest?: string;
}
interface Workspace { root: string; name: string; files: { path: string; content: string }[]; skipped?: number; truncated?: boolean }
interface CommitNode { h: string; m: string; p: string[]; b: string | null; a: string; t: number; files: unknown[] }
interface GitState {
  c: Record<string, CommitNode>; order: string[]; refs: Record<string, string>;
  trees: Record<string, Record<string, string>>; base: Record<string, unknown>; tags: Record<string, string>;
}
interface Prov { name: string; model: string; ep?: string; on?: boolean; local?: boolean }
interface Envs { rt: string; rtOn: boolean; sock: Record<string, string>; kube: string; k8sOn: boolean; ctx: string; ns: string }
interface Tool { name: string; description?: string; inputSchema?: Record<string, unknown>; execute: (input: any) => unknown }
interface SampleOpts { tools?: Tool[]; signal?: AbortSignal | null; onText?: (x: { text: string }) => void }
interface SampleMsg { role: string; content?: unknown }

/** O objecto R exposto como window.DXR — tem de continuar atribuível ao Dxr que o pair.ts declara. */
interface Desktop {
  root: string | null; name: string | null; git: boolean; prefix: string;
  disk: Record<string, string>; cwd: string | null; info: AppInfo;
  keys: Record<string, unknown>; proc: string | null;
  handlers: Record<string, ProcHandler>; errors: string[]; busy: number;
  remote?: boolean; ready?: boolean; user?: string; host?: string; sock?: string; kube?: string;
  idle?: () => Promise<unknown>; flush?: () => void;
  reloadDisk?: () => Promise<void>; syncGit?: () => Promise<void>;
  termLine?: (t: string, e?: boolean) => void; envFor?: () => Record<string, string>;
  gitInit?: () => unknown; approve?: (id: string, ok: boolean) => void;
  logs?: (cmd: string) => unknown; open?: (p?: string) => unknown; close?: () => void;
}

declare global {
  // Globais lexicais (let/const em boot.js/app.js) que o pair.ts não declara.
  const STAGED: Set<string>;
  const GIT: GitState;
  const COMMITS: { h: string; m: string }[];
  const LS: { get: (k: string, d?: any) => any; set: (k: string, v: unknown) => void };
  const TREE: { projects: { children: Record<string, unknown> } };
  const PROV: Record<string, Prov>;
  const ENVS: Envs;
  const RTN: Record<string, string>;
  const KCTX: string[];
  const AGENTS: Record<string, { n: string }>;
  const STOP: unknown;
  const MODE: string;
  const ACTIVE: string;
  const COMMIT_MSG: string;
  const isFlow: (b: string) => boolean;
  const changes: () => string[];
  const stOf: (p: string) => unknown;
  const use: (p: string, tok: number) => void;
  const infraDraw: () => void;
  const goPane: (p: string) => void;
  const saveEnv: () => void;
  // Lexicais que o bridge re-atribui (let em app.js).
  let STACK: { name: string; src: string; url: string; state: string }[] | null;
  let DEVC: unknown;
  let K8S: unknown;
  let SAMPLE: ((input: string | SampleMsg[], o?: SampleOpts) => Promise<any>) | null;
  let LIVE_OK: boolean;
  let provState: (k: string) => string;
  // Globais function-declaradas (vivem no window): re-atribuíveis a partir do módulo.
  var termRefreshPrompt: () => void;
  var echoCmd: (v?: string) => void;
  var rerender: (k: string) => void;
  var card: (w: string, html: string) => { el: HTMLElement; bd: HTMLElement; tools: HTMLElement };
  var syncTree: (...a: any[]) => void;
  var commit: (msg?: string, author?: string) => unknown;
  var checkout: (b: string, create?: boolean) => boolean;
  var gitMerge: (src: string, author?: string) => CommitNode | null;
  var gfStart: (kind: string, name: string) => string;
  var gfFinish: (b?: string, author?: string) => unknown;
  var updateAgentUI: (...a: any[]) => void;
  var testProv: (k: string, btn: HTMLElement) => unknown;
  var rtConnect: () => unknown;
  var k8sConnect: () => unknown;
  var dxRun: (term?: unknown) => { ok: boolean; sum?: string };
  var dxStop: (term?: unknown) => void;
  var dxDeploy: () => { ok: boolean; sum?: string };
  var drawStack: (...a: any[]) => void;
  var k8sDocs: () => any[];
  var needRt: () => unknown;
  var runMission: (S: any, text?: any) => unknown;
  var runSprint: (s: any) => unknown;
  var loadJSZip: () => Promise<unknown>;
  var termExec: (v: string) => unknown;
  var JSZip: unknown;
}

(() => {
if (!window.__TAURI__ || !window.__TAURI__.core) return;
const T = window.__TAURI__;
const inv = (c: string, a?: Record<string, unknown>) => T.core.invoke(c, a || {});
const R: Desktop = { root: null, name: null, git: false, prefix: "", disk: {}, cwd: null, info: {}, keys: {}, proc: null, handlers: {}, errors: [], busy: 0 };
window.DXR = R;
window.addEventListener("error", e => R.errors.push(String(e.message || e)));
window.addEventListener("unhandledrejection", e => R.errors.push("promise: " + String((e.reason && e.reason.message) || e.reason)));

const escH = (s: unknown): string => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
const ansi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
const relOf = (p: string): string => (p.startsWith(ROOT) ? p.slice(ROOT.length) : p);
const isReal = (k: string): boolean => k.startsWith(ROOT) && !k.startsWith(ROOT + "learn/");
const base = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
const say = (m: string) => { try { log("desktop", m); } catch { /* sem painel de output */ } };

/* ───── processes ───── */
async function sh(program: string, args: string[], o: { cwd?: string | null; env?: Record<string, string> | null; stdin?: string | null; timeout?: number } = {}): Promise<ExecResult> {
  return inv("exec", { program, args, cwd: o.cwd || R.root, env: o.env || null, stdin: o.stdin || null, timeoutMs: o.timeout || 120000 });
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
    inv("run_shell", { id, line, cwd: o.cwd || R.cwd || R.root, env: o.env || envFor() }).then(() => { if (o.onId) o.onId(id); }).catch(e => { delete R.handlers[id]; no(e); });
  });
}

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
async function runInTerm(line: string, o: { echo?: boolean; env?: Record<string, string>; cwd?: string; errRed?: boolean } = {}): Promise<number> {
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
    const tp = await inv("expand_path", { path: target });
    const r = R.info.os === "windows" ? await sh("cmd", ["/C", `cd /d "${tp}" && cd`], { cwd: R.cwd }) : await sh("sh", ["-c", 'cd -- "$1" && pwd', "sh", tp], { cwd: R.cwd });
    if (r.code === 0) {
      R.cwd = r.stdout.trim();
      CWD = [R.name!].concat(R.cwd.startsWith(R.root!) ? R.cwd.slice(R.root!.length).split(/[\\/]/).filter(Boolean) : [R.cwd]);
    } else termLine(r.stderr.trim(), true);
    newInput();
    return;
  }
  await runInTerm(v);
  if (/^git\s/.test(v) && R.git) { await reloadDisk(); await syncGit(); }
}
window.run = function (raw?: string) { return R.root ? realTerm(raw ?? "") : _run(raw); };
termExec = function (v: string) { if (R.root) { void realTerm(v); return null; } return _termExec(v); };
document.addEventListener("keydown", e => {
  if (R.proc && e.ctrlKey && (e.key === "c" || e.key === "C") && !String(getSelection()).length && document.activeElement && document.activeElement.closest && document.activeElement.closest("#pc-terminal")) {
    e.preventDefault();
    void inv("kill_shell", { id: R.proc });
    termLine("^C");
  }
}, true);

/* ───── folders and autosave ───── */
async function openFolder(path?: string): Promise<boolean> {
  if (!path) path = await inv("pick_folder");
  if (!path) return false;
  let L: Workspace;
  try { L = await inv("load_workspace", { root: path }); } catch (e) { toast("Could not open " + path + ": " + e); return false; }
  R.root = L.root; R.name = L.name; R.cwd = L.root; R.disk = {};
  Object.keys(FS).forEach(k => { if (!k.startsWith(ROOT + "learn/")) delete FS[k]; });
  L.files.forEach(f => { FS[ROOT + f.path] = { content: f.content, orig: f.content }; R.disk[f.path] = f.content; });
  try { TABS.filter(t => t.kind === "file" || t.path).map(t => t.id).forEach(id => closeTab(id)); } catch { /* sem tabs */ }
  STAGED.clear(); OPEN.clear(); OPEN.add("dxtutor"); CWD = [R.name!];
  R.git = (await git("rev-parse", "--is-inside-work-tree")).code === 0;
  if (R.git) { R.prefix = (await git("rev-parse", "--show-prefix")).stdout.trim(); await markChanged(); await syncGit(); }
  else { Object.assign(GIT, { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} }); COMMITS.length = 0; BRANCH = "no git"; }
  try { const l = $("#st-branch-l"); if (l) l.textContent = BRANCH; } catch { /* sem status bar */ }
  LS.set("dx-last-folder", R.root);
  const rec = (LS.get("dx-recent", []) as string[]).filter(p => p !== R.root);
  rec.unshift(R.root);
  LS.set("dx-recent", rec.slice(0, 8));
  document.title = `${R.name} — dxtutor IDE`;
  refresh(false, true);
  try { termBanner(); } catch { /* sem terminal */ }
  say(`opened ${R.root} · ${L.files.length} files${L.skipped ? ` · ${L.skipped} skipped (binary, large or ignored)` : ""}${L.truncated ? " · file limit reached" : ""}`);
  toast(`${R.name}: ${L.files.length} files${R.git ? " · git " + BRANCH : " · not a git repository"}`);
  if (!R.git) { try { card("desktop", `<b>${escH(R.name)}</b> is not a git repository. The graph, gitflow and commits need one.<div style="margin-top:8px"><button class="mini pri" onclick="DXR.gitInit()">git init</button></div>`); } catch { /* sem chat */ } }
  return true;
}
async function reloadDisk(): Promise<void> {
  if (!R.root) return;
  const L: Workspace = await inv("load_workspace", { root: R.root });
  const keep: Record<string, typeof FS[string]> = {};
  Object.keys(FS).forEach(k => { if (!isReal(k) || k.startsWith(ROOT + "learn/")) keep[k] = FS[k]; });
  Object.keys(FS).forEach(k => delete FS[k]);
  Object.assign(FS, keep);
  R.disk = {};
  L.files.forEach(f => { FS[ROOT + f.path] = { content: f.content, orig: f.content }; R.disk[f.path] = f.content; });
  try { TABS.filter(t => t.path && !FS[t.path]).map(t => t.id).forEach(id => closeTab(id)); } catch { /* sem tabs */ }
  if (R.git) await markChanged();
  refresh(false, true);
  try { const t = tabOf(cur); if (t && t.path) show(cur); } catch { /* sem tab activa */ }
}
/* files that differ from HEAD keep HEAD as their "orig", so the SCM view and diffs are real */
async function markChanged(): Promise<void> {
  const r = await git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  if (r.code !== 0) return;
  const parts = r.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const xy = e.slice(0, 2);
    let p = e.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++;
    if (R.prefix) { if (!p.startsWith(R.prefix)) continue; p = p.slice(R.prefix.length); }
    const k = ROOT + p;
    if (xy === "??") { if (FS[k]) FS[k].orig = null; continue; }
    if (!FS[k]) {
      if (xy.includes("D")) { const h = await git("show", "HEAD:./" + p); if (h.code === 0) FS[k] = { content: h.stdout, orig: h.stdout, _deleted: 1 } as unknown as typeof FS[string]; }
      continue;
    }
    const h = await git("show", "HEAD:./" + p);
    FS[k].orig = h.code === 0 ? h.stdout : null;
  }
  Object.keys(FS).forEach(k => { if ((FS[k] as { _deleted?: number })._deleted) { delete FS[k]; } });
}
let saveT: number | undefined;
function flushSave(): void {
  clearTimeout(saveT); saveT = undefined;
  if (!R.root) return;
  const seen = new Set<string>(), w: [string, string][] = [], d: string[] = [];
  Object.keys(FS).forEach(k => {
    if (!k.startsWith(ROOT)) return;
    const r = relOf(k);
    if (k.startsWith(ROOT + "learn/") && !(r in R.disk)) return;
    seen.add(r);
    if (R.disk[r] !== FS[k].content) { w.push([r, FS[k].content]); R.disk[r] = FS[k].content; }
  });
  Object.keys(R.disk).forEach(r => { if (!seen.has(r)) { d.push(r); delete R.disk[r]; } });
  if (!w.length && !d.length) return;
  const root = R.root;
  enqueue(async () => { for (const [rel, content] of w) await inv("write_file", { root, rel, content }); for (const rel of d) await inv("delete_file", { root, rel }); });
}
const _refresh = refresh;
refresh = function (this: unknown, ...args: Parameters<typeof refresh>) {
  const r = _refresh.apply(this, args);
  if (R.root) { clearTimeout(saveT); saveT = window.setTimeout(flushSave, 350); }
  return r;
};
window.addEventListener("beforeunload", () => flushSave());

/* explorer shows the opened folder by its own name; terminal prompt shows the real user and host */
const _syncTree = syncTree;
syncTree = function (this: unknown, ...args: any[]) {
  _syncTree.apply(this, args);
  if (R.root || R.remote) { const r = TREE.projects.children.dxtutor; TREE.projects.children = {}; TREE.projects.children[R.name!] = r; }
};
const _promptHTML = promptHTML;
promptHTML = function () {
  if (!R.root) return _promptHTML();
  return `<span class="pr"><span>${escH(R.user || "you")}</span><span class="at">@</span><span>${escH(R.host || "local")}</span><span class="at">:</span><span class="pth">${escH(CWD.join("/"))}</span>${R.git ? `<span class="br"> (${escH(BRANCH)})</span>` : ""}<span class="at">$</span></span> `;
};
function termBanner(): void {
  const t = $("#term");
  if (!t) return;
  t.innerHTML = "";
  echo(`<span class="ac">${escH(R.info.os === "windows" ? "cmd" : "sh")}</span> <span class="dim">· real shell in</span> ${escH(R.root)} <span class="dim">· Ctrl+C stops · clear</span>`);
  newInput(true);
}

/* ───── git ───── */
async function syncGit(): Promise<void> {
  if (!R.git) return;
  const head = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
  const lg = await git("log", "--all", "--date-order", "-n", "400", "--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e");
  const heads = (await git("for-each-ref", "--format=%(refname:short)%1f%(objectname)", "refs/heads")).stdout.trim().split("\n").filter(Boolean).map(l => l.split("\x1f"));
  const tags = (await git("for-each-ref", "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)", "refs/tags")).stdout.trim().split("\n").filter(Boolean).map(l => l.split("\x1f"));
  const s = (h: string) => h.slice(0, 7), c: Record<string, CommitNode> = {}, order: string[] = [];
  lg.stdout.split("\x1e").map(x => x.trim()).filter(Boolean).forEach(x => {
    const [h, p, a, t, m] = x.split("\x1f");
    c[s(h)] = { h: s(h), m: m || "", p: (p || "").split(" ").filter(Boolean).map(s).filter(Boolean), b: null, a: a || "", t: (+t || 0) * 1000, files: [] };
    order.push(s(h));
  });
  Object.values(c).forEach(x => { x.p = x.p.filter(p => c[p]); });
  const refs: Record<string, string> = {};
  heads.forEach(([n, h]) => { refs[n] = s(h); });
  const rank = (n: string) => /^(main|master)$/.test(n) ? 0 : n === "develop" ? 1 : /^(release|hotfix)\//.test(n) ? 2 : 3;
  Object.keys(refs).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).forEach(n => {
    let h: string | undefined = refs[n];
    while (h && c[h] && !c[h].b) { c[h].b = n; h = c[h].p[0]; }
  });
  Object.values(c).forEach(x => { if (!x.b) x.b = head; });
  const tg: Record<string, string> = {};
  tags.forEach(([n, o, d]) => { const h = s(d || o); if (c[h]) tg[h] = n; });
  const tree: Record<string, string> = {};
  Object.keys(FS).forEach(k => { if (isReal(k) && FS[k].orig != null) tree[k] = FS[k].orig!; });
  const trees: Record<string, Record<string, string>> = {};
  Object.keys(refs).forEach(n => trees[n] = n === head ? tree : (GIT.trees[n] || {}));
  Object.assign(GIT, { c, order, refs, tags: tg, trees, base: {} });
  BRANCH = head === "HEAD" ? "(detached)" : head;
  COMMITS.length = 0;
  order.slice(0, 6).forEach(h => COMMITS.push({ h, m: c[h].m }));
  try { $("#st-branch-l")!.textContent = BRANCH; } catch { /* sem status bar */ }
  try { termRefreshPrompt(); } catch { /* sem terminal */ }
  try { rerender("graph"); } catch { /* sem graph */ }
  refresh(false, true);
}
R.flush = () => flushSave();
R.reloadDisk = () => reloadDisk();
R.syncGit = () => syncGit();
R.termLine = (t, e) => termLine(t, e);
R.envFor = () => envFor();
R.gitInit = () => enqueue(async () => { flushSave(); await gitOk("init", "-b", "main"); R.git = true; R.prefix = ""; await markChanged(); await syncGit(); toast("git repository created on main"); });
const _commit = commit, _checkout = checkout, _gitMerge = gitMerge, _gfFinish = gfFinish;
commit = function (msg?: string, author?: string) {
  if (!R.git) return _commit(msg, author);
  const m = (msg || COMMIT_MSG || "").trim();
  const list = (STAGED.size ? [...STAGED] : changes()).filter(p => FS[p] && stOf(p));
  const r = _commit(msg, author);
  if (!r) return r;
  flushSave();
  const rels = list.map(relOf);
  const by = author && AGENTS[author] ? AGENTS[author].n : null;
  enqueue(async () => {
    await gitOk("add", "-A", "--", ...rels);
    const a = ["commit", "-m", m];
    if (by) a.push("-m", `Assisted-by: ${by} (dxtutor Co-Dev)`);
    const c = await gitOk(...a);
    await syncGit();
    say(c.stdout.split("\n")[0]);
  });
  return r;
};
checkout = function (b: string, create?: boolean) {
  if (!R.git) return _checkout(b, create);
  if (create && GIT.refs[b]) { toast("Branch already exists: " + b); return false; }
  if (!create && !GIT.refs[b] && !/^(main|develop)$/.test(b)) { toast("Unknown branch: " + b); return false; }
  if (!create && !GIT.refs[b]) create = true;
  flushSave();
  if (create) { GIT.refs[b] = GIT.refs[BRANCH]; GIT.trees[b] = { ...(GIT.trees[BRANCH] || {}) }; }
  BRANCH = b;
  try { $("#st-branch-l")!.textContent = b; } catch { /* sem status bar */ }
  STAGED.clear();
  enqueue(async () => { await gitOk(...(create ? ["checkout", "-b", b] : ["checkout", b])); await reloadDisk(); await syncGit(); })
    .then(() => { if (R.git) void git("rev-parse", "--abbrev-ref", "HEAD").then(h => { if (h.stdout.trim() !== BRANCH) void syncGit(); }); });
  return true;
};
function realMerge(src: string, author?: string): CommitNode {
  const dst = BRANCH, m = `Merge ${src} into ${dst}`;
  enqueue(async () => {
    const r = await git("merge", "--no-ff", "-m", m, src);
    if (r.code !== 0) { await git("merge", "--abort"); throw new Error(`merge of ${src} into ${dst} has conflicts — aborted. Run "git merge ${src}" in the terminal to resolve them by hand.`); }
    await reloadDisk();
    await syncGit();
  });
  return { h: "pending", m, p: [], b: dst, a: author || "w", t: Date.now(), files: [] };
}
gitMerge = function (src: string, author?: string) {
  if (!R.git) return _gitMerge(src, author);
  if (!GIT.refs[src] || src === BRANCH) return null;
  flushSave();
  return realMerge(src, author);
};
gfFinish = function (b?: string, author?: string) {
  if (!R.git) return _gfFinish(b, author);
  const bn = b || BRANCH;
  if (!isFlow(bn) || !GIT.refs[bn]) return null;
  flushSave();
  const rel = /^(release|hotfix)\//.test(bn), tag = "v" + bn.split("/")[1], main = GIT.refs.main ? "main" : GIT.refs.master ? "master" : "main";
  let res: unknown = null;
  if (rel) { checkout(main); res = gitMerge(bn, author); enqueue(() => gitOk("tag", "-a", tag, "-m", `Release ${tag}`)); checkout("develop"); gitMerge(bn, author); }
  else { checkout("develop"); res = gitMerge(bn, author); }
  enqueue(async () => { await gitOk("branch", "-d", bn); await syncGit(); say(`gitflow: finished ${bn}`); });
  return res;
};

/* ───── LLM providers ───── */
async function loadKeys(): Promise<void> { try { R.keys = await inv("keys_status"); } catch { R.keys = {}; } }
const usable = (k: string) => !!(PROV[k] && PROV[k].on && (PROV[k].local || R.keys[k]));
function pickProv(): string {
  if (usable(ACTIVE)) return ACTIVE;
  const k = ["claude", "codex", "gemini", "ollama"].find(usable);
  if (!k) throw new Error("No model is configured — add an API key in Settings, or start Ollama.");
  return k;
}
const approvals: Record<string, { ok: (v: boolean) => void; el: HTMLElement }> = {};
R.approve = (id, ok) => {
  const a = approvals[id];
  if (a) { delete approvals[id]; a.el.innerHTML = ok ? '<span class="okc">✓ allowed</span>' : '<span style="color:var(--red)">✖ denied</span>'; a.ok(ok); }
};
function askApproval(cmd: string): Promise<boolean> {
  const id = "a" + Date.now();
  return new Promise(ok => {
    const c = card("approval", `Run in <b>${escH(R.name)}</b>?<pre style="white-space:pre-wrap;margin:6px 0">${escH(cmd)}</pre><span><button class="mini pri" onclick="DXR.approve('${id}',true)">Allow</button> <button class="mini" onclick="DXR.approve('${id}',false)">Deny</button></span>`);
    approvals[id] = { ok, el: (c.bd.querySelector("span:last-child") as HTMLElement | null) || c.bd };
  });
}
function extraTools(): Tool[] {
  if (!R.root) return [];
  return [{
    name: "run_command",
    description: `Runs a shell command in the project folder (${R.root}) and returns exit code, stdout and stderr. Use it for builds, tests, linters and git status. The human may have to approve it.`,
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    execute: async ({ command }: { command: string }) => {
      const danger = /git push|rm -rf|--force|drop table|mkfs|shutdown/i.test(command);
      if (MODE !== "auto" || danger) { if (!await askApproval(command)) return "the human denied this command"; }
      flushSave();
      await Q;
      const r = R.info.os === "windows" ? await sh("cmd", ["/C", command], { timeout: 300000, env: envFor() }) : await sh("sh", ["-c", command], { timeout: 300000, env: envFor() });
      await reloadDisk();
      return `exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n--- stdout\n${r.stdout.slice(-12000)}\n--- stderr\n${r.stderr.slice(-6000)}`;
    },
  }];
}
async function desktopSample(input: string | SampleMsg[], o: SampleOpts = {}) {
  const k = pickProv(), P = PROV[k];
  const msgs: any[] = typeof input === "string" ? [{ role: "user", text: input }] : input.map(m => ({ role: m.role, text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }));
  const tools = (o.tools || []).concat(o.tools ? extraTools() : []);
  let total = "", tin = 0, tout = 0;
  for (let round = 0; round < 16; round++) {
    if (o.signal && o.signal.aborted) throw STOP;
    const r = await inv("llm_chat", { req: { provider: k, endpoint: P.ep, model: P.model, messages: msgs, tools: tools.map(t => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object", properties: {} } })), maxTokens: 4096 } });
    tin += r.inputTokens; tout += r.outputTokens;
    if (r.text) { total += (total ? "\n\n" : "") + r.text; if (o.onText) o.onText({ text: total }); }
    if (!r.toolCalls || !r.toolCalls.length) break;
    msgs.push({ role: "assistant", text: r.text || "", toolCalls: r.toolCalls });
    const results: { id: unknown; content: string }[] = [];
    for (const c of r.toolCalls) {
      if (o.signal && o.signal.aborted) throw STOP;
      const t = tools.find(x => x.name === c.name);
      let out: unknown;
      try { out = t ? await t.execute(c.input || {}) : "unknown tool " + c.name; } catch (e) { out = "error: " + ((e as Error) && (e as Error).message || e); }
      results.push({ id: c.id, content: typeof out === "string" ? out : JSON.stringify(out) });
    }
    msgs.push({ role: "user", text: "", toolResults: results });
  }
  try { use(k, tin + tout); } catch { /* sem contador de uso */ }
  return { text: total, provider: k, inputTokens: tin, outputTokens: tout };
}
SAMPLE = desktopSample;
LIVE_OK = true;
provState = k => PROV[k].local ? "local" : R.keys[k] ? "live" : "no key";
const _updateAgentUI = updateAgentUI;
updateAgentUI = function (this: unknown, ...args: any[]) {
  _updateAgentUI.apply(this, args);
  const n = $("#live-note");
  if (n) n.innerHTML = `<span class="tag live">desktop</span> free-form questions go to the selected model (${["claude", "codex", "gemini", "ollama"].filter(usable).map(k => PROV[k].name).join(", ") || "none configured — add a key in Settings"}), with access to the files of ${R.root ? "<b>" + escH(R.name) + "</b>" : "this workspace"}${R.root ? " and to the terminal" : ""}.`;
};
testProv = async function (k: string, btn: HTMLElement) {
  btn.textContent = "testing…";
  const o = btn.parentElement!.querySelector(".pd")!;
  const P = PROV[k];
  try {
    const r = await inv("llm_chat", { req: { provider: k, endpoint: P.ep, model: P.model, messages: [{ role: "user", text: "Reply with the single word OK." }], maxTokens: 16 } });
    o.innerHTML = `<span style="color:var(--green)">✓ ${escH(P.model)}</span> answered: ${escH(r.text.slice(0, 60))}`;
  } catch (e) { o.innerHTML = `<span style="color:var(--red)">✖</span> ${escH(String(e).slice(0, 240))}`; }
  btn.textContent = "Test connection";
};
const _settings = VIEW.settings;
VIEW.settings = (t: any, host: any) => {
  _settings(t, host);
  const ks = Object.keys(PROV);
  host.querySelectorAll(".pgrid")[0] && host.querySelectorAll(".pgrid")[0].querySelectorAll(".pcard").forEach((cd: any, i: number) => {
    const k = ks[i], inp = cd.querySelector("input[type=password]");
    if (!inp || PROV[k].local) return;
    inp.placeholder = R.keys[k] ? "saved ✓ — type to replace" : "paste the API key";
    inp.onchange = async () => {
      const v = inp.value.trim();
      try { await inv("save_key", { provider: k, key: v }); await loadKeys(); inp.value = ""; toast(v ? PROV[k].name + " key saved" : PROV[k].name + " key removed"); show(cur); updateAgentUI(); }
      catch (e) { toast("Could not save the key: " + e); }
    };
  });
  const sub = host.querySelector(".sub");
  if (sub) sub.textContent = `Desktop app ${R.info.version || ""} · keys are stored in ${R.info.configDir || "the app config folder"}/keys.json (readable only by you), or read from ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY.`;
};
/* sensible real model ids instead of the prototype's placeholders */
if (PROV.gemini.model === "gemini-pro") PROV.gemini.model = "gemini-2.5-flash";
if (PROV.codex.model === "gpt-codex") PROV.codex.model = "gpt-4.1";

/* ───── containers and Kubernetes ───── */
const rtBin = () => ENVS.rt === "podman" ? "podman" : "docker";
function envFor(): Record<string, string> {
  const e: Record<string, string> = {};
  if (ENVS.rtOn && R.sock) { e.DOCKER_HOST = "unix://" + R.sock; if (ENVS.rt === "podman") e.CONTAINER_HOST = "unix://" + R.sock; }
  if (R.kube) e.KUBECONFIG = R.kube;
  return e;
}
const compose = () => rtBin() + " compose";
rtConnect = async function () {
  if (ENVS.rtOn) { ENVS.rtOn = false; saveEnv(); STACK = null; DEVC = null; drawStack(); say("container runtime disconnected"); infraDraw(); return; }
  R.sock = await inv("expand_path", { path: ENVS.sock[ENVS.rt] });
  const env = { DOCKER_HOST: "unix://" + R.sock, CONTAINER_HOST: "unix://" + R.sock };
  const r = await sh(rtBin(), ["info", "--format", ENVS.rt === "podman" ? "{{.Version.Version}}" : "{{.ServerVersion}}"], { env, timeout: 15000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
  if (r.code === 0) { ENVS.rtOn = true; saveEnv(); say(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected at ${R.sock}`); toast(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected`); }
  else { toast(`${RTN[ENVS.rt]} not reachable at ${R.sock}`); say(String(r.stderr || "").trim().split("\n")[0]); }
  infraDraw();
};
k8sConnect = async function () {
  if (ENVS.k8sOn) { ENVS.k8sOn = false; saveEnv(); K8S = null; say("cluster disconnected"); infraDraw(); return; }
  const kube: string = await inv("expand_path", { path: ENVS.kube });
  R.kube = kube;
  const env = { KUBECONFIG: kube };
  const ctx = await sh("kubectl", ["config", "get-contexts", "-o", "name"], { env, timeout: 15000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
  if (ctx.code !== 0) { toast("kubectl could not read " + R.kube); say(String(ctx.stderr).trim().split("\n")[0]); return; }
  const names = ctx.stdout.trim().split("\n").filter(Boolean);
  KCTX.length = 0; KCTX.push(...names);
  if (!names.includes(ENVS.ctx)) { const cc = await sh("kubectl", ["config", "current-context"], { env }); ENVS.ctx = cc.stdout.trim() || names[0] || ENVS.ctx; }
  const ok = await sh("kubectl", ["--context", ENVS.ctx, "get", "ns", "-o", "name", "--request-timeout=6s"], { env, timeout: 15000 });
  if (ok.code !== 0) { toast(`cluster ${ENVS.ctx} not reachable`); say(String(ok.stderr).trim().split("\n")[0]); infraDraw(); return; }
  ENVS.k8sOn = true; saveEnv();
  say(`cluster ${ENVS.ctx} reachable via ${R.kube}`);
  await readK8s();
  infraDraw();
};
async function readK8s(): Promise<void> {
  if (!ENVS.k8sOn) return;
  const r = await sh("kubectl", ["--context", ENVS.ctx, "-n", ENVS.ns, "get", "deploy", "-o", "json"], { env: envFor(), timeout: 20000 });
  if (r.code !== 0) return;
  try {
    const items = JSON.parse(r.stdout).items || [];
    K8S = items.length ? { docs: k8sDocs(), deps: items.map((d: any) => { const c = (d.spec.template.spec.containers || [])[0] || {}; return { n: d.metadata.name, rep: d.spec.replicas || 0, ready: (d.status && d.status.readyReplicas) || 0, img: c.image, port: ((c.ports || [])[0] || {}).containerPort }; }) } : null;
  } catch { /* resposta inválida */ }
}
const _dxRun = dxRun, _dxStop = dxStop, _dxDeploy = dxDeploy, _drawStack = drawStack;
async function readStack(): Promise<void> {
  const r = await sh(rtBin(), ["compose", "ps", "--format", "json"], { env: envFor(), timeout: 30000 });
  if (r.code !== 0) return;
  let rows: any[] = [];
  const s = r.stdout.trim();
  try { rows = s.startsWith("[") ? JSON.parse(s) : s.split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { /* formato inesperado */ }
  STACK = rows.length ? rows.map(x => { const pub = (x.Publishers || []).find((p: any) => p.PublishedPort); return { name: x.Service || x.Name, src: x.Image || "", url: pub ? `http://localhost:${pub.PublishedPort}` : "internal", state: x.Health || x.State || "" }; }) : null;
  drawStack();
}
dxRun = function (term?: unknown) {
  if (!R.root || !FS[ROOT + "docker-compose.yml"] && !FS[ROOT + "compose.yaml"]) return _dxRun(term);
  if (!needRt()) return { ok: false };
  flushSave();
  void Q.then(async () => { const code = await runInTerm(`${compose()} up --build -d`, { env: envFor() }); if (code === 0) { await readStack(); setPanelTab("services"); toast(`${STACK ? STACK.length : 0} services up`); } });
  return { ok: true, sum: "starting" };
};
dxStop = function (term?: unknown) {
  if (!R.root) return _dxStop(term);
  void runInTerm(`${compose()} down`, { env: envFor() }).then(() => { STACK = null; drawStack(); });
};
drawStack = function (this: unknown, ...args: any[]) {
  _drawStack.apply(this, args);
  if (R.root) { const t = document.querySelector("#pc-services .tag.warn"); if (t) { t.textContent = "live"; t.className = "tag live"; } }
};
dxDeploy = function () {
  if (!R.root) return _dxDeploy();
  if (!needRt()) return { ok: false };
  if (!ENVS.k8sOn) { goPane("infra"); toast("Point KUBECONFIG and connect the cluster first"); return { ok: false }; }
  const docs = k8sDocs();
  if (!docs.length) return _dxDeploy();
  flushSave();
  const proj = R.name!.toLowerCase().replace(/[^a-z0-9_-]/g, ""), ctx = ENVS.ctx, ns = ENVS.ns, kc = `kubectl --context ${ctx}`, deps = docs.filter(d => d.k === "Deployment");
  const load = (img: string) => /^kind-/.test(ctx) ? `kind load docker-image ${img} --name ${ctx.slice(5)}` : /^minikube/.test(ctx) ? `minikube image load ${img}` : /^k3d-/.test(ctx) ? `k3d image import ${img} -c ${ctx.slice(4)}` : `echo "push ${img} to a registry the cluster can pull from"`;
  const own = deps.filter(d => /registry\.example\.com/.test(d.img || ""));
  const script = ["set -e", `${compose()} build`, ...own.map(d => `${rtBin()} tag ${proj}-${d.n} ${d.img} && ${load(d.img)}`), `${kc} create namespace ${ns} --dry-run=client -o yaml | ${kc} apply -f -`, `${kc} -n ${ns} apply -f deploy/k8s`, ...deps.map(d => `${kc} -n ${ns} rollout status deploy/${d.n} --timeout=180s`)].join("\n");
  void Q.then(async () => { const code = await runInTerm(script, { env: envFor() }); if (code === 0) { await readK8s(); toast("Deployed to " + ctx); goPane("infra"); } infraDraw(); });
  return { ok: true, sum: "deploying" };
};
const _observe = VIEW.observe;
VIEW.observe = (t: any, host: any) => {
  _observe(t, host);
  if (!R.root) return;
  const pg = host.querySelector(".page") || host;
  const k8s = t.env && t.env !== "local" && ENVS.k8sOn;
  const cmd = k8s ? `kubectl --context ${ENVS.ctx} -n ${ENVS.ns} logs -f --tail=200 deploy/${t.name}` : `${compose()} logs -f --tail=200 ${t.name}`;
  pg.insertAdjacentHTML("afterbegin", `<div class="sec-empty" style="margin:0 0 10px"><b>Real logs:</b> <code>${escH(cmd)}</code> <button class="mini pri" onclick='DXR.logs(${JSON.stringify(cmd)})'>Stream in terminal</button> <span class="dim">(the charts below are modelled)</span></div>`);
};
R.logs = cmd => runInTerm(cmd, { env: envFor() });

/* ───── scripted demo flows stay on the sample workspace ───── */
const _runMission = runMission, _runSprint = runSprint;
const sampleOnly = (what: string) => { toast(`${what} are scripted demos — they run on the sample workspace (File → Close Folder)`); };
runMission = function (S: any, text?: any) { if (R.root) { sampleOnly("Missions"); return; } return _runMission(S, text); };
runSprint = function (s: any) { if (R.root) { sampleOnly("Sprint runs"); return; } return _runSprint(s); };

/* ───── extensions: JSZip ships with the app ───── */
loadJSZip = function () {
  return window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "jszip.min.js";
    s.onload = () => ok(window.JSZip);
    s.onerror = () => no(new Error("jszip.min.js missing"));
    document.head.appendChild(s);
  });
};

/* ───── menus, palette, welcome ───── */
R.open = p => openFolder(p);
const closeFolder = () => { flushSave(); void Q.then(() => { LS.set("dx-last-folder", ""); location.reload(); }); };
R.close = closeFolder;
function fileItems(): any[] {
  const rec = LS.get("dx-recent", []) as string[];
  return [
    { l: "Open Folder…", k: "Ctrl+O", act: () => openFolder() },
    { l: "Open Recent Folder", sub: rec.length ? rec.map(p => ({ l: p, act: () => openFolder(p) })) : [{ l: "(none yet)" }] },
    { l: "Close Folder", act: closeFolder },
    { sep: 1 },
  ];
}
const fm = MENUS.find(m => m.t === "File");
if (fm) {
  const ds = Object.getOwnPropertyDescriptor(fm, "items")!, g = () => ds.get ? ds.get.call(fm) : ds.value;
  Object.defineProperty(fm, "items", { configurable: true, get: () => fileItems().concat(g()) });
  try { $("#menubar")!.innerHTML = ""; buildMenubar(); } catch { /* menubar ainda não montada */ }
}
CMD.unshift(["File: Open Folder…", "Ctrl+O", () => openFolder()], ["File: Close Folder", "", closeFolder]);
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "o" || e.key === "O")) { e.preventDefault(); void openFolder(); }
}, true);
const _welcome = VIEW.welcome;
VIEW.welcome = (t: any, host: any) => {
  _welcome(t, host);
  const sub = host.querySelector(".sub");
  if (!sub) return;
  const rec = LS.get("dx-recent", []) as string[];
  sub.insertAdjacentHTML("afterend", `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px"><button class="mini pri" onclick="DXR.open()">Open Folder…</button>${rec.slice(0, 4).map(p => `<button class="mini" title="${escH(p)}" onclick='DXR.open(${JSON.stringify(p)})'>${escH(base(p))}</button>`).join("")}${R.root ? `<span class="dim" style="align-self:center">open: <b>${escH(R.root)}</b></span>` : ""}</div>`);
};

/* ───── start ───── */
void (async () => {
  R.info = await inv("app_info");
  try {
    R.user = (await sh("whoami", [], { cwd: R.info.home })).stdout.trim().split(/[\\/]/).pop();
    R.host = (await sh("hostname", [], { cwd: R.info.home })).stdout.trim().split(".")[0];
  } catch { /* sem shell */ }
  await loadKeys();
  try { updateAgentUI(); } catch { /* painel ainda não montado */ }
  const start = R.info.openAtStart || LS.get("dx-last-folder", "");
  if (start) await openFolder(start);
  try { if (tabOf("welcome") && cur === "welcome") show("welcome"); } catch { /* sem tab welcome */ }
  if (R.info.selftest && !R.info.pairtest) void selftest();
  R.ready = true;
})();

async function selftest(): Promise<void> {
  const rep: { tauri: boolean; version?: string; os?: string; errors: string[]; steps: Record<string, unknown> } =
    { tauri: true, version: R.info.version, os: R.info.os, errors: R.errors, steps: {} };
  const step = async (n: string, f: () => unknown) => {
    try { rep.steps[n] = await f(); } catch (e) { rep.steps[n] = "FAIL: " + ((e as Error) && (e as Error).message || e); }
  };
  await step("ui", () => ({ files: Object.keys(FS).length, menus: MENUS.map(m => m.t), sample: typeof SAMPLE, provState: Object.keys(PROV).map(provState) }));
  await step("exec", async () => (await sh("sh", ["-c", "echo ok"], { cwd: R.info.home })).stdout.trim());
  if (R.root) {
    await step("open", () => ({ root: R.root, git: R.git, branch: BRANCH, commits: GIT.order.length, files: Object.keys(R.disk).length }));
    await step("autosave", async () => { writeFile(ROOT + "notes/selftest.txt", "written by the IDE\n"); flushSave(); await Q; return (await sh("cat", ["notes/selftest.txt"])).stdout.trim(); });
    await step("commit", async () => { const c = commit("test: commit from the desktop IDE"); await Q; await Q; return { virtual: !!c, head: (await git("log", "-1", "--format=%s")).stdout.trim(), graph: GIT.order.length }; });
    await step("gitflow", async () => {
      const b = gfStart("feature", "selftest-flow"); await Q;
      writeFile(ROOT + "notes/flow.txt", "x\n"); flushSave(); commit("feat: flow"); await Q;
      gfFinish(b); await Q; await Q;
      return { branch: (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim(), branches: (await git("branch", "--format=%(refname:short)")).stdout.trim().split("\n"), flowFile: !!FS[ROOT + "notes/flow.txt"] };
    });
    await step("terminal", async () => { const lines: string[] = []; const code = await stream("echo hello-from-term; echo $DX_SELF", { env: { DX_SELF: "env-ok" }, line: l => lines.push(l) }); return { code, lines }; });
    await step("terminalUI", async () => { await realTerm("echo ui-line"); await new Promise(r => setTimeout(r, 300)); return [...document.querySelectorAll("#term .line")].some(d => d.textContent === "ui-line"); });
    await step("llmLoop", async () => {
      const seen: string[] = [];
      const r = await desktopSample([{ role: "user", content: "list the files" }], { tools: [{ name: "list_files", description: "Lists files", inputSchema: { type: "object", properties: {} }, execute: async () => { seen.push("list_files"); return Object.keys(R.disk); } }] });
      return { text: r.text, provider: r.provider, toolsRun: seen };
    }).then(() => { if (String(rep.steps.llmLoop).startsWith("FAIL")) rep.steps.llmLoop = "skipped — no model reachable: " + String(rep.steps.llmLoop).slice(6, 90); });
    await step("llmNoKey", async () => { try { await desktopSample("hi"); return "unexpected"; } catch (e) { return String((e as Error) && (e as Error).message || e).slice(0, 120); } });
  }
  rep.errors = R.errors;
  await inv("selftest_report", { report: rep });
}
})();
