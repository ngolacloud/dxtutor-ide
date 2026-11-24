// @ts-nocheck
/* ═════════ dxtutor IDE — app (monólito navegável) ═════════
   Fase 4 da componentização: terceiro módulo TypeScript do ui-app, servido como
   <script type="module"> depois do boot.js clássico e ANTES do bridge.ts/pair.ts.
   Era a origem das globais de script; agora é módulo e publica-as no window (bloco
   Object.assign no fim + window.* nas mutáveis partilhadas). @ts-nocheck: tipar a
   sério fica para fase posterior — esta fase só componentiza. */
export {};
import { jsa } from "./core";
import { bus } from "./app/bus";

/* O seed de demonstração (SEED.base) só é carregado quando a build foi feita com
   VITE_SEED=1 — i.e. `npm run dev:seed`. O `npm run dev` arranca com o workspace
   vazio. Ponto único de decisão: lido aqui e respeitado por loadSeed(). */
/* SEED/SEED_ON, LS, writeFile, loadSeed, save/loadCfg e use/connected migrados (ADR-0004, U4f): features/workspace.ts, app/store/{storage,config,agent}.ts. */

/* COURSES (conteúdo dos cursos) migrado p/ features/learn.ts */
/* ═════════ dxtutor IDE v2 — núcleo do IDE ═════════ */
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const hhmm=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes());};
const setVar=(k,v)=>document.body.style.setProperty(k,v);
const getVar=k=>getComputedStyle(document.body).getPropertyValue(k).trim();
function hydrate(){$$('[data-ic]').forEach(el=>{if(el.dataset.done)return;el.insertAdjacentHTML('afterbegin',svg(el.dataset.ic));el.dataset.done=1;});}

/* ───── sistema de ficheiros virtual ───── */
const ROOT='dxtutor/',FS={},OPEN=new Set(['dxtutor','dxtutor/crates','dxtutor/crates/lexer','dxtutor/crates/lexer/src','dxtutor/desktop','dxtutor/desktop/src']),SECOPEN={};
/* estado git/scm (STAGED/BRANCH/COMMIT_MSG/BRANCHES/COMMITS/AUTHOR/GSEL) migrado p/ features/scm.ts; lido aqui por global */
const extOf=p=>(p.includes('.')?p.split('.').pop():'').toLowerCase();
const LANG={rs:'Rust',ts:'TypeScript',css:'CSS',json:'JSON',toml:'TOML',md:'Markdown',sql:'SQL',html:'HTML'};
/* fIcon/syncTree (ícone por extensão, árvore a partir do FS) migrados p/ features/explorer.ts (ADR-0004, U4c). */
/* stOf/changes (estado da árvore de trabalho) migrados p/ features/scm.ts; lidos por global */
const short=p=>p.replace(ROOT,'');
const norm=p=>{p=String(p||'').replace(/^\.?\//,'');return p.startsWith(ROOT)?p:ROOT+p;};

/* ───── explorer ───── */
/* 8 funções (renderLevel/buildExplorer/markActive/collapseAll/symbols/drawOutline/newFile/newFolder) migradas p/ features/explorer.ts; lidas por global (window.*) aqui (refresh/show), em boot.ts e v6.ts (symbols) */
/* drawTimeline$dup0 morto removido (o drawTimeline vivo foi p/ features/scm.ts) */

/* ───── realce de sintaxe ───── */
/* KW + hlLine (realce de uma linha) migrados p/ features/syntax.ts; lidos por global (window.hlLine) em paintEd/diff/cat/outline e em v5.ts/v6.ts */

/* ───── diagnósticos, lint e testes (derivados do estado real dos ficheiros) ───── */
const P_LX=ROOT+'crates/lexer/src/lib.rs',P_REPO=ROOT+'crates/store/src/conversations.rs',P_MIG=ROOT+'db/migrations/0002_conversations.sql',P_TEST=ROOT+'crates/store/tests/conversations_test.rs',P_HIST=ROOT+'desktop/src/history.ts',P_ADR=ROOT+'.dxtutor/arquitectura/ADR-003-historico.md',P_STORE=ROOT+'crates/store/src/lib.rs';
/* motor has/lexBug/dsLint/diagnostics/runTests/drawProblems/nextProblem migrado p/ features/diagnostics.ts; lido por global (P_* ficam donas aqui) */

/* ───── separadores e vistas ───── */
window.cur=null;window.PANE='explorer';/* VIEW com dono em app/store/registry.ts (ADR-0004, U4g1) */
/* separadores do editor (tabOf/openTab/openPath/openFile/setActive/drawTabs/parkAgent/miniOff/show/closeTab/stepTab/tabIc) migrados p/ features/tabs.ts (ADR-0004, U4b); a lista TB tem dono em app/store/editor. */

/* editor: renderFileView/paintEd/gotoLine/stPos/stLang/edCmd/selText migrados p/ features/editor.ts; lidos por global, pane delega no shim abaixo */
VIEW.file=(t,host)=>window.renderFileView(t,host);

/* diff: diffLines/diffStat/openDiff + corpo de VIEW.diff migrados p/ features/diff.ts; lidos por global, pane delega no shim abaixo */
VIEW.diff=(t,host)=>window.renderDiffView(t,host);

/* ───── actualização global ───── */
let SIG='';
window.refresh = function(fromEd,force){const sig=Object.keys(FS).map(p=>p+stOf(p)).join('|');
  TB.filter(t=>t.kind==='file'&&!FS[t.path]).forEach(t=>{TB.splice(TB.indexOf(t),1);if(cur===t.id)cur=null;});
  if(sig!==SIG||force){SIG=sig;syncTree();buildExplorer();}
  drawProblems();badges();if(RP[PANE]&&PANE!=='search')RP[PANE]();hydrate();
  if(!fromEd){const t=tabOf(cur);if(!t)show(TB.length?TB[TB.length-1].id:null);else if(t.kind==='file'){const ta=$('#ed-ta'),top=$('#ebody').scrollTop;if(ta&&ta.value!==FS[t.path].content){ta.value=FS[t.path].content;}if(ta){paintEd(t.path);$('#ebody').scrollTop=top;}drawTabs();}else if(t.kind==='diff'||t.kind==='manager'){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}else drawTabs();}
  else if(tabOf(cur)&&tabOf(cur).kind==='file')paintEd(tabOf(cur).path);drawOutline();
  /* U3c (ADR-0004): o fim do refresh é o sinal «o workspace mudou» — quem reagia
     decorando o refresh (grafo/board, autosave do desktop, sync do PairCode) subscreve */
  bus.emit('workspace:changed',{fromEditor:!!fromEd,force:!!force});}
/* shell (badges/RP/sideOpen/setPane/goPane/toggleSide/togglePanel/hd/setPanelTab/buildActivity) migrada p/ features/shell.ts (ADR-0004, U4d1). */

/* ───── activity bar e painéis laterais ───── */

RP.search=()=>window.renderSearchPane();/* corpo + leaves doSearch/replaceAll migrados p/ features/search.ts; shim delega (lazy, no switch de pane) */

RP.scm=()=>{const el=$('#pane-scm'),ch=changes(),st=ch.filter(p=>STAGED.has(p)),un=ch.filter(p=>!STAGED.has(p));
  const row=(p,staged)=>`<div class="scm-row" onclick="openDiff(${jsa(p)})">${fIcon(p)}<span class="nm">${esc(p.split('/').pop())}</span><span class="pth">${esc(short(p).split('/').slice(0,-1).join('/'))}</span><span class="ra"><button title="Abrir ficheiro" onclick="event.stopPropagation();openPath(${jsa(p)})">↗</button><button title="Descartar alterações" onclick="event.stopPropagation();discard(${jsa(p)})">↶</button><button title="${staged?'Retirar do stage':'Stage'}" onclick="event.stopPropagation();stage(${jsa(p)})">${staged?'−':'+'}</button></span><span class="g ${stOf(p)}">${stOf(p)}</span></div>`;
  el.innerHTML=hd('Source Control',`<button title="Actualizar" onclick="refresh()">${svg('refresh')}</button>`)+`<div class="sections"><div class="scm-grp">dxtutor · ${esc(BRANCH)}<span class="cnt">${ch.length}</span></div>
    <input class="inp" id="scm-msg" placeholder="Mensagem de commit" value="${esc(COMMIT_MSG)}"><button class="btn" onclick="commit()">✓ Commit${st.length?' (staged)':''} em ${esc(BRANCH)}</button>
    ${st.length?`<div class="scm-grp">Staged<span class="cnt">${st.length}</span></div>`+st.map(p=>row(p,1)).join(''):''}
    <div class="scm-grp">Alterações<span class="cnt">${un.length}</span></div>${un.map(p=>row(p,0)).join('')||'<div class="sec-empty">Área de trabalho limpa.</div>'}
    <div class="scm-grp">Commits</div>${COMMITS.slice(0,6).map(c=>`<div class="s-hit" style="padding-left:12px;cursor:default"><span style="color:var(--accent-hover)">${c.h}</span><span>${esc(c.m)}</span></div>`).join('')}</div>`;
  const i=$('#scm-msg');i.oninput=()=>COMMIT_MSG=i.value;i.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))commit();};};
