// @ts-nocheck
/* ═════════ dxtutor IDE — v6: Tasks/Extensions/Environments/Debug assistant (módulo de camada) ═════════
   Fase A da modularização (por camada temporal): a geração v6 do app.ts — Tasks,
   Extensions, Environments + drift, Observability, Debug assistant e os comandos
   Explain / Code Review / Under the hood — extraída para módulo ESM próprio.
   Carrega ENTRE app.ts (núcleo v2–v5) e v7.ts: o v6 DECORA funções do núcleo
   (padrão `const _x6=x; x=function…`), por isso tem de carregar DEPOIS do app.ts; e
   DEFINE símbolos que o v7 e o arranque consomem, por isso carrega ANTES do v7.ts e
   do startup.ts. As dependências do núcleo (P, MENUS, CMD, VIEW, RP, FS, $, esc, svg,
   show, paintEd, diagnostics, drawStudio, approveIssue, runIssue, delegate, dxDeploy,
   rerender, log…) são referências livres resolvidas no window/escopo do bundle em
   runtime (late-binding). As funções decoradas foram window-backed no app.ts (`window.X=`)
   para que a reatribuição `X=function` aqui actue sobre a MESMA referência. Os nomes
   que o resto do IDE consome são publicados no window no fim (como o app.ts/v7.ts fazem);
   os internos (KNOW, SEVC, LXL, nfmt, CHORD e os _x6 temporários) ficam léxicos ao módulo.
   @ts-nocheck: tipar fica para a fase posterior — esta só componentiza. */
/* ADR-0002 passo 6: VIEW.envs/VIEW.observe passam a importar os corpos da feature
   `infra` por PORTA TIPADA (import ES), em vez de os resolver por global no window
   — a feature já não os publica. */
import { initSecrets, driftReport, DSTY } from "./features/infra";
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
const nfmt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n|0);
function dlg(o){let d=$('#dlg');if(!d){document.body.insertAdjacentHTML('beforeend','<div id="dlg"></div>');d=$('#dlg');}
  d.innerHTML=`<div class="dlg-box"><h2>${o.title}</h2><div class="dlg-b">${o.body}</div>${o.input?`<textarea id="dlg-in" rows="${o.rows||3}" placeholder="${esc(o.input)}"></textarea><div class="dlg-err" id="dlg-err"></div>`:''}<div class="dlg-f"><button class="mini" id="dlg-no">Cancel</button><button class="mini pri" id="dlg-ok"${o.block?' disabled':''}>${o.ok||'OK'}</button></div></div>`;d.classList.add('show');
  const close=()=>d.classList.remove('show'),i=$('#dlg-in');$('#dlg-no').onclick=close;d.onclick=e=>{if(e.target===d)close();};
  $('#dlg-ok').onclick=()=>{const v=i?i.value.trim():'';const err=o.validate?o.validate(v):'';if(err){$('#dlg-err').textContent=err;return;}close();o.onOk(v);};if(i)setTimeout(()=>i.focus(),0);}

/* ───── cost per issue (RATE/usd/MIN_PER_PT/advice/costAvg migrados p/ features/tasks.ts) ─────
   Aqui fica só o decorador de runIssue (board.ts), que acumula o custo medido em
   it.cost; lê o conversor por fachada window.usd (sem o substring migrado). */
const _runIssue6=runIssue;runIssue=async function(it){const snap=Object.fromEntries(Object.keys(USAGE).map(k=>[k,USAGE[k].tok])),t0=Date.now();
  try{await _runIssue6(it);}finally{it.cost=it.cost||{tok:0,usd:0,sec:0,runs:0,by:{}};Object.keys(USAGE).forEach(k=>{const d=USAGE[k].tok-snap[k];if(d>0){it.cost.tok+=d;it.cost.usd+=window.usd(d,k);it.cost.by[k]=(it.cost.by[k]||0)+d;}});it.cost.sec+=(Date.now()-t0)/1000;it.cost.runs++;if(PANE==='tasks')RP.tasks();}};

