// @ts-nocheck
/* ═════════ dxtutor IDE — feature: Visualize execution (overlay) ═════════
   Feature da reestruturação POR FUNCIONALIDADE. Ao contrário das features-folha
   (que só detêm o render de um pane), esta feature é DONA de TODA a sua lógica:
   o modelo-subconjunto de Rust (lexer `vzLex`, parser `vzParse`, interpretador
   com modelo de memória `vzRun`, narração a três níveis `vzTell`) e o overlay de
   visualização (`vizOpen`/`vzRender`/`vzArrows` + controlos). Migrada da camada
   transitória `v7.ts` (por CAMADA temporal), agora ELIMINADA.

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

   @ts-nocheck: o interior denso do interpretador (AST polimórfico + objectos-valor
   `{t,v,ty}`) fica por tipar numa passagem futura dedicada; aqui o foco é a
   EXTRACÇÃO para a feature-dona, eliminando a camada v7. */
import { $, esc, svg, show, toast } from "../core";
import { publish } from "./visualizer/infrastructure/legacy-bridge";
export {};

P.film='<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 2.5v11M11 2.5v11M2 5.5h3M2 8h3M2 10.5h3M11 5.5h3M11 8h3M11 10.5h3"/>';

/* ───── lexer + parser (teaching subset of Rust) ───── */
function vzErr(m,line){const e=new Error(m);e.vline=line;e.vz=1;return e;}
function vzLex(src){const T=[];let i=0,line=1;const n=src.length,OPS=['..=','->','=>','==','!=','<=','>=','&&','||','+=','-=','*=','/=','%=','::','..'];
  while(i<n){const c=src[i];if(c==='\n'){line++;i++;continue;}if(/\s/.test(c)){i++;continue;}
    if(c==='/'&&src[i+1]==='/'){while(i<n&&src[i]!=='\n')i++;continue;}
    if(c==='/'&&src[i+1]==='*'){i+=2;while(i<n&&!(src[i]==='*'&&src[i+1]==='/')){if(src[i]==='\n')line++;i++;}i+=2;continue;}
    if(/[0-9]/.test(c)){let j=i;while(j<n&&/[0-9_]/.test(src[j]))j++;let f=false;if(src[j]==='.'&&/[0-9]/.test(src[j+1]||'')){f=true;j++;while(j<n&&/[0-9_]/.test(src[j]))j++;}const num=Number(src.slice(i,j).replace(/_/g,''));const m=src.slice(j).match(/^(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize|f32|f64)/);if(m)j+=m[1].length;T.push({k:'num',v:num,suf:m?m[1]:null,f:f||(m&&m[1][0]==='f'),line});i=j;continue;}
    if(/[A-Za-z_]/.test(c)){let j=i;while(j<n&&/[A-Za-z0-9_]/.test(src[j]))j++;T.push({k:'id',v:src.slice(i,j),line});i=j;continue;}
    if(c==='"'){let j=i+1,s='';while(j<n&&src[j]!=='"'){if(src[j]==='\\'){const e=src[j+1];s+=e==='n'?'\n':e==='t'?'\t':e;j+=2;}else{if(src[j]==='\n')line++;s+=src[j++];}}T.push({k:'str',v:s,line});i=j+1;continue;}
    if(c==="'"){if(src[i+2]==="'"){T.push({k:'char',v:src[i+1],line});i+=3;continue;}if(src[i+1]==='\\'&&src[i+3]==="'"){const e=src[i+2];T.push({k:'char',v:e==='n'?'\n':e==='t'?'\t':e,line});i+=4;continue;}let j=i+1;while(/[A-Za-z_]/.test(src[j]||''))j++;i=j;continue;}
    const op=OPS.find(o=>src.startsWith(o,i));if(op){T.push({k:'op',v:op,line});i+=op.length;continue;}T.push({k:'op',v:c,line});i++;}
  T.push({k:'eof',line});return T;}
function vzParse(src){const T=vzLex(src);let p=0;const pk=(o=0)=>T[Math.min(p+o,T.length-1)],nx=()=>T[p++],is=(v,o=0)=>{const t=pk(o);return(t.k==='op'||t.k==='id')&&t.v===v;};
  const E=m=>vzErr(m,pk().line),eat=v=>{if(!is(v))throw E(`expected \`${v}\`, found \`${pk().k==='eof'?'end of file':pk().v}\``);return nx();},ident=()=>{const t=pk();if(t.k!=='id')throw E(`expected a name, found \`${t.v}\``);p++;return t.v;};
  const NOPE={struct:'structs',enum:'enums',impl:'impl blocks',trait:'traits',mod:'modules',match:'match',const:'constants',static:'statics',unsafe:'unsafe code',async:'async code',dyn:'trait objects',where:'where clauses',type:'type aliases',Some:'Option',None:'Option',Ok:'Result',Err:'Result',Box:'Box',Rc:'Rc',HashMap:'HashMap'};
  const nope=t=>vzErr(`${NOPE[t.v]||'`'+t.v+'`'} ${/s$/.test(NOPE[t.v]||'')?'are':'is'} not in the browser visualizer's Rust subset yet. The desktop app traces any program with the real compiler.`,t.line);
  function type(){if(is('&')||is('&&')){nx();const m=is('mut')?(nx(),'mut '):'';return '&'+m+type();}
    if(is('[')){nx();const t=type();if(is(';')){nx();const n=nx();eat(']');return `[${t}; ${n.v}]`;}eat(']');return `[${t}]`;}
    if(is('(')){nx();eat(')');return '()';}if(is('impl')||is('dyn'))throw nope(pk());let n=ident();while(is('::')){nx();n+='::'+ident();}if(NOPE[n])throw nope({v:n,line:pk().line});
    if(is('<')){nx();const a=[type()];while(is(',')){nx();a.push(type());}eat('>');n+=`<${a.join(', ')}>`;}return n;}
  const fns={};
  function items_(){while(pk().k!=='eof'){if(is('#')){nx();if(is('!'))nx();eat('[');let d=1;while(d&&pk().k!=='eof'){const t=nx();if(t.v==='[')d++;else if(t.v===']')d--;}continue;}
    if(is('use')){while(!is(';')&&pk().k!=='eof')nx();nx();continue;}if(is('pub')){nx();continue;}
    if(is('fn')){const ft=nx(),name=ident();if(is('<'))throw E('Generic functions are not in the browser subset yet.');eat('(');const params=[];while(!is(')')){const mut=is('mut')?(nx(),true):false;const pn=ident();eat(':');params.push({name:pn,mut,ty:type()});if(is(','))nx();else break;}eat(')');let ret=null;if(is('->')){nx();ret=type();}if(is('where'))throw nope(pk());const body=block();fns[name]={name,params,ret,body,line:ft.line};continue;}
    throw NOPE[pk().v]?nope(pk()):E(`unexpected \`${pk().v}\` at the top level`);}}
  function block(){const st=eat('{'),stmts=[];let tail=null;while(!is('}')){if(pk().k==='eof')throw vzErr('unclosed `{`',st.line);const s=stmt();if(s.tail){tail=s.e;break;}if(s.k!=='empty')stmts.push(s);}const en=eat('}');return{k:'block',stmts,tail,line:st.line,end:en.line};}
  function stmt(){const t=pk();if(is(';')){nx();return{k:'empty'};}
    if(is('let')){nx();const mut=is('mut')?(nx(),true):false;if(is('('))throw vzErr('Tuple patterns are not in the browser subset yet.',t.line);const name=ident();let ty=null;if(is(':')){nx();ty=type();}let init=null;if(is('=')){nx();init=expr();}eat(';');return{k:'let',name,mut,ty,init,line:t.line};}
    if(is('while')){nx();if(is('let'))throw vzErr('`while let` needs Option, not in the subset yet.',t.line);const cond=expr();return{k:'while',cond,body:block(),line:t.line};}
    if(is('for')){nx();const name=ident();eat('in');const it=expr();return{k:'for',name,it,body:block(),line:t.line};}
    if(is('loop')){nx();return{k:'loop',body:block(),line:t.line};}
    if(is('return')){nx();const e=is(';')||is('}')?null:expr();if(is(';'))nx();return{k:'ret',e,line:t.line};}
    if(is('break')||is('continue')){nx();if(is(';'))nx();return{k:t.v==='break'?'brk':'cont',line:t.line};}
    if(t.k==='id'&&NOPE[t.v]&&t.v!=='Some')throw nope(t);
    const e=expr();if(is(';')){nx();return{k:'expr',e,line:t.line};}if(is('}'))return{tail:true,e};if(e.k==='if'||e.k==='block')return{k:'expr',e,line:t.line};throw E('expected `;`');}
  const BP={'=':1,'+=':1,'-=':1,'*=':1,'/=':1,'%=':1,'..':2,'..=':2,'||':3,'&&':4,'==':5,'!=':5,'<':5,'>':5,'<=':5,'>=':5,'+':8,'-':8,'*':9,'/':9,'%':9};
  function expr(min=0){let l=unary();for(;;){const t=pk();if(t.k==='id'&&t.v==='as'){if(10<min)break;nx();l={k:'cast',e:l,ty:type(),line:t.line};continue;}
      if(t.k!=='op')break;const b=BP[t.v];if(!b||b<min)break;nx();if(b===1){l={k:'assign',op:t.v,tg:l,e:expr(1),line:t.line};continue;}if(b===2){l={k:'range',a:l,b:expr(3),incl:t.v==='..=',line:t.line};continue;}l={k:'bin',op:t.v,a:l,b:expr(b+1),line:t.line};}return l;}
  function unary(){const t=pk();if(is('-')||is('!')){nx();return{k:'un',op:t.v,e:unary(),line:t.line};}if(is('&')||is('&&')){nx();const mut=is('mut')?(nx(),true):false;return{k:'ref',mut,e:unary(),line:t.line};}
    if(is('*')){nx();return{k:'deref',e:unary(),line:t.line};}if(is('|')||is('||'))throw vzErr('Closures are not in the browser subset yet.',t.line);return post(prim());}
  function list(c){const a=[];while(!is(c)){a.push(expr());if(is(','))nx();else break;}eat(c);return a;}
  function post(e){for(;;){const t=pk();if(is('(')&&(e.k==='var'||e.k==='path')){nx();e={k:'call',fn:e.k==='var'?e.name:e.parts.join('::'),args:list(')'),line:t.line};continue;}
      if(is('.')){nx();if(pk().k==='num')throw vzErr('Tuples are not in the browser subset yet.',t.line);const m=ident();if(is('::'))throw vzErr('Turbofish `::<>` is not in the subset yet — annotate the variable type instead.',t.line);if(!is('('))throw vzErr(`Field access \`.${m}\` needs structs, not in the subset yet.`,t.line);nx();e={k:'mcall',obj:e,m,args:list(')'),line:t.line};continue;}
      if(is('[')){nx();if(is('..')||is(']'))throw vzErr('Range slicing `[a..b]` is not in the subset yet.',t.line);const i=expr();if(i.k==='range')throw vzErr('Range slicing `[a..b]` is not in the subset yet.',t.line);eat(']');e={k:'idx',e,i,line:t.line};continue;}
      if(is('?'))throw vzErr('The `?` operator needs Result, not in the subset yet.',t.line);return e;}}
  function prim(){const t=pk();
    if(t.k==='num'){nx();return t.f?{k:'float',v:t.v,line:t.line}:{k:'int',v:t.v,suf:t.suf,line:t.line};}
    if(t.k==='str'){nx();return{k:'strlit',v:t.v,line:t.line};}if(t.k==='char'){nx();return{k:'charlit',v:t.v,line:t.line};}
    if(is('true')||is('false')){nx();return{k:'bool',v:t.v==='true',line:t.line};}
    if(is('(')){nx();if(is(')')){nx();return{k:'unit',line:t.line};}const e=expr();if(is(','))throw vzErr('Tuples are not in the browser subset yet.',t.line);eat(')');return e;}
    if(is('[')){nx();if(is(']')){nx();return{k:'arr',items:[],line:t.line};}const f=expr();if(is(';')){nx();const n=expr();eat(']');return{k:'arrrep',e:f,n,line:t.line};}const items=[f];while(is(',')){nx();if(is(']'))break;items.push(expr());}eat(']');return{k:'arr',items,line:t.line};}
    if(is('{'))return block();if(is('if')){return ifx();}
    if(t.k==='id'){if(NOPE[t.v])throw nope(t);if(['while','for','loop'].includes(t.v))throw vzErr(`\`${t.v}\` as a value is not in the subset yet.`,t.line);nx();
      if(is('!')&&(is('(',1)||is('[',1))){nx();const open=nx().v;
        if(t.v==='vec'){if(open!=='[')throw vzErr('use vec![…]',t.line);if(is(']')){nx();return{k:'vec',items:[],line:t.line};}const f=expr();if(is(';')){nx();const n=expr();eat(']');return{k:'vecrep',e:f,n,line:t.line};}const items=[f];while(is(',')){nx();if(is(']'))break;items.push(expr());}eat(']');return{k:'vec',items,line:t.line};}
        return{k:'mac',name:t.v,args:list(open==='('?')':']'),line:t.line};}
      if(is('::')){const parts=[t.v];while(is('::')){nx();if(is('<'))throw vzErr('Turbofish `::<>` is not in the subset yet.',t.line);parts.push(ident());}return{k:'path',parts,line:t.line};}
      return{k:'var',name:t.v,line:t.line};}
    throw E(`unexpected \`${t.k==='eof'?'end of file':t.v}\``);}
  function ifx(){const t=eat('if');if(is('let'))throw vzErr('`if let` needs Option, not in the subset yet.',t.line);const c=expr(),th=block();let el=null;if(is('else')){nx();el=is('if')?ifx():block();}return{k:'if',c,th,el,line:t.line};}
  items_();return{fns};}

