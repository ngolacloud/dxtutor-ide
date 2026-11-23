// @ts-nocheck
/* ═════════ dxtutor IDE — app (monólito navegável) ═════════
   Fase 4 da componentização: terceiro módulo TypeScript do ui-app, servido como
   <script type="module"> depois do boot.js clássico e ANTES do bridge.ts/pair.ts.
   Era a origem das globais de script; agora é módulo e publica-as no window (bloco
   Object.assign no fim + window.* nas mutáveis partilhadas). @ts-nocheck: tipar a
   sério fica para fase posterior — esta fase só componentiza. */
export {};
import { jsa } from "./core";
import { bus } from "./app/bus";

/* O seed de demonstração (SEED.base) só é carregado quando a build foi feita com
   VITE_SEED=1 — i.e. `npm run dev:seed`. O `npm run dev` arranca com o workspace
   vazio. Ponto único de decisão: lido aqui e respeitado por loadSeed(). */
const SEED_ON = import.meta.env.VITE_SEED === '1';

const SEED={"base": {"Cargo.toml": "[workspace]\nmembers = [\"crates/lexer\", \"crates/store\"]\nresolver = \"2\"\n\n[workspace.dependencies]\nrusqlite = { version = \"0.32\", features = [\"bundled\"] }\n", "README.md": "# dxtutor\n\nIDE com um Co-Dev integrado. Local-first, multi-modelo.\n\n- `desktop/` — interface (TypeScript + Tauri)\n- `crates/lexer` — tokenizador de exemplo\n- `crates/store` — persistência SQLite\n- `db/migrations` — esquema da base de dados\n- `.dxtutor/` — conhecimento do projecto que o Co-Dev lê antes de agir\n", "desktop/index.html": "<!doctype html>\n<html lang=\"pt\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>dxtutor IDE<\/title>\n    <link rel=\"stylesheet\" href=\"/src/styles.css\" />\n  <\/head>\n  <body>\n    <div id=\"app\"><\/div>\n    <script type=\"module\" src=\"/src/main.ts\"><\/script>\n  <\/body>\n<\/html>\n", "desktop/package.json": "{\n  \"name\": \"dxtutor-desktop\",\n  \"version\": \"0.2.0\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"tsc && vite build\",\n    \"lint\": \"dx lint\"\n  },\n  \"dependencies\": {\n    \"@tauri-apps/api\": \"^2.0.0\"\n  }\n}\n", "desktop/src/styles.css": "/* dxtutor — tema Grafite + laranja */\n:root {\n  --bg-base: #0f0f11;\n  --bg-editor: #161618;\n  --accent: #e06c3b;\n  --accent-hover: #f08a4b;\n  --radius: 9px;\n}\n\n.agent {\n  background: var(--bg-editor);\n  border-radius: var(--radius);\n}\n\n.send {\n  background: var(--accent);\n}\n", "desktop/src/assistant.ts": "// Painel Co-Dev — render das mensagens.\nimport { state } from \"./workspace\";\n\nexport function renderMessages(): void {\n  const host = document.querySelector(\"#ag-msgs\");\n  if (!host) return;\n  host.innerHTML = state.messages.map(bubble).join(\"\");\n}\n\nfunction bubble(m: Message): string {\n  return `<div class=\"m ${m.role}\"><div class=\"bd\">${m.html}<\/div><\/div>`;\n}\n\n// v2: suporte a cartões de plano\nexport function renderPlan(steps: Step[]): string {\n  return steps.map((s) => `<div class=\"stp ${s.state}\">${s.label}<\/div>`).join(\"\");\n}\n", "desktop/src/workspace.ts": "// Estado do workspace aberto.\nexport const state = {\n  root: \"\",\n  messages: [] as Message[],\n};\n\nexport async function openWorkspace(name: string): Promise<void> {\n  state.root = name;\n}\n", "desktop/src/i18n.ts": "// Textos da interface (pt-AO).\nconst STRINGS: Record<string, string> = {\n  \"app.title\": \"dxtutor IDE\",\n  \"agent.name\": \"Co-Dev\",\n  \"mode.manual\": \"Manual\",\n  \"mode.auto\": \"Automático\",\n};\n\nexport function t(key: string): string {\n  return STRINGS[key] ?? key;\n}\n", "desktop/src/theme.css": "/* Tokens alternativos — Slate índigo */\n:root[data-theme=\"slate\"] {\n  --bg-base: #0e1016;\n  --bg-editor: #141722;\n  --accent: #6d7cff;\n  --accent-hover: #8f9bff;\n}\n", "desktop/src/main.ts": "// Arranque da aplicação desktop.\nimport { renderMessages } from \"./assistant\";\nimport { openWorkspace } from \"./workspace\";\nimport { t } from \"./i18n\";\n\nexport async function main(): Promise<void> {\n  document.title = t(\"app.title\");\n  await openWorkspace(\"projects\");\n  renderMessages();\n}\n\nmain();\n", "crates/lexer/src/lib.rs": "// Tokeniza uma expressão aritmética.\npub fn tokenize(src: &str) -> Vec<Token> {\n    let mut tokens = Vec::new();\n    let mut chars = src.chars().peekable();\n    for c in chars {\n        if c.is_ascii_digit() {\n            tokens.push(Token::Num(c));\n        }\n    }\n    if chars.peek().is_none() {\n        tokens.push(Token::Eof);\n    }\n    tokens\n}\n\n#[derive(Debug, PartialEq)]\npub enum Token {\n    Num(char),\n    Eof,\n}\n", "crates/store/src/lib.rs": "// Camada de persistência (ADR-002): só este crate fala com o SQLite.\npub mod workspaces;\n\npub type Result<T> = std::result::Result<T, StoreError>;\n\n#[derive(Debug)]\npub enum StoreError {\n    Sqlite(rusqlite::Error),\n    NotFound,\n}\n", "crates/store/src/workspaces.rs": "use crate::Result;\nuse rusqlite::{params, Connection};\n\npub struct Workspace {\n    pub id: String,\n    pub name: String,\n    pub created_at: i64,\n}\n\npub fn insert(conn: &Connection, w: &Workspace) -> Result<()> {\n    conn.execute(\n        \"INSERT INTO workspaces (id, name, created_at) VALUES (?1, ?2, ?3)\",\n        params![w.id, w.name, w.created_at],\n    )?;\n    Ok(())\n}\n", ".dxtutor/regras.md": "# Regras do Co-Dev neste projecto\n\n1. Ler os ADRs e o Design System antes de propor uma solução.\n2. Não quebrar a API pública de um crate sem perguntar ao humano.\n3. Toda a alteração de esquema entra como migração nova em `db/migrations`.\n4. Nenhuma cor fixa na UI: usar sempre tokens (`var(--…)`).\n5. Código novo só é entregue com testes a passar e auto-avaliação ≥ limiar.\n6. `git push` e acções destrutivas exigem sempre aprovação humana.\n7. Se a confiança numa decisão for baixa, escolher a opção reversível e assinalar o pressuposto.\n", ".dxtutor/padroes.md": "# Padrões de projecto adoptados\n\n1. **Camadas** — ver ADR-002.\n2. **Repository** — acesso a dados atrás de um `trait`; a implementação SQLite é um detalhe.\n3. **Command** — cada acção da UI é um comando Tauri com entrada e saída tipadas.\n4. **Strategy** — provedores de LLM implementam o mesmo `trait ModelProvider`.\n5. **Observer** — a UI subscreve eventos do agente (plano, ferramenta, avaliação).\n", ".dxtutor/design-system.md": "# Design System\n\n## Tokens\n- Cor: `--bg-base`, `--bg-editor`, `--accent`, `--accent-hover` (ver `desktop/src/styles.css`)\n- Raio: `--radius`\n- Nunca usar valores hexadecimais fora da definição dos tokens.\n\n## Componentes\n- Listas e históricos vivem em **secções do painel lateral**, não em modais.\n- Acção primária: um único botão com `--accent` por vista.\n- Estados: vazio, a carregar, erro — sempre os três.\n", ".dxtutor/requisitos.md": "# Requisitos (backlog vivo)\n\n## RF-01 · Editor e navegação\nComo programador quero abrir, editar e procurar ficheiros sem sair do teclado.\n\n## RF-02 · Co-Dev multi-modelo\nComo programador quero escolher entre Claude, Gemini, Codex e Ollama local por papel.\n\n## RF-03 · Histórico de conversas\nComo programador quero retomar conversas anteriores do Co-Dev por workspace.\n- CA1: as conversas ficam guardadas depois de fechar a aplicação.\n- CA2: a lista mostra primeiro as mais recentes.\n- CA3: apagar um workspace apaga as suas conversas.\n\n## RNF-01 · Local-first\nOs dados do utilizador ficam na máquina; nada sai sem consentimento.\n", ".dxtutor/base-de-dados.md": "# Base de dados\n\n- Motor: SQLite (ficheiro por instalação), acesso via `rusqlite`.\n- Chaves: `TEXT` (ULID). Datas: `INTEGER` (epoch ms).\n- Integridade: chaves estrangeiras com `ON DELETE CASCADE` quando o filho não vive sem o pai.\n- Desempenho: toda a listagem ordenada precisa de um índice que cubra o filtro e a ordenação.\n- Migrações: ficheiros numerados, só para a frente, nunca editar uma migração aplicada.\n", ".dxtutor/arquitectura/ADR-001-local-first.md": "# ADR-001 · Local-first\n\n**Estado:** aceite\n\n**Decisão:** os dados do utilizador (workspaces, conversas, definições) são guardados\nlocalmente em SQLite. Serviços remotos são opcionais e nunca a fonte de verdade.\n\n**Consequências:** funciona offline; sincronização é uma funcionalidade futura, não um requisito.\n", ".dxtutor/arquitectura/ADR-002-camadas.md": "# ADR-002 · Camadas\n\n**Estado:** aceite\n\n**Decisão:** UI (`desktop/`) → comandos Tauri → crates de domínio → `crates/store`.\nSó o crate `store` contém SQL. A UI nunca acede à base de dados directamente.\n\n**Consequências:** a persistência pode mudar sem tocar na interface; testes do `store` não precisam de UI.\n", "db/migrations/0001_init.sql": "-- 0001 · esquema inicial\nCREATE TABLE workspaces (\n  id         TEXT PRIMARY KEY,\n  name       TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\n"}, "gen": {"conversations.rs": "// Repository (padroes.md §2): quem consome depende do trait, não do SQLite.\nuse crate::Result;\nuse rusqlite::{params, Connection};\n\npub struct Conversation {\n    pub id: String,\n    pub workspace_id: String,\n    pub title: String,\n    pub created_at: i64,\n}\n\npub trait ConversationRepo {\n    fn save(&self, c: &Conversation) -> Result<()>;\n    fn list_recent(&self, workspace_id: &str, limit: u32) -> Result<Vec<Conversation>>;\n}\n\npub struct SqliteConversationRepo {\n    pub conn: Connection,\n}\n\nimpl ConversationRepo for SqliteConversationRepo {\n    fn save(&self, c: &Conversation) -> Result<()> {\n        self.conn.execute(\n            \"INSERT INTO conversations (id, workspace_id, title, created_at) VALUES (?1, ?2, ?3, ?4)\",\n            params![c.id, c.workspace_id, c.title, c.created_at],\n        )?;\n        Ok(())\n    }\n\n    fn list_recent(&self, workspace_id: &str, limit: u32) -> Result<Vec<Conversation>> {\n        let mut stmt = self.conn.prepare(\n            \"SELECT id, workspace_id, title, created_at FROM conversations WHERE workspace_id = ?1 LIMIT ?2\",\n        )?;\n        let rows = stmt.query_map(params![workspace_id, limit], Conversation::from_row)?;\n        rows.collect()\n    }\n}\n", "history.ts": "// Secção «Histórico» do painel Co-Dev.\n// Só fala com o comando Tauri — nunca com a base de dados (ADR-002).\nimport { invoke } from \"@tauri-apps/api/core\";\n\nexport async function renderHistory(host: HTMLElement, workspaceId: string): Promise<void> {\n  const items = await invoke<Conversation[]>(\"conversations_list_recent\", { workspaceId, limit: 20 });\n  if (!items.length) {\n    host.textContent = \"Ainda não há conversas neste workspace.\";\n    return;\n  }\n  host.innerHTML = items\n    .map((c) => `<button class=\"hist-row\" data-id=\"${c.id}\">${c.title}<\/button>`)\n    .join(\"\");\n  host.style.borderLeft = \"2px solid #ff6600\";\n}\n", "0002_conversations.sql": "-- 0002 · histórico de conversas do Co-Dev (ADR-003)\nCREATE TABLE conversations (\n  id           TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n  title        TEXT NOT NULL,\n  created_at   INTEGER NOT NULL\n);\n\nCREATE TABLE messages (\n  id              TEXT PRIMARY KEY,\n  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,\n  role            TEXT NOT NULL,\n  content         TEXT NOT NULL,\n  created_at      INTEGER NOT NULL\n);\n", "ADR-003-historico.md": "# ADR-003 · Histórico de conversas\n\n**Estado:** aceite (proposto pelo Co-Dev, aprovado pelo humano na entrega)\n\n**Contexto:** RF-03 pede conversas persistentes por workspace.\n\n**Decisão:** tabelas `conversations` e `messages` em SQLite (ADR-001), acedidas\natravés do `trait ConversationRepo` no crate `store` (ADR-002, padrão Repository).\nA UI lista-as numa secção do painel lateral (Design System).\n\n**Alternativas rejeitadas:** SQL directo na UI (viola ADR-002); Postgres gerido\n(viola ADR-001); ficheiro JSON (sem integridade referencial nem ordenação indexada).\n\n**Pressuposto a rever:** retenção de 90 dias, configurável.\n", "conversations_test.rs": "use store::conversations::*;\n\n#[test]\nfn save_and_load_roundtrip() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"Primeira\", 10)).unwrap();\n    assert_eq!(repo.list_recent(\"ws1\", 10).unwrap().len(), 1);\n}\n\n#[test]\nfn list_recent_orders_by_newest() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"Antiga\", 10)).unwrap();\n    repo.save(&conv(\"c2\", \"ws1\", \"Recente\", 20)).unwrap();\n    assert_eq!(repo.list_recent(\"ws1\", 10).unwrap()[0].id, \"c2\");\n}\n\n#[test]\nfn cascade_delete_messages() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"A apagar\", 10)).unwrap();\n    delete_workspace(&repo.conn, \"ws1\").unwrap();\n    assert!(repo.list_recent(\"ws1\", 10).unwrap().is_empty());\n}\n"}};
/* COURSES (conteúdo dos cursos) migrado p/ features/learn.ts */
/* ═════════ dxtutor IDE v2 — núcleo do IDE ═════════ */
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const hhmm=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes());};
const LS={get(k,d){try{const v=localStorage.getItem('dx2.'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem('dx2.'+k,JSON.stringify(v));}catch(e){}}};
const setVar=(k,v)=>document.body.style.setProperty(k,v);
const getVar=k=>getComputedStyle(document.body).getPropertyValue(k).trim();
function hydrate(){$$('[data-ic]').forEach(el=>{if(el.dataset.done)return;el.insertAdjacentHTML('afterbegin',svg(el.dataset.ic));el.dataset.done=1;});}

/* ───── sistema de ficheiros virtual ───── */
const ROOT='dxtutor/',FS={},OPEN=new Set(['dxtutor','dxtutor/crates','dxtutor/crates/lexer','dxtutor/crates/lexer/src','dxtutor/desktop','dxtutor/desktop/src']),SECOPEN={};
/* estado git/scm (STAGED/BRANCH/COMMIT_MSG/BRANCHES/COMMITS/AUTHOR/GSEL) migrado p/ features/scm.ts; lido aqui por global */
const extOf=p=>(p.includes('.')?p.split('.').pop():'').toLowerCase();
const LANG={rs:'Rust',ts:'TypeScript',css:'CSS',json:'JSON',toml:'TOML',md:'Markdown',sql:'SQL',html:'HTML'};
function fIcon(p){const e=extOf(p);return `<span class="ic x-${e}">${svg(e==='rs'?'rust':e==='md'?'book':e==='sql'?'volume':'file')}</span>`;}
/* stOf/changes (estado da árvore de trabalho) migrados p/ features/scm.ts; lidos por global */
const short=p=>p.replace(ROOT,'');
const norm=p=>{p=String(p||'').replace(/^\.?\//,'');return p.startsWith(ROOT)?p:ROOT+p;};
function writeFile(p,content){if(FS[p])FS[p].content=content;else{FS[p]={content,orig:null};let d=p.split('/');d.pop();while(d.length){OPEN.add(d.join('/'));d.pop();}}refresh();}
window.syncTree = function(){const mk=dp=>({dir:1,children:{},dpath:dp}),root=mk('dxtutor');
  Object.keys(FS).forEach(p=>{const parts=p.split('/').slice(1);let n=root,acc='dxtutor';parts.forEach((s,i)=>{if(i===parts.length-1)n.children[s]={path:p};else{acc+='/'+s;n=n.children[s]||(n.children[s]=mk(acc));}});});
  const sort=n=>{const o={};Object.keys(n.children).sort((a,b)=>(!!n.children[b].dir-!!n.children[a].dir)||a.localeCompare(b)).forEach(k=>{o[k]=n.children[k];if(o[k].dir)sort(o[k]);});n.children=o;};sort(root);
  TREE.projects.children.dxtutor=root;}

/* ───── explorer ───── */
/* 8 funções (renderLevel/buildExplorer/markActive/collapseAll/symbols/drawOutline/newFile/newFolder) migradas p/ features/explorer.ts; lidas por global (window.*) aqui (refresh/show), em boot.ts e v6.ts (symbols) */
/* drawTimeline$dup0 morto removido (o drawTimeline vivo foi p/ features/scm.ts) */

/* ───── realce de sintaxe ───── */
/* KW + hlLine (realce de uma linha) migrados p/ features/syntax.ts; lidos por global (window.hlLine) em paintEd/diff/cat/outline e em v5.ts/v6.ts */

/* ───── diagnósticos, lint e testes (derivados do estado real dos ficheiros) ───── */
const P_LX=ROOT+'crates/lexer/src/lib.rs',P_REPO=ROOT+'crates/store/src/conversations.rs',P_MIG=ROOT+'db/migrations/0002_conversations.sql',P_TEST=ROOT+'crates/store/tests/conversations_test.rs',P_HIST=ROOT+'desktop/src/history.ts',P_ADR=ROOT+'.dxtutor/arquitectura/ADR-003-historico.md',P_STORE=ROOT+'crates/store/src/lib.rs';
/* motor has/lexBug/dsLint/diagnostics/runTests/drawProblems/nextProblem migrado p/ features/diagnostics.ts; lido por global (P_* ficam donas aqui) */

/* ───── separadores e vistas ───── */
let TB=[];window.cur=null;window.PANE='explorer';const VIEW={};
const tabOf=id=>TB.find(o=>o.id===id);
function openTab(t,act){let x=tabOf(t.id);if(x)Object.assign(x,t);else TB.push(t);if(act===false)drawTabs();else show(t.id);}
function openPath(p,line){if(!FS[p]){toast('Ficheiro não existe: '+short(p));return;}openTab({id:p,title:p.split('/').pop(),kind:'file',path:p});if(line)gotoLine(line);}
function openFile(name){const p=Object.keys(FS).find(k=>k.endsWith('/'+name));if(p)openPath(p);}
function setActive(id){if(tabOf(id))show(id);}
function drawTabs(){const host=$('#tabs');host.innerHTML='';TB.forEach(t=>{const el=document.createElement('div');el.className='tab'+(t.id===cur?' active':'');el.title=t.path?short(t.path):t.title;
  const dup=t.path&&TB.some(o=>o!==t&&o.kind==='file'&&o.title===t.title);el.innerHTML=`${tabIc(t)}<span class="nm">${esc(t.title)}${dup?` <span style="color:var(--fg-muted)">${esc(t.path.split('/').slice(-3,-2)[0]||'')}</span>`:''}</span><button class="x">${svg('close')}</button>`;
  el.onclick=e=>{if(e.target.closest('.x')){e.stopPropagation();closeTab(t.id);return;}show(t.id);};el.onauxclick=e=>{if(e.button===1)closeTab(t.id);};host.appendChild(el);});
  const a=host.querySelector('.active');if(a&&a.scrollIntoView)a.scrollIntoView({block:'nearest',inline:'nearest'});}
function parkAgent(){const b=$('#ag-body');if(b.parentElement.id!=='agent')$('#agent').appendChild(b);}
function miniOff(){$('#minimap').classList.add('hidden');$('#ebody').classList.remove('with-mm');}
window.show = function(id){const t=tabOf(id),host=$('#ebody');parkAgent();host.innerHTML='';host.scrollTop=0;host.scrollLeft=0;
  if(!t){cur=null;drawTabs();miniOff();$('#breadcrumbs').innerHTML='';host.innerHTML=`<div class="empty"><div><b style="color:var(--fg-dim);font-size:14px">dxtutor IDE</b><br><kbd>Ctrl+P</kbd> ir para ficheiro &nbsp; <kbd>Ctrl+Shift+P</kbd> comandos<br><kbd>Ctrl+L</kbd> falar com o Co-Dev &nbsp; <kbd>Ctrl+\`</kbd> terminal</div></div>`;drawOutline();stLang();return;}
  cur=id;drawTabs();
  $('#breadcrumbs').innerHTML=(t.path?t.path.split('/'):['dxtutor',t.title]).map((s,i,a)=>`<span class="crumb"${i===a.length-1?' style="color:var(--fg)"':''}>${esc(s)}</span>`).join('<span class="sep">›</span>');
  if(t.kind!=='file')miniOff();VIEW[t.kind](t,host);hydrate();drawOutline();markActive();stLang();ctxPill();}
function closeTab(id){const i=TB.findIndex(t=>t.id===id);if(i<0)return;const t=TB[i];TB.splice(i,1);
  if(t.kind==='agent'){parkAgent();setVar('--agent-w','380px');$('#tgl-agent').classList.add('on');}
  if(cur===id)show(TB.length?TB[Math.max(0,i-1)].id:null);else drawTabs();}
function stepTab(d){if(!TB.length)return;const i=TB.findIndex(t=>t.id===cur);show(TB[(i+d+TB.length)%TB.length].id);}

/* editor: renderFileView/paintEd/gotoLine/stPos/stLang/edCmd/selText migrados p/ features/editor.ts; lidos por global, pane delega no shim abaixo */
VIEW.file=(t,host)=>window.renderFileView(t,host);

/* diff: diffLines/diffStat/openDiff + corpo de VIEW.diff migrados p/ features/diff.ts; lidos por global, pane delega no shim abaixo */
VIEW.diff=(t,host)=>window.renderDiffView(t,host);

/* ───── actualização global ───── */
let SIG='';
window.refresh = function(fromEd,force){const sig=Object.keys(FS).map(p=>p+stOf(p)).join('|');
  TB.filter(t=>t.kind==='file'&&!FS[t.path]).forEach(t=>{TB.splice(TB.indexOf(t),1);if(cur===t.id)cur=null;});
  if(sig!==SIG||force){SIG=sig;syncTree();buildExplorer();}
  drawProblems();badges();if(RP[PANE]&&PANE!=='search')RP[PANE]();hydrate();
  if(!fromEd){const t=tabOf(cur);if(!t)show(TB.length?TB[TB.length-1].id:null);else if(t.kind==='file'){const ta=$('#ed-ta'),top=$('#ebody').scrollTop;if(ta&&ta.value!==FS[t.path].content){ta.value=FS[t.path].content;}if(ta){paintEd(t.path);$('#ebody').scrollTop=top;}drawTabs();}else if(t.kind==='diff'||t.kind==='manager'){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}else drawTabs();}
  else if(tabOf(cur)&&tabOf(cur).kind==='file')paintEd(tabOf(cur).path);drawOutline();
  /* U3c (ADR-0004): o fim do refresh é o sinal «o workspace mudou» — quem reagia
     decorando o refresh (grafo/board, autosave do desktop, sync do PairCode) subscreve */
  bus.emit('workspace:changed',{fromEditor:!!fromEd,force:!!force});}
window.badges = function(){const set=(p,v)=>{const b=$(`.act[data-pane="${p}"] .badge`);if(b){b.textContent=v;b.style.display=v?'grid':'none';}};set('scm',changes().length||'');set('codev',typeof RUN!=='undefined'&&RUN.active?'●':'');}

/* ───── activity bar e painéis laterais ───── */
const RP={};
const sideOpen=()=>getVar('--side-w')!=='0px';
function setPane(p,tgl){if(p==='settings'){openSettings();return;}if(tgl===true&&PANE===p&&sideOpen()){toggleSide();return;}if(!sideOpen())toggleSide();PANE=p;
  $$('.act').forEach(a=>a.classList.toggle('on',a.dataset.pane===p));$$('.pane').forEach(x=>x.classList.remove('show'));const pe=$('#pane-'+p);if(pe)pe.classList.add('show');if(RP[p])RP[p]();hydrate();}
const goPane=p=>setPane(p);
function toggleSide(){const o=sideOpen();setVar('--side-w',o?'0px':'250px');$('#tgl-side').classList.toggle('on',!o);}
function togglePanel(){const o=getVar('--panel-h')!=='0px';setVar('--panel-h',o?'0px':'230px');$('#tgl-panel').classList.toggle('on',!o);}
const hd=(t,acts)=>`<div class="side-hd"><span class="t">${t}</span><span class="acts">${acts||''}</span></div>`;

RP.search=()=>window.renderSearchPane();/* corpo + leaves doSearch/replaceAll migrados p/ features/search.ts; shim delega (lazy, no switch de pane) */

RP.scm=()=>{const el=$('#pane-scm'),ch=changes(),st=ch.filter(p=>STAGED.has(p)),un=ch.filter(p=>!STAGED.has(p));
  const row=(p,staged)=>`<div class="scm-row" onclick="openDiff(${jsa(p)})">${fIcon(p)}<span class="nm">${esc(p.split('/').pop())}</span><span class="pth">${esc(short(p).split('/').slice(0,-1).join('/'))}</span><span class="ra"><button title="Abrir ficheiro" onclick="event.stopPropagation();openPath(${jsa(p)})">↗</button><button title="Descartar alterações" onclick="event.stopPropagation();discard(${jsa(p)})">↶</button><button title="${staged?'Retirar do stage':'Stage'}" onclick="event.stopPropagation();stage(${jsa(p)})">${staged?'−':'+'}</button></span><span class="g ${stOf(p)}">${stOf(p)}</span></div>`;
  el.innerHTML=hd('Source Control',`<button title="Actualizar" onclick="refresh()">${svg('refresh')}</button>`)+`<div class="sections"><div class="scm-grp">dxtutor · ${esc(BRANCH)}<span class="cnt">${ch.length}</span></div>
    <input class="inp" id="scm-msg" placeholder="Mensagem de commit" value="${esc(COMMIT_MSG)}"><button class="btn" onclick="commit()">✓ Commit${st.length?' (staged)':''} em ${esc(BRANCH)}</button>
    ${st.length?`<div class="scm-grp">Staged<span class="cnt">${st.length}</span></div>`+st.map(p=>row(p,1)).join(''):''}
    <div class="scm-grp">Alterações<span class="cnt">${un.length}</span></div>${un.map(p=>row(p,0)).join('')||'<div class="sec-empty">Área de trabalho limpa.</div>'}
    <div class="scm-grp">Commits</div>${COMMITS.slice(0,6).map(c=>`<div class="s-hit" style="padding-left:12px;cursor:default"><span style="color:var(--accent-hover)">${c.h}</span><span>${esc(c.m)}</span></div>`).join('')}</div>`;
  const i=$('#scm-msg');i.oninput=()=>COMMIT_MSG=i.value;i.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))commit();};};
