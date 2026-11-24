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

import { $, hd, svg, esc } from "../core";
import { RP } from "../app/store/registry";
import { registerActions } from "../app/actions";
import { translator } from "../app/i18n";
import { TUTOR_MESSAGES } from "./tutor.messages";
import { services } from "../app/services";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(TUTOR_MESSAGES);

/** Renderiza o pane «Learning Track»: onboarding se não houver língua escolhida,
 *  senão o curso com progresso, unidades expansíveis e passos. */
function renderTutorPane(): void {
  const { LTS, course, ltSeq, ltPts, ltUnits, ltDone, stars, LT_BADGE } = services.learn!;
  const el = $("#pane-tutor");
  if (!el) return;
  if (LTS.lang && !course()) {
    // Língua escolhida mas sem curso carregado: plugin ainda a carregar (desktop) ou removido.
    el.innerHTML = hd("Learning Track") + `<div class="sections"><div class="sec-empty">The ${esc(LTS.lang)} course is loading or is no longer installed.</div><button class="btn" data-action="lt-onboard">${txt("chooseWhatToLearn")}</button></div>`;
    return;
  }
  if (!LTS.lang) {
    el.innerHTML = hd("Learning Track") + `<div class="sections"><div class="sec-empty">${txt("pickALanguageAnd")}</div><button class="btn" data-action="tutor:onboard">${txt("chooseWhatToLearn")}</button></div>`;
    return;
  }
  const c = course(), seq = ltSeq(), tot = seq.reduce((a: number, s: any) => a + s.points, 0);
  let lvl = "";
  el.innerHTML = hd("Learning Track", `<button title="${txt("changeLanguageOrLevel")}" data-action="tutor:onboard">${svg("settings")}</button>`) + `<div class="sections"><div class="lt-course notr">${esc(c.title)}</div><div class="lt-tot"><span class="lp-bar" style="flex:1;margin:0"><i style="width:${tot ? ltPts() / tot * 100 : 0}%"></i></span><span>${ltPts()} / ${tot} pts</span></div>
   ${ltUnits().map((u: any) => { const open = !!LTS.open[u.id], dn = u.steps.filter((s: any) => ltDone(s.id)).length, h = u.level !== lvl ? `<div class="lt-lvl">${u.level}</div>` : ""; lvl = u.level;
     return h + `<div class="lt-unit${open ? " open" : ""}" data-action="tutor:unit" data-on="${esc(u.id)}"><span class="chev">${svg("chev")}</span><span class="nm notr">${esc(u.title)}</span>${stars(u.difficulty)}<span class="cnt">${dn}/${u.steps.length}</span></div>` + (open ? u.steps.map((s: any, i: number) => { const done = ltDone(s.id), lock = i > 0 && !ltDone(u.steps[i - 1].id);
       return `<div class="lt-step${LTS.cur === s.id ? " cur" : ""}${lock ? " lock" : ""}" data-action="tutor:open" data-on="${esc(s.id)}"><span class="st">${done ? "✓" : lock ? "🔒" : "▶"}</span><span class="nm notr">${esc(s.title)}</span>${stars(s.difficulty, s.kind)}<span class="tag k-${s.kind}">${LT_BADGE[s.kind]}</span><span class="pt">+${s.points}</span></div>`; }).join("") : ""); }).join("")}</div>`;
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.tutor (app.ts) delega em renderTutorPane. */
window.renderTutorPane = renderTutorPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.tutor = renderTutorPane;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
const UA = window as unknown as { LTS: { open: Record<string, boolean> }; RP: Record<string, () => void> };
registerActions({
  "tutor:onboard": { click: () => void services.learn!.ltOnboard(1) },
  "tutor:unit": { click: (c) => { UA.LTS.open[c.on] = !UA.LTS.open[c.on]; services.learn!.saveLT(); UA.RP.tutor(); } },
  "tutor:open": { click: (c) => void services.learn!.ltOpen(c.on) },
});
