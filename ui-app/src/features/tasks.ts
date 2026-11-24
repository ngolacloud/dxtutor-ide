/* ═════════ dxtutor IDE — feature: Tasks (pane lateral + detalhe de issue) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado por
   import real e detém o render do pane «Tasks» (backlog, sprints, kanban resumido)
   e a vista de detalhe (`VIEW.issue`) — ambos viviam na camada transitória `v6.ts`.

   Esta feature é agora DONA do filtro (`TK`), das cores por estágio (`STC`), do
   nome do dono duma issue (`ownerName`), de `openIssue` e do modelo de custo/
   conselho de delegação (`RATE`/`usd`/`MIN_PER_PT`/`costAvg`/`advice`). O backlog
   (`BL`), os estágios (`STAGES`) e os agentes (`AGENTS`) continuam donos do
   monólito/board.ts/team.ts; `nfmt` continua dono de v6.ts — todos lidos por
   fachada tipada no core. Do core importa-se só o que é dono de lá (`$`, `hd`,
   `svg`, `esc`, `prov`). Os `onclick="…"` inline resolvem os nomes livres
   (newIssue/openBoard/openIssue/openStudio/saveTK/RP.tasks/delegate/…) no
   `window` ao clicar.

   Shim transitório: publica `renderTasksPane`/`renderIssueView`/`openIssue`/`usd`/
   `TK`/`saveTK`/`STC`; regista ela própria `RP.tasks` e `VIEW.issue` (ADR-0004, U4g1 —
   antes eram shims no v6.ts), e o decorador de
   `runIssue` (board.ts) lê `window.usd` para acumular o custo medido.

   GOTCHA: esta feature carrega CEDO (antes de app.ts, onde `LS` nasce) — um `LS.get`
   ansioso no eval do módulo seria ReferenceError e pararia o chunk inteiro. RATE/TK
   nascem com o default e só hidratam de LS à primeira utilização (`hydrate()`,
   guard-once), como BPS em features/debug.ts. */

import { $, hd, svg, esc, prov, nfmt } from "../core";
import { RP, VIEW } from "../app/store/registry";
import { registerActions, globalCalls, callGlobal, args } from "../app/actions";
import { translator } from "../app/i18n";
import { TASKS_MESSAGES } from "./tasks.messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(TASKS_MESSAGES);

interface TaskFilter { sprint: number; who: string; open: Record<string, boolean> }

const RATE: Record<string, number> = { claude: 15, gemini: 7, codex: 10, ollama: 0 };
const MIN_PER_PT = 30;
let HYDRATED = false;
function hydrate(): void {
  if (HYDRATED) return;
  HYDRATED = true;
  Object.assign(RATE, LS.get("rate6", RATE));
  Object.assign(TK, LS.get("tk6", TK));
}
const usd = (tok: number, p: string): number => { hydrate(); return (tok / 1e6) * (RATE[p] || 0); };

function costAvg(agent: string): { tok: number; usd: number; att: number } | null {
  const BL = window.BL;
  const xs = BL.issues.filter((i: any) => i.cost && i.cost.runs && i.agent === agent);
  if (!xs.length) return null;
  const pts = xs.reduce((a: number, i: any) => a + i.pts, 0);
  return {
    tok: xs.reduce((a: number, i: any) => a + i.cost.tok, 0) / pts,
    usd: xs.reduce((a: number, i: any) => a + i.cost.usd, 0) / pts,
    att: xs.reduce((a: number, i: any) => a + i.attempts, 0) / xs.length,
  };
}

/** Conselho de delegação ("tu"/"mistura"/"agente") para uma issue, com custo estimado. */
function advice(it: any): [string, string] {
  const AGENTS = window.AGENTS;
  if (isHuman("code")) return ["you", "In this project code stays with you."];
  if (it.agent === "arq" || /ADR/.test(it.title)) return ["you", "Architecture is your call: let the Architect draft, you decide."];
  const a = costAvg(it.agent), h = it.pts * MIN_PER_PT;
  /* sem corridas medidas deste assistente, não se inventa um custo (era «1200 tokens por ponto»
     ao preço do Claude — ADR-0006, R3c): a primeira delegação mede-o */
  if (!a) return ["agent", `Delegate: no measured cost for ${AGENTS[it.agent].n} in this project yet — the first run measures it. ~${h} min of yours otherwise. Your review stays.`];
  const tok = a.tok * it.pts, u = a.usd * it.pts;
  if (a.att >= 1) return ["mix", `Delegate, but expect a correction: ${AGENTS[it.agent].n} needed ${a.att.toFixed(1)} retries on average. ≈${nfmt(tok)} tokens · ~$${u.toFixed(2)} vs ~${h} min of yours.`];
  return ["agent", `Delegate: ≈${nfmt(tok)} tokens · ~$${u.toFixed(2)} vs ~${h} min of yours. Your review stays.`];
}

