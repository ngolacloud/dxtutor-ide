/* ═════════ dxtutor IDE — feature: Learning Track / Tutor (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado por
   import real e detém o render do pane «Learning Track» que vivia no monólito
   `app.ts` como `RP.tutor` (a última definição, v4 — a que ganhava).

   O curso e o progresso (`LTS`, `course`, `ltSeq`, `ltUnits`, `ltDone`, `ltPts`,
   `LT_BADGE`, `stars`) continuam donos do monólito e são lidos por fachada tipada no
   core; captura-se em locais no topo para manter o corpo quase-verbatim. Do core
   importa-se só o que é dono de lá (`$`, `hd`, `svg`, `esc`). Os `onclick="…"` inline
   resolvem os nomes livres (ltOnboard/ltOpen/saveLT/RP.tutor) no `window` ao clicar.

   Shim transitório: publica `renderTutorPane`; `app.ts` delega
   `RP.tutor=()=>window.renderTutorPane()` (lazy, no switch de pane). */

import { $, hd, svg, esc, jsa } from "../core";

/** Renderiza o pane «Learning Track»: onboarding se não houver língua escolhida,
 *  senão o curso com progresso, unidades expansíveis e passos. */
function renderTutorPane(): void {
  const LTS = window.LTS, course = window.course, ltSeq = window.ltSeq, ltPts = window.ltPts,
    ltUnits = window.ltUnits, ltDone = window.ltDone, stars = window.stars, LT_BADGE = window.LT_BADGE;
  const el = $("#pane-tutor");
  if (!el) return;
  if (!LTS.lang) {
    el.innerHTML = hd("Learning Track") + `<div class="sections"><div class="sec-empty">Pick a language and a level to load your guided track.</div><button class="btn" onclick="ltOnboard(1)">Choose what to learn</button></div>`;
    return;
  }
  const c = course(), seq = ltSeq(), tot = seq.reduce((a: number, s: any) => a + s.points, 0);
  let lvl = "";
  el.innerHTML = hd("Learning Track", `<button title="Change language or level" onclick="ltOnboard(1)">${svg("settings")}</button>`) + `<div class="sections"><div class="lt-course notr">${esc(c.title)}</div><div class="lt-tot"><span class="lp-bar" style="flex:1;margin:0"><i style="width:${tot ? ltPts() / tot * 100 : 0}%"></i></span><span>${ltPts()} / ${tot} pts</span></div>
   ${ltUnits().map((u: any) => { const open = !!LTS.open[u.id], dn = u.steps.filter((s: any) => ltDone(s.id)).length, h = u.level !== lvl ? `<div class="lt-lvl">${u.level}</div>` : ""; lvl = u.level;
     return h + `<div class="lt-unit${open ? " open" : ""}" onclick="LTS.open[${jsa(u.id)}]=!LTS.open[${jsa(u.id)}];saveLT();RP.tutor()"><span class="chev">${svg("chev")}</span><span class="nm notr">${esc(u.title)}</span>${stars(u.difficulty)}<span class="cnt">${dn}/${u.steps.length}</span></div>` + (open ? u.steps.map((s: any, i: number) => { const done = ltDone(s.id), lock = i > 0 && !ltDone(u.steps[i - 1].id);
       return `<div class="lt-step${LTS.cur === s.id ? " cur" : ""}${lock ? " lock" : ""}" onclick="ltOpen(${jsa(s.id)})"><span class="st">${done ? "✓" : lock ? "🔒" : "▶"}</span><span class="nm notr">${esc(s.title)}</span>${stars(s.difficulty, s.kind)}<span class="tag k-${s.kind}">${LT_BADGE[s.kind]}</span><span class="pt">+${s.points}</span></div>`; }).join("") : ""); }).join("")}</div>`;
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.tutor (app.ts) delega em renderTutorPane. */
window.renderTutorPane = renderTutorPane;
