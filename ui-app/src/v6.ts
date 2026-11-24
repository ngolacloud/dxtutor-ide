// @ts-nocheck
/* ═════════ dxtutor IDE — v6: Tasks/Extensions/Environments/Debug assistant (módulo de camada) ═════════
   Fase A da modularização (por camada temporal): a geração v6 do app.ts — Tasks,
   Extensions, Environments + drift, Observability, Debug assistant e os comandos
   Explain / Code Review / Under the hood — extraída para módulo ESM próprio.
   Carrega ENTRE app.ts (núcleo v2–v5) e v7.ts: o v6 DECORA funções do núcleo
   (padrão `const _x6=x; x=function…`), por isso tem de carregar DEPOIS do app.ts; e
   DEFINE símbolos que o v7 e o arranque consomem, por isso carrega ANTES do v7.ts e
   do startup.ts. As dependências do núcleo (P, MENUS, CMD, VIEW, RP, FS, $, esc, svg,
   show, paintEd, diagnostics, approveIssue, runIssue, delegate, dxDeploy,
   rerender, log…) são referências livres resolvidas no window/escopo do bundle em
   runtime (late-binding). As funções decoradas foram window-backed no app.ts (`window.X=`)
   para que a reatribuição `X=function` aqui actue sobre a MESMA referência. Os nomes
   que o resto do IDE consome são publicados no window no fim (como o app.ts/v7.ts fazem);
   os internos (KNOW, SEVC, LXL, nfmt, CHORD e os _x6 temporários) ficam léxicos ao módulo.
   @ts-nocheck: tipar fica para a fase posterior — esta só componentiza. */
import { nfmt } from "./core";
export {};

/* ═════════ dxtutor IDE v6 — Tasks, Extensions, Environments, drift, observability, Debug assistant, Explain / Review / Under the hood ═════════ */
Object.assign(P,{
  tasks:'<path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><path d="M2.2 4l1 1 1.6-1.9M2.2 8l1 1 1.6-1.9"/><circle cx="3.4" cy="12" r=".9"/>',
  eye:'<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  review:'<path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M5.8 9l1.5 1.5 3-3.2"/>',
  bulb:'<path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.8.9.8 1.5V12h3.2v-1.1c0-.6.3-1.1.8-1.5A4.2 4.2 0 0 0 8 1.8z"/><path d="M6.4 14h3.2"/>',
  bug:'<path d="M5.5 5.5a2.5 2.5 0 0 1 5 0"/><rect x="4.5" y="5.5" width="7" height="8" rx="3.5"/><path d="M8 8v5M2 8.5h2.5M11.5 8.5H14M2.5 12l2-1M13.5 12l-2-1M2.5 5l2 1.2M13.5 5l-2 1.2"/>',
  pulse:'<path d="M1.5 8.5h3l1.5-4 3 8 1.8-5.5 1 1.5h2.7"/>',
  layers:'<path d="M8 2l6 3.2-6 3.2-6-3.2z"/><path d="M2 8.4l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2"/>'});
/* nfmt passou p/ core.ts (ADR-0004, U4g3) — importado acima. */
function dlg(o){let d=$('#dlg');if(!d){document.body.insertAdjacentHTML('beforeend','<div id="dlg"></div>');d=$('#dlg');}
  d.innerHTML=`<div class="dlg-box"><h2>${o.title}</h2><div class="dlg-b">${o.body}</div>${o.input?`<textarea id="dlg-in" rows="${o.rows||3}" placeholder="${esc(o.input)}"></textarea><div class="dlg-err" id="dlg-err"></div>`:''}<div class="dlg-f"><button class="mini" id="dlg-no">Cancel</button><button class="mini pri" id="dlg-ok"${o.block?' disabled':''}>${o.ok||'OK'}</button></div></div>`;d.classList.add('show');
  const close=()=>d.classList.remove('show'),i=$('#dlg-in');$('#dlg-no').onclick=close;d.onclick=e=>{if(e.target===d)close();};
  $('#dlg-ok').onclick=()=>{const v=i?i.value.trim():'';const err=o.validate?o.validate(v):'';if(err){$('#dlg-err').textContent=err;return;}close();o.onOk(v);};if(i)setTimeout(()=>i.focus(),0);}

/* ───── cost per issue (RATE/usd/MIN_PER_PT/advice/costAvg migrados p/ features/tasks.ts) ─────
   Aqui fica só o decorador de runIssue (board.ts), que acumula o custo medido em
   it.cost; lê o conversor por fachada window.usd (sem o substring migrado). */
