/* ═════════ dxtutor IDE — feature: Source Control + motor git (resíduo + composição) ═════════
   Feature-folha DONA de todo o motor git/scm (padrão da sessão Debug: inversão de
   direcção — o par render+motor, antes espalhado por `app.ts`, vive inteiro aqui).

   ADR-0002, Fase 1 (bridge tipado): o acesso a `window.*` ficou confinado ao
   `features/scm/infrastructure/legacy-bridge.ts`; este ficheiro importa tudo o que
   precisa de lá (e os helpers puros `$`/`hd`/`svg`/`esc` do `core`) e deixou de ser
   `@ts-nocheck`. As fases seguintes extraem o domínio puro (`features/scm/domain/`) e
   a orquestração (`features/scm/application/`); por agora o motor vive cá, já tipado.

   Fronteira: a feature DETÉM o estado (GIT/LANE/STAGED/BRANCH/COMMIT_MSG/COMMITS/
   BRANCHES/AUTHOR/GSEL) e as funções do motor (changes/stOf/gitInit/authorOf/
   commit[+commitGit]/stage/discard/checkout/gitMerge/isFlow/gfStart/gfFinish/gfGuide/
   gfPrompt/pickBranch/drawTimeline/graphLayout/openGraph) + o render do pane. Os
   CONSUMIDORES do motor ficam no monólito e lêem por global: `VIEW.graph` (grafo),
   `XC.git`/`git()` (terminal), `checkpoint`/`restoreCkpt`, `gfAsk` (co-dev), e
   `bridge.ts`/`pair.ts`.

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html). Publica no eval o estado (via `publish`) e, no fim, as
   funções do motor — os nomes livres do monólito resolvem no escopo GLOBAL em runtime.
   Nada é lido ansiosamente no eval (FS/AGENTS/… só são tocados DENTRO das funções, pelo
   bridge, depois do arranque). Os primitivos BRANCH/COMMIT_MSG/GSEL/AUTHOR são
   window-backed (o resíduo também os ESCREVE, ex. `AUTHOR='lead'` em runIssue), lidos
   e escritos pelos acessores do bridge.

   GOTCHA-commit preservado: o BOTÃO «Commit» usa `onclick="commit()"` → `window.commit`
   (v2, só FS+COMMITS). O onkeydown Ctrl+Enter e os auto-commits do monólito (co-dev,
   terminal, agentes) usam o commit v4 git-aware → publicado como `window.commitGit`. */

import { $, hd, svg, esc } from "../core";
import type { Commit, GitState, Status, GraphLayout, Author, FlowKind } from "./scm/domain/types";
import { computeGraphLayout } from "./scm/domain/graph";
import { statusOf, listChanges } from "./scm/domain/status";
import { resolveAuthor } from "./scm/domain/author";
import { isFlow, slug } from "./scm/domain/gitflow";
import {
  toast, log, rerender,
  files, agents, fIcon, short, rel,
  goPane, openTab, palette, refresh, termRefreshPrompt, panes,
  branch, setBranch, commitMsg, setCommitMsg, setGraphSel, author,
  publish,
} from "./scm/infrastructure/legacy-bridge";

/* ───── estado git/scm (window-backed via publish; o resíduo do monólito e as
   camadas v5/v6/bridge/pair aliasam estes nomes livres como globais) ───── */
const GIT: GitState = { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} };
const LANE = ["#e08a5b", "#6ea8ff", "#5cc9a7", "#c678dd", "#e0b64a", "#5fcad6", "#f1707a"];
const STAGED = new Set<string>();
const BRANCHES = ["main", "develop", "feat/learning-paths"];
const COMMITS: Array<{ h: string; m: string; n?: number }> = [
  { h: "c638e07", m: "feat(arch): persist the Studio design" },
  { h: "a5b0d39", m: "feat(arch): double-click a node to delete it" },
  { h: "64943bc", m: "feat(arch): interactive canvas" },
];
publish({ GIT, LANE, STAGED, BRANCHES, COMMITS, BRANCH: "main", COMMIT_MSG: "", GSEL: null, AUTHOR: "w" });

