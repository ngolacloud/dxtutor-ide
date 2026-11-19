// @ts-nocheck
/* ═════════ dxtutor IDE — boot (monólito navegável) ═════════
   Fase 5 da componentização: quarto e último módulo TypeScript do ui-app. boot.js
   era o ÚNICO script clássico; agora toda a cadeia (boot→app→bridge→pair) é de
   módulos ESM.

   TUDO o que boot declara ao topo (funções, consts e mutáveis) vive no WINDOW, sem
   binding léxico — `window.foo = …`, nunca `function foo(){…}`. Isto replica a
   semântica do script clássico: num clássico, `function foo` ia ao object-record do
   global, pelo que as chamadas internas do boot a nomes que o app redefine (hydrate,
   svg, setPane, agCtl…) faziam late-binding e usavam a versão do app (que corre a
   seguir e sobrepõe-se no window). Num módulo, `function foo` criaria um binding
   léxico do módulo e as chamadas internas ficariam presas à versão do boot — por ex.
   o buildDocker do boot chamaria a hydrate DESTRUTIVA do boot (innerHTML=) em vez da
   NÃO-destrutiva do app (insertAdjacentHTML), apagando #st-model-l/#st-branch-l.
   Com tudo window-backed, boot e app partilham UMA fonte por nome e o app continua a
   ganhar onde redefine. @ts-nocheck: tipar fica para fase posterior. */
export {};

/* ── mutáveis partilhadas: window-backed SEM binding léxico. Fonte única, lida e
   escrita por boot e pelos restantes módulos por nome (resolvem a globalThis.*).
   Inicializadas já aqui para a propriedade existir antes de qualquer atribuição
   livre em modo estrito (módulo). ── */
Object.assign(window, { toTimer: undefined, openMenu: null, TABS: [], activeTab: null, CWD: ['~','workspaces','NgolaCloud','projects'], HIST: [], hidx: 0 });

window.$=s=>document.querySelector(s);window.$$=s=>[...document.querySelectorAll(s)];

