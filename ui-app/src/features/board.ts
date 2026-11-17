// @ts-nocheck
/* ═════════ dxtutor IDE — feature: backlog, sprints e kanban (estado + motor + produtor) ═════════
   Inversão de direcção (padrão Debug/SCM/Ext): o motor backlog/kanban, antes todo em
   `app.ts`, muda-se inteiro para cá. Como cruza o monólito @ts-nocheck e é denso,
   a feature assume `@ts-nocheck` como `scm.ts`/`debug.ts` (tipa-se depois).

   Fronteira (decisão do dono 2026-11-17 «geradores FICAM»): a feature DETÉM o estado
   (BL/STAGES), o CRUD (mkIssue/setStage/newIssue/rejectIssue/dropIssue/openBoard), o
   runner (runIssue/delegate/runSprint/approveIssue/autoTest), o PRODUTOR Studio→backlog
   (genBacklog/genBacklogIssues) e o corpo da vista (renderBoardView). Os GERADORES de
   projecto (composeYaml/dockerfile/appFiles/k8sYaml/cloudMap em app.ts, k8sInfra em
   v5.ts) FICAM donos do monólito e são lidos por global — tal como `features/studio.ts`
   já os lê. Os DECORADORES ficam onde estão a ler por global: app.ts (approveIssue+infra,
   AGENTS.*.paths), v5.ts (approveIssue/delegate/runSprint — codeGuard/review), v6.ts
   (runIssue custo, delegate/approveIssue ownership, VIEW.board duplo-clique+custo).

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica TODO o estado/funções no `window` no eval —
   os nomes livres do monólito (`AGENTS`, `routeModel`, `card(…)`, `SD`, …) resolvem no
   escopo GLOBAL em runtime (late-binding). Nada é lido ansiosamente no eval: `BL`/`STAGES`
   são literais puros; todo o resto são declarações de função tocadas só DEPOIS do arranque.

   Window-backing dos reatribuídos: runIssue/delegate/runSprint/approveIssue nascem como
   `window.X=function` (não função-léxica) porque o resíduo os DECORA (`const _x=X;X=function…`)
   e os chamadores internos (dropIssue→approveIssue, delegate/runSprint→runIssue) têm de
   acertar na versão DECORADA — `X` bare resolve em `window.X` no momento da chamada.
   VIEW.board é eager (VIEW só existe depois) → corpo aqui em `renderBoardView`, shim
   brace-less em app.ts (`VIEW.board=(t,host)=>window.renderBoardView(t,host)`), que v5/v6
   continuam a decorar. GOTCHA C: as defs saíram também do `Object.assign(window,…)` de app.ts. */

import { esc } from "../core";

/* `slug` é léxico em app.ts (NÃO publicado) e studio.ts tem a sua própria cópia local;
   o motor aqui (runIssue/genBacklogIssues) também precisa dele → cópia local idêntica. */
const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

/* estado — window-backed (objectos const + alias no window; onclick inline `BL.view=…`
   resolve em window.BL no escopo global). BL é sessão em memória, não vem de LS. */
const BL=(window.BL={issues:[],seq:11,mig:3,adr:4,view:-1});
const STAGES=(window.STAGES=[['backlog','Backlog'],['todo','A fazer'],['dev','Em desenvolvimento'],['test','Teste automático'],['func','Validação funcional'],['done','Concluído']]);
const exists=p=>()=>!!FS[p];
function mkIssue(o){const it=Object.assign({id:'DX-'+(BL.seq++),type:'feature',pts:3,stage:'backlog',attempts:0,tests:[],res:null,note:'',model:null,branch:null},o);BL.issues.push(it);return it;}

