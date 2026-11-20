/* ═════════ dxtutor IDE — feature: Source Control + motor git (resíduo + composição) ═════════
   Feature-folha DONA de todo o motor git/scm (padrão da sessão Debug: inversão de
   direcção — o par render+motor, antes espalhado por `app.ts`, vive inteiro aqui).

   ADR-0002 (Clean Architecture). Estado actual:
   - Fase 1 — `window.*` confinado a `features/scm/infrastructure/legacy-bridge.ts`;
     este ficheiro deixou de ser `@ts-nocheck`.
   - Fase 2 — domínio puro em `features/scm/domain/` (graph/status/gitflow/author).
   - Fase 3 — a orquestração (gitInit/commit/commitV2/checkout/gitMerge/gfStart/
     gfFinish/stage/discard) saiu para `features/scm/application/scm-engine.ts`, com
     deps injectadas por porta (`application/ports.ts`). Este ficheiro deixou de a
     conter: COMPÕE o motor com os adaptadores do bridge, é DONO do DOM (gfGuide/
     gfPrompt/pickBranch/drawTimeline/renderScmPane/openGraph) e RE-PUBLICA a
     superfície no `window`.

   Fronteira: a feature DETÉM o estado (GIT/LANE/STAGED/BRANCH/COMMIT_MSG/COMMITS/
   BRANCHES/AUTHOR/GSEL). Os CONSUMIDORES do motor ficam no monólito e lêem por
   global: `VIEW.graph` (grafo), `XC.git`/`git()` (terminal), `checkpoint`/`restoreCkpt`,
   `gfAsk` (co-dev), e `bridge.ts`/`pair.ts`.

   Mecânica: esta feature avalia ANTES de `app.ts` (ordem do index.html). Publica no
   eval o estado (via `publish`) e, no fim, as funções — os nomes livres do monólito
   resolvem no escopo GLOBAL em runtime. Nada é lido ansiosamente no eval (FS/AGENTS/…
   só são tocados DENTRO das funções, pelo bridge, depois do arranque). Os primitivos
   BRANCH/COMMIT_MSG/GSEL/AUTHOR são window-backed (o resíduo também os ESCREVE).

   GOTCHA-commit preservado: o BOTÃO «Commit» usa `onclick="commit()"` → `window.commit`
   (v2, só FS+COMMITS). O onkeydown Ctrl+Enter e os auto-commits do monólito (co-dev,
   terminal, agentes) usam o commit v4 git-aware → publicado como `window.commitGit`. */

import { $, hd, svg, esc } from "../core";
import type { GitState, Status, GraphLayout, Author, FlowKind } from "./scm/domain/types";
import { computeGraphLayout } from "./scm/domain/graph";
import { statusOf, listChanges } from "./scm/domain/status";
import { resolveAuthor } from "./scm/domain/author";
import { isFlow } from "./scm/domain/gitflow";
import { makeScmEngine } from "./scm/application/scm-engine";
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

/* ───── wrappers de domínio: mantêm as assinaturas window que o golden e o monólito
   chamam, injectando o `FS`/`AGENTS`/`GIT` vivos ───── */
const stOf = (p: string): Status => statusOf(files()[p], p);
const changes = (): string[] => listChanges(files());
const authorOf = (a: string): Author => resolveAuthor(a, agents());
const graphLayout = (): GraphLayout => computeGraphLayout(GIT);

