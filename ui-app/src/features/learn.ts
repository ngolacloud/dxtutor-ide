/* ═════════ dxtutor IDE — feature: Learning Track (percurso multi-língua + conteúdo) ═════════
   Inversão de direcção (padrão Studio/SCM/Debug): o motor Learning Track, antes em `app.ts`
   (dados COURSES no topo + motor/vista em baixo), muda-se INTEIRO para cá. @ts-nocheck como
   as outras features-motor. DETÉM: COURSES (conteúdo), estado LTS/ONB/LT_SUB/LT_* , o motor
   (course/ltUnits/dk/ltDone/ltFind/ltPath/ltSeq/ltPts/stars/ltOnboard/ltStart/ltResume/
   ltOpen/openLesson/nextLesson/drillState/ltRes/ltGo/ltAsk) e o corpo da vista (renderLtView).
   CONSUMIDORES por global: features/tutor.ts (pane renderTutorPane lê LTS/course/ltPts/…),
   features/visualizer.ts (decora VIEW.lt + lê LTS), features/welcome.ts (chama ltResume), e em
   app.ts os shims `RP.tutor`(→renderTutorPane, já lá) e `VIEW.lt`(→renderLtView). A secção
   morta «Tutor: percursos» (LEARN/LP/lesson*) fica em app.ts e lê `LF` por window.
   Mecânica: avalia ANTES de app.ts → publica tudo no window no eval (nada lido ansiosamente
   além de LS, já publicado pelo boot). ONB/LT_HOOD window-puros (reatribuídos/escritos por
   onclicks inline); LTS é const mutado em sítio; LT_SUB é local (só a feature o escreve). */

import { $, esc, svg, mdFull } from "../core";
import { VIEW } from "../app/store/registry";
import rustCourse from "../content/courses/rust.json";
import goCourse from "../content/courses/go.json";
import { LANGUAGE_CATALOG, findLanguage, findSubject, languageCards, subjectCards } from "./learn/domain/catalog";
import { baseName, isReadonly, projectPaths, projectSubmission } from "./learn/domain/project";
import { fromEmbedded } from "./learn/domain/course-adapter";
import type { Course, PluginRow, PrepareStatus } from "./learn/domain/types";
import type { Grade } from "./learn/application/ports";
import { gradeStep, installPlugin, loadCatalog, msg, removePlugin } from "./learn/application/catalog-service";
import { isNotPrepared, needsPreparing, prepareCourse } from "./learn/application/prepare-service";
import { tauriCourseGateway, tauriLearnAudit } from "./learn/infrastructure/legacy-bridge";
import { requestApproval } from "../app/approval";
import { bindActions } from "./learn/ui/actions";
import { registerActions } from "../app/actions";
import { translator } from "../app/i18n";
import { LEARN_MESSAGES } from "./learn/ui/messages";
import { LEARN_TRACK_MESSAGES } from "./learn/ui/track-messages";
import { services } from "../app/services";
import { agentStore } from "../app/store";
import { agentPill } from "./team";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(LEARN_MESSAGES);
const tt = translator(LEARN_TRACK_MESSAGES);

/* ───── conteúdo dos cursos ───── */
/* Conteúdo dos cursos: dados, não código. Rust e Go vêm embutidos (src/content/courses/*.json,
   o protótipo de browser só tem estes); as outras linguagens chegam como PLUGINS
   (github.com/ngolacloud/dxtutor-course-<id>, ver docs/plugins/README.md), servidos pelo backend no
   desktop. COURSES é mutado em sítio por `refreshCatalog` (nunca reatribuído). */
const EMBEDDED: Record<string, Course> = { rust: fromEmbedded(rustCourse as any, "rust"), go: fromEmbedded(goCourse as any, "go") };
const COURSES: Record<string, any> = { ...EMBEDDED };
/** Plugins instalados (desktop). */
let PLUGINS: PluginRow[] = [];
/** Estado do catálogo: carregado do backend uma vez por sessão (ou após instalar/remover). */
let CATALOG: 'idle'|'loading'|'ready' = 'idle';
let CATALOG_P: Promise<void>|null = null;
/** Mensagem da caixa «Install a course plugin» no selector. */
let LT_PLUG: {busy:boolean; text:string; bad:boolean} = {busy:false,text:'',bad:false};
/** Resultado da última avaliação real (backend) do desafio aberto. */
let LT_GRADE: (Grade & {step:string})|null = null;
let LT_GRADING = false;
/** Leitura dos conceitos do tópico aberta/fechada por unidade (por omissão aberta no 1.º passo). */
const LT_READ: Record<string, boolean> = {};
/** Passos de projecto: o ficheiro aberto de cada passo (id do passo → caminho relativo). */
const LT_FILE: Record<string, string> = {};
/** Cursos que se preparam uma vez (`prepare`): o estado de cada um (id do curso → estado), pedido
 *  ao backend na primeira vez que um passo do curso abre; e o que a última preparação disse. */