/* CRUD + runner (motor) — runIssue/delegate/runSprint/approveIssue window-backed p/ decoração */
function openBoard(){openTab({id:'board',title:'Quadro',kind:'board'});}
function setStage(it,st){it.stage=st;if(it.node){const n=SD.nodes.find(x=>x.id===it.node),all=BL.issues.filter(i=>i.node===it.node);if(n){n.st=all.every(i=>i.stage==='done')?'ok':'wip';saveSD();}}rerender('board');if(PANE==='codev'&&RP.codev)RP.codev();}
async function autoTest(it,host){const d=host?tl(host,'auto-test',it.id+' · disparado ao entrar em Teste'):null;await sleep(380);const res=it.tests.length?it.tests.map(t=>({n:t.n,ok:!!t.fn()})):[{n:'workspace::cargo_test',ok:runTests().ok},{n:'workspace::design_lint',ok:!dsLint().length}],ok=res.every(r=>r.ok),f=res.filter(r=>!r.ok).length;it.res=res;
  if(getVar('--panel-h')!=='0px')setPanelTab('terminal',true);echoCmd('dx test '+it.id);echo(`<span class="dim">running ${res.length} tests (${esc(it.branch||BRANCH)})</span>\n`+res.map(r=>`test ${r.n} ... ${r.ok?'<span class="ok">ok</span>':'<span class="er">FAILED</span>'}`).join('\n')+`\n\ntest result: ${ok?'<span class="ok">ok</span>':'<span class="er">FAILED</span>'}. ${res.length-f} passed; ${f} failed`);newInput(true);
  if(d)d.querySelector('.tr').innerHTML=`<span class="${ok?'okc':'bad'}">${ok?'✓':'✖'} ${res.length-f}/${res.length}</span>`;log('auto-test',`${it.id}: ${res.length-f}/${res.length} ${ok?'— passa para validação funcional':'— volta a desenvolvimento'}`);return ok;}
window.runIssue = async function(it){const ag=AGENTS[it.agent];AUTHOR=it.agent;RUN.label=`${it.id} · ${ag.n}`;runLabel();
  const r=await routeModel(it.agent,it.title);it.model=r.p;const c=card(`${ag.n.toLowerCase()} · ${PROV[r.p].name.toLowerCase()}`,`<p><code>${it.id}</code> <b>${esc(it.title)}</b></p>`);
  tl(c.tools,'route_model',TASKP[ag.task].l.toLowerCase()).querySelector('.tr').innerHTML=`<span class="okc">${PROV[r.p].name}</span> <span style="color:var(--fg-muted)" title="${esc(r.why)}">${esc(r.by)}</span>`;await beat(300);
  it.branch=gfStart(it.type==='fix'?'fix':'feature',it.id+'-'+slug(it.title).slice(0,22));tl(c.tools,'gitflow','checkout -b '+it.branch).querySelector('.tr').innerHTML='<span class="okc">✓</span>';setStage(it,'dev');await beat(300);
  const apply=async(files,msg)=>{let n=0;for(const f of files){if(!inScope(it.agent,f.p)){const o=ownerOf(f.p),sub=mkIssue({agent:o,pts:2,sprint:it.sprint,stage:'todo',node:it.node,title:`${short(f.p).split('/').pop()} (delegated by ${it.id})`,gen:()=>[{p:f.p,content:f.content}],fix:f.fix?()=>[{p:f.p,content:f.fix}]:null,fixNote:f.fixNote,tests:f.tests||[{n:`harness::${slug(short(f.p).split('/').pop()).replace(/-/g,'_')}`,fn:exists(f.p)}]});
        tl(c.tools,'harness',short(f.p)).querySelector('.tr').innerHTML=`<span class="bad">✖ fora do escopo</span> → <span style="color:${AGENTS[o].col}">${AGENTS[o].n}</span> <code>${sub.id}</code>`;log('harness',`${ag.n} bloqueado em ${short(f.p)} → ${sub.id} para ${AGENTS[o].n}`);rerender('board');await beat(350);continue;}
      if(++n>ag.max){tl(c.tools,'harness','limite de ficheiros').querySelector('.tr').innerHTML='<span class="bad">✖ excedido</span>';break;}await doTool({t:'edit',p:f.p,content:f.content},c.tools);}
    STAGED.clear();files.forEach(f=>{if(FS[f.p]&&stOf(f.p)&&inScope(it.agent,f.p))STAGED.add(f.p);});if(STAGED.size){const k=commitGit(msg,it.agent);if(k)tl(c.tools,'git commit',msg).querySelector('.tr').innerHTML=`<span class="okc">${k.h}</span>`;}};
  await apply(it.gen(),`${it.type==='fix'?'fix':'feat'}: ${it.title} (${it.id})`);
  setStage(it,'test');let ok=await autoTest(it,c.tools);
  if(!ok&&it.fix){it.attempts++;setStage(it,'dev');const bad=it.res.filter(x=>!x.ok).map(x=>x.n).join(', ');it.note='reprovado em teste: '+bad;c.bd.insertAdjacentHTML('beforeend',`<p><span class="tag bad">teste falhou</span> <code>${esc(bad)}</code> — a issue voltou a desenvolvimento. Correcção: ${it.fixNote}.</p>`);await beat(500);
    await apply(it.fix(),`fix: ${it.title} — fix test (${it.id})`);setStage(it,'test');ok=await autoTest(it,c.tools);}
  if(ok){it.note=it.attempts?`passou à ${it.attempts+1}.ª tentativa`:'';setStage(it,'func');c.bd.insertAdjacentHTML('beforeend','<p><span class="tag live">testes passaram</span> à espera da tua validação funcional no quadro.</p>');}
  else{it.note='testes continuam a falhar — precisa de orientação';setStage(it,'dev');c.bd.insertAdjacentHTML('beforeend','<p><span class="tag bad">bloqueada</span> os testes continuam a falhar.</p>');}
  use(r.p,2600);checkout('develop');AUTHOR='w';await beat(250);}