/* helper local (gémeo do monólito; isolado na feature) */
const rid = (): string => Math.random().toString(16).slice(2, 9);

/* ───── árvore de trabalho: wrappers finos sobre o domínio puro, injectando o `FS`
   (mantêm as assinaturas window que o golden e o monólito chamam) ───── */
const stOf = (p: string): Status => statusOf(files()[p], p);
const changes = (): string[] => listChanges(files());

/* ───── git: DAG de commits, árvores por ramo, merge ───── */
function gitInit(): void {
  Object.assign(GIT, { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} });
  const FS = files();
  const tree: Record<string, string> = {};
  Object.keys(FS).forEach((p) => { if (FS[p].orig != null) tree[p] = FS[p].orig as string; });
  const add = (h: string, m: string, p: string[], b: string, ago: number): void => {
    GIT.c[h] = { h, m, p, b, a: "w", t: Date.now() - ago * 3600e3, files: [] }; GIT.order.unshift(h);
  };
  add("1a2b3c4", "chore: commit inicial", [], "main", 420); add("d1e5f60", "feat(store): workspaces em SQLite", ["1a2b3c4"], "develop", 380); add("d2a7c91", "feat(desktop): painel do Co-Dev", ["d1e5f60"], "develop", 300);
  add("m2f0e11", "Merge release/0.2.0 em main", ["1a2b3c4", "d2a7c91"], "main", 290); add("d3b8d22", "chore: actualizar dependências", ["d2a7c91"], "develop", 200);
  add("l1c9e33", "feat(tutor): percursos de aprendizagem", ["d3b8d22"], "feature/learning-paths", 170); add("l2d0f44", "feat(tutor): progresso por percurso", ["l1c9e33"], "feature/learning-paths", 150);
  add("s164943", "feat(arch): interactive canvas", ["d3b8d22"], "feature/studio-canvas", 140); add("d4e1a55", "Merge feature/learning-paths em develop", ["d3b8d22", "l2d0f44"], "develop", 120);
  add("s2a5b0d", "feat(arch): double-click a node to delete it", ["s164943"], "feature/studio-canvas", 90); add("s3c638e", "feat(arch): persist the Studio design", ["s2a5b0d"], "feature/studio-canvas", 60);
  add("d5f2b66", "Merge feature/studio-canvas em develop", ["d4e1a55", "s3c638e"], "develop", 30);
  GIT.refs = { main: "m2f0e11", develop: "d5f2b66" }; GIT.tags = { m2f0e11: "v0.2.0", "1a2b3c4": "v0.1.0" }; GIT.trees = { main: { ...tree }, develop: { ...tree } };
  setBranch("develop"); const l = $("#st-branch-l"); if (l) l.textContent = branch();
  COMMITS.length = 0; GIT.order.slice(0, 6).forEach((h) => COMMITS.push({ h, m: GIT.c[h].m }));
}
const authorOf = (a: string): Author => resolveAuthor(a, agents());

/* commit v4 git-aware (actualiza o DAG, as árvores e as refs; aceita autor) */
function commit(msg?: string, author?: string): { h: string; m: string; n: number } | null {
  const FS = files();
  msg = msg || commitMsg().trim(); const list = (STAGED.size ? [...STAGED] : changes()).filter((p) => FS[p] && stOf(p));
  if (!list.length) { toast("Nada para commitar"); return null; }
  if (!msg) { toast("Escreve a mensagem de commit"); goPane("scm"); const i = $("#scm-msg"); if (i) i.focus(); return null; }
  const h = rid(), b = branch(), tr = GIT.trees[b]; list.forEach((p) => { FS[p].orig = FS[p].content; tr[p] = FS[p].content; }); STAGED.clear(); setCommitMsg("");
  GIT.c[h] = { h, m: msg, p: GIT.refs[b] ? [GIT.refs[b]] : [], b, a: author || window_author(), t: Date.now(), files: list.slice() }; GIT.order.unshift(h); GIT.refs[b] = h;
  const c = { h, m: msg, n: list.length }; COMMITS.unshift(c); refresh(false, true); toast(`Commit ${h} em ${b} · ${list.length} ficheiro(s)`); return c;
}
/* `AUTHOR` é window-backed (o resíduo escreve-o); lido no acto pelo bridge. */
const window_author = (): string => author();

