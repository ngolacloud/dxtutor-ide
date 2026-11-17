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
   os internos (RATE, usd, KNOW, SEVC, STC,
   LXL, nfmt, CHORD e os _x6 temporários) ficam léxicos ao módulo. @ts-nocheck: tipar fica
   para a fase posterior — esta só componentiza. */
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

/* ───── cost per issue ───── */
const RATE=LS.get('rate6',{claude:15,gemini:7,codex:10,ollama:0}),MIN_PER_PT=30;
const usd=(tok,p)=>tok/1e6*(RATE[p]||0);
const _runIssue6=runIssue;runIssue=async function(it){const snap=Object.fromEntries(Object.keys(USAGE).map(k=>[k,USAGE[k].tok])),t0=Date.now();
  try{await _runIssue6(it);}finally{it.cost=it.cost||{tok:0,usd:0,sec:0,runs:0,by:{}};Object.keys(USAGE).forEach(k=>{const d=USAGE[k].tok-snap[k];if(d>0){it.cost.tok+=d;it.cost.usd+=usd(d,k);it.cost.by[k]=(it.cost.by[k]||0)+d;}});it.cost.sec+=(Date.now()-t0)/1000;it.cost.runs++;if(PANE==='tasks')RP.tasks();}};
function costAvg(agent){const xs=BL.issues.filter(i=>i.cost&&i.cost.runs&&i.agent===agent);if(!xs.length)return null;const pts=xs.reduce((a,i)=>a+i.pts,0);return{tok:xs.reduce((a,i)=>a+i.cost.tok,0)/pts,usd:xs.reduce((a,i)=>a+i.cost.usd,0)/pts,att:xs.reduce((a,i)=>a+i.attempts,0)/xs.length};}
function advice(it){if(isHuman('code'))return['you','In this project code stays with you.'];if(it.agent==='arq'||/ADR/.test(it.title))return['you','Architecture is your call: let the Architect draft, you decide.'];
  const a=costAvg(it.agent),tok=a?a.tok*it.pts:1200*it.pts,u=a?a.usd*it.pts:usd(1200*it.pts,'claude'),h=it.pts*MIN_PER_PT;
  if(a&&a.att>=1)return['mix',`Delegate, but expect a correction: ${AGENTS[it.agent].n} needed ${a.att.toFixed(1)} retries on average. ≈${nfmt(tok)} tokens · ~$${u.toFixed(2)} vs ~${h} min of yours.`];
  return['agent',`Delegate: ≈${nfmt(tok)} tokens · ~$${u.toFixed(2)} vs ~${h} min of yours. Your review stays.`];}

