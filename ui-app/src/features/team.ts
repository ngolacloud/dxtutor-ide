/* ═════════ dxtutor IDE — feature: Team / harness (equipa de assistentes) ═════════
   Motor invertido de `app.ts` (3ª/4ª inversão, como scm/debug/ext). O mais entrelaçado:
   `AGENTS` é DECORADO por app.ts (Object.assign(AGENTS.be,…)) e LIDO por board.ts/codev.ts
   e pelo router → window-backing obrigatório. A feature avalia ANTES de app.ts; `AGENTS`
   nasce `const AGENTS=(window.AGENTS={…})` (literal puro, sem reads eager) para que a
   decoração e os ~43 usos externos resolvam o MESMO objecto global. `window.AGENT='lead'`
   inicializa o assistente activo. Globais do resíduo (short/norm/palette/$/esc/PROV/CAPL/
   CAP/TASKP/rankModels/show/cur) resolvem por window em runtime (@ts-nocheck, late-binding).

   CORRIGE um gap latente: board.ts chamava `inScope`/`ownerOf` por global mas app.ts não os
   publicava — aqui são publicados no window. `openTeam` (abrir tab) NÃO migra: a versão viva
   é a de v5.ts; o $dup0 de abertura fica em app.ts. VIEW.team é eager + DECORADO por v5/v6 →
   corpo aqui em `renderTeamView` e shim brace-less `VIEW.team=(t,host)=>window.renderTeamView(…)`
   em app.ts (v5/v6 continuam a decorar o shim). GOTCHA C: os símbolos saíram do Object.assign
   de app.ts. */

import { esc } from "../core";

interface Agent { n: string; d: string; col: string; paths: string[]; cmds: string[]; task: string; model: string; max: number }
const AGENTS: Record<string, Agent> = (window.AGENTS = {
  lead:{n:'Co-Dev',d:'Orquestrador: decompõe, delega e integra',col:'#e06c3b',paths:['**'],cmds:['*'],task:'arch',model:'auto',max:20},
  arq:{n:'Arquitecto',d:'Requisitos, arquitectura, ADRs e backlog',col:'#e08a5b',paths:['.dxtutor/**','docs/**'],cmds:[],task:'arch',model:'auto',max:4},
  be:{n:'Backend',d:'Crates Rust e comandos Tauri',col:'#dea584',paths:['crates/**'],cmds:['cargo build','cargo test','cargo clippy'],task:'code',model:'auto',max:6},
  db:{n:'Base de dados',d:'Esquema, migrações e índices',col:'#5cc9a7',paths:['db/migrations/**'],cmds:['cargo test -p store'],task:'db',model:'auto',max:3},
  fe:{n:'Frontend',d:'Interface e Design System',col:'#6ea8ff',paths:['desktop/src/**'],cmds:['dx lint','npm run dev','npm run lint'],task:'ui',model:'auto',max:6},
  qa:{n:'QA',d:'Testes automáticos',col:'#e0b64a',paths:['crates/*/tests/**','tests/**'],cmds:['cargo test','dx lint','dx test'],task:'test',model:'auto',max:6},
  ops:{n:'Plataforma',d:'Infra, CI/CD e deploy',col:'#c678dd',paths:['deploy/**','.ci/**','Cargo.toml'],cmds:['cargo build','git push'],task:'ops',model:'auto',max:4},
  tutor:{n:'Tutor',d:'Explica e orienta; nunca escreve por ti',col:'#5fcad6',paths:[],cmds:[],task:'teach',model:'auto',max:0}});
