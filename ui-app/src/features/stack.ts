/* ═════════ dxtutor IDE — feature: RUN, a stack executável (docker-compose) ═════════
   Motor «RUN: one command for the whole stack» invertido de `app.ts`. DISTINTO do
   pane «Run and Debug» (features/run.ts, launch configs) — só partilham a palavra run.
   Detém: STACK (estado), composeServices (parse do docker-compose.yml em FS), dxRun,
   dxStop, drawStack.

   Padrão de inversão: a feature avalia ANTES de app.ts. dxRun/dxStop/drawStack nascem
   `window.X=function` porque o resíduo (v5/v6/bridge + XC.docker/make/dx e boot4 em
   app.ts) os DECORA/consome por global em runtime (late-binding). `window.STACK=null`
   no eval cria a PROPRIEDADE cedo → as atribuições `STACK=…`/`STACK=null` dentro de
   dxRun/dxStop resolvem-na no global object (estrito, mas a prop já existe). Globais de
   app.ts (FS/ROOT/esc/BRANCH/echo/echoCmd/newInput/toast/setPanelTab/$/svg) resolvem
   por window em runtime (dxRun só corre a pedido do utilizador, muito depois do arranque).
   GOTCHA C: `composeServices` saiu do Object.assign(window) de app.ts. */

import { esc } from "../core";

interface Svc { name: string; deps: string[]; image?: string; build?: string; port?: string; route?: string; hc?: boolean }

window.STACK=null;
function composeServices(){const c=FS[ROOT+'docker-compose.yml'];if(!c)return null;const out: Svc[]=[];let cur: Svc|null=null,on=false,dep=false;c.content.split('\n').forEach(l=>{if(/^services:/.test(l)){on=true;return;}if(/^\S/.test(l)&&!/^services:/.test(l))on=false;if(!on)return;let m;if(/^    \S/.test(l))dep=/^    depends_on:/.test(l);
    if((m=l.match(/^  ([a-z0-9][\w-]*):\s*$/))){cur={name:m[1],deps:[]};out.push(cur);}else if(cur){if((m=l.match(/^    image:\s*(.+)/)))cur.image=m[1];if((m=l.match(/^    build:\s*\.\/(.+)/)))cur.build=m[1];if((m=l.match(/^      - "(\d+):\d+"/)))cur.port=m[1];if((m=l.match(/PathPrefix\(`([^`]+)`\)/)))cur.route=m[1];if(dep&&(m=l.match(/^      (?:- )?([a-z0-9][\w-]*):?\s*$/)))cur.deps.push(m[1]);if(/healthcheck:/.test(l))cur.hc=true;}});return out;}
window.dxRun = function(term){if(term!==true){setPanelTab('terminal',true);echoCmd('docker compose up --build -d');}const sv=composeServices();
  if(!sv){echo(`<span class="er">no configuration file provided: not found</span>\n<span class="dim">docker-compose.yml does not exist on ${esc(BRANCH)}. Generate the backlog from the Studio, run the sprints and validate the issues — the merge into develop brings the artefacts.</span>`);newInput(true);toast('Nothing to run yet — generate and validate the project first');return{ok:false,sum:'no compose file'};}
  const miss=sv.filter(s=>s.build&&!FS[ROOT+s.build+'/Dockerfile']);if(miss.length){echo(miss.map(s=>`<span class="er">failed to solve: failed to read dockerfile: open ${s.build}/Dockerfile: no such file or directory</span>`).join('\n')+`\n<span class="dim">Validate the pending issues on the board so their branches are merged.</span>`);newInput(true);return{ok:false,sum:'missing Dockerfile'};}
  const gw=sv.find(s=>/traefik/.test(s.image||'')),order: Svc[]=[];const visit=(s: Svc)=>{if(order.includes(s))return;s.deps.forEach((d: string)=>{const x=sv.find(y=>y.name===d);if(x)visit(x);});order.push(s);};sv.forEach(visit);
  echo(sv.filter(s=>s.build).map(s=>`<span class="dim">[+] Building</span> ${s.name} <span class="dim">(${s.build}/Dockerfile)</span> <span class="ok">FINISHED</span>`).join('\n')+'\n'+sv.filter(s=>s.image).map(s=>`<span class="dim">[+] Pulling</span> ${s.name} <span class="dim">${esc(s.image)}</span> <span class="ok">done</span>`).join('\n')+'\n'+order.map(s=>` <span class="ok">✔</span> Container ${s.name}  <span class="ok">${s.hc?'Healthy':'Started'}</span>`).join('\n'));
  const stk=STACK=order.map(s=>({name:s.name,src:s.build?'build ./'+s.build:(s.image||''),url:s.route&&gw?`http://localhost:8080${s.route}`:s.port?`http://localhost:${s.port}`:'internal',state:s.hc?'healthy':'running'}));
  echo(`\n<span class="ac">${stk.length} services up</span> <span class="dim">· simulated: a browser cannot start containers. In the desktop app this is the real</span> docker compose up --build`+stk.filter(s=>s.url!=='internal').map(s=>`\n  ➜  ${s.name.padEnd(18)} <span class="ac">${s.url}</span>`).join(''));newInput(true);drawStack();setPanelTab('services');toast(`${stk.length} services up`);return{ok:true,sum:stk.length+' services up'};}
window.dxStop = function(term){if(!STACK){toast('Nothing is running');if(term===true)echo('<span class="dim">no containers</span>');return;}if(term!==true)echoCmd('docker compose down');echo(STACK.slice().reverse().map(s=>` <span class="ok">✔</span> Container ${s.name}  <span class="dim">Removed</span>`).join('\n'));newInput(true);STACK=null;drawStack();}
window.drawStack = function(){const el=$('#pc-services'),st=$('#st-stack'),stk=STACK;if(st){st.textContent=stk?`▶ ${stk.length} services`:'';st.style.display=stk?'':'none';}if(!el)return;
  el.innerHTML=stk?`<div class="svc-h"><b>${stk.length} services running</b><span class="tag warn">simulated</span><span class="sp"></span><button class="mini" onclick="dxStop()">■ Stop</button></div><table class="tbl">${stk.map(s=>`<tr><td><span class="pdot" style="background:var(--green)"></span> <span class="notr">${esc(s.name)}</span></td><td class="c notr">${esc(s.src)}</td><td class="notr">${s.url==='internal'?'<span style="color:var(--fg-muted)">internal</span>':esc(s.url)}</td><td class="c">${s.state}</td></tr>`).join('')}</table>`
    :`<div class="sec-empty">Nothing is running. <b>▶ RUN</b> builds every Dockerfile and starts the stack described by <code>docker-compose.yml</code>.</div><button class="mini pri" style="margin-left:16px" onclick="dxRun()">▶ RUN</button>`;}

Object.assign(window, { composeServices });