/* stage/discard + commit v2 (window.commit, botão) migrados p/ features/scm.ts; pickBranch$dup0 morto removido */

RP.run=()=>window.renderRunPane();/* corpo migrado p/ features/run.ts; shim delega (lazy, no switch de pane) */
function runTask(c){setPanelTab('terminal');return termExec(c);}
RP.test=()=>window.renderTestPane();/* corpo migrado p/ features/test.ts; shim delega (lazy, no switch de pane) */
/* RP.ext antigo (provedores de LLM) eliminado — código morto: o v6 sobrepunha-o ao carregar; o painel é da features/ext.ts (ADR-0004, U4g1). */
RP.remote=()=>window.renderRemotePane();/* corpo migrado p/ features/remote.ts; shim delega (lazy, no switch de pane) */
RP.account=()=>window.renderAccountPane();/* corpo migrado p/ features/account.ts; shim delega (lazy, no switch de pane) */
RP.codev=()=>window.renderCodevPane();/* base v3 + decoração v4 migradas p/ features/codev.ts; shim delega (lazy, no switch de pane) */

/* ───── painel inferior ───── */
function log(src,msg){const o=$('#pc-output');o.insertAdjacentHTML('beforeend',`<div>[${hhmm()}] <span class="r">${esc(src)}</span> ${esc(msg)}</div>`);o.scrollTop=o.scrollHeight;}

/* ───── terminal (comandos ligados ao estado real) ───── */
// promptHTML/newInput/termRefreshPrompt/termExec + o registo BASE XC (help/cat/git/cargo/
// npm/dx) migraram para src/features/terminal.ts (window-backed). A feature avalia ANTES
// de app.ts e publica window.XC COMPLETO; os decoradores abaixo (XC.git/_dx/XC.docker/
// XC.make/_dx4) e o de v5.ts resolvem `XC` como window.XC e sobrepõem/encadeiam o base.

/* ───── paleta de comandos / quick open ───── */
// PAL/PIDX/PITEMS/PAL_TEXT + palette/closePal/fuzzy/palDraw/palRun migraram para
// src/features/palette.ts (window-backed). O resíduo (boot/keydown abaixo) lê o
// estado e os handlers por window.PIDX/window.PITEMS/window.palDraw()/etc.

/* ───── temas ───── */
// THEMES/THEME/setTheme migrados para src/features/theme.ts (Fase 0 por feature);
// o residual (save/loadCfg/vistas/onclick) resolve-os via window (shim transitório).

/* ───── notificações ───── */
// NOTES/UNREAD/note/drawBell/toggleNotes migraram para src/features/notifications.ts
// (Fase 1). O residual (app.ts/v6.ts) emite via window.note e o sino via window.toggleNotes.

/* ═════════ dxtutor IDE v2 — Co-Dev ═════════ */
// cores em var(--token) do tema (theme.ts) em vez de hex fixo — mudam ao trocar de tema
const PROV={
  claude:{name:'Claude',vendor:'Anthropic',model:'claude-opus-5-5',ep:'https://api.anthropic.com',on:true,col:'var(--accent-hover)'},
  gemini:{name:'Gemini',vendor:'Google',model:'gemini-pro',ep:'https://generativelanguage.googleapis.com',on:true,col:'var(--blue)'},
  codex:{name:'Codex',vendor:'OpenAI',model:'gpt-codex',ep:'https://api.openai.com',on:true,col:'var(--green)'},
  ollama:{name:'Ollama',vendor:'local',model:'qwen2.5-coder:14b',ep:'http://localhost:11434',on:true,local:true,col:'var(--purple)'},
};
/* ROLE/ROLE_D/ROUTE/MODES/CRIT/MISSIONS/DECS/CKPT + SPEED/MID: motor Co-Dev migrado p/ features/codev.ts (window-backed); aqui lê-se por global. */
window.MODE='assist';window.ACTIVE='claude';window.THRESH=85;window.CTX_ON=true;window.SAMPLE=null;
const CHAT=[];/* USAGE com dono no agentStore (ADR-0004, U4f) */
const COMMITS0=COMMITS.slice();
const RUN={active:false,paused:false,stop:false,pend:null,abort:null,label:'',t0:0};
const STOP='__STOP__',SAFE=/^(cargo (test|build|clippy)|dx lint|npm run lint)/,DANGER=/git push|rm -rf|drop table|--force/i;
const provFor=r=>PROV[ROUTE[r]].on?ROUTE[r]:(connected()[0]||ROUTE[r]);
const who=r=>`${ROLE[r].split(' ')[0].toLowerCase()} · ${PROV[provFor(r)].name.toLowerCase()}`;
window.provState=k=>k==='claude'?(SAMPLE?'ao vivo':'ao vivo indisponível aqui'):PROV[k].local?'local · simulado':'simulado';

/* checkpoints: checkpoint$dup0/restoreCkpt$dup0/resetAll$dup0 (duplicados mortos) removidos; o checkpoint git-aware vivo está na secção git (~629). */

