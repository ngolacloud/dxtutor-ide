/* ═════════ dxtutor IDE — feature: backlog, sprints e kanban (resíduo + composição) ═════════
   Feature DONA do seu estado (BL/STAGES) e do corpo da vista (renderBoardView); COMPÕE o
   motor dos casos de uso (runner/CRUD/produtor) com os adaptadores do bridge.

   ADR-0002 (Clean Architecture). Estado actual:
   - Fase 1 — `window.*` confinado a `features/board/infrastructure/legacy-bridge.ts`;
     este ficheiro deixou de ser `@ts-nocheck`.
   - Fase 2 — domínio puro em `features/board/domain/` (slug/issue/kanban).
   - Fase 3 — a orquestração (mkIssue/setStage/autoTest/runIssue/delegate/runSprint/
     approveIssue/rejectIssue/dropIssue/newIssue/openBoard/genBacklog/genBacklogIssues)
     saiu para `features/board/application/board-engine.ts`, com deps injectadas por porta
     (`application/ports.ts`). Este ficheiro COMPÕE o motor com os adaptadores do bridge, é
     DONO do DOM (renderBoardView) e do estado (BL/STAGES), e RE-PUBLICA a superfície.

   Fronteira (decisão do dono «geradores FICAM»): os GERADORES de projecto (composeYaml/
   appFiles/k8sYaml/cloudMap/k8sInfra) e o catálogo do Studio (TECH/KIND/CLOUD/isApp/sl/
   appDir) FICAM donos do monólito e são lidos por global (através do bridge). Os
   DECORADORES do runner ficam onde estão: app.ts (approveIssue+infra), v5.ts (approveIssue/
   delegate/runSprint — codeGuard/review), v6.ts (runIssue custo, delegate/approveIssue
   ownership, VIEW.board duplo-clique+custo).

   Mecânica: avalia ANTES de `app.ts` (ordem do index.html). Publica o estado (via `publish`)
   e, no fim, as funções — os nomes livres do monólito resolvem no escopo GLOBAL em runtime.
   Nada é lido ansiosamente no eval (FS/AGENTS/… só são tocados DENTRO das funções, pelo
   bridge, depois do arranque). BL/STAGES são window-backed (o resíduo é dono).

   GOTCHA-decoração: runIssue/delegate/runSprint/approveIssue são DECORADAS pelo monólito
   depois de publicadas; as arestas internas passam pela porta `orchestration` → versão
   DECORADA por window (decoratedRunIssue/decoratedApproveIssue). VIEW.board fica como shim
   brace-less em app.ts a delegar em renderBoardView. */

import { esc } from "../core";
import type { Backlog } from "./board/domain/types";
import { STAGES } from "./board/domain/issue";
import { inView, points, autoSprint } from "./board/domain/kanban";
import { makeBoardEngine } from "./board/application/board-engine";
import { bindActions, type ActionTable } from "./board/ui/actions";
import {
  backlog, design, saveDesign, files, agents, provs, taskProfiles,
  run, setAuthor, branch, setAgent, pane, mode, panes, root, stopSignal,
  git, staged, gfStart, gfFinish, commitGit, checkout, stOf,
  validateDesign, tech, kindTable, cloudTable, isApp, nodeSlug, appDir,
  composeYaml, appFiles, k8sYaml, k8sInfra, cloudMap, has,
  card, tl, ask, beat, sleep, user, note, runLabel, runState, focusAgent, agentPill, handlePrompt, scrollMsgs,
  routeModel, use,
  echo, echoCmd, newInput, setPanelTab, getVar, runTests, dsLint, doTool,
  inScope, ownerOf, short,
  openTab, openStudio, palette, refresh,
  toast, log, rerender,
  decoratedRunIssue, decoratedApproveIssue, decoratedDelegate, decoratedRunSprint, publish,
} from "./board/infrastructure/legacy-bridge";

/* estado — window-backed (publicado via bridge; onclick inline `BL.view=…` resolve em
   window.BL no escopo global). BL é sessão em memória, não vem de LS. STAGES vem do
   domínio puro e publica-se para o monólito/v6. */
const BL: Backlog = { issues: [], seq: 11, mig: 3, adr: 4, view: -1 };
publish({ BL, STAGES });

/* ───── raiz de composição: liga os adaptadores do bridge (infra) às portas do motor
   (application). O motor fica puro (sem window/DOM); o `window`/DOM ficam deste lado. O
   estado BL é a MESMA referência que `backlog()` do bridge devolve (window.BL). ───── */