/* ───── tasks panel and issue view ───── */
const TK=LS.get('tk6',{sprint:-1,who:'all',open:{backlog:false,done:false}});const saveTK=()=>LS.set('tk6',TK);
const STC={backlog:'var(--fg-muted)',todo:'var(--blue)',dev:'var(--yellow)',test:'var(--purple)',func:'var(--accent)',done:'var(--green)'};
function ownerName(i){return i.owner==='you'?'You':AGENTS[i.agent].n;}
RP.tasks=()=>window.renderTasksPane();/* corpo migrado p/ features/tasks.ts; shim delega (lazy, no switch de pane) */
function openIssue(id){openTab({id:'issue:'+id,title:id,kind:'issue',issue:id});}
VIEW.issue=(t,host)=>{const i=BL.issues.find(x=>x.id===t.issue);if(!i){host.innerHTML='<div class="empty">Issue not found.</div>';return;}const si=STAGES.findIndex(s=>s[0]===i.stage),ad=advice(i),c=i.cost;
  host.innerHTML=`<div class="page" style="max-width:820px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="kc-id">${i.id}</span><span class="tag ${i.type==='fix'?'bad':''}">${i.type}</span><span class="tag">Sprint ${i.sprint+1}</span><span class="tag">${i.pts} pts</span></div><h1 class="notr">${esc(i.title)}</h1>
   <div class="iss-flow">${STAGES.map(([k,l],n)=>`<span class="${n<si?'ok':n===si?'cur':''}">${l}</span>`).join('<i>›</i>')}</div>
   <h2>Ownership</h2><div class="tbl-wrap"><div class="rowline"><span class="av" style="background:${i.owner==='you'?'#8a8f9c':AGENTS[i.agent].col}">${ownerName(i).charAt(0)}</span><b>${ownerName(i)}</b><span style="color:var(--fg-muted)">${i.owner==='you'?'you write it, the assistants review':AGENTS[i.agent].d}</span><span class="sp"></span>${i.owner==='you'?`<button class="mini" onclick="BL.issues.find(x=>x.id==='${i.id}').owner=null;show(cur)">Give back to ${AGENTS[i.agent].n}</button>`:['backlog','todo','dev'].includes(i.stage)?`<button class="mini" onclick="BL.issues.find(x=>x.id==='${i.id}').owner='you';show(cur);if(PANE==='tasks')RP.tasks()">Take it myself</button>`:''}</div>
    ${i.branch?`<div class="rowline"><span>Branch</span><code class="notr">${esc(i.branch)}</code><span class="sp"></span>${i.merged?`<span class="tag live">merged ${i.merged}</span>`:''}</div>`:''}</div>
   <h2>Delegate or do it yourself?</h2><div class="adv ${ad[0]}">${svg('bulb')}<div>${ad[1]}<small>Rule of thumb from this project's history; 1 point ≈ ${MIN_PER_PT} min of your time. Rates are example values per million tokens.</small></div></div>
   <h2>Cost</h2><div class="tbl-wrap">${c?`<div class="rowline"><span>Tokens</span><span class="sp"></span><b>${nfmt(c.tok)}</b></div><div class="rowline"><span>Estimated spend</span><span class="sp"></span><b>$${c.usd.toFixed(3)}</b></div><div class="rowline"><span>Agent time</span><span class="sp"></span><b>${c.sec.toFixed(1)} s</b><span style="color:var(--fg-muted);font-size:11px">accelerated in the prototype</span></div><div class="rowline"><span>Runs · corrections</span><span class="sp"></span><b>${c.runs} · ${i.attempts}</b></div><div class="rowline"><span>By model</span><span class="sp"></span>${Object.entries(c.by).map(([p,v])=>`<span class="tag"><span class="pdot" style="background:${PROV[p].col}"></span> ${PROV[p].name} ${nfmt(v)}</span>`).join(' ')}</div>`:'<div class="rowline" style="color:var(--fg-muted)">Not run by an assistant yet.</div>'}</div>
   ${i.res?`<h2>Automatic tests</h2><div class="tbl-wrap">${i.res.map(r=>`<div class="rowline"><span style="color:${r.ok?'var(--green)':'var(--red)'}">${r.ok?'✓':'✖'}</span><code class="notr">${esc(r.n)}</code></div>`).join('')}</div>`:''}
   ${i.explain?`<h2>Your explanation</h2><div class="adv you">${svg('review')}<div class="notr">${esc(i.explain)}</div></div>`:''}${i.note?`<div class="sub" style="margin-top:10px">${esc(i.note)}</div>`:''}
   <h2>Actions</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${['backlog','todo','dev'].includes(i.stage)&&i.owner!=='you'?`<button class="mini pri" onclick="delegate('${i.id}')">▶ Delegate to ${AGENTS[i.agent].n}</button>`:''}${i.stage==='dev'&&i.owner==='you'?`<button class="mini pri" onclick="dropIssue('${i.id}','test')">Send to automatic test</button>`:''}${i.stage==='func'?`<button class="mini pri" onclick="reviewIssue('${i.id}')">Review diff</button><button class="mini" onclick="rejectIssue('${i.id}')">✗ Reject</button>`:''}<button class="mini" onclick="openBoard()">Open the board</button></div></div>`;};
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
   secrets pela fachada-alias de arranque `window.envPrime()`. */
const _dxDeploy6=dxDeploy;dxDeploy=function(){const r=_dxDeploy6();if(r&&r.ok&&K8S){K8S.ver=GIT.refs.develop;K8S.at=Date.now();window.envPrime();}return r;};
VIEW.envs=(t,host)=>window.renderEnvsView(t,host);/* corpo migrado p/ features/infra.ts; shim delega */

/* ───── design vs reality / drift (decora Studio: drawStudio/VIEW.studio de app.ts) ─────
   O relatório de drift e o mapa de estilos das etiquetas vivem em features/infra.ts; aqui
   as decorações lêem-nos pelas fachadas-alias `window.envDrift()` e `window.envDriftStyle`
   (sem o substring migrado). O estado DRIFT é window.DRIFT (inicializado na feature); ENVL
   é a fachada publicada pela feature. */