const LT_PREP: Record<string, PrepareStatus | "loading"> = {};
let LT_PREPARING = false;
let LT_PREP_MSG: {text:string;bad:boolean;output?:string}|null = null;

/* ───── estado + motor do Learning Track ───── */
/* LTS window-backed; hidrata de LS PREGUIÇOSAMENTE (como hydrateBps no debug.ts): a
   feature avalia ANTES de app.ts publicar LS → `LS.get()` ansioso no eval = ReferenceError
   que pára o chunk. Default eager-safe; Object.assign(LTS,…) hidrata em sítio (não reatribui,
   por isso o LTS que o tutor e o visualizer lêem pelo registo continua a mesma referência). */
interface LTState { lang: string|null; levels: string[]; done: Record<string,number>; open: Record<string,boolean>; show: Record<string,number>; cur: string|null; }
const LTS: LTState = {lang:null,levels:[],done:{},open:{},show:{},cur:null};
let _ltHyd=false;
function hydrateLT(){if(_ltHyd)return;_ltHyd=true;try{const s=LS.get('lt3',null);if(s&&typeof s==='object')Object.assign(LTS,s);}catch(e){}}
const saveLT=()=>LS.set('lt3',LTS);
/* LT_LANGS (forma antiga {id,n,g}) deriva do catálogo oficial de 10 linguagens; LT_EXT é
   preenchido do catálogo + manifestos dos plugins (mutado em sítio, como COURSES). */
const LT_LEVELS=[['basic','Basic','Start from the ground up — syntax and first programs.'],['intermediate','Intermediate','Build on the basics with real-world patterns.'],['advanced','Advanced','Deep dives, performance and the tricky corners.']];
const LT_EXT:Record<string,string>=Object.fromEntries(LANGUAGE_CATALOG.map(l=>[l.id,l.extension])),LT_BADGE:Record<string,string>={concept:'LEARN',drill:'DRILL',challenge:'APPLY'};
/* a escolha do onboarding (língua e níveis): com dono aqui (U7j — era window.ONB) */
export let ONB:{lang:string|null;levels:string[]}={lang:null,levels:[]};
let LT_SUB:{ok:boolean;why:string}|null=null;let LT_HOOD=false;
const course=()=>{hydrateLT();return COURSES[LTS.lang!];},ltUnits=()=>{hydrateLT();return course().units.filter((u:any)=>LTS.levels.includes(u.level));},dk=(id:string)=>LTS.lang+':'+id,ltDone=(id:string)=>!!LTS.done[dk(id)];
export const ltFind=(id:string|null)=>{for(const u of course().units)for(const s of u.steps)if(s.id===id)return{u,s};return null;};
/* LTS.lang é a chave do PERCURSO: a linguagem, ou o subject de um framework/ferramenta. A linguagem
   em que o passo se escreve e se avalia é a do curso (`ltLang`). */
