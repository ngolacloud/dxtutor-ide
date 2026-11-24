/* ═══════════ feature `visualizer` — interpretador (ADR-0002, Fase 2) ═══════════
   PURO: fonte → `{steps, end, out, err}`. Um interpretador do subconjunto de Rust
   com modelo de memória (frames na stack, heap com alocador, rodata, contadores).
   Sem DOM, sem `window`, sem Tauri — recebe/devolve só dados.

   ADR-0004, U4i3: tipado (era @ts-nocheck desde a ADR-0002) — só anotações, casts, `!` e
   declarações: o JavaScript emitido é o mesmo. O valor `{t,v,…}` tem um tipo (`VzVal`) e o
   seu conteúdo escalar `v` fica `VzScalar = any`, o único `any` deliberado: a variante `t`
   decide em runtime se é número, booleano ou carácter, e o TypeScript não segue esse
   estreitamento através do `dz()` — casts `as number` em cada operação seriam tão pouco
   verificados como o `any`. A saída continua pinada byte-a-byte pela caracterização em
   `ui-app/tests/visualizer.golden.test.ts`.

   A pureza (A7: domain não importa fora; A8: sem `window`) mantém-se mesmo sem
   tipos: importa só de `domain/` (parser/hints/lexer/constants). */

import { VZSZ, VZR } from "./constants";
import { vzParse } from "./parser";
import { vzHints } from "./hints";
import { vzErr } from "./lexer";
import type { VzEvent, VzNode, VzRunResult, VzSlot, VzStep } from "./types";

/** O conteúdo escalar de um valor: número (i/f), booleano (b) ou carácter (c) — ver o cabeçalho. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VzScalar = any;
/** Um lugar na memória: o slot `fi:si` (e a célula `idx`, quando é um elemento). */
interface VzLoc { fi: number; si: number; idx?: number | null }
/** Um lugar avaliado: por onde se chegou (`via` uma referência, `vmut` se mutável) e a raiz. */
interface VzPlace extends VzLoc { via?: boolean; vmut?: boolean; root?: VzSlotState }
/** Um valor do interpretador. `t` discrimina: i/f/b/c (escalares em `v`), u (unidade), str
 *  (literal em rodata: `id`), String/Vec (bloco de heap: `h`; `et` = tipo do elemento), arr
 *  (`items`), ref (`to`, `mut`, `asStr`, `iter`), range (`a`..`b`, `incl`), chars/str_ (`s`). */
interface VzVal {
  t: string; v?: VzScalar; ty?: string; inf?: boolean;
  id?: number; h?: string; et?: string | null; items?: VzVal[];
  to?: VzLoc; mut?: boolean; asStr?: boolean; iter?: boolean;
  a?: VzVal; b?: VzVal; incl?: boolean; s?: string;
}
/** Uma variável viva numa frame. `v` é `null` (forçado) quando foi declarada sem valor — o
 *  caso `var` do `eval_` verifica-o antes de a ler. */
interface VzSlotState {
  name: string; v: VzVal; ty: string | null | undefined; mut: boolean | undefined; st: string;
  addr: number; size: number; line: number; dead: boolean; mvAt?: number; mvTo?: string;
}
/** Uma frame da pilha. */
interface VzFrameState { fn: string; slots: VzSlotState[]; scopes: number[]; sp: number; base: number; callLine: number }
/** Um bloco de heap: buffer de Vec (`items`) ou bytes de String (`s`). */
interface VzHeapObj {
  id: string; kind: string; cap: number; es: number; items: VzVal[] | null; s: string | null;
  addr: number; freed: boolean; freedAt?: number; label?: string;
}
/** Um literal em dados só-de-leitura. */
interface VzRoEntry { s: string; addr: number; id: number }
/** O que o interpretador lança: panic, erro de compilação, limite de passos, ou controlo de
 *  fluxo (`ret`/`brk`/`cont`). */
type VzThrow = Error & { panic?: number; comp?: string; vline?: number; hint?: string; so?: number; limit?: number; ret?: number; brk?: number; cont?: number; v?: VzVal; line?: number };
/** O resultado do `fmt`: a string, os pedaços literais, o nº de argumentos e os segmentos. */
interface VzFmt { s: string; pieces: string[]; nargs: number; segs: string[] }

