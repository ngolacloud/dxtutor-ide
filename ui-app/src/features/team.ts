/* ═════════ dxtutor IDE — feature: Team / harness (equipa de assistentes) ═════════
   Motor invertido de `app.ts` (3ª/4ª inversão, como scm/debug/ext). O mais entrelaçado:
   `AGENTS` é DECORADO por app.ts (Object.assign(AGENTS.be,…)) e LIDO por board.ts/codev.ts
   e pelo router → window-backing obrigatório. A feature avalia ANTES de app.ts; `AGENTS`
   nasce `const AGENTS=(window.AGENTS={…})` (literal puro, sem reads eager) para que a
   decoração e os ~43 usos externos resolvam o MESMO objecto global. `window.AGENT='lead'`
   inicializa o assistente activo. Globais do resíduo (short/norm/palette/$/esc/PROV/CAPL/
   CAP/TASKP/rankModels/show/cur) resolvem por window em runtime (@ts-nocheck, late-binding).

   CORRIGE um gap latente: board.ts chamava `inScope`/`ownerOf` por global mas app.ts não os
   publicava — aqui são publicados no window. Desde a U4g4 do ADR-0004 esta feature também
   é dona do `openTeam`, do `VIEW.team` (composto: `renderTeamView` + a linha «explain before
   validating», que era do v6) e do `VIEW.review` (era do v5); o shim do app.ts saiu. GOTCHA
   C: os símbolos saíram do Object.assign de app.ts.

   Motor do harness de projecto MIGRADO de v5.ts (RIGHTS/RIGHT_RE/ALWAYS/MORD/HT/HARN/isHuman/
   harnessToml/applyTemplate/toggleRight/authorship/reviewIssue), fundido com `renderTeamView`:
   a secção "Project harness"/"Who decides"/"Who did the work" que v5.ts inseria por fora
   (DOM insertAdjacentHTML sobre o resultado de VIEW.team) passa a fazer parte do corpo único
   de renderTeamView — o wrapper `_team5`/`VIEW.team=` em v5.ts desapareceu. As políticas que
   o v5/v6 aplicavam com estes dados vivem agora nos donos das funções (U4g3/U4g4): o board.ts
   (revisão/explicação/codeGuard no runner) e o codev.ts (tecto do setMode, direitos no doTool;
   o codeGuard no runMission saiu com o motor de missões, ADR-0006 R1b); o `codeGuard` e o arranque do `explain` vivem aqui. O
   `applyTemplate` publica-se como `window.applyTemplate=` (base + o acerto do `explain`, que
   era a decoração do v6). ALWAYS/AG0 ficam léxicos (só usados
   aqui dentro). `RUN`/`DECS` não tinham contrato ambiente em pair.ts — acrescentados; `BL`
   lê-se via `window.BL` como tasks.ts já fazia (sem novo ambiente). */

import { esc, S } from "../core";
import { VIEW } from "../app/store/registry";
import { registerActions, callGlobal } from "../app/actions";
import type { Tab } from "../app/store/editor";
import { CAPL, CAP, TASKP, type Capability } from "./router/domain/model-routing";
import { rankModels } from "./router";
import { deriveScopes, parseTeamJson, teamJson } from "./team-scopes";

interface Agent { n: string; d: string; col: string; paths: string[]; cmds: string[]; task: string; model: string; max: number }
// cores em var(--token) do tema (theme.ts) em vez de hex fixo — mudam ao trocar de tema;
// excepção: `be` fica no hex de marca do Rust (cor da linguagem no GitHub), não é um token de tema.
const AGENTS: Record<string, Agent> = (window.AGENTS = {
  lead:{n:'Co-Dev',d:'Orquestrador: decompõe, delega e integra',col:'var(--accent)',paths:[],cmds:[],task:'arch',model:'auto',max:20},
  arq:{n:'Arquitecto',d:'Requisitos, arquitectura, ADRs e backlog',col:'var(--accent-hover)',paths:[],cmds:[],task:'arch',model:'auto',max:4},
  be:{n:'Backend',d:'Serviços, APIs e lógica do backend',col:'#dea584',paths:[],cmds:[],task:'code',model:'auto',max:6},
  db:{n:'Base de dados',d:'Esquema, migrações e índices',col:'var(--green)',paths:[],cmds:[],task:'db',model:'auto',max:3},
  fe:{n:'Frontend',d:'Interface e Design System',col:'var(--blue)',paths:[],cmds:[],task:'ui',model:'auto',max:6},
  qa:{n:'QA',d:'Testes automáticos',col:'var(--yellow)',paths:[],cmds:[],task:'test',model:'auto',max:6},
  ops:{n:'Plataforma',d:'Infra, CI/CD e deploy',col:'var(--purple)',paths:[],cmds:[],task:'ops',model:'auto',max:4},
  tutor:{n:'Tutor',d:'Explica e orienta; nunca escreve por ti',col:'var(--cyan)',paths:[],cmds:[],task:'teach',model:'auto',max:0}});
