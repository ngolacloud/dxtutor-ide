/* ═════════ dxtutor IDE — feature: Extensions + motor Open VSX (pane + engine) ═════════
   Feature-folha que é DONA de todo o motor de extensões (padrão das sessões Debug e
   SCM: inversão de direcção — o par render+motor, antes em `v6.ts`, mudou-se inteiro
   para cá). Fase 1 da extracção (ADR-0002): o `@ts-nocheck` saiu e todo o acesso a
   `window.*` passou para `ext/infrastructure/legacy-bridge.ts` — este ficheiro tipa-se
   em estrito e já não nomeia `window`.

   Donos aqui: o catálogo `EXT`, o estado instalado `EXS`, `saveExt/extOn/extAll/
   extCmds/extInstall/extRemove/extToggle/rerExt/extRow/loadVsix`, o formatador
   `formatDoc`, o render do pane `renderExtPane` e o corpo do tab de detalhe
   `renderExtd` (VIEW.extd). Do core importam-se só os helpers puros (`$`, `hd`, `svg`,
   `esc`). Tudo o que é do monólito (CMD/RP/PANE/LS/FS/tabOf/cur/openTab/toast/refresh/
   rerender/paintEd/extOf/projectContext/dxRun/dxStop/dxDeploy/runTask/openGraph/goPane/
   doSearch/JSZip) resolve-se em runtime através do bridge (app.ts/v5/v6 avaliam DEPOIS
   desta feature).

   Chaves do padrão (iguais a Debug/BPS):
   (1) estado mutável é window-backed — `EXS` vem de `bridge.initExs()` que estabelece
       `window.EXS` — porque os `onclick="…extToggle(…)/extInstall(…)/extRemove(…)/
       loadVsix(…)"` inline resolvem no escopo GLOBAL ao clicar;
   (2) nada de leitura global ANSIOSA no eval: `EXS` nasce com os defaults e hidrata de
       `LS` PREGUIÇOSAMENTE (`hydrateExs`, guard-once nas entradas) — obrigatório porque
       este módulo avalia antes de `app.ts` publicar `LS`;
   (3) o corpo de `VIEW.extd` evalua-se tarde (VIEW só existe depois de app.ts), por
       isso fica como `renderExtd` publicado no window e v6 mantém o shim
       `VIEW.extd=(t,host)=>window.renderExtd(t,host)` (par de `RP.ext`);
   (4) o resíduo de v6 (decorações diagnostics/paintEd/keydown + arranque) lê o motor
       por fachadas-alias sem o substring migrado: `window.vsxOn(id)` (=extOn),
       `window.vsxFmt()` (=formatDoc), `window.vsxCmds()` (=extCmds). */

import { $, hd, svg, esc } from "../core";
import {
  type ExtItem,
  type ExsState,
  type ExtCmd,
  initExs,
  lsGet,
  lsSet,
  commands,
  panes,
  pane,
  files,
  cur,
  tabOf,
  openTab,
  paintEd,
  extOf,
  projectContext,
  refresh,
  rerender,
  toast,
  doSearch,
  goPane,
  openGraph,
  runTask,
  dxRun,
  dxStop,
  dxDeploy,
  callLoadJSZip,
  publishJSZipLoader,
  publish,
} from "./ext/infrastructure/legacy-bridge";

/* ── catálogo de extensões (Open VSX) — os `cmds` com efeito usam arrows preguiçosas
   que resolvem dxRun/dxStop/dxDeploy/runTask/openGraph/goPane/doSearch pelo bridge. ── */