/* stage/discard + commit v2 (window.commit, botão) migrados p/ features/scm.ts; pickBranch$dup0 morto removido */

RP.run=()=>window.renderRunPane();/* corpo migrado p/ features/run.ts; shim delega (lazy, no switch de pane) */
function runTask(c){setPanelTab('terminal');return termExec(c);}
RP.test=()=>window.renderTestPane();/* corpo migrado p/ features/test.ts; shim delega (lazy, no switch de pane) */
RP.ext=()=>{$('#pane-ext').innerHTML=hd('Extensions')+`<div class="sections"><div class="scm-grp">Provedores de LLM<span class="cnt">${Object.values(PROV).filter(p=>p.on).length}/4</span></div>${Object.entries(PROV).map(([k,p])=>`<div class="scm-row" onclick="toggleProv(${jsa(k)})"><span class="pdot${p.on?'':' off'}" style="background:${p.col}"></span><span class="nm">${p.name}</span><span class="pth">${p.vendor}</span><span class="sw${p.on?' on':''}" style="margin-left:auto"></span></div>`).join('')}
  <div class="scm-grp">Linguagem e qualidade<span class="cnt">4</span></div>${[['rust','rust-analyzer','diagnósticos Rust'],['shield','Design System Lint','dx lint'],['test','Test Explorer','cargo test'],['check','Spell Checker','pt-AO (pré-AO90)']].map(e=>`<div class="scm-row" style="cursor:default"><span class="ic">${svg(e[0])}</span><span class="nm">${e[1]}</span><span class="pth">${e[2]}</span></div>`).join('')}<button class="btn ghost" onclick="openSettings()">Configurar provedores…</button></div>`;};