const ltLang=():string=>{const c=course();return (c&&c.language)||LTS.lang!;};
const ltExt=():string=>LT_EXT[ltLang()]||'txt';
/** O ficheiro aberto de um passo de projecto (o principal por omissão). */
const ltCurFile=(s:any):string=>{const f=LT_FILE[s.id];return f&&s.project&&f in s.project.files?f:s.project.main;};
/** O caminho no workspace de um ficheiro de um passo de projecto. */
const ltFilePath=(s:any,rel:string)=>services.workspace!.LF(`${LTS.lang}/${s.id}/${rel}`);
export const ltPath=(s:any)=>s.project?ltFilePath(s,ltCurFile(s)):services.workspace!.LF(`${LTS.lang}/${s.id}.${ltExt()}`);
const ltTabTitle=(s:any)=>s.project?`${s.id}/${ltCurFile(s)}`:`${s.id}.${ltExt()}`;
const ltSeq=()=>ltUnits().flatMap((u:any)=>u.steps);
const ltPts=()=>ltSeq().reduce((a:number,s:any)=>a+(ltDone(s.id)?s.points:0),0);
function stars(d:number,kind?:string){if(kind==='concept'||!d)return'';const n=d<=3?1:d<=7?2:d<=12?3:d<=18?4:5;return `<span class="lt-stars" title="Challenge ${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5-n)}</i></span>`;}
function ltOnboard(step:any){hydrateLT();let o=$('#onb');if(!o){document.body.insertAdjacentHTML('beforeend','<div id="onb"></div>');o=$('#onb')!;o.onclick=e=>{if(e.target===o&&LTS.lang)o!.classList.remove('show');};}
  ONB_STEP=step===2?2:1;
  if(step===1||!step){ONB={lang:LTS.lang,levels:LTS.levels.slice()};if(CATALOG==='idle')refreshCatalog();
    const cards=languageCards(COURSES,PLUGINS).map(cd=>{const l=cd.language,ok=cd.state==='available';return `<button class="onb-lang${ok?'':' soon'}" ${ok?`data-action="lt-pick" data-on="${esc(l.id)}"`:'disabled'}><span class="g">${l.icon}</span><b>${esc(l.name)}</b>${ok?`<small class="notr">${esc(cd.summary.slice(0,58))}${cd.summary.length>58?'…':''}</small>`:''}<span class="tag ${ok?'live':''}">${ok?(cd.community?'Community':'Available'):'Coming soon'}</span></button>`;}).join('');
    /* Frameworks e ferramentas: categoria à parte, com o mesmo cartão das linguagens (um oficial
       sem curso fica «Coming soon», desactivado — sem progresso nem conteúdo inventado). */
    const fw=subjectCards(COURSES,PLUGINS).map(cd=>{const f=cd.subject,ok=cd.state==='available';return `<button class="onb-lang${ok?'':' soon'}" ${ok?`data-action="lt-pick" data-on="${esc(f.id)}"`:'disabled'}><span class="g">${f.icon}</span><b>${esc(f.name)}</b>${ok?`<small class="notr">${esc(cd.summary.slice(0,58))}${cd.summary.length>58?'…':''}</small>`:''}<span class="tag ${ok?'live':''}">${ok?(cd.community?'Community':'Available'):'Coming soon'}</span></button>`;}).join('');
    o.innerHTML=`<div class="onb-box"><div class="onb-brand">${svg('sparkle')} Delonix Tutor</div><h2>${txt("whatDoYouWant")}</h2><p>${txt("pickALanguageAnd")}</p><div class="onb-langs">${cards}</div><h3 class="onb-sec">${tt("frameworksAndTools")}</h3><p class="onb-hint onb-sec-hint">${tt("frameworksHint")}</p><div class="onb-langs onb-fw">${fw}</div>${ltPluginPanel()}</div>`;}
  else o.innerHTML=`<div class="onb-box"><div class="onb-brand">${svg('sparkle')} Delonix Tutor</div><h2>${txt("whatSYourLevel")}</h2><p>${txt("pickOneOrMore")}</p>${LT_LEVELS.map(l=>`<button class="onb-lvl${ONB.levels.includes(l[0])?' on':''}" data-action="learn:level" data-on="${esc(l[0])}"><span><b>${l[1]}</b><small>${l[2]}</small></span><i>${ONB.levels.includes(l[0])?'✓':''}</i></button>`).join('')}<div class="onb-foot"><button class="lnk" data-action="learn:back">${txt("back")}</button><button class="mini pri" ${ONB.levels.length?'':'disabled'} data-action="learn:start">${txt("start")}</button></div></div>`;
  o.classList.add('show');}
/* ───── plugins de curso: carregar, instalar, remover (casos de uso em learn/application) ───── */
let ONB_STEP=0;
const onbOpenAt1=()=>{const o=$('#onb');return !!o&&o.classList.contains('show')&&ONB_STEP===1;};
function refreshCatalog(force=false):Promise<void>{
  if(CATALOG_P&&!force)return CATALOG_P;
  CATALOG='loading';
  CATALOG_P=loadCatalog(tauriCourseGateway,EMBEDDED).then(st=>{
    for(const k of Object.keys(COURSES))if(!(k in st.courses))delete COURSES[k];
    Object.assign(COURSES,st.courses);PLUGINS=st.plugins;
    for(const p of PLUGINS)if(p.language&&!LT_EXT[p.language.id])LT_EXT[p.language.id]=p.language.extension;
    if(st.problems.length)console.warn('[learn] '+st.problems.join('\n'));
  }).catch(e=>console.warn('[learn] catalog: '+msg(e))).finally(()=>{CATALOG='ready';if(onbOpenAt1())ltOnboard(1);if(typeof PANE!=='undefined'&&PANE==='tutor')RP.tutor();});
  return CATALOG_P;
}
function ltPluginPanel():string{
  if(!tauriCourseGateway.available())return `<div class="onb-plug"><p class="onb-hint">More languages install as course plugins in the desktop app.</p></div>`;
  const rows=PLUGINS.map(p=>`<div class="onb-prow"><span class="g">${p.language?p.language.icon:'⚠'}</span><span class="nm"><b>${esc(p.name)}</b> <small>${esc(p.version)}</small><small class="src notr">${esc(p.error||p.source)}</small></span><button class="lnk" data-action="lt-remove" data-on="${esc(p.id)}" ${LT_PLUG.busy?'disabled':''}>${txt("remove")}</button></div>`).join('');
  return `<div class="onb-plug"><h3>Course plugins</h3><div class="onb-pin"><input id="onb-src" class="notr" placeholder="python · owner/repo · https://github.com/owner/repo · ./folder" spellcheck="false" ${LT_PLUG.busy?'disabled':''}><button class="mini pri" data-action="lt-install" ${LT_PLUG.busy?'disabled':''}>${LT_PLUG.busy?'Working…':'Install'}</button></div>${LT_PLUG.text?`<p class="onb-msg${LT_PLUG.bad?' bad':''}">${esc(LT_PLUG.text)}</p>`:''}${CATALOG==='loading'?'<p class="onb-hint">Loading installed courses…</p>':''}${rows?`<div class="onb-plist">${rows}</div>`:''}<p class="onb-hint">Anyone can publish a course: create one with <code>dxt plugin new</code> and push it to GitHub.</p></div>`;
}
async function ltInstall(source:string){
  LT_PLUG={busy:true,text:`Installing ${source.trim()}…`,bad:false};if(onbOpenAt1())ltOnboard(1);
  try{const r=await installPlugin(tauriCourseGateway,source);
    LT_PLUG={busy:false,bad:false,text:`${r.replaced?`Updated ${r.languageName} ${r.replaced} → ${r.version}`:`Installed ${r.languageName} ${r.version}`}${r.warnings.length?` · ${r.warnings.length} content warning(s)`:''}`};
    await refreshCatalog(true);
  }catch(e){LT_PLUG={busy:false,bad:true,text:msg(e)};}
  if(onbOpenAt1())ltOnboard(1);
}
async function ltRemove(id:string){
  LT_PLUG={busy:true,text:`Removing ${id}…`,bad:false};if(onbOpenAt1())ltOnboard(1);
  try{await removePlugin(tauriCourseGateway,id);LT_PLUG={busy:false,bad:false,text:`Removed ${id}. Your progress is kept if you install it again.`};await refreshCatalog(true);}
  catch(e){LT_PLUG={busy:false,bad:true,text:msg(e)};}
  if(onbOpenAt1())ltOnboard(1);
}
bindActions({
  'lt-onboard':{on:'click',run:()=>{ltOnboard(1);}},
  'lt-pick':{on:'click',run:e=>{ONB.lang=e.on;ltOnboard(2);}},
  'lt-install':{on:'click',run:()=>{const i=$('#onb-src') as HTMLInputElement|null;if(i)ltInstall(i.value);}},
  'lt-remove':{on:'click',run:e=>{ltRemove(e.on);}},
  'lt-read':{on:'click',run:e=>{const f=ltFind(LTS.cur);LT_READ[e.on]=!ltReadOpen(e.on,f);ltRes();}},
  'lt-file':{on:'click',run:e=>{ltPickFile(e.on);}},
  'lt-prepare':{on:'click',run:()=>{void ltPrepare();}},
});