const EXT: ExtItem[] = [
 {id:'rust-lang.rust-analyzer',n:'rust-analyzer',pub:'rust-lang',d:'Rust language support: diagnostics, completion, go to definition.',ctx:['rust'],bundled:1},
 {id:'usernamehw.errorlens',n:'Error Lens',pub:'usernamehw',d:'Shows diagnostics inline at the end of the line.',ctx:['all'],eff:'errorlens'},
 {id:'esbenp.prettier-vscode',n:'Prettier',pub:'esbenp',d:'Opinionated code formatter.',ctx:['node'],eff:'prettier',cmds:[['Prettier: Format Document','Shift+Alt+F']]},
 {id:'redhat.vscode-yaml',n:'YAML',pub:'redhat',d:'YAML validation, including Kubernetes schemas.',ctx:['k8s','compose'],eff:'yaml'},
 {id:'ms-azuretools.vscode-docker',n:'Docker',pub:'ms-azuretools',d:'Build, manage and run containers.',ctx:['compose'],cmds:[['Docker: Compose Up','',()=>dxRun()],['Docker: Compose Down','',()=>dxStop()]]},
 {id:'ms-kubernetes-tools.vscode-kubernetes-tools',n:'Kubernetes',pub:'ms-kubernetes-tools',d:'Develop, deploy and debug Kubernetes applications.',ctx:['k8s'],cmds:[['Kubernetes: Apply','',()=>dxDeploy()],['Kubernetes: Get Pods','',()=>runTask('kubectl get pods')]]},
 {id:'eamodio.gitlens',n:'GitLens',pub:'eamodio',d:'Git blame, history and commit graph.',ctx:['all'],cmds:[['GitLens: Show Commit Graph','',()=>openGraph()]]},
 {id:'gruntfuggly.todo-tree',n:'Todo Tree',pub:'Gruntfuggly',d:'Lists TODO and FIXME comments in a tree.',ctx:['all'],cmds:[['Todo Tree: Show TODOs','',()=>{goPane('search');($('#s-q') as HTMLInputElement).value='TODO';doSearch();}]]},
 {id:'dbaeumer.vscode-eslint',n:'ESLint',pub:'dbaeumer',d:'JavaScript and TypeScript linting.',ctx:['node']},
 {id:'golang.go',n:'Go',pub:'golang',d:'Go language support.',ctx:['go']},
 {id:'ms-python.python',n:'Python',pub:'ms-python',d:'Python language support.',ctx:['python','odoo']},
 {id:'streetsidesoftware.code-spell-checker',n:'Code Spell Checker',pub:'streetsidesoftware',d:'Spelling checker for source code.',ctx:['all']},
 {id:'editorconfig.editorconfig',n:'EditorConfig',pub:'EditorConfig',d:'Applies .editorconfig settings.',ctx:['all']}];

/* ── estado instalado: window-backed (mutado por inline onclick no escopo global),
   nasce com defaults e hidrata de LS preguiçosamente (app.ts ainda não correu). ── */
const EXS: ExsState = initExs();
let _exsHydrated = false;
/** Funde o estado persistido de `LS` sobre `EXS` uma única vez. Preguiçoso porque
 *  este módulo avalia antes de app.ts publicar `LS`; chamado nas entradas públicas. */
function hydrateExs(){ if(_exsHydrated) return; _exsHydrated = true; try{ Object.assign(EXS, lsGet('ext6', {})); }catch{} }
const saveExt = () => { lsSet('ext6', EXS); extCmds(); };
const extOn = (id: string) => { hydrateExs(); return EXS.inst[id] && EXS.inst[id].on; };

/** Filtro de pesquisa do pane «Extensions» — estado-folha, dono desta feature. */
let EXQ = "";

function extAll(): ExtItem[] { hydrateExs(); return EXT.concat(EXS.vsix); }
function extCmds(){ hydrateExs(); const CMD=commands(); for(let i=CMD.length-1;i>=0;i--)if(CMD[i][3]==='ext')CMD.splice(i,1);extAll().filter(x=>extOn(x.id)).forEach(x=>(x.cmds||[]).forEach(c=>CMD.push([c[0],c[1],c[2]||(x.vsix?()=>toast(`${c[0]} runs in the desktop app's extension host`):x.eff==='prettier'?formatDoc:()=>{}),'ext']))); }
function extInstall(id: string){ hydrateExs(); EXS.inst[id]={on:1};saveExt();toast('Installed '+(extAll().find(x=>x.id===id)||{n:id}).n);rerExt(); }
function extRemove(id: string){ hydrateExs(); const x=extAll().find(e=>e.id===id);if(x&&x.bundled)return;delete EXS.inst[id];if(x&&x.vsix)EXS.vsix=EXS.vsix.filter(v=>v.id!==id);saveExt();rerExt(); }
function extToggle(id: string){ hydrateExs(); EXS.inst[id].on=!EXS.inst[id].on;saveExt();rerExt(); }
function rerExt(){ if(pane()==='ext')panes().ext();rerender('extd');refresh(true);const t=tabOf(cur());if(t&&t.kind==='file'&&t.path)paintEd(t.path); }
function extRow(x: ExtItem){ const i=EXS.inst[x.id],col=`hsl(${[...x.id].reduce((a,c)=>a+c.charCodeAt(0),0)%360} 45% 45%)`;return `<div class="ex-row" onclick="openTab({id:'extd:${x.id}',title:'${esc(x.n)}',kind:'extd',ext:'${x.id}'})"><span class="ex-ic" style="background:${col}">${esc(x.n.charAt(0))}</span><div class="ex-t"><b class="notr">${esc(x.n)}</b><small class="notr">${esc(x.d)}</small><span class="notr">${esc(x.pub)}${x.vsix?' · VSIX':''}${x.bundled?' · bundled':''}</span></div>${i?(x.bundled?'':`<button class="mini" onclick="event.stopPropagation();extToggle('${x.id}')">${i.on?'Disable':'Enable'}</button>`):`<button class="mini pri" onclick="event.stopPropagation();extInstall('${x.id}')">Install</button>`}</div>`; }