/* ───── interpreter with a memory model ───── */
const VZSZ={i8:1,u8:1,i16:2,u16:2,i32:4,u32:4,f32:4,i64:8,u64:8,f64:8,isize:8,usize:8,i128:16,u128:16,bool:1,char:4};
const VZR={i8:[-128,127],u8:[0,255],i16:[-32768,32767],u16:[0,65535],i32:[-2147483648,2147483647],u32:[0,4294967295],i64:[-(2**63),2**63-1],u64:[0,2**64-1],isize:[-(2**63),2**63-1],usize:[0,2**64-1]};
const hex=n=>'0x'+Math.floor(n).toString(16).padStart(12,'0');
function vzHints(ast){const H={};for(const f of Object.values(ast.fns)){const h=H[f.name]={},isLen=x=>x&&x.k==='mcall'&&['len','capacity'].includes(x.m);const walk=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}
  if(n.k==='call'&&ast.fns[n.fn])n.args.forEach((a,i)=>{const p=ast.fns[n.fn].params[i];if(!p)return;if(a.k==='ref'&&a.e.k==='var'){const m=p.ty.match(/^&(?:mut )?\[([^;\]]+)\]$/)||p.ty.match(/^&(?:mut )?Vec<(.+)>$/);if(m)h[a.e.name]=h[a.e.name]||{el:m[1]};}else if(a.k==='var'&&VZSZ[p.ty])h[a.name]=h[a.name]||{t:p.ty};});
  if(n.k==='bin'&&['<','>','<=','>=','==','!='].includes(n.op)){if(n.a.k==='var'&&isLen(n.b))h[n.a.name]=h[n.a.name]||{t:'usize'};if(n.b.k==='var'&&isLen(n.a))h[n.b.name]=h[n.b.name]||{t:'usize'};}
  if(n.k==='idx'&&n.i&&n.i.k==='var')h[n.i.name]=h[n.i.name]||{t:'usize'};if(n.k==='ret'&&n.e&&n.e.k==='var'&&f.ret&&VZSZ[f.ret])h[n.e.name]=h[n.e.name]||{t:f.ret};for(const k in n)if(k!=='k'&&typeof n[k]==='object')walk(n[k]);};walk(f.body);if(f.body.tail&&f.body.tail.k==='var'&&f.ret&&VZSZ[f.ret])h[f.body.tail.name]=h[f.body.tail.name]||{t:f.ret};}return H;}