const _drawStudio6=drawStudio;drawStudio=function(){_drawStudio6();if(!DRIFT)return;const s=$('#st-svg');if(!s)return;const r=window.envDrift(DRIFT);
  s.querySelectorAll('g[data-n]').forEach(g=>{const x=r.out[g.dataset.n];if(!x)return;const[c,l]=window.envDriftStyle[x.st];g.querySelector('rect').setAttribute('stroke',c);g.querySelector('rect').setAttribute('stroke-dasharray',x.st==='sync'?'':'4 3');const te=g.querySelector('text[text-anchor="end"]');if(te)te.remove();g.insertAdjacentHTML('beforeend',`<rect x="${NW-76}" y="6" width="70" height="14" rx="7" fill="${c}" opacity=".18"/><text x="${NW-41}" y="16.5" text-anchor="middle" fill="${c}" font-size="8.5" font-weight="700" font-family="var(--font-mono)">${l}</text>`);});
  const ins=$('#st-insp');if(ins&&!SSEL&&SLINK===null){const cnt=k=>Object.values(r.out).filter(x=>x.st===k).length;ins.insertAdjacentHTML('afterbegin',`<h3>Design vs ${ENVL[DRIFT]}</h3>${!r.s?`<p>${ENVL[DRIFT]} has nothing deployed yet.</p>`:`<p>${cnt('sync')} in sync · ${cnt('drift')+cnt('behind')} drifting · ${cnt('missing')+cnt('bad')} missing or failing</p>${SD.nodes.filter(n=>r.out[n.id].st!=='sync').map(n=>`<div class="st-f ${['bad','missing'].includes(r.out[n.id].st)?'e':'w'}"><span>●</span><div><b class="notr">${esc(n.n)}</b> — <span class="notr">${esc(r.out[n.id].why)}</span></div></div>`).join('')}${r.extra.map(x=>`<div class="st-f w"><span>●</span><div><b class="notr">${esc(x)}</b> — running, but not in the design</div></div>`).join('')}`}<hr style="border:0;border-top:1px solid var(--seam);margin:12px 0">`);}};
VIEW.studio=(t,host)=>{window.renderStudioView(t,host);const b=host.querySelector('.st-bar .sp');if(b)b.insertAdjacentHTML('beforebegin',`<select class="mini" title="Compare the design with what is running" onchange="DRIFT=this.value||null;drawStudio()"><option value="">Compare with…</option>${Object.entries(ENVL).map(([k,l])=>`<option value="${k}"${DRIFT===k?' selected':''}>${l}</option>`).join('')}</select>`);};

/* ───── logs and metrics ───── */
/* ───── logs and metrics / observabilidade (motor extraído p/ features/infra.ts) ─────
   O motor de observabilidade (estado, RNG, séries temporais, mini-gráficos, openObserve) e
   o corpo de VIEW.observe vivem na feature. Aqui ficam o shim de VIEW.observe e o override
   de ctlLogs (de v5 — passa a abrir o tab de observabilidade em vez dos logs do terminal);
   openObserve resolve no window. */
VIEW.observe=(t,host)=>window.renderObserveView(t,host);/* corpo migrado p/ features/infra.ts; shim delega */
ctlLogs=n=>openObserve('local',n);
RP.infra=()=>window.renderInfraPane();/* corpo migrado p/ features/infra.ts (base v5 + decoração v6 dobradas); shim delega */

/* ───── Debug assistant (motor extraído p/ features/debug.ts) ─────
   Aqui ficam só os helpers de lexer partilhados com renderHood/reviewFindings
   (lexVariant/LXL, publicados no window) e o shim RP.debug→window.renderDebugPane.
   O estado é lido por fachadas sem substring proibido: window.dbgState()/dbgBreaks/dbgLaunch(). */
function lexVariant(){const c=FS[P_LX]?FS[P_LX].content:'';if(lexBug())return'bug';if(/for c in chars\.clone\(\)/.test(c))return'clone';if(/for c in chars\.by_ref\(\)/.test(c))return'byref';if(/while let Some\(c\) = chars\.next\(\)/.test(c))return'whilelet';return'other';}
const LXL=re=>{const ls=(FS[P_LX]?FS[P_LX].content:'').split('\n');return ls.findIndex(l=>re.test(l))+1;};
RP.debug=()=>window.renderDebugPane();/* corpo migrado p/ features/debug.ts; shim delega (lazy, no switch de pane) */