const TK: TaskFilter = { sprint: -1, who: "all", open: { backlog: false, done: false } };
const saveTK = () => LS.set("tk6", TK);
const STC: Record<string, string> = { backlog: "var(--fg-muted)", todo: "var(--blue)", dev: "var(--yellow)", test: "var(--purple)", func: "var(--accent)", done: "var(--green)" };

function ownerName(i: any): string {
  return i.owner === "you" ? "You" : window.AGENTS[i.agent].n;
}

function openIssue(id: string): void {
  openTab({ id: "issue:" + id, title: id, kind: "issue", issue: id });
}

/** Renderiza o pane «Tasks»: filtros (sprint/quem), sumário de pontos/custo, itens
 *  à espera de validação e os grupos por estágio. */
function renderTasksPane(): void {
  hydrate();
  const BL = window.BL, STAGES = window.STAGES, AGENTS = window.AGENTS;
  const el = $("#pane-tasks"), xs = BL.issues.filter((i: any) => (TK.sprint < 0 || i.sprint === TK.sprint) && (TK.who === "all" || (TK.who === "you" ? i.owner === "you" : i.agent === TK.who && i.owner !== "you"))),
    pts = xs.reduce((a: number, i: any) => a + i.pts, 0), dn = xs.filter((i: any) => i.stage === "done").reduce((a: number, i: any) => a + i.pts, 0), tok = xs.reduce((a: number, i: any) => a + (i.cost ? i.cost.tok : 0), 0), u = xs.reduce((a: number, i: any) => a + (i.cost ? i.cost.usd : 0), 0), wait = xs.filter((i: any) => i.stage === "func");
  if (!el) return;
  el.innerHTML = hd("Tasks", `<button title="New issue" data-action="tasks:newIssue">${svg("plus")}</button><button title="${txt("openTheBoard")}" data-action="tasks:openBoard">${svg("split")}</button>`) + `<div class="sections">
   <div class="tk-f"><div class="seg" style="grid-template-columns:repeat(auto-fit,minmax(64px,1fr))">${([[-1, "All"]] as Array<[number, string]>).concat([...new Set<number>(BL.issues.map((i: any) => i.sprint))].sort((x, y) => x - y).map((n): [number, string] => [n, "Sprint " + (n + 1)])).map(([s, l]) => `<button class="${TK.sprint === s ? "on" : ""}" data-action="tasks:sprint" data-on="${s}">${l}</button>`).join("")}</div>
   <select class="inp" style="margin:6px 0 0;width:100%" data-action="tasks:who"><option value="all">Everyone</option><option value="you"${TK.who === "you" ? " selected" : ""}>Assigned to you</option>${Object.entries(AGENTS).filter(([k]) => k !== "lead" && k !== "tutor").map(([k, a]: [string, any]) => `<option value="${k}"${TK.who === k ? " selected" : ""}>${a.n}</option>`).join("")}</select></div>
   ${BL.issues.length ? `<div class="tk-sum"><div><b>${dn}</b>/${pts} pts<span class="lp-bar"><i style="width:${pts ? dn / pts * 100 : 0}%"></i></span></div><div class="tk-k"><span>${nfmt(tok)} tokens</span><span>~$${u.toFixed(2)}</span><span>${xs.filter((i: any) => i.attempts).length} corrected</span></div></div>` : ""}
   ${wait.length ? `<div class="tk-wait" data-action="tasks:openIssue" data-on="${esc(wait[0].id)}">${svg("bulb")}<span><b>${wait.length}</b> waiting for your validation</span></div>` : ""}
   ${!BL.issues.length ? `<div class="sec-empty">No tasks yet. Design the architecture in the Studio and generate the backlog, or create an issue.</div><button class="btn" data-action="tasks:openStudio">${txt("openTheStudio")}</button><button class="btn ghost" data-action="tasks:newIssue">New issue…</button>` :
      STAGES.map(([k, l]: [string, string]) => { const ys = xs.filter((i: any) => i.stage === k); if (!ys.length && k !== "func") return ""; const open = TK.open[k] !== false; return `<div class="scm-grp tk-h" data-action="tasks:group" data-on="${esc(JSON.stringify([k, !open]))}"><span class="pdot" style="background:${STC[k]}"></span>${l}<span class="cnt">${ys.length}</span></div>` + (open ? ys.map((i: any) => `<div class="tk-row" data-action="tasks:openIssue" data-on="${esc(i.id)}"><span class="kc-id">${i.id}</span><span class="nm notr">${esc(i.title)}</span><span class="av" title="${ownerName(i)}" style="background:${i.owner === "you" ? "#8a8f9c" : AGENTS[i.agent].col}">${ownerName(i).charAt(0)}</span>${i.cost ? `<span class="tk-c" title="${nfmt(i.cost.tok)} tokens · $${i.cost.usd.toFixed(3)}">$${i.cost.usd.toFixed(2)}</span>` : `<span class="tk-c">${i.pts}p</span>`}</div>`).join("") || '<div class="sec-empty">Nothing waiting for you.</div>' : ""); }).join("")}</div>`;
}