/* ───── preparar um curso (Learn P1): a única ida à rede, aprovada e auditada ───── */
/** O estado da preparação do curso aberto (pede-o ao backend uma vez); `null` quando o curso não
 *  se prepara. */
function ltPrepState(c:Course):PrepareStatus|"loading"|null{
  if(!c||c.origin!=='backend'||!c.prepare)return null;
  if(!(c.id in LT_PREP)){LT_PREP[c.id]='loading';
    tauriCourseGateway.prepareStatus(c.id).then(st=>{LT_PREP[c.id]=st;})
      .catch(e=>{delete LT_PREP[c.id];LT_PREP_MSG={text:tt("prepareError",{e:msg(e)}),bad:true};}).finally(()=>ltRes());}
  return LT_PREP[c.id];
}
/** O cartão «Prepare this course» enquanto o curso não está pronto (e o resultado da última vez). */
function ltPrepareCard(c:Course):string{
  const st=ltPrepState(c);
  const note=LT_PREP_MSG?`<p class="lt-note${LT_PREP_MSG.bad?' bad':''}">${esc(LT_PREP_MSG.text)}</p>${LT_PREP_MSG.output?`<pre class="notr">${esc(LT_PREP_MSG.output.slice(-4000))}</pre>`:''}`:'';
  if(!st||st==='loading'||!needsPreparing(st))return note?`<div class="lt-card">${note}</div>`:'';
  return `<div class="lt-card lt-prep"><h3>${esc(tt("prepareHeading"))}</h3><p>${esc(st.state==='stale'?tt("prepareStale"):tt("prepareBody"))}</p>${note}<button class="mini pri" data-action="lt-prepare" ${LT_PREPARING?'disabled':''}>${esc(LT_PREPARING?tt("preparing"):tt("prepareButton"))}</button></div>`;
}
async function ltPrepare(){
  const c=course();if(!c||LT_PREPARING)return;
  LT_PREPARING=true;LT_PREP_MSG=null;ltRes();
  try{
    const r=await prepareCourse({gw:tauriCourseGateway,human:{approve:req=>requestApproval(req)},audit:tauriLearnAudit,title:tt("prepareTitle",{course:c.title})},c.id);
    if(r.kind==='refused')LT_PREP_MSG={text:tt("prepareRefused"),bad:true};
    else{LT_PREP[c.id]=r.status;
      if(r.kind==='failed')LT_PREP_MSG={text:tt("prepareFailed"),bad:true,output:r.output};
      else if(r.kind==='prepared')LT_PREP_MSG={text:tt("prepareDone",{fetch:Math.round(r.status.fetchSecs??0),warm:Math.round(r.status.warmSecs??0)}),bad:false};}
  }catch(e){LT_PREP_MSG={text:`${tt("prepareFailed")} ${msg(e)}`,bad:true};}
  finally{LT_PREPARING=false;ltRes();}
}
/** A leitura (visão geral da linguagem / conceitos do tópico) abre sozinha no 1.º passo. */
function ltReadOpen(key:string,f:{u:any;s:any}|null):boolean{
  if(key in LT_READ)return LT_READ[key];
  if(!f)return false;
  return key==='__overview'?ltSeq()[0]===f.s:f.u.id===key&&f.u.steps[0]===f.s;
}