function vzRun(src){const ast=vzParse(src),HN=vzHints(ast);if(!ast.fns.main)throw vzErr('There is no `fn main()` to run. The visualizer runs a whole program.',1);
  const S={fr:[],heap:{},hid:0,ha:0x55d1c2b4e010,sp:0x7ffd3a1c9000,ro:[],roa:0x55d1c29f3000,out:'',err:'',steps:[],ev:[],cnt:{calls:0,maxDepth:0,allocs:0,frees:0,reallocs:0,live:0,peak:0,bounds:0,ovf:0,moves:0,copied:0,writes:0}},STOP={};
  const ev=(k,o)=>S.ev.push(Object.assign({k},o||{})),fr=()=>S.fr[S.fr.length-1],line0={v:0};
  const panic=(m,l)=>{const e=new Error(m);e.panic=1;e.vline=l;throw e;},comp=(code,m,l,hint)=>{const e=new Error(m);e.comp=code;e.vline=l;e.hint=hint;throw e;};
  const I=(v,ty)=>({t:'i',v,ty:ty||'i32',inf:!ty}),U={t:'u'};
  const esz=et=>VZSZ[et]||(et==='String'||/^Vec/.test(et||'')?24:et==='&str'?16:/^&/.test(et||'')?8:4);
  const H=id=>S.heap[id];
  function text(v){v=dz(v);return v.t==='str'?S.ro[v.id].s:v.t==='String'?H(v.h).s:v.t==='c'?v.v:String(v.v);}
  function tgt(r){const s=S.fr[r.to.fi]&&S.fr[r.to.fi].slots[r.to.si];if(!s)return U;if(r.to.idx==null)return s.v;const c=items(dz(s.v));return c?c[r.to.idx]:U;}
  function dz(v){let n=0;while(v&&v.t==='ref'&&n++<20)v=tgt(v);return v;}
  function items(v){return v.t==='arr'?v.items:v.t==='Vec'?H(v.h).items:null;}
  function tyOf(v){if(!v)return'?';switch(v.t){case'i':return v.ty;case'f':return'f64';case'b':return'bool';case'c':return'char';case'u':return'()';case'str':return'&str';case'String':return'String';case'Vec':return`Vec<${v.et||'_'}>`;case'arr':return`[${v.et||'_'}; ${v.items.length}]`;case'ref':return(v.mut?'&mut ':'&')+(v.asStr?'str':tyOf(tgt(v)));case'range':return'Range<'+v.a.ty+'>';case'chars':return'Chars';}return'?';}
  function sizeOf(v,ty){ty=ty||'';if(v.t==='i')return VZSZ[v.ty]||4;if(v.t==='f')return 8;if(v.t==='b')return 1;if(v.t==='c')return 4;if(v.t==='u')return 0;if(v.t==='str')return 16;if(v.t==='String'||v.t==='Vec')return 24;if(v.t==='arr')return v.items.length*esz(v.et);if(v.t==='ref')return/\[|str/.test(ty)||v.asStr?16:8;if(v.t==='range')return 2*(VZSZ[v.a.ty]||4);return 8;}
  function copy(v){return v.t==='arr'?{...v,items:v.items.map(copy)}:{...v};}
  function isCopy(v){return['i','f','b','c','u','str','range','chars'].includes(v.t)||(v.t==='ref')||(v.t==='arr'&&v.items.every(isCopy));}
  function halloc(kind,cap,es,init,label){const id='h'+(++S.hid),bytes=cap*es,o={id,kind,cap,es,items:kind==='vec'?(init||[]):null,s:kind==='string'?(init||''):null,addr:cap?S.ha:0,freed:false,label};S.heap[id]=o;
    if(cap){S.ha+=Math.ceil((bytes+16)/16)*16+16;S.cnt.allocs++;S.cnt.live+=bytes;S.cnt.peak=Math.max(S.cnt.peak,S.cnt.live);ev('alloc',{bytes,cap,addr:o.addr,what:kind==='vec'?'Vec buffer':'String buffer',label});}else ev('noalloc',{what:kind==='vec'?'Vec':'String',label});return id;}
  function grow(o,need,name){const nc=Math.max(o.cap*2,need,o.es===1?8:o.es<=1024?4:1),old=o.cap,len=o.kind==='vec'?o.items.length:new TextEncoder().encode(o.s).length;
    if(old===0){o.cap=nc;o.addr=S.ha;S.ha+=Math.ceil((nc*o.es+16)/16)*16+16;S.cnt.allocs++;S.cnt.live+=nc*o.es;ev('alloc',{bytes:nc*o.es,cap:nc,addr:o.addr,what:o.kind==='vec'?'Vec buffer':'String buffer',label:name,first:true});}
    else{const oa=o.addr;o.addr=S.ha;S.ha+=Math.ceil((nc*o.es+16)/16)*16+16;S.cnt.reallocs++;S.cnt.copied+=len*o.es;S.cnt.live+=(nc-old)*o.es;o.cap=nc;ev('grow',{name,old,nc,copied:len*o.es,from:oa,to:o.addr,es:o.es});}S.cnt.peak=Math.max(S.cnt.peak,S.cnt.live);}
  function drop(v,name){if(!v)return;if(v.t==='Vec'||v.t==='String'){const o=H(v.h);if(!o||o.freed)return;if(o.kind==='vec')o.items.forEach(x=>drop(x,name+'[…]'));if(o.cap){S.cnt.frees++;S.cnt.live-=o.cap*o.es;ev('free',{name,bytes:o.cap*o.es,addr:o.addr});}else ev('dropnoop',{name});o.freed=true;o.freedAt=S.steps.length;}else if(v.t==='arr')v.items.forEach(x=>drop(x,name));}
  function strlit(s){let r=S.ro.find(x=>x.s===s);if(!r){r={s,addr:S.roa,id:S.ro.length};S.roa+=Math.max(8,new TextEncoder().encode(s).length);S.ro.push(r);}return{t:'str',id:r.id};}
  function newSlot(name,v,ty,mut,line){const f=fr(),size=sizeOf(v,ty);f.sp-=Math.max(8,Math.ceil(size/8)*8);const s={name,v,ty,mut,st:'live',addr:f.sp,size,line,dead:false};f.slots.push(s);S.sp=Math.min(S.sp,f.sp);return s;}
  function look(name,l){const f=fr();for(let i=f.slots.length-1;i>=0;i--){const s=f.slots[i];if(!s.dead&&s.name===name)return{s,fi:S.fr.length-1,si:i};}comp('E0425',`cannot find value \`${name}\` in this scope`,l);}
  function coerce(v,ty){if(!ty||!v)return v;if(v.t==='i'&&VZSZ[ty]&&v.inf){v.ty=ty;v.inf=false;ovf(v.v,ty,'convert',0);}
    else if(v.t==='f'&&v.inf)v.inf=false;
    else if(v.t==='Vec'){const m=ty.match(/^Vec<(.+)>$/);if(m){v.et=m[1];H(v.h).items.forEach(x=>coerce(x,m[1]));H(v.h).es=esz(m[1]);}}
    else if(v.t==='arr'){const m=ty.match(/^\[(.+?)(;|\])/);if(m){v.et=m[1].trim();v.items.forEach(x=>coerce(x,v.et));}}
    else if(v.t==='ref'){const inner=ty.replace(/^&(mut )?/,'');if(inner==='str'&&dz(v).t==='String')v.asStr=true;const s=S.fr[v.to.fi].slots[v.to.si];if(v.to.idx==null){const m=inner.match(/^\[([^;\]]+)\]$/);if(m){const t=dz(s.v);if(t.t==='arr'){t.et=m[1];t.items.forEach(x=>coerce(x,m[1]));}else if(t.t==='Vec'){t.et=m[1];H(t.h).items.forEach(x=>coerce(x,m[1]));}}else coerce(dz(s.v),inner);}}return v;}
  function ovf(n,ty,op,l){const r=VZR[ty];if(!r)return n;if(op!=='convert')S.cnt.ovf++;if(n<r[0]||n>r[1]){if(op==='convert')comp('E0080',`literal out of range for \`${ty}\``,l);panic(`attempt to ${op} with overflow`,l);}return n;}
  function num(v){v=dz(v);if(v.t!=='i'&&v.t!=='f')comp('E0277',`expected a number, found \`${tyOf(v)}\``,line0.v);return v;}
  function arith(op,a,b,l){a=dz(a);b=dz(b);if(op==='+'&&a.t==='String'){const o=H(a.h),t=text(b),need=new TextEncoder().encode(o.s+t).length;if(need>o.cap)grow(o,need,'(temp)');o.s+=t;return a;}
    if(a.t==='f'||b.t==='f'){const x=num(a).v,y=num(b).v;return{t:'f',v:op==='+'?x+y:op==='-'?x-y:op==='*'?x*y:op==='/'?x/y:x%y};}
    const x=num(a),y=num(b),ty=x.inf?y.ty:x.ty,inf=x.inf&&y.inf;let r;
    if((op==='/'||op==='%')&&y.v===0)panic(op==='/'?'attempt to divide by zero':'attempt to calculate the remainder with a divisor of zero',l);
    r=op==='+'?x.v+y.v:op==='-'?x.v-y.v:op==='*'?x.v*y.v:op==='/'?Math.trunc(x.v/y.v):x.v%y.v;ovf(r,ty,{'+':'add','-':'subtract','*':'multiply','/':'divide','%':'calculate the remainder'}[op],l);ev('ovf',{op,ty});return{t:'i',v:r,ty,inf};}
  function cmp(op,a,b){a=dz(a);b=dz(b);const x=['str','String','c'].includes(a.t)?text(a):a.v,y=['str','String','c'].includes(b.t)?text(b):b.v;let r;if((a.t==='Vec'||a.t==='arr')&&items(b)){const xa=JSON.stringify(items(a).map(x=>disp(x))),ya=JSON.stringify(items(b).map(x=>disp(x)));r=op==='=='?xa===ya:xa!==ya;}else r=op==='=='?x===y:op==='!='?x!==y:op==='<'?x<y:op==='>'?x>y:op==='<='?x<=y:x>=y;return{t:'b',v:r};}
  function disp(v,d=0){if(!v||d>4)return'…';switch(v.t){case'i':return String(v.v);case'f':return Number.isInteger(v.v)?v.v.toFixed(1):String(+v.v.toFixed(6));case'b':return String(v.v);case'c':return`'${v.v}'`;case'u':return'()';case'str':return JSON.stringify(S.ro[v.id].s);case'String':return JSON.stringify(H(v.h).s);case'Vec':return`[${H(v.h).items.map(x=>disp(x,d+1)).join(', ')}]`;case'arr':return`[${v.items.map(x=>disp(x,d+1)).join(', ')}]`;case'ref':return'&'+disp(v.asStr?{t:'str_',s:text(v)}:tgt(v),d+1);case'str_':return JSON.stringify(v.s);case'range':return`${v.a.v}..${v.incl?'=':''}${v.b.v}`;case'chars':return'Chars { … }';}return'?';}
  function show(v){v=dz(v);return v.t==='str'||v.t==='String'?text(v):v.t==='c'?v.v:disp(v);}
  function fmt(args,l){if(!args.length)return'';const f=args[0];if(f.k!=='strlit')comp('E0277','format argument must be a string literal',l);let ai=1,pieces=[],nargs=0;
    const out=f.v.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)?(?::([^}]*))?\}/g,(m,name,spec)=>{if(m==='{{')return'{';if(m==='}}')return'}';nargs++;let v;if(name){v=eval_({k:'var',name,line:l},false);}else{const a=args[ai++];if(!a)comp('E0277','format string has more {} than arguments',l);v=eval_(a,false);}
      const dbg=spec&&/\?/.test(spec),prec=spec&&(spec.match(/\.(\d+)/)||[])[1];let s=dbg?(dz(v).t==='c'?disp(dz(v)):disp(dz(v))):show(v);if(prec!=null&&(dz(v).t==='f'))s=dz(v).v.toFixed(+prec);const w=spec&&(spec.match(/^[<>^]?(\d+)/)||[])[1];if(w)s=/^</.test(spec)?s.padEnd(+w):s.padStart(+w);return'\u0000'+s+'\u0001';});
    const segs=out.split(/\u0000|\u0001/);pieces=segs.filter((x,i)=>i%2===0);return{s:segs.join(''),pieces,nargs,segs};}
  function snap(l,extra){const step={line:l,ev:S.ev,out:S.out,err:S.err,cnt:{...S.cnt},extra:extra||null,frames:S.fr.map((f,fi)=>({fn:f.fn,line:fi===S.fr.length-1?l:f.callLine,sp:f.sp,base:f.base,slots:f.slots.map((s,si)=>s.dead?null:{name:s.name,ty:s.ty||tyOf(s.v),val:s.st==='moved'?'':disp(s.v),addr:s.addr,size:s.st==='moved'||!s.v?s.size:sizeOf(s.v,s.ty),st:s.st,mvAt:s.mvAt,mvTo:s.mvTo,mut:s.mut,fi,si,
      ptr:(s.v.t==='Vec'||s.v.t==='String')&&s.st!=='moved'?s.v.h:null,hdr:(s.v.t==='Vec'||s.v.t==='String')&&s.st!=='moved'&&H(s.v.h)?(o=>({addr:o.addr,cap:o.cap,len:o.kind==='vec'?o.items.length:new TextEncoder().encode(o.s).length}))(H(s.v.h)):null,ro:s.v.t==='str'?s.v.id:null,ref:s.v.t==='ref'?{...s.v.to,mut:s.v.mut,fat:s.size===16}:null,arr:s.v.t==='arr'?s.v.items.map(x=>disp(x)):null,aes:s.v.t==='arr'?esz(s.v.et):0}).filter(Boolean)})),
      heap:Object.values(S.heap).filter(o=>!o.freed||o.freedAt>=S.steps.length).map(o=>({id:o.id,kind:o.kind,addr:o.addr,cap:o.cap,es:o.es,len:o.kind==='vec'?o.items.length:new TextEncoder().encode(o.s).length,cells:o.kind==='vec'?o.items.map(x=>disp(x)):[...o.s],freed:o.freed,label:o.label})),ro:S.ro.map(r=>({...r,len:new TextEncoder().encode(r.s).length}))};
    S.steps.push(step);S.ev=[];if(S.steps.length>=1500){const e=new Error('stopped after 1500 steps — is there an infinite loop?');e.limit=1;e.vline=l;throw e;}}
  function placeOf(e){if(e.k==='var'){const r=look(e.name,e.line);if(r.s.st==='moved')comp('E0382',`borrow of moved value: \`${e.name}\``,e.line,`\`${e.name}\` was moved at line ${r.s.mvAt}${r.s.mvTo?` into \`${r.s.mvTo}\``:''}.`);return{fi:r.fi,si:r.si,root:r.s};}
    if(e.k==='deref'){const v=eval_(e.e,false);if(v.t!=='ref')comp('E0614','type cannot be dereferenced',e.line);return{...v.to,via:true,vmut:v.mut,root:S.fr[v.to.fi].slots[v.to.si]};}
    if(e.k==='idx'){let b=placeOf(e.e);let s=S.fr[b.fi].slots[b.si];while(s.v.t==='ref'&&b.idx==null){b={...s.v.to,via:true,vmut:s.v.mut,root:b.root};s=S.fr[b.fi].slots[b.si];}if(b.idx!=null)comp('E0608','nested indexing is not in the subset yet',e.line);
      const i=dz(eval_(e.i,false));if(i.t!=='i')comp('E0277','the index must be an integer (usize)',e.line);const c=items(dz(s.v));if(!c)comp('E0608',`cannot index into a value of type \`${tyOf(s.v)}\``,e.line);S.cnt.bounds++;ev('bounds',{i:i.v,len:c.length,ok:i.v>=0&&i.v<c.length,name:s.name});
      if(i.v<0||i.v>=c.length)panic(`index out of bounds: the len is ${c.length} but the index is ${i.v}`,e.line);return{...b,idx:i.v};}
    return null;}
  function getP(p){const s=S.fr[p.fi].slots[p.si];if(p.idx==null)return s.v;return items(dz(s.v))[p.idx];}
  function needMut(p,name,l,what){if(p.via?!p.vmut:!S.fr[p.fi].slots[p.si].mut)comp(p.via?'E0596':what==='assign'?'E0384':'E0596',p.via?`cannot ${what==='assign'?'assign through':'borrow as mutable through'} a \`&\` reference`:what==='assign'?`cannot assign twice to immutable variable \`${name}\``:`cannot borrow \`${name}\` as mutable, as it is not declared as mutable`,l,p.via?'Take a `&mut` reference instead.':`Declare it with \`let mut ${name}\`.`);}
  function setP(p,v,l){const s=S.fr[p.fi].slots[p.si];if(p.idx==null){const old=s.v;if(old&&old.t&&s.st!=='moved'&&(old.t==='String'||old.t==='Vec')&&old.h!==v.h)drop(old,s.name+' (old value)');if(s.ty)coerce(v,s.ty);else if(old&&old.t==='i'&&v.t==='i'&&v.inf){v.ty=old.ty;v.inf=old.inf;}s.v=v;s.st='live';}else{const c=items(dz(s.v));const old=c[p.idx];if(old.t==='i'&&v.t==='i'&&v.inf){v.ty=old.ty;}c[p.idx]=v;}}
  function nameOfP(p){const s=S.fr[p.fi].slots[p.si];return p.idx!=null?`${s.name}[${p.idx}]`:s.name;}
  function mkRef(e,mut){if(['var','idx','deref'].includes(e.k)){const p=placeOf(e);const s=S.fr[p.fi].slots[p.si];if(mut&&!(p.via?p.vmut:s.mut))comp('E0596',`cannot borrow \`${s.name}\` as mutable, as it is not declared as mutable`,e.line,`Declare it with \`let mut ${s.name}\`.`);return{t:'ref',mut,to:{fi:p.fi,si:p.si,idx:p.idx}};}
    const v=eval_(e,true),s=newSlot('(temp)',v,null,mut,e.line),f=fr();return{t:'ref',mut,to:{fi:S.fr.length-1,si:f.slots.indexOf(s)}};}
  function eval_(e,mv=true){line0.v=e.line||line0.v;switch(e.k){
    case'int':return e.suf?{t:'i',v:e.v,ty:e.suf,inf:false}:I(e.v);case'float':return{t:'f',v:e.v};case'bool':return{t:'b',v:e.v};case'charlit':return{t:'c',v:e.v};case'unit':return U;
    case'strlit':return strlit(e.v);
    case'arr':{const it=e.items.map(x=>eval_(x,true));return{t:'arr',items:it,et:it[0]?tyOf(it[0]):null};}
    case'arrrep':{const v=eval_(e.e,true),n=dz(eval_(e.n)).v;return{t:'arr',items:Array.from({length:n},()=>copy(v)),et:tyOf(v)};}
    case'vec':case'vecrep':{const it=e.k==='vec'?e.items.map(x=>eval_(x,true)):(()=>{const v=eval_(e.e,true),n=dz(eval_(e.n)).v;return Array.from({length:n},()=>copy(v));})();const et=it[0]?tyOf(it[0]):null;return{t:'Vec',h:halloc('vec',it.length,esz(et),it,'vec!'),et};}
    case'var':{const r=look(e.name,e.line),s=r.s;if(s.st==='moved')comp('E0382',`use of moved value: \`${e.name}\``,e.line,`\`${e.name}\` was moved at line ${s.mvAt}${s.mvTo?` into \`${s.mvTo}\``:''}. Borrow it (\`&${e.name}\`) or clone it before the move.`);
      const v=s.v;if(!v)comp('E0381',`used binding \`${e.name}\` isn't initialized`,e.line);if(isCopy(v)){if(v.t==='arr'&&mv){S.cnt.copied+=sizeOf(v);ev('copyarr',{from:e.name,bytes:sizeOf(v)});}return copy(v);}
      if(mv){s.st='moved';s.mvAt=e.line;S.cnt.moves++;S.lastMove=s;return v;}return v;}
    case'ref':return mkRef(e.e,e.mut);
    case'deref':{const v=eval_(e.e,false);if(v.t!=='ref')comp('E0614',`type \`${tyOf(v)}\` cannot be dereferenced`,e.line);const t=tgt(v);if(!isCopy(t)&&mv)comp('E0507','cannot move out of a shared reference',e.line);return copy(t);}
    case'un':{const v=dz(eval_(e.e,false));if(e.op==='!'){if(v.t==='b')return{t:'b',v:!v.v};}if(v.t==='i'){if(/^u/.test(v.ty)&&!v.inf)comp('E0600',`cannot apply unary operator \`-\` to type \`${v.ty}\``,e.line);return{...v,v:-v.v};}if(v.t==='f')return{t:'f',v:-v.v};comp('E0600',`cannot apply \`${e.op}\` to \`${tyOf(v)}\``,e.line);}
    case'bin':{if(e.op==='&&'||e.op==='||'){const a=dz(eval_(e.a,false));if(e.op==='&&'&&!a.v)return{t:'b',v:false};if(e.op==='||'&&a.v)return{t:'b',v:true};return{t:'b',v:!!dz(eval_(e.b,false)).v};}
      if(['==','!=','<','>','<=','>='].includes(e.op))return cmp(e.op,eval_(e.a,false),eval_(e.b,false));const a=eval_(e.a,false);if(e.op==='+'&&dz(a).t==='String'&&e.a.k==='var'){const r=look(e.a.name,e.line);r.s.st='moved';r.s.mvAt=e.line;S.lastMove=r.s;S.cnt.moves++;}const b=eval_(e.b,false);return arith(e.op,a,b,e.line);}
    case'assign':{const p=placeOf(e.tg);if(!p)comp('E0070','invalid left-hand side of assignment',e.line);needMut(p,nameOfP(p),e.line,'assign');const s=S.fr[p.fi].slots[p.si];let v;
      if(e.op==='='){v=eval_(e.e,true);const mvd=S.lastMove;S.lastMove=null;setP(p,v,e.line);if(mvd&&mvd.st==='moved'&&e.e.k==='var'){mvd.mvTo=nameOfP(p);ev('move',{from:mvd.name,to:nameOfP(p),size:sizeOf(v)});}}
      else{const cur=getP(p);if(dz(cur).t==='String'&&e.op==='+='){const o=H(dz(cur).h),t=text(eval_(e.e,false)),need=new TextEncoder().encode(o.s+t).length;if(need>o.cap)grow(o,need,nameOfP(p));o.s+=t;ev('pushstr',{name:nameOfP(p),add:t,len:need,cap:o.cap});return U;}
        v=arith(e.op[0],cur,eval_(e.e,false),e.line);setP(p,v,e.line);}
      ev('set',{name:nameOfP(p),val:disp(getP(p)),via:p.via});return U;}
    case'range':{const a=dz(eval_(e.a,false)),b=dz(eval_(e.b,false));if(a.t!=='i'||b.t!=='i')comp('E0277','range bounds must be integers',e.line);const ty=a.inf?b.ty:a.ty;return{t:'range',a:{...a,ty},b:{...b,ty},incl:e.incl};}
    case'cast':{const v=dz(eval_(e.e,false));const to=e.ty;if(to==='f64'||to==='f32')return{t:'f',v:v.t==='c'?v.v.codePointAt(0):+v.v};if(to==='char'){return{t:'c',v:String.fromCodePoint(v.v)};}
      if(VZR[to]){let n=v.t==='f'?Math.trunc(v.v):v.t==='c'?v.v.codePointAt(0):v.t==='b'?+v.v:v.v;const r=VZR[to],span=r[1]-r[0]+1,o=n;if(v.t==='f')n=Math.min(r[1],Math.max(r[0],n));else if(n<r[0]||n>r[1])n=((n-r[0])%span+span)%span+r[0];ev('cast',{from:tyOf(v),to,v:o,r:n,wrapped:n!==o,sat:v.t==='f'});return{t:'i',v:n,ty:to,inf:false};}
      comp('E0605',`non-primitive cast to \`${to}\``,e.line);}
    case'if':{const c=dz(eval_(e.c,false));if(c.t!=='b')comp('E0308',`expected \`bool\`, found \`${tyOf(c)}\``,e.line);return c.v?block(e.th):e.el?(e.el.k==='if'?eval_(e.el):block(e.el)):U;}
    case'block':return block(e);
    case'call':return call(e);case'mcall':return mcall(e,mv);case'mac':return mac(e);
    case'idx':{const p=placeOf(e),v=getP(p);if(isCopy(v))return copy(v);if(mv)comp('E0507',`cannot move out of index of \`${tyOf(S.fr[p.fi].slots[p.si].v)}\``,e.line,'Borrow it with `&v[i]` or clone it.');return v;}
    case'path':comp('E0423',`expected value, found \`${e.parts.join('::')}\``,e.line);}
    comp('E0000',`\`${e.k}\` is not supported`,e.line);}
  function call(e){const n=e.fn,l=e.line;
    if(n==='String::from'||n==='String::new'){const t=n==='String::new'?'':text(eval_(e.args[0],false)),b=new TextEncoder().encode(t).length;return{t:'String',h:halloc('string',b,1,t,n)};}
    if(n==='Vec::new')return{t:'Vec',h:halloc('vec',0,4,[],'Vec::new'),et:null};
    if(n==='Vec::with_capacity'||n==='String::with_capacity'){const c=dz(eval_(e.args[0],false)).v;return n[0]==='V'?{t:'Vec',h:halloc('vec',c,4,[],'with_capacity'),et:null}:{t:'String',h:halloc('string',c,1,'','with_capacity')};}
    if(n==='drop'||n==='std::mem::drop'){const a=e.args[0],v=eval_(a,true);if(a.k==='var'){const s=S.lastMove;if(s)s.mvTo='drop()';}drop(v,a.name||'value');return U;}
    const f=ast.fns[n];if(!f)comp('E0425',`cannot find function \`${n}\` in this scope`,l);if(f.params.length!==e.args.length)comp('E0061',`this function takes ${f.params.length} argument(s) but ${e.args.length} were supplied`,l);
    if(S.fr.length>=180){const err=new Error("thread 'main' has overflowed its stack");err.panic=1;err.vline=l;err.so=1;throw err;}
    const args=e.args.map((a,i)=>{S.lastMove=null;const v=eval_(a,true),mv=S.lastMove;S.lastMove=null;if(mv&&a.k==='var'){mv.mvTo=`${f.params[i].name} (in ${n})`;}return{v,mv:mv&&a.k==='var'?a.name:null};});
    const caller=fr();caller.callLine=l;const base=S.sp-16;S.fr.push({fn:n,slots:[],scopes:[0],sp:base,base,callLine:l});S.cnt.calls++;S.cnt.maxDepth=Math.max(S.cnt.maxDepth,S.fr.length);
    const regs=['rdi','rsi','rdx','rcx','r8','r9'];let ri=0;const argInfo=f.params.map((p,i)=>{const v=coerce(args[i].v,p.ty),s=newSlot(p.name,v,p.ty,p.mut,f.line),words=s.size>16?0:Math.max(1,Math.ceil(s.size/8));const r=words?regs.slice(ri,ri+words):[];ri+=words;
      if(args[i].mv)ev('move',{from:args[i].mv,to:`${p.name} (in ${n})`,size:s.size});else if(v.t==='ref')ev('borrow',{name:`${S.fr[v.to.fi].slots[v.to.si].name}${v.to.idx!=null?`[${v.to.idx}]`:''}`,as:p.name,mut:v.mut,size:s.size,fat:s.size===16,param:1});return{name:p.name,ty:p.ty,size:s.size,regs:r,mem:!words,val:disp(v)};});
    ev('call',{fn:n,args:argInfo,depth:S.fr.length});snap(f.line);let ret=U,rl=f.body.tail?f.body.tail.line:f.body.end;
    try{ret=block(f.body,true);}catch(x){if(x.ret){ret=x.v;rl=x.line;}else throw x;}
    ret=coerce(ret,f.ret);const me=fr();for(let i=me.slots.length-1;i>=0;i--){const s=me.slots[i];if(!s.dead&&s.st!=='moved'&&s.name!=='(temp)')drop(s.v,s.name);}
    const rs=sizeOf(ret);ev('ret',{fn:n,val:disp(ret),size:rs,reg:rs===0?null:rs<=8?'rax':rs<=16?'rax:rdx':'memory (sret)',to:S.fr[S.fr.length-2].fn});snap(rl,{retFrom:n});me.slots.forEach(s=>s.dead=true);S.fr.pop();S.sp=Math.max(S.sp,fr().sp);return ret;}
  function mcall(e,mv){const m=e.m,l=e.line,pl=['var','idx','deref'].includes(e.obj.k)?placeOf(e.obj):null;let recv=pl?getP(pl):eval_(e.obj,false);const rv=dz(recv),nm=pl?nameOfP(pl):'value';
    const A=i=>eval_(e.args[i],false),need=what=>{if(!pl)return;let p=pl;const s=S.fr[p.fi].slots[p.si];if(s.v.t==='ref'&&p.idx==null){if(!s.v.mut)comp('E0596',`cannot borrow \`*${s.name}\` as mutable, as it is behind a \`&\` reference`,l,'Take `&mut` instead of `&`.');return;}needMut(p,nm,l,'borrow');};
    const len=v=>v.t==='str'||v.t==='String'?new TextEncoder().encode(text(v)).length:(items(v)||[]).length;
    switch(m){
      case'len':return I(len(rv),'usize');case'is_empty':return{t:'b',v:len(rv)===0};case'capacity':return I(rv.t==='Vec'||rv.t==='String'?H(rv.h).cap:len(rv),'usize');
      case'push':if(rv.t==='Vec'){need();const x=eval_(e.args[0],true),mvd=S.lastMove;S.lastMove=null;const o=H(rv.h);if(!rv.et)rv.et=tyOf(x);else coerce(x,rv.et);o.es=esz(rv.et);if(o.items.length===o.cap)grow(o,o.items.length+1,nm);o.items.push(x);if(mvd&&e.args[0].k==='var'){mvd.mvTo=`${nm} (element)`;ev('move',{from:e.args[0].name,to:`${nm}[${o.items.length-1}]`,size:sizeOf(x)});}ev('push',{name:nm,val:disp(x),len:o.items.length,cap:o.cap,es:o.es});return U;}
        if(rv.t==='String'){need();const c=text(A(0)),o=H(rv.h),n2=new TextEncoder().encode(o.s+c).length;if(n2>o.cap)grow(o,n2,nm);o.s+=c;ev('pushstr',{name:nm,add:c,len:n2,cap:o.cap});return U;}break;
      case'push_str':if(rv.t==='String'){need();const t=text(A(0)),o=H(rv.h),n2=new TextEncoder().encode(o.s+t).length;if(n2>o.cap)grow(o,n2,nm);o.s+=t;ev('pushstr',{name:nm,add:t,len:n2,cap:o.cap});return U;}break;
      case'clone':if(rv.t==='Vec'){const o=H(rv.h),it=o.items.map(x=>x.t==='String'?{t:'String',h:halloc('string',new TextEncoder().encode(H(x.h).s).length,1,H(x.h).s,'clone')}:copy(x));ev('clone',{name:nm,bytes:it.length*o.es});return{t:'Vec',h:halloc('vec',it.length,o.es,it,`${nm}.clone()`),et:rv.et};}
        if(rv.t==='String'){const s=H(rv.h).s,b=new TextEncoder().encode(s).length;ev('clone',{name:nm,bytes:b});return{t:'String',h:halloc('string',b,1,s,`${nm}.clone()`)};}return copy(rv);
      case'to_string':case'to_owned':case'to_uppercase':case'to_lowercase':{let s=rv.t==='i'||rv.t==='f'||rv.t==='b'?show(rv):text(rv);if(m==='to_uppercase')s=s.toUpperCase();if(m==='to_lowercase')s=s.toLowerCase();const b=new TextEncoder().encode(s).length;return{t:'String',h:halloc('string',b,1,s,`${m}()`)};}
      case'as_str':if(rv.t==='String'&&pl)return{t:'ref',mut:false,to:{fi:pl.fi,si:pl.si},asStr:true};break;
      case'iter':if(pl){let p=pl;const s=S.fr[p.fi].slots[p.si];if(s.v.t==='ref'&&p.idx==null)return{...s.v,iter:true};return{t:'ref',mut:false,to:{fi:p.fi,si:p.si,idx:p.idx},iter:true};}break;
      case'chars':return{t:'chars',s:text(rv)};
      case'sum':if(recv.t==='ref'){const c=items(dz(recv))||[];let acc=0,ty='i32';c.forEach(x=>{acc+=dz(x).v;ty=dz(x).ty||ty;});ev('sum',{n:c.length});return{t:'i',v:acc,ty,inf:false};}break;
      case'contains':{const x=dz(A(0));if(rv.t==='Vec'||rv.t==='arr')return{t:'b',v:(items(rv)).some(y=>disp(dz(y))===disp(x))};return{t:'b',v:text(rv).includes(text(x))};}
      case'abs':return{...rv,v:Math.abs(rv.v)};case'pow':{const r=rv.v**dz(A(0)).v;ovf(r,rv.ty,'multiply',l);return{...rv,v:r};}
      case'min':case'max':{const x=dz(A(0));return Math[m](rv.v,x.v)===rv.v?rv:x;}case'sqrt':return{t:'f',v:Math.sqrt(rv.v)};}
    comp('E0599',`method \`${m}\` is not in the browser visualizer's subset yet (on \`${tyOf(rv)}\`)`,l);}
  function mac(e){const n=e.name,l=e.line;
    if(n==='println'||n==='print'||n==='eprintln'||n==='eprint'){const r=fmt(e.args,l),s=r.s+(n.endsWith('ln')?'\n':'');if(n[0]==='e')S.err+=s;else S.out+=s;S.cnt.writes++;ev('print',{bytes:new TextEncoder().encode(s).length,err:n[0]==='e',nl:n.endsWith('ln'),text:s});return U;}
    if(n==='format'){const r=fmt(e.args,l),pl=r.pieces.reduce((a,p)=>a+new TextEncoder().encode(p).length,0),cap0=!r.nargs?pl:(r.pieces[0]===''&&pl<16?0:pl*2),id=halloc('string',cap0,1,'','format!'),o=H(id);for(const sg of r.segs){if(!sg)continue;const need=new TextEncoder().encode(o.s+sg).length;if(need>o.cap)grow(o,need,'format!');o.s+=sg;}ev('format',{est:cap0,len:new TextEncoder().encode(o.s).length,cap:o.cap});return{t:'String',h:id};}
    if(n==='panic'){panic(e.args.length?fmt(e.args,l).s:'explicit panic',l);}
    if(n==='assert'){const c=dz(eval_(e.args[0],false));if(!c.v)panic(e.args[1]?fmt(e.args.slice(1),l).s:'assertion failed',l);ev('assert',{ok:true});return U;}
    if(n==='assert_eq'||n==='assert_ne'){const a=eval_(e.args[0],false),b=eval_(e.args[1],false),eq=cmp('==',a,b).v;if(eq!==(n==='assert_eq'))panic(`assertion \`left ${n==='assert_eq'?'==':'!='} right\` failed\n  left: ${disp(dz(a))}\n right: ${disp(dz(b))}`,l);ev('assert',{ok:true});return U;}
    if(n==='dbg'){const v=eval_(e.args[0],true);S.err+=`[src/main.rs:${l}] = ${disp(dz(v))}\n`;S.cnt.writes++;return v;}
    comp('E0433',`macro \`${n}!\` is not in the browser subset yet`,l);}
  function block(b,isFn){const f=fr(),start=f.slots.length;let v=U;try{for(const s of b.stmts)exec(s);if(b.tail){line0.v=b.tail.line;const t=b.tail;S.lastMove=null;v=eval_(t,true);if(!isFn&&t.k!=='if'&&t.k!=='block'){}}}
    finally{const dropped=[];for(let i=f.slots.length-1;i>=start;i--){const s=f.slots[i];if(s.dead)continue;if(s.st!=='moved'&&s.name!=='(temp)')drop(s.v,s.name);if(!isFn){s.dead=true;dropped.push(s.name);}}if(dropped.length&&!isFn&&S.ev.some(x=>x.k==='free'))ev('scope',{names:dropped});}
    return v;}
  function exec(s){line0.v=s.line;S.lastMove=null;switch(s.k){
    case'let':{let v=s.init?eval_(s.init,true):null;const mvd=S.lastMove;S.lastMove=null;if(v&&s.ty)coerce(v,s.ty);const hn=(HN[fr().fn]||{})[s.name];if(v&&!s.ty&&hn){if(hn.t&&v.t==='i'&&v.inf)coerce(v,hn.t);if(hn.el&&v.t==='arr')coerce(v,`[${hn.el}; ${v.items.length}]`);if(hn.el&&v.t==='Vec')coerce(v,`Vec<${hn.el}>`);}if(v&&v.t==='i'&&v.inf&&!s.ty){}const sl=newSlot(s.name,v||U,s.ty,s.mut,s.line);if(!v)sl.v=null;
      if(mvd&&s.init.k==='var'){mvd.mvTo=s.name;ev('move',{from:s.init.name,to:s.name,size:sl.size,what:tyOf(v)});}
      else if(v&&v.t==='ref')ev('borrow',{name:S.fr[v.to.fi].slots[v.to.si].name+(v.to.idx!=null?`[${v.to.idx}]`:''),as:s.name,mut:v.mut,size:sl.size,fat:sl.size===16});
      ev('bind',{name:s.name,ty:s.ty||tyOf(v||U),val:v?disp(v):'(uninitialised)',size:sl.size,addr:sl.addr,kind:v?v.t:'u',ro:v&&v.t==='str'?S.ro[v.id]:null});snap(s.line);return;}
    case'expr':{if(s.e.k==='if'){ifStmt(s.e);return;}if(s.e.k==='block'){block(s.e);return;}eval_(s.e,s.e.k==='call'||s.e.k==='mac'||s.e.k==='mcall');snap(s.line);return;}
    case'while':{let n=0;for(;;){const c=dz(eval_(s.cond,false));ev('cond',{kind:'while',v:c.v,n:++n});snap(s.line);if(!c.v)break;try{block(s.body);}catch(x){if(x.brk)break;if(x.cont)continue;throw x;}}return;}
    case'loop':{let n=0;for(;;){ev('cond',{kind:'loop',n:++n});snap(s.line);try{block(s.body);}catch(x){if(x.brk)break;if(x.cont)continue;throw x;}}return;}
    case'for':{let it=eval_(s.it,true);const mvd=S.lastMove;S.lastMove=null;let seq,kind,src='';
      if(it.t==='range'){const a=it.a.v,b=it.b.v+(it.incl?1:0);seq=[];for(let i=a;i<b;i++)seq.push({t:'i',v:i,ty:it.a.ty,inf:it.a.inf&&it.b.inf});kind='range';}
      else if(it.t==='ref'){const s0=S.fr[it.to.fi].slots[it.to.si],c=items(dz(s0.v));if(!c)comp('E0277',`\`${tyOf(it)}\` is not an iterator`,s.line);seq=c.map((_,i)=>({t:'ref',mut:it.mut,to:{fi:it.to.fi,si:it.to.si,idx:i}}));kind='slice';src=s0.name;}
      else if(it.t==='Vec'||it.t==='arr'){seq=items(it).slice();kind=it.t==='Vec'?'vec':'arr';src=mvd?mvd.name:'';if(mvd)mvd.mvTo='the loop';}
      else if(it.t==='chars'){seq=[...it.s].map(c=>({t:'c',v:c}));kind='chars';}else comp('E0277',`\`${tyOf(it)}\` is not an iterator`,s.line);
      if(kind==='vec')ev('consume',{name:src,n:seq.length});
      for(let i=0;i<seq.length;i++){const f=fr(),start=f.slots.length;const x=seq[i];if(s.name!=='_')newSlot(s.name,x,null,false,s.line);ev('iter',{name:s.name,val:disp(x),kind,i,n:seq.length,src,es:kind==='slice'?esz((dz(S.fr[it.to.fi].slots[it.to.si].v)).et):0});snap(s.line);
        let br=false;try{block(s.body);}catch(x2){if(x2.brk)br=true;else if(!x2.cont)throw x2;}finally{for(let j=f.slots.length-1;j>=start;j--){const sl=f.slots[j];if(!sl.dead&&sl.st!=='moved'&&kind==='vec')drop(sl.v,sl.name);sl.dead=true;}}if(br){if(kind==='vec')seq.slice(i+1).forEach(y=>drop(y,'(rest)'));break;}}
      if(kind==='vec'&&it.t==='Vec'){const o=H(it.h);if(o.cap){S.cnt.frees++;S.cnt.live-=o.cap*o.es;ev('free',{name:src||'vec',bytes:o.cap*o.es,addr:o.addr,loop:1});}o.freed=true;o.freedAt=S.steps.length;}
      ev('cond',{kind:'for-end'});snap(s.line);return;}
    case'ret':{const v=s.e?eval_(s.e,true):U;const e=new Error('ret');e.ret=1;e.v=v;e.line=s.line;throw e;}
    case'brk':{const e=new Error('brk');e.brk=1;throw e;}case'cont':{const e=new Error('cont');e.cont=1;throw e;}}}
  function ifStmt(e){const c=dz(eval_(e.c,false));if(c.t!=='b')comp('E0308',`expected \`bool\`, found \`${tyOf(c)}\``,e.line);ev('cond',{kind:'if',v:c.v});snap(e.line);if(c.v)block(e.th);else if(e.el){if(e.el.k==='if')ifStmt(e.el);else block(e.el);}}
  S.fr.push({fn:'main',slots:[],scopes:[0],sp:S.sp,base:S.sp,callLine:ast.fns.main.line});S.cnt.maxDepth=1;ev('start',{});snap(ast.fns.main.line);let end=null;
  try{block(ast.fns.main.body,true);ev('exit',{code:0});snap(ast.fns.main.body.end);fr().slots.forEach(s=>s.dead=true);end={ok:true};}
  catch(x){if(x.panic){const fl=S.fr.map(f=>f.fn).reverse();S.err+=x.so?`\nthread 'main' has overflowed its stack\nfatal runtime error: stack overflow\n`:`thread 'main' panicked at src/main.rs:${x.vline}:\n${x.message}\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n`;
      {const pe={k:'panic',msg:x.message,so:x.so,frames:fl},ix=S.ev.findIndex(e=>e.k==='free'||e.k==='dropnoop');if(ix<0)S.ev.push(pe);else{S.ev.slice(ix).forEach(e=>{if(e.k==='free')e.unw=1;});S.ev.splice(ix,0,pe);}}if(!x.so){for(let k=S.fr.length-1;k>=0;k--){const f=S.fr[k];for(let i=f.slots.length-1;i>=0;i--){const s=f.slots[i];if(!s.dead&&s.st!=='moved')drop(s.v,s.name);}}ev('unwind',{});}snap(x.vline||0);end={panic:x.message,line:x.vline};}
    else if(x.comp){end={comp:x.comp,msg:x.message,line:x.vline,hint:x.hint};ev('comp',{code:x.comp,msg:x.message,hint:x.hint});snap(x.vline||0);}else if(x.limit){end={limit:true};}else throw x;}
  return{steps:S.steps,end,out:S.out,err:S.err};}

