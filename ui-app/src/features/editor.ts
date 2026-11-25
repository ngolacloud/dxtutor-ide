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

import { $, esc, toast, rel } from "../core";
import { bus } from "../app/bus";
import { VIEW } from "../app/store/registry";
import { editorOverlay, type OverlayView } from "../app/editor-overlay";
import { lineAnnotation } from "../app/line-annotation";
import { inlineValues } from "../app/inline-values";
import { codevUndo } from "../app/codev-undo";
import { authorOf } from "./scm";

/* ───── overlay (RF-CODEV-STREAM §8): live Co-Dev hunks drawn over the file ─────
   With an overlay view, the textarea shows the view's text (the file plus the proposed
   lines) and each edit goes back to the real file through the overlay; an edit on the
   proposed lines is refused. Without one, nothing changes. */
const VIEWS = new Map<string, OverlayView | null>();
function syncView(p: string): string { const f = FS[p], ov = editorOverlay.get(), v = ov ? ov.view(p, f.content) : null; VIEWS.set(p, v); return v ? v.text : f.content; }
/** Replaces the textarea text keeping the caret where it was relative to the unchanged text. */
function setKeepingCaret(ta: HTMLTextAreaElement, next: string): void {
  const prev = ta.value; if (prev === next) return;
  const pos = ta.selectionStart; let a = 0; while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  ta.value = next; const at = pos <= a ? pos : Math.max(a, pos + next.length - prev.length); ta.setSelectionRange(at, at);
}
editorOverlay.onRepaint((p) => { const ta = $('#ed-ta') as HTMLTextAreaElement | null; if (!ta || ta.dataset.path !== p || !FS[p]) return; setKeepingCaret(ta, syncView(p)); paintEdFull(p); });

/* ───── corpo do renderer da tab `file` (era VIEW.file no monólito) ───── */
function renderFileView(t:{path:string},host:HTMLElement){const f=FS[t.path];host.innerHTML=`<div class="ed"><div class="ed-gut" id="ed-gut"></div><div class="ed-wrap"><div class="ed-hl" id="ed-hl"></div><textarea id="ed-ta" class="ed-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"></textarea></div></div>`;
  const ta=$('#ed-ta') as (HTMLTextAreaElement & { _t?: any })|null;if(!ta)return;ta.dataset.path=t.path;ta.value=syncView(t.path);paintEd(t.path);
  ta.oninput=()=>{codevUndo.forget(t.path);const v=VIEWS.get(t.path),ov=editorOverlay.get();
    if(v&&ov){const real=ov.edit(t.path,v,ta.value,f.content);
      if(real===null){const pos=Math.max(0,ta.selectionStart-1);ta.value=v.text;ta.setSelectionRange(Math.min(pos,v.text.length),Math.min(pos,v.text.length));toast('Estas linhas são uma proposta do Co-Dev: aceita ou rejeita primeiro');return;}
      f.content=real;setKeepingCaret(ta,syncView(t.path));}
    else f.content=ta.value;
    paintEd(t.path);clearTimeout(ta._t);ta._t=setTimeout(()=>refresh(true),180);};
  ta.onkeydown=e=>{
    /* RF-E07: Ctrl+Z right after a Co-Dev block (nothing typed since) puts back the text from before it */
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){const prev=codevUndo.take(t.path);if(prev!==null){e.preventDefault();f.content=prev;ta.value=syncView(t.path);paintEd(t.path);refresh(true);toast('Desfeito o último bloco do Co-Dev');return;}}
    /* Fase 4: snippets e toggle de comentário das extensões VS Code instaladas (feature `ext`). */
    if(e.key==='Tab'&&!e.shiftKey&&window.vsxSnippet&&window.vsxSnippet(ta,t.path)){e.preventDefault();(ta.oninput as any)();return;}
    if((e.ctrlKey||e.metaKey)&&e.key==='/'&&window.vsxToggleComment&&window.vsxToggleComment(ta,t.path)){e.preventDefault();(ta.oninput as any)();return;}
    if(e.key==='Tab'){e.preventDefault();if(!document.execCommand('insertText',false,'    '))ta.setRangeText('    ',ta.selectionStart,ta.selectionEnd,'end');(ta.oninput as any)();}};
  ta.onkeyup=ta.onclick=ta.onfocus=()=>stPos();
  bus.emit('editor:file-view',{path:t.path});/* quem decora a vista do ficheiro (p.ex. o aviso de servidor de linguagem em falta) repõe-se aqui */}