/* interface do agente + controlo de execução + ferramentas do agente: motor migrado p/ features/codev.ts (window-backed). Fica aqui só setPanelTab (infra do painel inferior, partilhado por boot/debug/infra/pair). */

/* cenários de demonstração (G/lxStep/SCN/demo): migrados p/ features/codev.ts (SCN lazy, window.demo). */

/* motor de missões (dec/decideQ/total/council/execSteps/evaluate/reflect/runMission): migrado p/ features/codev.ts. */

/* conversa livre (handlePrompt/agSend/liveChat) + posicionamento (assistantCenter/Dock/toggleAgent/toggleAgentOn/focusAgent): migrados p/ features/codev.ts.
   VIEW.agent fica como shim: */
VIEW.agent=(t,host)=>window.renderAgentView(t,host);
/* páginas Co-Dev (welcome/settings/manager/analysis + openSettings/openManager/openAnalysis/testProv + POLICY/GAPS/NEXT): migradas p/ features/codev.ts.
   Os VIEW.* ficam shims: */
/* VIEW.welcome: dono features/welcome.ts (ADR-0004, U4g7). */
VIEW.settings=(t,host)=>window.renderSettingsPage(t,host);
VIEW.manager=(t,host)=>window.renderManagerPage(t,host);
VIEW.analysis=(t,host)=>window.renderChangelogPage(t,host);/* harvest ui-next: timeline git real (features/changelog.ts) no lugar da página estática */
/* ───── menus e comandos ───── */
const CMD=[
  ['Ir para ficheiro…','Ctrl+P',()=>palette('')],['Mostrar todos os comandos','Ctrl+Shift+P',()=>palette('>')],['Ir para a linha…','Ctrl+G',()=>palette(':')],['Ir para o próximo problema','F8',()=>nextProblem()],
  ['Ficheiro: Novo ficheiro…','',newFile],['Ficheiro: Nova pasta…','',newFolder],
  ['Ver: Explorer','Ctrl+Shift+E',()=>goPane('explorer')],['Ver: Pesquisa','Ctrl+Shift+F',()=>{goPane('search');$('#s-q').focus();}],['Ver: Source Control','Ctrl+Shift+G',()=>goPane('scm')],['Ver: Run and Debug','',()=>goPane('run')],['Ver: Testing','',()=>goPane('test')],['Ver: Extensions','',()=>goPane('ext')],
  ['Ver: Alternar barra lateral','Ctrl+B',toggleSide],['Ver: Alternar painel','Ctrl+J',togglePanel],['Ver: Terminal','Ctrl+`',()=>setPanelTab('terminal')],['Ver: Problemas','Ctrl+Shift+M',()=>setPanelTab('problems')],['Ver: Output do Co-Dev','',()=>setPanelTab('output')],
  ['Co-Dev: Focar a conversa','Ctrl+L',()=>focusAgent()],['Co-Dev: Abrir no centro','',()=>assistantCenter()],['Co-Dev: Painel de conhecimento','Ctrl+Shift+A',()=>goPane('codev')],['Co-Dev: Gestor de missões','',()=>openManager()],['Co-Dev: Nova conversa','',()=>newChat()],['Co-Dev: Escolher modelo…','',()=>pickModel()],
  ['Co-Dev: Modo Manual','',()=>setMode('manual')],['Co-Dev: Modo Assistido','',()=>setMode('assist')],['Co-Dev: Modo Auto','',()=>setMode('auto')],
  ['Co-Dev: Missão — histórico de conversas','',()=>demo('b')],['Co-Dev: Missão — corrigir E0382','',()=>demo('a')],['Co-Dev: Parar execução','',()=>agCtl('stop')],['Co-Dev: Restaurar último checkpoint','',()=>CKPT.length?restoreCkpt(CKPT[0].id):toast('Sem checkpoints')],
  ['Git: Commit…','',()=>{goPane('scm');$('#scm-msg').focus();}],['Git: Mudar de ramo…','',pickBranch],
  ['Tarefa: cargo test','',()=>runTask('cargo test')],['Tarefa: cargo build','',()=>runTask('cargo build')],['Tarefa: dx lint','',()=>runTask('dx lint')],
  ['Preferências: Definições','Ctrl+,',()=>openSettings()],...Object.keys(THEMES).map(n=>['Preferências: Tema — '+n,'',()=>setTheme(n)]),
  ['Ajuda: Bem-vindo','',()=>openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'})],['Ajuda: O que mudou e porquê','',()=>openAnalysis()],['Repor protótipo (estado inicial)','',resetAll]];
const cmd=l=>()=>CMD.find(c=>c[0]===l)[2]();
function buildMenus(){MENUS.length=0;MENUS.push(
  {t:'File',get items(){return[{l:'Novo ficheiro…',act:newFile},{l:'Nova pasta…',act:newFolder},{sep:1},{l:'Abrir ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Abrir recente',sub:Object.keys(FS).filter(p=>/\.(rs|ts|sql)$/.test(p)).slice(0,6).map(p=>({l:short(p),act:()=>openPath(p)}))},{sep:1},{l:'Guardar',k:'Ctrl+S',act:()=>toast('Auto Save activo — já está guardado')},{sep:1},{l:'Preferências',sub:[{l:'Definições',k:'Ctrl+,',act:openSettings},{l:'Tema',sub:Object.keys(THEMES).map(n=>({l:n,on:n===THEME,act:()=>setTheme(n)}))}]},{sep:1},{l:'Fechar separador',act:()=>cur&&closeTab(cur)},{l:'Repor protótipo',act:resetAll}];}},
  {t:'Edit',items:[{l:'Anular',k:'Ctrl+Z',act:()=>edCmd('undo')},{l:'Refazer',k:'Ctrl+Y',act:()=>edCmd('redo')},{sep:1},{l:'Procurar nos ficheiros',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Substituir nos ficheiros',act:()=>{goPane('search');$('#s-r').focus();}}]},
  {t:'Selection',items:[{l:'Seleccionar tudo',k:'Ctrl+A',act:()=>edCmd('selectAll')},{l:'Seleccionar linha',act:()=>edCmd('line')},{sep:1},{l:'Enviar selecção ao Co-Dev',act:()=>{const s=selText();if(!s){toast('Selecciona texto no editor primeiro');return;}focusAgent();const i=$('#ag-input');i.value='Sobre este excerto:\n'+s+'\n\n';i.focus();}}]},
  {t:'View',get items(){return[{l:'Paleta de comandos…',k:'Ctrl+Shift+P',act:()=>palette('>')},{sep:1},{l:'Explorer',k:'Ctrl+Shift+E',act:()=>goPane('explorer')},{l:'Pesquisa',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Source Control',k:'Ctrl+Shift+G',act:()=>goPane('scm')},{l:'Testing',act:()=>goPane('test')},{l:'Co-Dev',k:'Ctrl+Shift+A',act:()=>goPane('codev')},{sep:1},{l:'Barra lateral',k:'Ctrl+B',on:sideOpen(),act:toggleSide},{l:'Painel inferior',k:'Ctrl+J',on:getVar('--panel-h')!=='0px',act:togglePanel},{l:'Painel do Co-Dev',on:getVar('--agent-w')!=='0px'||!!tabOf('agent'),act:toggleAgent},{sep:1},{l:'Terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Problemas',k:'Ctrl+Shift+M',act:()=>setPanelTab('problems')},{l:'Output do Co-Dev',act:()=>setPanelTab('output')}];}},
  {t:'Go',items:[{l:'Ir para ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Ir para a linha…',k:'Ctrl+G',act:()=>palette(':')},{l:'Próximo problema',k:'F8',act:()=>nextProblem()},{sep:1},{l:'Separador seguinte',act:()=>stepTab(1)},{l:'Separador anterior',act:()=>stepTab(-1)}]},
  {t:'Run',items:[{l:'cargo build',act:()=>runTask('cargo build')},{l:'cargo test',act:()=>runTask('cargo test')},{l:'dx lint',act:()=>runTask('dx lint')},{l:'npm run dev',act:()=>runTask('npm run dev')}]},
  {t:'Co-Dev',get items(){return[{l:'Focar a conversa',k:'Ctrl+L',act:()=>focusAgent()},{l:'Nova conversa',act:newChat},{l:'Escolher modelo…',act:pickModel},{sep:1},...Object.entries(MODES).map(([k,m])=>({l:'Modo '+m.l,on:k===MODE,act:()=>setMode(k)})),{sep:1},{l:'Missões de demonstração',sub:[{l:'Histórico de conversas persistente',act:()=>demo('b')},{l:'Corrigir o E0382 em lib.rs',act:()=>demo('a')}]},{l:'Gestor de missões',act:openManager},{l:'Conhecimento do projecto',act:()=>goPane('codev')},{l:'Definições do Co-Dev',act:openSettings}];}},
  {t:'Terminal',items:[{l:'Mostrar terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Limpar',act:()=>termClear()}]},
  {t:'Help',items:[{l:'Bem-vindo',act:cmd('Ajuda: Bem-vindo')},{l:'O que mudou e porquê',act:openAnalysis},{l:'Atalhos de teclado',act:openSettings},{sep:1},{l:'Sobre',act:()=>toast('dxtutor IDE · protótipo v2')}]});}

/* ───── arranque ───── */
function boot(){loadCfg();loadSeed();syncTree();
  ACTS.length=0;ACTS.push({ic:'explorer',pane:'explorer',title:'Explorer'},{ic:'search',pane:'search',title:'Pesquisa'},{ic:'scm',pane:'scm',title:'Source Control'},{ic:'run',pane:'run',title:'Run and Debug'},{ic:'test',pane:'test',title:'Testing'},{ic:'ext',pane:'ext',title:'Extensions'},{ic:'sparkle',pane:'codev',title:'Co-Dev',acc:1},{ic:'dots',overflow:1,title:'Mais vistas…',spacer:1},{ic:'account',pane:'account',title:'Conta'},{ic:'settings',pane:'settings',title:'Definições'});
  OVERFLOW.length=0;OVERFLOW.push({l:'Remote Explorer',pane:'remote'},{l:'Containers',pane:'containers'});
  $('#brand').innerHTML=svg('sparkle');buildMenus();buildMenubar();buildActivity();buildDocker();$('.act').classList.add('on');
  $$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt));
  mkRz($('#rsz-side'),'--side-w',250,170,460);mkRz($('#rsz-agent'),'--agent-w',380,300,640,true);
  const pi=$('#pal-in');pi.oninput=()=>{window.PIDX=0;window.palDraw();};pi.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();window.PIDX=Math.min(window.PITEMS.length-1,window.PIDX+1);window.palDraw();}else if(e.key==='ArrowUp'){e.preventDefault();window.PIDX=Math.max(0,window.PIDX-1);window.palDraw();}else if(e.key==='Enter'){e.preventDefault();window.palRun(window.PIDX);}};
  $('#pal').onclick=e=>{const it=e.target.closest('.pi');if(it)window.palRun(+it.dataset.i);else if(!e.target.closest('.pal-box'))window.closePal();};
  /* teclado do #ag-input: dono agora o compositor (features/codev/ui/composer.ts) */
  $('#pc-terminal').onclick=()=>{if(!String(getSelection())){const c=$('#cmd');if(c)c.focus({preventScroll:true});}};
  $('#pc-output').innerHTML='';log('rust-analyzer','2 crates indexados');log('co-dev','pronto · '+connected().length+' provedores ligados');
  termClear();setInterval(()=>{runLabel();},1000);
  newChat();setTheme(THEME);
  TB=[{id:'welcome',title:'Bem-vindo',kind:'welcome'},{id:P_LX,title:'lib.rs',kind:'file',path:P_LX}];refresh(false,true);show('welcome');
  if(innerWidth<1000){setVar('--side-w','0px');}else $('#tgl-side').classList.add('on');$('#tgl-panel').classList.add('on');
  if(innerWidth<860){setVar('--panel-h','0px');$('#tgl-panel').classList.remove('on');assistantCenter();}
  hydrate();if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  let tries=0;(function live(){if(window.claude&&typeof window.claude.use==='function'){window.claude.use('sample').then(s=>{SAMPLE=s||null;updateAgentUI();const t=tabOf(cur);if(t&&t.kind==='settings')show(cur);if(RP[PANE])RP[PANE]();}).catch(()=>{});}else if(++tries<25)setTimeout(live,300);})();}
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey,go=f=>{e.preventDefault();f();};
  if(window.termOwnsKey&&window.termOwnsKey(e))return;/* foco num terminal real (features/panel): a tecla é da shell */
  if(e.key==='Escape'){if($('#pal').classList.contains('show'))window.closePal();closeMenus();$('#notes').classList.remove('show');return;}
  if(e.key==='F1'||(c&&e.shiftKey&&k==='p'))go(()=>palette('>'));else if(e.key==='F8')go(nextProblem);
  else if(c&&e.shiftKey){if(k==='e')go(()=>goPane('explorer'));else if(k==='f')go(cmd('Ver: Pesquisa'));else if(k==='g')go(()=>goPane('scm'));else if(k==='m')go(()=>setPanelTab('problems'));else if(k==='a')go(()=>goPane('codev'));}
  else if(c){if(k==='p')go(()=>palette(''));else if(k==='b')go(toggleSide);else if(k==='j')go(togglePanel);else if(k==='`')go(()=>setPanelTab('terminal'));else if(k===',')go(openSettings);else if(k==='l')go(()=>focusAgent());else if(k==='g')go(()=>palette(':'));else if(k==='s')go(()=>toast('Auto Save activo — já está guardado'));}
},true);
document.addEventListener('click',e=>{if(!e.target.closest('#notes')&&!e.target.closest('#st-bell'))$('#notes').classList.remove('show');});

/* ═════════ dxtutor IDE v3 — git em grafo, gitflow, equipa com harness, router de modelos, Studio, backlog/kanban, Tutor ═════════ */
const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pascal=s=>slug(s).split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join('');
const rel=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'agora':m<60?`há ${m} min`:m<1440?`há ${Math.round(m/60)} h`:`há ${Math.round(m/1440)} d`;};
const rid=()=>Math.random().toString(16).slice(2,9);
function rerender(kind){const t=tabOf(cur);if(t&&t.kind===kind){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}}

/* ───── git: motor (GIT/LANE/gitInit + DAG/merge/gitflow/graphLayout) migrado p/ features/scm.ts; checkpoint/restoreCkpt/gfAsk migrados p/ features/checkpoint.ts; aqui só consumidor (loadSeed) que lê por global ───── */
/* authorOf + AUTHOR + commit v4 (window.commitGit) migrados p/ features/scm.ts; lidos por global (AUTHOR é window-puro, escrito aqui em runIssue/co-dev) */
/* checkout/gitMerge/isFlow/gfStart/gfFinish/gfPrompt/gfGuide/pickBranch/drawTimeline migrados p/ features/scm.ts; lidos por global */
RP.scm=()=>window.renderScmPane();/* corpo v4 migrado p/ features/scm.ts; shim delega (lazy, no switch de pane) */
/* graphLayout/openGraph migrados p/ features/scm.ts; VIEW.graph (abaixo) consome-os por global */
VIEW.graph=(t,host)=>window.renderGraphView(t,host);/* corpo (DAG de commits) migrado p/ features/graph.ts; shim delega (registo de kinds de tab) */
/* corpo (sub-comandos status/add/commit/log/branch/checkout/merge/flow/diff/push) migrado p/ features/termgit.ts; shim delega (registo XC de features/terminal.ts) */
XC.git=(a,raw)=>window.gitCmd(a,raw);
/* checkpoint/restoreCkpt/gfAsk migrados p/ features/checkpoint.ts (strict, window-backed); aqui lidos por global (CMD acima, codev.ts). */

/* ───── equipa: motor (AGENTS/globRe/inScope/canRun/ownerOf/harnessCheck/harnessCmd/agentSys/
   saveTeam/loadTeam/pickAgent/agentPill/scopeProbe + VIEW.team) migrado p/ features/team.ts
   (inversão @ts-nocheck, window-backed). Aqui ficam: openTeam (abrir tab — $dup0; versão viva
   em v5.ts), a decoração Object.assign(AGENTS.*) abaixo, e o shim VIEW.team que v5/v6 decoram. ───── */
/* VIEW.team registado (composto) pela própria features/team.ts (ADR-0004, U4g4). */

/* ───── router: motor (CAPL/CAP/TASKP/ROUTE_CACHE/LIVE_OK/rankModels/routeModel) migrado p/ features/router.ts; aqui só consumidores (VIEW.team, genBacklog, runIssue) que lêem por global ───── */

/* ───── Studio: estado + motor de desenho (NT/ST_SEED/SD/SSEL/SLINK/SCAT/NW/NH/saveSD/openStudio/sdAdd/sdDel/drawStudio) migrado p/ features/studio.ts ───── */

/* ───── backlog, sprints e kanban: estado (BL/STAGES) + motor (mkIssue/setStage/
   runIssue/delegate/runSprint/approveIssue/autoTest/dropIssue/rejectIssue/newIssue/
   openBoard) + produtor (genBacklog/genBacklogIssues) migrados p/ features/board.ts;
   tplNode + genBacklog$dup0 (código morto) eliminados. Aqui só o shim de VIEW.board
   (eager; v5/v6 decoram-no) e os decoradores/consumidores que lêem por global. ───── */
/* VIEW.board registado (composto) pela própria features/board.ts (ADR-0004, U4g3). */

/* ───── Tutor (clássico): percursos LEARN/LP/lesson·/VIEW.learn/RP.tutor(v4) ELIMINADOS —
   código morto substituído pelo Learning Track (features/learn.ts + features/tutor.ts).
   Ficam só LF (fachada window.LF lida por learn.ts) e LCUR (fallback dos call-sites vivos). ───── */
const LF=p=>ROOT+'learn/'+p;/* fachada viva: features/learn.ts lê window.LF (ltPath, lazy) */
let LCUR=['rust','own'];/* fallback constante dos call-sites vivos (welcome/CMD/MENUS): nextLesson()||LCUR */

/* ───── integração com o resto do IDE ───── */
function resetAll(){if(RUN.active){toast('Pára a execução primeiro');return;}loadSeed();MISSIONS.length=0;DECS.length=0;CKPT.length=0;CHAT.length=0;BL.issues.length=0;BL.seq=11;BL.mig=3;BL.adr=4;SD=JSON.parse(JSON.stringify(ST_SEED));saveSD();TB=[];newChat();refresh(false,true);openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'});toast('Protótipo reposto ao estado inicial');}
bus.on('workspace:changed',({fromEditor:a})=>{if(!a){const t=tabOf(cur);if(t&&(t.kind==='graph'||t.kind==='board')){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}}blame();});
const _stLang=window.stLang;window.stLang=function(){_stLang();blame();};
function blame(){const el=$('#st-blame'),t=tabOf(cur);if(!el)return;if(!t||!t.path||t.kind!=='file'){el.textContent='';return;}const h=GIT.order.find(x=>GIT.c[x]&&GIT.c[x].files.includes(t.path)),c=h?GIT.c[h]:GIT.c['1a2b3c4'];if(!c){/* desktop: syncGit reconstrói GIT.c com hashes reais e files:[], logo '1a2b3c4' (semente do protótipo) não existe — sem crash, só o estado local */el.textContent=stOf(t.path)?'Tu · alterações por commitar':'';el.onclick=null;return;}el.textContent=stOf(t.path)?'Tu · alterações por commitar':`${authorOf(c.a).n}, ${rel(c.t)} · ${c.m.slice(0,38)}`;el.onclick=()=>openGraph(c.h);}
/* decoração v4 do pane Co-Dev (Equipa/Backlog/Studio) migrada e dobrada em features/codev.ts */
const _dx=XC.dx;XC.dx=(a)=>{if(a[0]==='test'&&a[1]){const it=BL.issues.find(i=>i.id.toLowerCase()===a[1].toLowerCase());if(!it){echo('<span class="er">issue desconhecida</span>');return;}dropIssue(it.id,'test');return;}if(a[0]==='sprint'){runSprint((+a[1]||1)-1);return;}return _dx(a);};
/* (página de boas-vindas desta camada: código morto — sobreposta antes de ser chamada; ADR-0004, U4g7) */
GAPS.push(['Grafo de commits e ramos','GitLens','Lista plana de commits','Feito: DAG com faixas por ramo, merges, tags, autor por commit, detalhe de ficheiros'],['Gitflow guiado','GitLens / git-flow','Não existia','Feito: cada tarefa abre um ramo e fecha com merge em develop; releases ficam com o humano'],['Vários assistentes com harness','Claude Code (subagentes)','Um só assistente','Feito: 8 papéis; caminhos, comandos e limite de ficheiros aplicados em cada ferramenta'],['Router de modelos','—','Routing fixo','Feito: o assistente descreve a tarefa e recebe o modelo mais adequado'],['Studio de arquitectura','projecto original','Só no histórico de commits','Feito: canvas editável que gera backlog e sprints'],['Backlog, sprints e kanban','Jira / Linear','Não existia','Feito: teste automático ao entrar em Teste; só o que passa chega à validação funcional'],['Tutor','projecto original','Não existia','Feito: percursos, exercícios verificados no editor, pistas graduais, lições a partir dos erros']);
CMD.push(['Projecto: Studio de arquitectura','',openStudio],['Projecto: Quadro (kanban)','',openBoard],['Projecto: Gerar backlog a partir do Studio','',genBacklog],['Projecto: Executar Sprint 1','',()=>runSprint(0)],['Projecto: Executar Sprint 2','',()=>runSprint(1)],['Projecto: Nova issue…','',newIssue],['Equipa: Assistentes e harness','',()=>openTeam()],['Equipa: Escolher assistente da conversa…','',pickAgent],
  ['Git: Grafo de commits','',()=>openGraph()],['Gitflow: Iniciar feature…','',()=>gfPrompt('feature')],['Gitflow: Iniciar fix…','',()=>gfPrompt('fix')],['Gitflow: Iniciar release…','',()=>gfPrompt('release')],['Gitflow: Finalizar ramo actual','',()=>gfFinish()?toast('Ramo finalizado'):toast('Não estás num ramo de gitflow')],['Tutor: Continuar a aprender','',()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}]);
function boot3(){loadTeam();const sd=LS.get('studio3',null);if(sd&&Array.isArray(sd.nodes)&&Array.isArray(sd.edges))SD=sd;
  const i=ACTS.findIndex(a=>a.pane==='codev');ACTS.splice(i+1,0,{ic:'book',pane:'tutor',title:'Tutor'},{ic:'cube',run:openStudio,title:'Studio de arquitectura'},{ic:'split',run:openBoard,title:'Quadro'});ACTS[i].sep=1;buildActivity();$('.act').classList.add('on');
  $('.side').insertAdjacentHTML('beforeend','<div class="pane" id="pane-tutor"></div>');
  /* o #pill-agent nasce no compositor (features/codev/ui/composer.ts); só se cria aqui se faltar */
  if(!$('#pill-agent'))$('.comp-bar').insertAdjacentHTML('afterbegin','<button class="pill" id="pill-agent" title="Assistente da conversa" onclick="pickAgent()"></button>');agentPill();
  $('#st-lang').insertAdjacentHTML('beforebegin','<button class="si opt" id="st-blame" title="Último commit que tocou neste ficheiro"></button>');
  MENUS.splice(7,0,{t:'Projecto',items:[{l:'Studio de arquitectura',act:openStudio},{l:'Quadro (kanban)',act:openBoard},{l:'Gerar backlog a partir do Studio',act:genBacklog},{sep:1},{l:'Equipa e harness',act:()=>openTeam()},{l:'Grafo de commits',act:()=>openGraph()},{l:'Gitflow',sub:[{l:'Iniciar feature…',act:()=>gfPrompt('feature')},{l:'Iniciar fix…',act:()=>gfPrompt('fix')},{l:'Iniciar release…',act:()=>gfPrompt('release')},{l:'Finalizar ramo actual',act:()=>gfFinish()}]},{sep:1},{l:'Tutor',act:()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}}]});$('#menubar').innerHTML='';buildMenubar();
  refresh(false,true);show(cur);badges();}

/* ═════════ dxtutor IDE v4 — Learning Track (real course content), cloud Studio, generated artefacts, RUN ═════════ */
function mdFull(s){const out=[],inl=x=>esc(x).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>');
  String(s||'').split(/```/).forEach((p,i)=>{if(i%2){out.push(`<pre>${esc(p.replace(/^[a-z]*\n/,'').replace(/\n$/,''))}</pre>`);return;}
    p.split(/\n{2,}/).forEach(b=>{b=b.trim();if(!b)return;
      if(/^#{1,4}\s/.test(b)){const[h,...r]=b.split('\n');out.push(`<h3>${inl(h.replace(/^#+\s*/,''))}</h3>`);if(r.length)out.push(`<p>${inl(r.join(' '))}</p>`);}
      else if(/^\s*[-*]\s/.test(b))out.push('<ul>'+b.split(/\n(?=\s*[-*]\s)/).map(l=>`<li>${inl(l.replace(/^\s*[-*]\s+/,'').replace(/\n\s*/g,' '))}</li>`).join('')+'</ul>');
      else out.push(`<p>${inl(b.replace(/\n/g,' '))}</p>`);});});return out.join('');}

/* ───── Learning Track: COURSES + motor (LTS, course, ltUnits, drillState, ltRes, ltGo, ltAsk, onboarding) + corpo da vista migrados p/ features/learn.ts; aqui so os shims RP.tutor e VIEW.lt que delegam ───── */
RP.tutor=()=>window.renderTutorPane();/* corpo v4 (Learning Track) migrado p/ features/tutor.ts; shim delega (lazy, no switch de pane) */
VIEW.lt=(t,host)=>window.renderLtView(t,host);/* corpo migrado p/ features/learn.ts; visualizer.ts decora este VIEW.lt */

/* ───── Studio: catálogo cloud (CLOUD/TECH/KIND/mkT/isApp/sl/appDir) + validateDesign + corpo da vista migrados p/ features/studio.ts; aqui só consumidores (geradores, genBacklog, resetAll, boot) que lêem por global ───── */

/* ───── generators: migrados p/ features/generators.ts (inversão @ts-nocheck, window-backed);
   composeYaml/dockerfile/appFiles/k8sYaml/cloudMap lidos por global por features/board.ts ───── */
/* genBacklog/genBacklogIssues (produtor Studio→backlog) migrados p/ features/board.ts;
   lêem os geradores (composeYaml/dockerfile/appFiles/k8sYaml/cloudMap, em features/generators.ts) por global. */
/* decoração de approveIssue (fecha componentes do Studio) composta em features/board.ts (ADR-0004, U4g3). */
Object.assign(AGENTS.be,{paths:['crates/**','apps/*/src/**','apps/*/Cargo.toml','apps/*/go.mod','apps/*/package.json','apps/*/requirements.txt'],max:8});Object.assign(AGENTS.fe,{paths:['desktop/src/**','web/**']});Object.assign(AGENTS.ops,{paths:['docker-compose.yml','.env.example','Makefile','apps/*/Dockerfile','deploy/**','.ci/**','Cargo.toml'],cmds:['cargo build','docker compose','make','git push'],max:12});Object.assign(AGENTS.qa,{cmds:['cargo test','dx lint','dx test','sh tests/smoke.sh']});

/* ───── RUN: one command for the whole stack ───── */
/* ───── RUN: motor (STACK/composeServices/dxRun/dxStop/drawStack) migrado p/ features/stack.ts (inversão @ts-nocheck, window-backed);
   aqui ficam só os consumidores XC.docker/make/dx (terminal) e o wiring de arranque boot4, que lêem dxRun/dxStop/STACK/drawStack por global ───── */
XC.docker=a=>{if(a[0]==='compose'&&a[1]==='up')return dxRun(true);if(a[0]==='compose'&&a[1]==='down'){dxStop(true);return;}if(a[0]==='compose'&&a[1]==='ps'){echo(STACK?STACK.map(s=>`${s.name.padEnd(20)} ${s.state.padEnd(9)} ${s.url}`).join('\n'):'<span class="dim">no containers</span>');return;}echo('<span class="dim">docker compose up | down | ps</span>');};
XC.make=a=>{if(a[0]==='run')return dxRun(true);if(a[0]==='stop'){dxStop(true);return;}echo('<span class="dim">make run | stop</span>');};
const _dx4=XC.dx;XC.dx=a=>{if(a[0]==='run')return dxRun(true);if(a[0]==='stop'){dxStop(true);return;}return _dx4(a);};

/* ───── wiring ───── */
/* (página de boas-vindas desta camada: código morto — sobreposta antes de ser chamada; ADR-0004, U4g7) */
const _settings=VIEW.settings;VIEW.settings=(t,host)=>{_settings(t,host);host.querySelector('.sub').insertAdjacentHTML('afterend',`<h2>Language</h2><div class="pgrid">${LOCALES.map(l=>`<button class="pcard${LOCALE===l[0]?' sel':''}" onclick="setLocale(${jsa(l[0])})"><div class="ph notr">${l[1]}${LOCALE===l[0]?'<span class="tag acc">✓</span>':''}</div><div class="pd">${l[2]}</div></button>`).join('')}</div>`);};
function boot4(){LANG.go='Go';const ci=CMD.findIndex(c=>c[0]==='Ajuda: O que mudou e porquê');if(ci>=0)CMD.splice(ci,1);
  CMD.push(['Learning Track: Continue','',ltResume],['Learning Track: Change language or level…','',()=>ltOnboard(1)],['Project: RUN the whole stack','Ctrl+F5',dxRun],['Project: Stop the stack','',dxStop],['Preferences: Language — English','',()=>setLocale('en')],['Preferences: Language — Português (Angola)','',()=>setLocale('ptAO')]);
  const hm=MENUS.find(m=>m.t==='Help');if(hm)hm.items=hm.items.filter(i=>i.l!=='O que mudou e porquê');const pm=MENUS.find(m=>m.t==='Projecto');if(pm){pm.t='Project';pm.items.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});const ti=pm.items.findIndex(i=>i.l==='Tutor');if(ti>=0)pm.items[ti]={l:'Learning Track',act:ltResume};}
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});$('#menubar').innerHTML='';buildMenubar();
  const ta=ACTS.find(a=>a.pane==='tutor');if(ta){ta.title='Learning Track';buildActivity();$('.act').classList.add('on');}
  $('.panel-tabs .panel-tools').insertAdjacentHTML('beforebegin','<button class="ptab" data-pt="services">Services</button>');$('.panel-body').insertAdjacentHTML('beforeend','<div class="pcontent" id="pc-services"></div>');$$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt));
  $('#st-tests').insertAdjacentHTML('afterend','<button class="si" id="st-stack" style="display:none;color:var(--green)" title="Running stack" onclick="setPanelTab(\'services\')"></button>');
  const sd=LS.get('studio3',null);SD=sd&&Array.isArray(sd.nodes)&&sd.nodes.every(n=>TECH[n.tech])?sd:JSON.parse(JSON.stringify(ST_SEED));
  drawStack();refresh(false,true);show(cur);}
