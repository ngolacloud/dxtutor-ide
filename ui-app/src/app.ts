// @ts-nocheck
/* ═════════ dxtutor IDE — app (monólito navegável) ═════════
   Fase 4 da componentização: terceiro módulo TypeScript do ui-app, servido como
   <script type="module"> depois do boot.js clássico e ANTES do bridge.ts/pair.ts.
   Era a origem das globais de script; agora é módulo e publica-as no window (bloco
   Object.assign no fim + window.* nas mutáveis partilhadas). @ts-nocheck: tipar a
   sério fica para fase posterior — esta fase só componentiza. */
export {};

/* O seed de demonstração (SEED.base) só é carregado quando a build foi feita com
   VITE_SEED=1 — i.e. `npm run dev:seed`. O `npm run dev` arranca com o workspace
   vazio. Ponto único de decisão: lido aqui e respeitado por loadSeed(). */
const SEED_ON = import.meta.env.VITE_SEED === '1';

const SEED={"base": {"Cargo.toml": "[workspace]\nmembers = [\"crates/lexer\", \"crates/store\"]\nresolver = \"2\"\n\n[workspace.dependencies]\nrusqlite = { version = \"0.32\", features = [\"bundled\"] }\n", "README.md": "# dxtutor\n\nIDE com um Co-Dev integrado. Local-first, multi-modelo.\n\n- `desktop/` — interface (TypeScript + Tauri)\n- `crates/lexer` — tokenizador de exemplo\n- `crates/store` — persistência SQLite\n- `db/migrations` — esquema da base de dados\n- `.dxtutor/` — conhecimento do projecto que o Co-Dev lê antes de agir\n", "desktop/index.html": "<!doctype html>\n<html lang=\"pt\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>dxtutor IDE<\/title>\n    <link rel=\"stylesheet\" href=\"/src/styles.css\" />\n  <\/head>\n  <body>\n    <div id=\"app\"><\/div>\n    <script type=\"module\" src=\"/src/main.ts\"><\/script>\n  <\/body>\n<\/html>\n", "desktop/package.json": "{\n  \"name\": \"dxtutor-desktop\",\n  \"version\": \"0.2.0\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"tsc && vite build\",\n    \"lint\": \"dx lint\"\n  },\n  \"dependencies\": {\n    \"@tauri-apps/api\": \"^2.0.0\"\n  }\n}\n", "desktop/src/styles.css": "/* dxtutor — tema Grafite + laranja */\n:root {\n  --bg-base: #0f0f11;\n  --bg-editor: #161618;\n  --accent: #e06c3b;\n  --accent-hover: #f08a4b;\n  --radius: 9px;\n}\n\n.agent {\n  background: var(--bg-editor);\n  border-radius: var(--radius);\n}\n\n.send {\n  background: var(--accent);\n}\n", "desktop/src/assistant.ts": "// Painel Co-Dev — render das mensagens.\nimport { state } from \"./workspace\";\n\nexport function renderMessages(): void {\n  const host = document.querySelector(\"#ag-msgs\");\n  if (!host) return;\n  host.innerHTML = state.messages.map(bubble).join(\"\");\n}\n\nfunction bubble(m: Message): string {\n  return `<div class=\"m ${m.role}\"><div class=\"bd\">${m.html}<\/div><\/div>`;\n}\n\n// v2: suporte a cartões de plano\nexport function renderPlan(steps: Step[]): string {\n  return steps.map((s) => `<div class=\"stp ${s.state}\">${s.label}<\/div>`).join(\"\");\n}\n", "desktop/src/workspace.ts": "// Estado do workspace aberto.\nexport const state = {\n  root: \"\",\n  messages: [] as Message[],\n};\n\nexport async function openWorkspace(name: string): Promise<void> {\n  state.root = name;\n}\n", "desktop/src/i18n.ts": "// Textos da interface (pt-AO).\nconst STRINGS: Record<string, string> = {\n  \"app.title\": \"dxtutor IDE\",\n  \"agent.name\": \"Co-Dev\",\n  \"mode.manual\": \"Manual\",\n  \"mode.auto\": \"Automático\",\n};\n\nexport function t(key: string): string {\n  return STRINGS[key] ?? key;\n}\n", "desktop/src/theme.css": "/* Tokens alternativos — Slate índigo */\n:root[data-theme=\"slate\"] {\n  --bg-base: #0e1016;\n  --bg-editor: #141722;\n  --accent: #6d7cff;\n  --accent-hover: #8f9bff;\n}\n", "desktop/src/main.ts": "// Arranque da aplicação desktop.\nimport { renderMessages } from \"./assistant\";\nimport { openWorkspace } from \"./workspace\";\nimport { t } from \"./i18n\";\n\nexport async function main(): Promise<void> {\n  document.title = t(\"app.title\");\n  await openWorkspace(\"projects\");\n  renderMessages();\n}\n\nmain();\n", "crates/lexer/src/lib.rs": "// Tokeniza uma expressão aritmética.\npub fn tokenize(src: &str) -> Vec<Token> {\n    let mut tokens = Vec::new();\n    let mut chars = src.chars().peekable();\n    for c in chars {\n        if c.is_ascii_digit() {\n            tokens.push(Token::Num(c));\n        }\n    }\n    if chars.peek().is_none() {\n        tokens.push(Token::Eof);\n    }\n    tokens\n}\n\n#[derive(Debug, PartialEq)]\npub enum Token {\n    Num(char),\n    Eof,\n}\n", "crates/store/src/lib.rs": "// Camada de persistência (ADR-002): só este crate fala com o SQLite.\npub mod workspaces;\n\npub type Result<T> = std::result::Result<T, StoreError>;\n\n#[derive(Debug)]\npub enum StoreError {\n    Sqlite(rusqlite::Error),\n    NotFound,\n}\n", "crates/store/src/workspaces.rs": "use crate::Result;\nuse rusqlite::{params, Connection};\n\npub struct Workspace {\n    pub id: String,\n    pub name: String,\n    pub created_at: i64,\n}\n\npub fn insert(conn: &Connection, w: &Workspace) -> Result<()> {\n    conn.execute(\n        \"INSERT INTO workspaces (id, name, created_at) VALUES (?1, ?2, ?3)\",\n        params![w.id, w.name, w.created_at],\n    )?;\n    Ok(())\n}\n", ".dxtutor/regras.md": "# Regras do Co-Dev neste projecto\n\n1. Ler os ADRs e o Design System antes de propor uma solução.\n2. Não quebrar a API pública de um crate sem perguntar ao humano.\n3. Toda a alteração de esquema entra como migração nova em `db/migrations`.\n4. Nenhuma cor fixa na UI: usar sempre tokens (`var(--…)`).\n5. Código novo só é entregue com testes a passar e auto-avaliação ≥ limiar.\n6. `git push` e acções destrutivas exigem sempre aprovação humana.\n7. Se a confiança numa decisão for baixa, escolher a opção reversível e assinalar o pressuposto.\n", ".dxtutor/padroes.md": "# Padrões de projecto adoptados\n\n1. **Camadas** — ver ADR-002.\n2. **Repository** — acesso a dados atrás de um `trait`; a implementação SQLite é um detalhe.\n3. **Command** — cada acção da UI é um comando Tauri com entrada e saída tipadas.\n4. **Strategy** — provedores de LLM implementam o mesmo `trait ModelProvider`.\n5. **Observer** — a UI subscreve eventos do agente (plano, ferramenta, avaliação).\n", ".dxtutor/design-system.md": "# Design System\n\n## Tokens\n- Cor: `--bg-base`, `--bg-editor`, `--accent`, `--accent-hover` (ver `desktop/src/styles.css`)\n- Raio: `--radius`\n- Nunca usar valores hexadecimais fora da definição dos tokens.\n\n## Componentes\n- Listas e históricos vivem em **secções do painel lateral**, não em modais.\n- Acção primária: um único botão com `--accent` por vista.\n- Estados: vazio, a carregar, erro — sempre os três.\n", ".dxtutor/requisitos.md": "# Requisitos (backlog vivo)\n\n## RF-01 · Editor e navegação\nComo programador quero abrir, editar e procurar ficheiros sem sair do teclado.\n\n## RF-02 · Co-Dev multi-modelo\nComo programador quero escolher entre Claude, Gemini, Codex e Ollama local por papel.\n\n## RF-03 · Histórico de conversas\nComo programador quero retomar conversas anteriores do Co-Dev por workspace.\n- CA1: as conversas ficam guardadas depois de fechar a aplicação.\n- CA2: a lista mostra primeiro as mais recentes.\n- CA3: apagar um workspace apaga as suas conversas.\n\n## RNF-01 · Local-first\nOs dados do utilizador ficam na máquina; nada sai sem consentimento.\n", ".dxtutor/base-de-dados.md": "# Base de dados\n\n- Motor: SQLite (ficheiro por instalação), acesso via `rusqlite`.\n- Chaves: `TEXT` (ULID). Datas: `INTEGER` (epoch ms).\n- Integridade: chaves estrangeiras com `ON DELETE CASCADE` quando o filho não vive sem o pai.\n- Desempenho: toda a listagem ordenada precisa de um índice que cubra o filtro e a ordenação.\n- Migrações: ficheiros numerados, só para a frente, nunca editar uma migração aplicada.\n", ".dxtutor/arquitectura/ADR-001-local-first.md": "# ADR-001 · Local-first\n\n**Estado:** aceite\n\n**Decisão:** os dados do utilizador (workspaces, conversas, definições) são guardados\nlocalmente em SQLite. Serviços remotos são opcionais e nunca a fonte de verdade.\n\n**Consequências:** funciona offline; sincronização é uma funcionalidade futura, não um requisito.\n", ".dxtutor/arquitectura/ADR-002-camadas.md": "# ADR-002 · Camadas\n\n**Estado:** aceite\n\n**Decisão:** UI (`desktop/`) → comandos Tauri → crates de domínio → `crates/store`.\nSó o crate `store` contém SQL. A UI nunca acede à base de dados directamente.\n\n**Consequências:** a persistência pode mudar sem tocar na interface; testes do `store` não precisam de UI.\n", "db/migrations/0001_init.sql": "-- 0001 · esquema inicial\nCREATE TABLE workspaces (\n  id         TEXT PRIMARY KEY,\n  name       TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\n"}, "gen": {"conversations.rs": "// Repository (padroes.md §2): quem consome depende do trait, não do SQLite.\nuse crate::Result;\nuse rusqlite::{params, Connection};\n\npub struct Conversation {\n    pub id: String,\n    pub workspace_id: String,\n    pub title: String,\n    pub created_at: i64,\n}\n\npub trait ConversationRepo {\n    fn save(&self, c: &Conversation) -> Result<()>;\n    fn list_recent(&self, workspace_id: &str, limit: u32) -> Result<Vec<Conversation>>;\n}\n\npub struct SqliteConversationRepo {\n    pub conn: Connection,\n}\n\nimpl ConversationRepo for SqliteConversationRepo {\n    fn save(&self, c: &Conversation) -> Result<()> {\n        self.conn.execute(\n            \"INSERT INTO conversations (id, workspace_id, title, created_at) VALUES (?1, ?2, ?3, ?4)\",\n            params![c.id, c.workspace_id, c.title, c.created_at],\n        )?;\n        Ok(())\n    }\n\n    fn list_recent(&self, workspace_id: &str, limit: u32) -> Result<Vec<Conversation>> {\n        let mut stmt = self.conn.prepare(\n            \"SELECT id, workspace_id, title, created_at FROM conversations WHERE workspace_id = ?1 LIMIT ?2\",\n        )?;\n        let rows = stmt.query_map(params![workspace_id, limit], Conversation::from_row)?;\n        rows.collect()\n    }\n}\n", "history.ts": "// Secção «Histórico» do painel Co-Dev.\n// Só fala com o comando Tauri — nunca com a base de dados (ADR-002).\nimport { invoke } from \"@tauri-apps/api/core\";\n\nexport async function renderHistory(host: HTMLElement, workspaceId: string): Promise<void> {\n  const items = await invoke<Conversation[]>(\"conversations_list_recent\", { workspaceId, limit: 20 });\n  if (!items.length) {\n    host.textContent = \"Ainda não há conversas neste workspace.\";\n    return;\n  }\n  host.innerHTML = items\n    .map((c) => `<button class=\"hist-row\" data-id=\"${c.id}\">${c.title}<\/button>`)\n    .join(\"\");\n  host.style.borderLeft = \"2px solid #ff6600\";\n}\n", "0002_conversations.sql": "-- 0002 · histórico de conversas do Co-Dev (ADR-003)\nCREATE TABLE conversations (\n  id           TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n  title        TEXT NOT NULL,\n  created_at   INTEGER NOT NULL\n);\n\nCREATE TABLE messages (\n  id              TEXT PRIMARY KEY,\n  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,\n  role            TEXT NOT NULL,\n  content         TEXT NOT NULL,\n  created_at      INTEGER NOT NULL\n);\n", "ADR-003-historico.md": "# ADR-003 · Histórico de conversas\n\n**Estado:** aceite (proposto pelo Co-Dev, aprovado pelo humano na entrega)\n\n**Contexto:** RF-03 pede conversas persistentes por workspace.\n\n**Decisão:** tabelas `conversations` e `messages` em SQLite (ADR-001), acedidas\natravés do `trait ConversationRepo` no crate `store` (ADR-002, padrão Repository).\nA UI lista-as numa secção do painel lateral (Design System).\n\n**Alternativas rejeitadas:** SQL directo na UI (viola ADR-002); Postgres gerido\n(viola ADR-001); ficheiro JSON (sem integridade referencial nem ordenação indexada).\n\n**Pressuposto a rever:** retenção de 90 dias, configurável.\n", "conversations_test.rs": "use store::conversations::*;\n\n#[test]\nfn save_and_load_roundtrip() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"Primeira\", 10)).unwrap();\n    assert_eq!(repo.list_recent(\"ws1\", 10).unwrap().len(), 1);\n}\n\n#[test]\nfn list_recent_orders_by_newest() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"Antiga\", 10)).unwrap();\n    repo.save(&conv(\"c2\", \"ws1\", \"Recente\", 20)).unwrap();\n    assert_eq!(repo.list_recent(\"ws1\", 10).unwrap()[0].id, \"c2\");\n}\n\n#[test]\nfn cascade_delete_messages() {\n    let repo = test_repo();\n    repo.save(&conv(\"c1\", \"ws1\", \"A apagar\", 10)).unwrap();\n    delete_workspace(&repo.conn, \"ws1\").unwrap();\n    assert!(repo.list_recent(\"ws1\", 10).unwrap().is_empty());\n}\n"}};
/* COURSES (conteúdo dos cursos) migrado p/ features/learn.ts */
/* ═════════ dxtutor IDE v2 — núcleo do IDE ═════════ */
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const hhmm=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes());};
const LS={get(k,d){try{const v=localStorage.getItem('dx2.'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem('dx2.'+k,JSON.stringify(v));}catch(e){}}};
const setVar=(k,v)=>document.body.style.setProperty(k,v);
const getVar=k=>getComputedStyle(document.body).getPropertyValue(k).trim();
function hydrate(){$$('[data-ic]').forEach(el=>{if(el.dataset.done)return;el.insertAdjacentHTML('afterbegin',svg(el.dataset.ic));el.dataset.done=1;});}

/* ───── sistema de ficheiros virtual ───── */
const ROOT='dxtutor/',FS={},OPEN=new Set(['dxtutor','dxtutor/crates','dxtutor/crates/lexer','dxtutor/crates/lexer/src','dxtutor/desktop','dxtutor/desktop/src']),SECOPEN={};
/* estado git/scm (STAGED/BRANCH/COMMIT_MSG/BRANCHES/COMMITS/AUTHOR/GSEL) migrado p/ features/scm.ts; lido aqui por global */
function loadSeed$dup0(){Object.keys(FS).forEach(k=>delete FS[k]);Object.entries(SEED.base).forEach(([p,c])=>{FS[ROOT+p]={content:c,orig:c};});
  const s=FS[ROOT+'desktop/src/styles.css'];s.orig=s.content.replace('  --accent-hover: #f08a4b;\n','');
  const a=FS[ROOT+'desktop/src/assistant.ts'];a.orig=a.content.replace(/\n\/\/ v2[\s\S]*$/,'\n');
  FS[ROOT+'desktop/src/theme.css'].orig=null;STAGED.clear();}
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
function renderLevel(obj,host,depth,path){Object.keys(obj).forEach(name=>{const node=obj[name],pad=8+depth*12,row=document.createElement('div');
  let g=node.git||'';if(node.path)g=stOf(node.path).toLowerCase();else if(node.dpath)g=changes().some(p=>p.startsWith(node.dpath+'/'))?'m':'';
  row.className='row'+(g?' git-'+g:'');row.style.paddingLeft=pad+'px';if(node.path)row.dataset.path=node.path;
  const open=node.dpath?OPEN.has(node.dpath):!!node.open;
  row.innerHTML=`<span class="chev${node.dir?'':' leaf'}">${svg('chev')}</span>${node.dir?`<span class="ic folder">${svg(open?'folderOpen':'folder')}</span>`:fIcon(name)}<span class="nm">${esc(name)}</span>${g?(node.dir?'<span class="dot"></span>':`<span class="deco">${g.toUpperCase()}</span>`):''}`;
  host.appendChild(row);
  if(node.dir){const kids=document.createElement('div');kids.className='children';const gd=document.createElement('span');gd.className='guide';gd.style.left=(pad+7)+'px';kids.appendChild(gd);host.appendChild(kids);let built=false;
    const expand=o=>{row.classList.toggle('open',o);kids.style.display=o?'block':'none';row.querySelector('.ic').innerHTML=svg(o?'folderOpen':'folder');
      if(node.dpath){o?OPEN.add(node.dpath):OPEN.delete(node.dpath);}else node.open=o;
      if(o&&!built){built=true;if(node.children&&Object.keys(node.children).length)renderLevel(node.children,kids,depth+1,path.concat(name));
        else kids.insertAdjacentHTML('beforeend',`<div class="sec-empty" style="padding:2px 0 2px ${pad+28}px">fora do workspace do protótipo</div>`);}};
    kids.style.display='none';row.onclick=e=>{e.stopPropagation();sel(row);expand(!row.classList.contains('open'));};if(open)expand(true);
  }else row.onclick=e=>{e.stopPropagation();if(node.path)openPath(node.path);};});}
function buildExplorer(){const host=$('#exp-sections');host.innerHTML='';
  const sec=(lbl,open,flex)=>{const s=document.createElement('div');s.className='section'+(flex?' flexible':'');const h=document.createElement('div');h.className='sec-hd'+(open?' open':'');h.innerHTML=`<span class="chev">${svg('chev')}</span><span class="lbl">${lbl}</span>`;
    const b=document.createElement('div');b.className='sec-body'+(open?' show':'');h.onclick=()=>{h.classList.toggle('open');b.classList.toggle('show');SECOPEN[lbl]=b.classList.contains('show');};s.append(h,b);host.appendChild(s);return b;};
  const tb=sec('projects',SECOPEN.projects!==false,1),tree=document.createElement('div');tree.className='tree';tb.appendChild(tree);renderLevel(TREE.projects.children,tree,0,['projects']);
  sec('Outline',SECOPEN.Outline!==false).id='outline';sec('Timeline',!!SECOPEN.Timeline).id='timeline';drawOutline();drawTimeline();markActive();}
function markActive(){$$('#exp-sections .row.sel').forEach(x=>x.classList.remove('sel'));const t=tabOf(cur);if(t&&t.path){const r=$(`#exp-sections .row[data-path="${t.path}"]`);if(r)r.classList.add('sel');}}
function collapseAll(){OPEN.clear();Object.values(TREE.projects.children).forEach(n=>{n.open=false;});buildExplorer();}
function symbols(p){const f=FS[p];if(!f)return[];const out=[];f.content.split('\n').forEach((l,i)=>{const m=l.match(/^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|function|CREATE TABLE|CREATE INDEX)\s+(?:.*?\bfor\s+)?([A-Za-z_]\w*)/)||l.match(/^(#{1,3})\s+(.+)/)||l.match(/^(export)\s+(?:async\s+)?(?:function|const)\s+(\w+)/);if(m)out.push({k:m[1].replace('CREATE ','').toLowerCase(),n:m[2],line:i+1});});return out;}
function drawOutline(){const o=$('#outline');if(!o)return;const t=tabOf(cur),sy=t&&t.path?symbols(t.path):[];
  o.innerHTML=sy.length?sy.map(s=>`<div class="s-hit" style="padding-left:16px" onclick="gotoLine(${s.line})"><span style="color:var(--accent-hover)">${esc(s.k.startsWith('#')?'§':s.k)}</span><span>${esc(s.n)}</span></div>`).join(''):'<div class="sec-empty">Abre um ficheiro para ver os símbolos.</div>';}
/* drawTimeline$dup0 morto removido (o drawTimeline vivo foi p/ features/scm.ts) */
function newFile(){palette('',{ph:'Caminho do novo ficheiro (relativo a dxtutor/) — ex.: desktop/src/novo.ts',verb:'Criar',text:q=>{q=q.trim();if(!q)return;const p=norm(q);if(FS[p]){toast('Já existe');openPath(p);return;}writeFile(p,'');openPath(p);}});}
function newFolder(){palette('',{ph:'Nome da nova pasta (relativo a dxtutor/)',verb:'Criar pasta',text:q=>{q=q.trim().replace(/\/$/,'');if(!q)return;writeFile(norm(q+'/.gitkeep'),'');OPEN.add('dxtutor/'+q);refresh(true,true);toast('Pasta criada: '+q);}});}

/* ───── realce de sintaxe ───── */
const KW=/^(?:pub|fn|let|mut|for|in|if|else|while|loop|match|return|use|mod|impl|trait|struct|enum|type|const|static|self|Self|crate|async|await|export|import|from|function|class|interface|extends|new|var|void|null|true|false|as|CREATE|TABLE|INDEX|ON|NOT|NULL|PRIMARY|KEY|REFERENCES|DELETE|CASCADE|SELECT|FROM|WHERE|ORDER|BY|DESC|ASC|LIMIT|INSERT|INTO|VALUES|TEXT|INTEGER|UNIQUE|DEFAULT|AND|OR)$/;
function hlLine(s,ext){
  if(ext==='md'){if(/^#/.test(s))return `<span class="kw">${esc(s)}</span>`;return esc(s).replace(/`[^`]+`/g,m=>`<span class="str">${m}</span>`).replace(/\*\*[^*]+\*\*/g,m=>`<span class="ty">${m}</span>`);}
  const re=/(\/\/.*$|--\s.*$|\/\*.*?\*\/|#\s.*$|<!--.*?-->)|("(?:\\.|[^"\\])*"|`[^`]*`)|(\b\d[\d_.]*\b|#[0-9a-fA-F]{3,8}\b)|([A-Za-z_]\w*!)|([A-Za-z_]\w*)(?=\()|([A-Za-z_][\w-]*)/g;
  let out='',i=0,m;while((m=re.exec(s))){out+=esc(s.slice(i,m.index));const x=esc(m[0]);
    if(m[1])out+=`<span class="cm">${x}</span>`;else if(m[2])out+=`<span class="str">${x}</span>`;else if(m[3])out+=`<span class="num">${x}</span>`;else if(m[4])out+=`<span class="mac">${x}</span>`;
    else if(m[5])out+=`<span class="${KW.test(m[5])?'kw':'fn'}">${x}</span>`;else out+=KW.test(m[6])?`<span class="kw">${x}</span>`:/^[A-Z][a-z]/.test(m[6])?`<span class="ty">${x}</span>`:x;
    i=m.index+m[0].length;}
  return out+esc(s.slice(i));}

/* ───── diagnósticos, lint e testes (derivados do estado real dos ficheiros) ───── */
const P_LX=ROOT+'crates/lexer/src/lib.rs',P_REPO=ROOT+'crates/store/src/conversations.rs',P_MIG=ROOT+'db/migrations/0002_conversations.sql',P_TEST=ROOT+'crates/store/tests/conversations_test.rs',P_HIST=ROOT+'desktop/src/history.ts',P_ADR=ROOT+'.dxtutor/arquitectura/ADR-003-historico.md',P_STORE=ROOT+'crates/store/src/lib.rs';
const has=(p,re)=>!!FS[p]&&re.test(FS[p].content);
const lexBug=()=>has(P_LX,/for c in chars \{/)&&has(P_LX,/chars\.peek\(\)/);
function dsLint(){const out=[];Object.keys(FS).forEach(p=>{if(!/desktop\/src\/.*\.(ts|css)$/.test(p))return;FS[p].content.split('\n').forEach((l,i)=>{if(/^\s*--[\w-]+\s*:/.test(l))return;const m=l.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);if(m)out.push({p,line:i+1,hex:m[0]});});});return out;}
window.diagnostics = function(){const out=[],add=(p,re,sev,msg)=>{if(FS[p])FS[p].content.split('\n').forEach((l,i)=>{if(re.test(l))out.push({p,line:i+1,sev,msg});});};
  if(lexBug())add(P_LX,/chars\.peek\(\)/,'e','E0382: use of moved value: `chars` (movido pelo `for` na linha 5)');
  dsLint().forEach(v=>out.push({p:v.p,line:v.line,sev:'w',msg:`design-system: cor fixa ${v.hex} — usar um token (regras.md §4)`}));
  add(ROOT+'desktop/src/workspace.ts',/\bany\b/,'w','evitar `any` — tipar explicitamente');
  add(P_REPO,/WHERE workspace_id = \?1 LIMIT/,'w','listagem sem ORDER BY — ordem não determinística');
  return out;}
function runTests(pkg){const R=[];
  if(!pkg||pkg==='lexer'){if(lexBug())return{ok:false,build:false,tests:[],err:'error[E0382]: use of moved value: `chars`\n  --> crates/lexer/src/lib.rs:10:8'};
    R.push({n:'lexer::tokenize_digits',ok:true});R.push({n:'lexer::tokenize_emits_eof',ok:has(P_LX,/Token::Eof\)/)&&!has(P_LX,/chars\.clone\(\)/)});}
  if(!pkg||pkg==='store'){R.push({n:'store::workspaces_roundtrip',ok:true});
    if(FS[P_TEST]){R.push({n:'store::save_and_load_roundtrip',ok:!!FS[P_REPO]&&!!FS[P_MIG]&&has(P_STORE,/pub mod conversations/)});R.push({n:'store::list_recent_orders_by_newest',ok:has(P_REPO,/ORDER BY created_at DESC/)});R.push({n:'store::cascade_delete_messages',ok:has(P_MIG,/ON DELETE CASCADE/)});}}
  return{ok:R.every(t=>t.ok),build:true,tests:R};}
function drawProblems(){const d=diagnostics(),e=d.filter(x=>x.sev==='e').length,w=d.length-e;
  $('#pc-problems').innerHTML=d.length?d.map(x=>`<div class="prob" onclick="openPath('${x.p}',${x.line})"><span class="pi ${x.sev}">${x.sev==='e'?'✖':'⚠'}</span><span><span>${esc(x.msg)}</span> <span class="ploc">${short(x.p)}:${x.line}</span></span></div>`).join(''):'<div class="sec-empty">Sem problemas no workspace.</div>';
  $('#pb-prob').textContent=d.length;const s=$('#st-prob');s.innerHTML=`✖ ${e} ⚠ ${w}`;s.style.color=e?'var(--red)':w?'var(--yellow)':'var(--git-u)';
  const t=runTests(),st=$('#st-tests');st.innerHTML=!t.build?'✖ build':`${t.ok?'✓':'✖'} ${t.tests.filter(x=>x.ok).length}/${t.tests.length} testes`;st.style.color=t.ok?'var(--git-u)':'var(--red)';}
function nextProblem(){const d=diagnostics();if(!d.length){toast('Sem problemas');return;}NP=(NP+1)%d.length;openPath(d[NP].p,d[NP].line);}let NP=-1;

/* ───── separadores e vistas ───── */
let TB=[];window.cur=null;window.PANE='explorer';const VIEW={};
const tabOf=id=>TB.find(o=>o.id===id);
function openTab(t,act){let x=tabOf(t.id);if(x)Object.assign(x,t);else TB.push(t);if(act===false)drawTabs();else show(t.id);}
function openPath(p,line){if(!FS[p]){toast('Ficheiro não existe: '+short(p));return;}openTab({id:p,title:p.split('/').pop(),kind:'file',path:p});if(line)gotoLine(line);}
function openFile(name){const p=Object.keys(FS).find(k=>k.endsWith('/'+name));if(p)openPath(p);}
function setActive(id){if(tabOf(id))show(id);}
function tabIc$dup0(t){if(t.kind==='file')return fIcon(t.title);const m={agent:'sparkle',welcome:'sparkle',diff:'scm',settings:'settings',manager:'graph',analysis:'book'};return `<span class="ic acc">${svg(m[t.kind]||'file')}</span>`;}
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

/* editor de ficheiros */
VIEW.file=(t,host)=>{const f=FS[t.path];host.innerHTML=`<div class="ed"><div class="ed-gut" id="ed-gut"></div><div class="ed-wrap"><div class="ed-hl" id="ed-hl"></div><textarea id="ed-ta" class="ed-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off"></textarea></div></div>`;
  const ta=$('#ed-ta');ta.value=f.content;paintEd(t.path);
  ta.oninput=()=>{f.content=ta.value;paintEd(t.path);clearTimeout(ta._t);ta._t=setTimeout(()=>refresh(true),180);};
  ta.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();if(!document.execCommand('insertText',false,'    '))ta.setRangeText('    ',ta.selectionStart,ta.selectionEnd,'end');ta.oninput();}};
  ta.onkeyup=ta.onclick=ta.onfocus=()=>stPos();};
window.paintEd = function(p){const f=FS[p],lines=f.content.split('\n'),dg={},ext=extOf(p);diagnostics().forEach(d=>{if(d.p===p&&dg[d.line]!=='e')dg[d.line]=d.sev;});
  $('#ed-gut').innerHTML=lines.map((_,i)=>`<div${dg[i+1]?` class="g-${dg[i+1]}"`:''}>${i+1}</div>`).join('');
  $('#ed-hl').innerHTML=lines.map((l,i)=>`<div class="l${dg[i+1]?' d-'+dg[i+1]:''}">${hlLine(l,ext)||' '}</div>`).join('');
  const mm=$('#minimap');mm.classList.remove('hidden');$('#ebody').classList.add('with-mm');
  mm.innerHTML='<div class="mm-view"></div>'+lines.slice(0,120).map((l,i)=>`<div class="mm-line${dg[i+1]==='e'?' err':''}" style="width:${l.trim()?Math.max(6,Math.min(52,l.length*.9)):0}px"></div>`).join('');}
function gotoLine(n){const ta=$('#ed-ta');if(!ta)return;const ls=ta.value.split('\n');n=Math.max(1,Math.min(ls.length,n|0));let o=0;for(let i=0;i<n-1;i++)o+=ls[i].length+1;ta.focus({preventScroll:true});ta.setSelectionRange(o,o+ls[n-1].length);$('#ebody').scrollTop=Math.max(0,(n-1)*22-90);stPos();}
function stPos(){const ta=$('#ed-ta'),el=$('#st-pos');if(!ta){el.textContent='';return;}const b=ta.value.slice(0,ta.selectionStart).split('\n');el.textContent=`Ln ${b.length}, Col ${b[b.length-1].length+1}`;}
function stLang(){const t=tabOf(cur);$('#st-lang').textContent=t&&t.path?(LANG[extOf(t.path)]||'Texto'):'';stPos();}
function edCmd(c){const ta=$('#ed-ta');if(!ta){toast('Abre um ficheiro primeiro');return;}ta.focus();if(c==='selectAll')ta.select();else if(c==='line'){const b=ta.value.slice(0,ta.selectionStart).split('\n').length;gotoLine(b);}else{document.execCommand(c);ta.oninput();}}
function selText(){const ta=$('#ed-ta');return ta?ta.value.slice(ta.selectionStart,ta.selectionEnd):'';}

/* diff */
function diffLines(a,b){const A=a?a.split('\n'):[],B=b?b.split('\n'):[],n=A.length,m=B.length,L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[];let i=0,j=0;while(i<n&&j<m){if(A[i]===B[j]){out.push([' ',A[i],i+1,j+1]);i++;j++;}else if(L[i+1][j]>=L[i][j+1]){out.push(['-',A[i],i+1,'']);i++;}else{out.push(['+',B[j],'',j+1]);j++;}}
  while(i<n){out.push(['-',A[i],i+1,'']);i++;}while(j<m){out.push(['+',B[j],'',j+1]);j++;}return out;}
function diffStat(a,b){const d=diffLines(a,b);return{add:d.filter(x=>x[0]==='+').length,del:d.filter(x=>x[0]==='-').length};}
VIEW.diff=(t,host)=>{const a=t.fixed?t.a:(FS[t.path]?FS[t.path].orig:''),b=t.fixed?t.b:(FS[t.path]?FS[t.path].content:''),d=diffLines(a,b),ext=extOf(t.path),s=diffStat(a,b);
  host.innerHTML=`<div class="diff"><div class="diff-h"><b style="color:var(--fg)">${short(t.path)}</b><span class="tag">${esc(t.label||'HEAD ↔ área de trabalho')}</span><span style="color:var(--green)">+${s.add}</span><span style="color:var(--red)">−${s.del}</span><button class="mini" onclick="openPath('${t.path}')">Abrir ficheiro</button></div>${d.length?d.map(x=>`<div class="dl ${x[0]==='+'?'add':x[0]==='-'?'del':''}"><span class="n">${x[2]}</span><span class="n">${x[3]}</span><span class="s">${x[0]}</span><span>${hlLine(x[1],ext)||' '}</span></div>`).join(''):'<div class="sec-empty">Sem diferenças.</div>'}</div>`;};
function openDiff(p,a,b,label){const fixed=a!==undefined;openTab({id:(fixed?'prop:':'diff:')+p,title:p.split('/').pop()+(fixed?' (proposta)':' (diff)'),kind:'diff',path:p,fixed,a,b,label});}

/* ───── actualização global ───── */
let SIG='';
window.refresh = function(fromEd,force){const sig=Object.keys(FS).map(p=>p+stOf(p)).join('|');
  TB.filter(t=>t.kind==='file'&&!FS[t.path]).forEach(t=>{TB.splice(TB.indexOf(t),1);if(cur===t.id)cur=null;});
  if(sig!==SIG||force){SIG=sig;syncTree();buildExplorer();}
  drawProblems();badges();if(RP[PANE]&&PANE!=='search')RP[PANE]();hydrate();
  if(!fromEd){const t=tabOf(cur);if(!t)show(TB.length?TB[TB.length-1].id:null);else if(t.kind==='file'){const ta=$('#ed-ta'),top=$('#ebody').scrollTop;if(ta&&ta.value!==FS[t.path].content){ta.value=FS[t.path].content;}if(ta){paintEd(t.path);$('#ebody').scrollTop=top;}drawTabs();}else if(t.kind==='diff'||t.kind==='manager'){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}else drawTabs();}
  else if(tabOf(cur)&&tabOf(cur).kind==='file')paintEd(tabOf(cur).path);drawOutline();}
window.badges = function(){const set=(p,v)=>{const b=$(`.act[data-pane="${p}"] .badge`);if(b){b.textContent=v;b.style.display=v?'grid':'none';}};set('scm',changes().length||'');set('codev',typeof RUN!=='undefined'&&RUN.active?'●':'');}

/* ───── activity bar e painéis laterais ───── */
const RP={};
function buildActivity$dup0(){const bar=$('#activity');bar.innerHTML='';ACTS.forEach(a=>{const el=document.createElement('button');el.className='act'+(a.spacer?' spacer':'');el.title=a.title;el.dataset.pane=a.pane||'';el.innerHTML=svg(a.ic)+`<span class="badge${a.acc?' acc':''}" style="display:none"></span>`;
  el.onclick=e=>{e.stopPropagation();a.overflow?openOverflow(el):setPane(a.pane,true);};bar.appendChild(el);});}
const sideOpen=()=>getVar('--side-w')!=='0px';
function setPane(p,tgl){if(p==='settings'){openSettings();return;}if(tgl===true&&PANE===p&&sideOpen()){toggleSide();return;}if(!sideOpen())toggleSide();PANE=p;
  $$('.act').forEach(a=>a.classList.toggle('on',a.dataset.pane===p));$$('.pane').forEach(x=>x.classList.remove('show'));const pe=$('#pane-'+p);if(pe)pe.classList.add('show');if(RP[p])RP[p]();hydrate();}
const goPane=p=>setPane(p);
function toggleSide(){const o=sideOpen();setVar('--side-w',o?'0px':'250px');$('#tgl-side').classList.toggle('on',!o);}
function togglePanel(){const o=getVar('--panel-h')!=='0px';setVar('--panel-h',o?'0px':'230px');$('#tgl-panel').classList.toggle('on',!o);}
const hd=(t,acts)=>`<div class="side-hd"><span class="t">${t}</span><span class="acts">${acts||''}</span></div>`;

RP.search=()=>window.renderSearchPane();/* corpo + leaves doSearch/replaceAll migrados p/ features/search.ts; shim delega (lazy, no switch de pane) */

RP.scm=()=>{const el=$('#pane-scm'),ch=changes(),st=ch.filter(p=>STAGED.has(p)),un=ch.filter(p=>!STAGED.has(p));
  const row=(p,staged)=>`<div class="scm-row" onclick="openDiff('${p}')">${fIcon(p)}<span class="nm">${esc(p.split('/').pop())}</span><span class="pth">${esc(short(p).split('/').slice(0,-1).join('/'))}</span><span class="ra"><button title="Abrir ficheiro" onclick="event.stopPropagation();openPath('${p}')">↗</button><button title="Descartar alterações" onclick="event.stopPropagation();discard('${p}')">↶</button><button title="${staged?'Retirar do stage':'Stage'}" onclick="event.stopPropagation();stage('${p}')">${staged?'−':'+'}</button></span><span class="g ${stOf(p)}">${stOf(p)}</span></div>`;
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
RP.ext=()=>{$('#pane-ext').innerHTML=hd('Extensions')+`<div class="sections"><div class="scm-grp">Provedores de LLM<span class="cnt">${Object.values(PROV).filter(p=>p.on).length}/4</span></div>${Object.entries(PROV).map(([k,p])=>`<div class="scm-row" onclick="toggleProv('${k}')"><span class="pdot${p.on?'':' off'}" style="background:${p.col}"></span><span class="nm">${p.name}</span><span class="pth">${p.vendor}</span><span class="sw${p.on?' on':''}" style="margin-left:auto"></span></div>`).join('')}
  <div class="scm-grp">Linguagem e qualidade<span class="cnt">4</span></div>${[['rust','rust-analyzer','diagnósticos Rust'],['shield','Design System Lint','dx lint'],['test','Test Explorer','cargo test'],['check','Spell Checker','pt-AO (pré-AO90)']].map(e=>`<div class="scm-row" style="cursor:default"><span class="ic">${svg(e[0])}</span><span class="nm">${e[1]}</span><span class="pth">${e[2]}</span></div>`).join('')}<button class="btn ghost" onclick="openSettings()">Configurar provedores…</button></div>`;};
RP.remote=()=>window.renderRemotePane();/* corpo migrado p/ features/remote.ts; shim delega (lazy, no switch de pane) */
RP.account=()=>window.renderAccountPane();/* corpo migrado p/ features/account.ts; shim delega (lazy, no switch de pane) */
RP.codev=()=>window.renderCodevPane();/* base v3 + decoração v4 migradas p/ features/codev.ts; shim delega (lazy, no switch de pane) */

/* ───── painel inferior ───── */
function log(src,msg){const o=$('#pc-output');o.insertAdjacentHTML('beforeend',`<div>[${hhmm()}] <span class="r">${esc(src)}</span> ${esc(msg)}</div>`);o.scrollTop=o.scrollHeight;}

/* ───── terminal (comandos ligados ao estado real) ───── */
window.promptHTML = function(){return `<span class="pr"><span>${USER}</span><span class="at">@</span><span>${HOST}</span><span class="at">:</span><span class="pth">${CWD.join('/')}</span><span class="br"> (${esc(BRANCH)})</span><span class="at">$</span></span> `;}
function newInput(nofocus){const t=$('#term'),old=$('#inputwrap');if(old)old.remove();const w=document.createElement('div');w.id='inputwrap';w.className='line inputline';w.innerHTML=promptHTML()+'<input id="cmd" autocomplete="off" spellcheck="false"/>';t.appendChild(w);const c=$('#cmd');c.onkeydown=onKey;if(!nofocus)c.focus({preventScroll:true});scrollTerm();}
function termRefreshPrompt(){const c=$('#cmd'),v=c?c.value:'';newInput(true);$('#cmd').value=v;}
window.termExec = function(v){echoCmd(v);const[cmd,...a]=v.trim().split(/\s+/);let r=null;if(XC[cmd])r=XC[cmd](a,v);else echo('<span class="er">'+esc(cmd)+': comando não encontrado</span>');newInput(true);return r;}
const XC={
  help(){echo(`<span class="ac">ficheiros</span>  <span class="ok">ls</span> <span class="ok">cd</span> <span class="ok">pwd</span> <span class="ok">cat</span> <span class="ok">tree</span>\n<span class="ac">git</span>        <span class="ok">git</span> status | add . | commit -m "msg" | log | branch | checkout &lt;ramo&gt; | diff | push\n<span class="ac">build</span>      <span class="ok">cargo</span> build | test [-p lexer|store] | run     <span class="ok">npm</span> run dev\n<span class="ac">co-dev</span>     <span class="ok">dx</span> lint | status | modo manual|assist|auto | missao a|b\n<span class="ac">outros</span>     <span class="ok">echo</span> <span class="ok">whoami</span> <span class="ok">date</span> <span class="ok">neofetch</span> <span class="ok">history</span> <span class="ok">clear</span>`);},
  cat(a){if(!a[0]){echo('<span class="er">cat: falta o ficheiro</span>');return;}const rel=CWD.slice(4).concat(a[0].split('/')).join('/');const p=FS[rel]?rel:Object.keys(FS).find(k=>k.endsWith('/'+a[0].split('/').pop()));if(!p){echo('<span class="er">cat: '+esc(a[0])+': não encontrado</span>');return;}echo(FS[p].content.split('\n').map(l=>hlLine(l,extOf(p))).join('\n'));},
  git(a,raw){const s=a[0],ch=changes();
    if(s==='status'){if(!ch.length){echo(`No ramo <span class="ac">${esc(BRANCH)}</span>\nnada para commitar, área de trabalho limpa`);return{ok:true};}
      echo(`No ramo <span class="ac">${esc(BRANCH)}</span>`+(STAGED.size?`\n<span class="dim">Staged:</span>\n`+[...STAGED].map(p=>`  <span class="ok">${stOf(p)==='U'?'new file:':'modified:'}   ${short(p)}</span>`).join('\n'):'')+`\n<span class="dim">Alterações:</span>\n`+ch.filter(p=>!STAGED.has(p)).map(p=>stOf(p)==='U'?`  <span class="er">untracked:  ${short(p)}</span>`:`  <span class="warn">modified:</span>   ${short(p)}`).join('\n'));}
    else if(s==='add'){ch.forEach(p=>STAGED.add(p));refresh();echo(`<span class="dim">${ch.length} ficheiro(s) em stage</span>`);}
    else if(s==='commit'){const m=(raw.match(/-m\s+(["'])(.*?)\1/)||raw.match(/-m\s+(.+)$/)||[]);const msg=(m[2]||m[1]||'').trim();if(!msg){echo('<span class="er">uso: git commit -m "mensagem"</span>');return;}const c=commitGit(msg);echo(c?`[${esc(BRANCH)} <span class="ac">${c.h}</span>] ${esc(msg)}\n <span class="dim">${c.n} ficheiro(s) alterado(s)</span>`:'<span class="dim">nada para commitar</span>');return{ok:!!c};}
    else if(s==='log')echo(COMMITS.map(c=>`<span class="ac">${c.h}</span> ${esc(c.m)}`).join('\n'));
    else if(s==='branch')echo(BRANCHES.map(b=>b===BRANCH?`<span class="ok">* ${b}</span>`:'  '+b).join('\n'));
    else if(s==='checkout'){if(BRANCHES.includes(a[1])){BRANCH=a[1];$('#st-branch-l').textContent=BRANCH;refresh();echo(`Mudou para o ramo '${esc(BRANCH)}'`);}else echo('<span class="er">ramo desconhecido: '+esc(a[1]||'')+'</span>');}
    else if(s==='diff')echo(ch.map(p=>{const d=diffStat(FS[p].orig,FS[p].content);return ` ${short(p)} | <span class="ok">+${d.add}</span> <span class="er">-${d.del}</span>`;}).join('\n')||'<span class="dim">sem diferenças</span>');
    else if(s==='push'){echo(`<span class="dim">A enviar para origin/${esc(BRANCH)}…</span>\n<span class="ok">push simulado ✓</span> <span class="dim">(o protótipo não tem remoto)</span>`);return{ok:true};}
    else echo('<span class="dim">git: status | add . | commit -m | log | branch | checkout | diff | push</span>');},
  cargo(a){const s=a[0],pk=a[1]==='-p'?a[2]:null,r=runTests(pk);
    if(s==='build'||s==='run'||s==='clippy'){if(!runTests().build){echo(`<span class="dim">   Compiling lexer v0.1.0</span>\n<span class="er">${esc(runTests().err)}</span>\n<span class="er">error: could not compile \`lexer\`</span>`);return{ok:false,sum:'build falhou (E0382)'};}
      echo(`<span class="dim">   Compiling dxtutor v0.2.0</span>\n<span class="ok">    Finished</span> dev [unoptimized] in 0.81s`+(s==='run'?'\n<span class="dim">     Running</span> target/debug/dxtutor\ndxtutor a escutar em 127.0.0.1:1420':''));return{ok:true,sum:'build ok'};}
    if(s==='test'){if(!r.build){echo(`<span class="dim">   Compiling lexer v0.1.0</span>\n<span class="er">${esc(r.err)}</span>\n<span class="er">error: could not compile \`lexer\`</span>`);return{ok:false,sum:'build falhou (E0382)'};}
      const f=r.tests.filter(t=>!t.ok).length;echo(`<span class="dim">   Compiling … Finished test in 1.2s\nrunning ${r.tests.length} tests</span>\n`+r.tests.map(t=>`test ${t.n} ... ${t.ok?'<span class="ok">ok</span>':'<span class="er">FAILED</span>'}`).join('\n')+`\n\ntest result: ${f?'<span class="er">FAILED</span>':'<span class="ok">ok</span>'}. ${r.tests.length-f} passed; ${f} failed`);
      return{ok:!f,sum:`${r.tests.length-f} passados · ${f} falhados`};}
    echo('<span class="dim">cargo: build | test [-p pkg] | run</span>');},
  npm(a){if(a[0]==='run'&&a[1]==='dev'){echo(`<span class="ok">VITE</span> pronto em 312 ms\n  ➜  Local: <span class="ac">http://localhost:1420/</span>`);return{ok:true,sum:'vite a correr'};}if(a[0]==='run'&&a[1]==='lint')return XC.dx(['lint']);echo('<span class="dim">npm: run dev | run lint</span>');},
  dx(a){const s=a[0];
    if(s==='lint'){const v=dsLint();echo(v.length?v.map(x=>`<span class="warn">aviso</span> ${short(x.p)}:${x.line}  cor fixa <span class="er">${x.hex}</span> — usar token`).join('\n')+`\n<span class="er">✖ ${v.length} violação(ões) do Design System</span>`:'<span class="ok">✓ Design System: 0 violações</span>');return{ok:!v.length,sum:v.length?v.length+' violação(ões)':'0 violações'};}
    if(s==='status'){echo(`modo <span class="ac">${MODES[MODE].l}</span> · modelo <span class="ac">${PROV[ACTIVE].name}</span> · missões ${MISSIONS.length} · checkpoints ${CKPT.length}`);return;}
    if(s==='modo'&&MODES[a[1]]){setMode(a[1]);echo('modo: '+MODES[a[1]].l);return;}
    if(s==='missao'&&(a[1]==='a'||a[1]==='b')){demo(a[1]);echo('<span class="dim">missão entregue ao Co-Dev →</span>');return;}
    echo('<span class="dim">dx: lint | status | modo manual|assist|auto | missao a|b</span>');},
};

/* ───── paleta de comandos / quick open ───── */
let PAL=null,PIDX=0,PITEMS=[];
function palette(pre,cfg){closeMenus();PAL=cfg||null;const inp=$('#pal-in');$('#pal').classList.add('show');inp.value=pre||'';inp.placeholder=cfg?cfg.ph:'Nome do ficheiro  ·  > comandos  ·  : linha';PIDX=0;palDraw();setTimeout(()=>inp.focus(),0);}
function closePal(){$('#pal').classList.remove('show');PAL=null;}
function fuzzy(q,s){q=q.toLowerCase();s=s.toLowerCase();let i=0;for(const c of s){if(c===q[i])i++;if(i===q.length)return true;}return!q.length;}
function palDraw(){const q=$('#pal-in').value;
  if(PAL){PITEMS=PAL.items?PAL.items.filter(i=>fuzzy(q,i.l)):[{l:`${PAL.verb||'Confirmar'}: ${q||'…'}`,run:()=>PAL_TEXT(q)}];}
  else if(q.startsWith('>')){const f=q.slice(1).trim();PITEMS=CMD.filter(c=>fuzzy(f,c[0])).map(c=>({l:c[0],k:c[1],run:c[2]}));}
  else if(q.startsWith(':')){const n=parseInt(q.slice(1))||1;PITEMS=[{l:'Ir para a linha '+n,run:()=>gotoLine(n)}];}
  else PITEMS=Object.keys(FS).filter(p=>fuzzy(q,short(p))).sort((a,b)=>a.split('/').pop().localeCompare(b.split('/').pop())).map(p=>({l:p.split('/').pop(),d:short(p),ic:fIcon(p),run:()=>openPath(p)}));
  PIDX=Math.min(PIDX,Math.max(0,PITEMS.length-1));
  $('#pal-list').innerHTML=PITEMS.length?PITEMS.map((it,i)=>`<div class="pi${i===PIDX?' on':''}" data-i="${i}">${it.ic||''}<span>${esc(it.l)}</span>${it.d?`<span class="d">${esc(it.d)}</span>`:''}${it.k?`<span class="key">${it.k}</span>`:''}</div>`).join(''):'<div class="pal-empty">Sem resultados.</div>';
  const on=$('#pal-list .on');if(on&&on.scrollIntoView)on.scrollIntoView({block:'nearest'});}
let PAL_TEXT=()=>{};
function palRun(i){const it=PITEMS[i];if(!it)return;if(PAL&&PAL.text)PAL_TEXT=PAL.text;closePal();it.run();}

/* ───── temas ───── */
// THEMES/THEME/setTheme migrados para src/features/theme.ts (Fase 0 por feature);
// o residual (save/loadCfg/vistas/onclick) resolve-os via window (shim transitório).

/* ───── notificações ───── */
// NOTES/UNREAD/note/drawBell/toggleNotes migraram para src/features/notifications.ts
// (Fase 1). O residual (app.ts/v6.ts) emite via window.note e o sino via window.toggleNotes.

/* ═════════ dxtutor IDE v2 — Co-Dev ═════════ */
const PROV={
  claude:{name:'Claude',vendor:'Anthropic',model:'claude-opus-5-5',ep:'https://api.anthropic.com',on:true,col:'#e08a5b'},
  gemini:{name:'Gemini',vendor:'Google',model:'gemini-pro',ep:'https://generativelanguage.googleapis.com',on:true,col:'#6ea8ff'},
  codex:{name:'Codex',vendor:'OpenAI',model:'gpt-codex',ep:'https://api.openai.com',on:true,col:'#5cc9a7'},
  ollama:{name:'Ollama',vendor:'local',model:'qwen2.5-coder:14b',ep:'http://localhost:11434',on:true,local:true,col:'#c678dd'},
};
/* ROLE/ROLE_D/ROUTE/MODES/CRIT/MISSIONS/DECS/CKPT + SPEED/MID: motor Co-Dev migrado p/ features/codev.ts (window-backed); aqui lê-se por global. */
let CID=0;window.MODE='assist';window.ACTIVE='claude';window.THRESH=85;window.CTX_ON=true;window.SAMPLE=null;
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
VIEW.analysis=(t,host)=>window.renderAnalysisPage(t,host);
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
  const pi=$('#pal-in');pi.oninput=()=>{PIDX=0;palDraw();};pi.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();PIDX=Math.min(PITEMS.length-1,PIDX+1);palDraw();}else if(e.key==='ArrowUp'){e.preventDefault();PIDX=Math.max(0,PIDX-1);palDraw();}else if(e.key==='Enter'){e.preventDefault();palRun(PIDX);}};
  $('#pal').onclick=e=>{const it=e.target.closest('.pi');if(it)palRun(+it.dataset.i);else if(!e.target.closest('.pal-box'))closePal();};
  const ai=$('#ag-input');ai.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();agSend();}};
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
  if(e.key==='Escape'){if($('#pal').classList.contains('show'))closePal();closeMenus();$('#notes').classList.remove('show');return;}
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

/* ───── git: motor (GIT/LANE/gitInit + DAG/merge/gitflow/graphLayout) migrado p/ features/scm.ts; aqui só consumidores (loadSeed, VIEW.graph, XC.git, checkpoint, gfAsk) que lêem por global ───── */
function loadSeed(){Object.keys(FS).forEach(k=>delete FS[k]);STAGED.clear();
  if(SEED_ON){Object.entries(SEED.base).forEach(([p,c])=>{FS[ROOT+p]={content:c,orig:c};});
  const s=FS[ROOT+'desktop/src/styles.css'];s.orig=s.content.replace('  --accent-hover: #f08a4b;\n','');const a=FS[ROOT+'desktop/src/assistant.ts'];a.orig=a.content.replace(/\n\/\/ v2[\s\S]*$/,'\n');
  FS[ROOT+'desktop/src/theme.css'].orig=null;}
  gitInit();}
/* authorOf + AUTHOR + commit v4 (window.commitGit) migrados p/ features/scm.ts; lidos por global (AUTHOR é window-puro, escrito aqui em runIssue/co-dev) */
/* checkout/gitMerge/isFlow/gfStart/gfFinish/gfPrompt/gfGuide/pickBranch/drawTimeline migrados p/ features/scm.ts; lidos por global */
RP.scm=()=>window.renderScmPane();/* corpo v4 migrado p/ features/scm.ts; shim delega (lazy, no switch de pane) */
/* graphLayout/openGraph migrados p/ features/scm.ts; VIEW.graph (abaixo) consome-os por global */
VIEW.graph=(t,host)=>{const L=graphLayout(),W=18,H=32,X=c=>14+c*W,Y=i=>H/2+i*H,gw=28+L.max*W;let paths='',dots='';
  L.rows.forEach((r,i)=>{const c=GIT.c[r.h];c.p.forEach((ph,k)=>{const j=L.idx[ph];if(j==null)return;const pr=L.rows[j],x0=X(r.col),y0=Y(i),xl=X(r.pl[k]),xp=X(pr.col),y1=Y(j),col=LANE[(k===0?r.col:r.pl[k])%LANE.length];
      let d=`M${x0} ${y0}`;if(j===i+1)d+=x0===xp?`L${xp} ${y1}`:`C${x0} ${y0+H*.6} ${xp} ${y1-H*.6} ${xp} ${y1}`;
      else{d+=xl===x0?`L${xl} ${y0+H}`:`C${x0} ${y0+H*.6} ${xl} ${y0+H*.4} ${xl} ${y0+H}`;d+=`L${xl} ${y1-H}`;d+=xp===xl?`L${xp} ${y1}`:`C${xl} ${y1-H*.4} ${xp} ${y1-H*.6} ${xp} ${y1}`;}
      paths+=`<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;});
    const col=LANE[r.col%LANE.length],mg=c.p.length>1;dots+=`<circle cx="${X(r.col)}" cy="${Y(i)}" r="${mg?4:5}" fill="${mg?'var(--bg-editor)':col}" stroke="${col}" stroke-width="2"/>`;});
  const refsAt=h=>Object.keys(GIT.refs).filter(b=>GIT.refs[b]===h);
  host.innerHTML=`<div class="gl"><div class="gl-bar"><button class="mini" onclick="pickBranch()">⎇ ${esc(BRANCH)} ▾</button>${BRANCH==='develop'?`<button class="mini" onclick="gfPrompt('feature')">+ feature</button><button class="mini" onclick="gfPrompt('fix')">+ fix</button><button class="mini" onclick="gfPrompt('release')">+ release</button>`:isFlow(BRANCH)?`<button class="mini pri" onclick="gfFinish()">Finalizar ${esc(BRANCH)}</button>`:`<button class="mini" onclick="checkout('develop');rerender('graph')">Ir para develop</button>`}<span class="sp"></span><span style="color:var(--fg-muted);font-size:11.5px">${GIT.order.length} commits · ${Object.keys(GIT.refs).length} ramos</span></div>
   <div class="gl-body" style="--gw:${gw}px"><svg class="gl-svg" width="${gw}" height="${L.rows.length*H}">${paths}${dots}</svg>${L.rows.map((r,i)=>{const c=GIT.c[r.h],a=authorOf(c.a),col=LANE[r.col%LANE.length],sel=GSEL===r.h;
     return `<div class="gl-row${sel?' sel':''}" onclick="GSEL=GSEL==='${r.h}'?null:'${r.h}';rerender('graph')"><span class="gl-refs">${refsAt(r.h).map(b=>`<span class="gl-ref${b===BRANCH?' head':''}" style="--c:${col}">${b===BRANCH?'● ':''}${esc(b)}</span>`).join('')}${GIT.tags[r.h]?`<span class="gl-ref tagr">${GIT.tags[r.h]}</span>`:''}</span><span class="gl-msg">${esc(c.m)}</span><span class="gl-au"><i style="background:${a.col}">${a.n.charAt(0)}</i>${esc(a.n)}</span><span class="gl-h">${r.h}</span><span class="gl-t">${rel(c.t)}</span></div>`+(sel?`<div class="gl-det">${c.files.length?c.files.map(p=>`<button class="mini" onclick="event.stopPropagation();FS['${p}']?openPath('${p}'):toast('O ficheiro não existe neste ramo')">${esc(short(p))}</button>`).join(''):'<span style="color:var(--fg-muted)">Commit anterior ao protótipo — sem lista de ficheiros.</span>'}${c.p.length>1?`<span class="tag">merge de ${c.p.length} pais</span>`:''}</div>`:'');}).join('')}</div></div>`;};
XC.git=(a,raw)=>{const s=a[0],ch=changes();
  if(s==='status'){echo(`No ramo <span class="ac">${esc(BRANCH)}</span>\n`+(ch.length?ch.map(p=>stOf(p)==='U'?`  <span class="er">untracked:  ${short(p)}</span>`:`  <span class="warn">modified:</span>   ${short(p)}`).join('\n'):'nada para commitar, área de trabalho limpa'));return{ok:true};}
  if(s==='add'){ch.forEach(p=>STAGED.add(p));refresh();echo(`<span class="dim">${ch.length} ficheiro(s) em stage</span>`);return;}
  if(s==='commit'){const m=raw.match(/-m\s+(["'])(.*?)\1/)||raw.match(/-m\s+(.+)$/)||[],msg=(m[2]||m[1]||'').trim();if(!msg){echo('<span class="er">uso: git commit -m "mensagem"</span>');return;}const c=commitGit(msg);echo(c?`[${esc(BRANCH)} <span class="ac">${c.h}</span>] ${esc(msg)}`:'<span class="dim">nada para commitar</span>');return{ok:!!c};}
  if(s==='log'){const L=graphLayout();echo(L.rows.slice(0,14).map(r=>{const c=GIT.c[r.h],rf=Object.keys(GIT.refs).filter(b=>GIT.refs[b]===r.h);return `<span class="dim">${'│ '.repeat(r.col)}${c.p.length>1?'◆':'●'}</span> <span class="ac">${r.h}</span>${rf.length?` <span class="ok">(${rf.join(', ')})</span>`:''} ${esc(c.m)}`;}).join('\n'));return;}
  if(s==='branch'){echo(Object.keys(GIT.refs).map(b=>b===BRANCH?`<span class="ok">* ${b}</span>`:'  '+b).join('\n'));return;}
  if(s==='checkout'){const nb=a[1]==='-b',b=nb?a[2]:a[1];if(!b){echo('<span class="er">uso: git checkout [-b] &lt;ramo&gt;</span>');return;}echo(checkout(b,nb)?`Mudou para o ramo '${esc(b)}'`:'<span class="er">não foi possível mudar para '+esc(b)+'</span>');rerender('graph');return;}
  if(s==='merge'){const m=a[1]&&gitMerge(a[1]);echo(m?`Merge feito: <span class="ac">${m.h}</span> ${esc(m.m)}`:'<span class="er">uso: git merge &lt;ramo&gt;</span>');rerender('graph');return{ok:!!m};}
  if(s==='flow'){if(a[2]==='start'&&a[3]){gfStart(a[1],a[3]);echo(`Ramo <span class="ac">${esc(BRANCH)}</span> criado`);}else if(a[2]==='finish'){const m=gfFinish();echo(m?'Finalizado: '+esc(m.m):'<span class="er">não estás num ramo de gitflow</span>');}else echo('<span class="dim">git flow feature|fix|release|hotfix start &lt;nome&gt; · git flow x finish</span>');return;}
  if(s==='diff'){echo(ch.map(p=>{const d=diffStat(FS[p].orig,FS[p].content);return ` ${short(p)} | <span class="ok">+${d.add}</span> <span class="er">-${d.del}</span>`;}).join('\n')||'<span class="dim">sem diferenças</span>');return;}
  if(s==='push'){echo(`<span class="ok">push simulado ✓</span> <span class="dim">origin/${esc(BRANCH)} (o protótipo não tem remoto)</span>`);return{ok:true};}
  echo('<span class="dim">git: status | add . | commit -m | log | branch | checkout [-b] | merge | flow | diff | push</span>');};
function checkpoint(label){const c={id:++CID,label,t:hhmm(),fs:JSON.stringify(FS),git:JSON.stringify(GIT),br:BRANCH};CKPT.unshift(c);log('checkpoint',label);return c.id;}
function restoreCkpt(id,silent){const c=CKPT.find(x=>x.id===id);if(!c)return;Object.keys(FS).forEach(k=>delete FS[k]);Object.assign(FS,JSON.parse(c.fs));Object.assign(GIT,JSON.parse(c.git));BRANCH=c.br;$('#st-branch-l').textContent=BRANCH;STAGED.clear();refresh(false,true);termRefreshPrompt();log('checkpoint','restaurado: '+c.label);if(!silent)toast('Restaurado: '+c.label);}
async function gfAsk(host,M){const b=BRANCH;if(!/^(feature|fix)\//.test(b))return;if([...M.files].some(p=>stOf(p))){host.insertAdjacentHTML('beforeend',`<p>Gitflow: o ramo <code>${esc(b)}</code> fica aberto com alterações por commitar.</p>`);return;}
  const go=MODE==='auto'?1:await ask(host,[{l:`Finalizar: merge de ${b} em develop`,v:1,pri:1,done:'✓ merge aprovado por ti'},{l:'Manter o ramo aberto',v:0,done:'ramo mantido'}]);
  if(go){const m=gfFinish(b);host.insertAdjacentHTML('beforeend',`<p>Gitflow: <code>${esc(b)}</code> → <code>develop</code> (merge <code>${m.h}</code>), ramo apagado. A release para <code>main</code> fica sempre contigo.</p>`);}}

/* ───── equipa: vários assistentes, cada um com o seu harness ───── */
const AGENTS={
  lead:{n:'Co-Dev',d:'Orquestrador: decompõe, delega e integra',col:'#e06c3b',paths:['**'],cmds:['*'],task:'arch',model:'auto',max:20},
  arq:{n:'Arquitecto',d:'Requisitos, arquitectura, ADRs e backlog',col:'#e08a5b',paths:['.dxtutor/**','docs/**'],cmds:[],task:'arch',model:'auto',max:4},
  be:{n:'Backend',d:'Crates Rust e comandos Tauri',col:'#dea584',paths:['crates/**'],cmds:['cargo build','cargo test','cargo clippy'],task:'code',model:'auto',max:6},
  db:{n:'Base de dados',d:'Esquema, migrações e índices',col:'#5cc9a7',paths:['db/migrations/**'],cmds:['cargo test -p store'],task:'db',model:'auto',max:3},
  fe:{n:'Frontend',d:'Interface e Design System',col:'#6ea8ff',paths:['desktop/src/**'],cmds:['dx lint','npm run dev','npm run lint'],task:'ui',model:'auto',max:6},
  qa:{n:'QA',d:'Testes automáticos',col:'#e0b64a',paths:['crates/*/tests/**','tests/**'],cmds:['cargo test','dx lint','dx test'],task:'test',model:'auto',max:6},
  ops:{n:'Plataforma',d:'Infra, CI/CD e deploy',col:'#c678dd',paths:['deploy/**','.ci/**','Cargo.toml'],cmds:['cargo build','git push'],task:'ops',model:'auto',max:4},
  tutor:{n:'Tutor',d:'Explica e orienta; nunca escreve por ti',col:'#5fcad6',paths:[],cmds:[],task:'teach',model:'auto',max:0}};
window.AGENT='lead';
const globRe=g=>new RegExp('^'+g.split('**').map(s=>s.split('*').map(x=>x.replace(/[.+^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$');
const inScope=(a,p)=>AGENTS[a].paths.some(g=>globRe(g).test(short(p)));
const canRun=(a,cmd)=>AGENTS[a].cmds.some(c=>c==='*'||cmd.startsWith(c));
const ownerOf=p=>Object.keys(AGENTS).find(k=>k!=='lead'&&inScope(k,p))||'lead';
function harnessCheck(p){if(!inScope(AGENT,p)){const o=ownerOf(p);throw new Error(`fora do escopo do assistente ${AGENTS[AGENT].n}. Pode escrever em: ${AGENTS[AGENT].paths.join(', ')||'nada'}. Este caminho pertence a: ${AGENTS[o].n}.`);}}
function harnessCmd(c){if(!canRun(AGENT,c))throw new Error(`o assistente ${AGENTS[AGENT].n} não tem permissão para correr "${c}".`);}
const agentSys=()=>{const a=AGENTS[AGENT];return `\nÉs o assistente «${a.n}» (${a.d}). Harness: só podes escrever em [${a.paths.join(', ')||'nenhum caminho'}] e correr [${a.cmds.join(', ')||'nenhum comando'}]. Se a tarefa exigir sair deste escopo, não o faças: diz que assistente da equipa (${Object.values(AGENTS).map(x=>x.n).join(', ')}) deve tratar dessa parte.`+(AGENT==='tutor'?'\nComo Tutor: não dês a solução completa. Faz perguntas, explica o conceito, dá pistas graduais e pede ao aluno que tente.':'');};
function saveTeam(){LS.set('team3',Object.fromEntries(Object.entries(AGENTS).map(([k,a])=>[k,{paths:a.paths,cmds:a.cmds,model:a.model,max:a.max}])));}
function loadTeam(){const t=LS.get('team3',null);if(t)Object.keys(AGENTS).forEach(k=>{if(t[k]){['paths','cmds'].forEach(f=>{if(Array.isArray(t[k][f]))AGENTS[k][f]=t[k][f];});if(t[k].model)AGENTS[k].model=t[k].model;if(t[k].max!=null)AGENTS[k].max=t[k].max;}});}
function pickAgent(){palette('',{ph:'Com que assistente queres falar?',items:Object.entries(AGENTS).map(([k,a])=>({l:a.n,d:a.d,run:()=>{AGENT=k;agentPill();toast('Assistente: '+a.n);}}))});}
function agentPill(){const p=$('#pill-agent');if(p){p.innerHTML=`<span class="pdot" style="background:${AGENTS[AGENT].col}"></span>${AGENTS[AGENT].n}`;}}
function openTeam$dup0(){openTab({id:'team',title:'Equipa',kind:'team'});}
function scopeProbe(v){const o=$('#probe-out');if(!v.trim()){o.textContent='';return;}const who=Object.keys(AGENTS).filter(k=>k!=='lead'&&inScope(k,norm(v)));o.innerHTML=who.length?'Pode escrever: '+who.map(k=>`<b style="color:${AGENTS[k].col}">${AGENTS[k].n}</b>`).join(', '):'Nenhum assistente especializado — só o orquestrador, com a tua aprovação.';}
VIEW.team=(t,host)=>{host.innerHTML=`<div class="page"><h1>Equipa de assistentes</h1><div class="sub">Cada assistente tem uma responsabilidade e um <b>harness</b>: os caminhos onde pode escrever, os comandos que pode correr e o limite de ficheiros por tarefa. O harness é aplicado em cada chamada de ferramenta — se um assistente tentar sair do escopo, a acção é bloqueada e delegada a quem é dono do caminho.</div>
  <h2>Testar o escopo</h2><div class="tbl-wrap"><div class="rowline"><input class="inp" style="margin:0;width:320px" placeholder="ex.: db/migrations/0005_x.sql" oninput="scopeProbe(this.value)"><span id="probe-out" style="color:var(--fg-dim)"></span></div></div>
  <h2>Assistentes</h2><div class="pgrid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${Object.entries(AGENTS).map(([k,a])=>`<div class="pcard"><div class="ph"><span class="av" style="background:${a.col}">${a.n.charAt(0)}</span>${a.n}${AGENT===k?'<span class="tag acc">na conversa</span>':`<button class="mini" style="margin-left:auto" onclick="AGENT='${k}';agentPill();show(cur)">Falar</button>`}</div><div class="pd">${a.d}</div>
    <div><label>Pode escrever em (um padrão por linha)</label><textarea rows="2" onchange="AGENTS.${k}.paths=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.paths.join('\n'))}</textarea></div>
    <div><label>Comandos permitidos</label><textarea rows="2" onchange="AGENTS.${k}.cmds=this.value.split('\\n').map(s=>s.trim()).filter(Boolean);saveTeam()">${esc(a.cmds.join('\n'))}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><div><label>Modelo</label><select onchange="AGENTS.${k}.model=this.value;saveTeam()"><option value="auto"${a.model==='auto'?' selected':''}>Automático (router)</option>${Object.entries(PROV).map(([p,v])=>`<option value="${p}"${a.model===p?' selected':''}>${v.name}</option>`).join('')}</select></div><div><label>Máx. ficheiros</label><input type="number" min="0" max="50" value="${a.max}" onchange="AGENTS.${k}.max=+this.value;saveTeam()"></div></div></div>`).join('')}</div>
  <h2>Router de modelos</h2><div class="sub">Com o modelo em «Automático», o assistente descreve a tarefa e pede o modelo mais adequado. Os perfis abaixo são valores de exemplo, editáveis na aplicação real.</div><div class="tbl-wrap"><table class="tbl"><tr><th>Provedor</th>${Object.keys(CAPL).map(c=>`<th>${CAPL[c]}</th>`).join('')}</tr>${Object.entries(PROV).map(([p,v])=>`<tr><td><span class="pdot${v.on?'':' off'}" style="background:${v.col}"></span> ${v.name}</td>${Object.keys(CAPL).map(c=>`<td class="c">${CAP[p][c]}</td>`).join('')}</tr>`).join('')}</table></div>
  <div class="tbl-wrap" style="margin-top:10px">${Object.entries(TASKP).map(([k,p])=>{const r=rankModels(k);return `<div class="rowline"><b style="width:210px;flex:none">${p.l}</b><span style="color:var(--fg-muted)">${Object.entries(p.w).map(([c,w])=>CAPL[c]+' ×'+w).join(' · ')}</span><span class="sp"></span>${r.length?`<span class="pdot" style="background:${PROV[r[0].p].col}"></span>${PROV[r[0].p].name}`:'—'}</div>`;}).join('')}</div></div>`;};

/* ───── router: motor (CAPL/CAP/TASKP/ROUTE_CACHE/LIVE_OK/rankModels/routeModel) migrado p/ features/router.ts; aqui só consumidores (VIEW.team, genBacklog, runIssue) que lêem por global ───── */

/* ───── Studio: estado + motor de desenho (NT/ST_SEED/SD/SSEL/SLINK/SCAT/NW/NH/saveSD/openStudio/sdAdd/sdDel/drawStudio) migrado p/ features/studio.ts ───── */

/* ───── backlog, sprints e kanban: estado (BL/STAGES) + motor (mkIssue/setStage/
   runIssue/delegate/runSprint/approveIssue/autoTest/dropIssue/rejectIssue/newIssue/
   openBoard) + produtor (genBacklog/genBacklogIssues) migrados p/ features/board.ts;
   tplNode + genBacklog$dup0 (código morto) eliminados. Aqui só o shim de VIEW.board
   (eager; v5/v6 decoram-no) e os decoradores/consumidores que lêem por global. ───── */
VIEW.board=(t,host)=>window.renderBoardView(t,host);

/* ───── Tutor: percursos de aprendizagem sobre o código real ───── */
const LF=p=>ROOT+'learn/'+p;/* usado pela secção morta LEARN (eager, abaixo) e por features/learn.ts (ltPath, lazy, via window.LF) */
const LEARN=[
 {id:'rust',t:'Rust: ownership e iteradores',d:'Do erro E0382 à correcção idiomática.',ls:[
  {id:'own',t:'Mover ou emprestar',x:'Em Rust cada valor tem um dono. Um <code>for x in v</code> <b>move</b> <code>v</code> para dentro do ciclo: depois dele, <code>v</code> já não te pertence. Para continuar a usá-lo, o ciclo tem de o <b>emprestar</b>.',file:LF('rust/01_ownership.rs'),seed:'// Exercício: faz compilar sem clonar `nomes`.\nfn main() {\n    let nomes = vec![String::from("ana"), String::from("rui")];\n    for n in nomes {\n        println!("{}", n);\n    }\n    println!("total: {}", nomes.len());\n}\n',chk:c=>/for \w+ in (&nomes|nomes\.iter\(\))/.test(c)&&!/clone/.test(c),h:['O que acontece a <code>nomes</code> quando entra no <code>for</code>?','O ciclo não precisa de ser dono do vector: basta-lhe uma referência.','Experimenta <code>for n in &nomes</code>.']},
  {id:'byref',t:'Aplicar no projecto: o E0382 do lexer',x:'O mesmo erro existe em <code>crates/lexer/src/lib.rs</code>: o <code>for</code> move o iterador <code>chars</code> e a linha 10 volta a usá-lo. Um iterador empresta-se com <code>by_ref()</code>.',open:P_LX,line:5,chk:()=>!lexBug()&&runTests('lexer').ok,h:['Lê a mensagem em Problems: que valor foi movido e onde?','Não clones — isso deixaria o iterador original por consumir e o teste <code>tokenize_emits_eof</code> falharia.','<code>for c in chars.by_ref()</code>']}]},
 {id:'sql',t:'Base de dados: índices e integridade',d:'Listagens rápidas e dados coerentes.',ls:[
  {id:'idx',t:'Um índice que cobre o filtro e a ordenação',x:'Uma listagem «por workspace, das mais recentes para as mais antigas» filtra por uma coluna e ordena por outra. Sem índice composto, a base de dados percorre a tabela toda.',file:LF('sql/01_indice.sql'),seed:'-- Exercício: cria o índice que serve esta query.\n-- SELECT * FROM notes WHERE workspace_id = ? ORDER BY created_at DESC;\nCREATE TABLE notes (\n  id           TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL,\n  created_at   INTEGER NOT NULL\n);\n',chk:c=>/CREATE INDEX\s+\w+\s+ON\s+notes\s*\(\s*workspace_id\s*,\s*created_at/i.test(c),h:['Que colunas aparecem no <code>WHERE</code> e no <code>ORDER BY</code>?','A ordem das colunas no índice conta: primeiro a do filtro.','<code>CREATE INDEX idx_notes ON notes (workspace_id, created_at DESC);</code>']},
  {id:'fk',t:'Quem apaga os filhos?',x:'Segundo <code>base-de-dados.md</code>, quando um registo filho não vive sem o pai, a chave estrangeira leva <code>ON DELETE CASCADE</code>.',quiz:{q:'Apagas um workspace. O que deve acontecer às conversas dele?',o:['Ficam órfãs, para auditoria','São apagadas em cascata pela chave estrangeira','A aplicação apaga-as uma a uma'],a:1}}]},
 {id:'pat',t:'Padrão Repository e camadas',d:'Porque é que a UI nunca vê SQL.',ls:[
  {id:'layers',t:'Onde vive o SQL',x:'O <b>ADR-002</b> define as camadas: UI → comandos Tauri → domínio → <code>crates/store</code>.',quiz:{q:'A vista do histórico precisa da lista de conversas. Como a obtém?',o:['Faz o SELECT directamente','Chama um comando Tauri, que usa o Repository','Lê o ficheiro SQLite'],a:1}},
  {id:'repo',t:'Escrever um Repository',x:'Um Repository é um <code>trait</code> com as operações de dados; a implementação concreta (SQLite) é um detalhe que pode mudar.',file:LF('padroes/01_repository.rs'),seed:'// Exercício: declara o trait `NoteRepo` com dois métodos:\n//   save(&self, note: &Note) e list(&self, workspace_id: &str)\npub struct Note {\n    pub id: String,\n    pub workspace_id: String,\n}\n\n',chk:c=>/pub trait NoteRepo/.test(c)&&/fn save\(&self/.test(c)&&/fn list\(&self/.test(c),h:['Um trait só declara assinaturas — não tem corpo.','Ambos os métodos recebem <code>&self</code>.','<code>pub trait NoteRepo { fn save(&self, note: &Note); fn list(&self, workspace_id: &str) -> Vec&lt;Note&gt;; }</code>']}]},
 {id:'gf',t:'Gitflow na prática',d:'Feito no git deste IDE, não em teoria.',ls:[
  {id:'gf1',t:'Começar uma feature',x:'Nenhum trabalho se faz directamente em <code>develop</code>. Cria um ramo <code>feature/…</code> (Source Control → Iniciar feature, ou <code>git flow feature start nome</code> no terminal).',chk:()=>/^feature\//.test(BRANCH),h:['Abre o painel Source Control.','Na secção «Gitflow — próximo passo» há um botão.','No terminal: <code>git flow feature start aprender</code>']},
  {id:'gf2',t:'Commit e finalizar',x:'Altera um ficheiro, faz commit no ramo e finaliza a feature: o merge em <code>develop</code> aparece no grafo de commits.',chk:()=>/^Merge feature\//.test(GIT.c[GIT.refs.develop].m)&&Date.now()-GIT.c[GIT.refs.develop].t<3600e3,h:['Precisas de pelo menos um commit no ramo.','Depois do commit, «Finalizar feature» faz o merge.','<code>git add .</code> → <code>git commit -m "..."</code> → <code>git flow feature finish</code>']}]}];
const LP=LS.get('learn',{done:{},hints:{}});let LCUR=['rust','own'];
const saveLP=()=>LS.set('learn',LP),lkey=(p,l)=>p+'.'+l,pathPct=p=>Math.round(p.ls.filter(l=>LP.done[lkey(p.id,l.id)]).length/p.ls.length*100);
function openLesson$dup0(p,l){LCUR=[p,l];openTab({id:'learn',title:'Tutor',kind:'learn'});if(PANE==='tutor')RP.tutor();}
function lessonOpen(){const P=LEARN.find(x=>x.id===LCUR[0]),L=P.ls.find(x=>x.id===LCUR[1]);if(L.file){if(!FS[L.file])writeFile(L.file,L.seed);openPath(L.file);}else if(L.open)openPath(L.open,L.line);}
function lessonCheck(){const P=LEARN.find(x=>x.id===LCUR[0]),L=P.ls.find(x=>x.id===LCUR[1]),k=lkey(P.id,L.id),ok=L.file?(FS[L.file]?L.chk(FS[L.file].content):false):L.chk();
  if(ok){LP.done[k]=1;saveLP();toast('✓ '+L.t);}LP.last={k,ok,msg:ok?'Certo. '+(LP.hints[k]?`Usaste ${LP.hints[k]} pista(s).`:'Sem pistas.'):L.file&&!FS[L.file]?'Abre primeiro o exercício.':'Ainda não. Relê o enunciado ou pede uma pista.'};rerender('learn');if(PANE==='tutor')RP.tutor();}
function lessonHint(){const k=lkey(...LCUR);LP.hints[k]=Math.min(3,(LP.hints[k]||0)+1);saveLP();rerender('learn');}
function lessonQuiz(i){const P=LEARN.find(x=>x.id===LCUR[0]),L=P.ls.find(x=>x.id===LCUR[1]),k=lkey(P.id,L.id),ok=i===L.quiz.a;if(ok){LP.done[k]=1;saveLP();}LP.last={k,ok,msg:ok?'Certo.':'Não é essa. Volta a ler a regra e tenta outra vez.',pick:i};rerender('learn');if(PANE==='tutor')RP.tutor();}
function lessonAsk(){const P=LEARN.find(x=>x.id===LCUR[0]),L=P.ls.find(x=>x.id===LCUR[1]),k=lkey(P.id,L.id);AGENT='tutor';agentPill();focusAgent(true);
  if(SAMPLE&&PROV.claude.on){ACTIVE='claude';updateAgentUI();const src=L.file&&FS[L.file]?`\nO meu código actual:\n${FS[L.file].content}`:'';liveChat(`Estou na lição «${L.t}» do percurso «${P.t}». Não percebo como avançar. Ajuda-me sem me dares a solução.${src}`);}
  else{user(`Tutor, preciso de ajuda na lição «${L.t}».`);LP.hints[k]=Math.min(3,(LP.hints[k]||0)+1);saveLP();card('tutor',`<p>${L.h?L.h[LP.hints[k]-1]:'Relê a regra do projecto citada no enunciado e elimina as opções que a violam.'}</p><p style="color:var(--fg-dim)">Com o Claude ao vivo, respondo às tuas dúvidas sobre o teu código em vez de dar pistas fixas.</p>`);rerender('learn');}}
function nextLesson$dup0(){for(const p of LEARN)for(const l of p.ls)if(!LP.done[lkey(p.id,l.id)])return[p.id,l.id];return null;}
const DIAG2LESSON=[[/E0382/,'rust','byref'],[/design-system/,'pat','layers'],[/ORDER BY/,'sql','idx']];
RP.tutor=()=>{const nx=nextLesson(),dg=diagnostics().map(d=>({d,m:DIAG2LESSON.find(x=>x[0].test(d.msg))})).filter(x=>x.m);
  $('#pane-tutor').innerHTML=hd('Tutor')+`<div class="sections">${nx?`<div class="scm-grp">Continuar</div><div class="scm-row" onclick="openLesson('${nx[0]}','${nx[1]}')"><span class="ic" style="color:var(--accent-hover)">${svg('run')}</span><span class="nm" style="max-width:none">${esc(LEARN.find(p=>p.id===nx[0]).ls.find(l=>l.id===nx[1]).t)}</span></div>`:'<div class="sec-empty">Todos os percursos concluídos.</div>'}
   ${dg.length?`<div class="scm-grp">A partir do teu código<span class="cnt">${dg.length}</span></div>`+dg.map(x=>`<div class="scm-row" onclick="openLesson('${x.m[1]}','${x.m[2]}')" title="${esc(x.d.msg)}"><span class="pi ${x.d.sev}" style="color:var(--${x.d.sev==='e'?'red':'yellow'})">${x.d.sev==='e'?'✖':'⚠'}</span><span class="nm" style="max-width:none">${esc(x.d.msg.split(':')[0])} → lição</span></div>`).join(''):''}
   ${LEARN.map(p=>`<div class="scm-grp">${esc(p.t)}<span class="cnt">${pathPct(p)}%</span></div><div class="lp-bar"><i style="width:${pathPct(p)}%"></i></div>${p.ls.map(l=>`<div class="scm-row${LCUR[0]===p.id&&LCUR[1]===l.id?' cur':''}" onclick="openLesson('${p.id}','${l.id}')"><span style="width:14px;text-align:center;color:${LP.done[lkey(p.id,l.id)]?'var(--green)':'var(--fg-muted)'}">${LP.done[lkey(p.id,l.id)]?'✓':'○'}</span><span class="nm" style="max-width:none">${esc(l.t)}</span></div>`).join('')}`).join('')}</div>`;};
VIEW.learn=(t,host)=>{const P=LEARN.find(x=>x.id===LCUR[0]),L=P.ls.find(x=>x.id===LCUR[1]),k=lkey(P.id,L.id),done=LP.done[k],hn=LP.hints[k]||0,last=LP.last&&LP.last.k===k?LP.last:null,i=P.ls.indexOf(L),nx=P.ls[i+1]||(LEARN[LEARN.indexOf(P)+1]||{}).ls&&LEARN[LEARN.indexOf(P)+1].ls[0],nxp=P.ls[i+1]?P.id:(LEARN[LEARN.indexOf(P)+1]||{}).id;
  host.innerHTML=`<div class="page" style="max-width:760px"><div style="display:flex;gap:8px;align-items:center;color:var(--fg-muted);font-size:12px;margin-bottom:6px"><span class="tag acc">${esc(P.t)}</span>lição ${i+1} de ${P.ls.length}<span class="lp-bar" style="flex:1;margin:0"><i style="width:${pathPct(P)}%"></i></span>${pathPct(P)}%</div>
   <h1>${esc(L.t)} ${done?'<span class="tag live" style="vertical-align:middle">concluída</span>':''}</h1><div class="lesson">${L.x}</div>
   ${L.quiz?`<h2>Pergunta</h2><div class="lesson" style="margin-bottom:8px"><b>${L.quiz.q}</b></div>${L.quiz.o.map((o,j)=>`<button class="qopt${last&&last.pick===j?(last.ok?' pick':' wrong'):''}" onclick="lessonQuiz(${j})"><span class="ql">${o}</span></button>`).join('')}`
    :`<h2>Exercício</h2><div class="tbl-wrap"><div class="rowline"><span>${fIcon(L.file||L.open)}</span><b>${esc(short(L.file||L.open))}</b><span style="color:var(--fg-muted)">${L.file?'ficheiro de treino, fora do git':'ficheiro real do projecto'}</span><span class="sp"></span><button class="mini" onclick="lessonOpen()">Abrir no editor</button><button class="mini pri" onclick="lessonCheck()">Verificar</button></div></div>`}
   ${last?`<div class="fb ${last.ok?'ok':'no'}">${last.ok?'✓':'✗'} ${last.msg}</div>`:''}
   <h2>Ajuda</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${L.h?`<button class="mini" onclick="lessonHint()"${hn>=3?' disabled':''}>Pedir pista (${hn}/3)</button>`:''}<button class="mini" onclick="lessonAsk()">Perguntar ao Tutor</button>${nx?`<button class="mini${done?' pri':''}" style="margin-left:auto" onclick="openLesson('${nxp}','${nx.id}')">Lição seguinte →</button>`:''}</div>
   ${L.h?L.h.slice(0,hn).map((h,j)=>`<div class="hint"><b>Pista ${j+1}</b> ${h}</div>`).join(''):''}
   <div class="sub" style="margin-top:22px">O Tutor não escreve por ti: o harness dele não tem nenhum caminho de escrita. Os exercícios são verificados sobre o que tu escreveste no editor.</div></div>`;};

/* ───── integração com o resto do IDE ───── */
function tabIc$dup1(t){if(t.kind==='file')return fIcon(t.title);const m={agent:'sparkle',welcome:'sparkle',diff:'scm',settings:'settings',manager:'graph',analysis:'book',graph:'scm',team:'account',studio:'cube',board:'split',learn:'book'};return `<span class="ic acc">${svg(m[t.kind]||'file')}</span>`;}
function buildActivity(){const bar=$('#activity');bar.innerHTML='';ACTS.forEach(a=>{const el=document.createElement('button');el.className='act'+(a.spacer?' spacer':'')+(a.sep?' sep':'');el.title=a.title;el.dataset.pane=a.pane||'';el.innerHTML=svg(a.ic)+`<span class="badge${a.acc?' acc':''}" style="display:none"></span>`;
  el.onclick=e=>{e.stopPropagation();a.overflow?openOverflow(el):a.run?a.run():setPane(a.pane,true);};bar.appendChild(el);});}
function resetAll(){if(RUN.active){toast('Pára a execução primeiro');return;}loadSeed();MISSIONS.length=0;DECS.length=0;CKPT.length=0;CHAT.length=0;BL.issues.length=0;BL.seq=11;BL.mig=3;BL.adr=4;SD=JSON.parse(JSON.stringify(ST_SEED));saveSD();TB=[];newChat();refresh(false,true);openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'});toast('Protótipo reposto ao estado inicial');}
const _refresh=refresh;refresh=function(a,b){_refresh(a,b);if(!a){const t=tabOf(cur);if(t&&(t.kind==='graph'||t.kind==='board')){const top=$('#ebody').scrollTop;show(cur);$('#ebody').scrollTop=top;}}blame();};
const _stLang=stLang;stLang=function(){_stLang();blame();};
function blame(){const el=$('#st-blame'),t=tabOf(cur);if(!el)return;if(!t||!t.path||t.kind!=='file'){el.textContent='';return;}const h=GIT.order.find(x=>GIT.c[x].files.includes(t.path)),c=h?GIT.c[h]:GIT.c['1a2b3c4'];el.textContent=stOf(t.path)?'Tu · alterações por commitar':`${authorOf(c.a).n}, ${rel(c.t)} · ${c.m.slice(0,38)}`;el.onclick=()=>openGraph(c.h);}
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
  $('.comp-bar').insertAdjacentHTML('afterbegin','<button class="pill" id="pill-agent" title="Assistente da conversa" onclick="pickAgent()"></button>');agentPill();
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
window.STACK=null;
function composeServices(){const c=FS[ROOT+'docker-compose.yml'];if(!c)return null;const out=[];let cur=null,on=false,dep=false;c.content.split('\n').forEach(l=>{if(/^services:/.test(l)){on=true;return;}if(/^\S/.test(l)&&!/^services:/.test(l))on=false;if(!on)return;let m;if(/^    \S/.test(l))dep=/^    depends_on:/.test(l);
    if((m=l.match(/^  ([a-z0-9][\w-]*):\s*$/))){cur={name:m[1],deps:[]};out.push(cur);}else if(cur){if((m=l.match(/^    image:\s*(.+)/)))cur.image=m[1];if((m=l.match(/^    build:\s*\.\/(.+)/)))cur.build=m[1];if((m=l.match(/^      - "(\d+):\d+"/)))cur.port=m[1];if((m=l.match(/PathPrefix\(`([^`]+)`\)/)))cur.route=m[1];if(dep&&(m=l.match(/^      (?:- )?([a-z0-9][\w-]*):?\s*$/)))cur.deps.push(m[1]);if(/healthcheck:/.test(l))cur.hc=true;}});return out;}
window.dxRun = function(term){if(term!==true){setPanelTab('terminal',true);echoCmd('docker compose up --build -d');}const sv=composeServices();
  if(!sv){echo(`<span class="er">no configuration file provided: not found</span>\n<span class="dim">docker-compose.yml does not exist on ${esc(BRANCH)}. Generate the backlog from the Studio, run the sprints and validate the issues — the merge into develop brings the artefacts.</span>`);newInput(true);toast('Nothing to run yet — generate and validate the project first');return{ok:false,sum:'no compose file'};}
  const miss=sv.filter(s=>s.build&&!FS[ROOT+s.build+'/Dockerfile']);if(miss.length){echo(miss.map(s=>`<span class="er">failed to solve: failed to read dockerfile: open ${s.build}/Dockerfile: no such file or directory</span>`).join('\n')+`\n<span class="dim">Validate the pending issues on the board so their branches are merged.</span>`);newInput(true);return{ok:false,sum:'missing Dockerfile'};}
  const gw=sv.find(s=>/traefik/.test(s.image||'')),order=[];const visit=s=>{if(order.includes(s))return;s.deps.forEach(d=>{const x=sv.find(y=>y.name===d);if(x)visit(x);});order.push(s);};sv.forEach(visit);
  echo(sv.filter(s=>s.build).map(s=>`<span class="dim">[+] Building</span> ${s.name} <span class="dim">(${s.build}/Dockerfile)</span> <span class="ok">FINISHED</span>`).join('\n')+'\n'+sv.filter(s=>s.image).map(s=>`<span class="dim">[+] Pulling</span> ${s.name} <span class="dim">${esc(s.image)}</span> <span class="ok">done</span>`).join('\n')+'\n'+order.map(s=>` <span class="ok">✔</span> Container ${s.name}  <span class="ok">${s.hc?'Healthy':'Started'}</span>`).join('\n'));
  STACK=order.map(s=>({name:s.name,src:s.build?'build ./'+s.build:s.image,url:s.route&&gw?`http://localhost:8080${s.route}`:s.port?`http://localhost:${s.port}`:'internal',state:s.hc?'healthy':'running'}));
  echo(`\n<span class="ac">${STACK.length} services up</span> <span class="dim">· simulated: a browser cannot start containers. In the desktop app this is the real</span> docker compose up --build`+STACK.filter(s=>s.url!=='internal').map(s=>`\n  ➜  ${s.name.padEnd(18)} <span class="ac">${s.url}</span>`).join(''));newInput(true);drawStack();setPanelTab('services');toast(`${STACK.length} services up`);return{ok:true,sum:STACK.length+' services up'};}
window.dxStop = function(term){if(!STACK){toast('Nothing is running');if(term===true)echo('<span class="dim">no containers</span>');return;}if(term!==true)echoCmd('docker compose down');echo(STACK.slice().reverse().map(s=>` <span class="ok">✔</span> Container ${s.name}  <span class="dim">Removed</span>`).join('\n'));newInput(true);STACK=null;drawStack();}
window.drawStack = function(){const el=$('#pc-services'),st=$('#st-stack');if(st){st.textContent=STACK?`▶ ${STACK.length} services`:'';st.style.display=STACK?'':'none';}if(!el)return;
  el.innerHTML=STACK?`<div class="svc-h"><b>${STACK.length} services running</b><span class="tag warn">simulated</span><span class="sp"></span><button class="mini" onclick="dxStop()">■ Stop</button></div><table class="tbl">${STACK.map(s=>`<tr><td><span class="pdot" style="background:var(--green)"></span> <span class="notr">${esc(s.name)}</span></td><td class="c notr">${esc(s.src)}</td><td class="notr">${s.url==='internal'?'<span style="color:var(--fg-muted)">internal</span>':esc(s.url)}</td><td class="c">${s.state}</td></tr>`).join('')}</table>`
    :`<div class="sec-empty">Nothing is running. <b>▶ RUN</b> builds every Dockerfile and starts the stack described by <code>docker-compose.yml</code>.</div><button class="mini pri" style="margin-left:16px" onclick="dxRun()">▶ RUN</button>`;}
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
const _settings=VIEW.settings;VIEW.settings=(t,host)=>{_settings(t,host);host.querySelector('.sub').insertAdjacentHTML('afterend',`<h2>Language</h2><div class="pgrid">${LOCALES.map(l=>`<button class="pcard${LOCALE===l[0]?' sel':''}" onclick="setLocale('${l[0]}')"><div class="ph notr">${l[1]}${LOCALE===l[0]?'<span class="tag acc">✓</span>':''}</div><div class="pd">${l[2]}</div></button>`).join('')}</div>`);};
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
  AGENTS, CMD, FS, LS,
  OPEN, PANE, PROV, ROOT, RP, RUN, STOP, VIEW,
  XC, agentPill,
  badges, blame, boot, boot3, boot4, buildActivity, buildExplorer, buildMenus,
  checkpoint, closePal, closeTab, collapseAll, composeServices,
  diagnostics, diffLines, diffStat,
  drawOutline, drawProblems, drawTabs, dsLint, edCmd, esc, fIcon, fuzzy, gfAsk, goPane, gotoLine, harnessCheck, harnessCmd,
  hlLine, hydrate, lessonAsk,
  lessonCheck, lessonHint, lessonOpen, lessonQuiz, loadCfg, loadSeed, loadTeam, log,
  markActive, mdFull, miniOff, newFile,
  newFolder, newInput, nextProblem, openDiff, openFile,
  openPath, openTab, paintEd, palDraw, palRun, palette,
  parkAgent, pickAgent, renderLevel,
  rerender, resetAll, restoreCkpt, runTask, runTests,
  save, saveTeam, scopeProbe, selText, setActive, setPane, setPanelTab, show, stLang, stPos,
  stepTab, symbols, tabIc, tabOf, termRefreshPrompt, togglePanel,
  toggleSide, use,
  who, writeFile,
  // núcleo partilhado que o motor Co-Dev (features/codev.ts) lê por global (defs ficam donas do monólito):
  CHAT, SEED, SAFE, DANGER, connected, agentSys, has, norm, P_MIG, P_REPO, P_STORE, P_TEST, P_ADR,
  // fachadas que as features migradas (features/*.ts) consomem por window:
  provFor, LF,
  // núcleo que as camadas v5 (src/v5.ts) e v6 (src/v6.ts) consomem como referências livres via window:
  extOf, getVar, hd, hhmm, LANG, lexBug, P_HIST, P_LX, rel, setVar, short, USAGE
});
/* arranque: `boot();…boot7();i18nBoot()` movido para src/startup.ts — o último módulo
   da cadeia, de modo a correr depois de as camadas v3–v7 publicarem os seus bootN. */

