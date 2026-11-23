/* ═════════ dxtutor IDE — desktop: pastas, autosave e o explorador (ADR-0004, U4h1) ═════════
   Abrir/recarregar uma pasta do disco (`openFolder`/`reloadDisk`), marcar o que difere do
   HEAD (`markChanged`), o autosave (`flushSave`, subscrito ao `workspace:changed`), o nome da
   pasta no explorador e o prompt real do terminal; e (installFolderUi) o menu File, a paleta,
   o Ctrl+O e os botões da página de boas-vindas. Eram as secções «folders and autosave» e
   «menus, palette, welcome» do bridge.ts, verbatim. */

import { jsa } from "../../core";
import { bus } from "../../app/bus";
import { loadWorkspace } from "../tauri/workspace";
import type { Workspace } from "./types";
import { desktopPorts } from "../../app/desktop";
import type { DesktopContext } from "./context";

export function installWorkspace(ctx: DesktopContext): void {
const { R, fsx, git, enqueue, escH, isReal, relOf, say } = ctx;
const syncGit = () => ctx.syncGit();
/* ───── folders and autosave ───── */
async function openFolder(path?: string): Promise<boolean> {
  if (!path) path = (await fsx.pickFolder()) ?? undefined;
  if (!path) return false;
  let L: Workspace;
  try { L = await loadWorkspace(path); } catch (e) { toast("Could not open " + path + ": " + e); return false; }
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
  document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: R.root } }));
  if (!R.git) { try { card("desktop", `<b>${escH(R.name)}</b> is not a git repository. The graph, gitflow and commits need one.<div style="margin-top:8px"><button class="mini pri" onclick="DXR.gitInit()">git init</button></div>`); } catch { /* sem chat */ } }
  return true;
}
async function reloadDisk(): Promise<void> {
  if (!R.root) return;
  const L: Workspace = await loadWorkspace(R.root);
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
  /* Rede de segurança (ADR-0005, R0): um FS esvaziado por inteiro (estado reposto, simulação a
     limpar o workspace…) não é «o utilizador apagou tudo». Nesse caso não se apaga nada no
     disco: relê-se a pasta. Apagar ficheiros um a um (até ao último) continua a funcionar. */
  if (!seen.size && Object.keys(R.disk).length > 1) {
    console.warn("flushSave: o workspace em memória ficou vazio — não apago a pasta no disco; a reler");
    void reloadDisk();
    return;
  }
  Object.keys(R.disk).forEach(r => { if (!seen.has(r)) { d.push(r); delete R.disk[r]; } });
  if (!w.length && !d.length) return;
  const root = R.root;
  enqueue(async () => {
    for (const [rel, content] of w) await fsx.writeFile(root, rel, content);
    for (const rel of d) await fsx.deleteFile(root, rel);
    document.dispatchEvent(new CustomEvent("dx:saved", { detail: { root, files: w.map(x => x[0]).concat(d) } }));
  });
}
/* U3c: autosave do desktop a cada mudança do workspace (antes: decorava o refresh) */
bus.on("workspace:changed", () => {
  if (R.root) { clearTimeout(saveT); saveT = window.setTimeout(flushSave, 350); }
});
window.addEventListener("beforeunload", () => flushSave());

/* explorer shows the opened folder by its own name; terminal prompt shows the real user and host */
/* a raiz do explorador com o nome da pasta: porta `desktopPorts.explorer` (U4h5b; antes reatribuía o syncTree) */
desktopPorts.explorer = { syncTree(_syncTree) {
  _syncTree();
  if (R.root || R.remote) { const r = TREE.projects.children.dxtutor; TREE.projects.children = {}; TREE.projects.children[R.name!] = r; }
} };
/* o prompt real (utilizador/host/cwd/ramo) passou para a porta do terminal (platform/desktop/terminal.ts, U4h3) */
function termBanner(): void {
  const t = $("#term");
  if (!t) return;
  t.innerHTML = "";
  echo(`<span class="ac">${escH(R.info.os === "windows" ? "cmd" : "sh")}</span> <span class="dim">· real shell in</span> ${escH(R.root)} <span class="dim">· Ctrl+C stops · clear</span>`);
  newInput(true);
}
ctx.openFolder = openFolder; ctx.reloadDisk = reloadDisk; ctx.markChanged = markChanged; ctx.flushSave = flushSave;
}

export function installFolderUi(ctx: DesktopContext): void {
const { R, escH, base, idle } = ctx;
const openFolder = (p?: string) => ctx.openFolder(p);
const flushSave = () => ctx.flushSave();
/* ───── menus, palette, welcome ───── */
R.open = p => openFolder(p);
const closeFolder = () => { flushSave(); void idle().then(() => { LS.set("dx-last-folder", ""); location.reload(); }); };
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
/* os botões de pasta nas boas-vindas: porta `desktopPorts.welcome` (U4h5b; antes embrulhava o VIEW.welcome) */
desktopPorts.welcome = { welcome(t, host, _welcome) {
  _welcome(t, host);
  const sub = host.querySelector(".sub");
  if (!sub) return;
  const rec = LS.get("dx-recent", []) as string[];
  sub.insertAdjacentHTML("afterend", `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px"><button class="mini pri" onclick="DXR.open()">Open Folder…</button>${rec.slice(0, 4).map(p => `<button class="mini" title="${escH(p)}" onclick="DXR.open(${jsa(p)})">${escH(base(p))}</button>`).join("")}${R.root ? `<span class="dim" style="align-self:center">open: <b>${escH(R.root)}</b></span>` : ""}</div>`);
} };
}
