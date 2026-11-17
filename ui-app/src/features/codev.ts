// @ts-nocheck
/* ═════════ dxtutor IDE — feature: Co-Dev (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado por
   import real e detém o render do pane «Co-Dev» que vivia no monólito `app.ts`.

   No monólito este pane era DECORADO: uma base v3 (`RP.codev`, Missões/Conhecimento/
   Checkpoints/Routing) e uma decoração v4 (`const _codev=RP.codev;RP.codev=()=>{…}`)
   que injectava Equipa/Backlog/Studio no topo das `.sections`. Aqui as duas dobram-se
   num único `renderCodevPane()` — base primeiro, depois o `insertAdjacentHTML` — para
   que o resultado DOM seja idêntico. Dados/helpers (FS, MISSIONS, CKPT, ROUTE, ROLE,
   PROV, provFor, fIcon, AGENTS, BL, STAGES, SD) continuam donos do monólito e são
   lidos por fachada tipada (SD é window-backed). Do core importa-se só o que é dono de
   lá (`$`, `hd`, `svg`, `esc`). Os `onclick="…"` inline resolvem os nomes livres
   (openManager/openSettings/openPath/restoreCkpt/openTeam/openBoard/openStudio) no
   `window` ao clicar.

   Shim transitório: publica `renderCodevPane`; `app.ts` delega
   `RP.codev=()=>window.renderCodevPane()` (lazy, no switch de pane); a decoração v4 foi
   removida (está dobrada aqui, senão duplicaria). */

import { $, hd, svg, esc } from "../core";

/* ═══════════ MOTOR DE AGENTE / Co-Dev (invertido do monólito app.ts) ═══════════
   Esta feature é DONA de todo o runtime de agente/chat/missões/execução do Co-Dev,
   além do render do pane. Lê por global (window) o núcleo partilhado que fica dono
   do monólito: FS/SEED/ROOT/P_* (ficheiros), PROV/provFor/who/connected/use/save/
   loadCfg (provedores), tabs/VIEW/CMD/THEMES (UI), checkpoint/restoreCkpt (snapshot
   git-aware, app.ts), scm (STAGED/stOf/commitGit/gfStart/gfAsk/AUTHOR), team (AGENTS/
   AGENT/agentSys/harness*), e helpers (log/toast/note/refresh/openTab/openDiff/
   writeFile/diffStat/short/norm/has/runTests/runTask/termExec/dsLint/lexBug/…).
   Os onclick="…" inline resolvem os nomes livres no window ao clicar. */

/* ── dados de config/estado do Co-Dev (window-backed; app.ts residual lê por global) ── */
const ROLE=window.ROLE={plan:'Planeador',code:'Programador',review:'Revisor',judge:'Juiz',local:'Privado / offline'};
const ROLE_D=window.ROLE_D={plan:'requisitos, arquitectura, plano',code:'escreve e edita código',review:'testes, lint, auto-avaliação',judge:'escolhe entre propostas',local:'autocomplete e dados sensíveis'};
const ROUTE=window.ROUTE={plan:'claude',code:'codex',review:'gemini',judge:'claude',local:'ollama'};
const MODES=window.MODES={manual:{l:'Manual',d:'Tu decides tudo: respostas, proposta, plano, cada edição e cada comando.'},
  assist:{l:'Assistido',d:'O Co-Dev decide o que é seguro e reversível; pergunta-te quando a confiança é baixa.'},
  auto:{l:'Auto',d:'Autónomo de ponta a ponta, com auto-avaliação e correcção. Só pára para push e acções destrutivas.'}};
const CRIT=window.CRIT=[{k:'c',s:'Corr.',l:'Correcção',w:30},{k:'a',s:'Arq.',l:'Arquitectura',w:25},{k:'t',s:'Testes',l:'Testes',w:20},{k:'r',s:'Risco',l:'Risco',w:15},{k:'k',s:'Custo',l:'Custo',w:10}];
const MISSIONS=window.MISSIONS=[],DECS=window.DECS=[],CKPT=window.CKPT=[];
let SPEED=1,MID=0;

/* ───── interface do agente ───── */
window.updateAgentUI = function(){const p=PROV[ACTIVE];$('#ag-model-l').textContent=p.name+' · '+p.model;$('#ag-model .live').style.background=p.on?'var(--green)':'var(--fg-muted)';
  $('#st-model-l').textContent=p.name;$('#st-mode').textContent='Co-Dev: '+MODES[MODE].l;
  $('#modebar').innerHTML=`<div class="seg">${Object.entries(MODES).map(([k,m])=>`<button class="${k===MODE?'on':''}" onclick="setMode('${k}')">${m.l}</button>`).join('')}</div><div class="mode-d">${MODES[MODE].d}</div>`;
  const n=$('#live-note');if(n)n.innerHTML=SAMPLE?'<span class="tag live">Claude ao vivo</span> perguntas livres são respondidas pelo Claude real, com acesso aos ficheiros deste workspace. Gemini, Codex e Ollama são simulados.':'<span class="tag">simulado</span> nesta vista as missões são guionadas; a ligação ao vivo ao Claude activa-se quando o artefacto é aberto em claude.ai.';
  ctxPill();}
function ctxPill(){const t=tabOf(cur),el=$('#pill-ctx');if(!el)return;el.textContent='@ '+(t&&t.path?t.title:'sem ficheiro');el.classList.toggle('on',CTX_ON&&!!(t&&t.path));const u=Math.min(99,Math.round((CHAT.reduce((s,m)=>s+m.content.length,0)+(t&&t.path&&FS[t.path]?FS[t.path].content.length:0))/4/2000));$('#st-ctx').textContent='ctx '+u+'%';}
window.setMode=function(m){MODE=m;save();updateAgentUI();toast('Modo '+MODES[m].l);if(tabOf(cur)&&tabOf(cur).kind==='settings')show(cur);}
function cycleMode(){const k=Object.keys(MODES);setMode(k[(k.indexOf(MODE)+1)%k.length]);}
function pickModel(){palette('',{ph:'Modelo para a conversa…',items:Object.entries(PROV).map(([k,p])=>({l:`${p.name} — ${p.model}`,d:p.on?provState(k):'desligado',run:()=>{if(!p.on){toast(p.name+' está desligado — liga-o nas Definições');return;}ACTIVE=k;save();updateAgentUI();}}))});}
function toggleProv(k){PROV[k].on=!PROV[k].on;save();updateAgentUI();if(RP[PANE])RP[PANE]();const t=tabOf(cur);if(t&&t.kind==='settings')show(cur);}
function scrollMsgs(){const m=$('#ag-msgs');m.scrollTop=$('#ag-intro')?0:m.scrollHeight;}
function newChat(){if(RUN.active){toast('Pára a missão primeiro');return;}CHAT.length=0;$('#ag-msgs').innerHTML=`<div class="intro" id="ag-intro"><div class="i-t">Co-Dev</div><div class="i-s">Entendo requisitos, proponho arquitectura, escrevo, testo, avalio o meu próprio trabalho e corrijo-o — contigo a orientar.</div>
  <button class="chip" onclick="demo('b')"><b>Histórico de conversas persistente</b><small>Requisitos → BD → Repository → UI → testes. Inclui uma auto-correcção.</small></button>
  <button class="chip" onclick="demo('a')"><b>Corrigir o E0382 em lib.rs</b><small>Três provedores propõem; o juiz escolhe a melhor.</small></button>
  <button class="chip" onclick="handlePrompt('Explica o ficheiro activo e aponta riscos de arquitectura.')"><b>Explica o ficheiro activo</b><small>Pergunta livre — respondida pelo Claude ao vivo.</small></button>
  <div class="i-n" id="live-note"></div></div>`;updateAgentUI();}
