/* ═════════ dxtutor IDE — feature: Editor (vista de edição de ficheiros + barra de estado) ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o subsistema EDITOR que
   vivia no monólito `app.ts` (secção `/* editor de ficheiros *​/`): o corpo do renderer
   da tab `file` (agora `renderFileView(t,host)`: textarea/gutter/realce, liga
   oninput→paintEd+refresh, onkeydown Tab, onkeyup/onclick/onfocus→stPos), o pintor
   `paintEd` (gutter + realce `hlLine` + minimapa a partir de `diagnostics`), e os
   ajudantes da barra de estado `gotoLine`/`stPos`/`stLang`/`edCmd`/`selText`.

   Fronteira: a feature é DONA destas sete peças. Os CONSUMIDORES ficam no monólito e
   lêem por nome livre (global): `paintEd` (app.ts `refresh` + v6.ts error-lens),
   `gotoLine` (outline/diagnósticos-openPath/palette/menus), `stLang`/`stPos`
   (app.ts `show`/`refresh`), `edCmd`/`selText` (menus Edit/Selection + v6). `VIEW.file`
   nasce em app.ts (registo de kinds de tab) e fica lá como SHIM:
   `VIEW.file=(t,host)=>window.renderFileView(t,host)`.

   Decorador: app.ts envolve `stLang` com `blame` (secção v3). Como `stLang` passa a ser
   `window.stLang`, essa reatribuição fica window-backed e envolve a função da feature.

   Mecânica (igual às migrações anteriores): a feature avalia ANTES de `app.ts`
   (ordem do index.html) e publica tudo no `window` no eval. Nada é lido ansiosamente —
   `FS`/`extOf`/`LANG`/`diagnostics`/`hlLine`/`tabOf`/`cur`/`short`/`refresh` só são
   tocados DENTRO das funções, chamadas depois do arranque, e resolvem no escopo GLOBAL
   em runtime. Do core importa-se só o que é dono de lá (`$`, `toast`). */

import { $, esc, toast } from "../core";
import { VIEW } from "../app/store/registry";

/* ───── corpo do renderer da tab `file` (era VIEW.file no monólito) ───── */
function renderFileView(t:{path:string},host:HTMLElement){const f=FS[t.path];host.innerHTML=`<div class="ed"><div class="ed-gut" id="ed-gut"></div><div class="ed-wrap"><div class="ed-hl" id="ed-hl"></div><textarea id="ed-ta" class="ed-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"></textarea></div></div>`;
  const ta=$('#ed-ta') as (HTMLTextAreaElement & { _t?: any })|null;if(!ta)return;ta.value=f.content;paintEd(t.path);
  ta.oninput=()=>{f.content=ta.value;paintEd(t.path);clearTimeout(ta._t);ta._t=setTimeout(()=>refresh(true),180);};
  ta.onkeydown=e=>{
    /* Fase 4: snippets e toggle de comentário das extensões VS Code instaladas (feature `ext`). */
    if(e.key==='Tab'&&!e.shiftKey&&window.vsxSnippet&&window.vsxSnippet(ta,t.path)){e.preventDefault();(ta.oninput as any)();return;}
    if((e.ctrlKey||e.metaKey)&&e.key==='/'&&window.vsxToggleComment&&window.vsxToggleComment(ta,t.path)){e.preventDefault();(ta.oninput as any)();return;}
    if(e.key==='Tab'){e.preventDefault();if(!document.execCommand('insertText',false,'    '))ta.setRangeText('    ',ta.selectionStart,ta.selectionEnd,'end');(ta.oninput as any)();}};
  ta.onkeyup=ta.onclick=ta.onfocus=()=>stPos();}

/* ───── pintor do editor (gutter + realce + minimapa a partir dos diagnósticos) ───── */
function paintEd(p:string){const f=FS[p],lines=f.content.split('\n'),dg:Record<number,string>={},ext=extOf(p);diagnostics().forEach(d=>{if(d.p===p&&dg[d.line]!=='e')dg[d.line]=d.sev;});
  $('#ed-gut')!.innerHTML=lines.map((_,i)=>`<div${dg[i+1]?` class="g-${dg[i+1]}"`:''}>${i+1}</div>`).join('');
  /* Fase 4: se uma extensão VS Code instalada traz a gramática TextMate da linguagem, o
     realce é do documento inteiro (com estado entre linhas); senão, o realce de sempre. */
  const tm=window.vsxHighlight?window.vsxHighlight(ext,lines):null;
  $('#ed-hl')!.innerHTML=lines.map((l,i)=>`<div class="l${dg[i+1]?' d-'+dg[i+1]:''}">${(tm?tm[i]:hlLine(l,ext))||' '}</div>`).join('');
  const mm=$('#minimap')!;mm.classList.remove('hidden');$('#ebody')!.classList.add('with-mm');
  mm.innerHTML='<div class="mm-view"></div>'+lines.slice(0,120).map((l,i)=>`<div class="mm-line${dg[i+1]==='e'?' err':''}" style="width:${l.trim()?Math.max(6,Math.min(52,l.length*.9)):0}px"></div>`).join('');}