window.delegate = async function(id){if(RUN.active){toast('Há uma execução em curso');return;}const it=BL.issues.find(i=>i.id===id);if(!it)return;focusAgent(true);
  if(it.custom){AGENT=it.agent;agentPill();setStage(it,'dev');handlePrompt(`Implementa a issue ${it.id}: ${it.title}`);return;}
  user(`Delega ${it.id} a ${AGENTS[it.agent].n}.`);runState(true,it.id);try{await runIssue(it);}catch(e){if(e===STOP)card('co-dev','Execução parada a teu pedido.');else{console.error(e);card('sistema','Erro: '+esc(e.message||e));}}finally{if(BRANCH!=='develop')checkout('develop');AUTHOR='w';runState(false);refresh();rerender('board');scrollMsgs();}}
window.runSprint = async function(s){if(RUN.active){toast('Há uma execução em curso');return;}BL.issues.forEach(i=>{if(i.sprint===s&&i.stage==='backlog')i.stage='todo';});rerender('board');const todo=()=>BL.issues.find(i=>i.sprint===s&&i.stage==='todo'&&!i.custom);
  if(!todo()){toast('Não há issues por fazer no Sprint '+(s+1));return;}focusAgent(true);user(`Executa o Sprint ${s+1}.`);runState(true,'Sprint '+(s+1));let n=0;
  try{let it;while((it=todo())){if(MODE==='manual'){const c=card('co-dev',`<p>Próxima issue: <code>${it.id}</code> ${esc(it.title)} → <b>${AGENTS[it.agent].n}</b></p>`);const v=await ask(c.bd,[{l:'Delegar',v:1,pri:1,done:'✓ delegada por ti'},{l:'Parar o sprint',v:0}]);if(!v)throw STOP;}await runIssue(it);n++;}
    const f=BL.issues.filter(i=>i.sprint===s&&i.stage==='func').length,b=BL.issues.filter(i=>i.sprint===s&&i.stage==='dev').length;card('co-dev',`<p><b>Sprint ${s+1}</b>: ${n} issues trabalhadas. <b>${f}</b> passaram nos testes automáticos e esperam a tua validação funcional${b?`; <b>${b}</b> ficaram bloqueadas em desenvolvimento`:''}.</p><p style="color:var(--fg-dim)">Cada issue está no seu ramo <code>feature/…</code>; o merge em <code>develop</code> acontece quando validares.</p><div class="gate"><button class="gb pri" onclick="openBoard()">Validar no quadro</button><button class="gb" onclick="openGraph()">Ver o grafo</button></div>`);note(`Sprint ${s+1}: ${f} issues à espera de validação funcional`);
  }catch(e){if(e===STOP)card('co-dev','Sprint parado a teu pedido.');else{console.error(e);card('sistema','Erro: '+esc(e.message||e));}}finally{if(BRANCH!=='develop')checkout('develop');AUTHOR='w';runState(false);refresh();rerender('board');scrollMsgs();}}