/* ═════════ ICON LIBRARY (codicon-style SVG) ═════════ */
window.P={
  explorer:'<rect x="5.2" y="2.3" width="7" height="9.3" rx="1"/><path d="M5.2 4.6H3.8a1 1 0 0 0-1 1v7.1a1 1 0 0 0 1 1h5.9a1 1 0 0 0 1-1v-1.1"/>',
  search:'<circle cx="7" cy="7" r="4.1"/><path d="M10 10l3.6 3.6"/>',
  scm:'<circle cx="4.5" cy="3.6" r="1.7"/><circle cx="4.5" cy="12.4" r="1.7"/><circle cx="11.5" cy="6" r="1.7"/><path d="M4.5 5.3v5.4"/><path d="M11.5 7.7a4 4 0 0 1-4 4h-1.3"/>',
  run:'<path d="M5 3.4v9.2l7-4.6z"/>',
  remote:'<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 13.6h4M8 11v2.6"/>',
  ext:'<rect x="2.4" y="2.4" width="4.6" height="4.6" rx=".7"/><rect x="2.4" y="9" width="4.6" height="4.6" rx=".7"/><rect x="9" y="9" width="4.6" height="4.6" rx=".7"/><path d="M11.3 2v4.6M9 4.3h4.6"/>',
  test:'<path d="M6.3 2v3.8L3.4 11a1.1 1.1 0 0 0 1 1.7h7.2a1.1 1.1 0 0 0 1-1.7L9.7 5.8V2"/><path d="M5.4 2h5.2M4.7 9.3h6.6"/>',
  runcircle:'<circle cx="8" cy="8" r="6"/><path d="M6.6 5.4l4 2.6-4 2.6z"/>',
  cube:'<path d="M8 1.9l5.4 3v6.2L8 14.1l-5.4-3V4.9z"/><path d="M8 7.9l5.4-3M8 7.9v6.2M8 7.9L2.6 4.9"/>',
  graph:'<circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="12" cy="8" r="1.6"/><path d="M4 5.6v4.8M5.4 4.8l5.2 2.5M5.4 11.2l5.2-2.5"/>',
  python:'<path d="M8 1.8c-2.4 0-2.9 1-2.9 2.3V6H8v.7H3.6c-1.3 0-2 .9-2 2.8s.7 2.8 2 2.8h1V10c0-1.4.9-2.3 2.3-2.3"/><circle cx="6.3" cy="4" r=".5" class="fill"/>',
  split:'<rect x="2" y="2.5" width="12" height="11" rx="1.2"/><path d="M8 2.5v11"/>',
  dots:'<circle cx="3" cy="8" r="1.1" class="fill"/><circle cx="8" cy="8" r="1.1" class="fill"/><circle cx="13" cy="8" r="1.1" class="fill"/>',
  account:'<circle cx="8" cy="5.5" r="2.6"/><path d="M3.4 13.2c.6-2.6 2.4-3.9 4.6-3.9s4 1.3 4.6 3.9"/>',
  settings:'<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/>',
  sparkle:'<path d="M8 1.8l1.4 4L13.4 7l-4 1.2L8 12.2 6.6 8.2 2.6 7l4-1.2z" class="fill"/>',
  /* small ui */
  chev:'<path d="M6 4l4 4-4 4"/>',
  folder:'<path class="fill" d="M1.6 4.3c0-.6.4-1 1-1h3.1a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3h5.4c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1z"/>',
  folderOpen:'<path class="fill" d="M1.6 4.3c0-.6.4-1 1-1h3.1a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3h5.4c.6 0 1 .4 1 1v.9H4.4a1 1 0 0 0-.95.68L1.6 12.5z"/>',
  file:'<path d="M4 2.3h5.1L12 5.2v8a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.9A.6.6 0 0 1 4 2.3z"/><path d="M9 2.4V5.5h2.9"/>',
  rust:'<path class="fill" d="M8 2.2 9 3.9l1.9-.5-.3 2 1.8.9-1.3 1.5 1 1.7-2 .2-.6 1.9-1.6-1.2-1.6 1.2-.6-1.9-2-.2 1-1.7L2 7.3l1.8-.9-.3-2 1.9.5z"/><circle cx="8" cy="8" r="1.5" class="ic-hole"/>',
  'new-file':'<path d="M4 2.3h4.6L11 4.7v4.1"/><path d="M8.5 2.4V5h2.4"/><path d="M4 2.3A.6.6 0 0 0 3.4 2.9v10.2a.6.6 0 0 0 .6.6h3"/><path d="M11 10.5v4M9 12.5h4"/>',
  'new-folder':'<path d="M1.6 4.3c0-.6.4-1 1-1h2.9a1 1 0 0 1 .7.3l.9.9a1 1 0 0 0 .7.3h5.1"/><path d="M1.6 4.3v7.9c0 .6.4 1 1 1h5.4"/><path d="M12 9.5v4M10 11.5h4"/>',
  refresh:'<path d="M12.5 7a4.6 4.6 0 1 0-.7 3.4"/><path d="M12.6 3.2v2.9H9.7"/>',
  collapse:'<path d="M9 2.5 6.5 5H8.5V8"/><path d="M5 11H3M7 5.5l4-4M11 11.5 9 9.5M11 9.5H9V11.5M2.5 7 5 9.5V11"/>',
  check:'<path d="M3 8.5 6.3 12 13 4.5"/>',
  plus:'<path d="M8 3v10M3 8h10"/>',
  trash:'<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5"/>',
  close:'<path d="M4 4l8 8M12 4l-8 8"/>',
  'layout-side':'<rect x="2" y="2.5" width="12" height="11" rx="1.2"/><path d="M6 2.5v11"/>',
  'layout-panel':'<rect x="2" y="2.5" width="12" height="11" rx="1.2"/><path d="M2 10h12"/>',
  history:'<circle cx="8" cy="8" r="5.8"/><path d="M8 4.7V8l2.3 1.6"/>',
  'arrow-up':'<path d="M8 13V3M4 7l4-4 4 4"/>',
  shield:'<path d="M8 2 3 4v3.5C3 10.8 5.2 13 8 14c2.8-1 5-3.2 5-6.5V4z"/>',
  rocket:'<path d="M8 2c2.2 1.3 3.3 3.5 3.3 6.5L8 11 4.7 8.5C4.7 5.5 5.8 3.3 8 2z"/><circle cx="8" cy="6.3" r="1.1"/><path d="M5.5 10c-1 .4-1.6 1.4-1.6 2.8 1.4 0 2.4-.6 2.8-1.6M10.5 10c1 .4 1.6 1.4 1.6 2.8-1.4 0-2.4-.6-2.8-1.6"/>',
  'branch-sm':'<circle cx="4.5" cy="4" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5.5v5M11.5 7a3.5 3.5 0 0 1-3.5 3.5H5"/>',
  'remote-arrows':'<path d="M6 3 2 8l4 5M10 3l4 5-4 5"/>',
  sync:'<path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5"/><path d="M11.8 2.2v2.6H9.2M4.2 13.8v-2.6h2.6"/>',
  debug:'<circle cx="8" cy="8.8" r="3.4"/><path d="M8 5.4V3.2M5.2 6.4 3.8 5M10.8 6.4 12.2 5M4.6 8.8H2.6M13.4 8.8h-2M5.4 11.2 4 12.6M10.6 11.2 12 12.6"/>',
  cloud:'<path d="M5 11.5h6.2a2.6 2.6 0 0 0 .2-5.2 3.6 3.6 0 0 0-7-1A2.7 2.7 0 0 0 5 11.5z"/>',
  broadcast:'<circle cx="8" cy="8" r="1.4" class="fill"/><path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3.3 3.3a6.6 6.6 0 0 0 0 9.4M12.7 3.3a6.6 6.6 0 0 1 0 9.4"/>',
  drop:'<path d="M8 2.4S4 6.8 4 9.8a4 4 0 0 0 8 0c0-3-4-7.4-4-7.4z"/>',
  bell:'<path d="M8 2.2a3.4 3.4 0 0 0-3.4 3.4c0 4-1.4 4.9-1.4 4.9h9.6s-1.4-.9-1.4-4.9A3.4 3.4 0 0 0 8 2.2z"/><path d="M6.6 13a1.5 1.5 0 0 0 2.8 0"/>',
  volume:'<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4"/><path d="M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8"/>',
  network:'<circle cx="8" cy="3.5" r="1.6"/><circle cx="3.5" cy="12" r="1.6"/><circle cx="12.5" cy="12" r="1.6"/><path d="M8 5.1v3M8 8l-3.6 2.6M8 8l3.6 2.6"/>',
  image:'<rect x="2.5" y="3" width="11" height="10" rx="1"/><circle cx="5.8" cy="6.3" r="1.1"/><path d="M2.5 11l3.2-3 2.3 2 2.4-2.6 3.1 3.6"/>',
  container:'<rect x="2.2" y="5" width="4.4" height="4.4" rx=".4"/><rect x="6.8" y="5" width="4.4" height="4.4" rx=".4"/><path d="M11.4 5h2.4v4.4h-2.4M2.2 9.4h11.6v1.4c0 .6-.4 1-1 1H3.2c-.6 0-1-.4-1-1z"/>',
  book:'<path d="M3 3.2h4.5a1.5 1.5 0 0 1 1.5 1.5v8.1a1.2 1.2 0 0 0-1.2-1.2H3z"/><path d="M13 3.2H8.5A1.5 1.5 0 0 0 7 4.7v8.1a1.2 1.2 0 0 1 1.2-1.2H13z"/>',
  popout:'<path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 8 8"/><path d="M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7"/>',
  'dock-right':'<rect x="2" y="2.5" width="12" height="11" rx="1.2"/><path d="M9.5 2.5v11"/>',
};
window.svg = function(name,cls){return `<svg class="ico${cls?' '+cls:''}" viewBox="0 0 16 16">${P[name]||P.file}</svg>`;}
window.hydrate = function(){$$('[data-ic]').forEach(el=>{if(el.dataset.done)return;el.innerHTML=svg(el.dataset.ic);el.dataset.done=1;});}

/* ═════════ TOAST / CLOCK ═════════ */
window.toast = function(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toTimer);toTimer=setTimeout(()=>{t.classList.remove('show');},1600);}
window.tick = function(){const d=new Date(),p=n=>String(n).padStart(2,'0');const m=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()];$('#clock').textContent=`${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}-${m}`;}