/* boot5/boot6: os passos de arranque das camadas v5/v6 (ADR-0004, U4g7), verbatim, junto do
   boot/boot3/boot4 — a mesma natureza: ajustam ACTS/MENUS/CMD/LANG, que dissolvem quando cada
   feature registar os seus comandos. Os nomes livres resolvem como no módulo de origem: dos que
   o app.ts declara no topo, CMD/LANG são os mesmos objectos publicados (só mutados) e o runTask
   é o publicado (ninguém o reatribui). */
function boot5(){ENVS.rtOn=false;ENVS.k8sOn=false;if(MORD.indexOf(MODE)>MORD.indexOf(HARN.ceiling))MODE=HARN.ceiling;
  for(let i=ACTS.length-1;i>=0;i--)if(['run','ext','account'].includes(ACTS[i].pane)||ACTS[i].overflow)ACTS.splice(i,1);const bi=ACTS.findIndex(a=>a.title==='Quadro');ACTS.splice(bi+1,0,{ic:'container',pane:'infra',title:'Infra'});const st=ACTS.find(a=>a.pane==='settings');if(st)st.spacer=1;buildActivity();$('.act').classList.add('on');
  $('.side').insertAdjacentHTML('beforeend','<div class="pane" id="pane-infra"></div>');const tm=$('.tmux');if(tm)tm.remove();const ab=$('.tb-ic[data-ic="account"]');if(ab)ab.onclick=openSettings;
  const drop=['Selection','Go','Terminal'],ed=MENUS.find(m=>m.t==='Edit'),sel=MENUS.find(m=>m.t==='Selection'),go=MENUS.find(m=>m.t==='Go');if(ed&&sel&&go)ed.items.push({sep:1},...go.items.filter(i=>!i.sep).slice(0,3),{sep:1},...sel.items.filter(i=>!i.sep));
  for(let i=MENUS.length-1;i>=0;i--)if(drop.includes(MENUS[i].t))MENUS.splice(i,1);const pm=MENUS.find(m=>m.t==='Project');if(pm)pm.items.splice(2,0,{l:'⎈ Deploy to Kubernetes',act:dxDeploy},{l:'Attach project to a container',act:dcAttach},{l:'Infra: socket and KUBECONFIG',act:()=>goPane('infra')});$('#menubar').innerHTML='';buildMenubar();
  for(let i=CMD.length-1;i>=0;i--)if(/Run and Debug|Extensions/.test(CMD[i][0]))CMD.splice(i,1);
  CMD.push(['Project: Deploy to Kubernetes','',dxDeploy],['Infra: Connect container socket','',()=>{goPane('infra');if(!ENVS.rtOn)rtConnect();}],['Infra: Connect cluster (KUBECONFIG)','',()=>{goPane('infra');if(!ENVS.k8sOn)k8sConnect();}],['Infra: Attach project to a container','',dcAttach],...Object.entries(HT).map(([k,h])=>['Harness: Apply template — '+h.n,'',()=>{applyTemplate(k);openTeam();}]));
  const tt=tabOf('team');if(tt)tt.title='Team & harness';updateAgentUI();drawRemote();refresh(false,true);show(cur);}
