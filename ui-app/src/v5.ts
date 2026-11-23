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
   features/team.ts publica: a decoração de dxRun/dxStop, a wiring do terminal
   XC.kubectl/XC.devcontainer/XC.dx, os decorators de doTool/setMode/approveIssue/
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
import { jsa } from "./core";

/* ═════════ dxtutor IDE v5 — project harness, less noise ═════════ */
const _dxRun5=dxRun;dxRun=function(term){if(!needRt()){if(term===true)echo('<span class="er">Cannot connect to the container runtime. Point the socket in Infra.</span>');return{ok:false,sum:'no runtime'};}const r=_dxRun5(term);infraDraw();return r;};
const _dxStop5=dxStop;dxStop=function(t){_dxStop5(t);infraDraw();};
XC.kubectl=a=>{if(!ENVS.k8sOn){echo('<span class="er">The connection to the server was refused — connect the cluster in Infra.</span>');return;}if(a[0]==='get'){echo(K8S?(/^po/.test(a[1]||'')?K8S.deps.flatMap(d=>Array.from({length:d.rep},(_,i)=>`${(d.n+'-'+(i+1)).padEnd(28)} 1/1   Running`)).join('\n'):K8S.deps.map(d=>`${d.n.padEnd(22)} ${d.ready}/${d.rep}   ${d.img}`).join('\n')):'<span class="dim">No resources found in '+esc(ENVS.ns)+' namespace.</span>');return;}echo('<span class="dim">kubectl get deploy | get pods</span>');};
XC.devcontainer=a=>{if(a[0]==='up')dcAttach();else echo('<span class="dim">devcontainer up</span>');};
const _dx5=XC.dx;XC.dx=a=>{if(a[0]==='deploy')return dxDeploy();return _dx5(a);};

/* ───── project harness: decoradores residuais (motor em features/team.ts) ─────
   RIGHTS/RIGHT_RE/HT/MORD/HARN/isHuman/harnessToml/applyTemplate/toggleRight/
   authorship/reviewIssue são agora definidos em features/team.ts e lidos aqui por
   nome livre (publicados no window por essa feature). team.ts avalia ANTES de
   app.ts (que define LS) por isso HARN nasce lá só com defaults; `hydrateHarn()`
   lê o LS.get('harn5',…) persistido — chama-se aqui (v5.ts carrega DEPOIS de
   app.ts, LS já existe) para repor a hidratação síncrona que o HARN original
   tinha, ANTES de boot5/setMode/doTool lerem HARN.ceiling/human. */
