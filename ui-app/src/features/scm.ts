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

   ADR-0006, R1d — sem git simulado: saíram o histórico semeado do `gitInit`, a lista
   fixa de ramos `BRANCHES` (main/develop/feat/learning-paths) e os três commits fixos de
   `COMMITS`. Sem repositório git real aberto, o pane diz isso (no desktop com pasta, com
   um botão `git init`) e o motor recusa mudar o git; com repo, o `bridge.ts` liga tudo ao
   git real.

   Fronteira: a feature DETÉM o estado (GIT/LANE/STAGED/BRANCH/COMMIT_MSG/COMMITS/
   AUTHOR/GSEL). Os CONSUMIDORES do motor ficam no monólito e lêem por
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
import { RP } from "../app/store/registry";
import type { GitState, Status, GraphLayout, Author, FlowKind } from "./scm/domain/types";
import { computeGraphLayout } from "./scm/domain/graph";
import { statusOf, listChanges } from "./scm/domain/status";
import { resolveAuthor } from "./scm/domain/author";
import { isFlow } from "./scm/domain/gitflow";
import { makeScmEngine, NO_REPO } from "./scm/application/scm-engine";
import type { CommitResult, MergeResult } from "./scm/application/ports";
import { desktopPorts } from "../app/desktop";
import { bindActions, type ActionTable } from "./scm/ui/actions";
import { translator } from "../app/i18n";
import { SCM_MESSAGES } from "./scm/ui/messages";
import { GIT_MESSAGES } from "./scm/ui/git-messages";
import { GIT_ACTIONS, sideSections } from "./scm/extras";
import {
  toast, log, rerender,
  files, agents, fIcon, short, rel,
  goPane, openTab, palette, refresh, termRefreshPrompt, panes,
  branch, setBranch, commitMsg, setCommitMsg, setGraphSel, author,
  openDiff, openPath, publish,
  repo, desktopFolder, gitInitFolder, decoratedCheckout, decoratedMerge,
} from "./scm/infrastructure/legacy-bridge";

/* ───── estado git/scm (window-backed via publish; o resíduo do monólito e as
   camadas v5/v6/bridge/pair aliasam estes nomes livres como globais) ───── */
const GIT: GitState = { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} };
const LANE = ["#e08a5b", "#6ea8ff", "#5cc9a7", "#c678dd", "#e0b64a", "#5fcad6", "#f1707a"];
const STAGED = new Set<string>();
const COMMITS: Array<{ h: string; m: string; n?: number }> = [];
publish({ GIT, LANE, STAGED, COMMITS, BRANCH: "", COMMIT_MSG: "", GSEL: null, AUTHOR: "w" });

/* ───── wrappers de domínio: mantêm as assinaturas window que o golden e o monólito
   chamam, injectando o `FS`/`AGENTS`/`GIT` vivos ───── */
const stOf = (p: string): Status => statusOf(files()[p], p);
const changes = (): string[] => listChanges(files());
const authorOf = (a: string): Author => resolveAuthor(a, agents());
const graphLayout = (): GraphLayout => computeGraphLayout(GIT);

/* mini-timeline (DOM): dono do resíduo; injectada no motor como `view.drawTimeline` */
function drawTimeline(): void {
  const o = $("#timeline"); if (!o) return;
  o.innerHTML = GIT.order.slice(0, 6).map((h) => `<div class="s-hit" style="padding-left:16px" data-action="open-graph-sel" data-on="${esc(h)}"><span style="color:var(--accent-hover)">${h}</span><span>${esc(GIT.c[h].m)}</span></div>`).join("");
}

/* ───── raiz de composição: liga os adaptadores do bridge (infra) às portas do motor
   (application). O motor fica puro; o `window`/DOM ficam deste lado. A etiqueta de
   ramo (#st-branch-l) actualiza-se no adaptador `store.setBranch`. ───── */