/* ───── tasks panel and issue view (TK/STC/ownerName/openIssue/VIEW.issue migrados p/
   features/tasks.ts) ───── */
/* RP.tasks/VIEW.issue registados pela própria features/tasks.ts (ADR-0004, U4g1). */
const _delegate6=delegate;delegate=function(id){const i=BL.issues.find(x=>x.id===id);if(i&&i.owner==='you'){toast(`${id} is yours — move it to Test when your code is ready`);openIssue(id);return;}return _delegate6(id);};
const _todo6=()=>BL.issues.find(i=>i.owner==='you');
const _board6=VIEW.board;VIEW.board=(t,host)=>{_board6(t,host);host.querySelectorAll('.kc').forEach(k=>{const id=(k.querySelector('.kc-id')||{}).textContent,i=BL.issues.find(x=>x.id===id);if(!i)return;k.ondblclick=()=>openIssue(id);
  if(i.owner==='you'){const m=k.querySelector('.kc-m');if(m)m.innerHTML=`<span class="av" style="background:#8a8f9c">Y</span>You<span class="tag" style="margin-left:auto">S${i.sprint+1}</span>`;k.querySelectorAll('.mini').forEach(b=>{if(/delegate/.test(b.getAttribute('onclick')||''))b.remove();});}
  if(i.cost)k.querySelector('.kc-m').insertAdjacentHTML('beforeend',`<span class="tk-c" title="${nfmt(i.cost.tok)} tokens">$${i.cost.usd.toFixed(2)}</span>`);});};

/* ───── explain before approving ───── */
HARN.explain=HARN.explain!=null?HARN.explain:['study','critical'].includes(HARN.tpl);
const _apply6=applyTemplate;applyTemplate=function(id){_apply6(id);HARN.explain=['study','critical'].includes(id);LS.set('harn5',HARN);rerender('team');};
const _approve6=approveIssue;approveIssue=function(id){const it=BL.issues.find(i=>i.id===id);
  if(it&&it.stage==='func'&&HARN.explain&&!it.explain&&(!HARN.review||it.reviewed)){dlg({title:`Explain ${it.id} before validating`,body:`<p>This project asks you to say, in your own words, what the change does and why it is safe to merge. It is saved with the issue and the merge commit.</p><p style="color:var(--fg-muted)">${esc(it.title)}</p>`,input:'e.g. Adds the orders table with an index on created_at so the list query does not scan the table…',ok:'Validate and merge',
    validate:v=>v.split(/\s+/).filter(Boolean).length<8?'Write at least one full sentence (8 words or more).':'',onOk:v=>{it.explain=v;approveIssue(id);}});return;}
  _approve6(id);if(it&&it.merged&&it.explain&&GIT.c[it.merged])GIT.c[it.merged].note=it.explain;if(PANE==='tasks')RP.tasks();};
const _team6=VIEW.team;VIEW.team=(t,host)=>{_team6(t,host);const row=[...host.querySelectorAll('.rowline')].find(r=>/Review the diff before validating/.test(r.textContent));if(row)row.insertAdjacentHTML('afterend',`<div class="rowline"><span>Explain the change in your own words before validating</span><span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">on in Study and Critical systems</span><button class="sw${HARN.explain?' on':''}" onclick="HARN.explain=!HARN.explain;LS.set('harn5',HARN);rerender('team')"></button></div>`);};

/* ───── environments (motor extraído p/ features/infra.ts) ─────
   Inversão Debug/SCM/ext: o motor de environments (labels/estado/secrets/promoção) vive
   agora em features/infra.ts, par do render renderInfraPane. Aqui fica SÓ a decoração de
   dxDeploy (de v5 — carrega depois, eager-read da base) que, após um deploy, prepara os
   secrets por `initSecrets`, importado da feature por porta tipada (ADR-0002 passo 6). */