/* ───── ajudantes da barra de estado ───── */
function gotoLine(n:number){const ta=$('#ed-ta') as HTMLTextAreaElement|null;if(!ta)return;const ls=ta.value.split('\n');n=Math.max(1,Math.min(ls.length,n|0));let o=0;for(let i=0;i<n-1;i++)o+=ls[i].length+1;ta.focus({preventScroll:true});ta.setSelectionRange(o,o+ls[n-1].length);$('#ebody')!.scrollTop=Math.max(0,(n-1)*22-90);stPos();}
function stPos(){const ta=$('#ed-ta') as HTMLTextAreaElement|null,el=$('#st-pos');if(!el)return;if(!ta){el.textContent='';return;}const b=ta.value.slice(0,ta.selectionStart).split('\n');el.textContent=`Ln ${b.length}, Col ${b[b.length-1].length+1}`;}
function stLang(){const t=tabOf(cur);$('#st-lang')!.textContent=t&&t.path?(LANG[extOf(t.path)]||'Texto'):'';stPos();}
function edCmd(c:string){const ta=$('#ed-ta') as HTMLTextAreaElement|null;if(!ta){toast('Abre um ficheiro primeiro');return;}ta.focus();if(c==='selectAll')ta.select();else if(c==='line'){const b=ta.value.slice(0,ta.selectionStart).split('\n').length;gotoLine(b);}else{document.execCommand(c);(ta.oninput as any)();}}
function selText(){const ta=$('#ed-ta') as HTMLTextAreaElement|null;return ta?ta.value.slice(ta.selectionStart,ta.selectionEnd):'';}

/* ── publicação no window: nomes que o resíduo (app.ts refresh/show, v6.ts error-lens,
   outline/diagnósticos/palette/menus) e os onclick inline resolvem como globais.
   VIEW.file (app.ts) delega em renderFileView (shim, no registo de kinds de tab). ── */
/* ───── o pintor publicado (ADR-0004, U4g5 — era a decoração do v6.ts) ─────
   Por cima da base: os breakpoints no gutter, a linha corrente do depurador e o Error Lens.
   BUG PRÉ-EXISTENTE (reportado, não corrigido aqui): as chamadas internas do editor
   (renderFileView/oninput) usam a base, por isso estas marcas só aparecem quando alguém
   chama o `window.paintEd` — desde a extracção do editor (923a2a5); antes, no app.ts, o
   paintEd era `window.paintEd` e as chamadas internas passavam pela versão decorada. */
const PE = window as unknown as {
  dbgBreaks: Set<string>; dbgState: () => { kind: string; steps: { l: number }[]; i: number } | null;
  vsxOn: (id: string) => boolean; P_LX: string;
};
function paintEdFull(p: string): void {
  paintEd(p);
  const gut = $('#ed-gut'), hl = $('#ed-hl'); if (!gut || !hl) return;
  const gs = gut.children, ls = hl.children;
  [...PE.dbgBreaks].filter((b) => b.startsWith(p + ':')).forEach((b) => { const g = gs[+(b.split(':').pop() as string) - 1]; if (g) g.classList.add('bp'); });
  const _ds = PE.dbgState();
  if (_ds && _ds.kind === 'code' && p === PE.P_LX) { const s = _ds.steps[_ds.i]; if (s && ls[s.l - 1]) { ls[s.l - 1].classList.add('dbg-cur'); if (gs[s.l - 1]) gs[s.l - 1].classList.add('dbg-cur'); } }
  if (PE.vsxOn('usernamehw.errorlens')) { const seen: Record<number, 1> = {}; diagnostics().filter((x) => x.p === p).forEach((x) => { if (seen[x.line]) return; seen[x.line] = 1; const l = ls[x.line - 1]; if (l) l.insertAdjacentHTML('beforeend', `<span class="el ${x.sev}">  ${esc(x.msg)}</span>`); }); }
}

/* nomes das linguagens na barra de estado (ADR-0004, U4j3 — era do app.ts; o boot4/boot6 acrescentam) */
const LANG: Record<string, string>={rs:'Rust',ts:'TypeScript',css:'CSS',json:'JSON',toml:'TOML',md:'Markdown',sql:'SQL',html:'HTML'};
Object.assign(window, { LANG, renderFileView, paintEd: paintEdFull, gotoLine, stPos, stLang, edCmd, selText });
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
VIEW.file = (t, host) => renderFileView(t as { path: string }, host);

export { LANG };