const { gitInit, commit, commitV2, checkout, gitMerge, gfStart, gfFinish, stage, discard } = makeScmEngine({
  workspace: { files: () => files() },
  store: {
    repo: () => repo(),
    git: () => GIT,
    staged: () => STAGED,
    commits: () => COMMITS,
    branch: () => branch(),
    setBranch: (b) => { setBranch(b); const l = $("#st-branch-l"); if (l) l.textContent = b; },
    commitMsg: () => commitMsg(),
    setCommitMsg: (m) => setCommitMsg(m),
    author: () => author(),
  },
  flow: { checkout: (b, c) => decoratedCheckout(b, c), merge: (s, a) => decoratedMerge(s, a) },
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

/* ───── a parte desktop (ADR-0004, U4h2) ─────
   As versões PUBLICADAS do commit (o v2 do botão e o v4 `commitGit`), checkout, gitMerge,
   gfStart e gfFinish consultam a porta desktop (`desktopPorts.scm`, injectada por
   platform/desktop/git.ts na app Tauri) — antes o desktop reatribuía-as no `window`.
   A0.5 (docs/v2/UI-AUDIT.md): as acções do pane, a paleta de ramos, o prompt de gitflow e o
   Ctrl+Enter passam a usar estas versões, por isso no desktop vão ao git real (era o bug
   aberto desde f07dbc1). Dentro do motor, gfStart/gfFinish chamam o checkout/merge locais;
   no desktop a porta refaz a operação com os globais publicados. Desde o ADR-0006 (R1d, «git
   só real») o motor encadeia esse checkout/merge pela porta `flow`, ligada às versões
   publicadas, e sem repositório recusa em vez de inventar commits. */
const commitPublished = (msg?: string, author?: string): CommitResult | null => { const d = desktopPorts.scm; return d ? d.commit(msg, author, commitV2) : commitV2(msg); };
/* o commit v4 git-aware (board, terminal, agentes) passa pela MESMA porta que o botão: no
   desktop com repo, commit real (antes ficava só no espelho em memória — ADR-0006, R1d). */
const commitGitPublished = (msg?: string, author?: string): CommitResult | null => { const d = desktopPorts.scm; return d ? d.commit(msg, author, commit) : commit(msg, author); };
const checkoutPublished = (b: string, create?: boolean): boolean => { const d = desktopPorts.scm; return d ? d.checkout(b, create, checkout) : checkout(b, create); };
const gitMergePublished = (src: string, author?: string): MergeResult | null => { const d = desktopPorts.scm; return d ? d.gitMerge(src, author, gitMerge) : gitMerge(src, author); };
const gfStartPublished = (kind: string, name: string): string => { const d = desktopPorts.scm; return d ? d.gfStart(kind, name, gfStart) : gfStart(kind, name); };
const gfFinishPublished = (b?: string, author?: string): MergeResult | null => { const d = desktopPorts.scm; return d ? d.gfFinish(b, author, gfFinish) : gfFinish(b, author); };

/* ───── UI que abre a paleta (prompts gitflow / mudar de ramo) — chama o motor ───── */
function gfPrompt(kind: FlowKind): void {
  palette("", { ph: kind === "release" ? "Versão da release (ex.: 0.3.0)" : `Nome da ${kind} (ex.: exportar-relatorio)`, verb: "Iniciar " + kind, text: (q: string) => { if (!q.trim()) return; if (!gfStartPublished(kind, q.trim())) return; toast("Ramo criado: " + branch()); rerender("graph"); } });
}
function pickBranch(): void {
  if (!repo()) { toast(NO_REPO); return; }
  palette("", { ph: "Mudar de ramo…", items: Object.keys(GIT.refs).map((b) => ({ l: b, d: b === branch() ? "actual" : GIT.c[GIT.refs[b]].m, run: () => { checkoutPublished(b); toast("Ramo: " + b); rerender("graph"); } })) });
}
function gfGuide(): string {
  const b = branch(), n = changes().length, step = (ok: number | boolean, t: string): string => `<div class="gf-s${ok ? " ok" : ""}"><span>${ok ? "✓" : "○"}</span><div>${t}</div></div>`;
  if (/^(feature|fix)\//.test(b)) { const ahead = GIT.c[GIT.refs[b]].b === b; return step(1, `Ramo <b>${esc(b)}</b> criado a partir de develop`) + step(ahead && !n, ahead ? (n ? `${n} alteração(ões) por commitar` : "Trabalho commitado no ramo") : "Faz o primeiro commit neste ramo") + step(0, "Finalizar: merge em develop e apagar o ramo") + `<button class="btn" data-action="gf-finish-feature">Finalizar ${esc(b.split("/")[0])}</button>`; }
  if (/^(release|hotfix)\//.test(b)) return step(1, `Ramo <b>${esc(b)}</b>`) + step(0, "Finalizar: merge em main com tag e de volta a develop") + `<button class="btn" data-action="gf-finish-release">Finalizar ${esc(b.split("/")[0])}</button>`;
  if (b === "develop") return `<div class="sec-empty">Em <b>develop</b>: cada tarefa começa num ramo próprio.</div><button class="btn ghost" data-action="gf-prompt" data-on="feature">Iniciar feature…</button><button class="btn ghost" data-action="gf-prompt" data-on="fix">Iniciar fix…</button><button class="btn ghost" data-action="gf-prompt" data-on="release">Iniciar release…</button>`;
  return `<div class="sec-empty"><b>main</b> só recebe releases e hotfixes.</div><button class="btn ghost" data-action="checkout" data-on="develop">Ir para develop</button><button class="btn ghost" data-action="gf-prompt" data-on="hotfix">Iniciar hotfix…</button>`;
}
function openGraph(sel?: string): void { if (sel) setGraphSel(sel); openTab({ id: "graph", title: "Grafo de commits", kind: "graph" }); }

/** Renderiza o pane «Source Control»: mensagem de commit, staged/alterações,
 *  próximo passo gitflow, ramos e commits recentes. */
/** Os textos do pane vêm do catálogo (ADR-0004, U6b — o piloto dos textos por chave). */
const t = translator(SCM_MESSAGES);
const tg = translator(GIT_MESSAGES);
function renderScmPane(): void {
  const el = $("#pane-scm"), ch = changes(), st = ch.filter((p) => STAGED.has(p)), un = ch.filter((p) => !STAGED.has(p)), lay = graphLayout();
  if (!el) return;
  if (!repo()) {
    const folder = desktopFolder();
    el.innerHTML = hd(t("title"), "") + `<div class="sections"><div class="sec-empty">${tg(folder ? "notARepo" : "noRepo")}</div>${folder ? '<button class="btn" data-action="git-init">git init</button>' : ""}</div>`;
    return;
  }
  const b = branch();
  const row = (p: string, s: number): string => `<div class="scm-row" data-action="open-diff" data-on="${esc(p)}">${fIcon(p)}<span class="nm">${esc(p.split("/").pop())}</span><span class="pth">${esc(short(p).split("/").slice(0, -1).join("/"))}</span><span class="ra"><button title="${t("openFile")}" data-action="open-path" data-on="${esc(p)}">↗</button><button title="${t("discard")}" data-action="discard" data-on="${esc(p)}">↶</button><button title="${s ? t("unstage") : "Stage"}" data-action="stage" data-on="${esc(p)}">${s ? "−" : "+"}</button></span><span class="g ${stOf(p)}">${stOf(p)}</span></div>`;
  el.innerHTML = hd(t("title"), `<button title="${t("graph")}" data-action="open-graph">${svg("graph")}</button><button title="${t("refresh")}" data-action="refresh">${svg("refresh")}</button>`) + `<div class="sections"><div class="scm-grp">dxtutor · ${esc(b)}<span class="cnt">${ch.length}</span></div>
    <input class="inp" id="scm-msg" placeholder="${t("message")}" value="${esc(commitMsg())}"><button class="btn" data-action="commit">${t("commit", { staged: st.length ? " (staged)" : "", branch: esc(b) })}</button>
    ${st.length ? `<div class="scm-grp">${t("staged")}<span class="cnt">${st.length}</span></div>` + st.map((p) => row(p, 1)).join("") : ""}<div class="scm-grp">${t("changes")}<span class="cnt">${un.length}</span></div>${un.map((p) => row(p, 0)).join("") || `<div class="sec-empty">${t("clean")}</div>`}
    <div class="scm-grp">${t("gitflowNext")}</div>${gfGuide()}
    <div class="scm-grp">${t("branches")}<span class="cnt">${Object.keys(GIT.refs).length}</span></div>${Object.keys(GIT.refs).map((rb) => { const r = lay.rows.find((x) => x.h === GIT.refs[rb]); return `<div class="scm-row" data-action="checkout" data-on="${esc(rb)}"><span class="pdot" style="background:${LANE[(r ? r.col : 0) % LANE.length]}"></span><span class="nm" style="max-width:none${rb === b ? ";font-weight:600" : ""}">${esc(rb)}</span>${rb === b ? '<span class="tag acc" style="margin-left:auto">HEAD</span>' : ""}</div>`; }).join("")}
    <div class="scm-grp">${t("commits")}</div>${GIT.order.slice(0, 7).map((h) => { const c = GIT.c[h], a = authorOf(c.a); return `<div class="s-hit" style="padding-left:12px" data-action="open-graph-sel" data-on="${esc(h)}" title="${esc(a.n)} · ${rel(c.t)}"><span class="pdot" style="background:${a.col}"></span><span style="color:var(--accent-hover)">${h}</span><span>${esc(c.m)}</span></div>`; }).join("")}<button class="btn ghost" data-action="open-graph">${t("openGraph")}</button>${sideSections()}</div>`;
  const i = $("#scm-msg") as HTMLInputElement | null;
  if (i) { i.oninput = () => { setCommitMsg(i.value); }; i.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitGitPublished(); }; }
}

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` pelo markup de renderScmPane/
   gfGuide/drawTimeline) ao efeito. Fica aqui — no resíduo de composição, fora da
   subárvore governada por A7/A8 — porque só este ficheiro tem à mão o motor e o
   bridge. Todos os handlers são `click`. O payload viaja SÓ em `data-on` (o golden
   strippa data-action/data-on; um `data-*` à medida vazava). Os caminhos/ramos/hashes
   escapam-se com `esc` à saída (eram interpolados crus em literais JS dentro do
   `onclick` — o vector de injecção que o ADR apontou); nos dados actuais (caminhos de
   ficheiro, ramos gitflow, hashes hex) `esc` é no-op, logo a saída visível não muda.
     • open-graph / open-graph-sel — abre o grafo (sel = hash no data-on)
     • refresh / commit            — actualizar / commit v2 (window.commit)
     • open-diff/open-path/discard/stage — acções por ficheiro (data-on = caminho)
     • checkout                    — mudar de ramo (data-on = ramo)
     • gf-prompt                   — prompt gitflow (data-on = feature|fix|release|hotfix)
     • gf-finish-feature/-release  — finalizar o ramo e dar o toast respectivo
     • git-init                    — `git init` na pasta aberta (desktop, sem repo)
   `gf-finish-*` reproduz `gfFinish()&&toast(…)`: só dá o toast se o merge devolveu
   um commit (não-null), como o `&&` original. */
const ACTIONS: ActionTable = {
  "open-graph": { on: "click", run: () => openGraph() },
  "open-graph-sel": { on: "click", run: (e) => openGraph(e.on) },
  refresh: { on: "click", run: () => refresh() },
  commit: { on: "click", run: () => commitPublished() },
  "open-diff": { on: "click", run: (e) => openDiff(e.on) },
  "open-path": { on: "click", run: (e) => openPath(e.on) },
  discard: { on: "click", run: (e) => discard(e.on) },
  stage: { on: "click", run: (e) => stage(e.on) },
  checkout: { on: "click", run: (e) => checkoutPublished(e.on) },
  "gf-prompt": { on: "click", run: (e) => gfPrompt(e.on as FlowKind) },
  "gf-finish-feature": { on: "click", run: () => { if (gfFinishPublished()) toast("Merge em develop feito"); } },
  "gf-finish-release": { on: "click", run: () => { if (gfFinishPublished()) toast("Release publicada em main"); } },
  "git-init": { on: "click", run: () => gitInitFolder() },
};
/* A4 (docs/v2/UI-AUDIT.md item 9): as acções `gx-*` do trabalho git novo (features/scm/extras.ts) */
bindActions({ ...ACTIONS, ...GIT_ACTIONS });

/* ── publicação no window (via bridge): nomes que o resíduo (app.ts/v5/v6/bridge/
   pair) e os consumidores VIEW.graph/XC.git/checkpoint resolvem como globais. RP.scm
   (app.ts) delega em renderScmPane (lazy, no switch de pane). `commit` v2 (botão) e
   `commitGit` v4 git-aware ficam distintos (GOTCHA-commit). ── */
publish({
  commitGit: commitGitPublished, commit: commitPublished, checkout: checkoutPublished, gitMerge: gitMergePublished, gfFinish: gfFinishPublished,
  gitInit, authorOf, stOf, changes, isFlow, gfStart: gfStartPublished, gfPrompt, gfGuide,
  pickBranch, drawTimeline, graphLayout, openGraph, stage, discard,
  renderScmPane,
});
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.scm = renderScmPane;
