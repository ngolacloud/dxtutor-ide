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
   appDir) FICAM donos do monólito e são lidos por global (através do bridge). As
   POLÍTICAS que decoravam o runner a partir do app.ts/v5/v6 (sincronizar o Studio,
   revisão e explicação antes de validar, «o código é teu», dono humano, custo medido,
   duplo-clique/custo nos cartões) são compostas aqui desde a U4g3 do ADR-0004.

   Mecânica: avalia ANTES de `app.ts` (ordem do index.html). Publica o estado (via `publish`)
   e, no fim, as funções — os nomes livres do monólito resolvem no escopo GLOBAL em runtime.
   Nada é lido ansiosamente no eval (FS/AGENTS/… só são tocados DENTRO das funções, pelo
   bridge, depois do arranque). BL/STAGES são window-backed (o resíduo é dono).

   GOTCHA-decoração: runIssue/delegate/runSprint/approveIssue publicam-se já compostos com
   as políticas (abaixo), e o bridge.ts ainda decora o runSprint por cima; as arestas
   internas passam pela porta `orchestration` → versão do window no acto
   (decoratedRunIssue/decoratedApproveIssue). O VIEW.board regista-se aqui, composto;
   `renderBoardView` (publicado) é o corpo base, que os goldens caracterizam. */