function checkout(b: string, create?: boolean): boolean {
  const FS = files();
  if (create) { if (GIT.refs[b]) { toast("O ramo já existe: " + b); return false; } GIT.refs[b] = GIT.refs[branch()]; GIT.trees[b] = { ...GIT.trees[branch()] }; GIT.base[b] = { ...GIT.trees[branch()] }; }
  const tr = GIT.trees[b]; if (!tr) { toast("Ramo desconhecido: " + b); return false; } const dirty: Record<string, string> = {}; changes().forEach((p) => (dirty[p] = FS[p].content));
  Object.keys(FS).forEach((k) => { if (!/\/learn\//.test(k)) delete FS[k]; }); Object.keys(tr).forEach((p) => { FS[p] = { content: p in dirty ? dirty[p] : tr[p], orig: tr[p] }; }); Object.keys(dirty).forEach((p) => { if (!FS[p]) FS[p] = { content: dirty[p], orig: null }; });
  setBranch(b); $("#st-branch-l")!.textContent = b; STAGED.clear(); refresh(false, true); termRefreshPrompt(); return true;
}
function gitMerge(src: string, author?: string): Commit | null {
  const FS = files(); const dst = branch(), ts = GIT.trees[src], td = GIT.trees[dst]; if (!ts || src === dst) return null;
  const base = GIT.base[src + ">" + dst] || GIT.base[src] || {}, mfiles: string[] = [];
  Object.keys(ts).forEach((p) => { if (ts[p] !== td[p] && ts[p] !== base[p]) { td[p] = ts[p]; mfiles.push(p); if (FS[p] && stOf(p)) FS[p].orig = ts[p]; else FS[p] = { content: ts[p], orig: ts[p] }; } });
  const h = rid(); GIT.c[h] = { h, m: `Merge ${src} em ${dst}`, p: [GIT.refs[dst], GIT.refs[src]], b: dst, a: author || "w", t: Date.now(), files: mfiles }; GIT.order.unshift(h); GIT.refs[dst] = h; GIT.base[src + ">" + dst] = { ...ts }; COMMITS.unshift({ h, m: GIT.c[h].m }); refresh(false, true); return GIT.c[h];
}
function gfStart(kind: FlowKind, name: string): string {
  if (branch() !== "develop" && kind !== "hotfix") checkout("develop"); if (kind === "hotfix" && branch() !== "main") checkout("main");
  const b = kind + "/" + slug(name); GIT.refs[b] ? checkout(b) : checkout(b, true); log("gitflow", `início de ${b} a partir de ${kind === "hotfix" ? "main" : "develop"}`); return b;
}
function gfFinish(b?: string, author?: string): Commit | null {
  b = b || branch(); if (!isFlow(b) || !GIT.refs[b]) return null; let m: Commit | null;
  if (/^(release|hotfix)\//.test(b)) { checkout("main"); m = gitMerge(b, author); if (m) GIT.tags[m.h] = "v" + b.split("/")[1]; checkout("develop"); gitMerge(b, author); } else { checkout("develop"); m = gitMerge(b, author); }
  delete GIT.refs[b]; delete GIT.trees[b]; refresh(false, true); log("gitflow", `fim de ${b}: merge ${/^(release|hotfix)/.test(b) ? "em main (com tag) e develop" : "em develop"}`); rerender("graph"); return m;
}
function gfPrompt(kind: FlowKind): void {
  palette("", { ph: kind === "release" ? "Versão da release (ex.: 0.3.0)" : `Nome da ${kind} (ex.: exportar-relatorio)`, verb: "Iniciar " + kind, text: (q: string) => { if (!q.trim()) return; gfStart(kind, q.trim()); toast("Ramo criado: " + branch()); rerender("graph"); } });
}
function gfGuide(): string {
  const b = branch(), n = changes().length, step = (ok: number | boolean, t: string): string => `<div class="gf-s${ok ? " ok" : ""}"><span>${ok ? "✓" : "○"}</span><div>${t}</div></div>`;
  if (/^(feature|fix)\//.test(b)) { const ahead = GIT.c[GIT.refs[b]].b === b; return step(1, `Ramo <b>${esc(b)}</b> criado a partir de develop`) + step(ahead && !n, ahead ? (n ? `${n} alteração(ões) por commitar` : "Trabalho commitado no ramo") : "Faz o primeiro commit neste ramo") + step(0, "Finalizar: merge em develop e apagar o ramo") + `<button class="btn" onclick="gfFinish()&&toast('Merge em develop feito')">Finalizar ${esc(b.split("/")[0])}</button>`; }
  if (/^(release|hotfix)\//.test(b)) return step(1, `Ramo <b>${esc(b)}</b>`) + step(0, "Finalizar: merge em main com tag e de volta a develop") + `<button class="btn" onclick="gfFinish()&&toast('Release publicada em main')">Finalizar ${esc(b.split("/")[0])}</button>`;
  if (b === "develop") return `<div class="sec-empty">Em <b>develop</b>: cada tarefa começa num ramo próprio.</div><button class="btn ghost" onclick="gfPrompt('feature')">Iniciar feature…</button><button class="btn ghost" onclick="gfPrompt('fix')">Iniciar fix…</button><button class="btn ghost" onclick="gfPrompt('release')">Iniciar release…</button>`;
  return `<div class="sec-empty"><b>main</b> só recebe releases e hotfixes.</div><button class="btn ghost" onclick="checkout('develop')">Ir para develop</button><button class="btn ghost" onclick="gfPrompt('hotfix')">Iniciar hotfix…</button>`;
}
function pickBranch(): void {
  palette("", { ph: "Mudar de ramo…", items: Object.keys(GIT.refs).map((b) => ({ l: b, d: b === branch() ? "actual" : GIT.c[GIT.refs[b]].m, run: () => { checkout(b); toast("Ramo: " + b); rerender("graph"); } })) });
}
function drawTimeline(): void {
  const o = $("#timeline"); if (!o) return;
  o.innerHTML = GIT.order.slice(0, 6).map((h) => `<div class="s-hit" style="padding-left:16px" onclick="openGraph('${h}')"><span style="color:var(--accent-hover)">${h}</span><span>${esc(GIT.c[h].m)}</span></div>`).join("");
}
const graphLayout = (): GraphLayout => computeGraphLayout(GIT);
function openGraph(sel?: string): void { if (sel) setGraphSel(sel); openTab({ id: "graph", title: "Grafo de commits", kind: "graph" }); }

/* ───── acções do pane Source Control ───── */
function stage(p: string): void { STAGED.has(p) ? STAGED.delete(p) : STAGED.add(p); panes().scm(); }
function discard(p: string): void { const FS = files(); const f = FS[p]; if (f.orig == null) delete FS[p]; else f.content = f.orig; STAGED.delete(p); refresh(); toast("Alterações descartadas: " + p.split("/").pop()); }
/* commit v2 (botão «Commit»): só carimba FS.orig + COMMITS, sem tocar no DAG */
function commitV2(msg?: string): { h: string; m: string; n: number } | null {
  const FS = files();
  msg = msg || commitMsg().trim(); const list = (STAGED.size ? [...STAGED] : changes()).filter((p) => FS[p] && stOf(p));
  if (!list.length) { toast("Nada para commitar"); return null; } if (!msg) { toast("Escreve a mensagem de commit"); goPane("scm"); const i = $("#scm-msg"); if (i) i.focus(); return null; }
  list.forEach((p) => { FS[p].orig = FS[p].content; }); STAGED.clear(); setCommitMsg(""); const c = { h: Math.random().toString(16).slice(2, 9), m: msg, n: list.length }; COMMITS.unshift(c); refresh(false, true); drawTimeline(); toast(`Commit ${c.h} · ${list.length} ficheiro(s)`); return c;
}

/** Renderiza o pane «Source Control»: mensagem de commit, staged/alterações,
 *  próximo passo gitflow, ramos e commits recentes. */
function renderScmPane(): void {
  const el = $("#pane-scm"), ch = changes(), st = ch.filter((p) => STAGED.has(p)), un = ch.filter((p) => !STAGED.has(p)), lay = graphLayout();
  if (!el) return;
  const b = branch();
  const row = (p: string, s: number): string => `<div class="scm-row" onclick="openDiff('${p}')">${fIcon(p)}<span class="nm">${esc(p.split("/").pop())}</span><span class="pth">${esc(short(p).split("/").slice(0, -1).join("/"))}</span><span class="ra"><button title="Abrir ficheiro" onclick="event.stopPropagation();openPath('${p}')">↗</button><button title="Descartar" onclick="event.stopPropagation();discard('${p}')">↶</button><button title="${s ? "Retirar do stage" : "Stage"}" onclick="event.stopPropagation();stage('${p}')">${s ? "−" : "+"}</button></span><span class="g ${stOf(p)}">${stOf(p)}</span></div>`;
  el.innerHTML = hd("Source Control", `<button title="Grafo de commits" onclick="openGraph()">${svg("graph")}</button><button title="Actualizar" onclick="refresh()">${svg("refresh")}</button>`) + `<div class="sections"><div class="scm-grp">dxtutor · ${esc(b)}<span class="cnt">${ch.length}</span></div>
    <input class="inp" id="scm-msg" placeholder="Mensagem de commit" value="${esc(commitMsg())}"><button class="btn" onclick="commit()">✓ Commit${st.length ? " (staged)" : ""} em ${esc(b)}</button>
    ${st.length ? `<div class="scm-grp">Staged<span class="cnt">${st.length}</span></div>` + st.map((p) => row(p, 1)).join("") : ""}<div class="scm-grp">Alterações<span class="cnt">${un.length}</span></div>${un.map((p) => row(p, 0)).join("") || '<div class="sec-empty">Área de trabalho limpa.</div>'}
    <div class="scm-grp">Gitflow — próximo passo</div>${gfGuide()}
    <div class="scm-grp">Ramos<span class="cnt">${Object.keys(GIT.refs).length}</span></div>${Object.keys(GIT.refs).map((rb) => { const r = lay.rows.find((x) => x.h === GIT.refs[rb]); return `<div class="scm-row" onclick="checkout('${rb}')"><span class="pdot" style="background:${LANE[(r ? r.col : 0) % LANE.length]}"></span><span class="nm" style="max-width:none${rb === b ? ";font-weight:600" : ""}">${esc(rb)}</span>${rb === b ? '<span class="tag acc" style="margin-left:auto">HEAD</span>' : ""}</div>`; }).join("")}
    <div class="scm-grp">Commits</div>${GIT.order.slice(0, 7).map((h) => { const c = GIT.c[h], a = authorOf(c.a); return `<div class="s-hit" style="padding-left:12px" onclick="openGraph('${h}')" title="${esc(a.n)} · ${rel(c.t)}"><span class="pdot" style="background:${a.col}"></span><span style="color:var(--accent-hover)">${h}</span><span>${esc(c.m)}</span></div>`; }).join("")}<button class="btn ghost" onclick="openGraph()">Abrir grafo de commits</button></div>`;
  const i = $("#scm-msg") as HTMLInputElement | null;
  if (i) { i.oninput = () => { setCommitMsg(i.value); }; i.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commit(); }; }
}

/* ── publicação no window (via bridge): nomes que o resíduo (app.ts/v5/v6/bridge/
   pair), os onclick inline e os consumidores VIEW.graph/XC.git/checkpoint resolvem
   como globais. RP.scm (app.ts) delega em renderScmPane (lazy, no switch de pane).
   `commit` v2 (botão) e `commitGit` v4 git-aware ficam distintos (GOTCHA-commit). ── */
publish({
  commitGit: commit, commit: commitV2, checkout, gitMerge, gfFinish,
  gitInit, authorOf, stOf, changes, isFlow, gfStart, gfPrompt, gfGuide,
  pickBranch, drawTimeline, graphLayout, openGraph, stage, discard,
  renderScmPane,
});