/* os escopos (onde escreve, que comandos corre) vêm do projecto (ADR-0006, R3c): sem pasta, os
   padrões genéricos; ao abrir uma pasta, derivados da estrutura dela (applyProjectTeam) e o
   `.dxtutor/team.json` do projecto por cima. Eram os do projecto de demonstração. */
{ const D = deriveScopes([], null, null); Object.keys(AGENTS).forEach((k) => { if (D[k]) { AGENTS[k].paths = D[k].paths; AGENTS[k].cmds = D[k].cmds; } }); }
/* os limites de ficheiros por tarefa da camada v4 (Backend 8, Plataforma 12) ficam — a R3c tirou-os sem
   querer com os caminhos de demonstração */
AGENTS.be.max = 8; AGENTS.ops.max = 12;
window.AGENT='lead';
const globRe=(g:string)=>new RegExp('^'+g.split('**').map(s=>s.split('*').map(x=>x.replace(/[.+^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$');
const inScope=(a:string,p:string)=>AGENTS[a].paths.some(g=>globRe(g).test(short(p)));
const canRun=(a:string,cmd:string)=>AGENTS[a].cmds.some(c=>c==='*'||cmd.startsWith(c));
const ownerOf=(p:string)=>Object.keys(AGENTS).find(k=>k!=='lead'&&inScope(k,p))||'lead';
function harnessCheck(p:string){if(!inScope(AGENT,p)){const o=ownerOf(p);throw new Error(`fora do escopo do assistente ${AGENTS[AGENT].n}. Pode escrever em: ${AGENTS[AGENT].paths.join(', ')||'nada'}. Este caminho pertence a: ${AGENTS[o].n}.`);}}
function harnessCmd(c:string){if(!canRun(AGENT,c))throw new Error(`o assistente ${AGENTS[AGENT].n} não tem permissão para correr "${c}".`);}
const agentSys=()=>{const a=AGENTS[AGENT];return `\nÉs o assistente «${a.n}» (${a.d}). Harness: só podes escrever em [${a.paths.join(', ')||'nenhum caminho'}] e correr [${a.cmds.join(', ')||'nenhum comando'}]. Se a tarefa exigir sair deste escopo, não o faças: diz que assistente da equipa (${Object.values(AGENTS).map(x=>x.n).join(', ')}) deve tratar dessa parte.`+(AGENT==='tutor'?'\nComo Tutor: não dês a solução completa. Faz perguntas, explica o conceito, dá pistas graduais e pede ao aluno que tente.':'');};
/** A equipa da pasta aberta: os escopos derivados da estrutura dela e dos comandos detectados, e
 *  o `.dxtutor/team.json` por cima (ADR-0006, R3c). Passam a ser os defaults que os templates
 *  de harness repõem (AG0). */
function applyProjectTeam(): void {
  const dxr = (window as unknown as { DXR?: { root?: string | null; projectCmd?: (k: string) => { cmd: string } | null } }).DXR;
  if (!dxr || !dxr.root) return;
  const files = Object.keys(FS).filter((k) => k.startsWith(ROOT)).map((k) => k.slice(ROOT.length));
  const pc = (k: string) => (dxr.projectCmd ? dxr.projectCmd(k)?.cmd ?? null : null);
  const D = deriveScopes(files, pc('test'), pc('lint'));
  const tj = FS[ROOT + '.dxtutor/team.json'] ? parseTeamJson(FS[ROOT + '.dxtutor/team.json'].content) : null;
  Object.keys(AGENTS).forEach((k) => {
    const a = AGENTS[k], d = D[k], o = (tj && tj[k]) || {};
    if (d) { a.paths = d.paths; a.cmds = d.cmds; }
    if (o.paths) a.paths = o.paths; if (o.cmds) a.cmds = o.cmds; if (o.max != null) a.max = o.max; if (o.model) a.model = o.model;
  });
  Object.keys(AGENTS).forEach((k) => { AG0[k] = JSON.parse(JSON.stringify(AGENTS[k])); });
  if (FS[ROOT + '.dxtutor/team.json'] && !tj) log('team', '.dxtutor/team.json não é JSON válido — fico com os escopos derivados da pasta');
  try { agentPill(); rerender('team'); } catch { /* ainda sem UI */ }
}
document.addEventListener('dx:workspace', () => applyProjectTeam());
/** Grava a equipa: com pasta aberta, no projecto (`.dxtutor/team.json`, versionável); sem pasta, no LS. */
function saveTeam(){const dxr=(window as unknown as {DXR?:{root?:string|null}}).DXR;if(dxr&&dxr.root){writeFile(ROOT+'.dxtutor/team.json',teamJson(AGENTS));return;}LS.set('team3',Object.fromEntries(Object.entries(AGENTS).map(([k,a])=>[k,{paths:a.paths,cmds:a.cmds,model:a.model,max:a.max}])));}
function loadTeam(){const t=LS.get('team3',null);if(t)Object.keys(AGENTS).forEach(k=>{if(t[k]){['paths','cmds'].forEach(f=>{if(Array.isArray(t[k][f]))(AGENTS[k] as any)[f]=t[k][f];});if(t[k].model)AGENTS[k].model=t[k].model;if(t[k].max!=null)AGENTS[k].max=t[k].max;}});}
function pickAgent(){palette('',{ph:'Com que assistente queres falar?',items:Object.entries(AGENTS).map(([k,a])=>({l:a.n,d:a.d,run:()=>{AGENT=k;agentPill();toast('Assistente: '+a.n);}}))});}
function agentPill(){const p=$('#pill-agent');if(p){p.innerHTML=`<span class="pdot" style="background:${AGENTS[AGENT].col}"></span>${AGENTS[AGENT].n}`;}}
function scopeProbe(v:string){const o=$('#probe-out');if(!o)return;if(!v.trim()){o.textContent='';return;}const who=Object.keys(AGENTS).filter(k=>k!=='lead'&&inScope(k,norm(v)));o.innerHTML=who.length?'Pode escrever: '+who.map(k=>`<b style="color:${AGENTS[k].col}">${AGENTS[k].n}</b>`).join(', '):'Nenhum assistente especializado — só o orquestrador, com a tua aprovação.';}
/* ───── harness de projecto: templates, decision rights, mode ceiling (migrado de
   v5.ts, fundido com renderTeamView) ─────
   A secção "Project harness"/"Who decides"/"Who did the work" que v5.ts inseria por
   fora (DOM insertAdjacentHTML sobre o resultado de VIEW.team) passa a fazer parte do
   corpo único de renderTeamView. HARN é window-backed como AGENTS (lido no acto pelas
   políticas do board.ts/codev.ts e pelo boot5 do v5.ts) e hidrata do LS logo ao carregar
   (fim do ficheiro). Os restantes publicam-se no Object.assign final para o resíduo
   (boot5/CMD.push em v5.ts) continuar a lê-los por nome livre. ALWAYS/AG0
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
function hydrateHarn() {
  if (harnHydrated) return; harnHydrated = true; Object.assign(HARN, LS.get('harn5', {}));
  /* «explain before validating»: sem escolha guardada, ligado nos templates Study e Critical
     systems (era o arranque do v6.ts — ADR-0004, U4g4) */
  if (HARN.explain == null) HARN.explain = ['study', 'critical'].includes(HARN.tpl);
}
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
function applyTemplateBase(id: string) {
  hydrateHarn();
  if (RUN.active) { toast('Wait for the run to finish'); return; }
  const t = HT[id];
  Object.keys(AGENTS).forEach(k => Object.assign(AGENTS[k], JSON.parse(JSON.stringify(AG0[k]))));
  if (t.agents) Object.entries(t.agents).forEach(([k, o]) => Object.assign(AGENTS[k], o));
  Object.assign(HARN, { tpl: id, ceiling: t.ceiling, human: t.human.slice(), review: true });
  S.THRESH = t.thresh; S.MODE = t.mode; LS.set('harn5', HARN);
  saveTeam(); window.save(); updateAgentUI(); writeFile(ROOT + '.dxtutor/harness.toml', harnessToml());
  toast(`Harness applied: ${t.n}`); log('harness', `template ${id} applied · ceiling ${t.ceiling}`); rerender('team');
}
/* Aplicar um template também acerta o «explain before validating» (mesmo quando a base
   recusa por haver uma execução a correr). Era a decoração do v6.ts (ADR-0004, U4g4). */
window.applyTemplate = function (id: string) {
  applyTemplateBase(id);
  HARN.explain = ['study', 'critical'].includes(id); LS.set('harn5', HARN); rerender('team');
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
  <div class="rowline hx"><b>Detected context</b>${cx.map(c=>`<span class="tag">${c[1]}</span>`).join('')}<span class="sp"></span>${FS[ROOT+'.dxtutor/harness.toml']?`<button class="mini" data-action="team:openHarness">Open harness.toml</button>`:''}</div>
  <div class="pgrid" style="margin-top:10px">${Object.entries(HT).map(([k,h])=>`<div class="pcard${HARN.tpl===k?' sel':''}"><div class="ph">${h.n}${HARN.tpl===k?'<span class="tag acc">applied</span>':rec===k?'<span class="tag live">suggested</span>':''}</div><div class="pd">${h.d}</div><div class="hx-meta"><span>ceiling <b>${MODES[h.ceiling].l}</b></span><span>threshold <b>${h.thresh}</b></span></div><button class="mini${HARN.tpl===k?'':' pri'}" data-action="team:applyTemplate" data-on="${esc(k)}">${HARN.tpl===k?'Re-apply':'Apply template'}</button></div>`).join('')}</div>
  <h2>Who decides</h2><div class="sub">The assistants accelerate the work; these decisions are never theirs. Locked rows are human-only in every template.</div><div class="tbl-wrap">${Object.entries(RIGHTS).map(([r,l])=>`<div class="rowline"><span>${l}</span><span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">${isHuman(r)?'you decide':'assistant, inside its scope'}</span><button class="sw${isHuman(r)?' on':''}" ${ALWAYS.includes(r)?'disabled style="opacity:.5"':''} data-action="team:toggleRight" data-on="${esc(r)}"></button></div>`).join('')}<div class="rowline"><span>Review the diff before validating a merge</span><span class="sp"></span><button class="sw${HARN.review?' on':''}" data-action="team:review"></button></div></div>
  <h2>Who did the work</h2><div class="tbl-wrap"><div class="rowline"><b style="width:120px;flex:none">Commits</b><span class="hx-bar"><i style="width:${au.h/tot*100}%"></i></span><span>you ${au.h} · assistants ${au.a}</span></div><div class="rowline"><b style="width:120px;flex:none">Decisions</b><span class="hx-bar"><i style="width:${au.dh/Math.max(1,au.dh+au.da)*100}%"></i></span><span>you ${au.dh} · assistants ${au.da}</span></div></div>
  <h2>Testar o escopo</h2><div class="tbl-wrap"><div class="rowline"><input class="inp" style="margin:0;width:320px" placeholder="ex.: db/migrations/0005_x.sql" data-action="team:probe"><span id="probe-out" style="color:var(--fg-dim)"></span></div></div>
  <h2>Assistentes</h2><div class="pgrid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${Object.entries(AGENTS).map(([k,a])=>`<div class="pcard"><div class="ph"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${AGENT===k?'<span class="tag acc">na conversa</span>':`<button class="mini" style="margin-left:auto" data-action="team:talk" data-on="${esc(k)}">Falar</button>`}</div><div class="pd">${a.d}</div>
    <div><label>Pode escrever em (um padrão por linha)</label><textarea rows="2" data-action="team:paths" data-on="${esc(k)}">${esc(a.paths.join('\n'))}</textarea></div>
    <div><label>Comandos permitidos</label><textarea rows="2" data-action="team:cmds" data-on="${esc(k)}">${esc(a.cmds.join('\n'))}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><div><label>Modelo</label><select data-action="team:model" data-on="${esc(k)}"><option value="auto"${a.model==='auto'?' selected':''}>Automático (router)</option>${Object.entries(PROV).map(([p,v])=>`<option value="${p}"${a.model===p?' selected':''}>${v.name}</option>`).join('')}</select></div><div><label>Máx. ficheiros</label><input type="number" min="0" max="50" value="${a.max}" data-action="team:max" data-on="${esc(k)}"></div></div></div>`).join('')}</div>
  <h2>Router de modelos</h2><div class="sub">Com o modelo em «Automático», o assistente descreve a tarefa e pede o modelo mais adequado. Os perfis abaixo são valores de exemplo, editáveis na aplicação real.</div><div class="tbl-wrap"><table class="tbl"><tr><th>Provedor</th>${(Object.keys(CAPL) as Capability[]).map(c=>`<th>${CAPL[c]}</th>`).join('')}</tr>${Object.entries(PROV).map(([p,v])=>`<tr><td><span class="pdot${v.on?'':' off'}" style="background:${v.col}"></span> ${v.name}</td>${(Object.keys(CAPL) as Capability[]).map(c=>`<td class="c">${CAP[p][c]}</td>`).join('')}</tr>`).join('')}</table></div>
  <div class="tbl-wrap" style="margin-top:10px">${Object.entries(TASKP).map(([k,p])=>{const r=rankModels(k);return `<div class="rowline"><b style="width:210px;flex:none">${p.l}</b><span style="color:var(--fg-muted)">${Object.entries(p.w).map(([c,w])=>CAPL[c as Capability]+' ×'+w).join(' · ')}</span><span class="sp"></span>${r.length?`<span class="pdot" style="background:${PROV[r[0].p].col}"></span>${PROV[r[0].p].name}`:'—'}</div>`;}).join('')}</div></div>`;}

/** «Escrever código é teu» (o direito `code` é humano neste harness): em vez de delegar,
 *  correr um sprint ou uma missão, o Co-Dev explica que não edita ficheiros e oferece os
 *  testes ou o harness. Devolve `true` quando bloqueou. Era do v5.ts (ADR-0004, U4g3). */
/* ───── vistas do harness (ADR-0004, U4g4 — viviam no v5.ts/v6.ts e no app.ts) ───── */
/** O separador «Team & harness»: o corpo + a linha «explain before validating» (era a
 *  decoração do v6) logo a seguir à linha da revisão do diff. */
function teamView(t: unknown, host: HTMLElement): void {
  renderTeamView(t, host);
  const row = [...host.querySelectorAll('.rowline')].find((r) => /Review the diff before validating/.test(r.textContent || ''));
  if (row) row.insertAdjacentHTML('afterend', `<div class="rowline"><span>Explain the change in your own words before validating</span><span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">on in Study and Critical systems</span><button class="sw${HARN.explain ? ' on' : ''}" data-action="team:explain"></button></div>`);
}
const RV = window as unknown as {
  BL: { issues: { id: string; title: string; branch?: string | null; stage: string }[] };
  GIT: { trees: Record<string, Record<string, string>> };
  diffLines: (a: string, b: string) => [string, string, unknown, unknown][];
  extOf: (p: string) => string; hlLine: (l: string, ext: string) => string; short: (p: string) => string;
};
/** A revisão de uma issue: o diff do ramo contra o develop, com «Validate and merge». */
function reviewView(t: Tab, host: HTMLElement): void {
  const it = RV.BL.issues.find((i) => i.id === t.issue), GIT = RV.GIT, tr = it && GIT.trees[it.branch as string], dv = GIT.trees.develop, files = tr ? Object.keys(tr).filter((p) => tr[p] !== dv[p]) : [];
  host.innerHTML = `<div class="diff"><div class="diff-h"><b style="color:var(--fg)" class="notr">${it ? esc(it.id + ' · ' + it.title) : ''}</b><span class="tag notr">${it ? esc(it.branch || '') : ''} → develop</span><span class="sp" style="flex:1"></span>${it && it.stage === 'func' ? `<button class="mini pri" data-action="team:approve" data-on="${esc(it.id)}">✓ Validate and merge</button><button class="mini" data-action="team:reject" data-on="${esc(it.id)}">✗ Reject</button>` : ''}</div>${files.length ? files.map((p) => { const d = RV.diffLines(dv[p] || '', (tr as Record<string, string>)[p]), ext = RV.extOf(p); return `<div class="diff-h" style="padding-top:14px"><b style="color:var(--accent-hover)">${esc(RV.short(p))}</b><span style="color:var(--green)">+${d.filter((x) => x[0] === '+').length}</span><span style="color:var(--red)">−${d.filter((x) => x[0] === '-').length}</span></div>` + d.map((x) => `<div class="dl ${x[0] === '+' ? 'add' : x[0] === '-' ? 'del' : ''}"><span class="n">${x[2]}</span><span class="n">${x[3]}</span><span class="s">${x[0]}</span><span>${RV.hlLine(x[1], ext) || ' '}</span></div>`).join(''); }).join('') : '<div class="sec-empty">Nothing to review: the branch was already merged or has no changes.</div>'}</div>`;
}
VIEW.team = teamView;
VIEW.review = reviewView;
/** Abre o separador «Team & harness». */
function openTeam(): void { openTab({ id: 'team', title: 'Team & harness', kind: 'team' }); }

const CG = window as unknown as { focusAgent: (nofocus?: boolean) => void; user: (t: string) => void; card: (who: string, html: string) => unknown };
function codeGuard(what: string): boolean {
  if (!isHuman('code')) return false;
  CG.focusAgent(true); CG.user(what);
  CG.card('co-dev', `<p>In this project <b>writing code is yours</b> (harness: ${HT[HARN.tpl].n}). I will not edit files.</p><p>I can explain the problem, review what you write, and run the tests when you are ready. Ask in the box below, or change the harness in <b>Team &amp; harness</b>.</p><div class="gate"><button class="gb" data-action="team:runTests">Run the tests</button><button class="gb" data-action="team:openTeam">Open the harness</button></div>`);
  return true;
}

Object.assign(window, {
  codeGuard, openTeam, globRe, inScope, canRun, ownerOf, harnessCheck, harnessCmd, agentSys, saveTeam, loadTeam, pickAgent, agentPill, scopeProbe, renderTeamView,
  RIGHTS, RIGHT_RE, HT, HARN, MORD, isHuman, harnessToml, toggleRight, authorship, reviewIssue, hydrateHarn,
});

/* O HARN hidrata do LS logo ao carregar (o LS nasce em app/store, antes de tudo): quem o lê
   directamente — o tecto no setMode, o boot5, as políticas do board — vê já os valores
   guardados. Era a chamada `window.hydrateHarn()` do v5.ts (ADR-0004, U4g4). */
hydrateHarn();

/* ── acções do harness, da revisão e do aviso «writing code is yours» (ADR-0004, U5b) ── eram
   handlers inline, que resolviam o HARN/LS/AGENT/AGENTS/ROOT/cur e as funções no window ao clicar;
   as acções fazem o mesmo, no acto. */
const TA = window as unknown as {
  HARN: { review: boolean; explain: boolean }; LS: { set: (k: string, v: unknown) => void }; AGENT: string; ROOT: string; cur: unknown;
  AGENTS: Record<string, { paths: string[]; cmds: string[]; model: string; max: number }>;
};
const lines = (v: string): string[] => v.split('\n').map((s) => s.trim()).filter(Boolean);
registerActions({
  "team:openHarness": { click: () => void callGlobal('openPath', TA.ROOT + '.dxtutor/harness.toml') },
  "team:applyTemplate": { click: (c) => void callGlobal('applyTemplate', c.on) },
  "team:toggleRight": { click: (c) => void callGlobal('toggleRight', c.on) },
  "team:review": { click: () => { TA.HARN.review = !TA.HARN.review; TA.LS.set('harn5', TA.HARN); callGlobal('rerender', 'team'); } },
  "team:explain": { click: () => { TA.HARN.explain = !TA.HARN.explain; TA.LS.set('harn5', TA.HARN); callGlobal('rerender', 'team'); } },
  "team:probe": { input: (c) => void callGlobal('scopeProbe', c.value) },
  "team:talk": { click: (c) => { TA.AGENT = c.on; callGlobal('agentPill'); callGlobal('show', TA.cur); } },
  "team:paths": { change: (c) => { TA.AGENTS[c.on].paths = lines(c.value); callGlobal('saveTeam'); } },
  "team:cmds": { change: (c) => { TA.AGENTS[c.on].cmds = lines(c.value); callGlobal('saveTeam'); } },
  "team:model": { change: (c) => { TA.AGENTS[c.on].model = c.value; callGlobal('saveTeam'); } },
  "team:max": { change: (c) => { TA.AGENTS[c.on].max = +c.value; callGlobal('saveTeam'); } },
  "team:approve": { click: (c) => { callGlobal('approveIssue', c.on); callGlobal('closeTab', 'review'); } },
  "team:reject": { click: (c) => void callGlobal('rejectIssue', c.on) },
  "team:runTests": { click: () => void callGlobal('handlePrompt', '/test') },
  "team:openTeam": { click: () => void callGlobal('openTeam') },
});
