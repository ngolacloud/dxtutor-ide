/* ═════════ dxtutor IDE — feature: Diff (vista de diferenças + matemática do diff) ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o subsistema DIFF que
   vivia no monólito `app.ts` (secção `/* diff *​/`): a matemática pura do diff
   (`diffLines` LCS + `diffStat`), o corpo do renderer da tab `diff` (agora
   `renderDiffView(t,host)`) e o lançador `openDiff`.

   Fronteira: a feature é DONA destas quatro peças. Os CONSUMIDORES ficam no monólito
   e lêem por nome livre (global): `diffLines` (v5.ts — diff de revisão), `diffStat`/
   `diffLines` (app.ts terminal — `XC.git diff`), `openDiff` (rows do pane SCM em
   app.ts e features/scm.ts, mais o Co-Dev em features/codev.ts). `VIEW.diff` nasce
   em app.ts (registo de kinds de tab) e fica lá como SHIM:
   `VIEW.diff=(t,host)=>window.renderDiffView(t,host)`.

   Mecânica (igual às migrações anteriores): a feature avalia ANTES de `app.ts`
   (ordem do index.html) e publica tudo no `window` no eval. Nada é lido
   ansiosamente — `FS`/`short`/`extOf`/`hlLine`/`openPath`/`openTab` só são tocados
   DENTRO das funções, chamadas depois do arranque, e resolvem no escopo GLOBAL em
   runtime. Do core importa-se só o que é dono de lá (`esc`). */

import { esc } from "../core";
import { VIEW } from "../app/store/registry";
import { registerActions, callGlobal } from "../app/actions";
import { diffLines, diffStat } from "./diff/domain/diff";

/* ───── matemática do diff: dona é domain/diff.ts (pura, testada); aqui só se consome ───── */

/* ───── corpo do renderer da tab `diff` (era VIEW.diff no monólito) ───── */
function renderDiffView(tab: unknown, host: HTMLElement){const t=tab as { fixed?: boolean; a?: string; b?: string; path: string; label?: string };const a=t.fixed?t.a:(FS[t.path]?FS[t.path].orig:''),b=t.fixed?t.b:(FS[t.path]?FS[t.path].content:''),d=diffLines(a,b),ext=extOf(t.path),s=diffStat(a,b);
  host.innerHTML=`<div class="diff"><div class="diff-h"><b style="color:var(--fg)">${esc(short(t.path))}</b><span class="tag">${esc(t.label||'HEAD ↔ área de trabalho')}</span><span style="color:var(--green)">+${s.add}</span><span style="color:var(--red)">−${s.del}</span><button class="mini" data-action="diff:open" data-on="${esc(t.path)}">Abrir ficheiro</button></div>${d.length?d.map(x=>`<div class="dl ${x[0]==='+'?'add':x[0]==='-'?'del':''}"><span class="n">${x[2]}</span><span class="n">${x[3]}</span><span class="s">${x[0]}</span><span>${hlLine(x[1] as string,ext)||' '}</span></div>`).join(''):'<div class="sec-empty">Sem diferenças.</div>'}</div>`;}

/* ───── lançador de tab diff ───── */
function openDiff(p: string, a?: string, b?: string, label?: string){const fixed=a!==undefined;openTab({id:(fixed?'prop:':'diff:')+p,title:p.split('/').pop()+(fixed?' (proposta)':' (diff)'),kind:'diff',path:p,fixed,a,b,label});}

/* ── publicação no window: nomes que o resíduo (app.ts terminal/v5.ts/codev.ts) e
   os onclick inline resolvem como globais. VIEW.diff (app.ts) delega em
   renderDiffView (shim, no registo de kinds de tab). ── */
Object.assign(window, { openDiff });
window.renderDiffView = renderDiffView;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
VIEW.diff = renderDiffView;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
registerActions({ "diff:open": { click: (c) => void callGlobal("openPath", c.on) } });