import { $, esc, jsa, nfmt } from "../core";
import { bus } from "../app/bus";
import { registerActions, globalCalls, callGlobal } from "../app/actions";
import { desktopPorts } from "../app/desktop";
import { VIEW } from "../app/store/registry";
import type { Backlog, Issue } from "./board/domain/types";
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
  harness, reviewIssue, codeGuard, openIssue, studioNodes, saveSD, dlg, usage, usd, commitNotes,
  agentAvailable, agentStory,
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
  const agentOn = agentAvailable();
  const cardH = (i: typeof BL.issues[number]): string => { const a = agents()[i.agent], tr = i.res ? `<span class="${i.res.every((r) => r.ok) ? "okc" : "bad"}">${i.res.every((r) => r.ok) ? "✓" : "✖"} ${i.res.filter((r) => r.ok).length}/${i.res.length} testes</span>` : "";
    return `<div class="kc" draggable="true" ondragstart="event.dataTransfer.setData('text/plain',${jsa(i.id)})"><div class="kc-h"><span class="kc-id">${i.id}</span><span class="tag ${i.type === "fix" ? "bad" : ""}">${i.type}</span><span class="kc-p">${i.pts}</span></div><div class="kc-t">${esc(i.title)}</div><div class="kc-m"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${i.model ? ` · ${provs()[i.model].name}` : ""}<span class="tag" style="margin-left:auto">S${i.sprint + 1}</span></div>${i.branch && i.stage !== "done" ? `<div class="kc-b">⎇ ${esc(i.branch)}</div>` : ""}${i.merged ? `<div class="kc-b">merge ${i.merged} em develop</div>` : ""}${tr || i.note ? `<div class="kc-n">${tr}${i.note ? `<span>${esc(i.note)}</span>` : ""}</div>` : ""}
     ${agentOn && ["backlog", "todo", "dev"].includes(i.stage) ? `<button class="mini pri" data-action="agent-story" data-on="${esc(i.id)}" title="O agente investiga, propõe um plano para aprovares e implementa">⚡ Agente</button>` : ""}${i.stage === "backlog" || i.stage === "todo" ? `<button class="mini" data-action="delegate" data-on="${esc(i.id)}">▶ Delegar a ${a.n}</button>` : i.stage === "dev" && !run().active ? `<button class="mini" data-action="delegate" data-on="${esc(i.id)}">▶ Retomar</button>` : i.stage === "func" ? `<div class="kc-a"><button class="mini pri" data-action="approve" data-on="${esc(i.id)}">✓ Validar</button><button class="mini" data-action="reject" data-on="${esc(i.id)}">✗ Rejeitar</button></div>` : ""}</div>`; };
  host.innerHTML = `<div class="kb"><div class="kb-bar"><b style="font-size:15px">Quadro</b>${[-1, 0, 1].map((s) => `<button class="mini${v === s ? " pri" : ""}" data-action="view" data-on="${s}">${s < 0 ? "Tudo" : "Sprint " + (s + 1)}</button>`).join("")}<span class="kb-prog"><i style="width:${pts ? done / pts * 100 : 0}%"></i></span><span style="color:var(--fg-muted);font-size:11.5px">${done}/${pts} pts</span><span class="sp"></span><button class="mini" data-action="new-issue">+ Issue</button><button class="mini" data-action="open-studio">Studio</button><button class="mini pri" data-action="run-sprint" data-on="${v < 0 ? autoSprint(BL.issues) : v}">▶ Executar sprint</button></div>
   ${BL.issues.length ? `<div class="kb-cols">${STAGES.map(([k, l]) => { const xs = list.filter((i) => i.stage === k); return `<div class="kcol" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="event.preventDefault();this.classList.remove('over');dropIssue(event.dataTransfer.getData('text/plain'),${jsa(k)})"><div class="kcol-h">${l}<span class="cnt">${xs.length}</span></div>${k === "test" ? '<div class="kcol-d">Ao entrar aqui os testes correm sozinhos. Falha → volta a desenvolvimento.</div>' : k === "func" ? '<div class="kcol-d">Só chega aqui o que passou nos testes. A validação é tua.</div>' : ""}${xs.map(cardH).join("")}</div>`; }).join("")}</div>`
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
  /* opção 2 do ADR-0003: a issue vai ao agente Co-Dev (modo plano) e passa a «dev» */
  "agent-story": {
    on: "click",
    run: (e) => {
      const it = backlog().issues.find((x) => x.id === e.on);
      if (!it) return;
      if (agentStory({ id: it.id, title: it.title, type: it.type, pts: it.pts, note: it.note })) {
        setStage(it, "dev");
        rerender("board");
      }
    },
  },
  approve: { on: "click", run: (e) => decoratedApproveIssue(e.on) },
  reject: { on: "click", run: (e) => rejectIssue(e.on) },
  "new-issue": { on: "click", run: () => newIssue() },
  "open-studio": { on: "click", run: () => openStudio() },
  "run-sprint": { on: "click", run: (e) => decoratedRunSprint(+e.on) },
  "gen-backlog": { on: "click", run: () => genBacklog() },
};
bindActions(ACTIONS);
/* `dx test <ISSUE>` e `dx sprint <n>` no terminal (ADR-0004, U4j4a — eram do app.ts): chamam o dropIssue/runSprint
   PUBLICADOS (o runSprint com as guardas e a porta desktop), como o app.ts chamava pelo global. */
const XCB=(window as unknown as { XC: Record<string, (a: string[], v?: string) => unknown> }).XC;
const _dx=XCB.dx;XCB.dx=(a: string[])=>{if(a[0]==='test'&&a[1]){const it=(window as unknown as { BL: Backlog }).BL.issues.find(i=>i.id.toLowerCase()===a[1].toLowerCase());if(!it){(window as unknown as { echo: (h: string) => void }).echo('<span class="er">issue desconhecida</span>');return;}(window as unknown as { dropIssue: (id: string, st: string) => void }).dropIssue(it.id,'test');return;}if(a[0]==='sprint'){(window as unknown as { runSprint: (s: number) => unknown }).runSprint((+a[1]||1)-1);return;}return _dx(a);};
/* redesenha o quadro aberto quando o workspace muda (ADR-0004, U4j4a — era um subscritor do app.ts) */
bus.on('workspace:changed',({fromEditor:a})=>{if(!a){const t=(window as unknown as { tabOf: (id: string | null) => { kind?: string } | undefined; cur: string | null }).tabOf((window as unknown as { cur: string | null }).cur);if(t&&t.kind==='board'){const top=$('#ebody')!.scrollTop;(window as unknown as { show: (id: string | null) => void }).show((window as unknown as { cur: string | null }).cur);$('#ebody')!.scrollTop=top;}}});

/* ═══════════ políticas que decoram o runner e o quadro (ADR-0004, U4g3) ═══════════
   Viviam como decorações no app.ts, v5.ts e v6.ts, por esta ordem (de dentro para fora);
   compõem-se aqui pela mesma ordem e publicam-se já compostas. Nada entre o board.ts e
   essas camadas lia estes nomes por valor no eval (só chamadas tardias), por isso o que o
   resto do IDE vê em runtime é o mesmo. */
const issueOf = (id: string): Issue | undefined => BL.issues.find((i) => i.id === id);

/** (app.ts) Validar uma issue de infra fecha os componentes do Studio sem issue própria. */
function approveSyncStudio(id: string): void {
  approveIssue(id);
  if (BL.issues.some((i) => i.infra && i.stage === "done")) {
    studioNodes().forEach((n) => { if (!BL.issues.some((i) => i.node === n.id) && n.st !== "ok") n.st = "ok"; });
    saveSD();
  }
  rerender("board");
}
/** (v5) Com o harness «review the diff», validar sem rever abre a revisão em vez disso. */
function approveReviewed(id: string): void {
  const it = issueOf(id);
  if (it && it.stage === "func" && harness().review && !it.reviewed) { toast("Review the diff before validating"); reviewIssue(id); return; }
  approveSyncStudio(id);
}
/** (v6) Com o harness «explain», validar pede primeiro a explicação, que fica no commit. */
function approveExplained(id: string): void {
  const it = issueOf(id), H = harness();
  if (it && it.stage === "func" && H.explain && !it.explain && (!H.review || it.reviewed)) {
    dlg({
      title: `Explain ${it.id} before validating`,
      body: `<p>This project asks you to say, in your own words, what the change does and why it is safe to merge. It is saved with the issue and the merge commit.</p><p style="color:var(--fg-muted)">${esc(it.title)}</p>`,
      input: "e.g. Adds the orders table with an index on created_at so the list query does not scan the table…",
      ok: "Validate and merge",
      validate: (v) => (v.split(/\s+/).filter(Boolean).length < 8 ? "Write at least one full sentence (8 words or more)." : ""),
      onOk: (v) => { it.explain = v; decoratedApproveIssue(id); },
    });
    return;
  }
  approveReviewed(id);
  if (it && it.merged && it.explain && commitNotes()[it.merged]) commitNotes()[it.merged].note = it.explain;
  if (pane() === "tasks") panes().tasks();
}

/** (v5) Com «writing code is yours» no harness, o Co-Dev não delega nem corre sprints. */
function delegateGuarded(id: string): ReturnType<typeof delegate> | undefined {
  if (codeGuard("Delegate " + id + ".")) return;
  return delegate(id);
}
/** (v6) Uma issue cujo dono és tu não se delega: abre-a. */
function delegateOwned(id: string): ReturnType<typeof delegate> | undefined {
  const i = issueOf(id);
  if (i && i.owner === "you") { toast(`${id} is yours — move it to Test when your code is ready`); openIssue(id); return; }
  return delegateGuarded(id);
}
function runSprintGuarded(s: number): ReturnType<typeof runSprint> | undefined {
  if (codeGuard("Run Sprint " + (s + 1) + ".")) return;
  return runSprint(s);
}
/* ADR-0004, U4h5: o runSprint PUBLICADO consulta a porta desktop (`desktopPorts.board`, injectada
   por platform/desktop/demos.ts: com uma pasta real aberta a corrida é uma demo e não corre);
   antes o desktop reatribuía-o no `window`. As arestas internas resolvem o `window` no acto. */
function runSprintPublished(s: number): unknown { const d = desktopPorts.board; return d && d.runSprint ? d.runSprint(s, runSprintGuarded) : runSprintGuarded(s); }

/** (v6) Mede o custo de cada corrida do runner (tokens por provedor, dólares, tempo). */
async function runIssueCosted(it: Issue): Promise<void> {
  const snap = Object.fromEntries(Object.keys(usage()).map((k) => [k, usage()[k].tok])), t0 = Date.now();
  try { await runIssue(it); } finally {
    const c = (it.cost = it.cost || { tok: 0, usd: 0, sec: 0, runs: 0, by: {} });
    Object.keys(usage()).forEach((k) => { const d = usage()[k].tok - snap[k]; if (d > 0) { c.tok += d; c.usd += usd(d, k); c.by[k] = (c.by[k] || 0) + d; } });
    c.sec += (Date.now() - t0) / 1000; c.runs++;
    if (pane() === "tasks") panes().tasks();
  }
}

/** O quadro: o corpo base + (v5) o botão «Review diff» + (v6) duplo-clique, dono e custo.
 *  BUGs PRÉ-EXISTENTES, preservados (reportam-se, não se corrigem no refactor): desde que o
 *  quadro emite `data-action` (Fase 4 da extracção), (v5) já não há `approveIssue('…')` no
 *  HTML para trocar pelo «Review diff», e (v6) já não há `delegate` no `onclick` para tirar
 *  o «Delegar» das issues tuas — as duas trocas não acontecem (os gates em approveIssue/
 *  delegate continuam a proteger o clique). */
function boardView(t: unknown, host: HTMLElement): void {
  renderBoardView(t, host);
  if (harness().review) {
    host.querySelectorAll(".kc-a").forEach((a) => {
      const m = (a.innerHTML.match(/approveIssue\('([^']+)'\)/) || [])[1], it = BL.issues.find((i) => i.id === m);
      if (it && !it.reviewed) a.innerHTML = `<button class="mini pri" data-action="board:reviewIssue" data-on="${esc(it.id)}">Review diff</button>`;
    });
  }
  host.querySelectorAll(".kc").forEach((k) => {
    const id = (k.querySelector(".kc-id") || ({} as { textContent?: string })).textContent as string, i = BL.issues.find((x) => x.id === id);
    if (!i) return;
    (k as HTMLElement).ondblclick = () => openIssue(id);
    if (i.owner === "you") {
      const m = k.querySelector(".kc-m");
      if (m) m.innerHTML = `<span class="av" style="background:#8a8f9c">Y</span>You<span class="tag" style="margin-left:auto">S${i.sprint + 1}</span>`;
      k.querySelectorAll(".mini").forEach((b) => { if (/delegate/.test(b.getAttribute("onclick") || "")) b.remove(); });
    }
    if (i.cost) (k.querySelector(".kc-m") as HTMLElement).insertAdjacentHTML("beforeend", `<span class="tk-c" title="${nfmt(i.cost.tok)} tokens">$${i.cost.usd.toFixed(2)}</span>`);
  });
}
VIEW.board = boardView;

/* ── publicação no window (via bridge): estado + funções que o resíduo (app.ts/v5/v6/
   bridge/pair), os onclick inline e os consumidores (studio/router/codev/tasks) resolvem
   como globais. runIssue/delegate/runSprint/approveIssue saem já compostos com as
   políticas acima. ── */
publish({
  mkIssue, openBoard, setStage, autoTest, rejectIssue, dropIssue, newIssue, genBacklog, genBacklogIssues,
  runIssue: runIssueCosted, delegate: delegateOwned, runSprint: runSprintPublished, approveIssue: approveExplained, renderBoardView,
});

/* o «Review diff» dos cartões e os botões dos cartões do Co-Dev que o motor emite (abrir o quadro/o grafo,
   correr o sprint) chamam a função publicada, no acto (eram `onclick` inline — ADR-0004, U5c). Vão pelo
   despachante partilhado, não pela tabela do board. */
registerActions({
  ...globalCalls("board", ["openBoard", "openGraph"]),
  "board:runSprint": { click: (c) => void callGlobal("runSprint", Number(c.on)) },
  "board:reviewIssue": { click: (c) => void callGlobal("reviewIssue", c.on) },
});
