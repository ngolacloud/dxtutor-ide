/* ═════════ arranque do IDE: boot, boot3…boot6 (ADR-0004, U4j5c) ═════════
   Os passos de arranque que viviam no app.ts — movidos sem mudar, na mesma posição do main.ts (logo
   depois do app/commands.ts). O src/startup.ts chama-os por ordem (`boot();…boot7();i18nBoot()`)
   depois de todos os donos publicarem os seus. Ajustam ACTS/MENUS/CMD/LANG, que se dissolvem quando
   cada feature registar os seus comandos (U7). O CMD, o buildMenus e o LCUR importam-se do
   app/commands.ts: são as mesmas ligações locais que estes passos usavam no app.ts. */
import { setVar, hydrate, log, mkRz, badges } from "../features/shell";
import { LANG } from "../features/editor";
import { openArch } from "../features/arch/index";
import { openProject } from "../features/project/index";
import { openCodevRun } from "../features/codev/index";
import { CMD, buildMenus, LCUR } from "./commands";
import { buildDocker, ACTS, OVERFLOW } from "../boot";
import type { AppCmd, AppMenu } from "./ide-globals";
import { translator } from "./i18n";
import { BOOT_MESSAGES } from "./boot-steps.messages";
import { loadTeam, HT, HARN, MORD, applyTemplate, openTeam, agentPill } from "../features/team";
import { ltResume, ltOnboard } from "../features/learn";
import { loadSD, openStudio } from "../features/studio";
import { closePal, palDraw, palRun, PITEMS, palState } from "../features/palette";
import { loadCfg } from "./store/config";
import { resetWorkspace } from "../features/workspace";
import { buildActivity } from "../features/shell";
import { openSettings, runLabel, assistantCenter, newChat } from "../features/codev";
import { agentStore, layoutStore, editorStore } from "./store";
import { syncTree } from "../features/explorer";
import { setTheme } from "../features/theme";
import { termClear } from "../features/terminal";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(BOOT_MESSAGES);

/* O global MENUS (declarado em pair.ts) não conhece os separadores/submenus que se constroem aqui:
   neste módulo vê-se com o tipo completo. Declaração só de tipo: continua a resolver o global no acto. */
declare const MENUS: AppMenu[];

function boot(){loadCfg();resetWorkspace();syncTree();
  ACTS.length=0;ACTS.push({ic:'explorer',pane:'explorer',title:'Explorer'},{ic:'search',pane:'search',title:'Pesquisa'},{ic:'scm',pane:'scm',title:'Source Control'},{ic:'run',pane:'run',title:'Run and Debug'},{ic:'test',pane:'test',title:'Testing'},{ic:'ext',pane:'ext',title:'Extensions'},{ic:'sparkle',pane:'codev',title:'Co-Dev',acc:1},{ic:'dots',overflow:1,title:'Mais vistas…',spacer:1},{ic:'account',pane:'account',title:'Conta'},{ic:'settings',pane:'settings',title:'Definições'});
  OVERFLOW.length=0;OVERFLOW.push({l:'Remote Explorer',pane:'remote'},{l:'Containers',pane:'containers'});
  $('#brand')!.innerHTML=svg('sparkle');buildMenus();buildMenubar();buildActivity();buildDocker();$('.act')!.classList.add('on');
  $$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt!));
  mkRz($('#rsz-side')!,'--side-w',250,170,460);mkRz($('#rsz-agent')!,'--agent-w',380,300,640,true);
  const pi=$('#pal-in');pi!.oninput=()=>{palState.idx=0;palDraw();};pi!.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();palState.idx=Math.min(PITEMS.length-1,palState.idx+1);palDraw();}else if(e.key==='ArrowUp'){e.preventDefault();palState.idx=Math.max(0,palState.idx-1);palDraw();}else if(e.key==='Enter'){e.preventDefault();palRun(palState.idx);}};
  $('#pal')!.onclick=e=>{const it=(e.target as Element).closest<HTMLElement>('.pi');if(it)palRun(+it.dataset.i!);else if(!(e.target as Element).closest('.pal-box'))closePal();};
  /* teclado do #ag-input: dono agora o compositor (features/codev/ui/composer.ts) */
  $('#pc-terminal')!.onclick=()=>{if(!String(getSelection())){const c=$('#cmd');if(c)c.focus({preventScroll:true});}};
  $('#pc-output')!.innerHTML='';log('co-dev','pronto · '+connected().length+' provedores ligados');
  termClear();setInterval(()=>{runLabel();},1000);
  newChat();setTheme(layoutStore.theme);
  editorStore.tabs=[{id:'welcome',title:'Bem-vindo',kind:'welcome'}];refresh(false,true);show('welcome');
  if(innerWidth<1000){setVar('--side-w','0px');}else $('#tgl-side')!.classList.add('on');$('#tgl-panel')!.classList.add('on');
  if(innerWidth<860){setVar('--panel-h','0px');$('#tgl-panel')!.classList.remove('on');assistantCenter();}
  hydrate();if(document.activeElement&&(document.activeElement as HTMLElement).blur)(document.activeElement as HTMLElement).blur();
  let tries=0;(function live(){if(window.claude&&typeof window.claude.use==='function'){window.claude.use('sample').then(s=>{SAMPLE=s||null;updateAgentUI();const t=tabOf(cur);if(t&&t.kind==='settings')show(cur);if(RP[PANE])RP[PANE]();}).catch(()=>{});}else if(++tries<25)setTimeout(live,300);})();}