function boot6(){Object.assign(LANG,{yaml:'YAML',yml:'YAML',jsx:'JavaScript JSX',js:'JavaScript',go:'Go',py:'Python',sh:'Shell'});ACTS.length=0;ACTS.push({ic:'explorer',pane:'explorer',title:'Explorer (Ctrl+Shift+E)'},{ic:'search',pane:'search',title:'Search (Ctrl+Shift+F)'},{ic:'scm',pane:'scm',title:'Source Control (Ctrl+Shift+G)'},{ic:'debug',pane:'debug',title:'Run and Debug (Ctrl+Shift+D)'},{ic:'test',pane:'test',title:'Testing'},{ic:'ext',pane:'ext',title:'Extensions (Ctrl+Shift+X)'},
   {ic:'sparkle',pane:'codev',title:'Co-Dev (Ctrl+Shift+A)',acc:1,sep:1},{ic:'tasks',pane:'tasks',title:'Tasks (Ctrl+Shift+T)'},{ic:'cube',run:openStudio,title:'Studio'},{ic:'container',pane:'infra',title:'Infra and environments'},{ic:'book',pane:'tutor',title:'Learning Track'},{ic:'settings',pane:'settings',title:'Settings (Ctrl+,)',spacer:1});buildActivity();
  ['debug','ext','tasks'].forEach(p=>{if(!$('#pane-'+p))$('.side').insertAdjacentHTML('beforeend',`<div class="pane" id="pane-${p}"></div>`);});const a=$(`.act[data-pane="${PANE}"]`);if(a)a.classList.add('on');
  $('.panel-tabs .panel-tools').insertAdjacentHTML('beforebegin','<button class="ptab" data-pt="dbg">Debug assistant</button>');$('.panel-body').insertAdjacentHTML('beforeend','<div class="pcontent" id="pc-dbg"></div>');$$('.ptab').forEach(b=>b.onclick=()=>{setPanelTab(b.dataset.pt);if(b.dataset.pt==='dbg')drawDbg();});drawDbg();
  $('#st-lang').insertAdjacentHTML('beforebegin','<span class="si opt" id="st-chord" style="color:var(--accent-hover)"></span>');
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items=[{l:'Start Debugging',k:'F5',act:()=>startDebug()},{l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1},{l:'Step Over',k:'F10',act:dbgStep},{l:'Stop Debugging',k:'Shift+F5',act:dbgStop},{l:'Toggle Breakpoint',k:'F9',act:()=>{const t=tabOf(cur),ta=$('#ed-ta');if(t&&t.path&&ta)toggleBp(t.path,ta.value.slice(0,ta.selectionStart).split('\n').length);}},{sep:1},{l:'⎈ Deploy to Kubernetes',act:dxDeploy},{l:'Environments and promotion',act:openEnvs},{sep:1},{l:'cargo test',act:()=>runTask('cargo test')},{l:'dx lint',act:()=>runTask('dx lint')}];
  const cm=MENUS.find(m=>m.t==='Co-Dev');if(cm){const ds=Object.getOwnPropertyDescriptor(cm,'items'),its=()=>ds.get?ds.get.call(cm):ds.value;Object.defineProperty(cm,'items',{configurable:true,get:()=>[{l:'Explain',k:'Ctrl+K E',act:()=>explainCmd()},{l:'Code Review',k:'Ctrl+K R',act:reviewCmd},{l:'Debug',k:'F5',act:()=>startDebug()},{l:'Under the Hood',k:'Ctrl+K U',act:hoodCmd},{sep:1},...its()]});}
  const vm=MENUS.find(m=>m.t==='View');if(vm){const ds=Object.getOwnPropertyDescriptor(vm,'items'),g=()=>ds.get?ds.get.call(vm):ds.value;Object.defineProperty(vm,'items',{configurable:true,get:()=>[...g(),{sep:1},{l:'Tasks',k:'Ctrl+Shift+T',act:()=>goPane('tasks')},{l:'Run and Debug',k:'Ctrl+Shift+D',act:()=>goPane('debug')},{l:'Extensions',k:'Ctrl+Shift+X',act:()=>goPane('ext')},{l:'Debug assistant',act:()=>setPanelTab('dbg')}]});}
  $('#menubar').innerHTML='';buildMenubar();
  CMD.push(['Co-Dev: Explain','Ctrl+K E',()=>explainCmd()],['Co-Dev: Code Review','Ctrl+K R',reviewCmd],['Co-Dev: Under the Hood','Ctrl+K U',hoodCmd],['Debug: Start Debugging','F5',()=>startDebug()],['Debug: Step Over','F10',dbgStep],['Debug: Stop','Shift+F5',dbgStop],['Debug: Toggle Breakpoint','F9',()=>{const t=tabOf(cur),ta=$('#ed-ta');if(t&&t.path&&ta)toggleBp(t.path,ta.value.slice(0,ta.selectionStart).split('\n').length);}],
   ['View: Tasks','Ctrl+Shift+T',()=>goPane('tasks')],['View: Run and Debug','Ctrl+Shift+D',()=>goPane('debug')],['View: Extensions','Ctrl+Shift+X',()=>goPane('ext')],['Extensions: Install from VSIX…','',()=>{goPane('ext');$('#vsix-in').click();}],['Environments: Open','',openEnvs],['Environments: Promote Local → Staging','',()=>promote('staging')],['Environments: Promote Staging → Production','',()=>promote('production')],['Studio: Compare design with Local','',()=>{DRIFT='local';openStudio();}]);
  CMD.forEach(c=>{if(c[0]==='Project: RUN the whole stack')c[1]='Ctrl+F5';});window.vsxCmds();refresh(false,true);show(cur);badges();}