/* ═════════ ACTIVITY BAR ═════════ */
// Activity bar NATIVA (VS Code core) + o Assistant próprio do dxtutor.
// Ícones contribuídos por plugins NÃO entram aqui — vão para o overflow "…".
window.ACTS=[
  {ic:'explorer',pane:'explorer',title:'Explorer'},
  {ic:'search',pane:'search',title:'Search'},
  {ic:'scm',pane:'scm',title:'Source Control',badge:'3'},
  {ic:'run',pane:'run',title:'Run and Debug'},
  {ic:'test',pane:'test',title:'Testing'},
  {ic:'ext',pane:'ext',title:'Extensions',badge:'2'},
  {ic:'sparkle',pane:'assistant',title:'Assistant (dxtutor)',accBadge:1},
  {ic:'dots',overflow:1,title:'Additional Views…',spacer:1},
  {ic:'account',pane:'account',title:'Accounts'},
  {ic:'settings',pane:'settings',title:'Settings'},
];
// Vistas de plugin (só aparecem se o plugin estiver instalado) — vivem no overflow.
window.OVERFLOW=[
  {l:'Remote Explorer',pane:'remote'},{l:'Containers',pane:'containers'},{l:'GitLens'},{l:'Python'},{l:'Launchpad'},
  {sep:1},
  {l:'Colab'},{l:'Cloud Code'},{l:'Google Cloud Data Agent Kit'},{l:'Firebase SQL Connect'},{l:'Kubernetes'},{l:'Makefile'},{l:'Prisma'},{l:'Ansible'},{l:'SonarQube Setup'},{l:'Trunk'},
];
window.buildActivity = function(){
  const bar=$('#activity');
  ACTS.forEach((a,i)=>{const el=document.createElement('button');el.className='act'+(i===0?' on':'')+(a.spacer?' spacer':'');
    el.title=a.title;el.innerHTML=svg(a.ic)+(a.badge?`<span class="badge${a.accBadge?' acc':''}">${a.badge}</span>`:'');
    el.onclick=e=>{e.stopPropagation();if(a.overflow)openOverflow(el);else if(a.pane)setPane(a.pane,el);else toast(a.title);};bar.appendChild(el);});
}
window.openOverflow = function(btn){closeMenus();const r=btn.getBoundingClientRect();const pop=document.createElement('div');pop.className='menu-pop show';document.body.appendChild(pop);
  const title=document.createElement('div');title.className='mi ov-title';title.textContent='Additional Views';pop.appendChild(title);
  OVERFLOW.forEach(it=>{if(it.sep){const s=document.createElement('div');s.className='mi-sep';pop.appendChild(s);return;}
    const mi=document.createElement('div');mi.className='mi';mi.innerHTML=`<span>${it.l}</span>`+(it.pane?'':'<span class="key">plugin</span>');
    mi.onclick=e=>{e.stopPropagation();closeMenus();if(it.pane)setPane(it.pane);else toast(it.l+' — requer o plugin instalado');};pop.appendChild(mi);});
  let x=r.right+4,y=r.top;const h=pop.offsetHeight;if(y+h>innerHeight)y=innerHeight-h-6;pop.style.left=x+'px';pop.style.top=y+'px';}
window.setPane = function(p,el){
  $$('.act').forEach(a=>a.classList.remove('on'));
  if(el)el.classList.add('on');else{const idx=ACTS.findIndex(a=>a.pane===p);if(idx>=0)$$('.act')[idx].classList.add('on');}
  $$('.pane').forEach(x=>x.classList.remove('show'));const pe=$('#pane-'+p);if(pe)pe.classList.add('show');
}