RP.remote=()=>window.renderRemotePane();/* corpo migrado p/ features/remote.ts; shim delega (lazy, no switch de pane) */
RP.account=()=>window.renderAccountPane();/* corpo migrado p/ features/account.ts; shim delega (lazy, no switch de pane) */
RP.codev=()=>window.renderCodevPane();/* base v3 + decoração v4 migradas p/ features/codev.ts; shim delega (lazy, no switch de pane) */

/* ───── painel inferior ───── */
function log(src,msg){const o=$('#pc-output');o.insertAdjacentHTML('beforeend',`<div>[${hhmm()}] <span class="r">${esc(src)}</span> ${esc(msg)}</div>`);o.scrollTop=o.scrollHeight;}

/* ───── terminal (comandos ligados ao estado real) ───── */
// promptHTML/newInput/termRefreshPrompt/termExec + o registo BASE XC (help/cat/git/cargo/
// npm/dx) migraram para src/features/terminal.ts (window-backed). A feature avalia ANTES
// de app.ts e publica window.XC COMPLETO; os decoradores abaixo (XC.git/_dx/XC.docker/
// XC.make/_dx4) e o de v5.ts resolvem `XC` como window.XC e sobrepõem/encadeiam o base.

/* ───── paleta de comandos / quick open ───── */
// PAL/PIDX/PITEMS/PAL_TEXT + palette/closePal/fuzzy/palDraw/palRun migraram para
// src/features/palette.ts (window-backed). O resíduo (boot/keydown abaixo) lê o
// estado e os handlers por window.PIDX/window.PITEMS/window.palDraw()/etc.