/* ── VSIX: carregamento preguiçoso da lib de unzip + import do pacote. O corpo do
   carregador (document/window.JSZip) vive no bridge; aqui invoca-se o corrente. ── */
publishJSZipLoader();
/** Manifesto `package.json` de um VSIX (os campos que lemos; o resto ignora-se). */
interface VsixManifest {
  publisher: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  engines?: { vscode?: string };
  activationEvents?: string[];
  contributes?: {
    keybindings?: Array<{ command?: string; key?: string }>;
    commands?: Array<{ category?: string; title: string; command?: string }>;
    configuration?: { properties?: Record<string, unknown> };
  };
}
async function loadVsix(file: File){ hydrateExs(); try{const Z=await callLoadJSZip(),zip=await Z.loadAsync(file),pj=zip.file('extension/package.json');if(!pj)throw new Error('extension/package.json not found — is this a VSIX?');const m=JSON.parse(await pj.async('string')) as VsixManifest,id=`${m.publisher}.${m.name}`.toLowerCase(),kb=(m.contributes&&m.contributes.keybindings)||[];
  const x: ExtItem={id,n:m.displayName||m.name,pub:m.publisher||'unknown',d:m.description||'',ctx:[],vsix:1,ver:m.version,engines:(m.engines||{}).vscode,cmds:((m.contributes&&m.contributes.commands)||[]).map((c): ExtCmd=>[(c.category?c.category+': ':'')+c.title,(kb.find(k=>k.command===c.command)||{}).key||'']),cfg:Object.keys(((m.contributes||{}).configuration||{}).properties||{}).slice(0,20),act:(m.activationEvents||[]).slice(0,8)};
  EXS.vsix=EXS.vsix.filter(v=>v.id!==id);EXS.vsix.push(x);EXS.inst[id]={on:1};saveExt();rerExt();toast(`Installed ${x.n} ${x.ver||''} from VSIX`);openTab({id:'extd:'+id,title:x.n,kind:'extd',ext:id});}catch(e){toast('VSIX: '+(e as Error).message);} }

/* ── corpo do tab de detalhe (VIEW.extd) — publicado; v6 mantém o shim. ── */
function renderExtd(t: { ext?: string }, host: HTMLElement){ hydrateExs(); const x=extAll().find(e=>e.id===t.ext);if(!x){host.innerHTML='<div class="empty">Extension removed.</div>';return;}const i=EXS.inst[x.id],live=({errorlens:'Diagnostics appear at the end of each line in the editor.',prettier:'Prettier: Format Document (Shift+Alt+F) trims trailing spaces, normalises indentation and the final newline.',yaml:'YAML files are validated: tabs, missing kind, and Deployments without resource requests show in Problems.'} as Record<string, string | undefined>)[x.eff??''];
  host.innerHTML=`<div class="page" style="max-width:760px"><div style="display:flex;gap:16px;align-items:center"><span class="ex-ic big" style="background:hsl(${[...x.id].reduce((a,c)=>a+c.charCodeAt(0),0)%360} 45% 45%)">${esc(x.n.charAt(0))}</span><div><h1 class="notr" style="margin:0">${esc(x.n)}</h1><div class="sub notr" style="margin:0">${esc(x.pub)} · <code>${esc(x.id)}</code>${x.ver?' · v'+esc(x.ver):''}</div></div></div>
   <div class="sub" style="margin-top:12px">${esc(x.d)}</div><div style="display:flex;gap:8px;margin:12px 0">${i?(x.bundled?'<span class="tag live">bundled</span>':`<button class="mini" onclick="extToggle('${x.id}')">${i.on?'Disable':'Enable'}</button><button class="mini" onclick="extRemove('${x.id}')">Uninstall</button>`):`<button class="mini pri" onclick="extInstall('${x.id}')">Install</button>`}</div>
   <h2>In this prototype</h2><div class="adv ${live?'agent':'mix'}">${svg(live?'check':'bulb')}<div>${live||'Runs in the desktop app\'s VS Code–compatible extension host. Here its commands are listed in the palette but do not run.'}</div></div>
   ${x.cmds&&x.cmds.length?`<h2>Commands</h2><div class="tbl-wrap">${x.cmds.map(c=>`<div class="rowline"><span class="notr">${esc(c[0])}</span><span class="sp"></span>${c[1]?`<kbd>${esc(c[1])}</kbd>`:''}</div>`).join('')}</div>`:''}
   ${x.cfg&&x.cfg.length?`<h2>Settings</h2><div class="tbl-wrap">${x.cfg.map(c=>`<div class="rowline"><code class="notr">${esc(c)}</code></div>`).join('')}</div>`:''}${x.engines?`<div class="sub" style="margin-top:12px">Requires VS Code API <code>${esc(x.engines)}</code>.</div>`:''}</div>`; }