/* ═════════ MENUS ═════════ */
window.MENUS=[
  {t:'File',items:[{l:'New Text File',k:'Ctrl+N'},{l:'New File…',k:'Ctrl+Alt+N'},{l:'New Window',k:'Ctrl+Shift+N'},{sep:1},{l:'Open File…',k:'Ctrl+O'},{l:'Open Folder…'},{l:'Open Recent',sub:[{l:'~/workspaces/NgolaCloud/projects'},{l:'~/workspaces/delonix-runtime'},{l:'~/workspaces/DORM'},{sep:1},{l:'Clear Recently Opened'}]},{sep:1},{l:'Save',k:'Ctrl+S'},{l:'Save As…',k:'Ctrl+Shift+S'},{l:'Save All'},{sep:1},{l:'Preferences',sub:[{l:'Settings',k:'Ctrl+,'},{l:'Keyboard Shortcuts'},{l:'Color Theme',sub:[{l:'Grafite laranja',on:1},{l:'Slate índigo'},{l:'Dark+ (clássico)'}]},{l:'Extensions'}]},{sep:1},{l:'Exit',k:'Ctrl+Q'}]},
  {t:'Edit',items:[{l:'Undo',k:'Ctrl+Z'},{l:'Redo',k:'Ctrl+Y'},{sep:1},{l:'Cut',k:'Ctrl+X'},{l:'Copy',k:'Ctrl+C'},{l:'Paste',k:'Ctrl+V'},{sep:1},{l:'Find',k:'Ctrl+F'},{l:'Replace',k:'Ctrl+H'},{l:'Find in Files',k:'Ctrl+Shift+F'}]},
  {t:'Selection',items:[{l:'Select All',k:'Ctrl+A'},{l:'Expand Selection',k:'Shift+Alt+→'},{sep:1},{l:'Add Cursor Above',k:'Ctrl+Alt+↑'},{l:'Add Cursor Below',k:'Ctrl+Alt+↓'},{l:'Select All Occurrences',k:'Ctrl+Shift+L'},{sep:1},{l:'Column Selection Mode'}]},
  {t:'View',items:[{l:'Command Palette…',k:'Ctrl+Shift+P'},{l:'Open View…'},{sep:1},{l:'Appearance',sub:[{l:'Full Screen',k:'F11'},{l:'Zen Mode',k:'Ctrl+K Z'},{sep:1},{l:'Menu Bar',on:1},{l:'Status Bar',on:1},{l:'Activity Bar',on:1}]},{l:'Editor Layout',sub:[{l:'Split Up'},{l:'Split Down'},{l:'Split Right'},{sep:1},{l:'Single'},{l:'Two Columns'}]},{sep:1},{l:'Explorer',k:'Ctrl+Shift+E',on:1},{l:'Search',k:'Ctrl+Shift+F'},{l:'Source Control',k:'Ctrl+Shift+G'},{sep:1},{l:'Terminal',k:'Ctrl+`',on:1},{l:'Problems',k:'Ctrl+Shift+M'},{l:'Assistant',k:'Ctrl+Shift+A',on:1}]},
  {t:'Go',items:[{l:'Back',k:'Alt+←'},{l:'Forward',k:'Alt+→'},{sep:1},{l:'Go to File…',k:'Ctrl+P'},{l:'Go to Symbol…',k:'Ctrl+Shift+O'},{l:'Go to Line…',k:'Ctrl+G'},{sep:1},{l:'Go to Definition',k:'F12'},{l:'Go to References',k:'Shift+F12'}]},
  {t:'Run',items:[{l:'Start Debugging',k:'F5'},{l:'Run Without Debugging',k:'Ctrl+F5'},{l:'Stop',k:'Shift+F5'},{sep:1},{l:'Toggle Breakpoint',k:'F9'},{sep:1},{l:'Run Task…',sub:[{l:'cargo build'},{l:'cargo test'},{l:'cargo clippy'},{l:'npm run dev'}]}]},
  {t:'Terminal',items:[{l:'New Terminal',k:'Ctrl+Shift+`'},{l:'Split Terminal',k:'Ctrl+Shift+5'},{sep:1},{l:'Run Task…'},{l:'Run Build Task…',k:'Ctrl+Shift+B'},{sep:1},{l:'Clear',act:'termClear'}]},
  {t:'Help',items:[{l:'Welcome'},{l:'Documentation'},{l:'Show All Commands',k:'Ctrl+Shift+P'},{sep:1},{l:'About dxtutor IDE'}]},
];
window.buildMenubar = function(){const mb=$('#menubar');MENUS.forEach((m,i)=>{const b=document.createElement('button');b.className='menu-top';b.textContent=m.t;b.onclick=e=>{e.stopPropagation();openMenu===i?closeMenus():showMenu(i,b);};b.onmouseenter=()=>{if(openMenu!==null&&openMenu!==i)showMenu(i,b);};mb.appendChild(b);});}
window.closeMenus = function(){$$('.menu-pop').forEach(p=>p.remove());$$('.menu-top').forEach(b=>b.classList.remove('open'));openMenu=null;}
window.showMenu = function(i,btn){closeMenus();openMenu=i;btn.classList.add('open');const r=btn.getBoundingClientRect();renderPop(MENUS[i].items,r.left,r.bottom+2);}
window.renderPop = function(items,x,y){const pop=document.createElement('div');pop.className='menu-pop show';document.body.appendChild(pop);
  items.forEach(it=>{if(it.sep){const s=document.createElement('div');s.className='mi-sep';pop.appendChild(s);return;}
    const mi=document.createElement('div');mi.className='mi'+(it.k?' has-key':'');let h='';
    if(it.on!==undefined||it.check!==undefined)h+=`<span class="mi-check">${(it.on||it.check)?'✓':''}</span>`;
    h+=`<span>${it.l}</span>`;if(it.k)h+=`<span class="key">${it.k}</span>`;if(it.sub)h+=`<span class="chev">▶</span>`;mi.innerHTML=h;
    if(it.sub){mi.onmouseenter=()=>{pop.querySelectorAll('.menu-pop').forEach(p=>p.remove());const r=mi.getBoundingClientRect();const sp=renderPop(it.sub,r.right-3,r.top-5);pop.appendChild(sp);};mi.onclick=e=>e.stopPropagation();}
    else mi.onclick=e=>{e.stopPropagation();closeMenus();if(typeof it.act==='function')it.act();else if(it.act&&window[it.act])window[it.act]();else toast(it.l);};
    pop.appendChild(mi);});
  const w=pop.offsetWidth;if(x+w>innerWidth)x=innerWidth-w-6;pop.style.left=x+'px';pop.style.top=y+'px';return pop;}
document.addEventListener('click',closeMenus);

