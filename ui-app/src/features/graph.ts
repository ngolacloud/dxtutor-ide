/* ═════════ dxtutor IDE — feature: Graph (vista do grafo de commits / DAG) ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o corpo do renderer da
   tab `graph` (o DAG de commits com faixas por ramo, merges, tags, refs e detalhe de
   ficheiros) que vivia no monólito `app.ts` (secção `/* git *​/`, `VIEW.graph`).

   Fronteira: a feature é DONA só do desenho (`renderGraphView(t,host)`). O MOTOR git
   (layout do grafo `graphLayout`, estado `GIT`/`BRANCH`/`GSEL`, cores de faixa `LANE`,
   `authorOf`, gitflow `isFlow`) continua dono de `features/scm.ts`/monólito e é lido
   por nome livre (global) — tal como `features/diff.ts` lê `FS`. `VIEW.graph` nasce em
   `app.ts` (registo de kinds de tab) e fica lá como SHIM:
   `VIEW.graph=(t,host)=>window.renderGraphView(t,host)`.

   Mecânica (igual às migrações strict anteriores — diff/editor/explorer): a feature
   avalia ANTES de `app.ts` (um `<script type="module">` próprio no index.html, antes
   do app.ts) e publica `window.renderGraphView` no eval. Nada é lido ansiosamente —
   `graphLayout`/`GIT`/`BRANCH`/… só são tocados DENTRO de `renderGraphView`, chamada
   depois do arranque, e resolvem no escopo GLOBAL em runtime. Os handlers `onclick`
   embutidos (pickBranch/gfPrompt/gfFinish/checkout/rerender/openPath/toast e a
   reatribuição de `GSEL`) são strings HTML resolvidas no window em tempo de clique —
   não entram no grafo de tipos. Do core importa-se só o que é dono de lá (`esc`). */

import { esc, jsa } from "../core";
import { VIEW } from "../app/store/registry";

/* ───── corpo do renderer da tab `graph` (era VIEW.graph no monólito) ───── */
function renderGraphView(_t: unknown, host: HTMLElement) {
  const L = graphLayout(),
    W = 18,
    H = 32,
    X = (c: number) => 14 + c * W,
    Y = (i: number) => H / 2 + i * H,
    gw = 28 + L.max * W;
  let paths = "",
    dots = "";
  L.rows.forEach((r, i) => {
    const c = GIT.c[r.h];
    c.p.forEach((ph: string, k: number) => {
      const j = L.idx[ph];
      if (j == null) return;
      const pr = L.rows[j],
        x0 = X(r.col),
        y0 = Y(i),
        xl = X(r.pl[k]),
        xp = X(pr.col),
        y1 = Y(j),
        col = LANE[(k === 0 ? r.col : r.pl[k]) % LANE.length];
      let d = `M${x0} ${y0}`;
      if (j === i + 1)
        d += x0 === xp ? `L${xp} ${y1}` : `C${x0} ${y0 + H * 0.6} ${xp} ${y1 - H * 0.6} ${xp} ${y1}`;
      else {
        d += xl === x0 ? `L${xl} ${y0 + H}` : `C${x0} ${y0 + H * 0.6} ${xl} ${y0 + H * 0.4} ${xl} ${y0 + H}`;
        d += `L${xl} ${y1 - H}`;
        d += xp === xl ? `L${xp} ${y1}` : `C${xl} ${y1 - H * 0.4} ${xp} ${y1 - H * 0.6} ${xp} ${y1}`;
      }
      paths += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
    });
    const col = LANE[r.col % LANE.length],
      mg = c.p.length > 1;
    dots += `<circle cx="${X(r.col)}" cy="${Y(i)}" r="${mg ? 4 : 5}" fill="${mg ? "var(--bg-editor)" : col}" stroke="${col}" stroke-width="2"/>`;
  });
  const refsAt = (h: string) => Object.keys(GIT.refs).filter((b) => GIT.refs[b] === h);
  host.innerHTML = `<div class="gl"><div class="gl-bar"><button class="mini" onclick="pickBranch()">⎇ ${esc(BRANCH)} ▾</button>${BRANCH === "develop" ? `<button class="mini" onclick="gfPrompt('feature')">+ feature</button><button class="mini" onclick="gfPrompt('fix')">+ fix</button><button class="mini" onclick="gfPrompt('release')">+ release</button>` : isFlow(BRANCH) ? `<button class="mini pri" onclick="gfFinish()">Finalizar ${esc(BRANCH)}</button>` : `<button class="mini" onclick="checkout('develop');rerender('graph')">Ir para develop</button>`}<span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">${GIT.order.length} commits · ${Object.keys(GIT.refs).length} ramos</span></div>
   <div class="gl-body" style="--gw:${gw}px"><svg class="gl-svg" width="${gw}" height="${L.rows.length * H}">${paths}${dots}</svg>${L.rows
     .map((r) => {
       const c = GIT.c[r.h],
         a = authorOf(c.a),
         col = LANE[r.col % LANE.length],
         sel = GSEL === r.h;
       return (
         `<div class="gl-row${sel ? " sel" : ""}" onclick="GSEL=GSEL===${jsa(r.h)}?null:${jsa(r.h)};rerender('graph')"><span class="gl-refs">${refsAt(r.h)
           .map((b) => `<span class="gl-ref${b === BRANCH ? " head" : ""}" style="--c:${col}">${b === BRANCH ? "● " : ""}${esc(b)}</span>`)
           .join("")}${GIT.tags[r.h] ? `<span class="gl-ref tagr">${GIT.tags[r.h]}</span>` : ""}</span><span class="gl-msg">${esc(c.m)}</span><span class="gl-au"><i style="background:${a.col}">${a.n.charAt(0)}</i>${esc(a.n)}</span><span class="gl-h">${r.h}</span><span class="gl-t">${rel(c.t)}</span></div>` +
         (sel
           ? `<div class="gl-det">${c.files.length ? (c.files as string[]).map((p: string) => `<button class="mini" onclick="event.stopPropagation();FS[${jsa(p)}]?openPath(${jsa(p)}):toast('O ficheiro não existe neste ramo')">${esc(short(p))}</button>`).join("") : '<span style="color:var(--fg-muted)">Commit anterior ao protótipo — sem lista de ficheiros.</span>'}${c.p.length > 1 ? `<span class="tag">merge de ${c.p.length} pais</span>` : ""}</div>`
           : "")
       );
     })
     .join("")}</div></div>`;
}

/* ── publicação no window: `VIEW.graph` (app.ts) delega em renderGraphView (shim, no
   registo de kinds de tab). ── */
window.renderGraphView = renderGraphView;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
VIEW.graph = renderGraphView;