const _dxDeploy6=dxDeploy;dxDeploy=function(){const r=_dxDeploy6();if(r&&r.ok&&K8S){K8S.ver=GIT.refs.develop;K8S.at=Date.now();initSecrets();}return r;};
/* VIEW.envs registado pela própria features/infra.ts (ADR-0004, U4g1). */

/* ───── design vs reality / drift (decora Studio: drawStudio/VIEW.studio de app.ts) ─────
   O relatório de drift e o mapa de estilos das etiquetas vivem em features/infra.ts; aqui
   as decorações importam `driftReport` e `DSTY` por porta tipada (ADR-0002 passo 6). O
   estado DRIFT é window.DRIFT (inicializado na feature); ENVL é a fachada publicada pela
   feature. */
const _drawStudio6=drawStudio;drawStudio=function(){_drawStudio6();if(!DRIFT)return;const s=$('#st-svg');if(!s)return;const r=driftReport(DRIFT);
  s.querySelectorAll('g[data-n]').forEach(g=>{const x=r.out[g.dataset.n];if(!x)return;const[c,l]=DSTY[x.st];g.querySelector('rect').setAttribute('stroke',c);g.querySelector('rect').setAttribute('stroke-dasharray',x.st==='sync'?'':'4 3');const te=g.querySelector('text[text-anchor="end"]');if(te)te.remove();g.insertAdjacentHTML('beforeend',`<rect x="${NW-76}" y="6" width="70" height="14" rx="7" fill="${c}" opacity=".18"/><text x="${NW-41}" y="16.5" text-anchor="middle" fill="${c}" font-size="8.5" font-weight="700" font-family="var(--font-mono)">${l}</text>`);});
  const ins=$('#st-insp');if(ins&&!SSEL&&SLINK===null){const cnt=k=>Object.values(r.out).filter(x=>x.st===k).length;ins.insertAdjacentHTML('afterbegin',`<h3>Design vs ${ENVL[DRIFT]}</h3>${!r.s?`<p>${ENVL[DRIFT]} has nothing deployed yet.</p>`:`<p>${cnt('sync')} in sync · ${cnt('drift')+cnt('behind')} drifting · ${cnt('missing')+cnt('bad')} missing or failing</p>${SD.nodes.filter(n=>r.out[n.id].st!=='sync').map(n=>`<div class="st-f ${['bad','missing'].includes(r.out[n.id].st)?'e':'w'}"><span>●</span><div><b class="notr">${esc(n.n)}</b> — <span class="notr">${esc(r.out[n.id].why)}</span></div></div>`).join('')}${r.extra.map(x=>`<div class="st-f w"><span>●</span><div><b class="notr">${esc(x)}</b> — running, but not in the design</div></div>`).join('')}`}<hr style="border:0;border-top:1px solid var(--seam);margin:12px 0">`);}};
VIEW.studio=(t,host)=>{window.renderStudioView(t,host);const b=host.querySelector('.st-bar .sp');if(b)b.insertAdjacentHTML('beforebegin',`<select class="mini" title="Compare the design with what is running" onchange="DRIFT=this.value||null;drawStudio()"><option value="">Compare with…</option>${Object.entries(ENVL).map(([k,l])=>`<option value="${k}"${DRIFT===k?' selected':''}>${l}</option>`).join('')}</select>`);};

/* ───── logs and metrics ───── */
/* ───── logs and metrics / observabilidade (motor extraído p/ features/infra.ts) ─────
   O motor de observabilidade (estado, RNG, séries temporais, mini-gráficos, openObserve) e
   o corpo de VIEW.observe vivem na feature. Aqui ficam o shim de VIEW.observe e o override
   de ctlLogs (de v5 — passa a abrir o tab de observabilidade em vez dos logs do terminal);
   openObserve resolve no window. */
/* VIEW.observe e RP.infra registados pela própria features/infra.ts (ADR-0004, U4g1). */
ctlLogs=n=>openObserve('local',n);

