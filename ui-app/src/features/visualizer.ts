/* ═════════ dxtutor IDE — feature `visualizer`: RESÍDUO strangler + overlay (ADR-0002) ═════════
   Extraída para Clean Architecture em `features/visualizer/` (Fases 0–4). O MOTOR
   PURO (lexer `vzLex`, parser `vzParse`, inferência `vzHints`, interpretador com
   modelo de memória `vzRun`, narração `vzTell`, catálogo `VZS`, constantes) vive
   agora em `visualizer/domain/` — importado acima e re-publicado no window abaixo.
   Aqui fica só o OVERLAY (`vizOpen`/`vzRender`/`vzArrows` + controlos) e a cablagem
   `boot7`, como o markup do board/scm/debug vive no resíduo.

   Do core importa-se o que já lá é tipado (`$`, `esc`, `svg`, `show`, `toast`).
   O restante núcleo ainda dono do monólito/boot é resolvido por nome livre via
   window em runtime — as funções que o tocam só correm DEPOIS do arranque
   (cliques, e `boot7()` chamado por startup.ts): FS, cur, tabOf, short, hlLine,
   SAMPLE, PROV, md, LOCALE, LS, MENUS, CMD, EACT, VIEW, buildMenubar, LTS, P.

   Ordem: carrega entre as features e app.ts (ANTES de app.ts/v5/v6). No eval só
   toca `window.P` (biblioteca de ícones de boot.ts, que carrega primeiro) e
   publica no window os nomes que o arranque e os `onclick` inline consomem
   (`boot7`, `vizOpen`, `vizClose`, `vizFromEditor`, `vzGo`/`vzPlay`/`vzAnswer`/
   `vzAsk`, `VZ`, `VZS`). `boot7()` só é invocado por startup.ts, quando EACT/
   MENUS/CMD/VIEW/buildMenubar já existem.

   O resíduo é FORA da subárvore governada por A7/A8 (transitório, estrangula-se quando os
   consumidores — i18n/startup/onclick inline — migrarem). ADR-0004, U4i2: tipado (era
   @ts-nocheck) — só anotações, casts e declarações: o JavaScript emitido é o mesmo. */
import { $, esc, svg, show, toast } from "../core";
import { publish } from "./visualizer/infrastructure/legacy-bridge";
import { vzErr, vzLex } from "./visualizer/domain/lexer";
import { vzParse } from "./visualizer/domain/parser";
import { vzHints } from "./visualizer/domain/hints";
import { vzRun } from "./visualizer/domain/interpreter";
import { vzTell, VZSEEN } from "./visualizer/domain/narrate";
import { VZS } from "./visualizer/domain/samples";
import { hex } from "./visualizer/domain/constants";
import { buildVisualization } from "./visualizer/application/visualize";
import { bindActions } from "./visualizer/ui/actions";
import type { VzNote, VzRunResult, VzSlot } from "./visualizer/domain/types";
import type { VizError } from "./visualizer/application/visualize";
import { translator } from "../app/i18n";
import { VISUALIZER_MESSAGES } from "./visualizer/ui/messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(VISUALIZER_MESSAGES);
export {};

/** Uma pergunta do modo «prever»: o enunciado e a resposta certa. */
interface VzQuestion { q: string; a: string }
/** O estado do overlay (window-backed em `window.VZ`). */
interface VzOverlay {
  src: string; title: string; origin: string | null; i: number;
  timer: ReturnType<typeof setInterval> | null; speed: number; depth: string; predict: boolean;
  guess: null; ans: { ok: boolean; v: string; a: string } | null;
  res: VzRunResult | null; err: VizError | null; notes: Record<number, VzNote[]>;
  pending?: { i: number; q: VzQuestion } | null; score?: { ok: number; n: number };
}
declare global {
  interface Window { VZ: VzOverlay | null }
  const md: (t: unknown) => string;
  const P: Record<string, string>;
  const EACT: [string, string, string, string][];
  const LTS: { lang: string };
}

P.film='<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 2.5v11M11 2.5v11M2 5.5h3M2 8h3M2 10.5h3M11 5.5h3M11 8h3M11 10.5h3"/>';