window.AGENT='lead';
const globRe=(g:string)=>new RegExp('^'+g.split('**').map(s=>s.split('*').map(x=>x.replace(/[.+^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$');
const inScope=(a:string,p:string)=>AGENTS[a].paths.some(g=>globRe(g).test(short(p)));
const canRun=(a:string,cmd:string)=>AGENTS[a].cmds.some(c=>c==='*'||cmd.startsWith(c));
const ownerOf=(p:string)=>Object.keys(AGENTS).find(k=>k!=='lead'&&inScope(k,p))||'lead';
function harnessCheck(p:string){if(!inScope(AGENT,p)){const o=ownerOf(p);throw new Error(`fora do escopo do assistente ${AGENTS[AGENT].n}. Pode escrever em: ${AGENTS[AGENT].paths.join(', ')||'nada'}. Este caminho pertence a: ${AGENTS[o].n}.`);}}
function harnessCmd(c:string){if(!canRun(AGENT,c))throw new Error(`o assistente ${AGENTS[AGENT].n} não tem permissão para correr "${c}".`);}
const agentSys=()=>{const a=AGENTS[AGENT];return `\nÉs o assistente «${a.n}» (${a.d}). Harness: só podes escrever em [${a.paths.join(', ')||'nenhum caminho'}] e correr [${a.cmds.join(', ')||'nenhum comando'}]. Se a tarefa exigir sair deste escopo, não o faças: diz que assistente da equipa (${Object.values(AGENTS).map(x=>x.n).join(', ')}) deve tratar dessa parte.`+(AGENT==='tutor'?'\nComo Tutor: não dês a solução completa. Faz perguntas, explica o conceito, dá pistas graduais e pede ao aluno que tente.':'');};
function saveTeam(){LS.set('team3',Object.fromEntries(Object.entries(AGENTS).map(([k,a])=>[k,{paths:a.paths,cmds:a.cmds,model:a.model,max:a.max}])));}
function loadTeam(){const t=LS.get('team3',null);if(t)Object.keys(AGENTS).forEach(k=>{if(t[k]){['paths','cmds'].forEach(f=>{if(Array.isArray(t[k][f]))(AGENTS[k] as any)[f]=t[k][f];});if(t[k].model)AGENTS[k].model=t[k].model;if(t[k].max!=null)AGENTS[k].max=t[k].max;}});}
function pickAgent(){palette('',{ph:'Com que assistente queres falar?',items:Object.entries(AGENTS).map(([k,a])=>({l:a.n,d:a.d,run:()=>{AGENT=k;agentPill();toast('Assistente: '+a.n);}}))});}
function agentPill(){const p=$('#pill-agent');if(p){p.innerHTML=`<span class="pdot" style="background:${AGENTS[AGENT].col}"></span>${AGENTS[AGENT].n}`;}}
function scopeProbe(v:string){const o=$('#probe-out');if(!o)return;if(!v.trim()){o.textContent='';return;}const who=Object.keys(AGENTS).filter(k=>k!=='lead'&&inScope(k,norm(v)));o.innerHTML=who.length?'Pode escrever: '+who.map(k=>`<b style="color:${AGENTS[k].col}">${AGENTS[k].n}</b>`).join(', '):'Nenhum assistente especializado — só o orquestrador, com a tua aprovação.';}
function renderTeamView(_t:unknown,host:HTMLElement){host.innerHTML=`<div class="page"><h1>Equipa de assistentes</h1><div class="sub">Cada assistente tem uma responsabilidade e um <b>harness</b>: os caminhos onde pode escrever, os comandos que pode correr e o limite de ficheiros por tarefa. O harness é aplicado em cada chamada de ferramenta — se um assistente tentar sair do escopo, a acção é bloqueada e delegada a quem é dono do caminho.</div>
  <h2>Testar o escopo</h2><div class="tbl-wrap"><div class="rowline"><input class="inp" style="margin:0;width:320px" placeholder="ex.: db/migrations/0005_x.sql" oninput="scopeProbe(this.value)"><span id="probe-out" style="color:var(--fg-dim)"></span></div></div>
  <h2>Assistentes</h2><div class="pgrid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${Object.entries(AGENTS).map(([k,a])=>`<div class="pcard"><div class="ph"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${AGENT===k?'<span class="tag acc">na conversa</span>':`<button class="mini" style="margin-left:auto" onclick="AGENT='${k}';agentPill();show(cur)">Falar</button>`}</div><div class="pd">${a.d}</div>
    <div><label>Pode escrever em (um padrão por linha)</label><textarea rows="2" onchange="AGENTS.${k}.paths=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.paths.join('\n'))}</textarea></div>
    <div><label>Comandos permitidos</label><textarea rows="2" onchange="AGENTS.${k}.cmds=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.cmds.join('\n'))}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><div><label>Modelo</label><select onchange="AGENTS.${k}.model=this.value;saveTeam()"><option value="auto"${a.model==='auto'?' selected':''}>Automático (router)</option>${Object.entries(PROV).map(([p,v])=>`<option value="${p}"${a.model===p?' selected':''}>${v.name}</option>`).join('')}</select></div><div><label>Máx. ficheiros</label><input type="number" min="0" max="50" value="${a.max}" onchange="AGENTS.${k}.max=+this.value;saveTeam()"></div></div></div>`).join('')}</div>
  <h2>Router de modelos</h2><div class="sub">Com o modelo em «Automático», o assistente descreve a tarefa e pede o modelo mais adequado. Os perfis abaixo são valores de exemplo, editáveis na aplicação real.</div><div class="tbl-wrap"><table class="tbl"><tr><th>Provedor</th>${Object.keys(CAPL).map(c=>`<th>${CAPL[c]}</th>`).join('')}</tr>${Object.entries(PROV).map(([p,v])=>`<tr><td><span class="pdot${v.on?'':' off'}" style="background:${v.col}"></span> ${v.name}</td>${Object.keys(CAPL).map(c=>`<td class="c">${CAP[p][c]}</td>`).join('')}</tr>`).join('')}</table></div>
  <div class="tbl-wrap" style="margin-top:10px">${Object.entries(TASKP).map(([k,p])=>{const r=rankModels(k);return `<div class="rowline"><b style="width:210px;flex:none">${p.l}</b><span style="color:var(--fg-muted)">${Object.entries(p.w).map(([c,w])=>CAPL[c]+' ×'+w).join(' · ')}</span><span class="sp"></span>${r.length?`<span class="pdot" style="background:${PROV[r[0].p].col}"></span>${PROV[r[0].p].name}`:'—'}</div>`;}).join('')}</div></div>`;}

Object.assign(window, { globRe, inScope, canRun, ownerOf, harnessCheck, harnessCmd, agentSys, saveTeam, loadTeam, pickAgent, agentPill, scopeProbe, renderTeamView });
