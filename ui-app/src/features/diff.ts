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

import { esc, jsa } from "../core";

/* ───── matemática do diff (puras) ───── */
function diffLines(a: string | null | undefined, b: string | null | undefined){const A=a?a.split('\n'):[],B=b?b.split('\n'):[],n=A.length,m=B.length,L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[];let i=0,j=0;while(i<n&&j<m){if(A[i]===B[j]){out.push([' ',A[i],i+1,j+1]);i++;j++;}else if(L[i+1][j]>=L[i][j+1]){out.push(['-',A[i],i+1,'']);i++;}else{out.push(['+',B[j],'',j+1]);j++;}}
  while(i<n){out.push(['-',A[i],i+1,'']);i++;}while(j<m){out.push(['+',B[j],'',j+1]);j++;}return out;}
function diffStat(a: string | null | undefined, b: string | null | undefined){const d=diffLines(a,b);return{add:d.filter(x=>x[0]==='+').length,del:d.filter(x=>x[0]==='-').length};}

/* ───── corpo do renderer da tab `diff` (era VIEW.diff no monólito) ───── */
function renderDiffView(tab: unknown, host: HTMLElement){const t=tab as { fixed?: boolean; a?: string; b?: string; path: string; label?: string };const a=t.fixed?t.a:(FS[t.path]?FS[t.path].orig:''),b=t.fixed?t.b:(FS[t.path]?FS[t.path].content:''),d=diffLines(a,b),ext=extOf(t.path),s=diffStat(a,b);
  host.innerHTML=`<div class="diff"><div class="diff-h"><b style="color:var(--fg)">${esc(short(t.path))}</b><span class="tag">${esc(t.label||'HEAD ↔ área de trabalho')}</span><span style="color:var(--green)">+${s.add}</span><span style="color:var(--red)">−${s.del}</span><button class="mini" onclick="openPath(${jsa(t.path)})">Abrir ficheiro</button></div>${d.length?d.map(x=>`<div class="dl ${x[0]==='+'?'add':x[0]==='-'?'del':''}"><span class="n">${x[2]}</span><span class="n">${x[3]}</span><span class="s">${x[0]}</span><span>${hlLine(x[1] as string,ext)||' '}</span></div>`).join(''):'<div class="sec-empty">Sem diferenças.</div>'}</div>`;}

/* ───── lançador de tab diff ───── */
function openDiff(p: string, a?: string, b?: string, label?: string){const fixed=a!==undefined;openTab({id:(fixed?'prop:':'diff:')+p,title:p.split('/').pop()+(fixed?' (proposta)':' (diff)'),kind:'diff',path:p,fixed,a,b,label});}

/* ── publicação no window: nomes que o resíduo (app.ts terminal/v5.ts/codev.ts) e
   os onclick inline resolvem como globais. VIEW.diff (app.ts) delega em
   renderDiffView (shim, no registo de kinds de tab). ── */
Object.assign(window, { diffLines, diffStat, openDiff });
window.renderDiffView = renderDiffView;