/* ───── motor (lexer/parser/hints/interpretador/narração/exemplos) extraído para
   `visualizer/domain/` (ADR-0002, Fase 2): PURO, importado acima e re-publicado no
   window abaixo para os consumidores que o resolvem por global (i18n, paleta). O
   interpretador (`vzRun`) é o único @ts-nocheck da subárvore. Aqui fica só o overlay. ── */
/* null até ao primeiro vizOpen; os controlos só correm com o overlay aberto (as guardas `if(!VZ)` ficam onde já estavam) */
let VZ=null as unknown as VzOverlay;
function vizOpen(src: string,title: string,origin?: string|null){let o=$('#viz');if(!o){document.body.insertAdjacentHTML('beforeend','<div id="viz"></div>');o=$('#viz');}clearInterval((VZ||{}).timer!);
  /* window-backed: VZ é o único estado reatribuído (aqui); os onclick da barra correm
     no scope global e lêem `VZ` → window.VZ. Atribuição em cadeia mantém o MESMO objecto
     em ambos, por isso mutações (.i/.pending/.timer, via onclick OU via funções do módulo)
     propagam. Corrige o desync pré-existente que partia os botões Step/depth/re-run/predict. */
  VZ=window.VZ={src,title,origin:origin||null,i:0,timer:null,speed:LS.get('vzspeed',5),depth:LS.get('vzdepth','memory'),predict:LS.get('vzpred',false),guess:null,ans:null,res:null,err:null,notes:{}} as VzOverlay;
  /* a orquestração (correr + construir notas, incl. tratamento de erro) vive no caso
     de uso `buildVisualization` (application/); aqui só injectamos as portas do domínio
     e copiamos o resultado para o estado window-backed antes de pintar. */
  const c=buildVisualization(src,{run:vzRun,narrate:vzTell,resetSeen:()=>VZSEEN.clear()});
  VZ.res=c.res;VZ.err=c.err;VZ.notes=c.notes;
  o!.classList.add('show');vzRender();}