/* ───── narration: what each event means, at three depths ───── */
const VZSEEN=new Set();
function vzTell(e,depth){const C=s=>`<code>${esc(String(s))}</code>`,B=n=>n>=1024?(n/1024).toFixed(1)+' KiB':n+' B',o={};
  switch(e.k){
   case'start':o.t='The process starts: the runtime sets up the main thread and calls <code>main</code>. Its stack frame is the first one.';o.m='Before main, the Rust runtime (<code>std::rt::lang_start</code>) installs a stack-overflow guard page and the panic handler.';o.i=['start','Every <b>stack frame</b> holds the local variables of one call. Heap memory is separate and is only used when something asks for it (a Vec, a String, a Box).'];break;
   case'bind':o.t=`${C(e.name)} ${e.val==='(uninitialised)'?'is declared, not yet initialised':`= ${C(e.val)}`} — a ${C(e.ty)} taking ${e.size} bytes on the stack.`;
     if(e.kind==='str'&&e.ro)o.i=['str',`A string literal is baked into the program's <b>read-only data</b> (rodata). The variable only holds a 16-byte fat pointer: the address ${C(hex(e.ro.addr))} and the length. No heap involved.`];
     if(e.kind==='arr')o.i=['arr',`An array lives <b>inline on the stack</b>: all ${e.size} bytes sit in the frame, no heap allocation. Its size is part of its type.`];
     if(e.kind==='i')o.i=['int',`Integers are <b>Copy</b>: assigning or passing one copies the bits. ${e.ty==='i32'?'Without an annotation, Rust defaults integer literals to <code>i32</code> unless usage forces another type.':''}`];
     o.m=`Stored at ${C(hex(e.addr))}, ${e.size} bytes below the previous slot. The compiler fixes these offsets at compile time; nothing is “allocated” at run time for stack slots.`;break;
   case'alloc':o.t=`Allocated ${B(e.bytes)} on the heap at ${C(hex(e.addr))} — ${e.what}, capacity ${e.cap}.`;o.m=`A call to the global allocator (<code>__rust_alloc</code> → malloc in a typical Linux build). The stack keeps only the 24-byte header: pointer, capacity, length.`;o.i=['alloc',`<b>Heap allocation</b> costs a call into the allocator and is freed deterministically when the owner goes out of scope — Rust has no garbage collector.`];break;
   case'noalloc':o.t=`${C(e.label)} creates an empty ${e.what} <b>without allocating</b>: capacity 0, a dangling (but non-null) placeholder pointer.`;o.i=['noalloc','<code>Vec::new()</code> and <code>String::new()</code> are free. The first push pays for the allocation.'];break;
   case'grow':o.t=`${C(e.name)} was full (len = cap = ${e.old}). It grew to capacity <b>${e.nc}</b>: new buffer at ${C(hex(e.to))}, ${B(e.copied)} copied, old buffer freed.`;o.m=`<code>RawVec::grow_amortized</code>: new capacity = max(2 × old, needed, minimum ${e.es===1?8:4}). One <code>realloc</code> — sometimes in place, often a copy.`;o.i=['grow','Doubling makes pushes <b>amortised O(1)</b>, but each growth copies everything. If you know the final size, <code>Vec::with_capacity(n)</code> allocates once.'];break;
   case'free':o.t=e.unw?`Unwinding drops ${C(e.name)}: frees ${B(e.bytes)} at ${C(hex(e.addr))}.`:e.loop?`The loop consumed ${C(e.name)}; its buffer (${B(e.bytes)}) is freed when the iterator is dropped.`:`${C(e.name)} goes out of scope: <b>drop</b> frees ${B(e.bytes)} at ${C(hex(e.addr))}.`;o.m='<code>Drop::drop</code> runs, then <code>__rust_dealloc</code>. The point of the free is decided at compile time — the closing brace.';o.i=['free','<b>Drop</b> happens at the end of the owner\'s scope, in reverse declaration order. No GC pause, no leak — unless something was moved out first.'];break;
   case'dropnoop':o.t=`${C(e.name)} goes out of scope — nothing to free (it never allocated).`;break;
   case'move':o.t=`<b>Move</b>: ${C(e.from)} → ${C(e.to)}. Only the ${e.size}-byte header is copied; the heap data stays put. ${C(e.from)} can no longer be used.`;o.m='A move is a plain memcpy of the stack value; the compiler then forbids using the source. Often optimised away entirely.';o.i=['move','<b>Ownership</b>: one owner at a time. Moving transfers the duty to free the memory, so it is freed exactly once.'];break;
   case'copyarr':o.t=`The array is Copy: all ${B(e.bytes)} of ${C(e.from)} are copied.`;o.i=['copyarr','Copying big arrays is real work. Pass <code>&arr</code> (a slice) to avoid it.'];break;
   case'borrow':o.t=`${C(e.as)} borrows ${C(e.name)}${e.mut?' <b>mutably</b>':''} — ${e.fat?'a 16-byte <b>fat pointer</b> (address + length)':'an 8-byte pointer'}. No data copied.`;o.m=e.fat?'A slice reference carries its length with it; that is what makes bounds-checked indexing possible without knowing the array type.':'A reference is just an address; the borrow checker proved at compile time that the target outlives it.';o.i=['borrow',`<b>Borrowing</b> lets code read${e.mut?' or change':''} a value without taking ownership. ${e.mut?'While a <code>&mut</code> borrow is alive nobody else may touch the value.':'Many shared borrows may coexist; none may mutate.'}`];break;
   case'call':o.t=`Call ${C(e.fn+'('+e.args.map(a=>a.name).join(', ')+')')}: a new stack frame is pushed (depth ${e.depth}).`;o.m=`Arguments, typically (x86-64): ${e.args.map(a=>`${C(a.name)} → ${a.mem?'memory, by pointer':a.regs.join(' + ')||'—'}`).join(', ')||'none'}. The <code>call</code> instruction pushes the return address; the callee moves <code>rsp</code> down to make room for its locals. (The Rust ABI is unspecified; this is what rustc usually emits.)`;o.i=['call','A function call costs a frame on the stack. Small functions are often <b>inlined</b> by the optimiser and the frame disappears in release builds.'];break;
   case'ret':o.t=`${C(e.fn)} returns ${C(e.val)} to ${C(e.to)}; its frame is popped.`;o.m=e.reg?`The value travels back in ${C(e.reg)}; <code>ret</code> pops the return address and jumps back.`:'Nothing to return (unit).';break;
   case'bounds':o.t=`Bounds check on ${C(e.name+'['+e.i+']')}: ${e.i} < ${e.len} ${e.ok?'✓':'✗'}`;o.m='A compare and a branch before every indexed access. The optimiser removes it when it can prove the index is in range.';o.i=['bounds','<b>Indexing is checked</b>: an out-of-range index panics instead of reading someone else\'s memory. Iterating (<code>for x in &v</code>) needs no checks at all.'];break;
   case'ovf':o.t=`Overflow check on ${C(e.op)} for ${C(e.ty)}.`;o.m='Debug builds check every arithmetic operation and panic on overflow; release builds wrap silently unless <code>overflow-checks = true</code>.';break;
   case'set':o.t=`${C(e.name)} = ${C(e.val)}${e.via?' (written through a reference)':''}`;break;
   case'iter':o.t=e.kind==='slice'?`Next element of ${C(e.src)}: ${C(e.name)} = ${C(e.val)} (item ${e.i+1} of ${e.n}).`:e.kind==='range'?`Range: ${C(e.name)} = ${C(e.val)} (${e.i+1} of ${e.n}).`:`Next value: ${C(e.name)} = ${C(e.val)} (${e.i+1} of ${e.n}).`;
     o.m=e.kind==='slice'?`The slice iterator is two pointers (current, end). Each step: compare, load ${e.es} bytes, advance by ${e.es}. ${C(e.name)} is a reference into the original memory.`:e.kind==='range'?'A counter compared with the end value; usually kept in a register.':e.kind==='vec'?'Elements are moved out of the Vec\'s buffer one by one.':'Decodes the next UTF-8 code point from the bytes.';
     o.i=e.kind==='slice'?['iterslice',`Iterating a slice yields <b>references</b> — ${C(e.name)} points into ${C(e.src)}, nothing is copied — and needs <b>no bounds checks</b>.`]:e.kind==='vec'?['itervec','<code>for x in v</code> <b>consumes</b> the Vec: it is moved into the loop and freed at the end. Use <code>&v</code> to keep it.']:null;break;
   case'consume':o.t=`${C(e.name)} is moved into the loop (into_iter). It cannot be used after the loop.`;break;
   case'cond':o.t=e.kind==='if'?`Condition is ${C(e.v)} → ${e.v?'take the if branch':'skip it'}.`:e.kind==='while'?`Loop condition is ${C(e.v)}${e.v?' → run the body':' → leave the loop'} (check #${e.n}).`:e.kind==='for-end'?'The iterator is exhausted: the loop ends.':`loop iteration ${e.n}.`;o.m=e.kind==='for-end'?null:'A compare and a conditional jump. The CPU predicts the branch; a loop that keeps going is predicted correctly almost every time.';break;
   case'push':o.t=`Pushed ${C(e.val)} into ${C(e.name)}: len ${e.len}, capacity ${e.cap}.`;o.m=`Writes ${e.es} bytes at buffer + ${(e.len-1)*e.es}, then increments len.`;break;
   case'pushstr':o.t=`Appended ${C(JSON.stringify(e.add))} to ${C(e.name)}: ${e.len} bytes used of ${e.cap}.`;o.i=['utf8','A <code>String</code> is a Vec of <b>UTF-8 bytes</b>: <code>len()</code> counts bytes, not characters.'];break;
   case'clone':o.t=`${C(e.name+'.clone()')} copies ${B(e.bytes)} into a new heap buffer.`;o.i=['clone','<b>clone()</b> is a deep copy — real allocation and copying. Borrow (<code>&</code>) when you only need to read.'];break;
   case'format':o.t=`format! pre-sized its buffer to ${e.est} bytes (a guess from the literal pieces), wrote ${e.len} bytes, capacity ${e.cap}.`;break;
   case'print':o.t=`${e.err?'Writes':'Prints'} ${e.bytes} bytes to ${e.err?'stderr':'stdout'}.`;o.m=e.err?'stderr is unbuffered: one <code>write(2, …)</code> system call.':`stdout is line-buffered: the formatted text goes into a buffer${e.nl?'; the newline flushes it with one <code>write(1, …)</code> system call':' and waits for a newline or exit'}.`;o.i=['print','Printing goes through the kernel (a <b>system call</b>), which is thousands of times slower than arithmetic. Printing inside hot loops dominates run time.'];break;
   case'cast':o.t=`${C(e.v)} as ${C(e.to)} → ${C(e.r)}${e.wrapped?` <b>(${e.sat?'saturated':'wrapped'})</b>`:''}.`;if(e.wrapped)o.i=['cast','<code>as</code> never panics: integer casts <b>truncate the bits</b>, float→int casts saturate. Use <code>try_from</code> when out-of-range values are a bug.'];break;
   case'sum':o.t=`Sum over ${e.n} elements.`;break;
   case'scope':o.t=`End of block: ${e.names.map(C).join(', ')} dropped.`;break;
   case'panic':o.t=e.so?'<b>Stack overflow.</b> Each recursive call added a frame until the guard page was hit.':`<b>Panic:</b> ${esc(e.msg)}`;o.m=e.so?'The OS maps an unreadable guard page below the stack; touching it raises SIGSEGV, which Rust reports as a stack overflow and aborts.':'The panic handler prints the message, then <b>unwinds</b>: every frame is popped and every owned value is dropped, so memory is still freed.';o.i=e.so?['so','Recursion depth is limited by the stack (8 MiB for the main thread on Linux by default). Iterate, or move data to the heap.']:['panic','A panic is Rust refusing to continue with a broken invariant — not undefined behaviour. In C the same bug could silently read past the buffer.'];break;
   case'unwind':o.t='Unwinding: remaining owned values were dropped on the way out.';break;
   case'comp':o.t=`<b>rustc rejects this program:</b> error[${e.code}]: ${esc(e.msg)}${e.hint?`<br>${e.hint}`:''}`;o.i=['comp','This error is caught at <b>compile time</b>: the program never runs. The visualizer shows where it would have gone wrong.'];break;
   case'exit':o.t='main returns: remaining values are dropped and the process exits with code 0.';o.m='<code>exit_group(0)</code>: the kernel reclaims the stack and any heap left (there is none here unless something leaked).';break;
   case'assert':return null;}
  if(o.i&&VZSEEN.has(o.i[0]))o.i=null;else if(o.i)VZSEEN.add(o.i[0]);o.k=e.k;return o;}