/* ───── extensions (Open VSX) ─────
   Motor (catálogo, estado instalado, instalar/remover/alternar, comandos, VSIX,
   formatador) migrado p/ features/ext.ts — par render+engine; inversão Debug/SCM —
   e publicado no window. Aqui ficam só os shims (RP.ext→renderExtPane,
   VIEW.extd→renderExtd) e as decorações que DECORAM globais do app.ts (diagnostics/
   paintEd — têm de carregar depois do app.ts), que lêem o motor por fachada-alias sem
   o substring migrado: window.vsxOn(id)/vsxFmt()/vsxCmds(). */
RP.ext=()=>window.renderExtPane();/* corpo migrado p/ features/ext.ts; shim delega (lazy, no switch de pane) */
VIEW.extd=(t,host)=>window.renderExtd(t,host);/* corpo migrado p/ features/ext.ts; shim delega */
const _diag6=diagnostics;diagnostics=function(){const d=_diag6();if(!window.vsxOn('redhat.vscode-yaml'))return d;Object.keys(FS).filter(p=>/\.ya?ml$/.test(p)).forEach(p=>{const ls=FS[p].content.split('\n');ls.forEach((l,i)=>{if(/^\t/.test(l))d.push({p,line:i+1,sev:'e',msg:'yaml: tabs are not allowed for indentation'});});
  if(/deploy\/k8s\//.test(p))FS[p].content.split(/^---$/m).reduce((off,doc)=>{if(/^kind:\s*Deployment/m.test(doc)&&!/resources:/.test(doc)){const ln=off+doc.split('\n').findIndex(l=>/^kind:\s*Deployment/.test(l))+1;d.push({p,line:Math.max(1,ln),sev:'w',msg:'yaml(k8s): Deployment without resources.requests/limits'});}return off+doc.split('\n').length;},0);});return d;};
const _paintEd6=paintEd;paintEd=function(p){_paintEd6(p);const gut=$('#ed-gut'),hl=$('#ed-hl');if(!gut||!hl)return;const gs=gut.children,ls=hl.children;
  [...window.dbgBreaks].filter(b=>b.startsWith(p+':')).forEach(b=>{const g=gs[+b.split(':').pop()-1];if(g)g.classList.add('bp');});
  const _ds=window.dbgState();if(_ds&&_ds.kind==='code'&&p===P_LX){const s=_ds.steps[_ds.i];if(s&&ls[s.l-1]){ls[s.l-1].classList.add('dbg-cur');if(gs[s.l-1])gs[s.l-1].classList.add('dbg-cur');}}
  if(window.vsxOn('usernamehw.errorlens')){const seen={};diagnostics().filter(x=>x.p===p).forEach(x=>{if(seen[x.line])return;seen[x.line]=1;const l=ls[x.line-1];if(l)l.insertAdjacentHTML('beforeend',`<span class="el ${x.sev}">  ${esc(x.msg)}</span>`);});}};

/* ───── Explain · Code review · Under the hood ───── */
function curFile(){const t=tabOf(cur);if(t&&t.path&&FS[t.path])return t.path;const c=changes();return c[0]||P_LX;}
const KNOW={
 [P_LX]:`<b>What it does.</b> <code>tokenize</code> walks a string once and turns each ASCII digit into <code>Token::Num</code>, then appends <code>Token::Eof</code> when the input is exhausted.<br><b>How.</b> <code>chars()</code> yields characters; <code>.peekable()</code> adds a one-item look-ahead so the code can ask “is there anything left?” without consuming it.<br><b>The subtle part.</b> The Eof decision depends on <code>chars</code> being exhausted <i>after</i> the loop — so whatever the loop iterates over must be the same iterator, not a copy and not something it takes ownership of.`,
 [ROOT+'crates/store/src/conversations.rs']:`<b>What it does.</b> The Repository for conversations: a trait (<code>ConversationRepo</code>) that callers depend on, and a SQLite implementation behind it (ADR-002).<br><b>Why the trait.</b> The UI and the tests depend on the operations, not on SQLite — swapping storage or mocking it needs no UI change.<br><b>Watch.</b> <code>list_recent</code> promises “most recent first”, so its SQL needs <code>ORDER BY created_at DESC</code> and an index that covers it.`,
 [P_HIST]:`<b>What it does.</b> Renders the “History” section: asks the backend (a Tauri command) for recent conversations and draws a button per conversation.<br><b>Layering.</b> No SQL here — it only talks to the command, as ADR-002 requires.<br><b>Watch.</b> Titles are user text inserted with <code>innerHTML</code>; they must be escaped or set with <code>textContent</code>.`};
function explainCmd(fromDebug){const p=curFile(),sel=fromDebug?'':selText(),f=FS[p];focusAgent(true);const _ds=window.dbgState();
  const what=fromDebug&&_ds?`the debugging session I just ran (${_ds.end?_ds.end.t:''})`:sel?`this excerpt from ${short(p)}`:short(p);
  if(SAMPLE&&PROV.claude.on){ACTIVE='claude';updateAgentUI();liveChat(fromDebug&&_ds?`Explain in depth, as a senior engineer teaching me, what this debug session found and the underlying concept:\n${_ds.feed.map(x=>x.h.replace(/<[^>]+>/g,'')).join('\n')}`:`Explain ${what}: what it does, how, and what a senior would watch out for. Be concrete.\n${sel||f.content.slice(0,5000)}`);return;}
  user(`Explain ${what}.`);const sy=symbols(p),dg=diagnostics().filter(d=>d.p===p),rv=reviewFindings(p).slice(0,2);
  card('co-dev · explain',`${fromDebug&&_ds&&_ds.end?`<p>${_ds.end.b}</p>`:KNOW[p]?`<p>${KNOW[p]}</p>`:`<p><b>${esc(short(p))}</b> — ${f.content.split('\n').length} lines${sy.length?`, defines ${sy.slice(0,6).map(s=>`<code>${esc(s.n)}</code>`).join(', ')}`:''}.</p>${(f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m)||[])[2]?`<p>${esc(f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m)[2])}</p>`:''}`}
   ${dg.length?`<p><b>Right now:</b> ${dg.map(d=>esc(d.msg)).join('; ')}.</p>`:''}${rv.length?`<p><b>What I would watch:</b></p><ul>${rv.map(r=>`<li>${r.t} (line ${r.l})</li>`).join('')}</ul>`:''}<p style="color:var(--fg-dim)">With Claude live, Explain answers about the exact code or selection instead of this summary.</p>`);}
function reviewFindings(p){const f=FS[p];if(!f)return[];const ls=f.content.split('\n'),ext=extOf(p),out=[],add=(l,sev,t,why,fix)=>out.push({l,sev,t,why,fix}),each=(re,fn)=>ls.forEach((x,i)=>{if(re.test(x))fn(i+1,x);});
  if(ext==='rs'){if(p===P_LX&&lexBug())add(LXL(/chars\.peek/),'bug','Iterator used after being moved (E0382)','The <code>for</code> loop takes ownership of <code>chars</code>; the later <code>peek()</code> cannot use it.','Borrow it for the loop: <code>for c in chars.by_ref()</code>.');
    each(/for \w+ in \w+\.clone\(\)/,l=>add(l,'bug','Loop iterates over a clone of the iterator','The original iterator never advances, so any check after the loop (like <code>peek()</code>) sees stale state.','Use <code>.by_ref()</code> to keep one cursor.'));
    each(/\.unwrap\(\)/,l=>{if(!/#\[test\]|tests\//.test(f.content.slice(0,200))&&!/test/.test(p))add(l,'risk','unwrap() on a fallible value','Panics on bad input and takes the whole service down.','Return a typed error with <code>?</code> or map it.');});
    each(/SELECT .* LIMIT/,l=>{if(!/ORDER BY/.test(ls[l-1]))add(l,'bug','LIMIT without ORDER BY','SQLite returns rows in whatever order is cheapest; “recent” lists become arbitrary.','Add <code>ORDER BY created_at DESC</code> and an index on (filter, order) columns.');});}
  if(['ts','js','jsx'].includes(ext)){each(/innerHTML\s*=.*\$\{/,l=>add(l,'risk','User text interpolated into innerHTML','A title like <code>&lt;img src=x onerror=…&gt;</code> runs script in the app.','Escape the values or build nodes with <code>textContent</code>.'));
    if(/await invoke/.test(f.content)&&!/try\s*\{/.test(f.content))add(ls.findIndex(x=>/await invoke/.test(x))+1,'risk','Backend call without error handling','If the command fails the section stays half-drawn and the promise rejection is unhandled.','Wrap in try/catch and render the error state the Design System requires.');
    each(/:\s*any\b/,l=>add(l,'style','any disables type checking','Mistakes in this value will not be caught by tsc.','Give it a real type.'));}
  dsLint().filter(v=>v.p===p).forEach(v=>add(v.line,'style',`Fixed colour ${v.hex}`,'Breaks theming and the Design System rule §4.','Use a token, e.g. <code>var(--accent)</code>.'));
  if(ext==='sql'){const idx=f.content.match(/CREATE INDEX[^;]*/g)||[];each(/REFERENCES\s+(\w+)/,(l,x)=>{const col=(x.match(/^\s*(\w+)/)||[])[1];if(col&&!idx.some(s=>new RegExp('\\(\\s*'+col).test(s)))add(l,'perf',`Foreign key ${col} has no index`,'Cascade deletes and joins on this column scan the whole child table.',`<code>CREATE INDEX … ON …(${col})</code>.`);});}
  if(/Dockerfile$/.test(p)){if(!/^USER /m.test(f.content)&&!/nonroot|unprivileged/.test(f.content))add(1,'risk','Container runs as root','A compromise of the app is a compromise of the container\'s root.','Add a non-root <code>USER</code>.');each(/^FROM \S+:latest/,l=>add(l,'risk','Unpinned base image','Builds change under you.','Pin a version or digest.'));
    if(/COPY src/.test(f.content)&&/cargo build/.test(f.content))add(ls.findIndex(x=>/COPY src/.test(x))+1,'perf','Dependencies rebuild on every source change','Copying <code>src</code> before building invalidates the dependency layer.','Build dependencies with only <code>Cargo.toml</code>/<code>Cargo.lock</code> first, then copy <code>src</code>.');}
  if(/docker-compose\.yml$/.test(p))each(/^      - [a-z][\w-]*$/,l=>{if(/depends_on/.test(ls.slice(Math.max(0,l-4),l).join('')))add(l,'risk','depends_on without a health condition','The app starts before its database accepts connections.','Use <code>condition: service_healthy</code>.');});
  if(/deploy\/k8s\/.*\.yaml$/.test(p)){if(/kind: Deployment/.test(f.content)&&!/resources:/.test(f.content))add(ls.findIndex(x=>/kind: Deployment/.test(x))+1,'risk','No resource requests or limits','The scheduler cannot place it well and one pod can starve the node.','Set <code>resources.requests</code> and <code>limits</code>.');if(/stringData:/.test(f.content))add(ls.findIndex(x=>/stringData:/.test(x))+1,'risk','Secret values in plain text in git','Anyone with repo access reads them.','Use SOPS, Sealed Secrets or an external secrets operator.');}
  return out.sort((a,b)=>['bug','risk','perf','style'].indexOf(a.sev)-['bug','risk','perf','style'].indexOf(b.sev));}
function reviewCmd(){const p=curFile();openTab({id:'creview:'+p,title:'Review · '+p.split('/').pop(),kind:'creview',path:p});}
const SEVC={bug:'var(--red)',risk:'var(--yellow)',perf:'var(--blue)',style:'var(--fg-muted)'};
VIEW.creview=(t,host)=>{const fs=reviewFindings(t.path),score=Math.max(0,100-fs.reduce((a,f)=>a+({bug:25,risk:12,perf:8,style:3})[f.sev],0));
  host.innerHTML=`<div class="page" style="max-width:860px"><div style="display:flex;align-items:center;gap:14px"><div class="score ${score>=THRESH?'ok':'bad'}">${score}<small>/100</small></div><div><h1 style="margin:0">Code review</h1><div class="sub notr" style="margin:0">${esc(short(t.path))}</div></div><span style="flex:1"></span><button class="mini" onclick="openPath('${t.path}')">Open file</button>${SAMPLE&&PROV.claude.on?`<button class="mini pri" onclick="focusAgent(true);liveChat('Review this file as a senior engineer: bugs first, then risks, performance and style. Cite line numbers.\\n'+FS['${t.path}'].content.slice(0,6000))">Deeper review with Claude</button>`:''}</div>
   <div class="sub" style="margin-top:12px">Rule-based checks for correctness, security, performance and the project rules. They point at evidence; you decide what to change.</div>
   ${fs.length?fs.map(f=>`<div class="rv"><div class="rv-h"><span class="tag" style="color:${SEVC[f.sev]};border-color:${SEVC[f.sev]}">${f.sev}</span><b>${f.t}</b><span class="sp"></span><button class="lnk" onclick="openPath('${t.path}',${f.l})">line ${f.l}</button></div><div class="rv-b"><p>${f.why}</p><p><b>Suggested:</b> ${f.fix}</p></div></div>`).join(''):'<div class="adv agent" style="margin-top:16px">'+svg('check')+'<div>No findings from the rule set. That is not proof of correctness — the tests are.</div></div>'}</div>`;};
function hoodCmd(){const p=curFile();openTab({id:'hood:'+p,title:'Under the hood · '+p.split('/').pop(),kind:'hood',path:p});}
VIEW.hood=(t,host)=>{const p=t.path,f=FS[p],ext=extOf(p),stg=(n,ok,d)=>`<div class="hs ${ok===false?'bad':ok===null?'skip':'ok'}"><span>${ok===false?'✖':ok===null?'○':'✓'}</span><div><b>${n}</b><small>${d}</small></div></div>`;let h='';
  if(ext==='rs'){const bug=p===P_LX&&lexBug(),v=p===P_LX?lexVariant():'';h=`<h2>Compiler pipeline</h2><div class="hood-p">${stg('Lex & parse',true,'source → tokens → syntax tree')}${stg('Name resolution & macros',true,'paths, use statements, derive(Debug, PartialEq)')}${stg('Type check',true,'every expression gets a type')}${stg('Borrow check',!bug,bug?`<code>chars</code> moved into the loop at line ${LXL(/for c in/)}, used again at line ${LXL(/chars\.peek/)} (E0382)`:'ownership and lifetimes verified')}${stg('MIR & optimisation',bug?null:true,bug?'not reached':'mid-level IR, inlining of the iterator chain')}${stg('LLVM codegen',bug?null:true,bug?'not reached':'machine code for x86-64 / aarch64')}</div>`;
    if(p===P_LX)h+=`<h2>Memory</h2><div class="tbl-wrap"><table class="tbl"><tr><th>Value</th><th>Where</th><th>Size</th><th>Why</th></tr><tr><td><code>Token</code></td><td class="c">—</td><td>4 bytes</td><td class="c"><code>Num(char)</code> and <code>Eof</code> fit in one <code>char</code>: Eof uses an invalid code point as its tag (niche optimisation).</td></tr><tr><td><code>tokens: Vec&lt;Token&gt;</code></td><td class="c">stack + heap</td><td>24 B + 4×cap</td><td class="c">pointer, capacity, length on the stack; the first push allocates capacity 4.</td></tr><tr><td><code>chars: Peekable&lt;Chars&gt;</code></td><td class="c">stack</td><td>≈24 bytes</td><td class="c">two pointers into the string plus the peeked slot; no heap allocation.</td></tr></table></div>
      <h2>Ownership of <code>chars</code></h2><div class="hood-o">${[['line '+LXL(/let mut chars/),'created','owned by tokenize'],['line '+LXL(/for c in|while let/),v==='bug'?'moved':v==='clone'?'copied':'borrowed (&mut)',v==='bug'?'into_iter() takes it — gone after the loop':v==='clone'?'loop owns a second cursor; the original never moves':'loop advances the same cursor, then gives it back'],['line '+LXL(/chars\.peek/),v==='bug'?'✖ use after move':'used',v==='bug'?'rejected by the borrow checker':v==='clone'?"peek() sees '1' — Eof skipped":'peek() sees the end — Eof pushed']].map(x=>`<div><b>${x[0]}</b><span class="tag ${/✖|copied/.test(x[1])?'bad':''}">${x[1]}</span><small>${x[2]}</small></div>`).join('')}</div><div class="sub">Time O(n), one pass; memory O(n) for the tokens.</div>`;}
  if(ext==='rs'&&/SELECT/.test(f.content))h+=qplan(f);
  else if(ext==='sql')h=qplan(f);
  function qplan(f){const q=(f.content.match(/SELECT[^"]*/)||[])[0],idx=Object.keys(FS).some(k=>/migrations/.test(k)&&/CREATE INDEX idx_conversations_ws_created/.test(FS[k].content));return `<h2>Query plan</h2><div class="sub">What SQLite's planner does with the listing query, derived from the migrations in this workspace.</div><pre class="hood-q notr">${esc(q||'SELECT … FROM conversations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')}</pre><div class="hood-p">${idx?stg('SEARCH conversations USING INDEX idx_conversations_ws_created (workspace_id=?)',true,'jumps to the workspace, rows already in created_at order — no sort'):stg('SCAN conversations',false,'reads every row of every workspace')+stg('USE TEMP B-TREE FOR ORDER BY',false,'sorts the matches in memory before applying LIMIT')}</div>`;}
  if(ext==='rs'||ext==='sql'){}else if(['ts','js','jsx'].includes(ext))h=`<h2>Build & runtime</h2><div class="hood-p">${stg('tsc type check',!/:\s*any\b/.test(f.content)||null,'types erased after checking')}${stg('esbuild / Vite transform',true,'TS → JS, one module per file in dev')}${stg('Bundle',true,'tree-shaken into the desktop app')}${/innerHTML/.test(f.content)?stg('innerHTML write',false,'the browser parses the string as HTML: costs a parse + style recalc, and runs any markup inside it'):''}${/invoke</.test(f.content)?stg('Tauri IPC',true,'JSON-serialised call into the Rust backend, async'):''}</div>`;
  else if(/Dockerfile$/.test(p))h=`<h2>Image layers</h2><div class="sub">Each instruction is a cached layer; a change invalidates it and every layer after it.</div><div class="hood-p">${f.content.split('\n').filter(l=>/^(FROM|COPY|RUN|USER|ENV|EXPOSE|CMD|ENTRYPOINT|WORKDIR)/.test(l)).map(l=>stg(esc(l),/^COPY src/.test(l)&&/cargo build/.test(f.content)?false:true,/^FROM/.test(l)?'base layer':/^COPY src/.test(l)?'changes on every edit — everything below rebuilds':/^RUN/.test(l)?'cached until a layer above changes':'metadata only')).join('')}</div>`;
  else if(/docker-compose\.yml$/.test(p)){const sv=composeServices()||[],order=[];const vis=s=>{if(order.includes(s))return;s.deps.forEach(d=>{const x=sv.find(y=>y.name===d);if(x)vis(x);});order.push(s);};sv.forEach(vis);h=`<h2>Start order</h2><div class="hood-p">${order.map((s,i)=>stg(`${i+1}. ${esc(s.name)}`,true,`${s.build?'build ./'+esc(s.build):esc(s.image||'')}${s.deps.length?' · after '+s.deps.map(esc).join(', '):''}${s.hc?' · healthcheck':''}`)).join('')}</div>`;}
  else h=`<div class="sub">${f.content.split('\n').length} lines · ${f.content.length} bytes. No deeper view for this file type yet.</div>`;
  host.innerHTML=`<div class="page" style="max-width:860px"><h1>Under the hood</h1><div class="sub notr">${esc(short(p))}</div>${h}<div class="sub" style="margin-top:20px">Derived from the code in this workspace. The desktop app adds measured CPU, memory and I/O from a real run.</div></div>`;};

/* ───── editor action bar, shortcuts, activity bar ───── */
const EACT=[['bulb','Explain','Ctrl+K E','explainCmd()'],['review','Code review','Ctrl+K R','reviewCmd()'],['bug','Debug','F5','startDebug()'],['run','RUN','Ctrl+F5','dxRun()'],['eye','Under the hood','Ctrl+K U','hoodCmd()']];
const _show6=show;show=function(id){_show6(id);const t=tabOf(cur),b=$('#breadcrumbs');if(!b||!t||!['file','diff'].includes(t.kind))return;b.insertAdjacentHTML('beforeend',`<span class="ed-acts">${EACT.map(a=>`<button title="${a[1]} (${a[2]})" onclick="${a[3]}">${svg(a[0])}<span>${a[1]}</span></button>`).join('')}</span>`);};
let CHORD=0;
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey,go=f=>{e.preventDefault();e.stopPropagation();f();};
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
  advice, boot6, costAvg, curFile, dlg, EACT, explainCmd, hoodCmd,
  lexVariant, LXL, openIssue, ownerName, reviewCmd, reviewFindings,
  saveTK, TK,
  // fachadas que as features migradas (features/*.ts) consomem por window:
  nfmt, STC
  // environments/drift/observabilidade migraram p/ features/infra.ts e são
  // publicados lá — removidos daqui (GOTCHA C).
});