window.approveIssue = function(id){const it=BL.issues.find(i=>i.id===id);if(!it||it.stage!=='func')return;if(RUN.active){toast('Espera que a execução termine');return;}if(it.branch&&GIT.refs[it.branch]){const m=gfFinish(it.branch,'w');it.merged=m?m.h:null;}it.note='';setStage(it,'done');toast(`${it.id} validada · merge em develop`);}
function rejectIssue(id){const it=BL.issues.find(i=>i.id===id);if(!it)return;palette('',{ph:'Porque rejeitas? (fica como nota na issue)',verb:'Rejeitar',text:q=>{it.note='rejeitada na validação funcional'+(q.trim()?': '+q.trim():'');it.res=null;setStage(it,'dev');}});}
async function dropIssue(id,st){const it=BL.issues.find(i=>i.id===id);if(!it||it.stage===st)return;if(RUN.active){toast('Espera que a execução termine');return;}
  if(st==='done'){if(it.stage!=='func'){toast('Só passa a Concluído depois da validação funcional');return;}approveIssue(id);return;}
  if(st==='test'||st==='func'){if(st==='func')toast('Antes da validação funcional correm os testes automáticos');if(it.branch&&GIT.refs[it.branch]&&BRANCH!==it.branch)checkout(it.branch);setStage(it,'test');const ok=await autoTest(it,null);if(BRANCH!=='develop')checkout('develop');it.note=ok?'':'reprovado em teste: '+it.res.filter(r=>!r.ok).map(r=>r.n).join(', ');setStage(it,ok?'func':'dev');toast(ok?`${it.id}: testes passaram → validação funcional`:`${it.id}: testes falharam → volta a desenvolvimento`);return;}
  setStage(it,st);}
function newIssue(){palette('',{ph:'Título da issue (prefixo "fix:" para correcções)',verb:'Criar issue',text:q=>{q=q.trim();if(!q)return;const fx=/^fix:/i.test(q);mkIssue({custom:true,type:fx?'fix':'feature',title:q.replace(/^fix:\s*/i,''),agent:'lead',sprint:BL.view<0?0:BL.view,stage:'todo',pts:2});rerender('board');}});}