/* mini-timeline (DOM): dono do resíduo; injectada no motor como `view.drawTimeline` */
function drawTimeline(): void {
  const o = $("#timeline"); if (!o) return;
  o.innerHTML = GIT.order.slice(0, 6).map((h) => `<div class="s-hit" style="padding-left:16px" onclick="openGraph('${h}')"><span style="color:var(--accent-hover)">${h}</span><span>${esc(GIT.c[h].m)}</span></div>`).join("");
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) às portas do motor
   (application). O motor fica puro; o `window`/DOM ficam deste lado. A etiqueta de
   ramo (#st-branch-l) actualiza-se no adaptador `store.setBranch`. ───── */
const { gitInit, commit, commitV2, checkout, gitMerge, gfStart, gfFinish, stage, discard } = makeScmEngine({
  workspace: { files: () => files() },
  store: {
    git: () => GIT,
    staged: () => STAGED,
    commits: () => COMMITS,
    branch: () => branch(),
    setBranch: (b) => { setBranch(b); const l = $("#st-branch-l"); if (l) l.textContent = b; },
    commitMsg: () => commitMsg(),
    setCommitMsg: (m) => setCommitMsg(m),
    author: () => author(),
  },
  notifier: { toast: (m) => toast(m) },
  logger: { log: (s, m) => log(s, m) },
  view: {
    refresh: (...a: [boolean?, boolean?]) => { refresh(...a); },
    rerender: (kind) => rerender(kind),
    rerenderPane: () => panes().scm(),
    drawTimeline: () => drawTimeline(),
    focusCommitInput: () => { goPane("scm"); const i = $("#scm-msg"); if (i) i.focus(); },
  },
  terminal: { refreshPrompt: () => termRefreshPrompt() },
  clock: { now: () => Date.now() },
  ids: { next: () => Math.random().toString(16).slice(2, 9) },
});

/* ───── UI que abre a paleta (prompts gitflow / mudar de ramo) — chama o motor ───── */
function gfPrompt(kind: FlowKind): void {
  palette("", { ph: kind === "release" ? "Versão da release (ex.: 0.3.0)" : `Nome da ${kind} (ex.: exportar-relatorio)`, verb: "Iniciar " + kind, text: (q: string) => { if (!q.trim()) return; gfStart(kind, q.trim()); toast("Ramo criado: " + branch()); rerender("graph"); } });
}
function pickBranch(): void {
  palette("", { ph: "Mudar de ramo…", items: Object.keys(GIT.refs).map((b) => ({ l: b, d: b === branch() ? "actual" : GIT.c[GIT.refs[b]].m, run: () => { checkout(b); toast("Ramo: " + b); rerender("graph"); } })) });
}
function gfGuide(): string {
  const b = branch(), n = changes().length, step = (ok: number | boolean, t: string): string => `<div class="gf-s${ok ? " ok" : ""}"><span>${ok ? "✓" : "○"}</span><div>${t}</div></div>`;
  if (/^(feature|fix)\//.test(b)) { const ahead = GIT.c[GIT.refs[b]].b === b; return step(1, `Ramo <b>${esc(b)}</b> criado a partir de develop`) + step(ahead && !n, ahead ? (n ? `${n} alteração(ões) por commitar` : "Trabalho commitado no ramo") : "Faz o primeiro commit neste ramo") + step(0, "Finalizar: merge em develop e apagar o ramo") + `<button class="btn" onclick="gfFinish()&&toast('Merge em develop feito')">Finalizar ${esc(b.split("/")[0])}</button>`; }
  if (/^(release|hotfix)\//.test(b)) return step(1, `Ramo <b>${esc(b)}</b>`) + step(0, "Finalizar: merge em main com tag e de volta a develop") + `<button class="btn" onclick="gfFinish()&&toast('Release publicada em main')">Finalizar ${esc(b.split("/")[0])}</button>`;
  if (b === "develop") return `<div class="sec-empty">Em <b>develop</b>: cada tarefa começa num ramo próprio.</div><button class="btn ghost" onclick="gfPrompt('feature')">Iniciar feature…</button><button class="btn ghost" onclick="gfPrompt('fix')">Iniciar fix…</button><button class="btn ghost" onclick="gfPrompt('release')">Iniciar release…</button>`;
  return `<div class="sec-empty"><b>main</b> só recebe releases e hotfixes.</div><button class="btn ghost" onclick="checkout('develop')">Ir para develop</button><button class="btn ghost" onclick="gfPrompt('hotfix')">Iniciar hotfix…</button>`;
}
function openGraph(sel?: string): void { if (sel) setGraphSel(sel); openTab({ id: "graph", title: "Grafo de commits", kind: "graph" }); }

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
