// @ts-nocheck
/* ═════════ dxtutor IDE — v5: project harness decorations, less noise (módulo de camada) ═════════
   Fase A da modularização (por camada temporal): a geração v5 do app.ts — o harness do
   projecto (templates/decision-rights/mode-ceiling), «less noise» e o boot5 — extraída
   para módulo ESM próprio. O motor de Infra/K8s/dev-container que nasceu aqui (ENVS/
   RTN/KCTX, rtConnect/k8sConnect/needRt/projectContext/devcontainerJson/dcAttach/
   dcDetach/drawRemote/infraDraw/appEnv/k8sInfra/k8sDocs/dxDeploy/k8sScale/k8sDown/
   runTaskQuiet/ctlLogs) MIGROU para `features/infra.ts` (4ª inversão, mesmo padrão de
   Debug/SCM/ext/tasks). O motor do harness de projecto (RIGHTS/RIGHT_RE/ALWAYS/MORD/HT/
   HARN/isHuman/harnessToml/applyTemplate/toggleRight/authorship/reviewIssue) MIGROU para
   `features/team.ts`, fundido com `renderTeamView` (a secção "Project harness" que aqui
   se inseria por fora, via VIEW.team=_team5, passa a fazer parte do corpo único da
   feature — por isso o wrapper de VIEW.team desapareceu deste ficheiro). Fica aqui só o
   que tem mesmo de carregar DEPOIS do core, DECORANDO o resíduo com os globais que
   features/team.ts publica (a decoração de dxRun/dxStop passou p/ features/stack.ts e a
   wiring do terminal XC.kubectl/XC.devcontainer/XC.dx p/ features/infra.ts — U4g2): os
   decorators de doTool/setMode/approveIssue/
   VIEW.board (leem RIGHTS/RIGHT_RE/isHuman/HARN/reviewIssue por nome livre), boot5,
   codeGuard e CMD.push (leem HT/MORD/HARN/applyTemplate/isHuman).

   Carrega ENTRE app.ts (núcleo v2–v4 + i18n) e v6.ts: a v5 DECORA funções do núcleo
   (padrão `const _x5=x; x=function…`), por isso tem de carregar DEPOIS do app.ts. As
   dependências do núcleo e das features ($, FS, RP, VIEW, XC, esc, svg, show, log,
   toast, goPane, rerender, approveIssue, delegate, setMode, doTool, dxRun, dxStop,
   MODES, RUN, RIGHTS, RIGHT_RE, HT, HARN, isHuman, applyTemplate, toggleRight,
   authorship, reviewIssue, harnessToml…) são referências livres resolvidas no
   window/escopo do bundle em runtime (late-binding). As funções decoradas (dxRun,
   dxStop, setMode, doTool, approveIssue, delegate, runMission, runSprint) foram
   window-backed no app.ts (`window.X=`) para que a reatribuição `X=function` aqui
   actue sobre a MESMA referência. Os nomes que o resto do IDE consome são publicados
   no window no fim (como o app.ts/v6.ts fazem). @ts-nocheck: tipar fica para a fase
   posterior — esta só componentiza. */
export {};

/* ═════════ dxtutor IDE v5 — project harness, less noise ═════════ */
/* decoração de dxRun/dxStop dobrada em features/stack.ts; comandos do terminal kubectl/devcontainer/dx deploy migrados p/ features/infra.ts (ADR-0004, U4g2). */

/* ───── project harness: decoradores residuais (motor em features/team.ts) ─────
   RIGHTS/RIGHT_RE/HT/MORD/HARN/isHuman/harnessToml/applyTemplate/toggleRight/
   authorship/reviewIssue são agora definidos em features/team.ts e lidos aqui por
   nome livre (publicados no window por essa feature). team.ts avalia ANTES de
   app.ts (que define LS) por isso HARN nasce lá só com defaults; `hydrateHarn()`
   lê o LS.get('harn5',…) persistido — chama-se aqui (v5.ts carrega DEPOIS de
   app.ts, LS já existe) para repor a hidratação síncrona que o HARN original
   tinha, ANTES de boot5/setMode/doTool lerem HARN.ceiling/human. */
/* hydrateHarn (eager), o tecto do setMode, os direitos no doTool, o VIEW.review, o openTeam e o codeGuard no runMission migrados (ADR-0004, U4g4): features/team.ts e features/codev.ts. */
/* decorações de approveIssue/VIEW.board (revisão), delegate/runSprint (codeGuard) compostas em features/board.ts; codeGuard em features/team.ts (ADR-0004, U4g3). */

/* ───── less noise ───── */
/* (o botão «⎈ Deploy» que aqui decorava VIEW.studio era código morto desde f2eced4: o v6
   passou a definir VIEW.studio sem compor, e este _studio5 capturava undefined — nada define
   VIEW.studio antes do v5. Removido na U4g6 do ADR-0004; a perda do botão está reportada.) */