const engine = makeBoardEngine({
  store: { backlog: () => backlog(), design: () => design(), saveDesign: () => saveDesign() },
  workspace: { files: () => files() },
  catalog: { tech: () => tech(), kind: () => kindTable(), cloud: () => cloudTable(), isApp: (n) => isApp(n), nodeSlug: (n) => nodeSlug(n), appDir: (n) => appDir(n), root: () => root() },
  generators: { compose: (d, h) => composeYaml(d, h), appFiles: (node, d, bad) => appFiles(node, d, bad), k8sYaml: (node) => k8sYaml(node), k8sInfra: (d) => k8sInfra(d), cloudMap: (d) => cloudMap(d), has: (p, re) => has(p, re), validateDesign: () => validateDesign() },
  directory: { agents: () => agents(), provs: () => provs(), taskProfiles: () => taskProfiles() },
  scm: { gfStart: (k, n) => gfStart(k, n), gfFinish: (b, a) => gfFinish(b, a), commit: (m, a) => commitGit(m, a), checkout: (b) => checkout(b), branch: () => branch(), staged: () => staged(), statusOf: (p) => stOf(p), refs: () => git().refs },
  runctl: { active: () => run().active, setActive: (on, label) => runState(on, label), label: (text) => { run().label = text; runLabel(); }, setAuthor: (a) => setAuthor(a), setAgent: (a) => setAgent(a), mode: () => mode(), stop: () => stopSignal() },
  chat: {
    card: (label, html) => card(label, html),
    tl: (host, name, arg) => tl(host as HTMLElement, name, arg),
    toolResult: (row, html) => { (row as HTMLElement).querySelector(".tr")!.innerHTML = html; },
    cardAppend: (bd, html) => { (bd as HTMLElement).insertAdjacentHTML("beforeend", html); },
    cardSet: (bd, html) => { (bd as HTMLElement).innerHTML = html; },
    ask: (host, btns) => ask(host as HTMLElement, btns),
    beat: (ms) => beat(ms), sleep: (ms) => sleep(ms), user: (t) => user(t),
    focusAgent: (nf) => focusAgent(nf), agentPill: () => agentPill(), handlePrompt: (q) => handlePrompt(q), scrollMsgs: () => scrollMsgs(),
  },
  router: { route: (agent, title) => routeModel(agent, title), use: (p, tok) => use(p, tok) },
  terminal: { echo: (h) => echo(h), echoCmd: (c) => echoCmd(c), newInput: (nf) => newInput(nf), setPanelTab: (t, nf) => setPanelTab(t, nf), getVar: (k) => getVar(k), runTests: () => runTests(), dsLint: () => dsLint(), doTool: (t, host) => doTool(t, host as HTMLElement) },
  team: { inScope: (a, p) => inScope(a, p), ownerOf: (p) => ownerOf(p), short: (p) => short(p) },
  view: { rerender: (k) => rerender(k), refresh: () => refresh(), rerenderCodev: () => { if (pane() === "codev" && panes().codev) panes().codev(); } },
  notifier: { toast: (m) => toast(m), note: (m) => note(m), log: (s, m) => log(s, m) },
  nav: { openTab: (t) => openTab(t), palette: (pre, cfg) => palette(pre, cfg) },
  orchestration: { runIssue: (it) => decoratedRunIssue(it), approveIssue: (id) => decoratedApproveIssue(id) },
});
const { mkIssue, setStage, autoTest, runIssue, delegate, runSprint, approveIssue, rejectIssue, dropIssue, newIssue, openBoard, genBacklog, genBacklogIssues } = engine;

/* corpo da vista — era `VIEW.board=(t,host)=>{…}` eager; aqui como função + shim em app.ts.
   DOM puro sobre BL/STAGES + selectores do domínio + catálogo de agentes/provedores. */
