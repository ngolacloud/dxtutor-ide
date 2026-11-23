/* ═════════ dxtutor IDE — feature: Learning Track (percurso multi-língua + conteúdo) ═════════
   Inversão de direcção (padrão Studio/SCM/Debug): o motor Learning Track, antes em `app.ts`
   (dados COURSES no topo + motor/vista em baixo), muda-se INTEIRO para cá. @ts-nocheck como
   as outras features-motor. DETÉM: COURSES (conteúdo), estado LTS/ONB/LT_SUB/LT_* , o motor
   (course/ltUnits/dk/ltDone/ltFind/ltPath/ltSeq/ltPts/stars/ltOnboard/ltStart/ltResume/
   ltOpen/openLesson/nextLesson/drillState/ltRes/ltGo/ltAsk) e o corpo da vista (renderLtView).
   CONSUMIDORES por global: features/tutor.ts (pane renderTutorPane lê LTS/course/ltPts/…),
   features/visualizer.ts (decora VIEW.lt + lê LTS), v5.ts (welcome chama ltResume), e em
   app.ts os shims `RP.tutor`(→renderTutorPane, já lá) e `VIEW.lt`(→renderLtView). A secção
   morta «Tutor: percursos» (LEARN/LP/lesson*) fica em app.ts e lê `LF` por window.
   Mecânica: avalia ANTES de app.ts → publica tudo no window no eval (nada lido ansiosamente
   além de LS, já publicado pelo boot). ONB/LT_HOOD window-puros (reatribuídos/escritos por
   onclicks inline); LTS é const mutado em sítio; LT_SUB é local (só a feature o escreve). */

import { $, esc, svg, jsa } from "../core";
import rustCourse from "../content/courses/rust.json";
import goCourse from "../content/courses/go.json";

/* ───── conteúdo dos cursos ───── */
/* Conteúdo dos cursos: dados, não código — vive em src/content/courses/<lang>.json
   (era um literal de 533 KB nesta linha). Para acrescentar uma língua: novo JSON + entrada aqui. */
const COURSES: Record<string, any> = { rust: rustCourse, go: goCourse };

/* ───── estado + motor do Learning Track ───── */
/* LTS window-backed; hidrata de LS PREGUIÇOSAMENTE (como hydrateBps no debug.ts): a
   feature avalia ANTES de app.ts publicar LS → `LS.get()` ansioso no eval = ReferenceError
   que pára o chunk. Default eager-safe; Object.assign(LTS,…) hidrata em sítio (não reatribui,
   por isso o window.LTS que tutor.ts/visualizer aliasam continua a mesma referência). */