function boot3(){loadTeam();SD=loadSD();
  const i=ACTS.findIndex(a=>a.pane==='codev');ACTS.splice(i+1,0,{ic:'book',pane:'tutor',title:'Tutor'},{ic:'cube',run:openStudio,title:'Studio de arquitectura'},{ic:'split',run:openBoard,title:'Quadro'});ACTS[i].sep=1;buildActivity();$('.act')!.classList.add('on');
  $('.side')!.insertAdjacentHTML('beforeend','<div class="pane" id="pane-tutor"></div>');
  /* o #pill-agent nasce no compositor (features/codev/ui/composer.ts); só se cria aqui se faltar */
  if(!$('#pill-agent'))$('.comp-bar')!.insertAdjacentHTML('afterbegin',`<button class="pill" id="pill-agent" title="${txt("assistantForThisConversation")}" data-action="chrome:pickAgent"></button>`);agentPill();
  $('#st-lang')!.insertAdjacentHTML('beforebegin',`<button class="si opt" id="st-blame" title="${txt("lastCommitThatTouched")}"></button>`);
  MENUS.splice(7,0,{t:'Projecto',items:[{l:'Studio de arquitectura',act:openStudio},{l:'Quadro (kanban)',act:openBoard},{l:'Gerar backlog a partir do Studio',act:genBacklog},{sep:1},{l:'Equipa e harness',act:()=>openTeam()},{l:'Grafo de commits',act:()=>openGraph()},{l:'Gitflow',sub:[{l:'Iniciar feature…',act:()=>gfPrompt('feature')},{l:'Iniciar fix…',act:()=>gfPrompt('fix')},{l:'Iniciar release…',act:()=>gfPrompt('release')},{l:'Finalizar ramo actual',act:()=>gfFinish()}]},{sep:1},{l:'Tutor',act:()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}}]});$('#menubar')!.innerHTML='';buildMenubar();
  refresh(false,true);show(cur);badges();}
function boot4(){LANG.go='Go';const ci=CMD.findIndex(c=>c[0]==='Ajuda: O que mudou e porquê');if(ci>=0)CMD.splice(ci,1);
  CMD.push(['Learning Track: Continue','',ltResume],['Learning Track: Change language or level…','',()=>ltOnboard(1)],['Project: RUN the whole stack','Ctrl+F5',dxRun],['Project: Stop the stack','',dxStop],['Preferences: Language — English','',()=>setLocale('en')],['Preferences: Language — Português (Angola)','',()=>setLocale('ptAO')]);
  const hm=MENUS.find(m=>m.t==='Help');if(hm)hm.items=hm.items!.filter(i=>i.l!=='O que mudou e porquê');const pm=MENUS.find(m=>m.t==='Projecto');if(pm){pm.t='Project';pm.items!.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});const ti=pm.items!.findIndex(i=>i.l==='Tutor');if(ti>=0)pm.items![ti]={l:'Learning Track',act:ltResume};}
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items!.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});$('#menubar')!.innerHTML='';buildMenubar();
  const ta=ACTS.find(a=>a.pane==='tutor');if(ta){ta.title='Learning Track';buildActivity();$('.act')!.classList.add('on');}
  $('.panel-tabs .panel-tools')!.insertAdjacentHTML('beforebegin','<button class="ptab" data-pt="services">Services</button>');$('.panel-body')!.insertAdjacentHTML('beforeend','<div class="pcontent" id="pc-services"></div>');$$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt!));
  $('#st-tests')!.insertAdjacentHTML('afterend',`<button class="si" id="st-stack" style="display:none;color:var(--green)" title="${txt("runningStack")}" data-action="chrome:setPanelTab" data-on="services"></button>`);
  SD=loadSD();/* o desenho do projecto (ou vazio) — o semeado saiu (ADR-0006, R6a) */
  drawStack();refresh(false,true);show(cur);}