/* ───── Debug assistant (motor extraído p/ features/debug.ts) ─────
   Aqui ficam só os helpers de lexer partilhados com renderHood/reviewFindings
   (lexVariant/LXL, publicados no window) e o shim RP.debug→window.renderDebugPane.
   O estado é lido por fachadas sem substring proibido: window.dbgState()/dbgBreaks/dbgLaunch(). */
function lexVariant(){const c=FS[P_LX]?FS[P_LX].content:'';if(lexBug())return'bug';if(/for c in chars\.clone\(\)/.test(c))return'clone';if(/for c in chars\.by_ref\(\)/.test(c))return'byref';if(/while let Some\(c\) = chars\.next\(\)/.test(c))return'whilelet';return'other';}
const LXL=re=>{const ls=(FS[P_LX]?FS[P_LX].content:'').split('\n');return ls.findIndex(l=>re.test(l))+1;};
/* RP.debug registado pela própria features/debug.ts (ADR-0004, U4g1). */

/* ───── extensions (Open VSX) ─────
   Motor (catálogo, estado instalado, instalar/remover/alternar, comandos, VSIX,
   formatador) migrado p/ features/ext.ts — par render+engine; inversão Debug/SCM —
   e publicado no window. Aqui ficam só os shims (RP.ext→renderExtPane,
   VIEW.extd→renderExtd) e as decorações que DECORAM globais do app.ts (diagnostics/
   paintEd — têm de carregar depois do app.ts), que lêem o motor por fachada-alias sem
   o substring migrado: window.vsxOn(id)/vsxFmt()/vsxCmds(). */