/* ═════════ EXPLORER (tree + sections) ═════════ */
window.TREE={projects:{dir:1,open:1,children:{
  '.claude':{dir:1},'.worktrees':{dir:1},'audits':{dir:1},
  'delonix-console':{dir:1,git:'u'},'delonix-deploy':{dir:1},'delonix-desktop':{dir:1,git:'m'},
  'delonix-mail':{dir:1,git:'m'},'delonix-runtime':{dir:1,git:'m'},'DORM':{dir:1},'dx':{dir:1},'dxjs':{dir:1},
  'dxtutor':{dir:1,git:'m',open:1,children:{
    'desktop':{dir:1,open:1,children:{
      'src':{dir:1,open:1,children:{
        'main.ts':{t:'rust'},'assistant.ts':{t:'rust',git:'m'},'workspace.ts':{t:'rust'},
        'styles.css':{t:'css',git:'m'},'theme.css':{t:'css',git:'u'},'i18n.ts':{t:'rust'},
      }},
      'package.json':{t:'json'},'index.html':{t:'file'},
    }},
    'crates':{dir:1},'Cargo.toml':{t:'toml'},'README.md':{t:'md'},
  }},
  'ngolacloud-control-plane':{dir:1,git:'m'},'ngolacloud-control-plane_bkp':{dir:1},'seiva':{dir:1},'still-js':{dir:1},
}}};
window.DOCS={
  'lib.rs':[['cm','// Tokeniza uma expressão aritmética.'],['','<span class="kw">pub fn</span> <span class="fn">tokenize</span>(src: <span class="ty">&str</span>) -&gt; <span class="ty">Vec</span>&lt;<span class="ty">Token</span>&gt; {'],['','    <span class="kw">let mut</span> tokens = <span class="ty">Vec</span>::<span class="fn">new</span>();'],['','    <span class="kw">let mut</span> chars = src.<span class="fn">chars</span>().<span class="fn">peekable</span>();'],['err','    <span class="kw">for</span> c <span class="kw">in</span> chars {  <span class="cm">// ← E0382: use of moved value</span>'],['','        <span class="kw">if</span> c.<span class="fn">is_ascii_digit</span>() {'],['','            tokens.<span class="fn">push</span>(<span class="ty">Token</span>::<span class="ty">Num</span>(c));'],['','        }'],['','    }'],['','    <span class="mac">println!</span>(<span class="str">"{} tokens"</span>, tokens.<span class="fn">len</span>());'],['','    tokens'],['','}']],
  'assistant.ts':[['cm','// Painel Assistant — render das mensagens.'],['','<span class="kw">export function</span> <span class="fn">renderMessages</span>(): <span class="ty">void</span> {'],['','  <span class="kw">const</span> host = <span class="fn">$</span>(<span class="str">"#ag-msgs"</span>);'],['','  host.innerHTML = state.messages.<span class="fn">map</span>(<span class="fn">bubble</span>).<span class="fn">join</span>(<span class="str">""</span>);'],['','}']],
  'styles.css':[['cm','/* dxtutor — tema Grafite + laranja */'],['',':root {'],['','  --bg-base: <span class="num">#0f0f11</span>;'],['','  --accent: <span class="num">#e06c3b</span>;'],['','  --accent-hover: <span class="num">#f08a4b</span>;'],['','}']],
};
window.iconFor = function(node,open){if(node.dir)return svg(open?'folderOpen':'folder',open?'':'folder-ic');return svg(node.t==='rust'?'rust':'file');}
window.iconClass = function(node){return node.dir?'folder':(node.t||'file');}
window.buildExplorer = function(){
  const host=$('#exp-sections');host.innerHTML='';
  // Root folder section (projects) — file tree
  const treeSec=document.createElement('div');treeSec.className='section flexible';
  const hd=document.createElement('div');hd.className='sec-hd open';hd.innerHTML=`<span class="chev">${svg('chev')}</span><span class="lbl">projects</span><span class="acts"><button>${svg('new-file')}</button><button>${svg('refresh')}</button></span>`;
  const body=document.createElement('div');body.className='sec-body show';const tree=document.createElement('div');tree.className='tree';body.appendChild(tree);
  hd.onclick=()=>{hd.classList.toggle('open');body.classList.toggle('show');};
  renderLevel(TREE.projects.children,tree,0,['projects']);
  treeSec.appendChild(hd);treeSec.appendChild(body);host.appendChild(treeSec);
  // extra sections
  [['OUTLINE','A pré-visualização não fornece informação de outline.'],
   ['TIMELINE','A pré-visualização não fornece informação de timeline.'],
   ['RUST DEPENDENCIES','adler2 2.0.1 · aead 0.5.2 · aes 0.9.1 · aes-gcm 0.11.0'],
   ['TRUNK CHECK','Para usar o trunk, abre ou clona um repositório git.']
  ].forEach(([lbl,txt],i)=>{
    const sec=document.createElement('div');sec.className='section';
    const h=document.createElement('div');h.className='sec-hd'+(i===2?' open':'');h.innerHTML=`<span class="chev">${svg('chev')}</span><span class="lbl">${lbl}</span>`;
    const b=document.createElement('div');b.className='sec-body'+(i===2?' show':'');
    if(i===2){b.innerHTML=`<div class="tree tree-flat">${['adler2 2.0.1','aead 0.5.2','aes 0.9.1','aes-gcm 0.11.0','sha2 0.10.8'].map(d=>`<div class="row"><span class="chev">${svg('chev')}</span><span class="ic folder">${svg('folder','folder-ic')}</span><span class="nm">${d}</span></div>`).join('')}</div>`;}
    else b.innerHTML=`<div class="sec-empty">${txt}</div>`;
    h.onclick=()=>{h.classList.toggle('open');b.classList.toggle('show');};
    sec.appendChild(h);sec.appendChild(b);host.appendChild(sec);
  });
}
window.renderLevel = function(obj,host,depth,path){
  Object.keys(obj).forEach(name=>{
    const node=obj[name];const pad=8+depth*12;
    const row=document.createElement('div');row.className='row'+(node.git?' git-'+node.git:'');row.style.paddingLeft=pad+'px'; // profundidade ilimitada — não cabe em classe estática
    const gi=node.git?(node.dir?`<span class="dot"></span>`:`<span class="deco">${node.git.toUpperCase()}</span>`):'';
    row.innerHTML=`<span class="chev${node.dir?'':' leaf'}">${svg('chev')}</span><span class="ic ${iconClass(node)}">${iconFor(node,node.open)}</span><span class="nm">${name}</span>${gi}`;
    host.appendChild(row);
    if(node.dir){
      const kids=document.createElement('div');kids.className='children';
      if(depth>=0){const g=document.createElement('span');g.className='guide';g.style.left=(pad+7)+'px';kids.appendChild(g);}
      host.appendChild(kids);let built=false;
      const expand=open=>{row.classList.toggle('open',open);kids.classList.toggle('show',open);
        row.querySelector('.ic').innerHTML=iconFor(node,open);
        if(open&&!built&&node.children){renderLevel(node.children,kids,depth+1,path.concat(name));built=true;}};
      row.onclick=e=>{e.stopPropagation();sel(row);expand(!row.classList.contains('open'));};
      if(node.open){expand(true);}
    }else{
      row.onclick=e=>{e.stopPropagation();sel(row);openFile(name,node.t);};
    }
  });
}
window.sel = function(r){$$('.row.sel').forEach(x=>x.classList.remove('sel'));r.classList.add('sel');}
window.collapseAll = function(){$$('#exp-sections .tree .row.open').forEach(r=>{r.classList.remove('open');const k=r.nextElementSibling;if(k&&k.classList.contains('children'))k.classList.remove('show');r.querySelector('.ic').innerHTML=svg('folder','folder-ic');});}

/* ═════════ TABS / EDITOR ═════════ */
window.openFile = function(name,t){let x=TABS.find(o=>o.name===name);if(!x){x={name,t:t||'file'};TABS.push(x);}setActive(name);}
window.tabIcon = function(t){if(t==='chat'||t==='agent')return svg('sparkle','chat');if(t==='rust')return svg('rust','rs');if(t==='css')return svg('file','css');return svg('file');}
window.renderTabs = function(){const host=$('#tabs');host.innerHTML='';TABS.forEach(t=>{const el=document.createElement('div');el.className='tab'+(t.name===activeTab?' active':'');
  el.innerHTML=`<span class="ic ${t.t==='rust'?'rs':t.t==='css'?'css':t.t==='chat'||t.t==='agent'?'chat':''}">${tabIcon(t.t)}</span><span class="nm">${t.name}</span><button class="x" data-ic="close"></button>`;
  el.onclick=e=>{if(e.target.closest('.x')){closeTab(t.name);e.stopPropagation();return;}setActive(t.name);};host.appendChild(el);});hydrate();}
