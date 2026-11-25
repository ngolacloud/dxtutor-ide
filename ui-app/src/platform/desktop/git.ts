/* ═════════ dxtutor IDE — desktop: git real (ADR-0004, U4h1) ═════════
   O grafo, os ramos e as tags lidos do repositório real (`syncGit`), o changelog sobre o
   `git log`/`git show` reais, o `git init`, e o commit/checkout/merge/gitflow que passam a
   git real quando a pasta é um repositório. Era a secção «git» do bridge.ts, verbatim; ainda
   decora commit/checkout/gitMerge/gfFinish (U4h2+: injecção no dono, o scm). */

import type { CommitNode } from "./types";
import type { ScmDesktop } from "../../features/scm/application/ports";
import { slug } from "../../features/scm/domain/gitflow";
import { desktopPorts } from "../../app/desktop";
import { agentStore } from "../../app/store/agent";
import { assistTrailers } from "../../features/scm/domain/trailers";
import type { DesktopContext } from "./context";
import { rerender } from "../../features/tabs";
import { gitMerge, isFlow, commitMsg } from "../../features/scm";

export function installGit(ctx: DesktopContext): void {
const { R, gitc, git, gitOk, enqueue, isReal, relOf, say } = ctx;
const flushSave = () => ctx.flushSave();
const reloadDisk = () => ctx.reloadDisk();
const markChanged = () => ctx.markChanged();
const envFor = () => ctx.envFor();
const termLine = (t: string, e?: boolean) => ctx.termLine(t, e);
/* ───── git ───── */
async function syncGit(): Promise<void> {
  if (!R.git) return;
  const head = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
  /* r23 F3: --name-only traz os ficheiros de cada commit (o detalhe do grafo e a pesquisa `file:`); o separador de
     registo vai à cabeça porque a lista de ficheiros vem depois do formato */
  const lg = await git("log", "--all", "--date-order", "-n", "400", "--name-only", "--format=%x1e%H%x1f%P%x1f%an%x1f%at%x1f%s");
  const heads = (await git("for-each-ref", "--format=%(refname:short)%1f%(objectname)", "refs/heads")).stdout.trim().split("\n").filter(Boolean).map(l => l.split("\x1f"));
  const tags = (await git("for-each-ref", "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)", "refs/tags")).stdout.trim().split("\n").filter(Boolean).map(l => l.split("\x1f"));
  const s = (h: string) => h.slice(0, 7), c: Record<string, CommitNode> = {}, order: string[] = [];
  lg.stdout.split("\x1e").map(x => x.trim()).filter(Boolean).forEach(x => {
    const [head, ...names] = x.split("\n");
    const [h, p, a, t, m] = head.split("\x1f");
    const files = names.map(n => n.trim()).filter(Boolean);
    c[s(h)] = { h: s(h), m: m || "", p: (p || "").split(" ").filter(Boolean).map(s).filter(Boolean), b: null, a: a || "", t: (+t || 0) * 1000, files };
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
/* feature `changelog` (harvest ui-next): troca a fonte simulada pela timeline git REAL
   do repositório aberto. git_log dá os commits; git_show dá o patch tal-e-qual. Sem pasta
   aberta → vazio honesto (a vista mostra o aviso). Os comandos existem no backend. */
/* o changelog real: porta `desktopPorts.changelog` (U4h5b; antes reatribuía o window.clLog/clShow) */
desktopPorts.changelog = { log: async () => (R.root ? gitc.log(R.root, 30) : []), show: async (hash: string) => (R.root ? gitc.show(R.root, hash) : "") };
R.termLine = (t, e) => termLine(t, e);
R.envFor = () => envFor();
R.gitInit = () => enqueue(async () => { flushSave(); await gitOk("init", "-b", "main"); R.git = true; R.prefix = ""; await markChanged(); await syncGit(); toast("git repository created on main"); });
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
/* a porta desktop do scm (ADR-0004, U4h2): o scm.ts consulta-a nas versões publicadas do
   commit/checkout/gitMerge/gfFinish — antes estas quatro eram reatribuídas no `window`. Os
   corpos são os mesmos; a versão simulada chega como último argumento (`_commit`, …). Dentro
   do gfFinish, `checkout(…)`/`gitMerge(…)` continuam a ser os globais publicados (que voltam
   a passar por esta porta), como antes eram os decorados. */
const scmDesktop: ScmDesktop = {
commit(msg, author, _commit) {
  if (!R.git) return _commit(msg, author);
  const m = (msg || commitMsg() || "").trim();
  const fileStaged = STAGED.size > 0;
  const list = (fileStaged ? [...STAGED] : changes()).filter(p => FS[p] && stOf(p));
  const r = _commit(msg, author);
  if (!r) return r;
  flushSave();
  const rels = list.map(relOf);
  const by = author && AGENTS[author] ? AGENTS[author].n : null;
  enqueue(async () => {
    /* r23 F3 (UI-SCM-10): what is already in the index (hunks staged in the pane, or by hand) is committed as it
       is — the files staged whole join it, and without any, nothing else is added (like VS Code) */
    const inIndex = new Set((await git("diff", "--cached", "--name-only")).stdout.split("\n").map(x => x.trim()).filter(Boolean));
    const add = rels.filter(p => !inIndex.has((R.prefix || "") + p));
    if (add.length && (fileStaged || !inIndex.size)) await gitOk("add", "-A", "--", ...add);
    const a = ["commit", "-m", m];
    // RF-T02: the model that helped and the issue, as trailers; the author is the human
    const model = by ? agentStore.providers[agentStore.provider]?.model || by : null;
    const trailers = assistTrailers(m, model);
    if (trailers.length) a.push("-m", trailers.join("\n"));
    const c = await gitOk(...a);
    await syncGit();
    say(c.stdout.split("\n")[0]);
  });
  return r;
},
checkout(b, create, _checkout) {
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
},
gitMerge(src, author, _gitMerge) {
  if (!R.git) return _gitMerge(src, author);
  if (!GIT.refs[src] || src === BRANCH) return null;
  flushSave();
  return realMerge(src, author);
},
gfStart(kind, name, _gfStart) {
  if (!R.git) return _gfStart(kind, name);
  /* the same branch name and base as the simulated engine, created in the real repository;
     `checkout(…)` is the published global, so it goes back through this port */
  const b = kind + "/" + slug(name), base = kind === "hotfix" ? (GIT.refs.main ? "main" : GIT.refs.master ? "master" : "main") : "develop";
  if (BRANCH !== base) checkout(base);
  if (GIT.refs[b]) checkout(b); else checkout(b, true);
  say(`gitflow: started ${b} from ${base}`);
  return b;
},
gfFinish(b, author, _gfFinish) {
  if (!R.git) return _gfFinish(b, author);
  const bn = b || BRANCH;
  if (!isFlow(bn) || !GIT.refs[bn]) return null;
  flushSave();
  const rel = /^(release|hotfix)\//.test(bn), tag = "v" + bn.split("/")[1], main = GIT.refs.main ? "main" : GIT.refs.master ? "master" : "main";
  let res: CommitNode | null = null;
  if (rel) { checkout(main); res = gitMerge(bn, author) as CommitNode | null; enqueue(() => gitOk("tag", "-a", tag, "-m", `Release ${tag}`)); checkout("develop"); gitMerge(bn, author); }
  else { checkout("develop"); res = gitMerge(bn, author) as CommitNode | null; }
  enqueue(async () => { await gitOk("branch", "-d", bn); await syncGit(); say(`gitflow: finished ${bn}`); });
  return res;
},
};
desktopPorts.scm = scmDesktop;
ctx.syncGit = syncGit;
}