/* ───── temas ───── */
// THEMES/THEME/setTheme migrados para src/features/theme.ts (Fase 0 por feature);
// o residual (save/loadCfg/vistas/onclick) resolve-os via window (shim transitório).

/* ───── notificações ───── */
// NOTES/UNREAD/note/drawBell/toggleNotes migraram para src/features/notifications.ts
// (Fase 1). O residual (app.ts/v6.ts) emite via window.note e o sino via window.toggleNotes.

/* ═════════ dxtutor IDE v2 — Co-Dev ═════════ */
// cores em var(--token) do tema (theme.ts) em vez de hex fixo — mudam ao trocar de tema
const PROV={
  claude:{name:'Claude',vendor:'Anthropic',model:'claude-opus-5-5',ep:'https://api.anthropic.com',on:true,col:'var(--accent-hover)'},
  gemini:{name:'Gemini',vendor:'Google',model:'gemini-pro',ep:'https://generativelanguage.googleapis.com',on:true,col:'var(--blue)'},
  codex:{name:'Codex',vendor:'OpenAI',model:'gpt-codex',ep:'https://api.openai.com',on:true,col:'var(--green)'},
  ollama:{name:'Ollama',vendor:'local',model:'qwen2.5-coder:14b',ep:'http://localhost:11434',on:true,local:true,col:'var(--purple)'},
};
/* ROLE/ROLE_D/ROUTE/MODES/CRIT/MISSIONS/DECS/CKPT + SPEED/MID: motor Co-Dev migrado p/ features/codev.ts (window-backed); aqui lê-se por global. */
window.MODE='assist';window.ACTIVE='claude';window.THRESH=85;window.CTX_ON=true;window.SAMPLE=null;
const CHAT=[],USAGE={claude:{calls:0,tok:0},gemini:{calls:0,tok:0},codex:{calls:0,tok:0},ollama:{calls:0,tok:0}};
const COMMITS0=COMMITS.slice();
const RUN={active:false,paused:false,stop:false,pend:null,abort:null,label:'',t0:0};
const STOP='__STOP__',SAFE=/^(cargo (test|build|clippy)|dx lint|npm run lint)/,DANGER=/git push|rm -rf|drop table|--force/i;
const connected=()=>Object.keys(PROV).filter(k=>PROV[k].on);
const provFor=r=>PROV[ROUTE[r]].on?ROUTE[r]:(connected()[0]||ROUTE[r]);
const who=r=>`${ROLE[r].split(' ')[0].toLowerCase()} · ${PROV[provFor(r)].name.toLowerCase()}`;
window.provState=k=>k==='claude'?(SAMPLE?'ao vivo':'ao vivo indisponível aqui'):PROV[k].local?'local · simulado':'simulado';
const use=(p,tok)=>{USAGE[p].calls++;USAGE[p].tok+=tok;};
function save(){LS.set('cfg',{MODE,ACTIVE,THRESH,THEME,ROUTE,prov:Object.fromEntries(Object.entries(PROV).map(([k,p])=>[k,{on:p.on,model:p.model}]))});}
function loadCfg(){const c=LS.get('cfg',null);if(!c)return;if(MODES[c.MODE])MODE=c.MODE;if(PROV[c.ACTIVE])ACTIVE=c.ACTIVE;if(c.THRESH)THRESH=c.THRESH;if(THEMES[c.THEME])THEME=c.THEME;Object.keys(ROUTE).forEach(r=>{if(c.ROUTE&&PROV[c.ROUTE[r]])ROUTE[r]=c.ROUTE[r];});Object.keys(PROV).forEach(k=>{if(c.prov&&c.prov[k]){PROV[k].on=!!c.prov[k].on;if(c.prov[k].model)PROV[k].model=c.prov[k].model;}});}

/* checkpoints: checkpoint$dup0/restoreCkpt$dup0/resetAll$dup0 (duplicados mortos) removidos; o checkpoint git-aware vivo está na secção git (~629). */

/* interface do agente + controlo de execução + ferramentas do agente: motor migrado p/ features/codev.ts (window-backed). Fica aqui só setPanelTab (infra do painel inferior, partilhado por boot/debug/infra/pair). */
function setPanelTab(pt,nofocus){if(getVar('--panel-h')==='0px')togglePanel();$$('.ptab').forEach(b=>b.classList.toggle('on',b.dataset.pt===pt));$$('.pcontent').forEach(c=>c.classList.remove('show'));const el=$('#pc-'+pt);if(el)el.classList.add('show');if(pt==='terminal'){scrollTerm();if(!nofocus){const c=$('#cmd');if(c)c.focus({preventScroll:true});}}}

/* cenários de demonstração (G/lxStep/SCN/demo): migrados p/ features/codev.ts (SCN lazy, window.demo). */

/* motor de missões (dec/decideQ/total/council/execSteps/evaluate/reflect/runMission): migrado p/ features/codev.ts. */

/* conversa livre (handlePrompt/agSend/liveChat) + posicionamento (assistantCenter/Dock/toggleAgent/toggleAgentOn/focusAgent): migrados p/ features/codev.ts.
   VIEW.agent fica como shim (VIEW só nasce em app.ts): */
VIEW.agent=(t,host)=>window.renderAgentView(t,host);
/* páginas Co-Dev (welcome/settings/manager/analysis + openSettings/openManager/openAnalysis/testProv + POLICY/GAPS/NEXT): migradas p/ features/codev.ts.
   Os VIEW.* ficam shims (VIEW só nasce em app.ts): */