/* ───── the overlay ───── */
const VZS={sum:['Slices and the stack',`fn sum_list(numbers: &[i64]) -> i64 {
    let mut total = 0;
    for n in numbers {
        total = total + n;
    }
    total
}

fn main() {
    let values = [4, 8, 15, 16, 23];
    let result = sum_list(&values);
    println!("sum = {}", result);
}
`],grow:['How a Vec grows',`fn main() {
    let mut v = Vec::new();
    for i in 0..6 {
        v.push(i * 10);
    }
    let mut w = Vec::with_capacity(6);
    for i in 0..6 {
        w.push(i * 10);
    }
    println!("v cap = {}, w cap = {}", v.capacity(), w.capacity());
}
`],own:['Ownership: move, borrow, clone, drop',`fn shout(s: String) -> String {
    let mut loud = s;
    loud.push_str("!");
    loud
}

fn count(s: &String) -> usize {
    s.len()
}

fn main() {
    let a = String::from("hello");
    let n = count(&a);
    let b = a.clone();
    let c = shout(a);
    println!("{} {} {}", n, b, c);
}
`],rec:['Recursion and stack frames',`fn factorial(n: u64) -> u64 {
    if n == 0 {
        return 1;
    }
    n * factorial(n - 1)
}

fn main() {
    let r = factorial(5);
    println!("5! = {}", r);
}
`],bounds:['Bounds checks and panics',`fn main() {
    let v = vec![1, 2, 3];
    let mut i = 0;
    while i <= v.len() {
        println!("{}", v[i]);
        i += 1;
    }
}
`],ovf:['Integer overflow',`fn main() {
    let mut level: u8 = 250;
    let wrapped = 300 as u8;
    println!("300 as u8 = {}", wrapped);
    for _ in 0..10 {
        level += 1;
    }
    println!("{}", level);
}
`],str:['Strings: rodata, heap and UTF-8',`fn main() {
    let greeting = "olá";
    let mut name = String::new();
    name.push_str("Ana");
    let msg = format!("{}, {}!", greeting, name);
    println!("{}", msg);
    println!("{:?} is {} bytes", greeting, greeting.len());
}
`],moved:['A use after move (compile error)',`fn consume(v: Vec<i32>) -> usize {
    v.len()
}

fn main() {
    let data = vec![1, 2, 3];
    let n = consume(data);
    println!("{} {}", n, data.len());
}
`]};
let VZ=null;
function vizOpen(src,title,origin){let o=$('#viz');if(!o){document.body.insertAdjacentHTML('beforeend','<div id="viz"></div>');o=$('#viz');}VZSEEN.clear();clearInterval((VZ||{}).timer);
  /* window-backed: VZ é o único estado reatribuído (aqui); os onclick da barra correm
     no scope global e lêem `VZ` → window.VZ. Atribuição em cadeia mantém o MESMO objecto
     em ambos, por isso mutações (.i/.pending/.timer, via onclick OU via funções do módulo)
     propagam. Corrige o desync pré-existente que partia os botões Step/depth/re-run/predict. */
  VZ=window.VZ={src,title,origin:origin||null,i:0,timer:null,speed:LS.get('vzspeed',5),depth:LS.get('vzdepth','memory'),predict:LS.get('vzpred',false),guess:null,ans:null,res:null,err:null,notes:{}};
  try{VZ.res=vzRun(src);}catch(x){if(x.vz||x.vline){VZ.err=x;}else{VZ.err={message:'Internal error in the visualizer: '+x.message,vline:0};console.error(x);}}
  if(VZ.res){VZ.notes={};VZ.res.steps.forEach((s,k)=>{VZ.notes[k]=s.ev.map(e=>vzTell(e,'machine')).filter(Boolean);});}
  o.classList.add('show');vzRender();}