interface LTState { lang: string|null; levels: string[]; done: Record<string,number>; open: Record<string,boolean>; show: Record<string,number>; cur: string|null; }
const LTS: LTState = {lang:null,levels:[],done:{},open:{},show:{},cur:null};
let _ltHyd=false;
function hydrateLT(){if(_ltHyd)return;_ltHyd=true;try{const s=LS.get('lt3',null);if(s&&typeof s==='object')Object.assign(LTS,s);}catch(e){}}
const saveLT=()=>LS.set('lt3',LTS);
const LT_LANGS=[{id:'rust',n:'Rust',g:'🦀'},{id:'go',n:'Go',g:'💪'},{id:'python',n:'Python',g:'🐍'},{id:'javascript',n:'JavaScript',g:'⚡'},{id:'c',n:'C',g:'🔧'}];
const LT_LEVELS=[['basic','Basic','Start from the ground up — syntax and first programs.'],['intermediate','Intermediate','Build on the basics with real-world patterns.'],['advanced','Advanced','Deep dives, performance and the tricky corners.']];
const LT_EXT:Record<string,string>={rust:'rs',go:'go'},LT_BADGE:Record<string,string>={concept:'LEARN',drill:'DRILL',challenge:'APPLY'};
let LT_SUB:{ok:boolean;why:string}|null=null;window.ONB={lang:null,levels:[]};window.LT_HOOD=false;
const course=()=>{hydrateLT();return COURSES[LTS.lang!];},ltUnits=()=>{hydrateLT();return course().units.filter((u:any)=>LTS.levels.includes(u.level));},dk=(id:string)=>LTS.lang+':'+id,ltDone=(id:string)=>!!LTS.done[dk(id)];
const ltFind=(id:string|null)=>{for(const u of course().units)for(const s of u.steps)if(s.id===id)return{u,s};return null;};
const ltPath=(s:any)=>LF(`${LTS.lang}/${s.id}.${LT_EXT[LTS.lang!]}`);
const ltSeq=()=>ltUnits().flatMap((u:any)=>u.steps);
const ltPts=()=>ltSeq().reduce((a:number,s:any)=>a+(ltDone(s.id)?s.points:0),0);
function stars(d:number,kind:string){if(kind==='concept'||!d)return'';const n=d<=3?1:d<=7?2:d<=12?3:d<=18?4:5;return `<span class="lt-stars" title="Challenge ${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5-n)}</i></span>`;}
function ltOnboard(step:any){hydrateLT();let o=$('#onb');if(!o){document.body.insertAdjacentHTML('beforeend','<div id="onb"></div>');o=$('#onb')!;o.onclick=e=>{if(e.target===o&&LTS.lang)o!.classList.remove('show');};}
  if(step===1||!step){ONB={lang:LTS.lang,levels:LTS.levels.slice()};o.innerHTML=`<div class="onb-box"><div class="onb-brand">${svg('sparkle')} Delonix Tutor</div><h2>What do you want to learn?</h2><p>Pick a language and we'll guide you through a hands-on track, one step at a time.</p><div class="onb-langs">${LT_LANGS.map(l=>{const c=COURSES[l.id];return `<button class="onb-lang${c?'':' soon'}" ${c?`onclick="ONB.lang=${jsa(l.id)};ltOnboard(2)"`:'disabled'}><span class="g">${l.g}</span><b>${l.n}</b>${c?`<small class="notr">${esc(c.summary.slice(0,58))}…</small>`:''}<span class="tag ${c?'live':''}">${c?'Available':'Coming soon'}</span></button>`;}).join('')}</div></div>`;}
  else o.innerHTML=`<div class="onb-box"><div class="onb-brand">${svg('sparkle')} Delonix Tutor</div><h2>What's your level?</h2><p>Pick one or more. Your track loads only the levels you choose — mix Basic and Intermediate, go straight to Advanced, or take all three. You can change this later from the gear icon.</p>${LT_LEVELS.map(l=>`<button class="onb-lvl${ONB.levels.includes(l[0])?' on':''}" onclick="ONB.levels.includes(${jsa(l[0])})?ONB.levels.splice(ONB.levels.indexOf(${jsa(l[0])}),1):ONB.levels.push(${jsa(l[0])});ltOnboard(2)"><span><b>${l[1]}</b><small>${l[2]}</small></span><i>${ONB.levels.includes(l[0])?'✓':''}</i></button>`).join('')}<div class="onb-foot"><button class="lnk" onclick="ltOnboard(1)">← Back</button><button class="mini pri" ${ONB.levels.length?'':'disabled'} onclick="ltStart()">Start →</button></div></div>`;
  o.classList.add('show');}
function ltStart(){hydrateLT();LTS.lang=ONB.lang;LTS.levels=LT_LEVELS.map(l=>l[0]).filter(l=>ONB.levels.includes(l));LTS.cur=null;saveLT();const o=$('#onb');if(o)o.classList.remove('show');goPane('tutor');ltResume();}
function ltResume(){hydrateLT();if(!LTS.lang){goPane('tutor');ltOnboard(1);return;}const s=ltSeq(),id=LTS.cur&&ltFind(LTS.cur)&&s.some((x:any)=>x.id===LTS.cur)?LTS.cur:(s.find((x:any)=>!ltDone(x.id))||s[0]).id;ltOpen(id);}
function ltOpen(id:string){hydrateLT();const f=ltFind(id);if(!f)return;const{u,s}=f,i=u.steps.indexOf(s);if(i>0&&!ltDone(u.steps[i-1].id)){toast('Finish the previous step to unlock this one');return;}
  LTS.cur=id;LTS.open[u.id]=true;saveLT();LT_HOOD=false;LT_SUB=null;const p=ltPath(s);
  if(!FS[p])FS[p]={content:s.kind==='concept'?`// ${s.title}\n//\n// Read the concept on the right, then press Continue.\n`:s.kind==='challenge'?s.starter.replace(/^\n/,''):'',orig:null};
  const old=tabOf('lt');if(old&&cur==='lt'){Object.assign(old,{title:`${s.id}.${LT_EXT[LTS.lang!]}`,path:p});show('lt');}else openTab({id:'lt',title:`${s.id}.${LT_EXT[LTS.lang!]}`,kind:'lt',path:p});if(PANE==='tutor')RP.tutor();}
function openLesson(){ltResume();}function nextLesson(){return[0,0];}