/** Renderiza a vista de detalhe duma issue (`VIEW.issue`): fluxo, dono, conselho de
 *  delegação com custo estimado, custo real medido, testes e explicação. */
function renderIssueView(t: any, host: HTMLElement): void {
  const BL = window.BL, STAGES = window.STAGES, AGENTS = window.AGENTS;
  const i = BL.issues.find((x: any) => x.id === t.issue);
  if (!i) { host.innerHTML = '<div class="empty">Issue not found.</div>'; return; }
  const si = STAGES.findIndex((s: [string, string]) => s[0] === i.stage), ad = advice(i), c = i.cost;
  const PROV = prov();
  host.innerHTML = `<div class="page" style="max-width:820px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="kc-id">${i.id}</span><span class="tag ${i.type === "fix" ? "bad" : ""}">${i.type}</span><span class="tag">Sprint ${i.sprint + 1}</span><span class="tag">${i.pts} pts</span></div><h1 class="notr">${esc(i.title)}</h1>
   <div class="iss-flow">${STAGES.map(([, l]: [string, string], n: number) => `<span class="${n < si ? "ok" : n === si ? "cur" : ""}">${l}</span>`).join("<i>›</i>")}</div>
   <h2>Ownership</h2><div class="tbl-wrap"><div class="rowline"><span class="av" style="background:${i.owner === "you" ? "#8a8f9c" : AGENTS[i.agent].col}">${ownerName(i).charAt(0)}</span><b>${ownerName(i)}</b><span style="color:var(--fg-muted)">${i.owner === "you" ? "you write it, the assistants review" : AGENTS[i.agent].d}</span><span class="sp"></span>${i.owner === "you" ? `<button class="mini" data-action="tasks:giveBack" data-on="${esc(i.id)}">Give back to ${AGENTS[i.agent].n}</button>` : ["backlog", "todo", "dev"].includes(i.stage) ? `<button class="mini" data-action="tasks:takeIt" data-on="${esc(i.id)}">Take it myself</button>` : ""}</div>
    ${i.branch ? `<div class="rowline"><span>${txt("branch")}</span><code class="notr">${esc(i.branch)}</code><span class="sp"></span>${i.merged ? `<span class="tag live">merged ${i.merged}</span>` : ""}</div>` : ""}</div>
   <h2>Delegate or do it yourself?</h2><div class="adv ${ad[0]}">${svg("bulb")}<div>${ad[1]}<small>Rule of thumb from this project's history; 1 point ≈ ${MIN_PER_PT} min of your time. Rates are example values per million tokens.</small></div></div>
   <h2>${txt("cost")}</h2><div class="tbl-wrap">${c ? `<div class="rowline"><span>Tokens</span><span class="sp"></span><b>${nfmt(c.tok)}</b></div><div class="rowline"><span>Estimated spend</span><span class="sp"></span><b>$${c.usd.toFixed(3)}</b></div><div class="rowline"><span>Agent time</span><span class="sp"></span><b>${c.sec.toFixed(1)} s</b><span style="color:var(--fg-muted);font-size:11px">accelerated in the prototype</span></div><div class="rowline"><span>Runs · corrections</span><span class="sp"></span><b>${c.runs} · ${i.attempts}</b></div><div class="rowline"><span>By model</span><span class="sp"></span>${Object.entries(c.by).map(([p, v]: [string, any]) => `<span class="tag"><span class="pdot" style="background:${PROV[p].col}"></span> ${PROV[p].name} ${nfmt(v)}</span>`).join(" ")}</div>` : '<div class="rowline" style="color:var(--fg-muted)">Not run by an assistant yet.</div>'}</div>
   ${i.res ? `<h2>Automatic tests</h2><div class="tbl-wrap">${i.res.map((r: any) => `<div class="rowline"><span style="color:${r.ok ? "var(--green)" : "var(--red)"}">${r.ok ? "✓" : "✖"}</span><code class="notr">${esc(r.n)}</code></div>`).join("")}</div>` : ""}
   ${i.explain ? `<h2>Your explanation</h2><div class="adv you">${svg("review")}<div class="notr">${esc(i.explain)}</div></div>` : ""}${i.note ? `<div class="sub" style="margin-top:10px">${esc(i.note)}</div>` : ""}
   <h2>${txt("actions")}</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${["backlog", "todo", "dev"].includes(i.stage) && i.owner !== "you" ? `<button class="mini pri" data-action="tasks:delegate" data-on="${esc(i.id)}">▶ Delegate to ${AGENTS[i.agent].n}</button>` : ""}${i.stage === "dev" && i.owner === "you" ? `<button class="mini pri" data-action="tasks:toTest" data-on="${esc(i.id)}">Send to automatic test</button>` : ""}${i.stage === "func" ? `<button class="mini pri" data-action="tasks:reviewIssue" data-on="${esc(i.id)}">${txt("reviewDiff")}</button><button class="mini" data-action="tasks:rejectIssue" data-on="${esc(i.id)}">${txt("reject")}</button>` : ""}<button class="mini" data-action="tasks:openBoard">${txt("openTheBoard")}</button></div></div>`;
}