window.renderDocs = function(){const host=$('#ebody');TABS.forEach(t=>{if($('#doc-'+cid(t.name)))return;const d=document.createElement('div');d.className='doc';d.id='doc-'+cid(t.name);
  if(t.t==='chat')d.innerHTML=welcome();
  else if(t.t==='agent'){d.innerHTML=agentShell();host.appendChild(d);placeAgentCenter();return;}
  else{const lines=DOCS[t.name]||[['dim','// '+t.name+' — pré-visualização']];const code=document.createElement('div');code.className='code';
    lines.forEach((ln,i)=>{const r=document.createElement('div');r.className='cl'+(ln[0]==='err'?' err':'');r.innerHTML=`<span class="ln">${i+1}</span><span class="tx ${ln[0]!=='err'?ln[0]:''}">${ln[1]}</span>`;code.appendChild(r);});d.appendChild(code);}
  host.appendChild(d);});}
window.agentShell = function(){return `<div class="agent-center"><div class="ac-head"><div class="ag-mark">${svg('sparkle')}</div><div class="ag-name">Assistant</div><div class="ag-model"><span class="live"></span>opus-4.8</div><button class="ac-dock" onclick="assistantDock()">${svg('dock-right')} Dock à direita</button></div><div class="ac-body"><div id="agent-slot"></div></div></div>`;}
window.placeAgentCenter = function(){const s=$('#agent-slot');if(s)s.append($('#ag-msgs'),$('#budget'),$('#ag-runctl'),$('#ag-compose'));}
window.placeAgentDock = function(){const a=$('#agent');if(a)a.append($('#ag-msgs'),$('#budget'),$('#ag-runctl'),$('#ag-compose'));}
window.agCtl = function(a){const msg={pause:'Pausa agendada para o fim do passo 5',stop:'Execução parada',details:'A abrir detalhes do passo 5 — Verificar a mudança',esc:'De volta à lista de etapas'}[a];toast(msg);if(a==='stop'){const rc=$('#ag-runctl');if(rc)rc.classList.add('hidden');}}
document.addEventListener('keydown',e=>{if(/^(input|textarea)$/i.test(e.target.tagName))return;
  const open=getComputedStyle(document.body).getPropertyValue('--agent-w').trim()!=='0px'||(activeTab==='Assistant');if(!open)return;
  const rc=$('#ag-runctl');if(e.key==='Escape'){agCtl('esc');return;}if(rc&&rc.classList.contains('hidden'))return;
  const m={p:'pause',x:'stop',d:'details'};if(m[e.key]){e.preventDefault();agCtl(m[e.key]);}});
window.assistantCenter = function(){document.body.style.setProperty('--agent-w','0px');$('#tgl-agent').classList.remove('on');let x=TABS.find(o=>o.name==='Assistant');if(!x){x={name:'Assistant',t:'agent'};TABS.push(x);}setActive('Assistant');}
window.assistantDock = function(){closeTab('Assistant');}
window.cid = function(s){return s.replace(/[^a-z0-9]/gi,'_');}
window.setActive = function(name){activeTab=name;renderTabs();renderDocs();$$('.doc').forEach(d=>d.classList.remove('show'));const d=$('#doc-'+cid(name));if(d)d.classList.add('show');
  const t=TABS.find(o=>o.name===name);$('#breadcrumbs').innerHTML=t?`<span class="crumb">dxtutor</span><span class="sep">›</span><span class="crumb">desktop</span><span class="sep">›</span><span class="crumb">src</span><span class="sep">›</span><span class="crumb cur">${name}</span>`:'';
  renderMinimap(name);}
window.renderMinimap = function(name){const mm=$('#minimap'),scroll=$('#ebody'),t=TABS.find(o=>o.name===name);
  if(!t||t.t==='chat'||!DOCS[name]){mm.classList.add('hidden');scroll.classList.remove('with-mm');return;}
  mm.classList.remove('hidden');scroll.classList.add('with-mm');
  mm.innerHTML='<div class="mm-view"></div>'+DOCS[name].map(l=>{const len=(l[1]||'').replace(/<[^>]+>/g,'').length,w=Math.max(7,Math.min(52,len*1.05));return `<div class="mm-line${l[0]==='err'?' err':''}" style="width:${w}px"></div>`;}).join('');} // largura derivada do conteúdo — visualização de dados, não cabe em classe
window.wireSections = function(scope){scope.querySelectorAll('.sec-hd').forEach(h=>{h.onclick=()=>{h.classList.toggle('open');const b=h.nextElementSibling;if(b&&b.classList.contains('sec-body'))b.classList.toggle('show');};});}
window.buildDocker = function(){const pane=$('#pane-containers');pane.innerHTML=pane.innerHTML.replaceAll('{chev}',svg('chev'));
  const cts=[['kaeso-odoo','Exited (130) · 21 horas'],['ecm_val_364','Exited (1) · 2 dias'],['kaeso-odoo-ecm','Exited (255) · 39 min'],['lab-ao-odoo','Exited (0) · 5 dias']];
  $('#dk-containers').innerHTML=`<div class="row open dk-row"><span class="chev">${svg('chev')}</span><span class="ic dk-ic">${svg('container')}</span><span class="nm">kaeso</span></div>`+
    cts.map(c=>`<div class="row dk-row sub"><span class="ct-dot"></span><span class="nm dk-fixed">kaeso-odoo:16</span><span class="pth dk-path">${c[0]} · ${c[1]}</span></div>`).join('');
  $('#dk-images').innerHTML=['alpine','benchimg','docker.io/pgvector/pgvector','kaeso-odoo','nextcloud'].map(n=>`<div class="row dk-row"><span class="chev">${svg('chev')}</span><span class="ic dk-ic">${svg('image')}</span><span class="nm">${n}</span></div>`).join('');
  wireSections(pane);hydrate();}
window.closeTab = function(name){const i=TABS.findIndex(t=>t.name===name);if(i<0)return;
  if(name==='Assistant'){placeAgentDock();document.body.style.setProperty('--agent-w','380px');$('#tgl-agent').classList.add('on');}
  const d=$('#doc-'+cid(name));if(d)d.remove();TABS.splice(i,1);if(activeTab===name)activeTab=TABS.length?TABS[Math.max(0,i-1)].name:null;renderTabs();if(activeTab)setActive(activeTab);else $('#breadcrumbs').innerHTML='';}