window.hydrateHarn();
const _setMode5=setMode;setMode=function(m){if(MORD.indexOf(m)>MORD.indexOf(HARN.ceiling)){toast(`This project's harness caps autonomy at ${MODES[HARN.ceiling].l}`);return;}_setMode5(m);};
const _doTool5=doTool;doTool=async function(t,host,role){if(t.t==='edit'){if(isHuman('code')&&!/\/learn\//.test(t.p)){tl(host,'harness',short(t.p)).querySelector('.tr').innerHTML='<span class="bad">✖ writing code is yours in this project</span>';log('harness','edit blocked: code is human-only');return false;}
    const r=Object.keys(RIGHT_RE).find(k=>isHuman(k)&&RIGHT_RE[k].test(t.p));if(r&&MODE!=='manual'){const d=tl(host,'your call',RIGHTS[r]+' · '+short(t.p));const v=await ask(d,[{l:'Approve',v:1,pri:1,done:'✓ approved by you'},{l:'Reject',v:0,done:'✗ rejected by you'}]);if(!v){log('humano','rejected '+short(t.p));return false;}}}
  return _doTool5(t,host,role);};
VIEW.review=(t,host)=>{const it=BL.issues.find(i=>i.id===t.issue),tr=it&&GIT.trees[it.branch],dv=GIT.trees.develop,files=tr?Object.keys(tr).filter(p=>tr[p]!==dv[p]):[];
  host.innerHTML=`<div class="diff"><div class="diff-h"><b style="color:var(--fg)" class="notr">${it?esc(it.id+' · '+it.title):''}</b><span class="tag notr">${it?esc(it.branch||''):''} → develop</span><span class="sp" style="flex:1"></span>${it&&it.stage==='func'?`<button class="mini pri" onclick="approveIssue(${jsa(it.id)});closeTab('review')">✓ Validate and merge</button><button class="mini" onclick="rejectIssue(${jsa(it.id)})">✗ Reject</button>`:''}</div>${files.length?files.map(p=>{const d=diffLines(dv[p]||'',tr[p]),ext=extOf(p);return `<div class="diff-h" style="padding-top:14px"><b style="color:var(--accent-hover)">${esc(short(p))}</b><span style="color:var(--green)">+${d.filter(x=>x[0]==='+').length}</span><span style="color:var(--red)">−${d.filter(x=>x[0]==='-').length}</span></div>`+d.map(x=>`<div class="dl ${x[0]==='+'?'add':x[0]==='-'?'del':''}"><span class="n">${x[2]}</span><span class="n">${x[3]}</span><span class="s">${x[0]}</span><span>${hlLine(x[1],ext)||' '}</span></div>`).join('');}).join(''):'<div class="sec-empty">Nothing to review: the branch was already merged or has no changes.</div>'}</div>`;};
const _approve5=approveIssue;approveIssue=function(id){const it=BL.issues.find(i=>i.id===id);if(it&&it.stage==='func'&&HARN.review&&!it.reviewed){toast('Review the diff before validating');reviewIssue(id);return;}_approve5(id);};
const _board5=VIEW.board;VIEW.board=(t,host)=>{_board5(t,host);if(!HARN.review)return;host.querySelectorAll('.kc-a').forEach(a=>{const m=(a.innerHTML.match(/approveIssue\('([^']+)'\)/)||[])[1],it=BL.issues.find(i=>i.id===m);if(it&&!it.reviewed)a.innerHTML=`<button class="mini pri" onclick="reviewIssue(${jsa(it.id)})">Review diff</button>`;});};

/* ───── less noise ───── */
const _studio5=VIEW.studio;VIEW.studio=(t,host)=>{_studio5(t,host);const r=host.querySelector('.mini.run');if(r)r.insertAdjacentHTML('afterend','<button class="mini run" style="background:var(--blue)" onclick="dxDeploy()">⎈ Deploy</button>');};
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
function openTeam(){openTab({id:'team',title:'Team & harness',kind:'team'});}
function tick(){}
function codeGuard(what){if(!isHuman('code'))return false;focusAgent(true);user(what);card('co-dev',`<p>In this project <b>writing code is yours</b> (harness: ${HT[HARN.tpl].n}). I will not edit files.</p><p>I can explain the problem, review what you write, and run the tests when you are ready. Ask in the box below, or change the harness in <b>Team &amp; harness</b>.</p><div class="gate"><button class="gb" onclick="handlePrompt('/test')">Run the tests</button><button class="gb" onclick="openTeam()">Open the harness</button></div>`);return true;}
const _runMission5=runMission;runMission=function(S,text){if(codeGuard(text))return;return _runMission5(S,text);};
const _delegate5=delegate;delegate=function(id){if(codeGuard('Delegate '+id+'.'))return;return _delegate5(id);};
const _runSprint5=runSprint;runSprint=function(s){if(codeGuard('Run Sprint '+(s+1)+'.'))return;return _runSprint5(s);};

/* ── publicação no window: os nomes que app.ts (núcleo/i18n) / v6.ts / startup.ts /
   boot.ts / handlers inline consomem como referências livres. Internos ficam léxicos.
   ENVS/RTN/KCTX e o motor de Infra/K8s (appEnv/dcAttach/dcDetach/devcontainerJson/
   drawRemote/infraDraw/k8sDocs/k8sDown/k8sInfra/k8sScale/needRt/projectContext/
   runTaskQuiet/saveEnv/ctlLogs) migraram p/ features/infra.ts, e o motor do harness
   (HARN/applyTemplate/authorship/harnessToml/isHuman/reviewIssue/toggleRight/RIGHTS/
   RIGHT_RE/HT/MORD) migrou p/ features/team.ts — removidos daqui (GOTCHA C). ── */
Object.assign(window, { boot5, codeGuard, openTeam, tick });