function renderBoardView(_t: unknown, host: HTMLElement): void {
  const v = BL.view, list = inView(BL.issues, v), { total: pts, done } = points(list);
  const cardH = (i: typeof BL.issues[number]): string => { const a = agents()[i.agent], tr = i.res ? `<span class="${i.res.every((r) => r.ok) ? "okc" : "bad"}">${i.res.every((r) => r.ok) ? "✓" : "✖"} ${i.res.filter((r) => r.ok).length}/${i.res.length} testes</span>` : "";
    return `<div class="kc" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${i.id}')"><div class="kc-h"><span class="kc-id">${i.id}</span><span class="tag ${i.type === "fix" ? "bad" : ""}">${i.type}</span><span class="kc-p">${i.pts}</span></div><div class="kc-t">${esc(i.title)}</div><div class="kc-m"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${i.model ? ` · ${provs()[i.model].name}` : ""}<span class="tag" style="margin-left:auto">S${i.sprint + 1}</span></div>${i.branch && i.stage !== "done" ? `<div class="kc-b">⎇ ${esc(i.branch)}</div>` : ""}${i.merged ? `<div class="kc-b">merge ${i.merged} em develop</div>` : ""}${tr || i.note ? `<div class="kc-n">${tr}${i.note ? `<span>${esc(i.note)}</span>` : ""}</div>` : ""}
     ${i.stage === "backlog" || i.stage === "todo" ? `<button class="mini" data-action="delegate" data-on="${esc(i.id)}">▶ Delegar a ${a.n}</button>` : i.stage === "dev" && !run().active ? `<button class="mini" data-action="delegate" data-on="${esc(i.id)}">▶ Retomar</button>` : i.stage === "func" ? `<div class="kc-a"><button class="mini pri" data-action="approve" data-on="${esc(i.id)}">✓ Validar</button><button class="mini" data-action="reject" data-on="${esc(i.id)}">✗ Rejeitar</button></div>` : ""}</div>`; };
  host.innerHTML = `<div class="kb"><div class="kb-bar"><b style="font-size:15px">Quadro</b>${[-1, 0, 1].map((s) => `<button class="mini${v === s ? " pri" : ""}" data-action="view" data-on="${s}">${s < 0 ? "Tudo" : "Sprint " + (s + 1)}</button>`).join("")}<span class="kb-prog"><i style="width:${pts ? done / pts * 100 : 0}%"></i></span><span style="color:var(--fg-muted);font-size:11.5px">${done}/${pts} pts</span><span class="sp"></span><button class="mini" data-action="new-issue">+ Issue</button><button class="mini" data-action="open-studio">Studio</button><button class="mini pri" data-action="run-sprint" data-on="${v < 0 ? autoSprint(BL.issues) : v}">▶ Executar sprint</button></div>
   ${BL.issues.length ? `<div class="kb-cols">${STAGES.map(([k, l]) => { const xs = list.filter((i) => i.stage === k); return `<div class="kcol" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="event.preventDefault();this.classList.remove('over');dropIssue(event.dataTransfer.getData('text/plain'),'${k}')"><div class="kcol-h">${l}<span class="cnt">${xs.length}</span></div>${k === "test" ? '<div class="kcol-d">Ao entrar aqui os testes correm sozinhos. Falha → volta a desenvolvimento.</div>' : k === "func" ? '<div class="kcol-d">Só chega aqui o que passou nos testes. A validação é tua.</div>' : ""}${xs.map(cardH).join("")}</div>`; }).join("")}</div>`
   : `<div class="empty" style="height:60%"><div><b style="color:var(--fg-dim);font-size:14px">Backlog vazio</b><br>Desenha a arquitectura no Studio e gera o backlog a partir dos componentes planeados.<br><button class="mini pri" style="margin-top:10px" data-action="open-studio">Abrir o Studio</button> <button class="mini" data-action="gen-backlog">Gerar a partir do desenho actual</button></div></div>`}</div>`;
}

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` por renderBoardView) ao efeito,
   servido pelo listener delegado de `ui/actions.ts`. Fica aqui — no resíduo, fora da
   subárvore governada por A7/A8 — porque só este ficheiro tem à mão o motor e o bridge.
   Todos os handlers são `click`. O payload viaja SÓ em `data-on` (o golden strippa
   data-action/data-on; um `data-*` à medida vazava); os ids escapam-se com `esc` à saída
   (eram crus em literais JS dentro do `onclick`) — nos dados actuais (DX-N) `esc` é no-op.
   GOTCHA-decoração: delegate/run-sprint/approve chamam a versão DECORADA por window
   (decoratedDelegate/decoratedRunSprint/decoratedApproveIssue), como os onclick antigos
   resolviam `window.X` ao clicar; reject/new-issue/gen-backlog/view não são decoradas. */
const ACTIONS: ActionTable = {
  view: { on: "click", run: (e) => { BL.view = +e.on; rerender("board"); } },
  delegate: { on: "click", run: (e) => decoratedDelegate(e.on) },
  approve: { on: "click", run: (e) => decoratedApproveIssue(e.on) },
  reject: { on: "click", run: (e) => rejectIssue(e.on) },
  "new-issue": { on: "click", run: () => newIssue() },
  "open-studio": { on: "click", run: () => openStudio() },
  "run-sprint": { on: "click", run: (e) => decoratedRunSprint(+e.on) },
  "gen-backlog": { on: "click", run: () => genBacklog() },
};
bindActions(ACTIONS);

/* ── publicação no window (via bridge): estado + funções que o resíduo (app.ts/v5/v6/
   bridge/pair), os onclick inline e os consumidores (studio/router/codev/tasks) resolvem
   como globais. runIssue/delegate/runSprint/approveIssue são decoradas pelo monólito
   depois de publicadas. VIEW.board fica como shim brace-less em app.ts a delegar em
   renderBoardView. ── */
publish({ mkIssue, openBoard, setStage, autoTest, rejectIssue, dropIssue, newIssue, genBacklog, genBacklogIssues, runIssue, delegate, runSprint, approveIssue, renderBoardView });