window.welcome = function(){return `<div class="wlc">
  <div class="wlc-head"><div class="wlc-logo">${svg('sparkle')}</div><div class="wlc-title">dxtutor <b>IDE</b></div></div>
  <div class="wlc-sub">Protótipo navegável · organização do Antigravity · ícones SVG codicon. Clica à vontade: menus, Explorer (com secções), activity bar, tabs e o terminal em baixo.</div>
  <div class="wlc-actions">
    ${wbtn('explorer','Explorar ficheiros','Árvore, guias de indentação e secções',"setPane('explorer')")}
    ${wbtn('run','Experimentar o terminal','Escreve help · ls · git status',"setPanelTab('terminal');setTimeout(()=>{var c=document.getElementById('cmd');if(c)c.focus()},50)")}
    ${wbtn('sparkle','Falar com o Assistant','Painel à direita, com budget',"toggleAgentOn()")}
  </div></div>`;}
window.wbtn = function(ic,t,s,act){return `<button class="wlc-btn" onclick="${act}"><span class="ic">${svg(ic)}</span><span><span class="t">${t}</span><span class="s">${s}</span></span></button>`;}

/* ═════════ BOTTOM PANEL ═════════ */
window.setPanelTab = function(pt){if(getComputedStyle(document.body).getPropertyValue('--panel-h').trim()==='0px')togglePanel();
  $$('.ptab').forEach(b=>b.classList.toggle('on',b.dataset.pt===pt));$$('.pcontent').forEach(c=>c.classList.remove('show'));const el=$('#pc-'+pt);if(el)el.classList.add('show');
  if(pt==='terminal'){const c=$('#cmd');if(c)c.focus();}}
window.togglePanel = function(){const c=getComputedStyle(document.body).getPropertyValue('--panel-h').trim();document.body.style.setProperty('--panel-h',c==='0px'?'230px':'0px');$('#tgl-panel').classList.toggle('on',c==='0px');}
window.toggleSide = function(){const c=getComputedStyle(document.body).getPropertyValue('--side-w').trim();document.body.style.setProperty('--side-w',c==='0px'?'250px':'0px');$('#tgl-side').classList.toggle('on',c!=='0px');}

/* ═════════ AGENT ═════════ */
window.toggleAgent = function(){if(TABS.find(o=>o.name==='Assistant')){assistantDock();return;}const c=getComputedStyle(document.body).getPropertyValue('--agent-w').trim();const show=c==='0px';document.body.style.setProperty('--agent-w',show?'380px':'0px');$('#tgl-agent').classList.toggle('on',show);}
window.toggleAgentOn = function(){if(getComputedStyle(document.body).getPropertyValue('--agent-w').trim()==='0px')toggleAgent();}
window.agSend = function(){const i=$('#ag-input');if(!i.value.trim())return;const msgs=$('#ag-msgs');const q=i.value;
  msgs.insertAdjacentHTML('beforeend',`<div class="m user"><div class="bub"><div class="bh"><span class="br2">você</span><span class="bt">agora</span></div><div class="bd">${q.replace(/</g,'&lt;')}</div></div></div>`);i.value='';msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{msgs.insertAdjacentHTML('beforeend',`<div class="m ai"><div class="bub"><div class="bh"><span>⊡</span><span class="br2">assistant</span><span class="bt">agora</span></div><div class="bd">Recebido: <code>${q.slice(0,40).replace(/</g,'&lt;')}</code>. (protótipo — sem backend)</div></div></div>`);msgs.scrollTop=msgs.scrollHeight;},250);}

