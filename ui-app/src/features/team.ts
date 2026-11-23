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
   é a de v5.ts; o $dup0 de abertura fica em app.ts. VIEW.team é eager + DECORADO por v6 →
   corpo aqui em `renderTeamView` e shim brace-less `VIEW.team=(t,host)=>window.renderTeamView(…)`
   em app.ts (v6.ts continua a decorar o shim; v5.ts deixou de decorar — nada lhe restava, ver
   abaixo). GOTCHA C: os símbolos saíram do Object.assign de app.ts.

   Motor do harness de projecto MIGRADO de v5.ts (RIGHTS/RIGHT_RE/ALWAYS/MORD/HT/HARN/isHuman/
   harnessToml/applyTemplate/toggleRight/authorship/reviewIssue), fundido com `renderTeamView`:
   a secção "Project harness"/"Who decides"/"Who did the work" que v5.ts inseria por fora
   (DOM insertAdjacentHTML sobre o resultado de VIEW.team) passa a fazer parte do corpo único
   de renderTeamView — o wrapper `_team5`/`VIEW.team=` em v5.ts desapareceu. Resíduo que FICA
   em v5.ts (doTool/setMode/approveIssue/VIEW.board decorators, boot5, codeGuard, CMD.push)
   lê RIGHTS/RIGHT_RE/HT/MORD/isHuman/HARN/harnessToml/toggleRight/authorship/reviewIssue por
   nome livre (@ts-nocheck, late-binding) — publicados no Object.assign final. `applyTemplate`
   fica `window.applyTemplate=` directo porque v6.ts REATRIBUI a função inteira (como v5.ts já
   fazia para dxRun/dxStop/setMode/doTool/approveIssue). ALWAYS/AG0 ficam léxicos (só usados
   aqui dentro). `RUN`/`DECS` não tinham contrato ambiente em pair.ts — acrescentados; `BL`
   lê-se via `window.BL` como tasks.ts já fazia (sem novo ambiente). */

import { esc, S, jsa } from "../core";
import { CAPL, CAP, TASKP, type Capability } from "./router/domain/model-routing";
import { rankModels } from "./router";

interface Agent { n: string; d: string; col: string; paths: string[]; cmds: string[]; task: string; model: string; max: number }
// cores em var(--token) do tema (theme.ts) em vez de hex fixo — mudam ao trocar de tema;
// excepção: `be` fica no hex de marca do Rust (cor da linguagem no GitHub), não é um token de tema.
const AGENTS: Record<string, Agent> = (window.AGENTS = {
  lead:{n:'Co-Dev',d:'Orquestrador: decompõe, delega e integra',col:'var(--accent)',paths:['**'],cmds:['*'],task:'arch',model:'auto',max:20},
  arq:{n:'Arquitecto',d:'Requisitos, arquitectura, ADRs e backlog',col:'var(--accent-hover)',paths:['.dxtutor/**','docs/**'],cmds:[],task:'arch',model:'auto',max:4},
  be:{n:'Backend',d:'Crates Rust e comandos Tauri',col:'#dea584',paths:['crates/**'],cmds:['cargo build','cargo test','cargo clippy'],task:'code',model:'auto',max:6},
  db:{n:'Base de dados',d:'Esquema, migrações e índices',col:'var(--green)',paths:['db/migrations/**'],cmds:['cargo test -p store'],task:'db',model:'auto',max:3},
  fe:{n:'Frontend',d:'Interface e Design System',col:'var(--blue)',paths:['desktop/src/**'],cmds:['dx lint','npm run dev','npm run lint'],task:'ui',model:'auto',max:6},
  qa:{n:'QA',d:'Testes automáticos',col:'var(--yellow)',paths:['crates/*/tests/**','tests/**'],cmds:['cargo test','dx lint','dx test'],task:'test',model:'auto',max:6},
  ops:{n:'Plataforma',d:'Infra, CI/CD e deploy',col:'var(--purple)',paths:['deploy/**','.ci/**','Cargo.toml'],cmds:['cargo build','git push'],task:'ops',model:'auto',max:4},
  tutor:{n:'Tutor',d:'Explica e orienta; nunca escreve por ti',col:'var(--cyan)',paths:[],cmds:[],task:'teach',model:'auto',max:0}});
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
/* ───── harness de projecto: templates, decision rights, mode ceiling (migrado de
   v5.ts, fundido com renderTeamView) ─────
   A secção "Project harness"/"Who decides"/"Who did the work" que v5.ts inseria por
   fora (DOM insertAdjacentHTML sobre o resultado de VIEW.team) passa a fazer parte do
   corpo único de renderTeamView — o wrapper `_team5`/`VIEW.team=` em v5.ts desaparece
   (nada resta para decorar; v6.ts continua a decorar VIEW.team directamente a partir
   do shim de app.ts, inserindo a linha "Explain the change…"). HARN é window-backed
   como AGENTS (mutado em-lugar por doTool/approveIssue/VIEW.board em v5.ts e por
   applyTemplate/VIEW.team em v6.ts). applyTemplate fica `window.applyTemplate=`
   directo porque v6.ts REATRIBUI a função inteira; os restantes publicam-se no
   Object.assign final para o resíduo (doTool, setMode, approveIssue, VIEW.board,
   boot5, codeGuard, CMD.push em v5.ts) continuar a lê-los por nome livre. ALWAYS/AG0
   ficam léxicos (só usados aqui dentro). RUN/DECS não tinham contrato ambiente
   (pair.ts) — acrescentados; BL lê-se via `window.BL` como tasks.ts já fazia. */