/* ── formatador do «Prettier» (eff:'prettier' nos cmds + Shift+Alt+F no keydown de v6). ── */
function formatDoc(){const t=tabOf(cur());if(!t||t.kind!=='file'||!t.path){toast('Open a file first');return;}const f=files()[t.path],ext=extOf(t.path),keepTabs=ext==='go'||/Makefile$/.test(t.path);let c=f.content.split('\n').map(l=>l.replace(/\s+$/,'')).map(l=>keepTabs?l:l.replace(/^\t+/,m=>'    '.repeat(m.length))).join('\n').replace(/\n*$/,'\n');if(c===f.content){toast('Already formatted');return;}f.content=c;refresh();toast('Formatted with Prettier');}

/** Renderiza o pane «Extensions»: pesquisa, instaladas, recomendadas e catálogo. */
function renderExtPane(){
  hydrateExs();
  const el = $("#pane-ext"), cx = projectContext().map(c => c[0]), q = EXQ.toLowerCase(), f = (x: ExtItem) => !q || (x.n + x.id + x.d).toLowerCase().includes(q), inst = extAll().filter(x => EXS.inst[x.id] && f(x)), rec = EXT.filter(x => !EXS.inst[x.id] && f(x) && x.ctx.some(c => c === "all" || cx.includes(c))), rest = EXT.filter(x => !EXS.inst[x.id] && f(x) && !rec.includes(x));
  if (!el) return;
  el.innerHTML = hd("Extensions", `<button title="Install from VSIX…" onclick="$('#vsix-in').click()">${svg("plus")}</button>`) + `<div class="sections"><input class="inp" id="ex-q" placeholder="Search extensions in Open VSX" value="${esc(EXQ)}"><input type="file" id="vsix-in" accept=".vsix" style="display:none">
   <div class="scm-grp">Installed<span class="cnt">${inst.length}</span></div>${inst.map(extRow).join("") || '<div class="sec-empty">None.</div>'}
   ${rec.length ? `<div class="scm-grp">Recommended for this project<span class="cnt">${rec.length}</span></div>${rec.map(extRow).join("")}` : ""}${rest.length ? `<div class="scm-grp">Open VSX</div>${rest.map(extRow).join("")}` : ""}
   <div class="sec-empty">Extensions come from Open VSX — the Microsoft Marketplace terms only allow Microsoft's own products. Availability varies by extension. In the browser only a few behave live (Error Lens, Prettier, YAML); the desktop app runs them all in a VS Code–compatible extension host.</div></div>`;
  const qi = $("#ex-q") as HTMLInputElement | null;
  if (qi) qi.oninput = () => { EXQ = qi.value; renderExtPane(); const n = $("#ex-q") as HTMLInputElement | null; if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
  const vi = $("#vsix-in") as HTMLInputElement | null;
  if (vi) vi.onchange = e => { const fs = (e.target as HTMLInputElement).files; if (fs && fs[0]) loadVsix(fs[0]); };
}

/* ── publicação no window (via bridge) ──
   Nomes reais (resolvem os onclick inline e as chamadas do resíduo @ts-nocheck de v6);
   shims em v6: RP.ext→renderExtPane, VIEW.extd→renderExtd.
   Aliases sem o substring migrado p/ as decorações de v6 (diagnostics/paintEd/keydown/
   arranque) lerem o motor: vsxOn=extOn, vsxFmt=formatDoc, vsxCmds=extCmds. */
publish({
  EXT, EXS, saveExt, extOn, extAll, extCmds, extInstall, extRemove, extToggle,
  rerExt, extRow, loadVsix, formatDoc, renderExtPane, renderExtd,
  vsxOn: extOn, vsxFmt: formatDoc, vsxCmds: extCmds,
});