/* ───── corpo da vista (editor + painel do passo); app.ts mantém o shim VIEW.lt ───── */
function renderLtView(t:any,host:HTMLElement){hydrateLT();const f=ltFind(LTS.cur);if(!f){host.innerHTML='<div class="empty">Open a step from the Learning Track.</div>';return;}const p=t.path;
  host.innerHTML=`<div class="lt"><div class="lt-ed"><div class="lt-bar"><span class="lt-file notr">● ${esc(t.title)}</span><span class="sp"></span><button class="mini" onclick="LT_HOOD=!LT_HOOD;ltRes()">Under the hood</button><button class="mini pri" id="lt-go" onclick="ltGo()"></button></div><div class="lt-scroll"><div class="ed"><div class="ed-gut" id="ed-gut"></div><div class="ed-wrap"><div class="ed-hl" id="ed-hl"></div><textarea id="ed-ta" class="ed-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"></textarea></div></div></div></div><div class="lt-res" id="lt-res"></div></div>`;
  const ta=$('#ed-ta') as HTMLTextAreaElement;ta.value=FS[p].content;paintEd(p);miniOff();ta.oninput=()=>{FS[p].content=ta.value;paintEd(p);miniOff();LT_SUB=null;ltRes();};
  ta.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const ind=LTS.lang==='go'?'\t':'    ';if(!document.execCommand('insertText',false,ind))ta.setRangeText(ind,ta.selectionStart,ta.selectionEnd,'end');(ta.oninput as any)();}};ta.onkeyup=ta.onclick=()=>stPos();ltRes();}
const tgt=(s:any)=>s.target.replace(/^\n/,'').replace(/\n+$/,'').split('\n');
function drillState(s:any){const T=tgt(s),typed=(FS[ltPath(s)]?FS[ltPath(s)].content:'').replace(/\s+$/,'').split('\n'),ok=T.map((l:any,i:number)=>typed[i]!==undefined&&typed[i].trimEnd()===l.trimEnd());return{T,ok,n:ok.filter(Boolean).length,all:ok.every(Boolean)&&typed.length===T.length};}
function ltRes(){hydrateLT();const f=ltFind(LTS.cur),el=$('#lt-res'),go=$('#lt-go');if(!f||!el||!go)return;const{s}=f,done=ltDone(s.id);let h=`<div class="lt-kind"><span>${s.kind==='concept'?'Concept':s.kind==='drill'?'Drill':'Challenge'}</span><b>${done?'✓ ':''}+${s.points} pts</b></div>`;
  if(LT_HOOD)h+=`<div class="lt-card hood"><h3>Under the hood</h3><div class="notr">${mdFull(s.intro)}</div><p class="lt-note">In the desktop app this view also compiles your code and shows measured CPU, memory and I/O. The browser prototype shows the explanation only.</p></div>`;
  if(s.kind==='concept'){h+=`<div class="lt-card notr"><h2>${esc(s.title)}</h2>${mdFull(s.body)}</div>`;go.textContent='Continue →';}
  else if(s.kind==='drill'){const d=drillState(s),hide=s.placeholder_policy!=='shown'&&!LTS.show[dk(s.id)]&&!done;if(d.all&&!done){LTS.done[dk(s.id)]=1;saveLT();if(PANE==='tutor')RP.tutor();}const fin=ltDone(s.id);
    h+=`<div class="lt-card"><h2 class="notr">${esc(s.title)}</h2><div class="notr">${mdFull(s.prompt)}</div><div class="lt-prog"><span class="lp-bar" style="flex:1;margin:0"><i style="width:${d.n/d.T.length*100}%"></i></span><span>${d.n}/${d.T.length} lines</span>${hide?`<button class="mini" onclick="LTS.show[${jsa(dk(s.id))}]=1;saveLT();ltRes()">Show target</button>`:''}</div>
      <div class="lt-target notr">${d.T.map((l:any,i:number)=>{const cur=!d.ok[i]&&d.ok.slice(0,i).every(Boolean);return `<div class="tl${d.ok[i]?' ok':cur?' cur':''}"><span class="n">${d.ok[i]?'✓':i+1}</span><div><code>${hide&&!d.ok[i]?'· · ·':hlLine(l,LT_EXT[LTS.lang!])||'&nbsp;'}</code>${(d.ok[i]||cur)&&s.line_comments&&s.line_comments[i]?`<small>${mdFull(s.line_comments[i]).replace(/^<p>|<\/p>$/g,'')}</small>`:''}</div></div>`;}).join('')}</div></div>`;
    if(fin)h+=`<div class="lt-card ok"><h3>✓ It matches</h3><div class="notr">${mdFull(s.explanation)}</div><p class="lt-note">The desktop app now runs the program and shows its real output.</p></div>`;go.textContent=fin?'Continue →':'Check ▷';}
  else{const tests=[...s.tests.matchAll(LTS.lang==='go'?/func (Test\w+)/g:/fn (\w+)\s*\(\)/g)].map(m=>m[1]);
    h+=`<div class="lt-card"><h2 class="notr">${esc(s.title)}</h2><div class="notr">${mdFull(s.instructions)}</div></div>`;
    if(LT_SUB&&!LT_SUB.ok)h+=`<div class="lt-card bad"><h3>✗ Not yet</h3><p>${LT_SUB.why}</p></div>`;
    if(done){h+=`<div class="lt-card ok"><h3>✓ Submitted</h3>${tests.map(n=>`<div class="chk ok"><span class="g">✓</span><span class="notr">${esc(n)}</span><span class="w">simulated</span></div>`).join('')}<p class="lt-note">Hidden tests decide correctness in the desktop app (<code>${LTS.lang==='go'?'go test':'cargo test'}</code>). The browser cannot compile, so this prototype only checks that you replaced the starter with a real implementation.</p></div>`;
      if(s.gabarito)h+=`<div class="lt-card"><h3>Reference solution</h3><div class="lt-cx"><span>time <b>${esc(s.gabarito.time)}</b></span><span>space <b>${esc(s.gabarito.space)}</b></span></div><pre class="notr">${esc(s.gabarito.solution.replace(/\n$/,''))}</pre><div class="notr">${mdFull(s.gabarito.justification)}</div></div>`;}
    go.textContent=done?'Continue →':'Submit ▷';}
  h+=`<div class="lt-help"><button class="mini" onclick="ltAsk()">Ask the Tutor</button><span>The Tutor explains and hints; you write the final code.</span></div>`;const top=el.scrollTop;el.innerHTML=h;el.scrollTop=top;}