/** Cartões de leitura: a visão geral da linguagem (1.º passo do curso) e os conceitos do
 *  tópico (unidade). Abrem sozinhos no 1.º passo; o aluno pode abrir/fechar a qualquer altura. */
function ltReading(f:{u:any;s:any}):string{
  const c=course(),card=(key:string,title:string,body:string,extra='')=>{const open=ltReadOpen(key,f);
    return `<div class="lt-card lt-read"><button class="lt-read-h" data-action="lt-read" data-on="${esc(key)}"><span>📖 ${esc(title)}</span><small>${open?'Hide':'Read'}</small></button>${open?`<div class="notr lt-read-b">${mdFull(body)}${extra}</div>`:''}</div>`;};
  let h='';
  if(c.overview&&ltSeq()[0]===f.s)h+=card('__overview',`About ${c.title}`,c.overview,ltSubjectInfo(c));
  if(f.u.concepts)h+=card(f.u.id,`Concepts: ${f.u.title}`,f.u.concepts);
  return h;
}

/** Num curso de framework/ferramenta: a documentação oficial e o que instalar (do catálogo, ou
 *  do manifesto do plugin da comunidade). Vazio num curso de linguagem. */
function ltSubjectInfo(c:Course):string{
  if(c.category==='language')return '';
  const sub=findSubject(c.subject,PLUGINS);if(!sub)return '';
  let h='';
  if(/^https:\/\//.test(sub.docs))h+=`<p class="lt-sub"><b>${tt("officialDocs")}:</b> <a href="${esc(sub.docs)}" target="_blank" rel="noopener">${esc(sub.docs)}</a></p>`;
  if(sub.install)h+=`<p class="lt-sub"><b>${tt("beforeYouStart")}:</b> ${esc(sub.install)}</p>`;
  return h;
}

/** Passo de projecto: abre outro ficheiro do passo no mesmo separador. */
function ltPickFile(rel:string){const f=ltFind(LTS.cur);if(!f||!f.s.project||!(rel in f.s.project.files))return;
  LT_FILE[f.s.id]=rel;const tab=tabOf('lt');if(tab){Object.assign(tab,{title:ltTabTitle(f.s),path:ltPath(f.s)});show('lt');}}

function ltStart(){hydrateLT();LTS.lang=ONB.lang;LTS.levels=LT_LEVELS.map(l=>l[0]).filter(l=>ONB.levels.includes(l));LTS.cur=null;saveLT();const o=$('#onb');if(o)o.classList.remove('show');goPane('tutor');ltResume();}
export function ltResume(){hydrateLT();if(!LTS.lang){goPane('tutor');ltOnboard(1);return;}
  if(!COURSES[LTS.lang]){if(CATALOG!=='ready'){refreshCatalog().then(()=>{if(COURSES[LTS.lang!])ltResume();else{goPane('tutor');ltOnboard(1);}});return;}
    toast(`The ${findLanguage(LTS.lang,PLUGINS)?.name||findSubject(LTS.lang,PLUGINS)?.name||LTS.lang} course is not installed`);goPane('tutor');ltOnboard(1);return;}
  const s=ltSeq(),id=LTS.cur&&ltFind(LTS.cur)&&s.some((x:any)=>x.id===LTS.cur)?LTS.cur:(s.find((x:any)=>!ltDone(x.id))||s[0]).id;ltOpen(id);}
function ltOpen(id:string){hydrateLT();const f=ltFind(id);if(!f)return;const{u,s}=f,i=u.steps.indexOf(s);if(i>0&&!ltDone(u.steps[i-1].id)){toast('Finish the previous step to unlock this one');return;}
  LTS.cur=id;LTS.open[u.id]=true;saveLT();LT_HOOD=false;LT_SUB=null;LT_GRADE=null;
  /* Passo de projecto: cada ficheiro do passo entra no workspace com o seu conteúdo inicial
     (uma só vez: o que o aluno escreveu fica). */
  if(s.project)for(const rel of projectPaths(s.project)){const fp=ltFilePath(s,rel);if(!FS[fp])FS[fp]={content:s.project.files[rel],orig:null};}
  const p=ltPath(s);
  if(!FS[p])FS[p]={content:s.kind==='concept'?`// ${s.title}\n//\n// Read the concept on the right, then press Continue.\n`:s.kind==='challenge'?s.starter.replace(/^\n/,''):'',orig:null};
  const old=tabOf('lt');if(old&&cur==='lt'){Object.assign(old,{title:ltTabTitle(s),path:p});show('lt');}else openTab({id:'lt',title:ltTabTitle(s),kind:'lt',path:p});if(PANE==='tutor')RP.tutor();}
function openLesson(){ltResume();}function nextLesson(){return[0,0];}

/* ───── corpo da vista (editor + painel do passo); app.ts mantém o shim VIEW.lt ───── */
export function renderLtView(t:any,host:HTMLElement){hydrateLT();const f=ltFind(LTS.cur);if(!f){host.innerHTML='<div class="empty">Open a step from the Learning Track.</div>';return;}const p=t.path;
  /* Passo de projecto: a lista de ficheiros do passo por cima do editor; o só de leitura abre
     sem se poder mudar (a avaliação usa sempre a cópia do curso). */
  const pj=f.s.project,curRel=pj?ltCurFile(f.s):'',ro=!!pj&&isReadonly(pj,curRel);
  const files=pj?`<div class="lt-files" role="tablist" aria-label="${esc(tt("projectFiles"))}">${projectPaths(pj).map(rel=>{const r=isReadonly(pj,rel);return `<button class="lt-fbtn notr${rel===curRel?' on':''}${r?' ro':''}" role="tab" aria-selected="${rel===curRel}" data-action="lt-file" data-on="${esc(rel)}" title="${esc(rel)}${r?' · '+esc(tt("readOnlyTitle")):''}">${esc(baseName(rel))}<small>${esc(rel.includes('/')?rel.slice(0,rel.lastIndexOf('/')):'')}</small>${r?`<i>${esc(tt("readOnly"))}</i>`:''}</button>`;}).join('')}</div>`:'';
  host.innerHTML=`<div class="lt"><div class="lt-ed">${files}<div class="lt-bar"><span class="lt-file notr">● ${esc(t.title)}</span><span class="sp"></span><button class="mini" data-action="learn:hood">${txt("underTheHood")}</button><button class="mini pri" id="lt-go" data-action="learn:go"></button></div><div class="lt-scroll"><div class="ed"><div class="ed-gut" id="ed-gut"></div><div class="ed-wrap"><div class="ed-hl" id="ed-hl"></div><textarea id="ed-ta" class="ed-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"></textarea></div></div></div></div><div class="lt-res" id="lt-res"></div></div>`;
  const ta=$('#ed-ta') as HTMLTextAreaElement;ta.value=FS[p].content;ta.readOnly=ro;paintEd(p);services.tabs!.miniOff();ta.oninput=()=>{FS[p].content=ta.value;paintEd(p);services.tabs!.miniOff();LT_SUB=null;ltRes();};
  ta.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const ind=findLanguage(ltLang(),PLUGINS)?.indent??'    ';if(!document.execCommand('insertText',false,ind))ta.setRangeText(ind,ta.selectionStart,ta.selectionEnd,'end');(ta.oninput as any)();}};ta.onkeyup=ta.onclick=()=>stPos();ltRes();}