/* corpo da vista — era `VIEW.board=(t,host)=>{…}` eager; aqui como função + shim em app.ts */
function renderBoardView(t,host){const v=BL.view,list=BL.issues.filter(i=>v<0||i.sprint===v),pts=list.reduce((a,i)=>a+i.pts,0),done=list.filter(i=>i.stage==='done').reduce((a,i)=>a+i.pts,0);
  const cardH=i=>{const a=AGENTS[i.agent],tr=i.res?`<span class="${i.res.every(r=>r.ok)?'okc':'bad'}">${i.res.every(r=>r.ok)?'✓':'✖'} ${i.res.filter(r=>r.ok).length}/${i.res.length} testes</span>`:'';
    return `<div class="kc" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${i.id}')"><div class="kc-h"><span class="kc-id">${i.id}</span><span class="tag ${i.type==='fix'?'bad':''}">${i.type}</span><span class="kc-p">${i.pts}</span></div><div class="kc-t">${esc(i.title)}</div><div class="kc-m"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${i.model?` · ${PROV[i.model].name}`:''}<span class="tag" style="margin-left:auto">S${i.sprint+1}</span></div>${i.branch&&i.stage!=='done'?`<div class="kc-b">⎇ ${esc(i.branch)}</div>`:''}${i.merged?`<div class="kc-b">merge ${i.merged} em develop</div>`:''}${tr||i.note?`<div class="kc-n">${tr}${i.note?`<span>${esc(i.note)}</span>`:''}</div>`:''}
     ${i.stage==='backlog'||i.stage==='todo'?`<button class="mini" onclick="delegate('${i.id}')">▶ Delegar a ${a.n}</button>`:i.stage==='dev'&&!RUN.active?`<button class="mini" onclick="delegate('${i.id}')">▶ Retomar</button>`:i.stage==='func'?`<div class="kc-a"><button class="mini pri" onclick="approveIssue('${i.id}')">✓ Validar</button><button class="mini" onclick="rejectIssue('${i.id}')">✗ Rejeitar</button></div>`:''}</div>`;};
  host.innerHTML=`<div class="kb"><div class="kb-bar"><b style="font-size:15px">Quadro</b>${[-1,0,1].map(s=>`<button class="mini${v===s?' pri':''}" onclick="BL.view=${s};rerender('board')">${s<0?'Tudo':'Sprint '+(s+1)}</button>`).join('')}<span class="kb-prog"><i style="width:${pts?done/pts*100:0}%"></i></span><span style="color:var(--fg-muted);font-size:11.5px">${done}/${pts} pts</span><span class="sp"></span><button class="mini" onclick="newIssue()">+ Issue</button><button class="mini" onclick="openStudio()">Studio</button><button class="mini pri" onclick="runSprint(${v<0?(BL.issues.some(i=>i.sprint===0&&['todo','backlog'].includes(i.stage))?0:1):v})">▶ Executar sprint</button></div>
   ${BL.issues.length?`<div class="kb-cols">${STAGES.map(([k,l])=>{const xs=list.filter(i=>i.stage===k);return `<div class="kcol" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="event.preventDefault();this.classList.remove('over');dropIssue(event.dataTransfer.getData('text/plain'),'${k}')"><div class="kcol-h">${l}<span class="cnt">${xs.length}</span></div>${k==='test'?'<div class="kcol-d">Ao entrar aqui os testes correm sozinhos. Falha → volta a desenvolvimento.</div>':k==='func'?'<div class="kcol-d">Só chega aqui o que passou nos testes. A validação é tua.</div>':''}${xs.map(cardH).join('')}</div>`;}).join('')}</div>`
   :`<div class="empty" style="height:60%"><div><b style="color:var(--fg-dim);font-size:14px">Backlog vazio</b><br>Desenha a arquitectura no Studio e gera o backlog a partir dos componentes planeados.<br><button class="mini pri" style="margin-top:10px" onclick="openStudio()">Abrir o Studio</button> <button class="mini" onclick="genBacklog()">Gerar a partir do desenho actual</button></div></div>`}</div>`;}

/* produtor Studio→backlog — lê os GERADORES (composeYaml/dockerfile/appFiles/k8sYaml/
   cloudMap de app.ts; k8sInfra de v5.ts) e o catálogo (TECH/KIND/isApp/sl/appDir de
   studio.ts) por global; só corre a pedido do utilizador, muito depois do arranque. */