/* ═════════ TERMINAL ═════════ */
window.USER='walter';window.HOST='delonix';
window.promptHTML = function(){return `<span class="pr"><span>${USER}</span><span class="at">@</span><span>${HOST}</span><span class="at">:</span><span class="pth">${CWD.join('/')}</span><span class="br"> (main)</span><span class="at">$</span></span> `;}
window.termNew = function(){termClear();}
window.termClear = function(){const t=$('#term');t.innerHTML='';echo(`<span class="ac">delonix shell</span> <span class="dim">· emulado · </span><span class="ok">help</span><span class="dim"> para começar</span>`);newInput();}
window.echo = function(h){const t=$('#term');const d=document.createElement('div');d.className='line';d.innerHTML=h;t.appendChild(d);scrollTerm();}
window.scrollTerm = function(){const p=$('#pc-terminal');p.scrollTop=p.scrollHeight;}
window.newInput = function(){const t=$('#term');const old=$('#inputwrap');if(old)old.remove();const w=document.createElement('div');w.id='inputwrap';w.className='line inputline';w.innerHTML=promptHTML()+'<input id="cmd" autocomplete="off" spellcheck="false"/>';t.appendChild(w);const c=$('#cmd');c.focus();c.onkeydown=onKey;scrollTerm();}
window.onKey = function(e){const c=e.target;if(e.key==='Enter'){const v=c.value;run(v);if(v.trim())HIST.push(v);hidx=HIST.length;}else if(e.key==='ArrowUp'){if(hidx>0){hidx--;c.value=HIST[hidx]||'';}e.preventDefault();}else if(e.key==='ArrowDown'){if(hidx<HIST.length-1){hidx++;c.value=HIST[hidx]||'';}else{hidx=HIST.length;c.value='';}e.preventDefault();}else if(e.key==='Tab'){e.preventDefault();complete(c);}else if(e.ctrlKey&&e.key==='l'){e.preventDefault();termClear();}}
window.dirAt = function(parts){let n=TREE.projects;for(const p of parts){if(!n.children||!n.children[p])return null;n=n.children[p];}return n;}
window.curDir = function(){return dirAt(CWD.slice(4));}
window.complete = function(c){const parts=c.value.split(' '),frag=parts[parts.length-1],d=curDir();if(!d||!d.children)return;const m=Object.keys(d.children).filter(x=>x.startsWith(frag));if(m.length===1){parts[parts.length-1]=m[0];c.value=parts.join(' ');}else if(m.length>1){echoCmd(c.value);echo('<span class="dim">'+m.join('   ')+'</span>');newInput();$('#cmd').value=c.value;}}
window.echoCmd = function(v){const w=$('#inputwrap');if(w)w.remove();echo(promptHTML()+'<span class="cmd">'+(v||'').replace(/</g,'&lt;')+'</span>');}
window.run = function(raw){echoCmd(raw);const v=raw.trim();if(!v){newInput();return;}const[cmd,...a]=v.split(/\s+/);
  const C={
    help(){echo(`<span class="ac">comandos:</span>\n<span class="ok">ls</span> [dir]   <span class="ok">cd</span> &lt;dir&gt;   <span class="ok">pwd</span>   <span class="ok">cat</span> &lt;f&gt;   <span class="ok">tree</span>\n<span class="ok">git</span> status|branch|log   <span class="ok">cargo</span> build|test\n<span class="ok">echo</span> <span class="ok">whoami</span> <span class="ok">date</span> <span class="ok">neofetch</span> <span class="ok">history</span> <span class="ok">clear</span>`);},
    ls(){const d=a[0]?dirAt(CWD.slice(4).concat(a[0].split('/').filter(Boolean))):curDir();if(!d||!d.children){echo('<span class="er">ls: '+(a[0]||'.')+': não encontrado</span>');return;}echo(Object.keys(d.children).map(n=>d.children[n].dir?`<span class="dir">${n}/</span>`:`<span class="${d.children[n].t==='rust'?'ac':''}">${n}</span>`).join('   ')||'<span class="dim">(vazio)</span>');},
    pwd(){echo('/home/'+USER+'/'+CWD.slice(1).join('/'));},
    cd(){const x=a[0]||'~';if(x==='~'||x==='/'){CWD=['~','workspaces','NgolaCloud','projects'];return;}if(x==='..'){if(CWD.length>4)CWD.pop();return;}let t=CWD.slice();for(const p of x.split('/').filter(Boolean)){if(p==='..'){if(t.length>4)t.pop();continue;}const nd=dirAt(t.slice(4).concat(p));if(!nd||!nd.dir){echo('<span class="er">cd: '+x+': não é um directório</span>');return;}t.push(p);}CWD=t;},
    cat(){const f=a[0];if(!f){echo('<span class="er">cat: falta o ficheiro</span>');return;}const b=f.split('/').pop();if(DOCS[b])DOCS[b].forEach(l=>echo('<span class="'+(l[0]==='err'?'':l[0])+'">'+l[1]+'</span>'));else echo('<span class="dim">// '+b+' — conteúdo não disponível no protótipo</span>');},
    tree(){echo('<span class="dir">'+CWD[CWD.length-1]+'/</span>');const d=curDir();if(d&&d.children){const ks=Object.keys(d.children);ks.forEach((k,i)=>echo('<span class="dim">'+(i===ks.length-1?'└─ ':'├─ ')+'</span>'+(d.children[k].dir?'<span class="dir">'+k+'/</span>':k)));}},
    echo(){echo(a.join(' ').replace(/</g,'&lt;'));},whoami(){echo(USER);},date(){echo(new Date().toString());},
    history(){HIST.forEach((h,i)=>echo('<span class="dim">'+String(i+1).padStart(4)+'</span>  '+h.replace(/</g,'&lt;')));},
    clear(){termClear();return 'skip';},
    neofetch(){echo(`<span class="ac">    ✦✦✦✦✦    </span>  <span class="ok">${USER}@${HOST}</span>\n<span class="ac">  ✦✦ </span><span class="dim">delonix</span><span class="ac"> ✦✦  </span>  <span class="ac">OS</span>    Delonix Linux 7.0\n<span class="ac">  ✦✦✦✦✦✦✦✦✦  </span>  <span class="ac">Shell</span> dsh 2.1 (emulado)\n<span class="ac">    ✦✦✦✦✦    </span>  <span class="ac">IDE</span>   dxtutor IDE · grafite\n                 <span class="ac">CPU</span>   16 cores · <span class="ok">extrema velocidade</span>`);},
    git(){const s=a[0];if(s==='status')echo(`No ramo <span class="ac">main</span>\n<span class="dim">Changes not staged:</span>\n  <span class="warn">modified:</span>   desktop/src/styles.css\n  <span class="warn">modified:</span>   desktop/src/assistant.ts\n<span class="dim">Untracked:</span>\n  <span class="er">desktop/src/theme.css</span>`);else if(s==='branch')echo(`<span class="ok">* main</span>\n  develop\n  feat/learning-paths`);else if(s==='log')echo(`<span class="ac">c638e07</span> feat(arch): persist the Studio design\n<span class="ac">a5b0d39</span> feat(arch): double-click a node to delete it\n<span class="ac">64943bc</span> feat(arch): interactive canvas`);else echo('<span class="dim">git: status|branch|log</span>');},
    cargo(){const s=a[0];if(s==='build'){echo('<span class="dim">   Compiling dxtutor v0.1.0</span>');setTimeout(()=>{echo('<span class="ok">    Finished</span> dev in 0.81s');newInput();},140);return 'async';}if(s==='test'){echo('<span class="dim">   Running tests…</span>');setTimeout(()=>{echo('<span class="ok">test result: ok. 261 passed; 0 failed</span>');newInput();},160);return 'async';}echo('<span class="dim">cargo: build|test</span>');},
  };
  let r;if(XC[cmd])r=XC[cmd](a,v);else if(C[cmd])r=C[cmd]();else echo('<span class="er">'+cmd+': comando não encontrado</span> <span class="dim">(help)</span>');if(r!=='skip'&&r!=='async')newInput();}

/* ═════════ PROBLEMS ═════════ */
window.buildProblems = function(){$('#pc-problems').innerHTML=[['e','E0382: use of moved value: `chars`','desktop/src/lib.rs:5'],['w','variável `peek` nunca usada','desktop/src/parser.rs:22'],['w','preferir `while let` a `loop`+`match`','desktop/src/main.rs:88'],['w','import não usado: `std::fmt`','desktop/src/i18n.ts:3']].map(d=>`<div class="prob"><span class="pi ${d[0]}">${d[0]==='e'?'✖':'⚠'}</span><span><span>${d[1]}</span> <span class="ploc">${d[2]}</span></span></div>`).join('');}

/* ═════════ RESIZE ═════════ */
window.mkRz = function(el,v,base,min,max,inv){el.onmousedown=e=>{e.preventDefault();el.classList.add('drag');const sx=e.clientX,start=parseInt(getComputedStyle(document.body).getPropertyValue(v))||base;const mv=ev=>{let d=ev.clientX-sx;if(inv)d=-d;document.body.style.setProperty(v,Math.min(max,Math.max(min,start+d))+'px');};const up=()=>{el.classList.remove('drag');removeEventListener('mousemove',mv);removeEventListener('mouseup',up);};addEventListener('mousemove',mv);addEventListener('mouseup',up);};}