/* RP.ext/VIEW.extd registados pela própria features/ext.ts (ADR-0004, U4g1). */
const _diag6=diagnostics;diagnostics=function(){const d=_diag6();if(!window.vsxOn('redhat.vscode-yaml'))return d;Object.keys(FS).filter(p=>/\.ya?ml$/.test(p)).forEach(p=>{const ls=FS[p].content.split('\n');ls.forEach((l,i)=>{if(/^\t/.test(l))d.push({p,line:i+1,sev:'e',msg:'yaml: tabs are not allowed for indentation'});});
  if(/deploy\/k8s\//.test(p))FS[p].content.split(/^---$/m).reduce((off,doc)=>{if(/^kind:\s*Deployment/m.test(doc)&&!/resources:/.test(doc)){const ln=off+doc.split('\n').findIndex(l=>/^kind:\s*Deployment/.test(l))+1;d.push({p,line:Math.max(1,ln),sev:'w',msg:'yaml(k8s): Deployment without resources.requests/limits'});}return off+doc.split('\n').length;},0);});return d;};
const _paintEd6=paintEd;paintEd=function(p){_paintEd6(p);const gut=$('#ed-gut'),hl=$('#ed-hl');if(!gut||!hl)return;const gs=gut.children,ls=hl.children;
  [...window.dbgBreaks].filter(b=>b.startsWith(p+':')).forEach(b=>{const g=gs[+b.split(':').pop()-1];if(g)g.classList.add('bp');});
  const _ds=window.dbgState();if(_ds&&_ds.kind==='code'&&p===P_LX){const s=_ds.steps[_ds.i];if(s&&ls[s.l-1]){ls[s.l-1].classList.add('dbg-cur');if(gs[s.l-1])gs[s.l-1].classList.add('dbg-cur');}}
  if(window.vsxOn('usernamehw.errorlens')){const seen={};diagnostics().filter(x=>x.p===p).forEach(x=>{if(seen[x.line])return;seen[x.line]=1;const l=ls[x.line-1];if(l)l.insertAdjacentHTML('beforeend',`<span class="el ${x.sev}">  ${esc(x.msg)}</span>`);});}};

/* ───── Explain · Code review · Under the hood (motor migrado p/ features/codereview.ts) ─────
   curFile/explainCmd/reviewCmd/reviewFindings/KNOW/SEVC e os corpos de VIEW.creview/
   VIEW.hood vivem agora na feature; aqui ficam só os shims. explainCmd/reviewCmd/
   hoodCmd continuam a resolver por nome livre (EACT, keydown, boot6/menus abaixo,
   e o onclick "explainCmd(true)" em debug.ts), publicados no window pela feature. */
/* VIEW.creview/VIEW.hood registados pela própria features/codereview.ts (ADR-0004, U4g1). */

/* ───── editor action bar, shortcuts, activity bar ───── */
const EACT=[['bulb','Explain','Ctrl+K E','explainCmd()'],['review','Code review','Ctrl+K R','reviewCmd()'],['bug','Debug','F5','startDebug()'],['run','RUN','Ctrl+F5','dxRun()'],['eye','Under the hood','Ctrl+K U','hoodCmd()']];
const _show6=show;show=function(id){_show6(id);const t=tabOf(cur),b=$('#breadcrumbs');if(!b||!t||!['file','diff'].includes(t.kind))return;b.insertAdjacentHTML('beforeend',`<span class="ed-acts">${EACT.map(a=>`<button title="${a[1]} (${a[2]})" onclick="${a[3]}">${svg(a[0])}<span>${a[1]}</span></button>`).join('')}</span>`);};
let CHORD=0;
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey,go=f=>{e.preventDefault();e.stopPropagation();f();};
  if(window.termOwnsKey&&window.termOwnsKey(e))return;/* foco num terminal real (features/panel): a tecla é da shell */
  if(CHORD&&Date.now()-CHORD<1600){CHORD=0;$('#st-chord').textContent='';if(k==='e')return go(()=>explainCmd());if(k==='r')return go(reviewCmd);if(k==='u')return go(hoodCmd);if(k==='d')return go(()=>startDebug());if(k==='v')return go(()=>vizFromEditor());}
  if(c&&!e.shiftKey&&!e.altKey&&k==='k'){go(()=>{CHORD=Date.now();$('#st-chord').textContent='(Ctrl+K) waiting for second key…';});return;}
  if(e.key==='F5'&&c)return go(dxRun);if(e.key==='F5'&&e.shiftKey)return go(dbgStop);if(e.key==='F5')return go(()=>window.dbgState()?dbgContinue():startDebug());if(e.key==='F10'||e.key==='F11')return go(dbgStep);
  if(e.key==='F9'){const t=tabOf(cur),ta=$('#ed-ta');if(t&&t.path&&ta)go(()=>toggleBp(t.path,ta.value.slice(0,ta.selectionStart).split('\n').length));return;}
  if(c&&e.shiftKey&&k==='d')return go(()=>goPane('debug'));if(c&&e.shiftKey&&k==='x')return go(()=>goPane('ext'));if(c&&e.shiftKey&&k==='t')return go(()=>goPane('tasks'));
  if(e.shiftKey&&e.altKey&&k==='f'&&window.vsxOn('esbenp.prettier-vscode'))return go(()=>window.vsxFmt());},true);
const _badges6=badges;badges=function(){_badges6();const b=$('.act[data-pane="tasks"] .badge');if(b){const n=BL.issues.filter(i=>i.stage==='func').length;b.textContent=n||'';b.style.display=n?'grid':'none';}const d=$('.act[data-pane="debug"] .badge');if(d){const n=window.dbgLaunch().filter(c=>c.id.startsWith('crash')).length;d.textContent=n||'';d.style.display=n?'grid':'none';}};
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
  boot6, dlg, EACT,
  lexVariant, LXL,
  // fachada que a feature `tasks` (features/tasks.ts) consome por window:
  nfmt
  // environments/drift/observabilidade migraram p/ features/infra.ts; TK/STC/
  // ownerName/openIssue/advice/costAvg/usd/saveTK migraram p/ features/tasks.ts
  // — removidos daqui (GOTCHA C).
});
