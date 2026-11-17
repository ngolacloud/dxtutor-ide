/* ═════════ dxtutor IDE — feature: Tasks (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado por
   import real e detém o render do pane «Tasks» (backlog, sprints, kanban resumido)
   que vivia na camada transitória `v6.ts` como `RP.tasks`.

   O backlog (`BL`), o filtro (`TK`), os estágios (`STAGES`), os agentes (`AGENTS`) e
   os helpers (`nfmt`, `STC`, `ownerName`) continuam donos do monólito/v6 e são lidos
   por fachada tipada no core (captura em locais p/ corpo quase-verbatim). Do core
   importa-se só o que é dono de lá (`$`, `hd`, `svg`, `esc`). Os `onclick="…"` inline
   resolvem os nomes livres (newIssue/openBoard/openIssue/openStudio/saveTK/RP.tasks)
   no `window` ao clicar.

   Shim transitório: publica `renderTasksPane`; `v6.ts` delega
   `RP.tasks=()=>window.renderTasksPane()` (lazy, no switch de pane). */

import { $, hd, svg, esc } from "../core";

/** Renderiza o pane «Tasks»: filtros (sprint/quem), sumário de pontos/custo, itens
 *  à espera de validação e os grupos por estágio. */
function renderTasksPane(): void {
  const BL = window.BL, TK = window.TK, STAGES = window.STAGES, AGENTS = window.AGENTS,
    nfmt = window.nfmt, STC = window.STC, ownerName = window.ownerName;
  const el = $("#pane-tasks"), xs = BL.issues.filter((i: any) => (TK.sprint < 0 || i.sprint === TK.sprint) && (TK.who === "all" || (TK.who === "you" ? i.owner === "you" : i.agent === TK.who && i.owner !== "you"))),
    pts = xs.reduce((a: number, i: any) => a + i.pts, 0), dn = xs.filter((i: any) => i.stage === "done").reduce((a: number, i: any) => a + i.pts, 0), tok = xs.reduce((a: number, i: any) => a + (i.cost ? i.cost.tok : 0), 0), u = xs.reduce((a: number, i: any) => a + (i.cost ? i.cost.usd : 0), 0), wait = xs.filter((i: any) => i.stage === "func");
  if (!el) return;
  el.innerHTML = hd("Tasks", `<button title="New issue" onclick="newIssue()">${svg("plus")}</button><button title="Open the board" onclick="openBoard()">${svg("split")}</button>`) + `<div class="sections">
   <div class="tk-f"><div class="seg" style="grid-template-columns:repeat(3,1fr)">${[[-1, "All"], [0, "Sprint 1"], [1, "Sprint 2"]].map(([s, l]) => `<button class="${TK.sprint === s ? "on" : ""}" onclick="TK.sprint=${s};saveTK();RP.tasks()">${l}</button>`).join("")}</div>
   <select class="inp" style="margin:6px 0 0;width:100%" onchange="TK.who=this.value;saveTK();RP.tasks()"><option value="all">Everyone</option><option value="you"${TK.who === "you" ? " selected" : ""}>Assigned to you</option>${Object.entries(AGENTS).filter(([k]) => k !== "lead" && k !== "tutor").map(([k, a]: [string, any]) => `<option value="${k}"${TK.who === k ? " selected" : ""}>${a.n}</option>`).join("")}</select></div>
   ${BL.issues.length ? `<div class="tk-sum"><div><b>${dn}</b>/${pts} pts<span class="lp-bar"><i style="width:${pts ? dn / pts * 100 : 0}%"></i></span></div><div class="tk-k"><span>${nfmt(tok)} tokens</span><span>~$${u.toFixed(2)}</span><span>${xs.filter((i: any) => i.attempts).length} corrected</span></div></div>` : ""}
   ${wait.length ? `<div class="tk-wait" onclick="openIssue('${wait[0].id}')">${svg("bulb")}<span><b>${wait.length}</b> waiting for your validation</span></div>` : ""}
   ${!BL.issues.length ? `<div class="sec-empty">No tasks yet. Design the architecture in the Studio and generate the backlog, or create an issue.</div><button class="btn" onclick="openStudio()">Open the Studio</button><button class="btn ghost" onclick="newIssue()">New issue…</button>` :
      STAGES.map(([k, l]) => { const ys = xs.filter((i: any) => i.stage === k); if (!ys.length && k !== "func") return ""; const open = TK.open[k] !== false; return `<div class="scm-grp tk-h" onclick="TK.open['${k}']=!${open};saveTK();RP.tasks()"><span class="pdot" style="background:${STC[k]}"></span>${l}<span class="cnt">${ys.length}</span></div>` + (open ? ys.map((i: any) => `<div class="tk-row" onclick="openIssue('${i.id}')"><span class="kc-id">${i.id}</span><span class="nm notr">${esc(i.title)}</span><span class="av" title="${ownerName(i)}" style="background:${i.owner === "you" ? "#8a8f9c" : AGENTS[i.agent].col}">${ownerName(i).charAt(0)}</span>${i.cost ? `<span class="tk-c" title="${nfmt(i.cost.tok)} tokens · $${i.cost.usd.toFixed(3)}">$${i.cost.usd.toFixed(2)}</span>` : `<span class="tk-c">${i.pts}p</span>`}</div>`).join("") || '<div class="sec-empty">Nothing waiting for you.</div>' : ""); }).join("")}</div>`;
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.tasks (v6.ts) delega em renderTasksPane. */
window.renderTasksPane = renderTasksPane;