VIEW.welcome=(t,host)=>{const w=(ic,a,b,act)=>`<button class="wbtn" onclick="${act}"><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML=`<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">You decide; the assistants accelerate. Learn a language, or design an architecture and take it to a running stack and a local cluster.</div>
  <h2>Build</h2><div class="wgrid">${w('cube','1 · Design','Studio with cloud and open-source components','openStudio()')}${w('account','2 · Set the harness','Templates, scopes and who decides','openTeam()')}${w('split','3 · Deliver','Board, sprints, automatic tests, your review','openBoard()')}${w('run','4 · RUN','Start the whole stack on your container runtime','dxRun()')}${w('rocket','5 · Deploy','One click to your local Kubernetes','dxDeploy()')}${w('container','Infra','Socket, dev container, KUBECONFIG',"goPane('infra')")}</div>
  <h2>Learn</h2><div class="wgrid">${w('book','Learning Track','Rust and Go, from zero to confident','ltResume()')}</div>
  <h2>Co-Dev</h2><div class="wgrid">${w('sparkle','Mission: persistent chat history','Council, self-evaluation and correction',"demo('b')")}${w('graph','Mission manager','Decisions, checkpoints and usage','openManager()')}${w('settings','Settings','Models, autonomy, language','openSettings()')}</div></div>`;};
function boot5(){ENVS.rtOn=false;ENVS.k8sOn=false;if(MORD.indexOf(MODE)>MORD.indexOf(HARN.ceiling))MODE=HARN.ceiling;
  for(let i=ACTS.length-1;i>=0;i--)if(['run','ext','account'].includes(ACTS[i].pane)||ACTS[i].overflow)ACTS.splice(i,1);const bi=ACTS.findIndex(a=>a.title==='Quadro');ACTS.splice(bi+1,0,{ic:'container',pane:'infra',title:'Infra'});const st=ACTS.find(a=>a.pane==='settings');if(st)st.spacer=1;buildActivity();$('.act').classList.add('on');
  $('.side').insertAdjacentHTML('beforeend','<div class="pane" id="pane-infra"></div>');const tm=$('.tmux');if(tm)tm.remove();const ab=$('.tb-ic[data-ic="account"]');if(ab)ab.onclick=openSettings;
  const drop=['Selection','Go','Terminal'],ed=MENUS.find(m=>m.t==='Edit'),sel=MENUS.find(m=>m.t==='Selection'),go=MENUS.find(m=>m.t==='Go');if(ed&&sel&&go)ed.items.push({sep:1},...go.items.filter(i=>!i.sep).slice(0,3),{sep:1},...sel.items.filter(i=>!i.sep));
  for(let i=MENUS.length-1;i>=0;i--)if(drop.includes(MENUS[i].t))MENUS.splice(i,1);const pm=MENUS.find(m=>m.t==='Project');if(pm)pm.items.splice(2,0,{l:'⎈ Deploy to Kubernetes',act:dxDeploy},{l:'Attach project to a container',act:dcAttach},{l:'Infra: socket and KUBECONFIG',act:()=>goPane('infra')});$('#menubar').innerHTML='';buildMenubar();
  for(let i=CMD.length-1;i>=0;i--)if(/Run and Debug|Extensions/.test(CMD[i][0]))CMD.splice(i,1);
  CMD.push(['Project: Deploy to Kubernetes','',dxDeploy],['Infra: Connect container socket','',()=>{goPane('infra');if(!ENVS.rtOn)rtConnect();}],['Infra: Connect cluster (KUBECONFIG)','',()=>{goPane('infra');if(!ENVS.k8sOn)k8sConnect();}],['Infra: Attach project to a container','',dcAttach],...Object.entries(HT).map(([k,h])=>['Harness: Apply template — '+h.n,'',()=>{applyTemplate(k);openTeam();}]));
  const tt=tabOf('team');if(tt)tt.title='Team & harness';updateAgentUI();drawRemote();refresh(false,true);show(cur);}
function tick(){}

/* ── publicação no window: os nomes que app.ts (núcleo/i18n) / v6.ts / startup.ts /
   boot.ts / handlers inline consomem como referências livres. Internos ficam léxicos.
   ENVS/RTN/KCTX e o motor de Infra/K8s (appEnv/dcAttach/dcDetach/devcontainerJson/
   drawRemote/infraDraw/k8sDocs/k8sDown/k8sInfra/k8sScale/needRt/projectContext/
   runTaskQuiet/saveEnv/ctlLogs) migraram p/ features/infra.ts, e o motor do harness
   (HARN/applyTemplate/authorship/harnessToml/isHuman/reviewIssue/toggleRight/RIGHTS/
   RIGHT_RE/HT/MORD) migrou p/ features/team.ts — removidos daqui (GOTCHA C). ── */
Object.assign(window, { boot5, tick });