function vizClose(){const o=$('#viz');if(o)o.classList.remove('show');if(VZ)clearInterval(VZ.timer);}
function vizFromEditor(){const t=tabOf(cur);let p=t&&t.path&&FS[t.path]?t.path:null;if(t&&t.kind==='lt')p=t.path;
  if(p&&/\.go$/.test(p)){toast('Go programs are traced by the desktop app; the browser model covers Rust');vizOpen(VZS.sum[1],VZS.sum[0]);return;}
  if(p&&/\.rs$/.test(p)&&/fn\s+main\s*\(/.test(FS[p].content)){vizOpen(FS[p].content,short(p),p);return;}
  if(p&&/\.rs$/.test(p))toast('This file has no fn main — opening an example');vizOpen(VZS.sum[1],VZS.sum[0]);}
function vzGo(i){if(!VZ||!VZ.res)return;const n=VZ.res.steps.length;i=Math.max(0,Math.min(n-1,i));if(VZ.predict&&i===VZ.i+1&&!VZ.pending){const q=vzQuestion(i);if(q){VZ.pending={i,q};VZ.ans=null;vzRender();return;}}VZ.pending=null;VZ.i=i;vzRender();}
function vzQuestion(i){const e=VZ.res.steps[i].ev.find(x=>x.k==='set'||(x.k==='bind'&&/^-?\d+(\.\d+)?$/.test(x.val))||(x.k==='push')||x.k==='grow');if(!e)return null;
  if(e.k==='grow')return{q:`The next push needs room. What will the new capacity of \`${e.name}\` be?`,a:String(e.nc)};if(e.k==='push')return{q:`After this push, what is the capacity of \`${e.name}\`?`,a:String(e.cap)};
  if(!/^-?\d+(\.\d+)?$/.test(e.val))return null;return{q:`What will \`${e.name}\` be after line ${VZ.res.steps[i].line}?`,a:e.val};}
function vzAnswer(){const v=($('#vz-guess')||{}).value;if(v==null||v==='')return;const p=VZ.pending,ok=v.trim()===p.q.a;VZ.ans={ok,v,a:p.q.a};VZ.score=VZ.score||{ok:0,n:0};VZ.score.n++;if(ok)VZ.score.ok++;VZ.i=p.i;VZ.pending=null;vzRender();}
function vzPlay(){if(!VZ)return;if(VZ.timer){clearInterval(VZ.timer);VZ.timer=null;vzRender();return;}if(VZ.predict){VZ.predict=false;LS.set('vzpred',false);}if(VZ.i>=VZ.res.steps.length-1)VZ.i=0;VZ.timer=setInterval(()=>{if(!VZ||VZ.i>=VZ.res.steps.length-1){clearInterval(VZ.timer);VZ.timer=null;vzRender();return;}VZ.i++;vzRender();},1300-VZ.speed*115);vzRender();}
async function vzAsk(){const st=VZ.res.steps[VZ.i],box=$('#vz-askout');if(!SAMPLE||!PROV.claude.on){box.innerHTML='<p>Live answers need Claude, which is available when this page is opened in claude.ai. The notes above are what the model of Rust knows about this step.</p>';return;}
  const fr=st.frames.map(f=>`${f.fn}: `+f.slots.map(s=>`${s.name}: ${s.ty} = ${s.st==='moved'?'(moved)':s.val}`).join(', ')).join(' | '),notes=(VZ.notes[VZ.i]||[]).map(n=>(n.t||'').replace(/<[^>]+>/g,'')).join(' ');
  box.innerHTML='<span class="spin"></span> thinking…';try{const r=await SAMPLE(`You are a senior Rust engineer teaching. Program:\n${VZ.src}\nCurrent step ${VZ.i+1}, line ${st.line}. Frames: ${fr}. What happened: ${notes}\nExplain what is really happening in memory and on the CPU at this step, and one thing a senior would notice. Be concrete and short (under 120 words). Answer in ${LOCALE==='en'?'English':'Portuguese (Angola)'}.`,{cache:false,modelTier:'quick',onText:({text})=>{box.innerHTML=md(text);}});box.innerHTML=md(r.text);}catch(e){box.innerHTML='<p>Could not get an answer right now.</p>';}}
function vzRender(){const o=$('#viz');if(!o||!VZ)return;const R=VZ.res,n=R?R.steps.length:0,st=R?R.steps[VZ.i]:null,lines=VZ.src.split('\n'),errL=VZ.err?VZ.err.vline:(R&&R.end&&(R.end.comp||R.end.panic)?R.end.line:0);
  const hits={};if(R)for(let k=0;k<=VZ.i;k++){const l=R.steps[k].line;hits[l]=(hits[l]||0)+1;}const hmax=Math.max(1,...Object.values(hits));const prevL=R&&VZ.i>0?R.steps[VZ.i-1].line:0;
  const code=lines.map((l,k)=>{const ln=k+1,curL=st&&st.line===ln;return `<div class="vl${curL?' cur':''}${ln===prevL&&!curL?' prev':''}${errL===ln&&(!R||VZ.i===n-1)?' err':''}" id="vl-${ln}"><span class="va">${curL?'▶':''}</span><span class="vn">${ln}</span><span class="vh" title="${hits[ln]||0} time(s) so far"><i style="width:${(hits[ln]||0)/hmax*100}%"></i></span><span class="vc">${hlLine(l,'rs')||' '}</span></div>`;}).join('');
  const D=VZ.depth;let right='';
  if(VZ.err)right=`<div class="vz-card bad"><h3>Can't visualize this program</h3><p>${esc(VZ.err.message)}${VZ.err.vline?` <span class="vz-ln">line ${VZ.err.vline}</span>`:''}</p><p class="vz-mute">The browser runs a model of a teaching subset of Rust: functions, <code>let</code>, loops, <code>if</code>, integers, floats, <code>bool</code>, <code>char</code>, arrays, <code>Vec</code>, <code>String</code>, <code>&str</code>, references and the common methods. The desktop app traces any program with the real compiler (<code>rust_tracer</code>).</p><p>Try an example from the list above.</p></div>`;
  else{const notes=(VZ.notes[VZ.i]||[]).filter(x=>D==='machine'||x.k!=='ovf'),end=R.end,last=VZ.i===n-1;
    right+=`<div class="vz-card"><div class="vz-h"><span class="vz-ln">step ${VZ.i+1} · line ${st.line}</span><span class="vz-fn">in <b>${esc(st.frames[st.frames.length-1].fn)}</b></span>${st.extra&&st.extra.retFrom?'<span class="tag">return</span>':''}</div>
      ${VZ.pending?`<div class="vz-pred"><b>Predict before you look.</b><p>${esc(VZ.pending.q.q).replace(/`([^`]+)`/g,'<code>$1</code>')}</p><div><input id="vz-guess" class="inp" style="margin:0;width:140px" autocomplete="off"><button class="mini pri" onclick="vzAnswer()">Check</button><button class="mini" onclick="VZ.i=VZ.pending.i;VZ.pending=null;vzRender()">Just show me</button></div></div>`:''}
      ${VZ.ans?`<div class="vz-ans ${VZ.ans.ok?'ok':'no'}">${VZ.ans.ok?`✓ Right — ${esc(VZ.ans.a)}.`:`✗ You said ${esc(VZ.ans.v)}; it is <b>${esc(VZ.ans.a)}</b>. Read the notes below to see why.`}</div>`:''}
      ${VZ.pending?'':notes.length?notes.map(x=>`<div class="vz-n">${x.t||''}${D==='machine'&&x.m?`<div class="vz-m">${svg('layers')}<span>${x.m}</span></div>`:''}</div>`).join(''):'<div class="vz-n vz-mute">No visible change at this step.</div>'}
      ${VZ.pending?'':notes.filter(x=>x.i).map(x=>`<div class="vz-ins">${svg('bulb')}<span>${x.i[1]}</span></div>`).join('')}
      ${last&&end?`<div class="vz-end ${end.ok?'ok':'bad'}">${end.ok?'✓ Program finished normally.':end.limit?'Stopped after 1500 steps.':end.comp?`✖ Does not compile (error[${end.comp}]).`:'✖ The program panicked.'}${VZ.score&&VZ.score.n?` · predictions ${VZ.score.ok}/${VZ.score.n}`:''}</div>`:''}
      <div class="vz-ask"><button class="mini" onclick="vzAsk()">Ask why</button><div id="vz-askout"></div></div></div>`;
    if(D==='basic'){const f=st.frames[st.frames.length-1];right+=`<div class="vz-sec"><div class="vz-t">Variables</div>${f.slots.filter(s=>s.name!=='(temp)').map(s=>`<div class="vz-var${s.st==='moved'?' mv':''}"><b>${esc(s.name)}</b><span class="ty">${esc(s.ty)}</span><span class="v">${s.st==='moved'?`moved → ${esc(s.mvTo||'?')}`:esc(s.val)}</span></div>`).join('')||'<div class="vz-mute">No locals in this frame yet.</div>'}</div><div class="vz-sec"><div class="vz-t">Call stack</div>${st.frames.slice().reverse().map((f,k)=>`<div class="vz-cs${k?'':' on'}"><span>${st.frames.length-1-k}</span>${esc(f.fn)}<small>line ${f.line}</small></div>`).join('')}</div>`;}
    else{const borrowed={};st.frames.forEach(f=>f.slots.forEach(s=>{if(s.ref){const k=s.ref.fi+':'+s.ref.si;(borrowed[k]=borrowed[k]||[]).push({by:s.name,mut:s.ref.mut});}}));
      const slotH=s=>{const b=borrowed[s.fi+':'+s.si];return `<div class="vz-slot${s.st==='moved'?' mv':''}${s.name==='(temp)'?' tmp':''}" id="vs-${s.fi}-${s.si}" ${s.ptr?`data-ptr="${s.ptr}"`:''} ${s.ref?`data-ref="${s.ref.fi}-${s.ref.si}${s.ref.idx!=null?'-'+s.ref.idx:''}" data-mut="${s.ref.mut?1:0}"`:''} ${s.ro!=null?`data-ro="${s.ro}"`:''}>
        <div class="vz-sh"><b>${esc(s.name)}</b>${s.mut?'<span class="tag">mut</span>':''}<span class="ty">${esc(s.ty)}</span>${D==='machine'?`<span class="ad">${hex(s.addr)} · ${s.size} B</span>`:`<span class="ad">${s.size} B</span>`}</div>
        ${s.st==='moved'?`<div class="vz-mvd">moved → ${esc(s.mvTo||'?')} at line ${s.mvAt}</div>`:s.arr?`<div class="vz-cells">${s.arr.map((c,k)=>`<span id="vs-${s.fi}-${s.si}-${k}"><i>${k}</i>${esc(c)}</span>`).join('')}</div>`:s.ptr&&s.hdr?`<div class="vz-hdr"><span><i>ptr</i>${s.hdr.addr?(D==='machine'?hex(s.hdr.addr).slice(-6):'●'):'dangling'}</span><span><i>cap</i>${s.hdr.cap}</span><span><i>len</i>${s.hdr.len}</span></div>`:`<div class="vz-val">${esc(s.val)}</div>`}
        ${b?`<div class="vz-bw">${b.map(x=>`borrowed ${x.mut?'mutably ':''}by <b>${esc(x.by)}</b>`).join(', ')}</div>`:''}</div>`;};
      right+=`<div class="vz-mem" id="vz-mem"><svg id="vz-arrows"></svg><div class="vz-col"><div class="vz-t">Stack <span class="vz-mute">grows ↓</span></div>${st.frames.map((f,k)=>`<div class="vz-frame${k===st.frames.length-1?' on':''}"><div class="vz-fh"><b>${esc(f.fn)}</b><span>line ${f.line}</span>${D==='machine'?`<span class="ad">rsp ${hex(f.sp)}</span>`:''}</div>${D==='machine'&&k?'<div class="vz-slot ra"><div class="vz-sh"><b>return address</b><span class="ad">8 B</span></div><div class="vz-val vz-mute">back into '+esc(st.frames[k-1].fn)+' after line '+st.frames[k-1].line+'</div></div>':''}${f.slots.map(slotH).join('')||'<div class="vz-mute" style="padding:6px 8px">No locals yet.</div>'}</div>`).join('')}</div>
        <div class="vz-col"><div class="vz-t">Heap</div>${st.heap.length?st.heap.map(h=>`<div class="vz-blk${h.freed?' freed':''}" id="vh-${h.id}"><div class="vz-sh"><b>${h.kind==='vec'?'Vec buffer':'String bytes'}</b><span class="ty">len ${h.len} · cap ${h.cap}</span>${h.cap?`<span class="ad">${D==='machine'?hex(h.addr)+' · ':''}${h.cap*h.es} B</span>`:''}</div>${h.cap?`<div class="vz-cells heap">${Array.from({length:h.cap},(_,k)=>k<h.cells.length?`<span id="vh-${h.id}-${k}"><i>${k}</i>${esc(h.cells[k])}</span>`:'<span class="spare"><i>'+k+'</i>·</span>').join('')}</div>`:'<div class="vz-mute" style="padding:4px 8px">no buffer yet (capacity 0)</div>'}${h.freed?'<div class="vz-mvd">freed</div>':''}</div>`).join(''):'<div class="vz-mute" style="padding:6px 2px">Nothing on the heap.</div>'}
        ${st.ro.length?`<div class="vz-t" style="margin-top:12px">Read-only data</div>${st.ro.map(r=>`<div class="vz-blk ro" id="vr-${r.id}"><div class="vz-sh"><b>${esc(JSON.stringify(r.s))}</b><span class="ad">${D==='machine'?hex(r.addr)+' · ':''}${r.len} B</span></div></div>`).join('')}`:''}</div></div>`;}
    right+=`<div class="vz-sec"><div class="vz-t">Output</div><pre class="vz-out">${esc(st.out)}${st.err?`<span class="e">${esc(st.err)}</span>`:''}</pre></div>`;
    if(D==='machine'){const c=st.cnt;right+=`<div class="vz-sec"><div class="vz-t">Counters so far</div><div class="vz-cnt">${[['calls',c.calls],['max stack depth',c.maxDepth],['heap allocations',c.allocs],['reallocations',c.reallocs],['frees',c.frees],['live heap',c.live+' B'],['peak heap',c.peak+' B'],['bytes copied',c.copied+' B'],['moves',c.moves],['bounds checks',c.bounds],['overflow checks',c.ovf],['write syscalls',c.writes]].map(x=>`<div><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div><p class="vz-mute">Counted by the model as a debug build would do them; the optimiser removes many checks and frames in release.</p></div>`;}}
  const smp=`<select class="mini" onchange="if(this.value==='__ed')vizFromEditor();else if(VZS[this.value])vizOpen(VZS[this.value][1],VZS[this.value][0])">${VZ.origin?`<option value="__ed" selected>${esc(short(VZ.origin))}</option>`:''}${Object.entries(VZS).map(([k,v])=>`<option value="${k}"${!VZ.origin&&VZ.src===v[1]?' selected':''}>${v[0]}</option>`).join('')}</select>`;
  o.innerHTML=`<div class="vz-box"><div class="vz-top">${svg('film')}<b>Visualize execution</b><span class="tag live">STEP BY STEP</span>${smp}<div class="seg vz-depth">${[['basic','Basic'],['memory','Memory'],['machine','Machine']].map(([k,l])=>`<button class="${D===k?'on':''}" onclick="VZ.depth='${k}';LS.set('vzdepth','${k}');vzRender()">${l}</button>`).join('')}</div><label class="vz-pl"><input type="checkbox" ${VZ.predict?'checked':''} onchange="VZ.predict=this.checked;LS.set('vzpred',this.checked)"> Predict mode</label><span class="sp"></span>${VZ.origin?`<button class="mini pri" onclick="vizOpen(FS[VZ.origin].content,VZ.title,VZ.origin)">▶ Re-run</button>`:''}<button class="vz-x" title="Close (Esc)" onclick="vizClose()">×</button></div>
   ${R?`<div class="vz-bar"><button class="mini" onclick="vzGo(VZ.i-1)" title="Step back (←)">◀ Step back</button><button class="mini pri" onclick="vzPlay()" title="Play / pause (Space)">${VZ.timer?'❙❙ Pause':'▶ Play'}</button><button class="mini" onclick="vzGo(VZ.i+1)" title="Step (→)">Step ▶</button><span class="vz-sl">Speed<input type="range" min="1" max="10" value="${VZ.speed}" oninput="VZ.speed=+this.value;LS.set('vzspeed',VZ.speed);if(VZ.timer){clearInterval(VZ.timer);VZ.timer=null;vzPlay();}"></span><span class="vz-pg">${VZ.i+1} / ${n}</span><div class="vz-prog" onclick="const r=this.getBoundingClientRect();vzGo(Math.round((event.clientX-r.left)/r.width*(${n}-1)))"><i style="width:${n>1?VZ.i/(n-1)*100:100}%"></i>${R.steps.map((s,k)=>s.ev.some(e=>['alloc','grow','free'].includes(e.k))?`<b style="left:${n>1?k/(n-1)*100:0}%" class="m"></b>`:s.ev.some(e=>['panic','comp'].includes(e.k))?`<b style="left:${n>1?k/(n-1)*100:0}%" class="x"></b>`:'').join('')}</div></div>`:''}
   <div class="vz-main"><div class="vz-code" id="vz-code">${code}</div><div class="vz-right" id="vz-right">${right}</div></div>
   <div class="vz-foot">${svg('layers')} A model of a debug build, run in your browser: values and control flow are exact for this Rust subset; addresses are illustrative and the machine notes describe typical x86-64 output. The desktop app traces real binaries.</div></div>`;
  const cl=$('#vl-'+(st?st.line:errL));if(cl)cl.scrollIntoView({block:'nearest'});const g=$('#vz-guess');if(g){g.focus();g.onkeydown=e=>{if(e.key==='Enter')vzAnswer();};}requestAnimationFrame(vzArrows);}
function vzArrows(){const m=$('#vz-mem'),sv=$('#vz-arrows');if(!m||!sv)return;const R=m.getBoundingClientRect();sv.setAttribute('width',R.width);sv.setAttribute('height',m.scrollHeight);let out='';const pt=(el,side)=>{const r=el.getBoundingClientRect();return[side==='l'?r.left-R.left:side==='r'?r.right-R.left:r.left-R.left+r.width/2,r.top-R.top+Math.min(r.height/2,16)];};
  m.querySelectorAll('[data-ptr]').forEach(s=>{const h=$('#vh-'+s.dataset.ptr);if(!h)return;const a=pt(s,'r'),b=pt(h,'l');out+=`<path d="M${a[0]-4} ${a[1]} C${a[0]+40} ${a[1]} ${b[0]-40} ${b[1]} ${b[0]-2} ${b[1]}" class="ar heap" marker-end="url(#vzh)"/><circle cx="${a[0]-4}" cy="${a[1]}" r="3" class="dot heap"/>`;});
  m.querySelectorAll('[data-ro]').forEach(s=>{const h=$('#vr-'+s.dataset.ro);if(!h)return;const a=pt(s,'r'),b=pt(h,'l');out+=`<path d="M${a[0]-4} ${a[1]} C${a[0]+40} ${a[1]} ${b[0]-40} ${b[1]} ${b[0]-2} ${b[1]}" class="ar ro" marker-end="url(#vzr)"/><circle cx="${a[0]-4}" cy="${a[1]}" r="3" class="dot ro"/>`;});
  m.querySelectorAll('[data-ref]').forEach(s=>{const[fi,si,idx]=s.dataset.ref.split('-');let t=idx!=null?$(`#vs-${fi}-${si}-${idx}`):null;if(!t&&idx!=null){const ts=$(`#vs-${fi}-${si}`);if(ts&&ts.dataset.ptr)t=$(`#vh-${ts.dataset.ptr}-${idx}`);}if(!t)t=$(`#vs-${fi}-${si}`);if(!t)return;
    const cell=t.tagName==='SPAN',a=pt(s,'l'),mut=s.dataset.mut==='1';let path;if(cell){const r=t.getBoundingClientRect(),bx=r.left-R.left+r.width/2,by=a[1]>r.top-R.top?r.bottom-R.top:r.top-R.top;path=`M${a[0]+2} ${a[1]} C${a[0]-30} ${a[1]} ${bx} ${by+(a[1]>by?40:-40)} ${bx} ${by+(a[1]>by?2:-2)}`;}else{const b=pt(t,'l'),bend=Math.min(60,24+Math.abs(a[1]-b[1])/6);path=`M${a[0]+2} ${a[1]} C${a[0]-bend} ${a[1]} ${b[0]-bend} ${b[1]} ${b[0]-2} ${b[1]}`;}out+=`<path d="${path}" class="ar ref${mut?' mut':''}" marker-end="url(#vz${mut?'m':'f'})"/><circle cx="${a[0]+2}" cy="${a[1]}" r="3" class="dot ref${mut?' mut':''}"/>`;});
  sv.innerHTML=`<defs>${[['vzh','var(--blue)'],['vzr','var(--purple)'],['vzf','var(--accent)'],['vzm','var(--red)']].map(([i,c])=>`<marker id="${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs>${out}`;}
document.addEventListener('keydown',e=>{const o=$('#viz');if(!o||!o.classList.contains('show'))return;if(e.target&&e.target.id==='vz-guess')return;const k=e.key;
  if(k==='Escape'){e.preventDefault();e.stopImmediatePropagation();vizClose();}else if(k==='ArrowRight'){e.preventDefault();e.stopImmediatePropagation();vzGo(VZ.i+1);}else if(k==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();vzGo(VZ.i-1);}else if(k===' '){e.preventDefault();e.stopImmediatePropagation();vzPlay();}},true);
window.addEventListener('resize',()=>{if($('#viz.show'))vzArrows();});
function boot7(){EACT.splice(4,0,['film','Visualize','Ctrl+K V','vizFromEditor()']);
  const cm=MENUS.find(m=>m.t==='Co-Dev');if(cm){const ds=Object.getOwnPropertyDescriptor(cm,'items'),g=()=>ds.get?ds.get.call(cm):ds.value;Object.defineProperty(cm,'items',{configurable:true,get:()=>{const a=g();a.splice(4,0,{l:'Visualize Execution',k:'Ctrl+K V',act:vizFromEditor});return a;}});}
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items.splice(2,0,{l:'Visualize Execution',k:'Ctrl+K V',act:vizFromEditor});$('#menubar').innerHTML='';buildMenubar();
  CMD.push(['Co-Dev: Visualize Execution','Ctrl+K V',vizFromEditor],...Object.entries(VZS).map(([k,v])=>['Visualize: '+v[0],'',()=>vizOpen(v[1],v[0])]));
  const _lt=VIEW.lt;VIEW.lt=(t,host)=>{_lt(t,host);const b=host.querySelector('.lt-bar .mini');if(b&&LTS.lang==='rust')b.insertAdjacentHTML('beforebegin',`<button class="mini" onclick="vizFromEditor()" title="Visualize execution (Ctrl+K V)">${svg('film')} Visualize</button>`);};
  const _hood=VIEW.hood;VIEW.hood=(t,host)=>{_hood(t,host);if(/\.rs$/.test(t.path))host.querySelector('.page h1').insertAdjacentHTML('afterend',`<button class="mini pri" style="margin:4px 0 8px" onclick="${/fn\s+main\s*\(/.test(FS[t.path].content)?'vizFromEditor()':`vizOpen(VZS.sum[1],VZS.sum[0])`}">${svg('film')} Visualize execution step by step</button>`);};
  show(cur);}

/* ── publicação no window: os nomes que boot.ts / handlers inline / app.ts (arranque)
   / i18n consomem. Internos (hex, VZR, VZSEEN, VZSZ) ficam léxicos ao módulo. ── */
publish({
  VZ, VZS, boot7,
  vizClose, vizFromEditor, vizOpen,
  vzAnswer, vzArrows, vzAsk, vzErr, vzGo, vzHints, vzLex, vzParse,
  vzPlay, vzQuestion, vzRender, vzRun, vzTell
});
