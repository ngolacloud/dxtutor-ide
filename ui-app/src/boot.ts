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
   ganhar onde redefine.

   ADR-0004, U4j1: tipado (era @ts-nocheck) e sem o código morto do primeiro protótipo
   (separadores/documentos/minimapa/boas-vindas antigos, nunca referenciados, e as versões
   do agente que o features/codev.ts redefine antes de alguém as ler). O que resta são as
   globais de base ($/$$/P/svg/toast), os dados iniciais (ACTS/OVERFLOW/MENUS/TREE/DOCS), o
   painel de contentores de demonstração e dois listeners. */
export {};

declare global {
  interface Window {
    $: (s: string) => HTMLElement | null;
    $$: (s: string) => HTMLElement[];
    P: Record<string, string>;
    ACTS: unknown[];
    OVERFLOW: unknown[];
    MENUS: unknown[];
    TREE: unknown;
    DOCS: Record<string, Array<[string, string]>>;
    wireSections: (scope: ParentNode) => void;
    buildDocker: () => void;
  }
  var toTimer: ReturnType<typeof setTimeout> | undefined;
  var activeTab: string | null;
  const agCtl: (a: string) => void;
  const svg: (name: string, cls?: string) => string;
  const hydrate: () => void;
  const wireSections: (scope: ParentNode) => void;
  /* o String.replaceAll existe em runtime (ES2021, webview e browsers suportados) mas a lib
     do projecto é ES2020; declara-se só a assinatura que o buildDocker usa */
  interface String { replaceAll(searchValue: string, replaceValue: string): string }
}

/* ── mutáveis partilhadas: window-backed SEM binding léxico. Fonte única, lida e
   escrita por boot e pelos restantes módulos por nome (resolvem a globalThis.*).
   Inicializadas já aqui para a propriedade existir antes de qualquer atribuição
   livre em modo estrito (módulo). ── */
Object.assign(window, { toTimer: undefined, TABS: [], activeTab: null, CWD: ['~','workspaces','NgolaCloud','projects'] });

window.$=s=>document.querySelector<HTMLElement>(s);window.$$=s=>[...document.querySelectorAll<HTMLElement>(s)];

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
  /* os ícones de Tasks/Explain/Review/Debug/observabilidade/Visualize — eram um Object.assign(P,…) no v6.ts (ADR-0004, U4g7) */
  kanban:'<rect x="1.8" y="2.5" width="3.6" height="11" rx=".8"/><rect x="6.2" y="2.5" width="3.6" height="7" rx=".8"/><rect x="10.6" y="2.5" width="3.6" height="9" rx=".8"/>',
  tasks:'<path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><path d="M2.2 4l1 1 1.6-1.9M2.2 8l1 1 1.6-1.9"/><circle cx="3.4" cy="12" r=".9"/>',
  eye:'<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  review:'<path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M5.8 9l1.5 1.5 3-3.2"/>',
  bulb:'<path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.8.9.8 1.5V12h3.2v-1.1c0-.6.3-1.1.8-1.5A4.2 4.2 0 0 0 8 1.8z"/><path d="M6.4 14h3.2"/>',
  bug:'<path d="M5.5 5.5a2.5 2.5 0 0 1 5 0"/><rect x="4.5" y="5.5" width="7" height="8" rx="3.5"/><path d="M8 8v5M2 8.5h2.5M11.5 8.5H14M2.5 12l2-1M13.5 12l-2-1M2.5 5l2 1.2M13.5 5l-2 1.2"/>',
  pulse:'<path d="M1.5 8.5h3l1.5-4 3 8 1.8-5.5 1 1.5h2.7"/>',
  layers:'<path d="M8 2l6 3.2-6 3.2-6-3.2z"/><path d="M2 8.4l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2"/>',
};
window.svg = function(name,cls){return `<svg class="ico${cls?' '+cls:''}" viewBox="0 0 16 16">${P[name]||P.file}</svg>`;}

/* ═════════ TOAST ═════════ */
window.toast = function(m){const t=$('#toast')!;t.textContent=m;t.classList.add('show');clearTimeout(toTimer);toTimer=setTimeout(()=>{t.classList.remove('show');},1600);}
/* o relógio da barra de estado (tick) saiu (ADR-0004, U4g7): o v5 já o substituía por uma função vazia desde a camada «less noise», por isso nunca corria na app. */

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
/* fecha os menus a cada clique — registado aqui (primeiro, como sempre) mas resolvido na hora: o
   closeMenus é da features/menus.ts, que avalia depois (ADR-0004, U4d2) */
document.addEventListener('click',()=>closeMenus());

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
document.addEventListener('keydown',e=>{if(/^(input|textarea)$/i.test((e.target as HTMLElement).tagName))return;
  const open=getComputedStyle(document.body).getPropertyValue('--agent-w').trim()!=='0px'||(activeTab==='Assistant');if(!open)return;
  const rc=$('#ag-runctl');if(e.key==='Escape'){agCtl('esc');return;}if(rc&&rc.classList.contains('hidden'))return;
  const m: Record<string, string>={p:'pause',x:'stop',d:'details'};if(m[e.key]){e.preventDefault();agCtl(m[e.key]);}});
window.wireSections = function(scope){scope.querySelectorAll<HTMLElement>('.sec-hd').forEach(h=>{h.onclick=()=>{h.classList.toggle('open');const b=h.nextElementSibling;if(b&&b.classList.contains('sec-body'))b.classList.toggle('show');};});}
window.buildDocker = function(){const pane=$('#pane-containers')!;pane.innerHTML=pane.innerHTML.replaceAll('{chev}',svg('chev'));
  const cts=[['kaeso-odoo','Exited (130) · 21 horas'],['ecm_val_364','Exited (1) · 2 dias'],['kaeso-odoo-ecm','Exited (255) · 39 min'],['lab-ao-odoo','Exited (0) · 5 dias']];
  $('#dk-containers')!.innerHTML=`<div class="row open dk-row"><span class="chev">${svg('chev')}</span><span class="ic dk-ic">${svg('container')}</span><span class="nm">kaeso</span></div>`+
    cts.map(c=>`<div class="row dk-row sub"><span class="ct-dot"></span><span class="nm dk-fixed">kaeso-odoo:16</span><span class="pth dk-path">${c[0]} · ${c[1]}</span></div>`).join('');
  $('#dk-images')!.innerHTML=['alpine','benchimg','docker.io/pgvector/pgvector','kaeso-odoo','nextcloud'].map(n=>`<div class="row dk-row"><span class="chev">${svg('chev')}</span><span class="ic dk-ic">${svg('image')}</span><span class="nm">${n}</span></div>`).join('');
  wireSections(pane);hydrate();}

/* ═════════ RESIZE ═════════ */