export function vzRun(src: string): VzRunResult{const ast=vzParse(src),HN=vzHints(ast);if(!ast.fns.main)throw vzErr('There is no `fn main()` to run. The visualizer runs a whole program.',1);
  const S: { fr: VzFrameState[]; heap: Record<string, VzHeapObj>; hid: number; ha: number; sp: number; ro: VzRoEntry[]; roa: number; out: string; err: string; steps: VzStep[]; ev: VzEvent[]; cnt: Record<string, number>; lastMove?: VzSlotState | null }={fr:[],heap:{},hid:0,ha:0x55d1c2b4e010,sp:0x7ffd3a1c9000,ro:[],roa:0x55d1c29f3000,out:'',err:'',steps:[],ev:[],cnt:{calls:0,maxDepth:0,allocs:0,frees:0,reallocs:0,live:0,peak:0,bounds:0,ovf:0,moves:0,copied:0,writes:0}};
  const ev=(k: string,o?: Record<string, unknown>)=>S.ev.push(Object.assign({k},o||{}) as VzEvent),fr=()=>S.fr[S.fr.length-1],line0={v:0};
  const panic: (m: string,l: number) => never=(m,l)=>{const e=new Error(m) as VzThrow;e.panic=1;e.vline=l;throw e;},comp: (code: string,m: string,l: number,hint?: string) => never=(code,m,l,hint)=>{const e=new Error(m) as VzThrow;e.comp=code;e.vline=l;e.hint=hint;throw e;};
  const I=(v: VzScalar,ty?: string): VzVal=>({t:'i',v,ty:ty||'i32',inf:!ty}),U: VzVal={t:'u'};
  const esz=(et: string | null | undefined): number=>VZSZ[et as string]||(et==='String'||/^Vec/.test(et||'')?24:et==='&str'?16:/^&/.test(et||'')?8:4);
  const H=(id: string | undefined): VzHeapObj=>S.heap[id as string];
  function text(v: VzVal): string{v=dz(v);return v.t==='str'?S.ro[v.id!].s:v.t==='String'?H(v.h).s!:v.t==='c'?v.v:String(v.v);}
  function tgt(r: VzVal): VzVal{const s=S.fr[r.to!.fi]&&S.fr[r.to!.fi].slots[r.to!.si];if(!s)return U;if(r.to!.idx==null)return s.v;const c=items(dz(s.v));return c?c[r.to!.idx]:U;}
  function dz(v: VzVal): VzVal{let n=0;while(v&&v.t==='ref'&&n++<20)v=tgt(v);return v;}
  function items(v: VzVal): VzVal[] | null | undefined{return v.t==='arr'?v.items:v.t==='Vec'?H(v.h).items:null;}
  function tyOf(v: VzVal | null | undefined): string{if(!v)return'?';switch(v.t){case'i':return v.ty as string;case'f':return'f64';case'b':return'bool';case'c':return'char';case'u':return'()';case'str':return'&str';case'String':return'String';case'Vec':return`Vec<${v.et||'_'}>`;case'arr':return`[${v.et||'_'}; ${v.items!.length}]`;case'ref':return(v.mut?'&mut ':'&')+(v.asStr?'str':tyOf(tgt(v)));case'range':return'Range<'+v.a!.ty+'>';case'chars':return'Chars';}return'?';}
  function sizeOf(v: VzVal,ty?: string | null): number{ty=ty||'';if(v.t==='i')return VZSZ[v.ty!]||4;if(v.t==='f')return 8;if(v.t==='b')return 1;if(v.t==='c')return 4;if(v.t==='u')return 0;if(v.t==='str')return 16;if(v.t==='String'||v.t==='Vec')return 24;if(v.t==='arr')return v.items!.length*esz(v.et);if(v.t==='ref')return/\[|str/.test(ty)||v.asStr?16:8;if(v.t==='range')return 2*(VZSZ[v.a!.ty!]||4);return 8;}
  function copy(v: VzVal): VzVal{return v.t==='arr'?{...v,items:v.items!.map(copy)}:{...v};}
  function isCopy(v: VzVal): boolean{return['i','f','b','c','u','str','range','chars'].includes(v.t)||(v.t==='ref')||(v.t==='arr'&&v.items!.every(isCopy));}
  function halloc(kind: string,cap: number,es: number,init?: VzVal[] | string,label?: string): string{const id='h'+(++S.hid),bytes=cap*es,o={id,kind,cap,es,items:kind==='vec'?((init as VzVal[] | undefined)||[]):null,s:kind==='string'?((init as string | undefined)||''):null,addr:cap?S.ha:0,freed:false,label};S.heap[id]=o;
    if(cap){S.ha+=Math.ceil((bytes+16)/16)*16+16;S.cnt.allocs++;S.cnt.live+=bytes;S.cnt.peak=Math.max(S.cnt.peak,S.cnt.live);ev('alloc',{bytes,cap,addr:o.addr,what:kind==='vec'?'Vec buffer':'String buffer',label});}else ev('noalloc',{what:kind==='vec'?'Vec':'String',label});return id;}
  function grow(o: VzHeapObj,need: number,name: string){const nc=Math.max(o.cap*2,need,o.es===1?8:o.es<=1024?4:1),old=o.cap,len=o.kind==='vec'?o.items!.length:new TextEncoder().encode(o.s!).length;
    if(old===0){o.cap=nc;o.addr=S.ha;S.ha+=Math.ceil((nc*o.es+16)/16)*16+16;S.cnt.allocs++;S.cnt.live+=nc*o.es;ev('alloc',{bytes:nc*o.es,cap:nc,addr:o.addr,what:o.kind==='vec'?'Vec buffer':'String buffer',label:name,first:true});}
    else{const oa=o.addr;o.addr=S.ha;S.ha+=Math.ceil((nc*o.es+16)/16)*16+16;S.cnt.reallocs++;S.cnt.copied+=len*o.es;S.cnt.live+=(nc-old)*o.es;o.cap=nc;ev('grow',{name,old,nc,copied:len*o.es,from:oa,to:o.addr,es:o.es});}S.cnt.peak=Math.max(S.cnt.peak,S.cnt.live);}
  function drop(v: VzVal | null | undefined,name: string): void{if(!v)return;if(v.t==='Vec'||v.t==='String'){const o=H(v.h);if(!o||o.freed)return;if(o.kind==='vec')o.items!.forEach(x=>drop(x,name+'[…]'));if(o.cap){S.cnt.frees++;S.cnt.live-=o.cap*o.es;ev('free',{name,bytes:o.cap*o.es,addr:o.addr});}else ev('dropnoop',{name});o.freed=true;o.freedAt=S.steps.length;}else if(v.t==='arr')v.items!.forEach(x=>drop(x,name));}
  function strlit(s: string): VzVal{let r=S.ro.find(x=>x.s===s);if(!r){r={s,addr:S.roa,id:S.ro.length};S.roa+=Math.max(8,new TextEncoder().encode(s).length);S.ro.push(r);}return{t:'str',id:r.id};}
  function newSlot(name: string,v: VzVal,ty: string | null | undefined,mut: boolean | undefined,line: number): VzSlotState{const f=fr(),size=sizeOf(v,ty);f.sp-=Math.max(8,Math.ceil(size/8)*8);const s={name,v,ty,mut,st:'live',addr:f.sp,size,line,dead:false};f.slots.push(s);S.sp=Math.min(S.sp,f.sp);return s;}
  function look(name: string,l: number){const f=fr();for(let i=f.slots.length-1;i>=0;i--){const s=f.slots[i];if(!s.dead&&s.name===name)return{s,fi:S.fr.length-1,si:i};}comp('E0425',`cannot find value \`${name}\` in this scope`,l);}
  function coerce(v: VzVal,ty: string | null | undefined): VzVal{if(!ty||!v)return v;if(v.t==='i'&&VZSZ[ty]&&v.inf){v.ty=ty;v.inf=false;ovf(v.v,ty,'convert',0);}
    else if(v.t==='f'&&v.inf)v.inf=false;
    else if(v.t==='Vec'){const m=ty.match(/^Vec<(.+)>$/);if(m){v.et=m[1];H(v.h).items!.forEach(x=>coerce(x,m[1]));H(v.h).es=esz(m[1]);}}
    else if(v.t==='arr'){const m=ty.match(/^\[(.+?)(;|\])/);if(m){v.et=m[1].trim();v.items!.forEach(x=>coerce(x,v.et));}}
    else if(v.t==='ref'){const inner=ty.replace(/^&(mut )?/,'');if(inner==='str'&&dz(v).t==='String')v.asStr=true;const s=S.fr[v.to!.fi].slots[v.to!.si];if(v.to!.idx==null){const m=inner.match(/^\[([^;\]]+)\]$/);if(m){const t=dz(s.v);if(t.t==='arr'){t.et=m[1];t.items!.forEach(x=>coerce(x,m[1]));}else if(t.t==='Vec'){t.et=m[1];H(t.h).items!.forEach(x=>coerce(x,m[1]));}}else coerce(dz(s.v),inner);}}return v;}
  function ovf(n: number,ty: string,op: string,l: number): number{const r=VZR[ty];if(!r)return n;if(op!=='convert')S.cnt.ovf++;if(n<r[0]||n>r[1]){if(op==='convert')comp('E0080',`literal out of range for \`${ty}\``,l);panic(`attempt to ${op} with overflow`,l);}return n;}
  function num(v: VzVal): VzVal{v=dz(v);if(v.t!=='i'&&v.t!=='f')comp('E0277',`expected a number, found \`${tyOf(v)}\``,line0.v);return v;}
  function arith(op: string,a: VzVal,b: VzVal,l: number): VzVal{a=dz(a);b=dz(b);if(op==='+'&&a.t==='String'){const o=H(a.h),t=text(b),need=new TextEncoder().encode(o.s+t).length;if(need>o.cap)grow(o,need,'(temp)');o.s+=t;return a;}
    if(a.t==='f'||b.t==='f'){const x=num(a).v,y=num(b).v;return{t:'f',v:op==='+'?x+y:op==='-'?x-y:op==='*'?x*y:op==='/'?x/y:x%y};}
    const x=num(a),y=num(b),ty=x.inf?y.ty:x.ty,inf=x.inf&&y.inf;let r: number;
    if((op==='/'||op==='%')&&y.v===0)panic(op==='/'?'attempt to divide by zero':'attempt to calculate the remainder with a divisor of zero',l);
    r=op==='+'?x.v+y.v:op==='-'?x.v-y.v:op==='*'?x.v*y.v:op==='/'?Math.trunc(x.v/y.v):x.v%y.v;ovf(r,ty as string,({'+':'add','-':'subtract','*':'multiply','/':'divide','%':'calculate the remainder'} as Record<string, string>)[op],l);ev('ovf',{op,ty});return{t:'i',v:r,ty,inf};}
  function cmp(op: string,a: VzVal,b: VzVal): VzVal{a=dz(a);b=dz(b);const x=['str','String','c'].includes(a.t)?text(a):a.v,y=['str','String','c'].includes(b.t)?text(b):b.v;let r: boolean;if((a.t==='Vec'||a.t==='arr')&&items(b)){const xa=JSON.stringify(items(a)!.map(x=>disp(x))),ya=JSON.stringify(items(b)!.map(x=>disp(x)));r=op==='=='?xa===ya:xa!==ya;}else r=op==='=='?x===y:op==='!='?x!==y:op==='<'?x<y:op==='>'?x>y:op==='<='?x<=y:x>=y;return{t:'b',v:r};}
  function disp(v: VzVal | null | undefined,d=0): string{if(!v||d>4)return'…';switch(v.t){case'i':return String(v.v);case'f':return Number.isInteger(v.v)?v.v.toFixed(1):String(+v.v.toFixed(6));case'b':return String(v.v);case'c':return`'${v.v}'`;case'u':return'()';case'str':return JSON.stringify(S.ro[v.id!].s);case'String':return JSON.stringify(H(v.h).s);case'Vec':return`[${H(v.h).items!.map(x=>disp(x,d+1)).join(', ')}]`;case'arr':return`[${v.items!.map(x=>disp(x,d+1)).join(', ')}]`;case'ref':return'&'+disp(v.asStr?{t:'str_',s:text(v)}:tgt(v),d+1);case'str_':return JSON.stringify(v.s);case'range':return`${v.a!.v}..${v.incl?'=':''}${v.b!.v}`;case'chars':return'Chars { … }';}return'?';}
  function show(v: VzVal): string{v=dz(v);return v.t==='str'||v.t==='String'?text(v):v.t==='c'?v.v:disp(v);}
  function fmt(args: VzNode[],l: number): VzFmt{if(!args.length)return'' as unknown as VzFmt;const f=args[0];if(f.k!=='strlit')comp('E0277','format argument must be a string literal',l);let ai=1,pieces: string[]=[],nargs=0;
    const out=(f.v as string).replace(/\{\{|\}\}|\{([A-Za-z_]\w*)?(?::([^}]*))?\}/g,(m: string,name: string | undefined,spec: string | undefined)=>{if(m==='{{')return'{';if(m==='}}')return'}';nargs++;let v: VzVal;if(name){v=eval_({k:'var',name,line:l},false);}else{const a=args[ai++];if(!a)comp('E0277','format string has more {} than arguments',l);v=eval_(a,false);}
      const dbg=spec&&/\?/.test(spec),prec=spec&&(spec.match(/\.(\d+)/)||[])[1];let s=dbg?(dz(v).t==='c'?disp(dz(v)):disp(dz(v))):show(v);if(prec!=null&&(dz(v).t==='f'))s=dz(v).v.toFixed(+prec);const w=spec&&(spec.match(/^[<>^]?(\d+)/)||[])[1];if(w)s=/^</.test(spec)?s.padEnd(+w):s.padStart(+w);return' '+s+'';});
    const segs=out.split(/ |/);pieces=segs.filter((_x,i)=>i%2===0);return{s:segs.join(''),pieces,nargs,segs};}
  function snap(l: number,extra?: { retFrom?: string } | null){const step: VzStep={line:l,ev:S.ev,out:S.out,err:S.err,cnt:{...S.cnt},extra:extra||null,frames:S.fr.map((f,fi)=>({fn:f.fn,line:fi===S.fr.length-1?l:f.callLine,sp:f.sp,base:f.base,slots:f.slots.map((s,si)=>s.dead?null:{name:s.name,ty:s.ty||tyOf(s.v),val:s.st==='moved'?'':disp(s.v),addr:s.addr,size:s.st==='moved'||!s.v?s.size:sizeOf(s.v,s.ty),st:s.st,mvAt:s.mvAt,mvTo:s.mvTo,mut:s.mut,fi,si,
      ptr:(s.v.t==='Vec'||s.v.t==='String')&&s.st!=='moved'?s.v.h:null,hdr:(s.v.t==='Vec'||s.v.t==='String')&&s.st!=='moved'&&H(s.v.h)?(o=>({addr:o.addr,cap:o.cap,len:o.kind==='vec'?o.items!.length:new TextEncoder().encode(o.s!).length}))(H(s.v.h)):null,ro:s.v.t==='str'?s.v.id:null,ref:s.v.t==='ref'?{...s.v.to!,mut:s.v.mut as boolean,fat:s.size===16}:null,arr:s.v.t==='arr'?s.v.items!.map(x=>disp(x)):null,aes:s.v.t==='arr'?esz(s.v.et):0}).filter(Boolean) as VzSlot[]})),
      heap:Object.values(S.heap).filter(o=>!o.freed||o.freedAt!>=S.steps.length).map(o=>({id:o.id,kind:o.kind,addr:o.addr,cap:o.cap,es:o.es,len:o.kind==='vec'?o.items!.length:new TextEncoder().encode(o.s!).length,cells:o.kind==='vec'?o.items!.map(x=>disp(x)):[...o.s!],freed:o.freed,label:o.label})),ro:S.ro.map(r=>({...r,len:new TextEncoder().encode(r.s).length}))};
    S.steps.push(step);S.ev=[];if(S.steps.length>=1500){const e=new Error('stopped after 1500 steps — is there an infinite loop?') as VzThrow;e.limit=1;e.vline=l;throw e;}}
  function placeOf(e: VzNode): VzPlace | null{if(e.k==='var'){const r=look(e.name!,e.line!);if(r!.s.st==='moved')comp('E0382',`borrow of moved value: \`${e.name}\``,e.line!,`\`${e.name}\` was moved at line ${r!.s.mvAt}${r!.s.mvTo?` into \`${r!.s.mvTo}\``:''}.`);return{fi:r!.fi,si:r!.si,root:r!.s};}
    if(e.k==='deref'){const v=eval_(e.e!,false);if(v.t!=='ref')comp('E0614','type cannot be dereferenced',e.line!);return{...v.to!,via:true,vmut:v.mut,root:S.fr[v.to!.fi].slots[v.to!.si]};}
    if(e.k==='idx'){let b=placeOf(e.e!);let s=S.fr[b!.fi].slots[b!.si];while(s.v.t==='ref'&&b!.idx==null){b={...s.v.to!,via:true,vmut:s.v.mut,root:b!.root};s=S.fr[b!.fi].slots[b!.si];}if(b!.idx!=null)comp('E0608','nested indexing is not in the subset yet',e.line!);
      const i=dz(eval_(e.i!,false));if(i.t!=='i')comp('E0277','the index must be an integer (usize)',e.line!);const c=items(dz(s.v));if(!c)comp('E0608',`cannot index into a value of type \`${tyOf(s.v)}\``,e.line!);S.cnt.bounds++;ev('bounds',{i:i.v,len:c!.length,ok:i.v>=0&&i.v<c!.length,name:s.name});
      if(i.v<0||i.v>=c!.length)panic(`index out of bounds: the len is ${c!.length} but the index is ${i.v}`,e.line!);return{...b!,idx:i.v};}
    return null;}
  function getP(p: VzPlace): VzVal{const s=S.fr[p.fi].slots[p.si];if(p.idx==null)return s.v;return items(dz(s.v))![p.idx];}
  function needMut(p: VzPlace,name: string,l: number,what: string){if(p.via?!p.vmut:!S.fr[p.fi].slots[p.si].mut)comp(p.via?'E0596':what==='assign'?'E0384':'E0596',p.via?`cannot ${what==='assign'?'assign through':'borrow as mutable through'} a \`&\` reference`:what==='assign'?`cannot assign twice to immutable variable \`${name}\``:`cannot borrow \`${name}\` as mutable, as it is not declared as mutable`,l,p.via?'Take a `&mut` reference instead.':`Declare it with \`let mut ${name}\`.`);}
  function setP(p: VzPlace,v: VzVal,_l: number){const s=S.fr[p.fi].slots[p.si];if(p.idx==null){const old=s.v;if(old&&old.t&&s.st!=='moved'&&(old.t==='String'||old.t==='Vec')&&old.h!==v.h)drop(old,s.name+' (old value)');if(s.ty)coerce(v,s.ty);else if(old&&old.t==='i'&&v.t==='i'&&v.inf){v.ty=old.ty;v.inf=old.inf;}s.v=v;s.st='live';}else{const c=items(dz(s.v));const old=c![p.idx];if(old.t==='i'&&v.t==='i'&&v.inf){v.ty=old.ty;}c![p.idx]=v;}}
  function nameOfP(p: VzPlace): string{const s=S.fr[p.fi].slots[p.si];return p.idx!=null?`${s.name}[${p.idx}]`:s.name;}
  function mkRef(e: VzNode,mut: boolean | undefined): VzVal{if(['var','idx','deref'].includes(e.k!)){const p=placeOf(e);const s=S.fr[p!.fi].slots[p!.si];if(mut&&!(p!.via?p!.vmut:s.mut))comp('E0596',`cannot borrow \`${s.name}\` as mutable, as it is not declared as mutable`,e.line!,`Declare it with \`let mut ${s.name}\`.`);return{t:'ref',mut,to:{fi:p!.fi,si:p!.si,idx:p!.idx}};}
    const v=eval_(e,true),s=newSlot('(temp)',v,null,mut,e.line!),f=fr();return{t:'ref',mut,to:{fi:S.fr.length-1,si:f.slots.indexOf(s)}};}
  function eval_(e: VzNode,mv=true): VzVal{line0.v=e.line||line0.v;switch(e.k){
    case'int':return e.suf?{t:'i',v:e.v,ty:e.suf,inf:false}:I(e.v);case'float':return{t:'f',v:e.v};case'bool':return{t:'b',v:e.v};case'charlit':return{t:'c',v:e.v};case'unit':return U;
    case'strlit':return strlit(e.v as string);
    case'arr':{const it=e.items!.map(x=>eval_(x,true));return{t:'arr',items:it,et:it[0]?tyOf(it[0]):null};}
    case'arrrep':{const v=eval_(e.e!,true),n=dz(eval_(e.n!)).v;return{t:'arr',items:Array.from({length:n},()=>copy(v)),et:tyOf(v)};}
    case'vec':case'vecrep':{const it=e.k==='vec'?e.items!.map(x=>eval_(x,true)):(()=>{const v=eval_(e.e!,true),n=dz(eval_(e.n!)).v;return Array.from({length:n},()=>copy(v));})();const et=it[0]?tyOf(it[0]):null;return{t:'Vec',h:halloc('vec',it.length,esz(et),it,'vec!'),et};}
    case'var':{const r=look(e.name!,e.line!),s=r!.s;if(s.st==='moved')comp('E0382',`use of moved value: \`${e.name}\``,e.line!,`\`${e.name}\` was moved at line ${s.mvAt}${s.mvTo?` into \`${s.mvTo}\``:''}. Borrow it (\`&${e.name}\`) or clone it before the move.`);
      const v=s.v;if(!v)comp('E0381',`used binding \`${e.name}\` isn't initialized`,e.line!);if(isCopy(v)){if(v.t==='arr'&&mv){S.cnt.copied+=sizeOf(v);ev('copyarr',{from:e.name,bytes:sizeOf(v)});}return copy(v);}
      if(mv){s.st='moved';s.mvAt=e.line;S.cnt.moves++;S.lastMove=s;return v;}return v;}
    case'ref':return mkRef(e.e!,e.mut);
    case'deref':{const v=eval_(e.e!,false);if(v.t!=='ref')comp('E0614',`type \`${tyOf(v)}\` cannot be dereferenced`,e.line!);const t=tgt(v);if(!isCopy(t)&&mv)comp('E0507','cannot move out of a shared reference',e.line!);return copy(t);}
    case'un':{const v=dz(eval_(e.e!,false));if(e.op==='!'){if(v.t==='b')return{t:'b',v:!v.v};}if(v.t==='i'){if(/^u/.test(v.ty!)&&!v.inf)comp('E0600',`cannot apply unary operator \`-\` to type \`${v.ty}\``,e.line!);return{...v,v:-v.v};}if(v.t==='f')return{t:'f',v:-v.v};comp('E0600',`cannot apply \`${e.op}\` to \`${tyOf(v)}\``,e.line!);}
    case'bin':{if(e.op==='&&'||e.op==='||'){const a=dz(eval_(e.a!,false));if(e.op==='&&'&&!a.v)return{t:'b',v:false};if(e.op==='||'&&a.v)return{t:'b',v:true};return{t:'b',v:!!dz(eval_(e.b!,false)).v};}
      if(['==','!=','<','>','<=','>='].includes(e.op!))return cmp(e.op!,eval_(e.a!,false),eval_(e.b!,false));const a=eval_(e.a!,false);if(e.op==='+'&&dz(a).t==='String'&&e.a!.k==='var'){const r=look(e.a!.name!,e.line!);r!.s.st='moved';r!.s.mvAt=e.line;S.lastMove=r!.s;S.cnt.moves++;}const b=eval_(e.b!,false);return arith(e.op!,a,b,e.line!);}
    case'assign':{const p=placeOf(e.tg!);if(!p)comp('E0070','invalid left-hand side of assignment',e.line!);needMut(p!,nameOfP(p!),e.line!,'assign');let v;
      if(e.op==='='){v=eval_(e.e!,true);const mvd=S.lastMove as VzSlotState | null | undefined;S.lastMove=null;setP(p!,v,e.line!);if(mvd&&mvd.st==='moved'&&e.e!.k==='var'){mvd.mvTo=nameOfP(p!);ev('move',{from:mvd.name,to:nameOfP(p!),size:sizeOf(v)});}}
      else{const cur=getP(p!);if(dz(cur).t==='String'&&e.op==='+='){const o=H(dz(cur).h),t=text(eval_(e.e!,false)),need=new TextEncoder().encode(o.s+t).length;if(need>o.cap)grow(o,need,nameOfP(p!));o.s+=t;ev('pushstr',{name:nameOfP(p!),add:t,len:need,cap:o.cap});return U;}
        v=arith(e.op![0],cur,eval_(e.e!,false),e.line!);setP(p!,v,e.line!);}
      ev('set',{name:nameOfP(p!),val:disp(getP(p!)),via:p!.via});return U;}
    case'range':{const a=dz(eval_(e.a!,false)),b=dz(eval_(e.b!,false));if(a.t!=='i'||b.t!=='i')comp('E0277','range bounds must be integers',e.line!);const ty=a.inf?b.ty:a.ty;return{t:'range',a:{...a,ty},b:{...b,ty},incl:e.incl};}
    case'cast':{const v=dz(eval_(e.e!,false));const to=e.ty;if(to==='f64'||to==='f32')return{t:'f',v:v.t==='c'?v.v:+v.v};if(to==='char'){return{t:'c',v:String.fromCodePoint(v.v)};}
      if(VZR[to!]){let n=v.t==='f'?Math.trunc(v.v):v.t==='c'?v.v.codePointAt(0):v.t==='b'?+v.v:v.v;const r=VZR[to!],span=r[1]-r[0]+1,o=n;if(v.t==='f')n=Math.min(r[1],Math.max(r[0],n));else if(n<r[0]||n>r[1])n=((n-r[0])%span+span)%span+r[0];ev('cast',{from:tyOf(v),to,v:o,r:n,wrapped:n!==o,sat:v.t==='f'});return{t:'i',v:n,ty:to!,inf:false};}
      comp('E0605',`non-primitive cast to \`${to}\``,e.line!);}
    case'if':{const c=dz(eval_(e.c!,false));if(c.t!=='b')comp('E0308',`expected \`bool\`, found \`${tyOf(c)}\``,e.line!);return c.v?block(e.th!):e.el?(e.el.k==='if'?eval_(e.el):block(e.el)):U;}
    case'block':return block(e);
    case'call':return call(e);case'mcall':return mcall(e,mv);case'mac':return mac(e);
    case'idx':{const p=placeOf(e),v=getP(p!);if(isCopy(v))return copy(v);if(mv)comp('E0507',`cannot move out of index of \`${tyOf(S.fr[p!.fi].slots[p!.si].v)}\``,e.line!,'Borrow it with `&v[i]` or clone it.');return v;}
    case'path':comp('E0423',`expected value, found \`${e.parts!.join('::')}\``,e.line!);}
    comp('E0000',`\`${e.k}\` is not supported`,e.line!);}
  function call(e: VzNode): VzVal{const n=e.fn,l=e.line;
    if(n==='String::from'||n==='String::new'){const t=n==='String::new'?'':text(eval_(e.args![0],false)),b=new TextEncoder().encode(t).length;return{t:'String',h:halloc('string',b,1,t,n)};}
    if(n==='Vec::new')return{t:'Vec',h:halloc('vec',0,4,[],'Vec::new'),et:null};
    if(n==='Vec::with_capacity'||n==='String::with_capacity'){const c=dz(eval_(e.args![0],false)).v;return n[0]==='V'?{t:'Vec',h:halloc('vec',c,4,[],'with_capacity'),et:null}:{t:'String',h:halloc('string',c,1,'','with_capacity')};}
    if(n==='drop'||n==='std::mem::drop'){const a=e.args![0],v=eval_(a,true);if(a.k==='var'){const s=S.lastMove as VzSlotState | null | undefined;if(s)s.mvTo='drop()';}drop(v,a.name||'value');return U;}
    const f=ast.fns[n!];if(!f)comp('E0425',`cannot find function \`${n}\` in this scope`,l!);if(f.params.length!==e.args!.length)comp('E0061',`this function takes ${f.params.length} argument(s) but ${e.args!.length} were supplied`,l!);
    if(S.fr.length>=180){const err=new Error("thread 'main' has overflowed its stack") as VzThrow;err.panic=1;err.vline=l;err.so=1;throw err;}
    const args=e.args!.map((a,i)=>{S.lastMove=null;const v=eval_(a,true),mv=S.lastMove as VzSlotState | null | undefined;S.lastMove=null;if(mv&&a.k==='var'){mv.mvTo=`${f.params[i].name} (in ${n})`;}return{v,mv:mv&&a.k==='var'?a.name:null};});
    const caller=fr();caller.callLine=l!;const base=S.sp-16;S.fr.push({fn:n!,slots:[],scopes:[0],sp:base,base,callLine:l!});S.cnt.calls++;S.cnt.maxDepth=Math.max(S.cnt.maxDepth,S.fr.length);
    const regs=['rdi','rsi','rdx','rcx','r8','r9'];let ri=0;const argInfo=f.params.map((p,i)=>{const v=coerce(args[i].v,p.ty),s=newSlot(p.name,v,p.ty,p.mut,f.line),words=s.size>16?0:Math.max(1,Math.ceil(s.size/8));const r=words?regs.slice(ri,ri+words):[];ri+=words;
      if(args[i].mv)ev('move',{from:args[i].mv,to:`${p.name} (in ${n})`,size:s.size});else if(v.t==='ref')ev('borrow',{name:`${S.fr[v.to!.fi].slots[v.to!.si].name}${v.to!.idx!=null?`[${v.to!.idx}]`:''}`,as:p.name,mut:v.mut,size:s.size,fat:s.size===16,param:1});return{name:p.name,ty:p.ty,size:s.size,regs:r,mem:!words,val:disp(v)};});
    ev('call',{fn:n,args:argInfo,depth:S.fr.length});snap(f.line);let ret=U,rl=(f.body.tail?(f.body.tail as VzNode).line:f.body.end) as number;
    try{ret=block(f.body,true);}catch(x){if((x as VzThrow).ret){ret=(x as VzThrow).v as VzVal;rl=(x as VzThrow).line as number;}else throw x;}
    ret=coerce(ret,f.ret);const me=fr();for(let i=me.slots.length-1;i>=0;i--){const s=me.slots[i];if(!s.dead&&s.st!=='moved'&&s.name!=='(temp)')drop(s.v,s.name);}
    const rs=sizeOf(ret);ev('ret',{fn:n,val:disp(ret),size:rs,reg:rs===0?null:rs<=8?'rax':rs<=16?'rax:rdx':'memory (sret)',to:S.fr[S.fr.length-2].fn});snap(rl,{retFrom:n});me.slots.forEach(s=>s.dead=true);S.fr.pop();S.sp=Math.max(S.sp,fr().sp);return ret;}
  function mcall(e: VzNode,_mv: boolean): VzVal{const m=e.m,l=e.line,pl=['var','idx','deref'].includes(e.obj!.k!)?placeOf(e.obj!):null;let recv=pl?getP(pl):eval_(e.obj!,false);const rv=dz(recv),nm=pl?nameOfP(pl):'value';
    const A=(i: number)=>eval_(e.args![i],false),need=(_what?: string)=>{if(!pl)return;let p=pl;const s=S.fr[p.fi].slots[p.si];if(s.v.t==='ref'&&p.idx==null){if(!s.v.mut)comp('E0596',`cannot borrow \`*${s.name}\` as mutable, as it is behind a \`&\` reference`,l!,'Take `&mut` instead of `&`.');return;}needMut(p,nm,l!,'borrow');};
    const len=(v: VzVal)=>v.t==='str'||v.t==='String'?new TextEncoder().encode(text(v)).length:(items(v)||[]).length;
    switch(m){
      case'len':return I(len(rv),'usize');case'is_empty':return{t:'b',v:len(rv)===0};case'capacity':return I(rv.t==='Vec'||rv.t==='String'?H(rv.h).cap:len(rv),'usize');
      case'push':if(rv.t==='Vec'){need();const x=eval_(e.args![0],true),mvd=S.lastMove as VzSlotState | null | undefined;S.lastMove=null;const o=H(rv.h);if(!rv.et)rv.et=tyOf(x);else coerce(x,rv.et);o.es=esz(rv.et);if(o.items!.length===o.cap)grow(o,o.items!.length+1,nm);o.items!.push(x);if(mvd&&e.args![0].k==='var'){mvd.mvTo=`${nm} (element)`;ev('move',{from:e.args![0].name,to:`${nm}[${o.items!.length-1}]`,size:sizeOf(x)});}ev('push',{name:nm,val:disp(x),len:o.items!.length,cap:o.cap,es:o.es});return U;}
        if(rv.t==='String'){need();const c=text(A(0)),o=H(rv.h),n2=new TextEncoder().encode(o.s+c).length;if(n2>o.cap)grow(o,n2,nm);o.s+=c;ev('pushstr',{name:nm,add:c,len:n2,cap:o.cap});return U;}break;
      case'push_str':if(rv.t==='String'){need();const t=text(A(0)),o=H(rv.h),n2=new TextEncoder().encode(o.s+t).length;if(n2>o.cap)grow(o,n2,nm);o.s+=t;ev('pushstr',{name:nm,add:t,len:n2,cap:o.cap});return U;}break;
      case'clone':if(rv.t==='Vec'){const o=H(rv.h),it=o.items!.map(x=>x.t==='String'?{t:'String',h:halloc('string',new TextEncoder().encode(H(x.h).s!).length,1,H(x.h).s!,'clone')}:copy(x));ev('clone',{name:nm,bytes:it.length*o.es});return{t:'Vec',h:halloc('vec',it.length,o.es,it,`${nm}.clone()`),et:rv.et};}
        if(rv.t==='String'){const s=H(rv.h).s,b=new TextEncoder().encode(s!).length;ev('clone',{name:nm,bytes:b});return{t:'String',h:halloc('string',b,1,s!,`${nm}.clone()`)};}return copy(rv);
      case'to_string':case'to_owned':case'to_uppercase':case'to_lowercase':{let s=rv.t==='i'||rv.t==='f'||rv.t==='b'?show(rv):text(rv);if(m==='to_uppercase')s=s.toUpperCase();if(m==='to_lowercase')s=s.toLowerCase();const b=new TextEncoder().encode(s).length;return{t:'String',h:halloc('string',b,1,s,`${m}()`)};}
      case'as_str':if(rv.t==='String'&&pl)return{t:'ref',mut:false,to:{fi:pl.fi,si:pl.si},asStr:true};break;
      case'iter':if(pl){let p=pl;const s=S.fr[p.fi].slots[p.si];if(s.v.t==='ref'&&p.idx==null)return{...s.v,iter:true};return{t:'ref',mut:false,to:{fi:p.fi,si:p.si,idx:p.idx},iter:true};}break;
      case'chars':return{t:'chars',s:text(rv)};
      case'sum':if(recv.t==='ref'){const c=items(dz(recv))||[];let acc=0,ty='i32';c.forEach(x=>{acc+=dz(x).v;ty=dz(x).ty||ty;});ev('sum',{n:c.length});return{t:'i',v:acc,ty,inf:false};}break;
      case'contains':{const x=dz(A(0));if(rv.t==='Vec'||rv.t==='arr')return{t:'b',v:(items(rv))!.some(y=>disp(dz(y))===disp(x))};return{t:'b',v:text(rv).includes(text(x))};}
      case'abs':return{...rv,v:Math.abs(rv.v)};case'pow':{const r=rv.v**dz(A(0)).v;ovf(r,rv.ty!,'multiply',l!);return{...rv,v:r};}
      case'min':case'max':{const x=dz(A(0));return Math[m as 'min' | 'max'](rv.v,x.v)===rv.v?rv:x;}case'sqrt':return{t:'f',v:Math.sqrt(rv.v)};}
    comp('E0599',`method \`${m}\` is not in the browser visualizer's subset yet (on \`${tyOf(rv)}\`)`,l!);}
  function mac(e: VzNode): VzVal{const n=e.name,l=e.line;
    if(n==='println'||n==='print'||n==='eprintln'||n==='eprint'){const r=fmt(e.args!,l!),s=r.s+(n.endsWith('ln')?'\n':'');if(n[0]==='e')S.err+=s;else S.out+=s;S.cnt.writes++;ev('print',{bytes:new TextEncoder().encode(s).length,err:n[0]==='e',nl:n.endsWith('ln'),text:s});return U;}
    if(n==='format'){const r=fmt(e.args!,l!),pl=r.pieces.reduce((a,p)=>a+new TextEncoder().encode(p).length,0),cap0=!r.nargs?pl:(r.pieces[0]===''&&pl<16?0:pl*2),id=halloc('string',cap0,1,'','format!'),o=H(id);for(const sg of r.segs){if(!sg)continue;const need=new TextEncoder().encode(o.s+sg).length;if(need>o.cap)grow(o,need,'format!');o.s+=sg;}ev('format',{est:cap0,len:new TextEncoder().encode(o.s!).length,cap:o.cap});return{t:'String',h:id};}
    if(n==='panic'){panic(e.args!.length?fmt(e.args!,l!).s:'explicit panic',l!);}
    if(n==='assert'){const c=dz(eval_(e.args![0],false));if(!c.v)panic(e.args![1]?fmt(e.args!.slice(1),l!).s:'assertion failed',l!);ev('assert',{ok:true});return U;}
    if(n==='assert_eq'||n==='assert_ne'){const a=eval_(e.args![0],false),b=eval_(e.args![1],false),eq=cmp('==',a,b).v;if(eq!==(n==='assert_eq'))panic(`assertion \`left ${n==='assert_eq'?'==':'!='} right\` failed\n  left: ${disp(dz(a))}\n right: ${disp(dz(b))}`,l!);ev('assert',{ok:true});return U;}
    if(n==='dbg'){const v=eval_(e.args![0],true);S.err+=`[src/main.rs:${l}] = ${disp(dz(v))}\n`;S.cnt.writes++;return v;}
    comp('E0433',`macro \`${n}!\` is not in the browser subset yet`,l!);}
  function block(b: VzNode,isFn?: boolean): VzVal{const f=fr(),start=f.slots.length;let v=U;try{for(const s of b.stmts!)exec(s);if(b.tail){line0.v=(b.tail as VzNode).line as number;const t=b.tail as VzNode;S.lastMove=null;v=eval_(t,true);if(!isFn&&t.k!=='if'&&t.k!=='block'){}}}
    finally{const dropped: string[]=[];for(let i=f.slots.length-1;i>=start;i--){const s=f.slots[i];if(s.dead)continue;if(s.st!=='moved'&&s.name!=='(temp)')drop(s.v,s.name);if(!isFn){s.dead=true;dropped.push(s.name);}}if(dropped.length&&!isFn&&S.ev.some(x=>x.k==='free'))ev('scope',{names:dropped});}
    return v;}
  function exec(s: VzNode): void{line0.v=s.line!;S.lastMove=null;switch(s.k){
    case'let':{let v=s.init?eval_(s.init,true):null;const mvd=S.lastMove as VzSlotState | null | undefined;S.lastMove=null;if(v&&s.ty)coerce(v,s.ty);const hn=(HN[fr().fn]||{})[s.name!];if(v&&!s.ty&&hn){if(hn.t&&v.t==='i'&&v.inf)coerce(v,hn.t);if(hn.el&&v.t==='arr')coerce(v,`[${hn.el}; ${v.items!.length}]`);if(hn.el&&v.t==='Vec')coerce(v,`Vec<${hn.el}>`);}if(v&&v.t==='i'&&v.inf&&!s.ty){}const sl=newSlot(s.name!,v||U,s.ty,s.mut,s.line!);if(!v)sl.v=null as unknown as VzVal;
      if(mvd&&s.init!.k==='var'){mvd.mvTo=s.name;ev('move',{from:s.init!.name,to:s.name,size:sl.size,what:tyOf(v)});}
      else if(v&&v.t==='ref')ev('borrow',{name:S.fr[v.to!.fi].slots[v.to!.si].name+(v.to!.idx!=null?`[${v.to!.idx}]`:''),as:s.name,mut:v.mut,size:sl.size,fat:sl.size===16});
      ev('bind',{name:s.name,ty:s.ty||tyOf(v||U),val:v?disp(v):'(uninitialised)',size:sl.size,addr:sl.addr,kind:v?v.t:'u',ro:v&&v.t==='str'?S.ro[v.id!]:null});snap(s.line!);return;}
    case'expr':{if(s.e!.k==='if'){ifStmt(s.e!);return;}if(s.e!.k==='block'){block(s.e!);return;}eval_(s.e!,s.e!.k==='call'||s.e!.k==='mac'||s.e!.k==='mcall');snap(s.line!);return;}
    case'while':{let n=0;for(;;){const c=dz(eval_(s.cond!,false));ev('cond',{kind:'while',v:c.v,n:++n});snap(s.line!);if(!c.v)break;try{block(s.body!);}catch(x){if((x as VzThrow).brk)break;if((x as VzThrow).cont)continue;throw x;}}return;}
    case'loop':{let n=0;for(;;){ev('cond',{kind:'loop',n:++n});snap(s.line!);try{block(s.body!);}catch(x){if((x as VzThrow).brk)break;if((x as VzThrow).cont)continue;throw x;}}return;}
    case'for':{let it=eval_(s.it!,true);const mvd=S.lastMove as VzSlotState | null | undefined;S.lastMove=null;let seq,kind,src='';
      if(it.t==='range'){const a=it.a!.v,b=it.b!.v+(it.incl?1:0);seq=[];for(let i=a;i<b;i++)seq.push({t:'i',v:i,ty:it.a!.ty,inf:it.a!.inf&&it.b!.inf});kind='range';}
      else if(it.t==='ref'){const s0=S.fr[it.to!.fi].slots[it.to!.si],c=items(dz(s0.v));if(!c)comp('E0277',`\`${tyOf(it)}\` is not an iterator`,s.line!);seq=c!.map((_,i)=>({t:'ref',mut:it.mut,to:{fi:it.to!.fi,si:it.to!.si,idx:i}}));kind='slice';src=s0.name;}
      else if(it.t==='Vec'||it.t==='arr'){seq=items(it)!.slice();kind=it.t==='Vec'?'vec':'arr';src=mvd?mvd.name:'';if(mvd)mvd.mvTo='the loop';}
      else if(it.t==='chars'){seq=[...it.s!].map(c=>({t:'c',v:c}));kind='chars';}else comp('E0277',`\`${tyOf(it)}\` is not an iterator`,s.line!);
      if(kind==='vec')ev('consume',{name:src,n:seq.length});
      for(let i=0;i<seq.length;i++){const f=fr(),start=f.slots.length;const x=seq![i];if(s.name!=='_')newSlot(s.name!,x,null,false,s.line!);ev('iter',{name:s.name,val:disp(x),kind,i,n:seq.length,src,es:kind==='slice'?esz((dz(S.fr[it.to!.fi].slots[it.to!.si].v)).et):0});snap(s.line!);
        let br=false;try{block(s.body!);}catch(x2){if((x2 as VzThrow).brk)br=true;else if(!(x2 as VzThrow).cont)throw x2;}finally{for(let j=f.slots.length-1;j>=start;j--){const sl=f.slots[j];if(!sl.dead&&sl.st!=='moved'&&kind==='vec')drop(sl.v,sl.name);sl.dead=true;}}if(br){if(kind==='vec')seq!.slice(i+1).forEach(y=>drop(y,'(rest)'));break;}}
      if(kind==='vec'&&it.t==='Vec'){const o=H(it.h);if(o.cap){S.cnt.frees++;S.cnt.live-=o.cap*o.es;ev('free',{name:src||'vec',bytes:o.cap*o.es,addr:o.addr,loop:1});}o.freed=true;o.freedAt=S.steps.length;}
      ev('cond',{kind:'for-end'});snap(s.line!);return;}
    case'ret':{const v=s.e?eval_(s.e,true):U;const e=new Error('ret') as VzThrow;e.ret=1;e.v=v;e.line=s.line;throw e;}
    case'brk':{const e=new Error('brk') as VzThrow;e.brk=1;throw e;}case'cont':{const e=new Error('cont') as VzThrow;e.cont=1;throw e;}}}
  function ifStmt(e: VzNode): void{const c=dz(eval_(e.c!,false));if(c.t!=='b')comp('E0308',`expected \`bool\`, found \`${tyOf(c)}\``,e.line!);ev('cond',{kind:'if',v:c.v});snap(e.line!);if(c.v)block(e.th!);else if(e.el){if(e.el.k==='if')ifStmt(e.el);else block(e.el);}}
  S.fr.push({fn:'main',slots:[],scopes:[0],sp:S.sp,base:S.sp,callLine:ast.fns.main.line});S.cnt.maxDepth=1;ev('start',{});snap(ast.fns.main.line);let end: VzRunResult['end']=null;
  try{block(ast.fns.main.body,true);ev('exit',{code:0});snap(ast.fns.main.body.end!);fr().slots.forEach(s=>s.dead=true);end={ok:true};}
  catch(x){if((x as VzThrow).panic){const fl=S.fr.map(f=>f.fn).reverse();S.err+=(x as VzThrow).so?`\nthread 'main' has overflowed its stack\nfatal runtime error: stack overflow\n`:`thread 'main' panicked at src/main.rs:${(x as VzThrow).vline}:\n${(x as VzThrow).message}\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n`;
      {const pe={k:'panic',msg:(x as VzThrow).message,so:(x as VzThrow).so,frames:fl},ix=S.ev.findIndex(e=>e.k==='free'||e.k==='dropnoop');if(ix<0)S.ev.push(pe);else{S.ev.slice(ix).forEach(e=>{if(e.k==='free')e.unw=1;});S.ev.splice(ix,0,pe);}}if(!(x as VzThrow).so){for(let k=S.fr.length-1;k>=0;k--){const f=S.fr[k];for(let i=f.slots.length-1;i>=0;i--){const s=f.slots[i];if(!s.dead&&s.st!=='moved')drop(s.v,s.name);}}ev('unwind',{});}snap((x as VzThrow).vline||0);end={panic:(x as VzThrow).message,line:(x as VzThrow).vline};}
    else if((x as VzThrow).comp){end={comp:(x as VzThrow).comp,msg:(x as VzThrow).message,line:(x as VzThrow).vline,hint:(x as VzThrow).hint};ev('comp',{code:(x as VzThrow).comp,msg:(x as VzThrow).message,hint:(x as VzThrow).hint});snap((x as VzThrow).vline||0);}else if((x as VzThrow).limit){end={limit:true};}else throw x;}
  return{steps:S.steps,end,out:S.out,err:S.err};}