VIEW.welcome=(t,host)=>window.renderWelcomePage(t,host);
VIEW.settings=(t,host)=>window.renderSettingsPage(t,host);
VIEW.manager=(t,host)=>window.renderManagerPage(t,host);
VIEW.analysis=(t,host)=>window.renderChangelogPage(t,host);/* harvest ui-next: timeline git real (features/changelog.ts) no lugar da página estática */
/* ───── menus e comandos ───── */
const CMD=[
  ['Ir para ficheiro…','Ctrl+P',()=>palette('')],['Mostrar todos os comandos','Ctrl+Shift+P',()=>palette('>')],['Ir para a linha…','Ctrl+G',()=>palette(':')],['Ir para o próximo problema','F8',()=>nextProblem()],
  ['Ficheiro: Novo ficheiro…','',newFile],['Ficheiro: Nova pasta…','',newFolder],
  ['Ver: Explorer','Ctrl+Shift+E',()=>goPane('explorer')],['Ver: Pesquisa','Ctrl+Shift+F',()=>{goPane('search');$('#s-q').focus();}],['Ver: Source Control','Ctrl+Shift+G',()=>goPane('scm')],['Ver: Run and Debug','',()=>goPane('run')],['Ver: Testing','',()=>goPane('test')],['Ver: Extensions','',()=>goPane('ext')],
  ['Ver: Alternar barra lateral','Ctrl+B',toggleSide],['Ver: Alternar painel','Ctrl+J',togglePanel],['Ver: Terminal','Ctrl+`',()=>setPanelTab('terminal')],['Ver: Problemas','Ctrl+Shift+M',()=>setPanelTab('problems')],['Ver: Output do Co-Dev','',()=>setPanelTab('output')],
  ['Co-Dev: Focar a conversa','Ctrl+L',()=>focusAgent()],['Co-Dev: Abrir no centro','',()=>assistantCenter()],['Co-Dev: Painel de conhecimento','Ctrl+Shift+A',()=>goPane('codev')],['Co-Dev: Gestor de missões','',()=>openManager()],['Co-Dev: Nova conversa','',()=>newChat()],['Co-Dev: Escolher modelo…','',()=>pickModel()],
  ['Co-Dev: Modo Manual','',()=>setMode('manual')],['Co-Dev: Modo Assistido','',()=>setMode('assist')],['Co-Dev: Modo Auto','',()=>setMode('auto')],
  ['Co-Dev: Missão — histórico de conversas','',()=>demo('b')],['Co-Dev: Missão — corrigir E0382','',()=>demo('a')],['Co-Dev: Parar execução','',()=>agCtl('stop')],['Co-Dev: Restaurar último checkpoint','',()=>CKPT.length?restoreCkpt(CKPT[0].id):toast('Sem checkpoints')],
  ['Git: Commit…','',()=>{goPane('scm');$('#scm-msg').focus();}],['Git: Mudar de ramo…','',pickBranch],
  ['Tarefa: cargo test','',()=>runTask('cargo test')],['Tarefa: cargo build','',()=>runTask('cargo build')],['Tarefa: dx lint','',()=>runTask('dx lint')],
  ['Preferências: Definições','Ctrl+,',()=>openSettings()],...Object.keys(THEMES).map(n=>['Preferências: Tema — '+n,'',()=>setTheme(n)]),
  ['Ajuda: Bem-vindo','',()=>openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'})],['Ajuda: O que mudou e porquê','',()=>openAnalysis()],['Repor protótipo (estado inicial)','',resetAll]];
const cmd=l=>()=>CMD.find(c=>c[0]===l)[2]();
function buildMenus(){MENUS.length=0;MENUS.push(
  {t:'File',get items(){return[{l:'Novo ficheiro…',act:newFile},{l:'Nova pasta…',act:newFolder},{sep:1},{l:'Abrir ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Abrir recente',sub:Object.keys(FS).filter(p=>/\.(rs|ts|sql)$/.test(p)).slice(0,6).map(p=>({l:short(p),act:()=>openPath(p)}))},{sep:1},{l:'Guardar',k:'Ctrl+S',act:()=>toast('Auto Save activo — já está guardado')},{sep:1},{l:'Preferências',sub:[{l:'Definições',k:'Ctrl+,',act:openSettings},{l:'Tema',sub:Object.keys(THEMES).map(n=>({l:n,on:n===THEME,act:()=>setTheme(n)}))}]},{sep:1},{l:'Fechar separador',act:()=>cur&&closeTab(cur)},{l:'Repor protótipo',act:resetAll}];}},
  {t:'Edit',items:[{l:'Anular',k:'Ctrl+Z',act:()=>edCmd('undo')},{l:'Refazer',k:'Ctrl+Y',act:()=>edCmd('redo')},{sep:1},{l:'Procurar nos ficheiros',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Substituir nos ficheiros',act:()=>{goPane('search');$('#s-r').focus();}}]},
  {t:'Selection',items:[{l:'Seleccionar tudo',k:'Ctrl+A',act:()=>edCmd('selectAll')},{l:'Seleccionar linha',act:()=>edCmd('line')},{sep:1},{l:'Enviar selecção ao Co-Dev',act:()=>{const s=selText();if(!s){toast('Selecciona texto no editor primeiro');return;}focusAgent();const i=$('#ag-input');i.value='Sobre este excerto:\n'+s+'\n\n';i.focus();}}]},
  {t:'View',get items(){return[{l:'Paleta de comandos…',k:'Ctrl+Shift+P',act:()=>palette('>')},{sep:1},{l:'Explorer',k:'Ctrl+Shift+E',act:()=>goPane('explorer')},{l:'Pesquisa',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Source Control',k:'Ctrl+Shift+G',act:()=>goPane('scm')},{l:'Testing',act:()=>goPane('test')},{l:'Co-Dev',k:'Ctrl+Shift+A',act:()=>goPane('codev')},{sep:1},{l:'Barra lateral',k:'Ctrl+B',on:sideOpen(),act:toggleSide},{l:'Painel inferior',k:'Ctrl+J',on:getVar('--panel-h')!=='0px',act:togglePanel},{l:'Painel do Co-Dev',on:getVar('--agent-w')!=='0px'||!!tabOf('agent'),act:toggleAgent},{sep:1},{l:'Terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Problemas',k:'Ctrl+Shift+M',act:()=>setPanelTab('problems')},{l:'Output do Co-Dev',act:()=>setPanelTab('output')}];}},
  {t:'Go',items:[{l:'Ir para ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Ir para a linha…',k:'Ctrl+G',act:()=>palette(':')},{l:'Próximo problema',k:'F8',act:()=>nextProblem()},{sep:1},{l:'Separador seguinte',act:()=>stepTab(1)},{l:'Separador anterior',act:()=>stepTab(-1)}]},
  {t:'Run',items:[{l:'cargo build',act:()=>runTask('cargo build')},{l:'cargo test',act:()=>runTask('cargo test')},{l:'dx lint',act:()=>runTask('dx lint')},{l:'npm run dev',act:()=>runTask('npm run dev')}]},
  {t:'Co-Dev',get items(){return[{l:'Focar a conversa',k:'Ctrl+L',act:()=>focusAgent()},{l:'Nova conversa',act:newChat},{l:'Escolher modelo…',act:pickModel},{sep:1},...Object.entries(MODES).map(([k,m])=>({l:'Modo '+m.l,on:k===MODE,act:()=>setMode(k)})),{sep:1},{l:'Missões de demonstração',sub:[{l:'Histórico de conversas persistente',act:()=>demo('b')},{l:'Corrigir o E0382 em lib.rs',act:()=>demo('a')}]},{l:'Gestor de missões',act:openManager},{l:'Conhecimento do projecto',act:()=>goPane('codev')},{l:'Definições do Co-Dev',act:openSettings}];}},
  {t:'Terminal',items:[{l:'Mostrar terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Limpar',act:()=>termClear()}]},
  {t:'Help',items:[{l:'Bem-vindo',act:cmd('Ajuda: Bem-vindo')},{l:'O que mudou e porquê',act:openAnalysis},{l:'Atalhos de teclado',act:openSettings},{sep:1},{l:'Sobre',act:()=>toast('dxtutor IDE · protótipo v2')}]});}

/* ───── arranque ───── */
function boot(){loadCfg();loadSeed();syncTree();
  ACTS.length=0;ACTS.push({ic:'explorer',pane:'explorer',title:'Explorer'},{ic:'search',pane:'search',title:'Pesquisa'},{ic:'scm',pane:'scm',title:'Source Control'},{ic:'run',pane:'run',title:'Run and Debug'},{ic:'test',pane:'test',title:'Testing'},{ic:'ext',pane:'ext',title:'Extensions'},{ic:'sparkle',pane:'codev',title:'Co-Dev',acc:1},{ic:'dots',overflow:1,title:'Mais vistas…',spacer:1},{ic:'account',pane:'account',title:'Conta'},{ic:'settings',pane:'settings',title:'Definições'});
  OVERFLOW.length=0;OVERFLOW.push({l:'Remote Explorer',pane:'remote'},{l:'Containers',pane:'containers'});
  $('#brand').innerHTML=svg('sparkle');buildMenus();buildMenubar();buildActivity();buildDocker();$('.act').classList.add('on');
  $$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt));
  mkRz($('#rsz-side'),'--side-w',250,170,460);mkRz($('#rsz-agent'),'--agent-w',380,300,640,true);
  const pi=$('#pal-in');pi.oninput=()=>{window.PIDX=0;window.palDraw();};pi.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();window.PIDX=Math.min(window.PITEMS.length-1,window.PIDX+1);window.palDraw();}else if(e.key==='ArrowUp'){e.preventDefault();window.PIDX=Math.max(0,window.PIDX-1);window.palDraw();}else if(e.key==='Enter'){e.preventDefault();window.palRun(window.PIDX);}};
  $('#pal').onclick=e=>{const it=e.target.closest('.pi');if(it)window.palRun(+it.dataset.i);else if(!e.target.closest('.pal-box'))window.closePal();};
  /* teclado do #ag-input: dono agora o compositor (features/codev/ui/composer.ts) */
  $('#pc-terminal').onclick=()=>{if(!String(getSelection())){const c=$('#cmd');if(c)c.focus({preventScroll:true});}};
  $('#pc-output').innerHTML='';log('rust-analyzer','2 crates indexados');log('co-dev','pronto · '+connected().length+' provedores ligados');
  termClear();tick();setInterval(()=>{tick();runLabel();},1000);
  newChat();setTheme(THEME);
  TB=[{id:'welcome',title:'Bem-vindo',kind:'welcome'},{id:P_LX,title:'lib.rs',kind:'file',path:P_LX}];refresh(false,true);show('welcome');
  if(innerWidth<1000){setVar('--side-w','0px');}else $('#tgl-side').classList.add('on');$('#tgl-panel').classList.add('on');
  if(innerWidth<860){setVar('--panel-h','0px');$('#tgl-panel').classList.remove('on');assistantCenter();}
  hydrate();if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  let tries=0;(function live(){if(window.claude&&typeof window.claude.use==='function'){window.claude.use('sample').then(s=>{SAMPLE=s||null;updateAgentUI();const t=tabOf(cur);if(t&&t.kind==='settings')show(cur);if(RP[PANE])RP[PANE]();}).catch(()=>{});}else if(++tries<25)setTimeout(live,300);})();}
document.addEventListener('keydown',e=>{const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey,go=f=>{e.preventDefault();f();};
  if(window.termOwnsKey&&window.termOwnsKey(e))return;/* foco num terminal real (features/panel): a tecla é da shell */
  if(e.key==='Escape'){if($('#pal').classList.contains('show'))window.closePal();closeMenus();$('#notes').classList.remove('show');return;}
  if(e.key==='F1'||(c&&e.shiftKey&&k==='p'))go(()=>palette('>'));else if(e.key==='F8')go(nextProblem);
  else if(c&&e.shiftKey){if(k==='e')go(()=>goPane('explorer'));else if(k==='f')go(cmd('Ver: Pesquisa'));else if(k==='g')go(()=>goPane('scm'));else if(k==='m')go(()=>setPanelTab('problems'));else if(k==='a')go(()=>goPane('codev'));}
  else if(c){if(k==='p')go(()=>palette(''));else if(k==='b')go(toggleSide);else if(k==='j')go(togglePanel);else if(k==='`')go(()=>setPanelTab('terminal'));else if(k===',')go(openSettings);else if(k==='l')go(()=>focusAgent());else if(k==='g')go(()=>palette(':'));else if(k==='s')go(()=>toast('Auto Save activo — já está guardado'));}
},true);
document.addEventListener('click',e=>{if(!e.target.closest('#notes')&&!e.target.closest('#st-bell'))$('#notes').classList.remove('show');});

/* ═════════ dxtutor IDE v3 — git em grafo, gitflow, equipa com harness, router de modelos, Studio, backlog/kanban, Tutor ═════════ */
const slug=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pascal=s=>slug(s).split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join('');
const rel=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'agora':m<60?`há ${m} min`:m<1440?`há ${Math.round(m/60)} h`:`há ${Math.round(m/1440)} d`;};
const rid=()=>Math.random().toString(16).slice(2,9);
function rerender(kind){const t=tabOf(cur);if(t&&t.kind===kind){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}}

/* ───── git: motor (GIT/LANE/gitInit + DAG/merge/gitflow/graphLayout) migrado p/ features/scm.ts; checkpoint/restoreCkpt/gfAsk migrados p/ features/checkpoint.ts; aqui só consumidor (loadSeed) que lê por global ───── */
function loadSeed(){Object.keys(FS).forEach(k=>delete FS[k]);STAGED.clear();
  if(SEED_ON){Object.entries(SEED.base).forEach(([p,c])=>{FS[ROOT+p]={content:c,orig:c};});
  const s=FS[ROOT+'desktop/src/styles.css'];s.orig=s.content.replace('  --accent-hover: #f08a4b;\n','');const a=FS[ROOT+'desktop/src/assistant.ts'];a.orig=a.content.replace(/\n\/\/ v2[\s\S]*$/,'\n');
  FS[ROOT+'desktop/src/theme.css'].orig=null;}
  gitInit();}
/* authorOf + AUTHOR + commit v4 (window.commitGit) migrados p/ features/scm.ts; lidos por global (AUTHOR é window-puro, escrito aqui em runIssue/co-dev) */
/* checkout/gitMerge/isFlow/gfStart/gfFinish/gfPrompt/gfGuide/pickBranch/drawTimeline migrados p/ features/scm.ts; lidos por global */
RP.scm=()=>window.renderScmPane();/* corpo v4 migrado p/ features/scm.ts; shim delega (lazy, no switch de pane) */
/* graphLayout/openGraph migrados p/ features/scm.ts; VIEW.graph (abaixo) consome-os por global */
VIEW.graph=(t,host)=>window.renderGraphView(t,host);/* corpo (DAG de commits) migrado p/ features/graph.ts; shim delega (registo de kinds de tab) */
/* corpo (sub-comandos status/add/commit/log/branch/checkout/merge/flow/diff/push) migrado p/ features/termgit.ts; shim delega (registo XC de features/terminal.ts) */
XC.git=(a,raw)=>window.gitCmd(a,raw);
/* checkpoint/restoreCkpt/gfAsk migrados p/ features/checkpoint.ts (strict, window-backed); aqui lidos por global (CMD acima, codev.ts). */

/* ───── equipa: motor (AGENTS/globRe/inScope/canRun/ownerOf/harnessCheck/harnessCmd/agentSys/
   saveTeam/loadTeam/pickAgent/agentPill/scopeProbe + VIEW.team) migrado p/ features/team.ts
   (inversão @ts-nocheck, window-backed). Aqui ficam: openTeam (abrir tab — $dup0; versão viva
   em v5.ts), a decoração Object.assign(AGENTS.*) abaixo, e o shim VIEW.team que v5/v6 decoram. ───── */
VIEW.team=(t,host)=>window.renderTeamView(t,host);

/* ───── router: motor (CAPL/CAP/TASKP/ROUTE_CACHE/LIVE_OK/rankModels/routeModel) migrado p/ features/router.ts; aqui só consumidores (VIEW.team, genBacklog, runIssue) que lêem por global ───── */

/* ───── Studio: estado + motor de desenho (NT/ST_SEED/SD/SSEL/SLINK/SCAT/NW/NH/saveSD/openStudio/sdAdd/sdDel/drawStudio) migrado p/ features/studio.ts ───── */

/* ───── backlog, sprints e kanban: estado (BL/STAGES) + motor (mkIssue/setStage/
   runIssue/delegate/runSprint/approveIssue/autoTest/dropIssue/rejectIssue/newIssue/
   openBoard) + produtor (genBacklog/genBacklogIssues) migrados p/ features/board.ts;
   tplNode + genBacklog$dup0 (código morto) eliminados. Aqui só o shim de VIEW.board
   (eager; v5/v6 decoram-no) e os decoradores/consumidores que lêem por global. ───── */
VIEW.board=(t,host)=>window.renderBoardView(t,host);

/* ───── Tutor (clássico): percursos LEARN/LP/lesson·/VIEW.learn/RP.tutor(v4) ELIMINADOS —
   código morto substituído pelo Learning Track (features/learn.ts + features/tutor.ts).
   Ficam só LF (fachada window.LF lida por learn.ts) e LCUR (fallback dos call-sites vivos). ───── */
const LF=p=>ROOT+'learn/'+p;/* fachada viva: features/learn.ts lê window.LF (ltPath, lazy) */
let LCUR=['rust','own'];/* fallback constante dos call-sites vivos (welcome/CMD/MENUS): nextLesson()||LCUR */

/* ───── integração com o resto do IDE ───── */
function buildActivity(){const bar=$('#activity');bar.innerHTML='';ACTS.forEach(a=>{const el=document.createElement('button');el.className='act'+(a.spacer?' spacer':'')+(a.sep?' sep':'');el.title=a.title;el.dataset.pane=a.pane||'';el.innerHTML=svg(a.ic)+`<span class="badge${a.acc?' acc':''}" style="display:none"></span>`;
  el.onclick=e=>{e.stopPropagation();a.overflow?openOverflow(el):a.run?a.run():setPane(a.pane,true);};bar.appendChild(el);});}
function resetAll(){if(RUN.active){toast('Pára a execução primeiro');return;}loadSeed();MISSIONS.length=0;DECS.length=0;CKPT.length=0;CHAT.length=0;BL.issues.length=0;BL.seq=11;BL.mig=3;BL.adr=4;SD=JSON.parse(JSON.stringify(ST_SEED));saveSD();TB=[];newChat();refresh(false,true);openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'});toast('Protótipo reposto ao estado inicial');}
bus.on('workspace:changed',({fromEditor:a})=>{if(!a){const t=tabOf(cur);if(t&&(t.kind==='graph'||t.kind==='board')){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}}blame();});
const _stLang=window.stLang;window.stLang=function(){_stLang();blame();};
function blame(){const el=$('#st-blame'),t=tabOf(cur);if(!el)return;if(!t||!t.path||t.kind!=='file'){el.textContent='';return;}const h=GIT.order.find(x=>GIT.c[x]&&GIT.c[x].files.includes(t.path)),c=h?GIT.c[h]:GIT.c['1a2b3c4'];if(!c){/* desktop: syncGit reconstrói GIT.c com hashes reais e files:[], logo '1a2b3c4' (semente do protótipo) não existe — sem crash, só o estado local */el.textContent=stOf(t.path)?'Tu · alterações por commitar':'';el.onclick=null;return;}el.textContent=stOf(t.path)?'Tu · alterações por commitar':`${authorOf(c.a).n}, ${rel(c.t)} · ${c.m.slice(0,38)}`;el.onclick=()=>openGraph(c.h);}
/* decoração v4 do pane Co-Dev (Equipa/Backlog/Studio) migrada e dobrada em features/codev.ts */
const _dx=XC.dx;XC.dx=(a)=>{if(a[0]==='test'&&a[1]){const it=BL.issues.find(i=>i.id.toLowerCase()===a[1].toLowerCase());if(!it){echo('<span class="er">issue desconhecida</span>');return;}dropIssue(it.id,'test');return;}if(a[0]==='sprint'){runSprint((+a[1]||1)-1);return;}return _dx(a);};
VIEW.welcome=(t,host)=>{const w=(ic,a,b,act)=>`<button class="wbtn" onclick="${act}"><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML=`<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">Do desenho da arquitectura ao merge: o Studio gera o backlog, a equipa de assistentes desenvolve cada issue no seu ramo, os testes disparam sozinhos e tu validas.</div>
  <h2>Do desenho à entrega</h2><div class="wgrid">${w('cube','1 · Studio','Desenhar a arquitectura e gerar o backlog','openStudio()')}${w('split','2 · Quadro','Sprints, issues e kanban com teste automático','openBoard()')}${w('account','3 · Equipa','Assistentes, harness e router de modelos','openTeam()')}${w('scm','4 · Grafo de commits','Ramos, merges e gitflow','openGraph()')}</div>
  <h2>Aprender</h2><div class="wgrid">${w('book','Tutor','Percursos sobre o código deste projecto',"goPane('tutor');openLesson(...(nextLesson()||LCUR))")}${w('debug','Aprender com o E0382','O erro que está em Problems é uma lição',"openLesson('rust','byref')")}</div>
  <h2>Co-Dev</h2><div class="wgrid">${w('sparkle','Missão: histórico de conversas','Conselho, auto-avaliação e correcção',"demo('b')")}${w('graph','Gestor de missões','Decisões, checkpoints e uso','openManager()')}${w('settings','Modelos e autonomia','Provedores, routing, modos','openSettings()')}${w('search','Paleta de comandos','Ctrl+Shift+P',"palette('>')")}</div></div>`;};
GAPS.push(['Grafo de commits e ramos','GitLens','Lista plana de commits','Feito: DAG com faixas por ramo, merges, tags, autor por commit, detalhe de ficheiros'],['Gitflow guiado','GitLens / git-flow','Não existia','Feito: cada tarefa abre um ramo e fecha com merge em develop; releases ficam com o humano'],['Vários assistentes com harness','Claude Code (subagentes)','Um só assistente','Feito: 8 papéis; caminhos, comandos e limite de ficheiros aplicados em cada ferramenta'],['Router de modelos','—','Routing fixo','Feito: o assistente descreve a tarefa e recebe o modelo mais adequado'],['Studio de arquitectura','projecto original','Só no histórico de commits','Feito: canvas editável que gera backlog e sprints'],['Backlog, sprints e kanban','Jira / Linear','Não existia','Feito: teste automático ao entrar em Teste; só o que passa chega à validação funcional'],['Tutor','projecto original','Não existia','Feito: percursos, exercícios verificados no editor, pistas graduais, lições a partir dos erros']);
CMD.push(['Projecto: Studio de arquitectura','',openStudio],['Projecto: Quadro (kanban)','',openBoard],['Projecto: Gerar backlog a partir do Studio','',genBacklog],['Projecto: Executar Sprint 1','',()=>runSprint(0)],['Projecto: Executar Sprint 2','',()=>runSprint(1)],['Projecto: Nova issue…','',newIssue],['Equipa: Assistentes e harness','',()=>openTeam()],['Equipa: Escolher assistente da conversa…','',pickAgent],
  ['Git: Grafo de commits','',()=>openGraph()],['Gitflow: Iniciar feature…','',()=>gfPrompt('feature')],['Gitflow: Iniciar fix…','',()=>gfPrompt('fix')],['Gitflow: Iniciar release…','',()=>gfPrompt('release')],['Gitflow: Finalizar ramo actual','',()=>gfFinish()?toast('Ramo finalizado'):toast('Não estás num ramo de gitflow')],['Tutor: Continuar a aprender','',()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}]);
function boot3(){loadTeam();const sd=LS.get('studio3',null);if(sd&&Array.isArray(sd.nodes)&&Array.isArray(sd.edges))SD=sd;
  const i=ACTS.findIndex(a=>a.pane==='codev');ACTS.splice(i+1,0,{ic:'book',pane:'tutor',title:'Tutor'},{ic:'cube',run:openStudio,title:'Studio de arquitectura'},{ic:'split',run:openBoard,title:'Quadro'});ACTS[i].sep=1;buildActivity();$('.act').classList.add('on');
  $('.side').insertAdjacentHTML('beforeend','<div class="pane" id="pane-tutor"></div>');
  /* o #pill-agent nasce no compositor (features/codev/ui/composer.ts); só se cria aqui se faltar */
  if(!$('#pill-agent'))$('.comp-bar').insertAdjacentHTML('afterbegin','<button class="pill" id="pill-agent" title="Assistente da conversa" onclick="pickAgent()"></button>');agentPill();
  $('#st-lang').insertAdjacentHTML('beforebegin','<button class="si opt" id="st-blame" title="Último commit que tocou neste ficheiro"></button>');
  MENUS.splice(7,0,{t:'Projecto',items:[{l:'Studio de arquitectura',act:openStudio},{l:'Quadro (kanban)',act:openBoard},{l:'Gerar backlog a partir do Studio',act:genBacklog},{sep:1},{l:'Equipa e harness',act:()=>openTeam()},{l:'Grafo de commits',act:()=>openGraph()},{l:'Gitflow',sub:[{l:'Iniciar feature…',act:()=>gfPrompt('feature')},{l:'Iniciar fix…',act:()=>gfPrompt('fix')},{l:'Iniciar release…',act:()=>gfPrompt('release')},{l:'Finalizar ramo actual',act:()=>gfFinish()}]},{sep:1},{l:'Tutor',act:()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}}]});$('#menubar').innerHTML='';buildMenubar();
  refresh(false,true);show(cur);badges();}

/* ═════════ dxtutor IDE v4 — Learning Track (real course content), cloud Studio, generated artefacts, RUN ═════════ */
function mdFull(s){const out=[],inl=x=>esc(x).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>');
  String(s||'').split(/```/).forEach((p,i)=>{if(i%2){out.push(`<pre>${esc(p.replace(/^[a-z]*\n/,'').replace(/\n$/,''))}</pre>`);return;}
    p.split(/\n{2,}/).forEach(b=>{b=b.trim();if(!b)return;
      if(/^#{1,4}\s/.test(b)){const[h,...r]=b.split('\n');out.push(`<h3>${inl(h.replace(/^#+\s*/,''))}</h3>`);if(r.length)out.push(`<p>${inl(r.join(' '))}</p>`);}
      else if(/^\s*[-*]\s/.test(b))out.push('<ul>'+b.split(/\n(?=\s*[-*]\s)/).map(l=>`<li>${inl(l.replace(/^\s*[-*]\s+/,'').replace(/\n\s*/g,' '))}</li>`).join('')+'</ul>');
      else out.push(`<p>${inl(b.replace(/\n/g,' '))}</p>`);});});return out.join('');}

/* ───── Learning Track: COURSES + motor (LTS, course, ltUnits, drillState, ltRes, ltGo, ltAsk, onboarding) + corpo da vista migrados p/ features/learn.ts; aqui so os shims RP.tutor e VIEW.lt que delegam ───── */
RP.tutor=()=>window.renderTutorPane();/* corpo v4 (Learning Track) migrado p/ features/tutor.ts; shim delega (lazy, no switch de pane) */
VIEW.lt=(t,host)=>window.renderLtView(t,host);/* corpo migrado p/ features/learn.ts; visualizer.ts decora este VIEW.lt */

/* ───── Studio: catálogo cloud (CLOUD/TECH/KIND/mkT/isApp/sl/appDir) + validateDesign + corpo da vista migrados p/ features/studio.ts; aqui só consumidores (geradores, genBacklog, resetAll, boot) que lêem por global ───── */

/* ───── generators: migrados p/ features/generators.ts (inversão @ts-nocheck, window-backed);
   composeYaml/dockerfile/appFiles/k8sYaml/cloudMap lidos por global por features/board.ts ───── */
/* genBacklog/genBacklogIssues (produtor Studio→backlog) migrados p/ features/board.ts;
   lêem os geradores (composeYaml/dockerfile/appFiles/k8sYaml/cloudMap, em features/generators.ts) por global. */
const _approve=approveIssue;approveIssue=function(id){_approve(id);if(BL.issues.some(i=>i.infra&&i.stage==='done')){SD.nodes.forEach(n=>{if(!BL.issues.some(i=>i.node===n.id)&&n.st!=='ok')n.st='ok';});saveSD();}rerender('board');};
Object.assign(AGENTS.be,{paths:['crates/**','apps/*/src/**','apps/*/Cargo.toml','apps/*/go.mod','apps/*/package.json','apps/*/requirements.txt'],max:8});Object.assign(AGENTS.fe,{paths:['desktop/src/**','web/**']});Object.assign(AGENTS.ops,{paths:['docker-compose.yml','.env.example','Makefile','apps/*/Dockerfile','deploy/**','.ci/**','Cargo.toml'],cmds:['cargo build','docker compose','make','git push'],max:12});Object.assign(AGENTS.qa,{cmds:['cargo test','dx lint','dx test','sh tests/smoke.sh']});

/* ───── RUN: one command for the whole stack ───── */
/* ───── RUN: motor (STACK/composeServices/dxRun/dxStop/drawStack) migrado p/ features/stack.ts (inversão @ts-nocheck, window-backed);
   aqui ficam só os consumidores XC.docker/make/dx (terminal) e o wiring de arranque boot4, que lêem dxRun/dxStop/STACK/drawStack por global ───── */
XC.docker=a=>{if(a[0]==='compose'&&a[1]==='up')return dxRun(true);if(a[0]==='compose'&&a[1]==='down'){dxStop(true);return;}if(a[0]==='compose'&&a[1]==='ps'){echo(STACK?STACK.map(s=>`${s.name.padEnd(20)} ${s.state.padEnd(9)} ${s.url}`).join('\n'):'<span class="dim">no containers</span>');return;}echo('<span class="dim">docker compose up | down | ps</span>');};
XC.make=a=>{if(a[0]==='run')return dxRun(true);if(a[0]==='stop'){dxStop(true);return;}echo('<span class="dim">make run | stop</span>');};
const _dx4=XC.dx;XC.dx=a=>{if(a[0]==='run')return dxRun(true);if(a[0]==='stop'){dxStop(true);return;}return _dx4(a);};

/* ───── wiring ───── */
function tabIc(t){if(t.kind==='file')return fIcon(t.title);if(t.kind==='lt')return `<span class="ic acc">${svg('book')}</span>`;const m={agent:'sparkle',welcome:'sparkle',diff:'scm',settings:'settings',manager:'graph',analysis:'book',graph:'scm',team:'account',studio:'cube',board:'split'};return `<span class="ic acc">${svg(m[t.kind]||'file')}</span>`;}
VIEW.welcome=(t,host)=>{const w=(ic,a,b,act)=>`<button class="wbtn" onclick="${act}"><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML=`<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">Learn a language step by step, or design an architecture and let a team of assistants build it: backlog, branches, tests, containers — then run everything with one command.</div>
  <h2>Learn</h2><div class="wgrid">${w('book','Learning Track','Rust and Go, from zero to confident','ltResume()')}${w('settings','Change language or level','Basic, Intermediate, Advanced','ltOnboard(1)')}</div>
  <h2>From design to a running stack</h2><div class="wgrid">${w('cube','1 · Studio','Design with AWS, Azure, GCP and open-source components','openStudio()')}${w('split','2 · Board','Sprints, issues and automatic tests','openBoard()')}${w('account','3 · Team','Assistants, harness and model router','openTeam()')}${w('scm','4 · Commit graph','Branches, merges and gitflow','openGraph()')}${w('run','5 · RUN','Build and start every service','dxRun()')}</div>
  <h2>Co-Dev</h2><div class="wgrid">${w('sparkle','Mission: persistent chat history','Council, self-evaluation and correction',"demo('b')")}${w('graph','Mission manager','Decisions, checkpoints and usage','openManager()')}${w('settings','Models and autonomy','Providers, routing, modes, language','openSettings()')}${w('search','Command palette','Ctrl+Shift+P',"palette('>')")}</div></div>`;};
const _settings=VIEW.settings;VIEW.settings=(t,host)=>{_settings(t,host);host.querySelector('.sub').insertAdjacentHTML('afterend',`<h2>Language</h2><div class="pgrid">${LOCALES.map(l=>`<button class="pcard${LOCALE===l[0]?' sel':''}" onclick="setLocale(${jsa(l[0])})"><div class="ph notr">${l[1]}${LOCALE===l[0]?'<span class="tag acc">✓</span>':''}</div><div class="pd">${l[2]}</div></button>`).join('')}</div>`);};
function boot4(){LANG.go='Go';const ci=CMD.findIndex(c=>c[0]==='Ajuda: O que mudou e porquê');if(ci>=0)CMD.splice(ci,1);
  CMD.push(['Learning Track: Continue','',ltResume],['Learning Track: Change language or level…','',()=>ltOnboard(1)],['Project: RUN the whole stack','Ctrl+F5',dxRun],['Project: Stop the stack','',dxStop],['Preferences: Language — English','',()=>setLocale('en')],['Preferences: Language — Português (Angola)','',()=>setLocale('ptAO')]);
  const hm=MENUS.find(m=>m.t==='Help');if(hm)hm.items=hm.items.filter(i=>i.l!=='O que mudou e porquê');const pm=MENUS.find(m=>m.t==='Projecto');if(pm){pm.t='Project';pm.items.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});const ti=pm.items.findIndex(i=>i.l==='Tutor');if(ti>=0)pm.items[ti]={l:'Learning Track',act:ltResume};}
  const rm=MENUS.find(m=>m.t==='Run');if(rm)rm.items.unshift({l:'▶ RUN the whole stack',k:'Ctrl+F5',act:dxRun},{l:'Stop the stack',act:dxStop},{sep:1});$('#menubar').innerHTML='';buildMenubar();
  const ta=ACTS.find(a=>a.pane==='tutor');if(ta){ta.title='Learning Track';buildActivity();$('.act').classList.add('on');}
  $('.panel-tabs .panel-tools').insertAdjacentHTML('beforebegin','<button class="ptab" data-pt="services">Services</button>');$('.panel-body').insertAdjacentHTML('beforeend','<div class="pcontent" id="pc-services"></div>');$$('.ptab').forEach(b=>b.onclick=()=>setPanelTab(b.dataset.pt));
  $('#st-tests').insertAdjacentHTML('afterend','<button class="si" id="st-stack" style="display:none;color:var(--green)" title="Running stack" onclick="setPanelTab(\'services\')"></button>');
  const sd=LS.get('studio3',null);SD=sd&&Array.isArray(sd.nodes)&&sd.nodes.every(n=>TECH[n.tech])?sd:JSON.parse(JSON.stringify(ST_SEED));
  drawStack();refresh(false,true);show(cur);}

/* ───── wiring + i18n: motor de tradução (PAIRS/NM/MN/nm/mn/tx/RULES + LOCALES/LOCALE/PT2EN/EN2PT/TR_SKIP/trText/trAttrs/trNode/setLocale/i18nBoot) migrado p/ features/i18n.ts (window-backed; LOCALE hidrata de LS preguiçosamente). Aqui so os consumidores (VIEW.settings secao Lingua, entradas setLocale do CMD, startup.ts i18nBoot) que leem por global. ───── */
/* ── fase 4: expor ao window as globais que boot.js/handlers inline/bridge.ts/pair.ts
   consomem; ao virar módulo, os let/const/function de topo deixaram de ser globais de
   script. As mutáveis partilhadas já são window-backed acima (fonte única). ── */
Object.assign(window, {
  CMD, FS, LS,
  OPEN, PANE, PROV, ROOT, RP, RUN, SECOPEN, STOP, VIEW,
  badges, blame, boot, boot3, boot4, buildActivity, buildMenus,
  closeTab,
  drawTabs, esc, fIcon, goPane,
  hydrate, loadCfg, loadSeed, log,
  mdFull, miniOff,
  openFile, openPath, openTab,
  parkAgent,
  rerender, resetAll, runTask,
  save, setActive, setPane, setPanelTab, show,
  stepTab, tabIc, tabOf, togglePanel,
  toggleSide, use,
  who, writeFile,
  // núcleo partilhado que o motor Co-Dev (features/codev.ts) lê por global (defs ficam donas do monólito):
  CHAT, SEED, SAFE, DANGER, connected, norm, P_MIG, P_REPO, P_STORE, P_TEST, P_ADR,
  // fachadas que as features migradas (features/*.ts) consomem por window:
  provFor, LF,
  // núcleo que as camadas v5 (src/v5.ts) e v6 (src/v6.ts) consomem como referências livres via window:
  extOf, getVar, hd, hhmm, LANG, P_HIST, P_LX, rel, setVar, short, USAGE
});
/* arranque: `boot();…boot7();i18nBoot()` movido para src/startup.ts — o último módulo
   da cadeia, de modo a correr depois de as camadas v3–v7 publicarem os seus bootN. */