const RIGHTS: Record<string, string> = { code: 'Writing code', arch: 'Architecture decisions (ADRs)', schema: 'Database schema changes', deps: 'Adding dependencies', merge: 'Merge into develop', release: 'Release to main', deploy: 'Deploy to Kubernetes', push: 'Push to remote' };
const RIGHT_RE: Record<string, RegExp> = { arch: /\.dxtutor\/arquitectura\//, schema: /db\/migrations\/|\/migrations\//, deps: /(Cargo\.toml|package\.json|go\.mod|requirements\.txt)$/ };
const ALWAYS = ['merge', 'release', 'deploy', 'push'];
const MORD = ['manual', 'assist', 'auto'];
const HT: Record<string, any> = {
  study: { n: 'Study', d: 'You write every line. The assistants explain, hint and review — they never edit files.', ceiling: 'manual', mode: 'manual', thresh: 85, human: ['code', 'arch', 'schema', 'deps'] },
  pair: { n: 'Pair programming', d: 'The assistants propose and edit inside their scope; you decide architecture, schema and dependencies.', ceiling: 'assist', mode: 'assist', thresh: 85, human: ['arch', 'schema', 'deps'] },
  cloud: { n: 'Cloud-native team', d: 'Assistants run whole issues on feature branches. You approve the architecture, review every merge and trigger deploys.', ceiling: 'auto', mode: 'assist', thresh: 85, human: ['arch'] },
  critical: { n: 'Critical systems', d: 'For regulated or safety-relevant code. Every edit is approved one by one, the bar is higher and nothing runs unattended.', ceiling: 'manual', mode: 'manual', thresh: 95, human: ['arch', 'schema', 'deps'] },
  erp: { n: 'ERP module (Odoo)', d: 'One module at a time: models, views, security and migrations each have an owner; upgrades are yours to run.', ceiling: 'assist', mode: 'assist', thresh: 90, human: ['arch', 'schema', 'deps'], agents: { be: { paths: ['addons/*/models/**', 'addons/*/controllers/**', 'addons/*/wizard/**'], cmds: ['pytest'] }, fe: { paths: ['addons/*/views/**', 'addons/*/static/**', 'addons/*/report/**'] }, db: { paths: ['addons/*/migrations/**', 'addons/*/security/**', 'addons/*/data/**'] }, qa: { paths: ['addons/*/tests/**'], cmds: ['pytest'] }, ops: { paths: ['docker-compose.yml', 'deploy/**', '.devcontainer/**'] } } },
};
const HARN: Record<string, any> = { tpl: 'pair', ceiling: 'assist', human: ['arch', 'schema', 'deps'], review: true };
const AG0 = JSON.parse(JSON.stringify(AGENTS));
/* HARN nasce com os defaults; `LS.get` só é chamado DENTRO de hydrateHarn (guard-once),
   porque team.ts avalia ANTES de app.ts — que é quem define `LS` (padrão hidratação
   preguiçosa das features-folha, como BPS em debug.ts / tasks.ts). */
let harnHydrated = false;
function hydrateHarn() { if (harnHydrated) return; harnHydrated = true; Object.assign(HARN, LS.get('harn5', {})); }
function isHuman(r: string): boolean { hydrateHarn(); return ALWAYS.includes(r) || HARN.human.includes(r); }
function harnessToml(): string {
  hydrateHarn();
  return `# Project harness — the contract between this project's humans and its assistants.
# Applied on every tool call. Edit here or in Team & harness.
template = "${HARN.tpl}"
mode_ceiling = "${HARN.ceiling}"
review_before_merge = ${HARN.review}
self_evaluation_threshold = ${S.THRESH}

[human_only]
${Object.keys(RIGHTS).map(r => `${r} = ${isHuman(r)}`).join('\n')}

${Object.entries(AGENTS).filter(([k]) => k !== 'lead').map(([k, a]) => `[assistant.${k}]
role = "${a.d}"
write = [${a.paths.map(p => `"${p}"`).join(', ')}]
run = [${a.cmds.map(p => `"${p}"`).join(', ')}]
max_files = ${a.max}
model = "${a.model}"`).join('\n\n')}
`;
}
window.applyTemplate = function (id: string) {
  hydrateHarn();
  if (RUN.active) { toast('Wait for the run to finish'); return; }
  const t = HT[id];
  Object.keys(AGENTS).forEach(k => Object.assign(AGENTS[k], JSON.parse(JSON.stringify(AG0[k]))));
  if (t.agents) Object.entries(t.agents).forEach(([k, o]) => Object.assign(AGENTS[k], o));
  Object.assign(HARN, { tpl: id, ceiling: t.ceiling, human: t.human.slice(), review: true });
  S.THRESH = t.thresh; S.MODE = t.mode; LS.set('harn5', HARN);
  saveTeam(); window.save(); updateAgentUI(); writeFile(ROOT + '.dxtutor/harness.toml', harnessToml());
  toast(`Harness applied: ${t.n}`); log('harness', `template ${id} applied · ceiling ${t.ceiling}`); rerender('team');
};
function toggleRight(r: string) {
  hydrateHarn();
  if (ALWAYS.includes(r)) return;
  const i = HARN.human.indexOf(r);
  i < 0 ? HARN.human.push(r) : HARN.human.splice(i, 1);
  LS.set('harn5', HARN);
  if (FS[ROOT + '.dxtutor/harness.toml']) writeFile(ROOT + '.dxtutor/harness.toml', harnessToml());
  rerender('team');
}
function authorship() {
  let h = 0, a = 0;
  GIT.order.forEach((x: string) => { const c = GIT.c[x]; if (!c.files.length) return; c.a === 'w' ? h++ : a++; });
  const dh = DECS.filter((d: any) => d.by === 'humano').length;
  return { h, a, dh, da: DECS.length - dh };
}
function reviewIssue(id: string) {
  const it = window.BL.issues.find((i: any) => i.id === id);
  if (!it) return;
  it.reviewed = true;
  openTab({ id: 'review', title: 'Review ' + it.id, kind: 'review', issue: id });
  rerender('board');
}

function renderTeamView(_t:unknown,host:HTMLElement){
  hydrateHarn();
  const cx=window.projectContext(),rec=cx.some(c=>c[0]==='odoo')?'erp':cx.some(c=>c[0]==='k8s'||c[0]==='compose')?'cloud':'pair';
  const au=authorship(),tot=Math.max(1,au.h+au.a);
  host.innerHTML=`<div class="page"><h1>Equipa de assistentes</h1><div class="sub">Cada assistente tem uma responsabilidade e um <b>harness</b>: os caminhos onde pode escrever, os comandos que pode correr e o limite de ficheiros por tarefa. O harness é aplicado em cada chamada de ferramenta — se um assistente tentar sair do escopo, a acção é bloqueada e delegada a quem é dono do caminho.</div>
  <h2>Project harness</h2><div class="sub">The harness is the project's contract: what the assistants may touch, how far they may go on their own, and which decisions stay with you. It is derived from the project context and saved as <code>.dxtutor/harness.toml</code>, so it is versioned with the code.</div>
  <div class="rowline hx"><b>Detected context</b>${cx.map(c=>`<span class="tag">${c[1]}</span>`).join('')}<span class="sp"></span>${FS[ROOT+'.dxtutor/harness.toml']?`<button class="mini" onclick="openPath(ROOT+'.dxtutor/harness.toml')">Open harness.toml</button>`:''}</div>
  <div class="pgrid" style="margin-top:10px">${Object.entries(HT).map(([k,h])=>`<div class="pcard${HARN.tpl===k?' sel':''}"><div class="ph">${h.n}${HARN.tpl===k?'<span class="tag acc">applied</span>':rec===k?'<span class="tag live">suggested</span>':''}</div><div class="pd">${h.d}</div><div class="hx-meta"><span>ceiling <b>${MODES[h.ceiling].l}</b></span><span>threshold <b>${h.thresh}</b></span></div><button class="mini${HARN.tpl===k?'':' pri'}" onclick="applyTemplate(${jsa(k)})">${HARN.tpl===k?'Re-apply':'Apply template'}</button></div>`).join('')}</div>
  <h2>Who decides</h2><div class="sub">The assistants accelerate the work; these decisions are never theirs. Locked rows are human-only in every template.</div><div class="tbl-wrap">${Object.entries(RIGHTS).map(([r,l])=>`<div class="rowline"><span>${l}</span><span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">${isHuman(r)?'you decide':'assistant, inside its scope'}</span><button class="sw${isHuman(r)?' on':''}" ${ALWAYS.includes(r)?'disabled style="opacity:.5"':''} onclick="toggleRight(${jsa(r)})"></button></div>`).join('')}<div class="rowline"><span>Review the diff before validating a merge</span><span class="sp"></span><button class="sw${HARN.review?' on':''}" onclick="HARN.review=!HARN.review;LS.set('harn5',HARN);rerender('team')"></button></div></div>
  <h2>Who did the work</h2><div class="tbl-wrap"><div class="rowline"><b style="width:120px;flex:none">Commits</b><span class="hx-bar"><i style="width:${au.h/tot*100}%"></i></span><span>you ${au.h} · assistants ${au.a}</span></div><div class="rowline"><b style="width:120px;flex:none">Decisions</b><span class="hx-bar"><i style="width:${au.dh/Math.max(1,au.dh+au.da)*100}%"></i></span><span>you ${au.dh} · assistants ${au.da}</span></div></div>
  <h2>Testar o escopo</h2><div class="tbl-wrap"><div class="rowline"><input class="inp" style="margin:0;width:320px" placeholder="ex.: db/migrations/0005_x.sql" oninput="scopeProbe(this.value)"><span id="probe-out" style="color:var(--fg-dim)"></span></div></div>
  <h2>Assistentes</h2><div class="pgrid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${Object.entries(AGENTS).map(([k,a])=>`<div class="pcard"><div class="ph"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${AGENT===k?'<span class="tag acc">na conversa</span>':`<button class="mini" style="margin-left:auto" onclick="AGENT=${jsa(k)};agentPill();show(cur)">Falar</button>`}</div><div class="pd">${a.d}</div>
    <div><label>Pode escrever em (um padrão por linha)</label><textarea rows="2" onchange="AGENTS.${k}.paths=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.paths.join('\n'))}</textarea></div>
    <div><label>Comandos permitidos</label><textarea rows="2" onchange="AGENTS.${k}.cmds=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.cmds.join('\n'))}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><div><label>Modelo</label><select onchange="AGENTS.${k}.model=this.value;saveTeam()"><option value="auto"${a.model==='auto'?' selected':''}>Automático (router)</option>${Object.entries(PROV).map(([p,v])=>`<option value="${p}"${a.model===p?' selected':''}>${v.name}</option>`).join('')}</select></div><div><label>Máx. ficheiros</label><input type="number" min="0" max="50" value="${a.max}" onchange="AGENTS.${k}.max=+this.value;saveTeam()"></div></div></div>`).join('')}</div>
  <h2>Router de modelos</h2><div class="sub">Com o modelo em «Automático», o assistente descreve a tarefa e pede o modelo mais adequado. Os perfis abaixo são valores de exemplo, editáveis na aplicação real.</div><div class="tbl-wrap"><table class="tbl"><tr><th>Provedor</th>${(Object.keys(CAPL) as Capability[]).map(c=>`<th>${CAPL[c]}</th>`).join('')}</tr>${Object.entries(PROV).map(([p,v])=>`<tr><td><span class="pdot${v.on?'':' off'}" style="background:${v.col}"></span> ${v.name}</td>${(Object.keys(CAPL) as Capability[]).map(c=>`<td class="c">${CAP[p][c]}</td>`).join('')}</tr>`).join('')}</table></div>
  <div class="tbl-wrap" style="margin-top:10px">${Object.entries(TASKP).map(([k,p])=>{const r=rankModels(k);return `<div class="rowline"><b style="width:210px;flex:none">${p.l}</b><span style="color:var(--fg-muted)">${Object.entries(p.w).map(([c,w])=>CAPL[c as Capability]+' ×'+w).join(' · ')}</span><span class="sp"></span>${r.length?`<span class="pdot" style="background:${PROV[r[0].p].col}"></span>${PROV[r[0].p].name}`:'—'}</div>`;}).join('')}</div></div>`;}

/** «Escrever código é teu» (o direito `code` é humano neste harness): em vez de delegar,
 *  correr um sprint ou uma missão, o Co-Dev explica que não edita ficheiros e oferece os
 *  testes ou o harness. Devolve `true` quando bloqueou. Era do v5.ts (ADR-0004, U4g3). */
const CG = window as unknown as { focusAgent: (nofocus?: boolean) => void; user: (t: string) => void; card: (who: string, html: string) => unknown };
function codeGuard(what: string): boolean {
  if (!isHuman('code')) return false;
  CG.focusAgent(true); CG.user(what);
  CG.card('co-dev', `<p>In this project <b>writing code is yours</b> (harness: ${HT[HARN.tpl].n}). I will not edit files.</p><p>I can explain the problem, review what you write, and run the tests when you are ready. Ask in the box below, or change the harness in <b>Team &amp; harness</b>.</p><div class="gate"><button class="gb" onclick="handlePrompt('/test')">Run the tests</button><button class="gb" onclick="openTeam()">Open the harness</button></div>`);
  return true;
}

Object.assign(window, {
  codeGuard, globRe, inScope, canRun, ownerOf, harnessCheck, harnessCmd, agentSys, saveTeam, loadTeam, pickAgent, agentPill, scopeProbe, renderTeamView,
  RIGHTS, RIGHT_RE, HT, HARN, MORD, isHuman, harnessToml, toggleRight, authorship, reviewIssue, hydrateHarn,
});