function genBacklogIssues(plan){const D=JSON.parse(JSON.stringify(SD)),made=[],by=id=>D.nodes.find(n=>n.id===id),adr=ROOT+`.dxtutor/arquitectura/ADR-00${BL.adr++}-${slug(plan.slice(0,3).map(p=>p.n).join(' ')).slice(0,30)}.md`,apps=D.nodes.filter(isApp),C=ROOT+'docker-compose.yml';let firstApp=true;
  made.push(mkIssue({agent:'arq',pts:2,sprint:0,node:null,title:'ADR: '+plan.slice(0,3).map(p=>p.n).join(', ')+(plan.length>3?` +${plan.length-3}`:''),gen:()=>[{p:adr,content:`# ${adr.split('/').pop().replace('.md','')}\n\n**Status:** proposed\n\n**Context:** components designed in the Studio.\n\n**Decision:**\n${plan.map(p=>`- ${p.n} — ${TECH[p.tech].n}${TECH[p.tech].local?` (locally: ${TECH[p.tech].local})`:''}`).join('\n')}\n\n**Dependencies:**\n${D.edges.map(e=>`- ${by(e[0]).n} → ${by(e[1]).n}`).join('\n')}\n`}],tests:[{n:'adr::lists_decision_and_dependencies',fn:()=>has(adr,/\*\*Decision:\*\*/)&&has(adr,/\*\*Dependencies:\*\*/)}]}));
  plan.forEach(n=>{const T=TECH[n.tech],rs=sl(n).replace(/-/g,'_'),d=ROOT+appDir(n)+'/';
    if(T.kind==='app'){const bad=firstApp;firstApp=false;const main={rust:'src/main.rs',go:'src/main.go',node:'src/server.js',python:'src/main.py'}[T.rt];made.push(mkIssue({agent:'be',pts:5,sprint:0,node:n.id,title:`${n.n}: service skeleton (${T.n})`,gen:()=>appFiles(by(n.id),D,bad),tests:[{n:`${rs}::exposes_healthz`,fn:()=>has(d+main,/healthz/)},{n:`${rs}::reads_port_from_env`,fn:()=>has(d+main,/PORT/)}]}));}
    if(T.kind==='web')made.push(mkIssue({agent:'fe',pts:3,sprint:1,node:n.id,title:`${n.n}: web app (${T.n})`,gen:()=>appFiles(by(n.id),D,true),fix:()=>appFiles(by(n.id),D,false),fixNote:'replace the fixed colour with the <code>--accent</code> token',tests:[{n:`${rs}::builds_static_bundle`,fn:()=>has(d+'Dockerfile',/npm run build/)},{n:`${rs}::uses_design_tokens`,fn:()=>!!FS[d+'src/main.jsx']&&!has(d+'src/main.jsx',/#[0-9a-fA-F]{6}\b/)}]}));
    if(T.kind==='sql'||T.kind==='mssql'){const m=ROOT+`db/migrations/000${BL.mig++}_${rs}.sql`;made.push(mkIssue({agent:'db',pts:3,sprint:0,node:n.id,title:`${n.n}: schema and first migration`,gen:()=>[{p:m,content:`-- ${n.n} (${T.n})\nCREATE TABLE ${rs}_items (\n  id         VARCHAR(26) PRIMARY KEY,\n  payload    TEXT NOT NULL,\n  created_at BIGINT NOT NULL\n);\n\nCREATE INDEX idx_${rs}_items_created ON ${rs}_items (created_at DESC);\n`}],tests:[{n:`db::${rs}_has_index`,fn:()=>has(m,/CREATE INDEX/)}]}));}});
  made.push(mkIssue({agent:'ops',pts:5,sprint:1,node:null,infra:true,title:'Cloud-native artefacts: compose, env, Makefile, Kubernetes',gen:()=>[{p:C,content:composeYaml(D,true)},{p:ROOT+'.env.example',content:'# Copy to .env — values for local development only.\nMSSQL_SA_PASSWORD=Change_me_123\n'},{p:ROOT+'Makefile',content:'.PHONY: run stop logs test\n\nrun:\n\tdocker compose up --build -d\n\tdocker compose ps\n\nstop:\n\tdocker compose down\n\nlogs:\n\tdocker compose logs -f\n\ntest:\n\tsh tests/smoke.sh\n'},{p:ROOT+'deploy/cloud-mapping.md',content:cloudMap(D)},...apps.map(a=>({p:ROOT+`deploy/k8s/${sl(a)}.yaml`,content:k8sYaml(a)})),{p:ROOT+'deploy/k8s/00-infra.yaml',content:k8sInfra(D)}],fix:()=>[{p:C,content:composeYaml(D,false)}],fixNote:'make dependents wait for <code>service_healthy</code>',
    tests:[{n:'compose::one_service_per_component',fn:()=>D.nodes.every(n=>has(C,new RegExp('^  '+sl(n)+':','m')))},{n:'compose::waits_for_healthy_dependencies',fn:()=>!D.nodes.some(n=>(KIND[TECH[n.tech].kind]||{}).hc&&D.edges.some(e=>e[1]===n.id))||has(C,/condition: service_healthy/)},{n:'k8s::one_manifest_per_app',fn:()=>apps.every(a=>!!FS[ROOT+`deploy/k8s/${sl(a)}.yaml`])},{n:'make::run_target',fn:()=>has(ROOT+'Makefile',/^run:/m)}]}));
  const sm=ROOT+'tests/smoke.sh',gw=D.nodes.find(n=>TECH[n.tech].kind==='gateway');made.push(mkIssue({agent:'qa',pts:2,sprint:1,node:null,title:'Smoke test for the running stack',gen:()=>[{p:sm,content:`#!/bin/sh\n# Smoke test: every application answers on its health endpoint.\nset -e\n${apps.map(a=>{const T=TECH[a.tech],routed=gw&&D.edges.some(e=>e[0]===gw.id&&e[1]===a.id);return `curl -fsS http://localhost:${routed?'8080'+(T.kind==='web'?'/':'/'+sl(a)+'/healthz'):(T.port+apps.indexOf(a)*10)+(T.kind==='web'?'/':'/healthz')} > /dev/null && echo "ok ${sl(a)}"`;}).join('\n')}\n`}],tests:[{n:'smoke::checks_every_app',fn:()=>apps.every(a=>has(sm,new RegExp('ok '+sl(a))))}]}));return made;}
async function genBacklog(){if(RUN.active){toast('Something is already running');return;}const plan=SD.nodes.filter(n=>n.st==='plan'&&!BL.issues.some(i=>i.node===n.id)),errs=validateDesign().filter(f=>f[0]==='e');focusAgent(true);user('Turn the Studio design into a backlog and sprints.');
  if(errs.length){card('arquitecto',`<p>The design has errors, so I will not generate from it:</p>${errs.map(e=>`<div class="fixl"><b>✖</b><span>${esc(e[1])}</span></div>`).join('')}`);return;}
  if(!plan.length){card('arquitecto','There are no new <b>planned</b> components in the design. Add one in the Studio (dashed outline) and generate again.');return;}
  runState(true,'Architect reading the design');try{const r=await routeModel('arq','Decompose architecture into backlog'),c=card(`arquitecto · ${PROV[r.p].name.toLowerCase()}`,'<p><span class="spin"></span> Reading the design and the project rules…</p>');
    tl(c.tools,'route_model','decompose architecture').querySelector('.tr').innerHTML=`<span class="okc">${PROV[r.p].name}</span> <span style="color:var(--fg-muted)">${esc(r.by)}</span>`;await beat(450);tl(c.tools,'read_design',`${SD.nodes.length} components · ${SD.edges.length} connections`).querySelector('.tr').innerHTML='<span class="okc">✓</span>';await beat(450);
    const made=genBacklogIssues(plan);plan.forEach(n=>{SD.nodes.find(x=>x.id===n.id).st='wip';});made.forEach(i=>{i.stage=i.sprint===0?'todo':'backlog';});saveSD();use(r.p,3200);
    c.bd.innerHTML=`<p>I read the design: <b>${plan.length}</b> planned components across ${[...new Set(plan.map(p=>CLOUD[TECH[p.tech].cloud].l))].join(', ')}. I created <b>${made.length}</b> issues in 2 sprints, each assigned to the assistant that owns that scope:</p>${[0,1].map(s=>`<div class="req"><b>Sprint ${s+1}</b> · ${made.filter(i=>i.sprint===s).reduce((a,i)=>a+i.pts,0)} pts${made.filter(i=>i.sprint===s).map(i=>`<div class="ac"><code>${i.id}</code> <span class="notr">${esc(i.title)}</span> — <span style="color:${AGENTS[i.agent].col}">${AGENTS[i.agent].n}</span></div>`).join('')}</div>`).join('')}<p style="color:var(--fg-dim)">When every issue is validated, <b>▶ RUN</b> starts the whole stack.</p><div class="gate"><button class="gb pri" onclick="openBoard()">Open the board</button><button class="gb" onclick="runSprint(0)">Run Sprint 1</button></div>`;
    log('arquitecto',`backlog generated: ${made.length} issues`);note(`Backlog generated: ${made.length} issues`);}catch(e){if(e!==STOP)console.error(e);}finally{runState(false);scrollMsgs();openBoard();}}

/* ── publicação no window: estado + funções que o resíduo (app.ts/v5/v6/bridge/pair),
   os onclick inline e os consumidores (studio/router/codev/tasks) resolvem como globais.
   runIssue/delegate/runSprint/approveIssue já são window.X=function (decoráveis) acima.
   VIEW.board fica como shim brace-less em app.ts a delegar em renderBoardView. ── */
Object.assign(window, { mkIssue, openBoard, setStage, autoTest, rejectIssue, dropIssue, newIssue, genBacklog, genBacklogIssues });
window.renderBoardView = renderBoardView;