function vizClose(){const o=$('#viz');if(o)o.classList.remove('show');if(VZ)clearInterval(VZ.timer!);}
function vizFromEditor(){const t=tabOf(cur) as { kind?: string; path?: string } | undefined;let p=t&&t.path&&FS[t.path]?t.path:null;if(t&&t.kind==='lt')p=t.path!;
  if(p&&/\.go$/.test(p)){toast('The visualizer runs a Rust subset; Go is not supported yet — showing a Rust example');vizOpen(VZS.sum[1],VZS.sum[0]);return;}
  if(p&&/\.rs$/.test(p)&&/fn\s+main\s*\(/.test(FS[p].content)){vizOpen(FS[p].content,short(p),p);return;}
  if(p&&/\.rs$/.test(p))toast('This file has no fn main — opening an example');vizOpen(VZS.sum[1],VZS.sum[0]);}
function vzGo(i: number){if(!VZ||!VZ.res)return;const n=VZ.res.steps.length;i=Math.max(0,Math.min(n-1,i));if(VZ.predict&&i===VZ.i+1&&!VZ.pending){const q=vzQuestion(i);if(q){VZ.pending={i,q};VZ.ans=null;vzRender();return;}}VZ.pending=null;VZ.i=i;vzRender();}
function vzQuestion(i: number): VzQuestion|null{const e=VZ.res!.steps[i].ev.find(x=>x.k==='set'||(x.k==='bind'&&/^-?\d+(\.\d+)?$/.test(x.val as string))||(x.k==='push')||x.k==='grow');if(!e)return null;
  if(e.k==='grow')return{q:`The next push needs room. What will the new capacity of \`${e.name}\` be?`,a:String(e.nc)};if(e.k==='push')return{q:`After this push, what is the capacity of \`${e.name}\`?`,a:String(e.cap)};
  if(!/^-?\d+(\.\d+)?$/.test(e.val as string))return null;return{q:`What will \`${e.name}\` be after line ${VZ.res!.steps[i].line}?`,a:e.val as string};}
function vzAnswer(){const v=(($('#vz-guess') as HTMLInputElement|null)||({} as {value?: string})).value;if(v==null||v==='')return;const p=VZ.pending!,ok=v.trim()===p.q.a;VZ.ans={ok,v,a:p.q.a};VZ.score=VZ.score||{ok:0,n:0};VZ.score.n++;if(ok)VZ.score.ok++;VZ.i=p.i;VZ.pending=null;vzRender();}
function vzPlay(){if(!VZ)return;if(VZ.timer){clearInterval(VZ.timer);VZ.timer=null;vzRender();return;}if(VZ.predict){VZ.predict=false;LS.set('vzpred',false);}if(VZ.i>=VZ.res!.steps.length-1)VZ.i=0;VZ.timer=setInterval(()=>{if(!VZ||VZ.i>=VZ.res!.steps.length-1){clearInterval(VZ.timer!);VZ.timer=null;vzRender();return;}VZ.i++;vzRender();},1300-VZ.speed*115);vzRender();}
async function vzAsk(){const st=VZ.res!.steps[VZ.i],box=$('#vz-askout')!;if(!SAMPLE||!PROV.claude.on){box.innerHTML='<p>Live answers need Claude, which is available when this page is opened in claude.ai. The notes above are what the model of Rust knows about this step.</p>';return;}
  const fr=st.frames.map(f=>`${f.fn}: `+f.slots.map(s=>`${s.name}: ${s.ty} = ${s.st==='moved'?'(moved)':s.val}`).join(', ')).join(' | '),notes=(VZ.notes[VZ.i]||[]).map(n=>(n.t||'').replace(/<[^>]+>/g,'')).join(' ');
  box.innerHTML='<span class="spin"></span> thinking…';try{const r=await SAMPLE(`You are a senior Rust engineer teaching. Program:\n${VZ.src}\nCurrent step ${VZ.i+1}, line ${st.line}. Frames: ${fr}. What happened: ${notes}\nExplain what is really happening in memory and on the CPU at this step, and one thing a senior would notice. Be concrete and short (under 120 words). Answer in ${LOCALE==='en'?'English':'Portuguese (Angola)'}.`,{cache:false,modelTier:'quick',onText:({text}: {text: string})=>{box.innerHTML=md(text);}});box.innerHTML=md(r.text);}catch(e){box.innerHTML='<p>Could not get an answer right now.</p>';}}
function vzRender(){const o=$('#viz');if(!o||!VZ)return;const R=VZ.res,n=R?R.steps.length:0,st=R?R.steps[VZ.i]:null,lines=VZ.src.split('\n'),errL=VZ.err?VZ.err.vline:(R&&R.end&&(R.end.comp||R.end.panic)?R.end.line:0);
  const hits: Record<number, number>={};if(R)for(let k=0;k<=VZ.i;k++){const l=R.steps[k].line;hits[l]=(hits[l]||0)+1;}const hmax=Math.max(1,...Object.values(hits));const prevL=R&&VZ.i>0?R.steps[VZ.i-1].line:0;
  const code=lines.map((l,k)=>{const ln=k+1,curL=st&&st.line===ln;return `<div class="vl${curL?' cur':''}${ln===prevL&&!curL?' prev':''}${errL===ln&&(!R||VZ.i===n-1)?' err':''}" id="vl-${ln}"><span class="va">${curL?'▶':''}</span><span class="vn">${ln}</span><span class="vh" title="${hits[ln]||0} time(s) so far"><i style="width:${(hits[ln]||0)/hmax*100}%"></i></span><span class="vc">${hlLine(l,'rs')||' '}</span></div>`;}).join('');
  const D=VZ.depth;let right='';
  if(VZ.err)right=`<div class="vz-card bad"><h3>Can't visualize this program</h3><p>${esc(VZ.err.message)}${VZ.err.vline?` <span class="vz-ln">line ${VZ.err.vline}</span>`:''}</p><p class="vz-mute">The browser runs a model of a teaching subset of Rust: functions, <code>let</code>, loops, <code>if</code>, integers, floats, <code>bool</code>, <code>char</code>, arrays, <code>Vec</code>, <code>String</code>, <code>&str</code>, references and the common methods.</p><p>Try an example from the list above.</p></div>`;
  else{const notes=(VZ.notes[VZ.i]||[]).filter(x=>D==='machine'||x.k!=='ovf'),end=R!.end,last=VZ.i===n-1;
    right+=`<div class="vz-card"><div class="vz-h"><span class="vz-ln">step ${VZ.i+1} · line ${st!.line}</span><span class="vz-fn">${txt("in")} <b>${esc(st!.frames[st!.frames.length-1].fn)}</b></span>${st!.extra&&st!.extra.retFrom?'<span class="tag">return</span>':''}</div>
      ${VZ.pending?`<div class="vz-pred"><b>Predict before you look.</b><p>${esc(VZ.pending.q.q).replace(/`([^`]+)`/g,'<code>$1</code>')}</p><div><input id="vz-guess" class="inp" style="margin:0;width:140px" autocomplete="off"><button class="mini pri" data-action="vz-answer">Check</button><button class="mini" data-action="vz-just-show">Just show me</button></div></div>`:''}
      ${VZ.ans?`<div class="vz-ans ${VZ.ans.ok?'ok':'no'}">${VZ.ans.ok?`✓ Right — ${esc(VZ.ans.a)}.`:`✗ You said ${esc(VZ.ans.v)}; it is <b>${esc(VZ.ans.a)}</b>. Read the notes below to see why.`}</div>`:''}
      ${VZ.pending?'':notes.length?notes.map(x=>`<div class="vz-n">${x.t||''}${D==='machine'&&x.m?`<div class="vz-m">${svg('layers')}<span>${x.m}</span></div>`:''}</div>`).join(''):'<div class="vz-n vz-mute">No visible change at this step.</div>'}
      ${VZ.pending?'':notes.filter(x=>x.i).map(x=>`<div class="vz-ins">${svg('bulb')}<span>${x.i![1]}</span></div>`).join('')}
      ${last&&end?`<div class="vz-end ${end.ok?'ok':'bad'}">${end.ok?'✓ Program finished normally.':end.limit?'Stopped after 1500 steps.':end.comp?`✖ Does not compile (error[${end.comp}]).`:'✖ The program panicked.'}${VZ.score&&VZ.score.n?` · predictions ${VZ.score.ok}/${VZ.score.n}`:''}</div>`:''}
      <div class="vz-ask"><button class="mini" data-action="vz-ask">Ask why</button><div id="vz-askout"></div></div></div>`;
    if(D==='basic'){const f=st!.frames[st!.frames.length-1];right+=`<div class="vz-sec"><div class="vz-t">Variables</div>${f.slots.filter(s=>s.name!=='(temp)').map(s=>`<div class="vz-var${s.st==='moved'?' mv':''}"><b>${esc(s.name)}</b><span class="ty">${esc(s.ty)}</span><span class="v">${s.st==='moved'?`moved → ${esc(s.mvTo||'?')}`:esc(s.val)}</span></div>`).join('')||'<div class="vz-mute">No locals in this frame yet.</div>'}</div><div class="vz-sec"><div class="vz-t">Call stack</div>${st!.frames.slice().reverse().map((f,k)=>`<div class="vz-cs${k?'':' on'}"><span>${st!.frames.length-1-k}</span>${esc(f.fn)}<small>line ${f.line}</small></div>`).join('')}</div>`;}
    else{const borrowed: Record<string, {by: string; mut: boolean}[]>={};st!.frames.forEach(f=>f.slots.forEach(s=>{if(s.ref){const k=s.ref.fi+':'+s.ref.si;(borrowed[k]=borrowed[k]||[]).push({by:s.name,mut:s.ref.mut});}}));
      const slotH=(s: VzSlot)=>{const b=borrowed[s.fi+':'+s.si];return `<div class="vz-slot${s.st==='moved'?' mv':''}${s.name==='(temp)'?' tmp':''}" id="vs-${s.fi}-${s.si}" ${s.ptr?`data-ptr="${s.ptr}"`:''} ${s.ref?`data-ref="${s.ref.fi}-${s.ref.si}${s.ref.idx!=null?'-'+s.ref.idx:''}" data-mut="${s.ref.mut?1:0}"`:''} ${s.ro!=null?`data-ro="${s.ro}"`:''}>
        <div class="vz-sh"><b>${esc(s.name)}</b>${s.mut?'<span class="tag">mut</span>':''}<span class="ty">${esc(s.ty)}</span>${D==='machine'?`<span class="ad">${hex(s.addr)} · ${s.size} B</span>`:`<span class="ad">${s.size} B</span>`}</div>
        ${s.st==='moved'?`<div class="vz-mvd">moved → ${esc(s.mvTo||'?')} at line ${s.mvAt}</div>`:s.arr?`<div class="vz-cells">${s.arr.map((c,k)=>`<span id="vs-${s.fi}-${s.si}-${k}"><i>${k}</i>${esc(c)}</span>`).join('')}</div>`:s.ptr&&s.hdr?`<div class="vz-hdr"><span><i>ptr</i>${s.hdr.addr?(D==='machine'?hex(s.hdr.addr).slice(-6):'●'):'dangling'}</span><span><i>cap</i>${s.hdr.cap}</span><span><i>len</i>${s.hdr.len}</span></div>`:`<div class="vz-val">${esc(s.val)}</div>`}
        ${b?`<div class="vz-bw">${b.map(x=>`borrowed ${x.mut?'mutably ':''}by <b>${esc(x.by)}</b>`).join(', ')}</div>`:''}</div>`;};
      right+=`<div class="vz-mem" id="vz-mem"><svg id="vz-arrows"></svg><div class="vz-col"><div class="vz-t">Stack <span class="vz-mute">grows ↓</span></div>${st!.frames.map((f,k)=>`<div class="vz-frame${k===st!.frames.length-1?' on':''}"><div class="vz-fh"><b>${esc(f.fn)}</b><span>line ${f.line}</span>${D==='machine'?`<span class="ad">rsp ${hex(f.sp)}</span>`:''}</div>${D==='machine'&&k?'<div class="vz-slot ra"><div class="vz-sh"><b>return address</b><span class="ad">8 B</span></div><div class="vz-val vz-mute">back into '+esc(st!.frames[k-1].fn)+' after line '+st!.frames[k-1].line+'</div></div>':''}${f.slots.map(slotH).join('')||'<div class="vz-mute" style="padding:6px 8px">No locals yet.</div>'}</div>`).join('')}</div>
        <div class="vz-col"><div class="vz-t">Heap</div>${st!.heap.length?st!.heap.map(h=>`<div class="vz-blk${h.freed?' freed':''}" id="vh-${h.id}"><div class="vz-sh"><b>${h.kind==='vec'?'Vec buffer':'String bytes'}</b><span class="ty">len ${h.len} · cap ${h.cap}</span>${h.cap?`<span class="ad">${D==='machine'?hex(h.addr)+' · ':''}${h.cap*h.es} B</span>`:''}</div>${h.cap?`<div class="vz-cells heap">${Array.from({length:h.cap},(_,k)=>k<h.cells.length?`<span id="vh-${h.id}-${k}"><i>${k}</i>${esc(h.cells[k])}</span>`:'<span class="spare"><i>'+k+'</i>·</span>').join('')}</div>`:'<div class="vz-mute" style="padding:4px 8px">no buffer yet (capacity 0)</div>'}${h.freed?'<div class="vz-mvd">freed</div>':''}</div>`).join(''):'<div class="vz-mute" style="padding:6px 2px">Nothing on the heap.</div>'}
        ${st!.ro.length?`<div class="vz-t" style="margin-top:12px">Read-only data</div>${st!.ro.map(r=>`<div class="vz-blk ro" id="vr-${r.id}"><div class="vz-sh"><b>${esc(JSON.stringify(r.s))}</b><span class="ad">${D==='machine'?hex(r.addr)+' · ':''}${r.len} B</span></div></div>`).join('')}`:''}</div></div>`;}
    right+=`<div class="vz-sec"><div class="vz-t">Output</div><pre class="vz-out">${esc(st!.out)}${st!.err?`<span class="e">${esc(st!.err)}</span>`:''}</pre></div>`;
    if(D==='machine'){const c=st!.cnt;right+=`<div class="vz-sec"><div class="vz-t">Counters so far</div><div class="vz-cnt">${[['calls',c.calls],['max stack depth',c.maxDepth],['heap allocations',c.allocs],['reallocations',c.reallocs],['frees',c.frees],['live heap',c.live+' B'],['peak heap',c.peak+' B'],['bytes copied',c.copied+' B'],['moves',c.moves],['bounds checks',c.bounds],['overflow checks',c.ovf],['write syscalls',c.writes]].map(x=>`<div><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div><p class="vz-mute">Counted by the model as a debug build would do them; the optimiser removes many checks and frames in release.</p></div>`;}}
  const smp=`<select class="mini" data-action="vz-pick">${VZ.origin?`<option value="__ed" selected>${esc(short(VZ.origin))}</option>`:''}${Object.entries(VZS).map(([k,v])=>`<option value="${k}"${!VZ.origin&&VZ.src===v[1]?' selected':''}>${v[0]}</option>`).join('')}</select>`;
  o.innerHTML=`<div class="vz-box"><div class="vz-top">${svg('film')}<b>Visualize execution</b><span class="tag live">STEP BY STEP</span>${smp}<div class="seg vz-depth">${[['basic','Basic'],['memory','Memory'],['machine','Machine']].map(([k,l])=>`<button class="${D===k?'on':''}" data-action="vz-depth" data-on="${k}">${l}</button>`).join('')}</div><label class="vz-pl"><input type="checkbox" ${VZ.predict?'checked':''} data-action="vz-predict"> Predict mode</label><span class="sp"></span>${VZ.origin?`<button class="mini pri" data-action="vz-rerun">▶ Re-run</button>`:''}<button class="vz-x" title="Close (Esc)" data-action="vz-close">×</button></div>
   ${R?`<div class="vz-bar"><button class="mini" data-action="vz-back" title="Step back (←)">◀ Step back</button><button class="mini pri" data-action="vz-play" title="Play / pause (Space)">${VZ.timer?'❙❙ Pause':'▶ Play'}</button><button class="mini" data-action="vz-step" title="Step (→)">Step ▶</button><span class="vz-sl">${txt("speed")}<input type="range" min="1" max="10" value="${VZ.speed}" data-action="vz-speed"></span><span class="vz-pg">${VZ.i+1} / ${n}</span><div class="vz-prog" data-action="vz-seek" data-on="${n}"><i style="width:${n>1?VZ.i/(n-1)*100:100}%"></i>${R.steps.map((s,k)=>s.ev.some(e=>['alloc','grow','free'].includes(e.k))?`<b style="left:${n>1?k/(n-1)*100:0}%" class="m"></b>`:s.ev.some(e=>['panic','comp'].includes(e.k))?`<b style="left:${n>1?k/(n-1)*100:0}%" class="x"></b>`:'').join('')}</div></div>`:''}
   <div class="vz-main"><div class="vz-code" id="vz-code">${code}</div><div class="vz-right" id="vz-right">${right}</div></div>
   <div class="vz-foot">${svg('layers')} A model of a debug build, run in your browser: values and control flow are exact for this Rust subset; addresses are illustrative and the machine notes describe typical x86-64 output.</div></div>`;
  const cl=$('#vl-'+(st?st.line:errL));if(cl)cl.scrollIntoView({block:'nearest'});const g=$('#vz-guess');if(g){g.focus();g.onkeydown=e=>{if(e.key==='Enter')vzAnswer();};}requestAnimationFrame(vzArrows);}
function vzArrows(){const m=$('#vz-mem'),sv=$('#vz-arrows');if(!m||!sv)return;const R=m.getBoundingClientRect();sv.setAttribute('width',R.width as unknown as string);sv.setAttribute('height',m.scrollHeight as unknown as string);let out='';const pt=(el: Element,side: string)=>{const r=el.getBoundingClientRect();return[side==='l'?r.left-R.left:side==='r'?r.right-R.left:r.left-R.left+r.width/2,r.top-R.top+Math.min(r.height/2,16)];};
  m.querySelectorAll<HTMLElement>('[data-ptr]').forEach(s=>{const h=$('#vh-'+s.dataset.ptr);if(!h)return;const a=pt(s,'r'),b=pt(h,'l');out+=`<path d="M${a[0]-4} ${a[1]} C${a[0]+40} ${a[1]} ${b[0]-40} ${b[1]} ${b[0]-2} ${b[1]}" class="ar heap" marker-end="url(#vzh)"/><circle cx="${a[0]-4}" cy="${a[1]}" r="3" class="dot heap"/>`;});
  m.querySelectorAll<HTMLElement>('[data-ro]').forEach(s=>{const h=$('#vr-'+s.dataset.ro);if(!h)return;const a=pt(s,'r'),b=pt(h,'l');out+=`<path d="M${a[0]-4} ${a[1]} C${a[0]+40} ${a[1]} ${b[0]-40} ${b[1]} ${b[0]-2} ${b[1]}" class="ar ro" marker-end="url(#vzr)"/><circle cx="${a[0]-4}" cy="${a[1]}" r="3" class="dot ro"/>`;});
  m.querySelectorAll<HTMLElement>('[data-ref]').forEach(s=>{const[fi,si,idx]=s.dataset.ref!.split('-');let t=idx!=null?$(`#vs-${fi}-${si}-${idx}`):null;if(!t&&idx!=null){const ts=$(`#vs-${fi}-${si}`);if(ts&&ts.dataset.ptr)t=$(`#vh-${ts.dataset.ptr}-${idx}`);}if(!t)t=$(`#vs-${fi}-${si}`);if(!t)return;
    const cell=t.tagName==='SPAN',a=pt(s,'l'),mut=s.dataset.mut==='1';let path;if(cell){const r=t.getBoundingClientRect(),bx=r.left-R.left+r.width/2,by=a[1]>r.top-R.top?r.bottom-R.top:r.top-R.top;path=`M${a[0]+2} ${a[1]} C${a[0]-30} ${a[1]} ${bx} ${by+(a[1]>by?40:-40)} ${bx} ${by+(a[1]>by?2:-2)}`;}else{const b=pt(t,'l'),bend=Math.min(60,24+Math.abs(a[1]-b[1])/6);path=`M${a[0]+2} ${a[1]} C${a[0]-bend} ${a[1]} ${b[0]-bend} ${b[1]} ${b[0]-2} ${b[1]}`;}out+=`<path d="${path}" class="ar ref${mut?' mut':''}" marker-end="url(#vz${mut?'m':'f'})"/><circle cx="${a[0]+2}" cy="${a[1]}" r="3" class="dot ref${mut?' mut':''}"/>`;});
  sv.innerHTML=`<defs>${[['vzh','var(--blue)'],['vzr','var(--purple)'],['vzf','var(--accent)'],['vzm','var(--red)']].map(([i,c])=>`<marker id="${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs>${out}`;}
document.addEventListener('keydown',e=>{const o=$('#viz');if(!o||!o.classList.contains('show'))return;if(e.target&&(e.target as HTMLElement).id==='vz-guess')return;const k=e.key;
  if(k==='Escape'){e.preventDefault();e.stopImmediatePropagation();vizClose();}else if(k==='ArrowRight'){e.preventDefault();e.stopImmediatePropagation();vzGo(VZ.i+1);}else if(k==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();vzGo(VZ.i-1);}else if(k===' '){e.preventDefault();e.stopImmediatePropagation();vzPlay();}},true);
window.addEventListener('resize',()=>{if($('#viz.show'))vzArrows();});
function boot7(){EACT.splice(4,0,['film','Visualize','Ctrl+K V','vizFromEditor()']);
  const cm=MENUS.find(m=>m.t==='Co-Dev');if(cm){const ds=Object.getOwnPropertyDescriptor(cm,'items')!,g=()=>ds.get?ds.get.call(cm):ds.value;Object.defineProperty(cm,'items',{configurable:true,get:()=>{const a=g();a.splice(4,0,{l:'Visualize Execution',k:'Ctrl+K V',act:vizFromEditor});return a;}});}
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items!.splice(2,0,{l:'Visualize Execution',k:'Ctrl+K V',act:vizFromEditor});$('#menubar')!.innerHTML='';buildMenubar();
  CMD.push(['Co-Dev: Visualize Execution','Ctrl+K V',vizFromEditor],...Object.entries(VZS).map(([_k,v])=>['Visualize: '+v[0],'',()=>vizOpen(v[1],v[0])] as [string, string, () => void]));
  const _lt=VIEW.lt;VIEW.lt=(t,host)=>{_lt(t,host);const b=host.querySelector('.lt-bar .mini');if(b&&LTS.lang==='rust')b.insertAdjacentHTML('beforebegin',`<button class="mini" data-action="vz-from-editor" title="Visualize execution (Ctrl+K V)">${svg('film')} Visualize</button>`);};
  const _hood=VIEW.hood;VIEW.hood=(t,host)=>{_hood(t,host);if(/\.rs$/.test(t.path))host.querySelector('.page h1').insertAdjacentHTML('afterend',`<button class="mini pri" style="margin:4px 0 8px" data-action="vz-hood" data-on="${/fn\s+main\s*\(/.test(FS[t.path].content)?'ed':'sum'}">${svg('film')} Visualize execution step by step</button>`);};
  show(cur!);}

/* ── tabela de acções do overlay (ADR-0002, Fase 4): os efeitos dos antigos onclick/
   onchange/oninput inline, agora servidos por um só listener delegado (ui/actions.ts).
   Vive aqui porque é o único sítio com à mão os controlos (vizOpen/vzGo/vzPlay/…), o
   estado window-backed `VZ` e `LS`. `on` é o tipo de evento; `on`(payload) viaja em
   data-on. Cada run resolve a versão viva dos controlos (os onclick antigos resolviam
   `window.X` ao clicar — o mesmo late-binding). ── */
bindActions({
  'vz-answer':      {on:'click',  run:()=>vzAnswer()},
  'vz-just-show':   {on:'click',  run:()=>{VZ.i=VZ.pending!.i;VZ.pending=null;vzRender();}},
  'vz-ask':         {on:'click',  run:()=>vzAsk()},
  'vz-pick':        {on:'change', run:({el})=>{const v=(el as HTMLSelectElement).value;if(v==='__ed')vizFromEditor();else if(VZS[v])vizOpen(VZS[v][1],VZS[v][0]);}},
  'vz-depth':       {on:'click',  run:({on})=>{VZ.depth=on;LS.set('vzdepth',on);vzRender();}},
  'vz-predict':     {on:'change', run:({el})=>{VZ.predict=(el as HTMLInputElement).checked;LS.set('vzpred',(el as HTMLInputElement).checked);}},
  'vz-rerun':       {on:'click',  run:()=>vizOpen(FS[VZ.origin!].content,VZ.title,VZ.origin)},
  'vz-close':       {on:'click',  run:()=>vizClose()},
  'vz-back':        {on:'click',  run:()=>vzGo(VZ.i-1)},
  'vz-play':        {on:'click',  run:()=>vzPlay()},
  'vz-step':        {on:'click',  run:()=>vzGo(VZ.i+1)},
  'vz-speed':       {on:'input',  run:({el})=>{VZ.speed=+(el as HTMLInputElement).value;LS.set('vzspeed',VZ.speed);if(VZ.timer){clearInterval(VZ.timer);VZ.timer=null;vzPlay();}}},
  'vz-seek':        {on:'click',  run:({el,e,on})=>{const r=el.getBoundingClientRect();vzGo(Math.round(((e as MouseEvent).clientX-r.left)/r.width*(+on-1)));}},
  'vz-from-editor': {on:'click',  run:()=>vizFromEditor()},
  'vz-hood':        {on:'click',  run:({on})=>{if(on==='ed')vizFromEditor();else vizOpen(VZS.sum[1],VZS.sum[0]);}},
});

/* ── publicação no window: os nomes que boot.ts / handlers inline / app.ts (arranque)
   / i18n consomem. Internos (hex, VZR, VZSEEN, VZSZ) ficam léxicos ao módulo. ── */
publish({
  VZ, VZS, boot7,
  vizClose, vizFromEditor, vizOpen,
  vzAnswer, vzArrows, vzAsk, vzErr, vzGo, vzHints, vzLex, vzParse,
  vzPlay, vzQuestion, vzRender, vzRun, vzTell
});