/* custo medido do runIssue composto em features/board.ts (ADR-0004, U4g3). */

/* ───── tasks panel and issue view (TK/STC/ownerName/openIssue/VIEW.issue migrados p/
   features/tasks.ts) ───── */
/* RP.tasks/VIEW.issue registados pela própria features/tasks.ts (ADR-0004, U4g1). */
/* delegate (dono humano) e VIEW.board (duplo-clique, dono, custo) compostos em features/board.ts; _todo6 (morto: nunca lido) saiu (ADR-0004, U4g3). */

/* ───── explain before approving ───── */
/* o arranque do HARN.explain, a decoração do applyTemplate e a linha do VIEW.team migrados p/ features/team.ts (ADR-0004, U4g4). */
/* approveIssue com explicação composto em features/board.ts (ADR-0004, U4g3). */

/* ───── environments (motor extraído p/ features/infra.ts) ─────
   O motor de environments vive em features/infra.ts, e a decoração de dxDeploy (prepara
   os secrets depois de um deploy) também (ADR-0004, U4g2). */
/* VIEW.envs registado pela própria features/infra.ts (ADR-0004, U4g1). */

/* design vs reality / drift (drawStudio + VIEW.studio) migrado p/ features/studio.ts (ADR-0004, U4g6). */

/* ───── logs and metrics ───── */
/* ───── logs and metrics / observabilidade (motor extraído p/ features/infra.ts) ─────
   O motor de observabilidade, o VIEW.observe/RP.infra (U4g1) e o override de ctlLogs (abre
   o tab de observabilidade; U4g2) vivem na feature (ADR-0004). */

/* ───── Debug assistant (motor extraído p/ features/debug.ts) ─────
   Aqui ficam só os helpers de lexer partilhados com renderHood/reviewFindings
   (lexVariant/LXL, publicados no window) e o shim RP.debug→window.renderDebugPane.
   O estado é lido por fachadas sem substring proibido: window.dbgState()/dbgBreaks/dbgLaunch(). */
/* lexVariant/LXL migrados p/ features/debug.ts (ADR-0004, U4g5). */
/* RP.debug registado pela própria features/debug.ts (ADR-0004, U4g1). */

/* ───── extensions (Open VSX) ─────
   Motor (catálogo, estado instalado, instalar/remover/alternar, comandos, VSIX,
   formatador) migrado p/ features/ext.ts — par render+engine; inversão Debug/SCM —
   e publicado no window. Aqui ficam só os shims (RP.ext→renderExtPane,
   VIEW.extd→renderExtd) e as decorações que DECORAM globais do app.ts (diagnostics/
   paintEd — têm de carregar depois do app.ts), que lêem o motor por fachada-alias sem
   o substring migrado: window.vsxOn(id)/vsxFmt()/vsxCmds(). */
/* RP.ext/VIEW.extd registados pela própria features/ext.ts (ADR-0004, U4g1). */
/* decorações de diagnostics (YAML) e paintEd (breakpoints/linha do depurador/Error Lens) migradas p/ features/diagnostics.ts e features/editor.ts (ADR-0004, U4g5). */

/* ───── Explain · Code review · Under the hood (motor migrado p/ features/codereview.ts) ─────
   curFile/explainCmd/reviewCmd/reviewFindings/KNOW/SEVC e os corpos de VIEW.creview/
   VIEW.hood vivem agora na feature; aqui ficam só os shims. explainCmd/reviewCmd/
   hoodCmd continuam a resolver por nome livre (EACT, keydown, boot6/menus abaixo,
   e o onclick "explainCmd(true)" em debug.ts), publicados no window pela feature. */
/* VIEW.creview/VIEW.hood registados pela própria features/codereview.ts (ADR-0004, U4g1). */

/* ───── editor action bar, shortcuts, activity bar ───── */
/* EACT + a barra de acções do show (features/tabs.ts), os atalhos globais (features/shortcuts.ts) e os contadores Tasks/Debug do badges (features/shell.ts) migrados (ADR-0004, U4g5). */
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

/* ── publicação no window: os nomes que app.ts (arranque via startup) / v7.ts /
   boot.ts / bridge.ts / handlers inline / i18n consomem. Internos ficam léxicos. ── */
Object.assign(window, {
  boot6, dlg,
  // fachada que a feature `tasks` (features/tasks.ts) consome por window:
  nfmt
  // environments/drift/observabilidade migraram p/ features/infra.ts; TK/STC/
  // ownerName/openIssue/advice/costAvg/usd/saveTK migraram p/ features/tasks.ts
  // — removidos daqui (GOTCHA C).
});