/* ── publicação transitória no window (shim para o residual @ts-nocheck de v6.ts) ──
   (RP.tasks/VIEW.issue são registados acima, directamente); o decorador de
   runIssue (v6.ts) lê window.usd; as acções abaixo (U5b) lêem o TK/BL/RP/cur/PANE do window no acto. */
/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts) */
RP.tasks = renderTasksPane;
VIEW.issue = renderIssueView;

window.renderTasksPane = renderTasksPane;
Object.assign(window, { renderIssueView, openIssue, usd, TK, saveTK, STC });

/* ── acções do pane e da vista (ADR-0004, U5b) ── eram `onclick="…"`/`onchange="…"` inline, que
   resolviam o TK/BL/RP/cur/PANE e as funções no window ao clicar; as acções fazem o mesmo, no acto. */
const TW = window as unknown as { TK: TaskFilter; RP: Record<string, () => void>; BL: { issues: { id: string; owner: string | null }[] }; cur: unknown; PANE: string };
const issue = (id: string) => TW.BL.issues.find((x) => x.id === id)!;
registerActions({
  ...globalCalls("tasks", ["newIssue", "openBoard", "openStudio"]),
  "tasks:sprint": { click: (c) => { TW.TK.sprint = Number(c.on); callGlobal("saveTK"); TW.RP.tasks(); } },
  "tasks:who": { change: (c) => { TW.TK.who = c.value; callGlobal("saveTK"); TW.RP.tasks(); } },
  "tasks:group": { click: (c) => { const [k, v] = args<[string, boolean]>(c); TW.TK.open[k] = v; callGlobal("saveTK"); TW.RP.tasks(); } },
  "tasks:openIssue": { click: (c) => void callGlobal("openIssue", c.on) },
  "tasks:giveBack": { click: (c) => { issue(c.on).owner = null; callGlobal("show", TW.cur); } },
  "tasks:takeIt": { click: (c) => { issue(c.on).owner = "you"; callGlobal("show", TW.cur); if (TW.PANE === "tasks") TW.RP.tasks(); } },
  "tasks:delegate": { click: (c) => void callGlobal("delegate", c.on) },
  "tasks:toTest": { click: (c) => void callGlobal("dropIssue", c.on, "test") },
  "tasks:reviewIssue": { click: (c) => void callGlobal("reviewIssue", c.on) },
  "tasks:rejectIssue": { click: (c) => void callGlobal("rejectIssue", c.on) },
});