/* ───── pintor do editor (gutter + realce + minimapa a partir dos diagnósticos) ───── */
function paintEd(p:string){const f=FS[p],v=VIEWS.get(p)??null,lines=(v?v.text:f.content).split('\n'),dgReal:Record<number,string>={},ext=extOf(p);diagnostics().forEach(d=>{if(d.p===p&&dgReal[d.line]!=='e')dgReal[d.line]=d.sev;});
  /* with an overlay, diagnostics follow the real line numbers; proposed lines have none */
  const dg:Record<number,string>={};lines.forEach((_,i)=>{const r=v?v.lines[i]?.real:i+1;if(r&&dgReal[r])dg[i+1]=dgReal[r];});
  const num=(i:number)=>{if(!v)return String(i+1);const m=v.lines[i];return m&&m.kind==='new'?'+':m&&m.real?String(m.real):'';};
  const hk=(i:number)=>{const m=v&&v.lines[i];return m&&m.kind!=='ctx'?` hk-${m.kind}${m.writing?' hk-writing':''}`:'';};
  $('#ed-gut')!.innerHTML=lines.map((_,i)=>{const c=((dg[i+1]?`g-${dg[i+1]}`:'')+hk(i)).trim();return `<div${c?` class="${c}"`:''}>${num(i)}</div>`;}).join('');
  /* Fase 4: se uma extensão VS Code instalada traz a gramática TextMate da linguagem, o
     realce é do documento inteiro (com estado entre linhas); senão, o realce de sempre. */
  const tm=window.vsxHighlight?window.vsxHighlight(ext,lines):null;
  $('#ed-hl')!.innerHTML=lines.map((l,i)=>`<div class="l${dg[i+1]?' d-'+dg[i+1]:''}${hk(i)}">${(tm?tm[i]:hlLine(l,ext))||' '}</div>`).join('');
  const mm=$('#minimap')!;mm.classList.remove('hidden');$('#ebody')!.classList.add('with-mm');
  mm.innerHTML='<div class="mm-view"></div>'+lines.slice(0,120).map((l,i)=>`<div class="mm-line${dg[i+1]==='e'?' err':''}" style="width:${l.trim()?Math.max(6,Math.min(52,l.length*.9)):0}px"></div>`).join('');
  const ov=editorOverlay.get(),wrap=$('#ed-hl')!.parentElement;if(v&&ov&&wrap)ov.decorate(p,{wrap,hl:$('#ed-hl')!,gut:$('#ed-gut')!},v);annotateLine();}

/* ───── ajudantes da barra de estado ───── */
function gotoLine(n:number){const ta=$('#ed-ta') as HTMLTextAreaElement|null;if(!ta)return;const ls=ta.value.split('\n');n=Math.max(1,Math.min(ls.length,n|0));let o=0;for(let i=0;i<n-1;i++)o+=ls[i].length+1;ta.focus({preventScroll:true});ta.setSelectionRange(o,o+ls[n-1].length);$('#ebody')!.scrollTop=Math.max(0,(n-1)*22-90);stPos();}
function stPos(){const ta=$('#ed-ta') as HTMLTextAreaElement|null,el=$('#st-pos');if(!el)return;if(!ta){el.textContent='';return;}const b=ta.value.slice(0,ta.selectionStart).split('\n');el.textContent=`Ln ${b.length}, Col ${b[b.length-1].length+1}`;annotateLine();}
function stLang(){const t=tabOf(cur);$('#st-lang')!.textContent=t&&t.path?(LANG[extOf(t.path)]||'Texto'):'';stPos();}
export function edCmd(c:string){const ta=$('#ed-ta') as HTMLTextAreaElement|null;if(!ta){toast('Abre um ficheiro primeiro');return;}ta.focus();if(c==='selectAll')ta.select();else if(c==='line'){const b=ta.value.slice(0,ta.selectionStart).split('\n').length;gotoLine(b);}else{document.execCommand(c);(ta.oninput as any)();}}
function selText(){const ta=$('#ed-ta') as HTMLTextAreaElement|null;return ta?ta.value.slice(ta.selectionStart,ta.selectionEnd):'';}

/* ── publicação no window: nomes que o resíduo (app.ts refresh/show, v6.ts error-lens,
   outline/diagnósticos/palette/menus) e os onclick inline resolvem como globais.
   VIEW.file (app.ts) delega em renderFileView (shim, no registo de kinds de tab). ── */
/* ───── o pintor publicado (ADR-0004, U4g5 — era a decoração do v6.ts) ─────
   Por cima da base: os breakpoints no gutter, a linha onde o gdb parou (ADR-0006, R4) e o
   Error Lens.
   BUG PRÉ-EXISTENTE (reportado, não corrigido aqui): as chamadas internas do editor
   (renderFileView/oninput) usam a base, por isso estas marcas só aparecem quando alguém
   chama o `window.paintEd` — desde a extracção do editor (923a2a5); antes, no app.ts, o
   paintEd era `window.paintEd` e as chamadas internas passavam pela versão decorada. */