const tgt=(s:any)=>s.target.replace(/^\n/,'').replace(/\n+$/,'').split('\n');
function drillState(s:any){const T=tgt(s),typed=(FS[ltPath(s)]?FS[ltPath(s)].content:'').replace(/\s+$/,'').split('\n'),ok=T.map((l:any,i:number)=>typed[i]!==undefined&&typed[i].trimEnd()===l.trimEnd());return{T,ok,n:ok.filter(Boolean).length,all:ok.every(Boolean)&&typed.length===T.length};}
function ltRes(){hydrateLT();const f=ltFind(LTS.cur),el=$('#lt-res'),go=$('#lt-go');if(!f||!el||!go)return;const{s}=f,done=ltDone(s.id);let h=`<div class="lt-kind"><span>${s.kind==='concept'?'Concept':s.kind==='drill'?'Drill':'Challenge'}</span><b>${done?'✓ ':''}+${s.points} pts</b></div>`;
  h+=ltReading(f);
  h+=ltPrepareCard(course());
  if(LT_HOOD)h+=`<div class="lt-card hood"><h3>${txt("underTheHood")}</h3><div class="notr">${mdFull(s.intro)}</div><p class="lt-note">In the desktop app this view also compiles your code and shows measured CPU, memory and I/O. The browser prototype shows the explanation only.</p></div>`;
  if(s.kind==='concept'){h+=`<div class="lt-card notr"><h2>${esc(s.title)}</h2>${mdFull(s.body)}</div>`;go.textContent='Continue →';}
  else if(s.kind==='drill'){const d=drillState(s),hide=s.placeholder_policy!=='shown'&&!LTS.show[dk(s.id)]&&!done;if(d.all&&!done){LTS.done[dk(s.id)]=1;saveLT();if(PANE==='tutor')RP.tutor();}const fin=ltDone(s.id);
    h+=`<div class="lt-card"><h2 class="notr">${esc(s.title)}</h2><div class="notr">${mdFull(s.prompt)}</div><div class="lt-prog"><span class="lp-bar" style="flex:1;margin:0"><i style="width:${d.n/d.T.length*100}%"></i></span><span>${d.n}/${d.T.length} lines</span>${hide?`<button class="mini" data-action="learn:showTarget" data-on="${esc(dk(s.id))}">Show target</button>`:''}</div>
      <div class="lt-target notr">${d.T.map((l:any,i:number)=>{const cur=!d.ok[i]&&d.ok.slice(0,i).every(Boolean);return `<div class="tl${d.ok[i]?' ok':cur?' cur':''}"><span class="n">${d.ok[i]?'✓':i+1}</span><div><code>${hide&&!d.ok[i]?'· · ·':hlLine(l,ltExt())||'&nbsp;'}</code>${(d.ok[i]||cur)&&s.line_comments&&s.line_comments[i]?`<small>${mdFull(s.line_comments[i]).replace(/^<p>|<\/p>$/g,'')}</small>`:''}</div></div>`;}).join('')}</div></div>`;
    if(fin)h+=`<div class="lt-card ok"><h3>✓ It matches</h3><div class="notr">${mdFull(s.explanation)}</div><p class="lt-note">The desktop app now runs the program and shows its real output.</p></div>`;go.textContent=fin?'Continue →':'Check ▷';}
  else if(course().origin==='backend'){
    /* Curso servido pelo backend (plugin): os testes ocultos ficam no backend e a avaliação
       é real (`submit_step`). Sem simulação: se a linguagem ainda não tiver avaliador, o
       erro do backend aparece tal como vem. */
    const g=LT_GRADE&&LT_GRADE.step===s.id?LT_GRADE:null;
    h+=`<div class="lt-card"><h2 class="notr">${esc(s.title)}</h2><div class="notr">${mdFull(s.instructions)}</div>${s.project?`<p class="lt-note">${tt("projectNote")}</p>`:''}</div>`;
    if(LT_SUB&&!LT_SUB.ok)h+=`<div class="lt-card bad"><h3>✗ Could not grade</h3><p class="notr">${LT_SUB.why}</p></div>`;
    /* O resumo do avaliador vem em português (`testes falharam`, de todos os runners); a UI do
       Learning Track é em inglês, por isso o título é nosso e a saída crua mostra o detalhe. */
    if(g&&!g.passed)h+=`<div class="lt-card bad"><h3>✗ Not yet — the hidden tests did not pass</h3><pre class="notr">${esc(g.raw.slice(0,4000))}</pre></div>`;
    if(done){h+=`<div class="lt-card ok"><h3>✓ Passed</h3><p>The hidden tests passed.</p></div>`;
      if(g&&g.gabarito){const gb=g.gabarito,gf=gb.files||{};
        /* Num projecto a solução são ficheiros e não há complexidade a mostrar. */
        h+=`<div class="lt-card"><h3>${txt("referenceSolution")}</h3>${gb.time||gb.space?`<div class="lt-cx"><span>time <b>${esc(gb.time)}</b></span><span>space <b>${esc(gb.space)}</b></span></div>`:''}${gb.solution?`<pre class="notr">${esc(gb.solution.replace(/\n$/,''))}</pre>`:''}${Object.keys(gf).map(rel=>`<div class="lt-gfile notr">${esc(rel)}</div><pre class="notr">${esc(gf[rel].replace(/^\n/,'').replace(/\n$/,''))}</pre>`).join('')}<div class="notr">${mdFull(gb.justification)}</div></div>`;}}
    go.textContent=done?'Continue →':LT_GRADING?'Grading…':'Submit ▷';}
  else{const tests=[...s.tests.matchAll(LTS.lang==='go'?/func (Test\w+)/g:/fn (\w+)\s*\(\)/g)].map(m=>m[1]);
    h+=`<div class="lt-card"><h2 class="notr">${esc(s.title)}</h2><div class="notr">${mdFull(s.instructions)}</div></div>`;
    if(LT_SUB&&!LT_SUB.ok)h+=`<div class="lt-card bad"><h3>${txt("notYet")}</h3><p>${LT_SUB.why}</p></div>`;
    if(done){h+=`<div class="lt-card ok"><h3>${txt("submitted")}</h3>${tests.map(n=>`<div class="chk ok"><span class="g">✓</span><span class="notr">${esc(n)}</span><span class="w">${txt("simulated")}</span></div>`).join('')}<p class="lt-note">${txt("hiddenTestsDecideCorrectness")}<code>${LTS.lang==='go'?'go test':'cargo test'}</code>)${txt("theBrowserCannotCompile")}</p></div>`;
      if(s.gabarito)h+=`<div class="lt-card"><h3>${txt("referenceSolution")}</h3><div class="lt-cx"><span>time <b>${esc(s.gabarito.time)}</b></span><span>space <b>${esc(s.gabarito.space)}</b></span></div><pre class="notr">${esc(s.gabarito.solution.replace(/\n$/,''))}</pre><div class="notr">${mdFull(s.gabarito.justification)}</div></div>`;}
    go.textContent=done?'Continue →':'Submit ▷';}
  h+=`<div class="lt-help"><button class="mini" data-action="learn:ask">${txt("askTheTutor")}</button><span>${txt("theTutorExplainsAnd")}</span></div>`;const top=el.scrollTop;el.innerHTML=h;el.scrollTop=top;}