/* boot5/boot6: os passos de arranque das camadas v5/v6 (ADR-0004, U4g7), verbatim, junto do
   boot/boot3/boot4 — a mesma natureza. Os nomes livres resolvem como no módulo de origem: o CMD/LANG
   são os mesmos objectos publicados (só mutados) e o runTask é o publicado (ninguém o reatribui). */
function boot5(){ENVS.rtOn=false;ENVS.k8sOn=false;if(MORD.indexOf(agentStore.mode)>MORD.indexOf(HARN.ceiling))agentStore.mode=HARN.ceiling;
  for(let i=ACTS.length-1;i>=0;i--)if(['run','ext','account'].includes(ACTS[i].pane!)||ACTS[i].overflow)ACTS.splice(i,1);const bi=ACTS.findIndex(a=>a.title==='Quadro');ACTS.splice(bi+1,0,{ic:'container',pane:'infra',title:'Infra'});const st=ACTS.find(a=>a.pane==='settings');if(st)st.spacer=1;buildActivity();$('.act')!.classList.add('on');
  $('.side')!.insertAdjacentHTML('beforeend','<div class="pane" id="pane-infra"></div>');const tm=$('.tmux');if(tm)tm.remove();const ab=$('.tb-ic[data-ic="account"]');if(ab)ab.onclick=openSettings;
  const drop=['Selection','Go','Terminal'],ed=MENUS.find(m=>m.t==='Edit'),sel=MENUS.find(m=>m.t==='Selection'),go=MENUS.find(m=>m.t==='Go');if(ed&&sel&&go)ed.items!.push({sep:1},...go.items!.filter(i=>!i.sep).slice(0,3),{sep:1},...sel.items!.filter(i=>!i.sep));
  for(let i=MENUS.length-1;i>=0;i--)if(drop.includes(MENUS[i].t))MENUS.splice(i,1);const pm=MENUS.find(m=>m.t==='Project');if(pm)pm.items!.splice(1,0,{l:'System architecture',act:openArch});if(pm)pm.items!.splice(3,0,{l:'⎈ Deploy to Kubernetes',act:dxDeploy},{l:'Attach project to a container',act:dcAttach},{l:'Infra: socket and KUBECONFIG',act:()=>goPane('infra')});if(pm)pm.items!.unshift({l:'Board, backlog and sprints',act:()=>openProject()});$('#menubar')!.innerHTML='';buildMenubar();
  for(let i=CMD.length-1;i>=0;i--)if(/Run and Debug|Extensions/.test(CMD[i][0]))CMD.splice(i,1);
  CMD.push(['Project: Deploy to Kubernetes','',dxDeploy],['Infra: Connect container socket','',()=>{goPane('infra');if(!ENVS.rtOn)rtConnect();}],['Infra: Connect cluster (KUBECONFIG)','',()=>{goPane('infra');if(!ENVS.k8sOn)k8sConnect();}],['Infra: Attach project to a container','',dcAttach],...Object.entries(HT).map(([k,h]): AppCmd=>['Harness: Apply template — '+h.n,'',()=>{applyTemplate(k);openTeam();}]));
  const tt=tabOf('team');if(tt)tt.title='Team & harness';updateAgentUI();drawRemote();refresh(false,true);show(cur);}