function ltGo(){const{s}=ltFind(LTS.cur)!,seq=ltSeq(),nx=seq[seq.findIndex((x:any)=>x.id===s.id)+1];
  if(s.kind==='concept'&&!ltDone(s.id)){LTS.done[dk(s.id)]=1;saveLT();}
  else if(s.kind==='drill'&&!ltDone(s.id)){const d=drillState(s);toast(`${d.n} of ${d.T.length} lines match — keep typing`);ltRes();return;}
  else if(s.kind==='challenge'&&!ltDone(s.id)){const c=FS[ltPath(s)].content,same=c.trim()===s.starter.trim(),todo=/todo!\(|unimplemented!\(|panic\("(TODO|todo|not implemented)|\/\/\s*TODO/.test(c),has=!s.entry||c.includes(s.entry);
    LT_SUB={ok:!same&&!todo&&has,why:same?'The file still equals the starter. Write your implementation first.':todo?'The implementation still has a TODO placeholder.':`The function <code>${esc(s.entry||'')}</code> is missing.`};if(LT_SUB.ok){LTS.done[dk(s.id)]=1;saveLT();if(PANE==='tutor')RP.tutor();}ltRes();return;}
  if(nx)ltOpen(nx.id);else{toast('Track complete');if(PANE==='tutor')RP.tutor();}}
function ltAsk(){const{s}=ltFind(LTS.cur)!;AGENT='tutor';agentPill();focusAgent(true);
  if(SAMPLE&&PROV.claude.on){ACTIVE='claude';updateAgentUI();liveChat(`I am on the ${s.kind} step "${s.title}" of the course "${course().title}". Help me move forward without giving me the solution.\nMy current code:\n${FS[ltPath(s)].content||'(empty)'}`);}
  else{user(`Tutor, I need help with "${s.title}".`);card('tutor',`<div class="notr">${mdFull(s.intro)}</div><p style="color:var(--fg-dim)">With Claude live, the Tutor answers questions about your own code instead of showing the step's background.</p>`);}}

/* ── publicar no window: tutor.ts/visualizer.ts/v5.ts e os shims de app.ts lêem por global ── */
Object.assign(window, { LTS, saveLT, LT_LANGS, LT_LEVELS, LT_EXT, LT_BADGE, course, ltUnits, dk, ltDone, ltFind, ltPath, ltSeq, ltPts, stars, ltOnboard, ltStart, ltResume, ltOpen, openLesson, nextLesson, renderLtView, tgt, drillState, ltRes, ltGo, ltAsk });