/* ───── wiring + i18n: motor de tradução (PAIRS/NM/MN/nm/mn/tx/RULES + LOCALES/LOCALE/PT2EN/EN2PT/TR_SKIP/trText/trAttrs/trNode/setLocale/i18nBoot) migrado p/ features/i18n.ts (window-backed; LOCALE hidrata de LS preguiçosamente). Aqui so os consumidores (VIEW.settings secao Lingua, entradas setLocale do CMD, startup.ts i18nBoot) que leem por global. ───── */
/* ── fase 4: expor ao window as globais que boot.js/handlers inline/bridge.ts/pair.ts
   consomem; ao virar módulo, os let/const/function de topo deixaram de ser globais de
   script. As mutáveis partilhadas já são window-backed acima (fonte única). ── */
Object.assign(window, {
  CMD, FS, OPEN, PANE, PROV, ROOT, RUN, SECOPEN, STOP,
  blame, boot, boot3, boot4, boot5, boot6, buildMenus,
  esc, hydrate, log,
  mdFull, rerender, resetAll, runTask,
  who, // núcleo partilhado que o motor Co-Dev (features/codev.ts) lê por global (defs ficam donas do monólito):
  CHAT, SAFE, DANGER, norm, P_MIG, P_REPO, P_STORE, P_TEST, P_ADR,
  // fachadas que as features migradas (features/*.ts) consomem por window:
  provFor, LF,
  // núcleo lido como referências livres via window (era das camadas v5/v6; hoje features e boot5/boot6):
  extOf, getVar, hhmm, LANG, P_HIST, P_LX, rel, setVar, short
});
/* arranque: `boot();…boot7();i18nBoot()` movido para src/startup.ts — corre depois de
   todos os donos publicarem os seus bootN (app.ts, visualizer, i18n). */