function boot6(){Object.assign(LANG,{yaml:'YAML',yml:'YAML',jsx:'JavaScript JSX',js:'JavaScript',go:'Go',py:'Python',sh:'Shell'});ACTS.length=0;ACTS.push({ic:'explorer',pane:'explorer',title:'Explorer (Ctrl+Shift+E)'},{ic:'search',pane:'search',title:'Search (Ctrl+Shift+F)'},{ic:'scm',pane:'scm',title:'Source Control (Ctrl+Shift+G)'},{ic:'debug',pane:'debug',title:'Run and Debug (Ctrl+Shift+D)'},{ic:'test',pane:'test',title:'Testing'},{ic:'ext',pane:'ext',title:'Extensions (Ctrl+Shift+X)'},
   {ic:'sparkle',pane:'codev',title:'Co-Dev (Ctrl+Shift+A)',acc:1,sep:1},{ic:'tasks',pane:'tasks',title:'Tasks (Ctrl+Shift+T)'},{ic:'kanban',run:()=>openProject(),title:'Project'},{ic:'cube',run:openStudio,title:'Studio'},{ic:'container',pane:'infra',title:'Infra and environments'},{ic:'book',pane:'tutor',title:'Learning Track'},{ic:'settings',pane:'settings',title:'Settings (Ctrl+,)',spacer:1});buildActivity();
  ['debug','ext','tasks'].forEach(p=>{if(!$('#pane-'+p))$('.side')!.insertAdjacentHTML('beforeend',`<div class="pane" id="pane-${p}"></div>`);});const a=$(`.act[data-pane="${PANE}"]`);if(a)a.classList.add('on');
  $('.panel-tabs .panel-tools')!.insertAdjacentHTML('beforebegin','<button class="ptab" data-pt="dbg">Debug assistant</button>');$('.panel-body')!.insertAdjacentHTML('beforeend','<div class="pcontent" id="pc-dbg"></div>');$$('.ptab').forEach(b=>b.onclick=()=>{setPanelTab(b.dataset.pt!);if(b.dataset.pt==='dbg')drawDbg();});drawDbg();
  $('#st-lang')!.insertAdjacentHTML('beforebegin','<span class="si opt" id="st-chord" style="color:var(--accent-hover)"></span>');
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items=[{l:'Start Debugging',k:'F5',act:()=>startDebug()},{l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1},{l:'Step Over',k:'F10',act:dbgStep},{l:'Step Into',k:'F11',act:()=>dbgStepInto()},{l:'Stop Debugging',k:'Shift+F5',act:dbgStop},{l:'Toggle Breakpoint',k:'F9',act:()=>{const t=tabOf(cur),ta=$('#ed-ta') as HTMLTextAreaElement|null;if(t&&t.path&&ta)toggleBp(t.path,ta.value.slice(0,ta.selectionStart).split('\n').length);}},{sep:1},{l:'⎈ Deploy to Kubernetes',act:dxDeploy},{l:'Environments and promotion',act:openEnvs},{sep:1},{l:'Run Project…',act:()=>goPane('run')},{l:'Run Tests',act:()=>goPane('test')}];
  const cm=MENUS.find(m=>m.t==='Co-Dev');if(cm){const ds=Object.getOwnPropertyDescriptor(cm,'items'),its=()=>ds!.get?ds!.get.call(cm):ds!.value;Object.defineProperty(cm,'items',{configurable:true,get:()=>[{l:'Explain',k:'Ctrl+K E',act:()=>explainCmd()},{l:'Code Review',k:'Ctrl+K R',act:reviewCmd},{l:'Debug',k:'F5',act:()=>startDebug()},{l:'Under the Hood',k:'Ctrl+K U',act:hoodCmd},{sep:1},...its()]});}
  const vm=MENUS.find(m=>m.t==='View');if(vm){const ds=Object.getOwnPropertyDescriptor(vm,'items'),g=()=>ds!.get?ds!.get.call(vm):ds!.value;Object.defineProperty(vm,'items',{configurable:true,get:()=>[...g(),{sep:1},{l:'Tasks',k:'Ctrl+Shift+T',act:()=>goPane('tasks')},{l:'Run and Debug',k:'Ctrl+Shift+D',act:()=>goPane('debug')},{l:'Extensions',k:'Ctrl+Shift+X',act:()=>goPane('ext')},{l:'Debug assistant',act:()=>setPanelTab('dbg')}]});}
  $('#menubar')!.innerHTML='';buildMenubar();
  CMD.push(['Co-Dev: Explain','Ctrl+K E',()=>explainCmd()],['Co-Dev: Code Review','Ctrl+K R',reviewCmd],['Co-Dev: Under the Hood','Ctrl+K U',hoodCmd],['Debug: Start Debugging','F5',()=>startDebug()],['Debug: Step Over','F10',dbgStep],['Debug: Stop','Shift+F5',dbgStop],['Debug: Toggle Breakpoint','F9',()=>{const t=tabOf(cur),ta=$('#ed-ta') as HTMLTextAreaElement|null;if(t&&t.path&&ta)toggleBp(t.path,ta.value.slice(0,ta.selectionStart).split('\n').length);}],
   ['View: Tasks','Ctrl+Shift+T',()=>goPane('tasks')],['View: Run and Debug','Ctrl+Shift+D',()=>goPane('debug')],['View: Extensions','Ctrl+Shift+X',()=>goPane('ext')],['Extensions: Install from VSIX…','',()=>{goPane('ext');$('#vsix-in')!.click();}],['Environments: Open','',openEnvs],['Environments: Promote Local → Staging','',()=>promote('staging')],['Environments: Promote Staging → Production','',()=>promote('production')],['Studio: Compare design with Local','',()=>{DRIFT='local';openStudio();}],['Project: System architecture','',openArch],['Co-Dev: Run, checkpoints and permissions','',openCodevRun],['Project: Board','',()=>openProject('board')],['Project: Backlog','',()=>openProject('backlog')],['Project: Reports','',()=>openProject('reports')]);
  CMD.forEach(c=>{if(c[0]==='Project: RUN the whole stack')c[1]='Ctrl+F5';});window.vsxCmds();refresh(false,true);show(cur);badges();}

Object.assign(window, { PANE, boot, boot3, boot4, boot5, boot6 });