const PE = window as unknown as {
  dbgBreaks: Set<string>;
  dbgCurrent?: () => { path: string; line: number } | null;
  builtinOn: (key: string) => boolean;
};
function paintEdFull(p: string): void {
  paintEd(p);
  const gut = $('#ed-gut'), hl = $('#ed-hl'); if (!gut || !hl) return;
  /* breakpoints, the debugger line and Error Lens use real line numbers: skipped while the overlay shows proposed lines */
  if (VIEWS.get(p)) return;
  const gs = gut.children, ls = hl.children;
  [...PE.dbgBreaks].filter((b) => b.startsWith(p + ':')).forEach((b) => { const g = gs[+(b.split(':').pop() as string) - 1]; if (g) g.classList.add('bp'); });
  /* a linha onde o gdb parou (ADR-0006, R4) */
  const cur = PE.dbgCurrent ? PE.dbgCurrent() : null;
  if (cur && cur.path === p && ls[cur.line - 1]) { ls[cur.line - 1].classList.add('dbg-cur'); if (gs[cur.line - 1]) gs[cur.line - 1].classList.add('dbg-cur'); }
  /* A7: os valores das variáveis no fim das linhas acima da paragem (app/inline-values.ts) */
  const iv = inlineValues.of(p); if (iv) Object.entries(iv).forEach(([n, txt]) => { const l = ls[+n - 1]; if (l) l.insertAdjacentHTML('beforeend', `<span class="dv-inline">${esc(txt)}</span>`); });
  if (PE.builtinOn('inline-diagnostics')) { /* «Inline diagnostics», do dxtutor (era o Error Lens a fingir — ADR-0006, R6b) */ const seen: Record<number, 1> = {}; diagnostics().filter((x) => x.p === p).forEach((x) => { if (seen[x.line]) return; seen[x.line] = 1; const l = ls[x.line - 1]; if (l) l.insertAdjacentHTML('beforeend', `<span class="el ${x.sev}">  ${esc(x.msg)}</span>`); }); }
}

/* nomes das linguagens na barra de estado (ADR-0004, U4j3 — era do app.ts; o boot4/boot6 acrescentam) */
const LANG: Record<string, string>={rs:'Rust',ts:'TypeScript',css:'CSS',json:'JSON',toml:'TOML',md:'Markdown',sql:'SQL',html:'HTML'};
/* o último commit que tocou no ficheiro activo, na barra de estado (ADR-0004, U4j4a — era do app.ts). O stLang
   PUBLICADO acrescenta-o, como a decoração do app.ts fazia; as chamadas internas ao stLang local continuam sem ele. */
/* A4 (docs/v2/UI-AUDIT.md item 9): o que o blame diz da linha do cursor, no fim dessa linha (o registo
   app/line-annotation.ts; sem anotador — no browser — não há nada). Não se mostra sobre uma proposta do Co-Dev. */
function annotateLine(): void {
  const hl = $('#ed-hl'), ta = $('#ed-ta') as HTMLTextAreaElement | null;
  if (!hl) return;
  hl.querySelectorAll('.bl-inline').forEach((x) => x.remove());
  const la = lineAnnotation.get(), p = ta?.dataset.path;
  if (!la || !ta || !p || VIEWS.get(p)) return;
  const ln = ta.value.slice(0, ta.selectionStart).split('\n').length, txt = la.inline(p, ln), row = hl.children[ln - 1];
  if (txt && row) row.insertAdjacentHTML('beforeend', `<span class="bl-inline">${esc(txt)}</span>`);
  blame();
}
lineAnnotation.onRedraw(() => annotateLine());
function blame(): void{const BG=window as unknown as { GIT: { order: string[]; c: Record<string, { a: string; t: number; m: string; h: string; files: string[] }> }; stOf: (p: string) => unknown; authorOf: (a: string) => { n: string }; openGraph: (h?: string) => void };const GIT=BG.GIT,stOf=BG.stOf,openGraph=BG.openGraph;const el=$('#st-blame'),t=tabOf(cur);if(!el)return;if(!t||!t.path||t.kind!=='file'){el.textContent='';return;}const la=lineAnnotation.get();if(la){const ta=$('#ed-ta') as HTMLTextAreaElement|null,ln=ta&&ta.dataset.path===t.path?ta.value.slice(0,ta.selectionStart).split('\n').length:1,st=la.status(t.path,ln);if(st){el.textContent=st.text;el.title=st.title;el.onclick=st.open;return;}}const h=GIT.order.find(x=>GIT.c[x]&&GIT.c[x].files.includes(t.path!)),c=h?GIT.c[h]:null;if(!c){/* nenhum commit do espelho toca o ficheiro (o syncGit dá files:[]; sem repo não há commits): só o estado local — ADR-0006, R1d */el.textContent=stOf(t.path)?'Tu · alterações por commitar':'';el.onclick=null;return;}el.textContent=stOf(t.path)?'Tu · alterações por commitar':`${authorOf(c.a).n}, ${rel(c.t)} · ${c.m.slice(0,38)}`;el.onclick=()=>openGraph(c.h);}
function stLangWithBlame(): void { stLang(); blame(); }
/* e corre a cada mudança do workspace (era o fim do subscritor do app.ts) */
bus.on('workspace:changed',()=>{blame();});
Object.assign(window, { paintEd: paintEdFull, gotoLine, stPos, blame, selText });
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
VIEW.file = (t, host) => renderFileView(t as { path: string }, host);

export { LANG };
/* o stLang com o blame (o publicado antes): os separadores importam-no (ADR-0004, U7m) */
export { stLangWithBlame as stLang };