function user(t){const i=$('#ag-intro');if(i)i.remove();$('#ag-msgs').insertAdjacentHTML('beforeend',`<div class="m user"><div class="bub"><div class="bh"><span class="br2">tu</span><span class="bt">${hhmm()}</span></div><div class="bd">${esc(t)}</div></div></div>`);scrollMsgs();}
function card(w,html){const i=$('#ag-intro');if(i)i.remove();const d=document.createElement('div');d.className='m ai';d.innerHTML=`<div class="bub"><div class="bh"><span class="br2">${esc(w||'co-dev')}</span><span class="bt">${hhmm()}</span></div><div class="bd">${html}</div><div class="tools"></div></div>`;$('#ag-msgs').appendChild(d);scrollMsgs();return{el:d,bd:d.querySelector('.bd'),tools:d.querySelector('.tools')};}
function phase(n,l){$('#ag-msgs').insertAdjacentHTML('beforeend',`<div class="phase"><i>${n}</i>${l}</div>`);RUN.label=l;runLabel();log('co-dev','fase '+n+' — '+l);scrollMsgs();}
function md(t){const parts=String(t).split(/```/);return parts.map((p,i)=>i%2?`<pre>${esc(p.replace(/^[a-z]*\n/,''))}</pre>`:esc(p).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>').replace(/^#{1,4}\s+(.+)$/gm,'<b>$1</b>').replace(/^\s*[-*]\s+(.+)$/gm,'• $1').replace(/\n/g,'<br>')).join('');}
const demoChips=`<div class="chips"><button class="chip" onclick="demo('b')"><b>Missão: histórico de conversas persistente</b></button><button class="chip" onclick="demo('a')"><b>Missão: corrigir o E0382 em lib.rs</b></button></div>`;

/* ───── controlo de execução ───── */
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms*SPEED)));
async function beat(ms){await sleep(ms);while(RUN.paused&&!RUN.stop)await new Promise(r=>setTimeout(r,120));if(RUN.stop)throw STOP;}
function runState(on,label){RUN.active=on;RUN.paused=false;RUN.stop=false;RUN.pend=null;if(on){RUN.t0=Date.now();RUN.label=label||'';}if(!on){RUN.abort=null;RUN.M=null;}$('#ag-runctl').classList.toggle('hidden',!on);$('#rc-pause').innerHTML='<kbd>p</kbd> pausar';runLabel();badges();}
function runLabel(){if(!RUN.active)return;$('#rc-lbl').textContent=(RUN.paused?'em pausa · ':'')+RUN.label;const s=Math.round((Date.now()-RUN.t0)/1000);$('#rc-el').textContent=s<60?s+'s':Math.floor(s/60)+'m'+String(s%60).padStart(2,'0')+'s';}
function agCtl(a){if(!RUN.active)return;if(a==='pause'){RUN.paused=!RUN.paused;$('#rc-pause').innerHTML=RUN.paused?'<kbd>p</kbd> retomar':'<kbd>p</kbd> pausar';runLabel();}
  else if(a==='stop'){RUN.stop=true;RUN.paused=false;if(RUN.abort)RUN.abort.abort();if(RUN.pend)RUN.pend();}
  else if(a==='details'){setPanelTab('output');}}
function waiting(){RUN.label='à espera da tua decisão';runLabel();note('O Co-Dev precisa da tua decisão');}
function ask(host,btns){return new Promise((res,rej)=>{const bar=document.createElement('div');bar.className='gate';btns.forEach(b=>{const x=document.createElement('button');x.className='gb'+(b.pri?' pri':'');x.innerHTML=b.l;x.onclick=()=>{bar.innerHTML=`<span class="gdone">${b.done||b.l}</span>`;RUN.pend=null;res(b.v);};bar.appendChild(x);});host.appendChild(bar);scrollMsgs();RUN.pend=()=>{bar.remove();rej(STOP);};waiting();});}
function tl(host,name,arg){const d=document.createElement('div');d.className='tool';d.innerHTML=`<span class="tn">${name}</span><span class="ta">${esc(arg)}</span><span class="tr"></span>`;host.appendChild(d);scrollMsgs();return d;}

/* ───── ferramentas do agente (com política de aprovação por modo) ───── */
window.doTool=async function(t,host,role){
  if(t.t==='read'){const d=tl(host,'read_file',short(t.p));await beat(240);d.querySelector('.tr').innerHTML='<span class="okc">✓</span>';return true;}
  if(t.t==='edit'){const old=FS[t.p]?FS[t.p].content:null,nw=t.make?t.make(old||''):t.content;
    if(nw===old){tl(host,'edit_file',short(t.p)).querySelector('.tr').textContent='sem alterações';return true;}
    const s=diffStat(old,nw),d=tl(host,old==null?'create_file':'edit_file',short(t.p));
    d.querySelector('.tr').innerHTML=`<span class="pls">+${s.add}</span><span class="mns">−${s.del}</span><button class="lnk">ver diff</button>`;d.querySelector('.lnk').onclick=()=>openDiff(t.p,old||'',nw,'proposta do Co-Dev');
    if(MODE==='manual'){const v=await ask(d,[{l:'Aprovar edição',v:1,pri:1,done:'✓ aprovada por ti'},{l:'Rejeitar',v:0,done:'✗ rejeitada por ti'}]);if(!v){log('humano','rejeitou a edição de '+short(t.p));return false;}}
    writeFile(t.p,nw);if(RUN.M)RUN.M.files.add(t.p);openTab({id:t.p,title:t.p.split('/').pop(),kind:'file',path:t.p},false);use(provFor(role||'code'),900+s.add*40);log(who(role||'code'),(old==null?'criou ':'editou ')+short(t.p)+` (+${s.add} −${s.del})`);await beat(360);return true;}
  if(t.t==='run'){const d=tl(host,'$',t.cmd),need=MODE==='manual'||(MODE==='assist'&&!SAFE.test(t.cmd))||DANGER.test(t.cmd);
    if(need){const v=await ask(d,[{l:'Executar',v:1,pri:1,done:'✓ autorizado por ti'},{l:'Saltar',v:0,done:'✗ não executado'}]);if(!v)return null;}
    await beat(280);if(getVar('--panel-h')!=='0px')setPanelTab('terminal',true);const r=termExec(t.cmd)||{ok:true,sum:'ok'};d.querySelector('.tr').innerHTML=`<span class="${r.ok?'okc':'bad'}">${r.ok?'✓':'✖'} ${esc(r.sum||'')}</span>`;log('terminal',t.cmd+' → '+(r.sum||'ok'));await beat(420);return r;}
}
/* publica no window os `function …` do motor (os `window.X=` acima já se publicam) p/ o resíduo app.ts, os onclick inline e as outras features resolverem por global */
Object.assign(window,{ctxPill,cycleMode,pickModel,toggleProv,scrollMsgs,newChat,user,card,phase,md,beat,runState,runLabel,agCtl,waiting,ask,tl});

/* ───── cenários de demonstração (lazy: SEED/ROOT/P_* são donos de app.ts e avaliam depois deste módulo) ───── */
let _SCN=null;
function SCN_(){
  if(_SCN)return _SCN;
  const SEED=window.SEED,ROOT=window.ROOT,P_LX=window.P_LX,P_REPO=window.P_REPO,P_MIG=window.P_MIG,P_TEST=window.P_TEST,P_HIST=window.P_HIST,P_ADR=window.P_ADR,P_STORE=window.P_STORE;
  const G=SEED.gen,lxStep=(l,fn)=>[{l:'Ler lib.rs e o erro do compilador',tools:[{t:'read',p:P_LX}]},{l,tools:[{t:'edit',p:P_LX,make:fn}]}];
  _SCN=[
  {id:'a',title:'Corrigir E0382 no lexer',prompt:'Corrige o erro E0382 (use of moved value) em crates/lexer/src/lib.rs.',match:/e0382|moved value|lexer|tokeniz/i,pkg:'lexer',
   ready:()=>lexBug()?null:'O E0382 já não existe em <code>lib.rs</code> — não há nada para corrigir. Usa a paleta (<kbd>Ctrl+Shift+P</kbd> → «Repor protótipo») para recomeçar.',
   reads:[ROOT+'.dxtutor/regras.md',P_LX],
   understand:'O <code>for</code> move o iterador <code>chars</code>; a linha 10 volta a usá-lo. O objectivo é compilar sem mudar o comportamento.',
   reqs:[{t:'O crate lexer compila',ac:['<code>cargo build</code> sem E0382']},{t:'O comportamento mantém-se',ac:['<code>tokenize_emits_eof</code> continua a passar','a assinatura pública de <code>tokenize</code> não muda']}],
   questions:[{q:'Posso alterar a assinatura pública de tokenize()?',opts:[{l:'Não — manter a API',why:'a correcção é interna à função'},{l:'Sim — devolver um iterador',why:'mais idiomático, mas quebra quem usa o crate'}],best:0,conf:.97,basis:'regras.md §2'}],
   cands:[
    {prov:'claude',title:'Emprestar o iterador com by_ref()',sum:'Uma linha alterada: o ciclo consome o iterador por referência e ele continua válido para o peek() final.',sc:{c:10,a:9,t:9,r:9,k:10},steps:lxStep('Aplicar by_ref() no ciclo',o=>o.replace('for c in chars {','for c in chars.by_ref() {'))},
    {prov:'codex',title:'Reescrever com while let',sum:'Ciclo explícito com chars.next(). Correcto, mas menos directo de rever.',sc:{c:10,a:8,t:9,r:8,k:8},steps:lxStep('Reescrever o ciclo com while let',o=>o.replace('for c in chars {','while let Some(c) = chars.next() {'))},
    {prov:'ollama',title:'Clonar o iterador',sum:'Compila, mas o original fica por consumir: o peek() final deixa de detectar o fim da entrada.',sc:{c:4,a:5,t:3,r:4,k:9},steps:lxStep('Clonar o iterador no ciclo',o=>o.replace('for c in chars {','for c in chars.clone() {'))}],
   best:0,verify:['cargo test -p lexer'],fix:{strategy:'switch'},
   checks:[
    {id:'build',l:'O crate compila sem E0382',w:40,fn:()=>runTests('lexer').build,cause:'o iterador continua a ser movido pelo ciclo.',fixd:'emprestar o iterador em vez de o mover.'},
    {id:'tests',l:'Testes do lexer passam (incl. tokenize_emits_eof)',w:40,fn:()=>runTests('lexer').ok,cause:'ao clonar, o iterador original nunca é consumido e o <code>peek()</code> final nunca vê o fim.',fixd:'consumir o próprio iterador por referência com <code>by_ref()</code>.'},
    {id:'min',l:'Alteração mínima e API pública intacta',w:20,fn:()=>FS[P_LX]&&diffStat(SEED.base['crates/lexer/src/lib.rs'],FS[P_LX].content).add<=2&&has(P_LX,/pub fn tokenize\(src: &str\) -> Vec<Token>/),cause:'a alteração tocou em mais do que o necessário.',fixd:'limitar a alteração à linha do ciclo.'}],
   done:['<code>lib.rs</code>: o ciclo passa a emprestar o iterador','<code>cargo test -p lexer</code>: 2 passados'],commit:'fix(lexer): borrow the iterator in the loop (E0382)'},
  {id:'b',title:'Histórico de conversas persistente',prompt:'Quero que as conversas do Co-Dev fiquem guardadas por workspace e apareçam numa lista, das mais recentes para as mais antigas.',match:/hist[óo]rico|conversas?/i,pkg:'store',
   ready:()=>FS[P_REPO]&&_SCN[1].checks.every(k=>k.fn())?'O histórico de conversas já está implementado e a passar em todos os critérios. Usa «Repor protótipo» na paleta para voltar ao início.':null,
   reads:[ROOT+'.dxtutor/regras.md',ROOT+'.dxtutor/requisitos.md',ROOT+'.dxtutor/arquitectura/ADR-001-local-first.md',ROOT+'.dxtutor/arquitectura/ADR-002-camadas.md',ROOT+'.dxtutor/design-system.md',ROOT+'.dxtutor/base-de-dados.md',ROOT+'db/migrations/0001_init.sql'],
   understand:'O pedido corresponde ao <b>RF-03</b> do backlog. Traduzi-o em critérios de aceitação verificáveis antes de escrever código:',
   reqs:[{t:'RF-03 · Histórico de conversas por workspace',ac:['CA1 — as conversas sobrevivem ao fecho da aplicação','CA2 — a lista mostra primeiro as mais recentes','CA3 — apagar um workspace apaga as suas conversas']},{t:'Restrições do projecto',ac:['ADR-001: dados locais em SQLite','ADR-002: só o crate <code>store</code> contém SQL','Design System: sem cores fixas; listas no painel lateral']}],
   questions:[
    {q:'Onde guardar as conversas?',opts:[{l:'SQLite local, no crate store',why:'segue o ADR-001 e reutiliza a ligação existente'},{l:'Ficheiro JSON por workspace',why:'simples, mas sem integridade referencial'},{l:'Postgres remoto',why:'permite sincronizar, mas viola local-first'}],best:0,conf:.94,basis:'ADR-001 · base-de-dados.md'},
    {q:'Como mostrar o histórico na interface?',opts:[{l:'Secção no painel lateral do Co-Dev',why:'é o padrão do Design System para listas'},{l:'Janela modal',why:'interrompe o trabalho'},{l:'Página nova no editor',why:'ocupa o espaço do código'}],best:0,conf:.88,basis:'design-system.md · Componentes'},
    {q:'Durante quanto tempo guardar as conversas?',opts:[{l:'90 dias, configurável',why:'reversível: basta mudar a definição'},{l:'Para sempre',why:'a base de dados cresce sem limite'},{l:'30 dias',why:'pode apagar contexto ainda útil'}],best:0,conf:.55,basis:'sem regra no projecto — decisão de produto'}],
   cands:[
    {prov:'claude',title:'SQLite + Repository (trait ConversationRepo)',sum:'Migração nova, trait no crate store, UI atrás de um comando Tauri. Respeita ADR-001 e ADR-002.',sc:{c:9,a:9,t:9,r:8,k:7}},
    {prov:'codex',title:'SQL directo a partir da UI',sum:'Menos código e mais rápido de escrever, mas põe queries em history.ts — viola o ADR-002.',sc:{c:8,a:4,t:6,r:6,k:9}},
    {prov:'gemini',title:'Postgres gerido com sincronização',sum:'Histórico em todos os dispositivos, mas torna um serviço remoto obrigatório — viola o ADR-001.',sc:{c:8,a:6,t:7,r:4,k:3}},
    {prov:'ollama',title:'Ficheiro JSON por workspace',sum:'Sem migração nem dependências, mas sem cascata nem ordenação indexada.',sc:{c:6,a:5,t:5,r:6,k:10}}],
   best:0,verify:['cargo test -p store','dx lint'],
   steps:[
    {l:'Migração 0002: conversations e messages',tools:[{t:'edit',p:P_MIG,content:G['0002_conversations.sql']}]},
    {l:'Repository no crate store',tools:[{t:'edit',p:P_REPO,content:G['conversations.rs']},{t:'edit',p:P_STORE,make:o=>o.includes('pub mod conversations')?o:o.replace('pub mod workspaces;','pub mod conversations;\npub mod workspaces;')}]},
    {l:'Secção «Histórico» na interface',tools:[{t:'read',p:ROOT+'desktop/src/styles.css'},{t:'edit',p:P_HIST,content:G['history.ts']}]},
    {l:'Testes de integração',tools:[{t:'edit',p:P_TEST,content:G['conversations_test.rs']}]},
    {l:'Registar a decisão no ADR-003',tools:[{t:'edit',p:P_ADR,content:G['ADR-003-historico.md']}]}],
   fix:{strategy:'inc',steps:[
    {for:'tests',l:'Ordenar a listagem por mais recente',tools:[{t:'edit',p:P_REPO,make:o=>o.replace('WHERE workspace_id = ?1 LIMIT ?2','WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2')}]},
    {for:'ds',l:'Trocar a cor fixa pelo token --accent',tools:[{t:'edit',p:P_HIST,make:o=>o.replace('"2px solid #ff6600"','"2px solid var(--accent)"')}]},
    {for:'idx',l:'Criar índice (workspace_id, created_at)',tools:[{t:'edit',p:P_MIG,make:o=>/CREATE INDEX/.test(o)?o:o.replace(/\n*$/,'\n\nCREATE INDEX idx_conversations_ws_created\n  ON conversations (workspace_id, created_at DESC);\n')}]}]},
   checks:[
    {id:'tests',l:'Testes do store passam',w:20,fn:()=>{const r=runTests('store');return r.ok&&r.tests.length>=4;},cause:'<code>list_recent</code> não tem <code>ORDER BY</code>; o SQLite devolve por ordem de inserção.',fixd:'acrescentar <code>ORDER BY created_at DESC</code> à query.'},
    {id:'reqs',l:'RF-03: CA1, CA2 e CA3 cobertos',w:10,fn:()=>!!FS[P_MIG]&&!!FS[P_HIST]&&has(P_REPO,/ORDER BY created_at DESC/)&&has(P_MIG,/ON DELETE CASCADE/),cause:'o CA2 (mais recentes primeiro) depende da ordenação em falta.',fixd:'fica coberto pela correcção da query.'},
    {id:'arch',l:'ADR-002: a interface não contém SQL',w:20,fn:()=>!!FS[P_HIST]&&!has(P_HIST,/SELECT |INSERT /),cause:'há SQL fora do crate store.',fixd:'mover o acesso a dados para o Repository.'},
    {id:'repo',l:'Padrão Repository: trait + implementação',w:15,fn:()=>has(P_REPO,/pub trait ConversationRepo/)&&has(P_REPO,/impl ConversationRepo for/),cause:'falta o trait ou a implementação.',fixd:'repor o Repository.'},
    {id:'fk',l:'BD: integridade referencial com cascata',w:10,fn:()=>has(P_MIG,/ON DELETE CASCADE/),cause:'faltam as chaves estrangeiras.',fixd:'acrescentar <code>ON DELETE CASCADE</code>.'},
    {id:'ds',l:'Design System: zero cores fixas',w:15,fn:()=>!!FS[P_HIST]&&!dsLint().length,cause:'usei <code>#ff6600</code> em <code>history.ts</code> em vez de um token.',fixd:'trocar por <code>var(--accent)</code>.'},
    {id:'idx',l:'BD: índice cobre o filtro e a ordenação',w:10,fn:()=>has(P_MIG,/CREATE INDEX/),cause:'a listagem ordenada faria um varrimento completo da tabela.',fixd:'criar o índice <code>(workspace_id, created_at DESC)</code>.'}],
   done:['Migração <code>0002_conversations.sql</code> com cascata e índice','<code>ConversationRepo</code> (padrão Repository) no crate <code>store</code>','Secção «Histórico» em <code>history.ts</code>, só com tokens do Design System','3 testes de integração novos a passar','Decisão registada em <code>ADR-003</code>'],commit:'feat(store): persistent chat history (RF-03, ADR-003)'}];
  return _SCN;
}
function demo(id){const S=SCN_().find(s=>s.id===id);focusAgent(true);runMission(S,S.prompt);}
window.demo=demo;

/* ───── motor de missões ───── */
function dec(M,d){d.id=DECS.length+1;d.mission=M.title;M.decs.push(d);DECS.unshift(d);log('decisão',`${d.q} → ${d.choice} (${d.by}${d.conf?', '+Math.round(d.conf*100)+'%':''})`);}
async function decideQ(q,M){const auto=MODE==='auto'||(MODE==='assist'&&q.conf>=.8),pct=Math.round(q.conf*100);
  const c=card(who('plan'),`<p><b>${q.q}</b></p>${!auto&&MODE==='assist'?`<p style="color:var(--fg-dim)">Confiança baixa (${pct}%) e nenhuma regra do projecto cobre isto — prefiro perguntar-te.</p>`:''}<div class="qo"></div><div class="qfoot"></div>`),qo=c.bd.querySelector('.qo');
  const draw=(pick,click)=>{qo.innerHTML=q.opts.map((o,i)=>`<${click?'button':'div'} class="qopt${pick===i?' pick':pick!=null?' dim':''}" data-i="${i}"><span class="ql">${o.l}<small>${o.why}</small></span>${i===q.best?`<span class="tag acc">recomendada · ${pct}%</span>`:''}</${click?'button':'div'}>`).join('');scrollMsgs();};
  let pick,by,status='ok';
  if(auto){draw(null,false);await beat(850);pick=q.best;by='agente';if(q.conf<.8)status='pressuposto';}
  else{draw(null,true);pick=await new Promise((res,rej)=>{qo.querySelectorAll('button').forEach(b=>b.onclick=()=>{RUN.pend=null;res(+b.dataset.i);});RUN.pend=()=>rej(STOP);waiting();});by='humano';RUN.label='Clarificar';}
  draw(pick,false);c.bd.querySelector('.qfoot').innerHTML=`<span class="tag ${by==='agente'?'acc':'live'}">${by==='agente'?'decidido pelo Co-Dev':'decidido por ti'}</span>${status==='pressuposto'?'<span class="tag warn">pressuposto reversível</span>':''}<span>base: ${q.basis}</span>`;
  dec(M,{phase:'Clarificação',q:q.q,choice:q.opts[pick].l,by,conf:q.conf,basis:q.basis,status});use(provFor('plan'),600);await beat(250);}
const total=sc=>CRIT.reduce((s,k)=>s+sc[k.k]*k.w,0)/10;
async function council(S,M){phase(3,'Conselho de modelos');const on=connected();
  const cs=S.cands.map((c,i)=>({...c,i})).filter(c=>c.i===S.best||on.includes(c.prov)).map((c,n)=>({...c,L:'ABCD'[n],prov:on.includes(c.prov)?c.prov:on[0],tot:total(c.sc)}));
  const c=card(who('judge'),`<p>${cs.length>1?`Pedi uma proposta a cada provedor ligado (${cs.length}) e avalio-as às cegas com a mesma rubrica.`:'Só há um provedor ligado, por isso não há propostas concorrentes — sigo com esta.'}</p><div class="cl"></div><div class="qfoot"></div>`),cl=c.bd.querySelector('.cl');
  for(const x of cs){const el=document.createElement('div');el.className='cand';el.innerHTML=`<div class="ch"><span class="pdot" style="background:${PROV[x.prov].col}"></span>Proposta ${x.L} · ${PROV[x.prov].name}<span class="tot"><span class="spin"></span></span></div><div class="ct">${x.title}</div><div class="cs">${x.sum}</div><div class="crit"></div>`;cl.appendChild(el);x.el=el;use(x.prov,1800);log('conselho',`${PROV[x.prov].name} propôs: ${x.title}`);scrollMsgs();await beat(480);}
  RUN.label='Juiz a avaliar as propostas';runLabel();await beat(700);
  cs.forEach(x=>{x.el.querySelector('.tot').textContent=x.tot.toFixed(1);x.el.querySelector('.crit').innerHTML=CRIT.map(k=>`<span>${k.s}<i><b style="width:${x.sc[k.k]*10}%"></b></i></span>`).join('');});use(provFor('judge'),1200);
  const best=cs.reduce((a,b)=>b.tot>a.tot?b:a);let pick=best,by='juiz';
  if(MODE==='manual'){const sel=cs.filter(x=>x.steps||x===best);pick=await ask(c.bd,sel.map(x=>({l:(x===best?'★ ':'')+'Escolher a proposta '+x.L,v:x,pri:x===best,done:'✓ escolhida por ti: proposta '+x.L})));by='humano';RUN.label='Conselho de modelos';}
  pick.el.classList.add('best');c.bd.querySelector('.qfoot').innerHTML=`<span class="tag ${by==='juiz'?'acc':'live'}">${by==='juiz'?'decidido pelo juiz':'decidido por ti'}</span><span>rubrica: ${CRIT.map(k=>k.l+' '+k.w).join(' · ')}</span>`;
  dec(M,{phase:'Conselho',q:'Que abordagem seguir?',choice:`${pick.L} — ${pick.title}`,by,conf:pick.tot/100,basis:'rubrica do juiz',status:'ok'});M.councilDec=M.decs[M.decs.length-1];await beat(300);return pick;}
async function execSteps(steps,title,approve){const n=steps.length,c=card(who('code'),`<div class="plan" style="margin:0"><div class="plan-h"><span class="plan-t">${title}</span><span class="plan-c">0/${n}</span></div><div class="bar"><span style="width:0"></span></div>${steps.map(s=>`<div class="stp todo"><span class="g">·</span><span class="l">${s.l}</span><span class="d"></span></div>`).join('')}</div>`),rows=c.bd.querySelectorAll('.stp');
  if(approve&&MODE==='manual'){const v=await ask(c.bd,[{l:'Aprovar plano',v:1,pri:1,done:'✓ plano aprovado por ti'},{l:'Parar',v:0}]);if(!v)throw STOP;}
  for(let i=0;i<n;i++){const s=steps[i],r=rows[i],t0=Date.now();r.className='stp run';r.querySelector('.g').textContent='◐';RUN.label=s.l;runLabel();await beat(300);
    let ok=true;for(const t of s.tools){if(await doTool(t,c.tools)===false)ok=false;}
    r.className='stp done';r.querySelector('.g').textContent=ok?'✓':'✗';if(!ok)r.querySelector('.g').style.color='var(--red)';r.querySelector('.d').textContent=((Date.now()-t0)/1000).toFixed(1)+'s';
    c.bd.querySelector('.plan-c').textContent=`${i+1}/${n}`;c.bd.querySelector('.bar span').style.width=((i+1)/n*100)+'%';}}
async function evaluate(S,M,again){phase(6,again?'Verificar de novo':'Verificar e auto-avaliar');
  const c=card(who('review'),`<p>${again?'Volto a correr tudo depois da correcção.':'Corro os testes e o lint e pontuo o resultado contra os critérios — quem revê não é quem escreveu.'}</p>`);
  for(const cmd of S.verify)await doTool({t:'run',cmd},c.tools,'review');await beat(450);
  const res=S.checks.map(k=>({...k,ok:!!k.fn()})),score=res.reduce((s,k)=>s+(k.ok?k.w:0),0),ok=score>=THRESH;use(provFor('review'),1500);
  c.bd.insertAdjacentHTML('beforeend',`<div class="evalbox"><div class="score ${ok?'ok':'bad'}">${score}<small>/100</small></div><div style="flex:1;min-width:0">${res.map(k=>`<div class="chk ${k.ok?'ok':'no'}"><span class="g">${k.ok?'✓':'✗'}</span><span>${k.l}</span><span class="w">${k.w}</span></div>`).join('')}</div></div><div class="qfoot"><span class="tag ${ok?'live':'bad'}">${ok?'acima':'abaixo'} do limiar ${THRESH}</span></div>`);
  M.score=score;log('auto-avaliação',`${score}/100 — ${ok?'aprovado':'reprovado: '+res.filter(k=>!k.ok).map(k=>k.id).join(', ')}`);scrollMsgs();await beat(350);return{score,ok,fails:res.filter(k=>!k.ok)};}
async function reflect(S,M,ev){phase(7,`Reflectir e corrigir · tentativa ${M.retries}/2`);const sw=M.retries>1||S.fix.strategy==='switch';
  const c=card(who('plan'),`<p>A entrega não passou na minha própria avaliação (<b>${ev.score}</b> &lt; ${THRESH}). Não entrego assim.</p>${ev.fails.map(k=>`<div class="fixl"><b>✗ ${k.l}</b><span>Causa: ${k.cause}</span><span>Correcção: ${k.fixd}</span></div>`).join('')}<p style="margin-top:8px"><b>Estratégia:</b> ${sw?'reverter ao checkpoint inicial e refazer com a abordagem mais bem classificada — a decisão anterior estava errada.':'corrigir incrementalmente — a abordagem está certa, os defeitos são locais.'}</p>`);
  if(MODE==='manual'){const v=await ask(c.bd,[{l:'Aprovar correcção',v:1,pri:1,done:'✓ correcção aprovada por ti'},{l:'Parar',v:0}]);if(!v)throw STOP;}
  if(sw&&M.councilDec)M.councilDec.status='corrigida';
  dec(M,{phase:'Auto-correcção',q:`Avaliação ${ev.score}/100 — como corrigir?`,choice:sw?'Reverter e trocar de abordagem':'Correcção incremental',by:MODE==='manual'?'humano':'agente',conf:.9,basis:'critérios falhados: '+ev.fails.map(k=>k.id).join(', '),status:'ok'});
  checkpoint(`Antes da correcção ${M.retries} · ${S.title}`);let steps;
  if(sw){restoreCkpt(M.ck0,true);steps=(S.cands[S.best].steps||S.steps).concat((S.fix.steps||[]));}else steps=S.fix.steps.filter(s=>ev.fails.some(k=>k.id===s.for));
  if(!steps.length){steps=(S.cands[S.best].steps||S.steps).concat(S.fix.steps||[]);}
  await execSteps(steps,sw?'Refazer com a melhor abordagem':'Correcções');}
window.runMission = async function(S,text){if(RUN.active){toast('Já há uma missão em curso');return;}user(text);
  if(!connected().length){card('sistema','Não há nenhum provedor ligado. Liga pelo menos um em <b>Definições → Modelos e provedores</b>.');return;}
  const rd=S.ready();if(rd){card('co-dev',rd);return;}
  const M={id:++MID,title:S.title,mode:MODE,state:'em curso',score:null,t0:Date.now(),decs:[],retries:0,files:new Set()};MISSIONS.unshift(M);runState(true,'A começar');RUN.M=M;
  try{gfStart(S.id==='a'?'fix':'feature',S.id==='a'?'e0382-lexer':'historico-conversas');AUTHOR='lead';M.ck0=checkpoint('Antes de «'+S.title+'»');
    phase(1,'Entender requisitos');const c=card(who('plan'),'<p><span class="spin"></span> A ler as regras do projecto, os ADRs e o código relevante…</p>');for(const p of S.reads)await doTool({t:'read',p},c.tools);use(provFor('plan'),4200);
    c.bd.innerHTML=`<p>${S.understand}</p>${S.reqs.map(r=>`<div class="req"><b>${r.t}</b>${r.ac.map(a=>`<div class="ac">${a}</div>`).join('')}</div>`).join('')}`;scrollMsgs();await beat(500);
    phase(2,'Clarificar');for(const q of S.questions)await decideQ(q,M);
    const pick=await council(S,M);
    phase(4,'Planear e executar');await execSteps(pick.steps||S.steps,'Plano · '+pick.title,true);
    let ev=await evaluate(S,M,false);
    while(!ev.ok&&M.retries<2){M.retries++;await reflect(S,M,ev);ev=await evaluate(S,M,true);}
    if(!ev.ok){phase(8,'Pedir orientação');card(who('plan'),`<p>Depois de 2 tentativas a avaliação continua em <b>${ev.score}/100</b>. Em vez de insistir, paro aqui.</p>${ev.fails.map(k=>`<div class="fixl"><b>✗ ${k.l}</b><span>${k.cause}</span></div>`).join('')}<p style="margin-top:8px">Diz-me como queres avançar, ou restaura o checkpoint inicial no Gestor de missões.</p>`);M.state='bloqueada';note('Missão bloqueada: '+S.title);}
    else{phase(8,'Entregar');checkpoint('Entrega · '+S.title);const ass=M.decs.filter(d=>d.status==='pressuposto');
      const d=card(who('plan'),`<p><b>${S.title}</b> — concluído com auto-avaliação <b style="color:var(--green)">${ev.score}/100</b>${M.retries?`, depois de ${M.retries} correcção(ões) feita(s) por mim`:''}.</p><ul>${S.done.map(x=>`<li>${x}</li>`).join('')}</ul>${ass.length?`<p><span class="tag warn">pressuposto a rever</span> ${ass.map(a=>a.q+' → <b>'+a.choice+'</b>').join('; ')}</p>`:''}<p style="color:var(--fg-dim)">${M.decs.length} decisões registadas · ${M.files.size} ficheiro(s) alterado(s).</p><div class="gate"><button class="gb" onclick="goPane('scm')">Ver alterações</button><button class="gb" onclick="openManager()">Registo de decisões</button></div>`);
      const doC=MODE==='auto'?1:await ask(d.bd,[{l:'Fazer commit',v:1,pri:1,done:'✓ commit aprovado por ti'},{l:'Deixar por commitar',v:0,done:'fica por commitar'}]);
      if(doC){STAGED.clear();M.files.forEach(p=>{if(stOf(p))STAGED.add(p);});const k=commitGit(S.commit);if(k)d.bd.insertAdjacentHTML('beforeend',`<p>Commit <code>${k.h}</code> ${MODE==='auto'?'feito automaticamente':'feito'}: <code>${esc(S.commit)}</code>. O <code>git push</code> fica contigo — exige sempre aprovação humana.</p>`);}
      await gfAsk(d.bd,M);M.state='concluída';note('Missão concluída: '+S.title+' ('+ev.score+'/100)');}
  }catch(e){if(e!==STOP){console.error(e);card('sistema','Erro inesperado: '+esc(e.message||e));}else card('co-dev','Execução parada a teu pedido. O que já foi alterado continua nos ficheiros; podes restaurar o checkpoint inicial no Gestor de missões.');M.state=e===STOP?'parada':'erro';}
  finally{AUTHOR='w';M.dur=Math.round((Date.now()-M.t0)/1000);runState(false);refresh();scrollMsgs();}}
/* publica os `function …` do motor de missões (runMission é window.* acima) */
Object.assign(window,{dec,decideQ,council,execSteps,evaluate,reflect});

/* ───── conversa livre: Claude ao vivo com ferramentas sobre o workspace ───── */
function handlePrompt(q){if(RUN.active){toast('Há uma execução em curso — pára-a ou espera');return;}focusAgent(true);
  if(q==='/test'||q==='/lint'){user(q);const r=runTask(q==='/test'?'cargo test':'dx lint');card('co-dev',`<code>${q==='/test'?'cargo test':'dx lint'}</code> → ${r&&r.ok?'✓':'✖'} ${esc(r?r.sum:'')}`);return;}
  const S=SCN_().find(s=>s.match.test(q));if(S)runMission(S,q);else liveChat(q);}
function agSend(){const i=$('#ag-input'),q=i.value.trim();if(!q)return;i.value='';handlePrompt(q);}
async function liveChat(q){user(q);const P=PROV[ACTIVE];
  if(!P.on){card('sistema',`<b>${P.name}</b> está desligado. Liga-o nas Definições ou escolhe outro modelo.`);return;}
  if(ACTIVE!=='claude'&&!window.__TAURI__){card('sistema',`<b>${P.name}</b> está <b>simulado</b> neste protótipo: a página não pode chamar ${esc(P.ep)}. Para uma resposta real muda para Claude, ou corre uma missão guionada:${demoChips}`);return;}
  if(!SAMPLE){card('sistema',`A ligação ao vivo ao Claude não está disponível nesta vista. As missões guionadas funcionam na mesma:${demoChips}`);return;}
  const t=tabOf(cur),af=CTX_ON&&t&&t.path&&FS[t.path]?t.path:null;
  const sys=`És o Co-Dev do dxtutor IDE: um co-programador sénior que entende requisitos, arquitectura, design system, padrões de projecto e base de dados. Trabalhas orientado por um programador humano.
Modo de autonomia actual: ${MODES[MODE].l}. Em modo Manual as tuas edições e comandos podem ser rejeitados pelo humano.
Tens ferramentas para listar, ler e escrever ficheiros do workspace, correr os testes e o lint do Design System. Lê antes de editar. write_file recebe o conteúdo COMPLETO do ficheiro. Depois de editar, corre run_tests e design_lint, avalia o teu próprio resultado e corrige se falhar (no máximo 2 tentativas).
Responde em português (ortografia pré-AO90), de forma curta e concreta. Usa markdown simples.

Regras do projecto:
${FS[ROOT+'.dxtutor/regras.md']?FS[ROOT+'.dxtutor/regras.md'].content:''}
Ficheiros do workspace:
${Object.keys(FS).map(short).join('\n')}
${af?`\nFicheiro activo (${short(af)}):\n${FS[af].content.slice(0,6000)}`:''}`;
  CHAT.push({role:'user',content:q});const sysA=sys+agentSys();const msgs=CHAT.slice(-9).map(m=>({...m}));while(msgs.length&&msgs[0].role!=='user')msgs.shift();msgs[0].content=sysA+'\n\n———\n\n'+msgs[0].content;
  const c=card(AGENTS[AGENT].n.toLowerCase()+' · claude ao vivo','<span class="spin"></span> a pensar…');runState(true,'Claude ao vivo');RUN.abort=new AbortController();
  const tools=[
    {name:'list_files',description:'Lista os caminhos de todos os ficheiros do workspace.',inputSchema:{type:'object',properties:{}},execute:async()=>{tl(c.tools,'list_files','');return Object.keys(FS).map(short);}},
    {name:'read_file',description:'Lê o conteúdo de um ficheiro do workspace.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']},execute:async({path})=>{const p=norm(path);if(!FS[p])throw new Error('ficheiro não existe: '+path);tl(c.tools,'read_file',short(p)).querySelector('.tr').innerHTML='<span class="okc">✓</span>';return FS[p].content;}},
    {name:'write_file',description:'Cria ou substitui um ficheiro com o conteúdo completo indicado. Pode exigir aprovação humana.',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']},execute:async({path,content})=>{harnessCheck(norm(path));const ok=await doTool({t:'edit',p:norm(path),content:String(content)},c.tools,'plan');if(!ok)throw new Error('edição rejeitada pelo humano');return'ok';}},
    {name:'run_tests',description:'Corre cargo test. Parâmetro opcional package: "lexer" ou "store".',inputSchema:{type:'object',properties:{package:{type:'string'}}},execute:async(i)=>{harnessCmd('cargo test');const r=await doTool({t:'run',cmd:'cargo test'+(i&&i.package?' -p '+i.package:'')},c.tools);return r?r.sum:'o humano não autorizou o comando';}},
    {name:'design_lint',description:'Corre o lint do Design System (cores fixas fora dos tokens).',inputSchema:{type:'object',properties:{}},execute:async()=>{harnessCmd('dx lint');const r=await doTool({t:'run',cmd:'dx lint'},c.tools);return r?r.sum:'o humano não autorizou o comando';}},
    {name:'delegate_task',description:'Delega um conjunto de alterações de ficheiros a um executor isolado (git worktree de HEAD) e devolve o diff para revisão, SEM tocar na árvore de trabalho. Usa quando queres propor várias edições de uma vez para o humano rever como patch. input: writes = lista de [caminho, conteúdo].',inputSchema:{type:'object',properties:{writes:{type:'array'}},required:['writes']},execute:async({writes}:{writes:any[]})=>{const DX=(window as any).DXR;if(!DX||!DX.delegate)return'delegação isolada indisponível nesta vista (precisa do app desktop com pasta aberta)';const w:[string,string][]=(writes||[]).map((x:any)=>Array.isArray(x)?[String(x[0]),String(x[1])]:[String(x.path),String(x.content)]);const st=await DX.delegate(w);tl(c.tools,'delegate_task',st.status);return st.status==='done'?('patch isolado (worktree de HEAD):\n'+st.patch):('falhou: '+(st.error||st.status));}}];
  try{const r=await SAMPLE(msgs,{tools,signal:RUN.abort.signal,cache:false,onText:({text})=>{c.bd.innerHTML=md(text);scrollMsgs();}});
    c.bd.innerHTML=md(r.text||'(sem texto)');CHAT.push({role:'assistant',content:r.text||''});LIVE_OK=true;use('claude',Math.round((sys.length+q.length+(r.text||'').length)/4));
  }catch(e){CHAT.pop();const code=e&&e.code;c.bd.innerHTML=RUN.stop||e===STOP?'Resposta interrompida.':code==='not_granted'?'O acesso ao Claude não foi autorizado nesta página. As missões guionadas continuam disponíveis.':code==='rate_limited'?'Limite de pedidos atingido — tenta daqui a pouco.':'Não consegui obter resposta do Claude ('+esc((e&&e.message)||code||'erro')+').';}
  finally{runState(false);refresh();ctxPill();scrollMsgs();}}

/* ───── posicionamento do painel ───── */
window.renderAgentView=(t,host)=>{host.innerHTML=`<div class="agent-center"><div class="ac-head"><div class="ag-mark">${svg('sparkle')}</div><div class="ag-name">Co-Dev</div><button class="ac-dock" onclick="assistantDock()">${svg('dock-right')} Fixar à direita</button></div><div class="ac-body"><div id="agent-slot"></div></div></div>`;$('#agent-slot').appendChild($('#ag-body'));setVar('--agent-w','0px');$('#tgl-agent').classList.remove('on');scrollMsgs();};
function assistantCenter(){openTab({id:'agent',title:'Co-Dev',kind:'agent'});}
function assistantDock(){closeTab('agent');}
function toggleAgent(){if(tabOf('agent')){closeTab('agent');return;}const show=getVar('--agent-w')==='0px';setVar('--agent-w',show?'380px':'0px');$('#tgl-agent').classList.toggle('on',show);}
function toggleAgentOn(){focusAgent();}
function focusAgent(nofocus){if(tabOf('agent')){if(cur!=='agent')show('agent');}else if(getVar('--agent-w')==='0px')toggleAgent();if(!nofocus)$('#ag-input').focus();}
/* publica o motor de conversa livre + posicionamento; VIEW.agent fica como shim em app.ts (VIEW nasce depois) */
Object.assign(window,{handlePrompt,agSend,liveChat,assistantCenter,assistantDock,toggleAgent,toggleAgentOn,focusAgent});

/* ───── páginas: boas-vindas, definições, gestor, análise ───── */
window.renderWelcomePage=(t,host)=>{const w=(ic,a,b,act)=>`<button class="wbtn" onclick="${act}"><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML=`<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">Um IDE com um Co-Dev multi-modelo. Tudo aqui é navegável: os ficheiros editam-se, a pesquisa procura, o git faz commit, os testes reagem ao código — e o Co-Dev trabalha sobre esses mesmos ficheiros.</div>
  <h2>Ver o Co-Dev a trabalhar</h2><div class="wgrid">${w('sparkle','Histórico de conversas','Missão completa, com auto-correcção',"demo('b')")}${w('debug','Corrigir o E0382','Conselho de 3 modelos + juiz',"demo('a')")}${w('graph','Gestor de missões','Decisões, checkpoints e uso','openManager()')}${w('settings','Modelos e autonomia','Provedores, routing, modos','openSettings()')}</div>
  <h2>Navegar</h2><div class="wgrid">${w('search','Ir para ficheiro','Ctrl+P',"palette('')")}${w('run','Todos os comandos','Ctrl+Shift+P',"palette('>')")}${w('book','O que mudou e porquê','Análise face a VS Code, Antigravity e Claude Desktop','openAnalysis()')}${w('explorer','Conhecimento do projecto','Regras, ADRs, Design System, BD',"goPane('codev')")}</div></div>`;};
function openSettings(){openTab({id:'settings',title:'Definições',kind:'settings'});}
function openManager(){openTab({id:'manager',title:'Gestor de missões',kind:'manager'});}
function openAnalysis(){openTab({id:'analysis',title:'Análise',kind:'analysis'});}
window.testProv = function(k,btn){btn.textContent='a testar…';setTimeout(()=>{btn.textContent='Testar ligação';const o=btn.parentElement.querySelector('.pd');o.innerHTML=k==='claude'?(SAMPLE?'<span style="color:var(--green)">✓ ao vivo</span> — respostas reais através do Claude deste artefacto.':'Ao vivo indisponível nesta vista; activa-se com o artefacto aberto em claude.ai.'):`<span style="color:var(--yellow)">simulado</span> — a página não pode chamar ${esc(PROV[k].ep)}; a chamada real é feita pelo backend da aplicação.`;},500);}
const POLICY=[['Responder a perguntas de clarificação','tu','Co-Dev se confiança ≥ 80%; senão pergunta','Co-Dev; abaixo de 80% assume a opção reversível e assinala'],['Escolher entre propostas dos modelos','tu, com recomendação do juiz','juiz','juiz'],['Aprovar o plano','tu','automático','automático'],['Editar ficheiros','aprovas cada edição','automático, com diff','automático, com diff'],['Terminal: testes, build, lint','aprovas','automático','automático'],['Terminal: outros comandos','aprovas','aprovas','automático'],['Corrigir depois de falhar a auto-avaliação','aprovas','automático (máx. 2)','automático (máx. 2)'],['Commit local','aprovas','aprovas','automático'],['Push e acções destrutivas','aprovas','aprovas','aprovas — sempre']];
window.renderSettingsPage=(t,host)=>{const mi=Object.keys(MODES).indexOf(MODE);
  host.innerHTML=`<div class="page"><h1>Definições</h1><div class="sub">Guardadas neste browser. Chaves e endpoints reais ficam no keychain da aplicação — aqui servem para mostrar o contrato.</div>
  <h2>Modelos e provedores</h2><div class="pgrid">${Object.entries(PROV).map(([k,p])=>`<div class="pcard"><div class="ph"><span class="pdot${p.on?'':' off'}" style="background:${p.col}"></span>${p.name}<span class="tag ${k==='claude'&&SAMPLE?'live':''}">${provState(k)}</span><button class="sw${p.on?' on':''}" title="Ligar / desligar" onclick="toggleProv('${k}')"></button></div>
    <div><label>Modelo</label><input value="${esc(p.model)}" onchange="PROV.${k}.model=this.value;save();updateAgentUI()"></div><div><label>Endpoint</label><input value="${esc(p.ep)}" onchange="PROV.${k}.ep=this.value"></div>
    <div><label>${p.local?'Chave (não é necessária)':'Chave de API'}</label><input type="password" placeholder="${p.local?'—':'guardada no keychain'}" ${p.local?'disabled':''}></div><button class="mini" onclick="testProv('${k}',this)">Testar ligação</button><div class="pd"></div></div>`).join('')}</div>
  <h2>Routing por papel</h2><div class="tbl-wrap">${Object.keys(ROUTE).map(r=>`<div class="rowline"><span class="pdot" style="background:${PROV[provFor(r)].col}"></span><b>${ROLE[r]}</b><span style="color:var(--fg-muted)">${ROLE_D[r]}</span><span class="sp"></span><select style="width:150px" onchange="ROUTE.${r}=this.value;save();show(cur)">${Object.entries(PROV).map(([k,p])=>`<option value="${k}"${ROUTE[r]===k?' selected':''}>${p.name}${p.on?'':' (desligado)'}</option>`).join('')}</select></div>`).join('')}</div><div class="sub" style="margin-top:8px">Se o provedor de um papel estiver desligado, o Co-Dev recorre ao primeiro que estiver ligado.</div>
  <h2>Autonomia</h2><div class="pgrid">${Object.entries(MODES).map(([k,m])=>`<button class="pcard${k===MODE?' sel':''}" onclick="setMode('${k}')"><div class="ph">${m.l}${k===MODE?'<span class="tag acc">activo</span>':''}</div><div class="pd">${m.d}</div></button>`).join('')}</div>
  <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><tr><th>Acção</th><th>Manual</th><th>Assistido</th><th>Auto</th></tr>${POLICY.map(r=>`<tr><td>${r[0]}</td>${[1,2,3].map(i=>`<td class="${i-1===mi?'on':'c'}">${r[i]}</td>`).join('')}</tr>`).join('')}</table></div>
  <h2>Auto-avaliação</h2><div class="tbl-wrap"><div class="rowline"><b>Limiar para entregar</b><span style="color:var(--fg-muted)">abaixo disto o Co-Dev corrige em vez de entregar</span><span class="sp"></span><input type="range" min="50" max="100" step="5" value="${THRESH}" style="width:140px" oninput="THRESH=+this.value;this.nextElementSibling.textContent=THRESH;save()"><b style="width:28px;text-align:right">${THRESH}</b></div><div class="rowline"><b>Tentativas de correcção</b><span class="sp"></span><span>2, depois pede orientação</span></div><div class="rowline"><b>Rubrica do juiz</b><span class="sp"></span><span>${CRIT.map(k=>k.l+' '+k.w).join(' · ')}</span></div></div>
  <h2>Aparência</h2><div class="pgrid">${Object.keys(THEMES).map(n=>`<button class="pcard${n===THEME?' sel':''}" onclick="setTheme('${n}')"><div class="ph">${n}${n===THEME?'<span class="tag acc">activo</span>':''}</div></button>`).join('')}</div>
  <h2>Atalhos de teclado</h2><div class="tbl-wrap">${CMD.filter(c=>c[1]).map(c=>`<div class="rowline"><span>${c[0]}</span><span class="sp"></span><kbd>${c[1]}</kbd></div>`).join('')}</div></div>`;};
window.renderManagerPage=(t,host)=>{const st={'concluída':'live','em curso':'acc','bloqueada':'bad','parada':'warn','erro':'bad'};
  host.innerHTML=`<div class="page"><h1>Gestor de missões</h1><div class="sub">Tudo o que o Co-Dev fez, decidiu e pode desfazer.</div>
  <h2>Missões</h2><div class="tbl-wrap">${MISSIONS.map(m=>`<div class="rowline"><span class="tag ${st[m.state]||''}">${m.state}</span><b>${esc(m.title)}</b><span style="color:var(--fg-muted)">modo ${MODES[m.mode].l} · ${m.decs.length} decisões${m.retries?' · '+m.retries+' correcção(ões)':''}${m.dur!=null?' · '+m.dur+'s':''}</span><span class="sp"></span>${m.score!=null?`<b style="color:${m.score>=THRESH?'var(--green)':'var(--red)'}">${m.score}/100</b>`:''}</div>`).join('')||'<div class="rowline" style="color:var(--fg-muted)">Ainda sem missões.<span class="sp"></span><button class="mini" onclick="demo(\'b\')">Correr a demonstração</button></div>'}</div>
  <h2>Registo de decisões</h2><div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>Fase</th><th>Decisão</th><th>Escolha</th><th>Quem</th><th>Confiança</th><th>Estado</th></tr>${DECS.map(d=>`<tr><td class="c">${d.id}</td><td class="c">${d.phase}</td><td>${esc(d.q)}<div style="color:var(--fg-muted);font-size:11px">${esc(d.basis||'')}</div></td><td>${esc(d.choice)}</td><td>${d.by}</td><td class="c">${d.conf?Math.round(d.conf*100)+'%':'—'}</td><td><span class="tag ${d.status==='ok'?'live':d.status==='corrigida'?'bad':'warn'}">${d.status==='ok'?'válida':d.status==='corrigida'?'corrigida depois':'pressuposto'}</span></td></tr>`).join('')||'<tr><td colspan="7" class="c">Sem decisões registadas.</td></tr>'}</table></div>
  <h2>Checkpoints</h2><div class="tbl-wrap">${CKPT.map(c=>`<div class="rowline"><span style="color:var(--fg-muted);font-family:var(--font-mono);font-size:11px">${c.t}</span><span>${esc(c.label)}</span><span class="sp"></span><button class="mini" onclick="restoreCkpt(${c.id})">Restaurar ficheiros</button></div>`).join('')||'<div class="rowline" style="color:var(--fg-muted)">Criados antes de cada missão e de cada correcção.</div>'}</div>
  <h2>Uso por provedor <span style="text-transform:none;letter-spacing:0;font-weight:400">(estimativa)</span></h2><div class="tbl-wrap">${Object.entries(PROV).map(([k,p])=>`<div class="rowline"><span class="pdot${p.on?'':' off'}" style="background:${p.col}"></span><b>${p.name}</b><span style="color:var(--fg-muted)">${Object.keys(ROUTE).filter(r=>ROUTE[r]===k).map(r=>ROLE[r]).join(', ')||'sem papel'}</span><span class="sp"></span><span>${USAGE[k].calls} chamadas · ${(USAGE[k].tok/1000).toFixed(1)}k tokens</span></div>`).join('')}</div></div>`;};
const GAPS=window.GAPS=[['Paleta de comandos, quick open, atalhos','VS Code','Menus só mostravam um aviso','Feito: Ctrl+P, Ctrl+Shift+P, todos os menus ligados a acções'],['Editor de código','VS Code','Texto fixo, só de leitura','Feito: editável, realce, diagnósticos na margem, Ln/Col, outline'],['Pesquisa e substituição','VS Code','Resultados desenhados à mão','Feito: procura real em todos os ficheiros, substituir tudo'],['Git','VS Code','Lista estática de 3 ficheiros','Feito: estado real, diff, stage, descartar, commit, ramos'],['Testes e problemas','VS Code','Contagens fixas','Feito: derivados do conteúdo dos ficheiros; clicar leva à linha'],['Gestor de missões','Antigravity (Agent Manager)','Não existia','Feito: missões, estado, pontuação, duração'],['Artefactos de confiança','Antigravity','Só um plano decorativo','Feito: requisitos, plano, diffs por edição, avaliação, entrega'],['Política de autonomia','Antigravity + Claude','Não existia','Feito: Manual / Assistido / Auto com matriz por tipo de acção'],['Ferramentas visíveis e aprováveis','Claude Desktop','Resposta «sem backend»','Feito: cada leitura, edição e comando aparece e pode ser aprovado'],['Checkpoints e reversão','Claude Code','Não existia','Feito: automáticos, restauráveis'],['Conhecimento do projecto','CLAUDE.md / Knowledge','Não existia','Feito: .dxtutor/ com regras, requisitos, ADRs, Design System, padrões, BD'],['Vários provedores com routing por papel','—','Um modelo fixo','Feito: Claude ao vivo; Gemini, Codex e Ollama com o mesmo contrato, simulados'],['Conselho de modelos com juiz','—','Não existia','Feito: propostas concorrentes, rubrica ponderada, decisão registada'],['Auto-avaliação e auto-correcção','—','Não existia','Feito: pontuação por critérios, limiar, reflexão, 2 tentativas, depois escala']];
const NEXT=[['Adaptadores reais de LLM','Um <code>trait ModelProvider</code> no backend (Tauri/Rust) com implementações para Anthropic, Gemini, OpenAI e Ollama em <code>localhost:11434</code>; streaming e tool-calling normalizados.'],['Linguagem a sério','LSP (rust-analyzer, tsserver) em vez de expressões regulares; Monaco ou CodeMirror como editor.'],['Terminal e git reais','PTY no backend, libgit2, worktrees para missões em paralelo.'],['Execução isolada','Sandbox por missão para o modo Auto, com lista de comandos permitidos por projecto.'],['Contexto do repositório','Indexação e pesquisa semântica (RAG) para o Co-Dev ler só o que interessa.'],['MCP','Ligar ferramentas externas (Odoo, bases de dados, browser) pelo mesmo mecanismo de aprovação.'],['Juiz calibrado','A rubrica deve ser avaliada com testes reais e um conjunto de casos conhecidos, não só pela opinião de um modelo.'],['Custos e limites','Contagem real de tokens por provedor e orçamento por missão.']];
window.renderAnalysisPage=(t,host)=>{host.innerHTML=`<div class="page"><h1>O que mudou e porquê</h1><div class="sub">Comparação do protótipo anterior com o que o VS Code, o Antigravity e o Claude Desktop fazem bem — e o que ficou feito nesta versão.</div>
  <h2>Lacunas fechadas</h2><div class="tbl-wrap"><table class="tbl"><tr><th>Capacidade</th><th>Referência</th><th>Antes</th><th>Agora</th></tr>${GAPS.map(g=>`<tr><td><b>${g[0]}</b></td><td class="c">${g[1]}</td><td class="c">${g[2]}</td><td>${g[3]}</td></tr>`).join('')}</table></div>
  <h2>O que um protótipo no browser não pode fazer</h2><div class="sub">Esta página corre isolada: não chega à rede nem à tua máquina. Só o Claude responde ao vivo. O resto exige o backend da aplicação:</div><div class="tbl-wrap">${NEXT.map(n=>`<div class="rowline" style="align-items:flex-start"><b style="flex:none;width:190px">${n[0]}</b><span style="color:var(--fg-dim);line-height:1.5">${n[1]}</span></div>`).join('')}</div></div>`;};
/* publica openManager/openSettings/openAnalysis (testProv é window.* acima); os VIEW.* ficam shims em app.ts */
Object.assign(window,{openManager,openSettings,openAnalysis});

/** Renderiza o pane «Co-Dev»: base (missões, conhecimento, checkpoints, routing) e,
 *  por cima, a camada v4 (equipa, backlog, studio). */
function renderCodevPane(): void {
  const FS = window.FS, MISSIONS = window.MISSIONS, CKPT = window.CKPT, ROUTE = window.ROUTE,
    ROLE = window.ROLE, PROV = window.PROV, provFor = window.provFor, fIcon = window.fIcon,
    AGENTS = window.AGENTS, BL = window.BL, STAGES = window.STAGES, SD = window.SD;
  // ── base v3 ──
  const kn = Object.keys(FS).filter(p => p.includes("/.dxtutor/")).sort();
  const el = $("#pane-codev");
  if (!el) return;
  el.innerHTML = hd("Co-Dev", `<button title="Gestor de missões" onclick="openManager()">${svg("graph")}</button><button title="Definições" onclick="openSettings()">${svg("settings")}</button>`) + `<div class="sections">
   <div class="scm-grp">Missões<span class="cnt">${MISSIONS.length}</span></div>${MISSIONS.slice(0, 5).map((m: any) => `<div class="scm-row" onclick="openManager()"><span class="ic" style="color:var(--accent-hover)">${svg("sparkle")}</span><span class="nm">${esc(m.title)}</span><span class="pth">${m.state}${m.score != null ? " · " + m.score : ""}</span></div>`).join("") || '<div class="sec-empty">Ainda sem missões. Experimenta uma das demonstrações no painel do Co-Dev.</div>'}
   <div class="scm-grp">Conhecimento do projecto<span class="cnt">${kn.length}</span></div>${kn.map(p => `<div class="scm-row" onclick="openPath('${p}')">${fIcon(p)}<span class="nm" style="max-width:none">${esc((p.split("/").pop() as string).replace(".md", ""))}</span></div>`).join("")}
   <div class="scm-grp">Checkpoints<span class="cnt">${CKPT.length}</span></div>${CKPT.slice(0, 6).map((c: any) => `<div class="scm-row" style="cursor:default"><span class="ic">${svg("history")}</span><span class="nm">${esc(c.label)}</span><span class="ra" style="display:flex"><button title="Restaurar" onclick="restoreCkpt(${c.id})">↶</button></span></div>`).join("") || '<div class="sec-empty">Criados automaticamente antes de cada missão e de cada correcção.</div>'}
   <div class="scm-grp">Routing</div>${Object.keys(ROUTE).map(r => `<div class="kv"><span class="pdot" style="background:${PROV[provFor(r)].col}"></span>${ROLE[r]}<span class="v">${PROV[provFor(r)].name}</span></div>`).join("")}</div>`;
  // ── decoração v4 (Equipa / Backlog / Studio) ──
  const sec = $("#pane-codev .sections");
  if (sec) sec.insertAdjacentHTML("afterbegin", `<div class="scm-grp">Equipa<span class="cnt">${Object.keys(AGENTS).length}</span></div>${Object.entries(AGENTS).map(([, a]: [string, any]) => `<div class="scm-row" onclick="openTeam()" title="${esc(a.d)}"><span class="pdot" style="background:${a.col}"></span><span class="nm">${a.n}</span><span class="pth">${esc(a.paths.join(", ") || "só leitura")}</span></div>`).join("")}<div class="scm-grp">Backlog<span class="cnt">${BL.issues.length}</span></div><div class="scm-row" onclick="openBoard()"><span class="ic">${svg("split")}</span><span class="nm">Quadro</span><span class="pth">${STAGES.map(s => BL.issues.filter((i: any) => i.stage === s[0]).length).join(" · ")}</span></div><div class="scm-row" onclick="openStudio()"><span class="ic">${svg("cube")}</span><span class="nm">Studio</span><span class="pth">${SD.nodes.filter((n: any) => n.st === "plan").length} planeados</span></div>`);
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.codev (app.ts) delega em renderCodevPane. */
window.renderCodevPane = renderCodevPane;