function ltGo(){const{s}=ltFind(LTS.cur)!,seq=ltSeq(),nx=seq[seq.findIndex((x:any)=>x.id===s.id)+1];
  if(s.kind==='concept'&&!ltDone(s.id)){LTS.done[dk(s.id)]=1;saveLT();}
  else if(s.kind==='drill'&&!ltDone(s.id)){const d=drillState(s);toast(`${d.n} of ${d.T.length} lines match — keep typing`);ltRes();return;}
  else if(s.kind==='challenge'&&!ltDone(s.id)&&course().origin==='backend'){if(LT_GRADING)return;
    /* Projecto: vão os ficheiros editáveis (os só de leitura nunca); `code` é o principal. */
    const files=s.project?projectSubmission(s.project,rel=>FS[ltFilePath(s,rel)]?.content):undefined;
    const code=files?files[s.project.main]:FS[ltPath(s)].content;
    LT_GRADING=true;LT_SUB=null;LT_GRADE=null;ltRes();
    gradeStep(tauriCourseGateway,s.id,code,ltLang(),files).then(g=>{LT_GRADE={...g,step:s.id};if(g.passed){LTS.done[dk(s.id)]=1;saveLT();if(PANE==='tutor')RP.tutor();}})
      .catch(e=>{LT_SUB={ok:false,why:esc(msg(e))};
        /* Um curso por preparar: o backend recusa antes de compilar; volta a perguntar o estado
           para o cartão «Prepare this course» aparecer. */
        if(isNotPrepared(msg(e)))delete LT_PREP[course().id];}).finally(()=>{LT_GRADING=false;ltRes();});return;}
  else if(s.kind==='challenge'&&!ltDone(s.id)){const c=FS[ltPath(s)].content,same=c.trim()===s.starter.trim(),todo=/todo!\(|unimplemented!\(|panic\("(TODO|todo|not implemented)|\/\/\s*TODO/.test(c),has=!s.entry||c.includes(s.entry);
    LT_SUB={ok:!same&&!todo&&has,why:same?'The file still equals the starter. Write your implementation first.':todo?'The implementation still has a TODO placeholder.':`The function <code>${esc(s.entry||'')}</code> is missing.`};if(LT_SUB.ok){LTS.done[dk(s.id)]=1;saveLT();if(PANE==='tutor')RP.tutor();}ltRes();return;}
  if(nx)ltOpen(nx.id);else{toast('Track complete');if(PANE==='tutor')RP.tutor();}}
function ltAsk(){const{s}=ltFind(LTS.cur)!;agentStore.persona='tutor';agentPill();focusAgent(true);
  if(SAMPLE&&PROV.claude.on){ACTIVE='claude';updateAgentUI();liveChat(`I am on the ${s.kind} step "${s.title}" of the course "${course().title}". Help me move forward without giving me the solution.\nMy current code:\n${FS[ltPath(s)].content||'(empty)'}`);}
  else{user(`Tutor, I need help with "${s.title}".`);card('tutor',`<div class="notr">${mdFull(s.intro)}</div><p style="color:var(--fg-dim)">${txt("withClaudeLiveThe")}</p>`);}}

/* ── publicar no window: tutor.ts/visualizer.ts/v5.ts e os shims de app.ts lêem por global ── */
Object.assign(window, { openLesson, nextLesson });
/* a API que o pane do tutor lê (ADR-0004, U7g): o tutor avalia antes deste módulo, por isso não o importa — usa o registo */
services.learn = { LTS, saveLT, LT_BADGE, course, ltUnits, ltDone, ltSeq, ltPts, stars, ltOnboard, ltOpen };
export { LTS, saveLT, LT_BADGE, course, ltUnits, ltDone, ltSeq, ltPts, stars, ltOnboard, ltOpen };
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts; o visualizer decora-a no boot7) */
VIEW.lt = renderLtView;

/* acções do onboarding e do editor de exercícios (ADR-0004, U5c): eram `onclick="…"` inline, que liam e
   escreviam o ONB/LT_HOOD/LTS no window e chamavam as funções publicadas, ao clicar; vão pelo
   despachante partilhado, que faz o mesmo no acto. */
registerActions({
  "learn:level": { click: (c) => { const o = ONB.levels; if (o.includes(c.on)) o.splice(o.indexOf(c.on), 1); else o.push(c.on); ltOnboard(2); } },
  "learn:back": { click: () => void ltOnboard(1) },
  "learn:start": { click: () => void ltStart() },
  "learn:hood": { click: () => { LT_HOOD = !LT_HOOD; ltRes(); } },
  "learn:showTarget": { click: (c) => { LTS.show[c.on] = 1; saveLT(); ltRes(); } },
  "learn:ask": { click: () => void ltAsk() },
  "learn:go": { click: () => void ltGo() },
});
