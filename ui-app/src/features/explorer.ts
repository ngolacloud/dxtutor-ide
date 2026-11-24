/* ═════════ dxtutor IDE — feature: Explorer (árvore de ficheiros + Outline + novo ficheiro/pasta) ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o subsistema EXPLORER
   que vivia no monólito `app.ts` (secção `/* explorer *​/`): o renderer recursivo das
   linhas da árvore (`renderLevel`), a construção do painel inteiro (`buildExplorer` —
   projectos + Outline + Timeline), `markActive`/`collapseAll`, a extracção de símbolos
   (`symbols`), o desenho do Outline (`drawOutline`) e os lançadores `newFile`/`newFolder`.

   Fronteira: a feature é DONA destas 8 funções. Os CONSUMIDORES ficam no monólito e
   lêem por nome livre (global): `buildExplorer` (refresh em app.ts + boot.ts),
   `renderLevel` (boot.ts, 3 sítios), `drawOutline`/`markActive` (show/refresh em
   app.ts), `collapseAll` (boot.ts), `symbols` (drawOutline + v6.ts), `newFile`/
   `newFolder` (entradas do CMD e menus). Por isso tudo se publica no `window`.

   Mecânica (igual às migrações anteriores): a feature avalia ANTES de `app.ts`
   (ordem do index.html) e publica tudo no `window` no eval. Nada é lido
   ansiosamente — os globais do monólito (TREE, FS, OPEN, SECOPEN, stOf, changes,
   svg, esc, fIcon, tabOf, cur, openPath, palette, writeFile, norm, refresh, toast,
   gotoLine, drawTimeline, $, $$) só são tocados DENTRO das funções, chamadas depois
   do arranque, e resolvem no escopo GLOBAL em runtime. Do core importa-se só o que
   é dono de lá (`$`, `$$`, `esc`). */

import { $, $$, esc, svg } from "../core";
import { desktopPorts } from "../app/desktop";

function renderLevel(obj:Record<string,any>,host:HTMLElement,depth:number,path:string[]){Object.keys(obj).forEach(name=>{const node=obj[name],pad=8+depth*12,row=document.createElement('div');
  let g=node.git||'';if(node.path)g=(stOf(node.path) as string).toLowerCase();else if(node.dpath)g=changes().some(p=>p.startsWith(node.dpath+'/'))?'m':'';
  row.className='row'+(g?' git-'+g:'');row.style.paddingLeft=pad+'px';if(node.path)row.dataset.path=node.path;
  const open=node.dpath?OPEN.has(node.dpath):!!node.open;
  row.innerHTML=`<span class="chev${node.dir?'':' leaf'}">${svg('chev')}</span>${node.dir?`<span class="ic folder">${svg(open?'folderOpen':'folder')}</span>`:fIcon(name)}<span class="nm">${esc(name)}</span>${g?(node.dir?'<span class="dot"></span>':`<span class="deco">${g.toUpperCase()}</span>`):''}`;
  host.appendChild(row);
  if(node.dir){const kids=document.createElement('div');kids.className='children';const gd=document.createElement('span');gd.className='guide';gd.style.left=(pad+7)+'px';kids.appendChild(gd);host.appendChild(kids);let built=false;
    const expand=(o:boolean)=>{row.classList.toggle('open',o);kids.style.display=o?'block':'none';(row.querySelector('.ic') as HTMLElement).innerHTML=svg(o?'folderOpen':'folder');
      if(node.dpath){o?OPEN.add(node.dpath):OPEN.delete(node.dpath);}else node.open=o;
      if(o&&!built){built=true;if(node.children&&Object.keys(node.children).length)renderLevel(node.children,kids,depth+1,path.concat(name));
        else kids.insertAdjacentHTML('beforeend',`<div class="sec-empty" style="padding:2px 0 2px ${pad+28}px">fora do workspace do protótipo</div>`);}};
    kids.style.display='none';row.onclick=e=>{e.stopPropagation();sel(row);expand(!row.classList.contains('open'));};if(open)expand(true);
  }else row.onclick=e=>{e.stopPropagation();if(node.path)openPath(node.path);};});}
function buildExplorer(){const host=$('#exp-sections');if(!host)return;host.innerHTML='';
  const sec=(lbl:string,open:boolean,flex?:number)=>{const s=document.createElement('div');s.className='section'+(flex?' flexible':'');const h=document.createElement('div');h.className='sec-hd'+(open?' open':'');h.innerHTML=`<span class="chev">${svg('chev')}</span><span class="lbl">${lbl}</span>`;
    const b=document.createElement('div');b.className='sec-body'+(open?' show':'');h.onclick=()=>{h.classList.toggle('open');b.classList.toggle('show');SECOPEN[lbl]=b.classList.contains('show');};s.append(h,b);host.appendChild(s);return b;};
  const tb=sec('projects',SECOPEN.projects!==false,1),tree=document.createElement('div');tree.className='tree';tb.appendChild(tree);renderLevel(TREE.projects.children,tree,0,['projects']);
  sec('Outline',SECOPEN.Outline!==false).id='outline';sec('Timeline',!!SECOPEN.Timeline).id='timeline';drawOutline();drawTimeline();markActive();}
function markActive(){$$('#exp-sections .row.sel').forEach(x=>x.classList.remove('sel'));const t=tabOf(cur);if(t&&t.path){const r=$(`#exp-sections .row[data-path="${esc(t.path)}"]`);if(r)r.classList.add('sel');}}
function collapseAll(){OPEN.clear();Object.values(TREE.projects.children).forEach(n=>{(n as any).open=false;});buildExplorer();}
function symbols(p:string){const f=FS[p];if(!f)return[];const out:{k:string;n:string;line:number}[]=[];f.content.split('\n').forEach((l,i)=>{const m=l.match(/^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|function|CREATE TABLE|CREATE INDEX)\s+(?:.*?\bfor\s+)?([A-Za-z_]\w*)/)||l.match(/^(#{1,3})\s+(.+)/)||l.match(/^(export)\s+(?:async\s+)?(?:function|const)\s+(\w+)/);if(m)out.push({k:m[1].replace('CREATE ','').toLowerCase(),n:m[2],line:i+1});});return out;}
function drawOutline(){const o=$('#outline');if(!o)return;const t=tabOf(cur),sy=t&&t.path?symbols(t.path):[];
  o.innerHTML=sy.length?sy.map(s=>`<div class="s-hit" style="padding-left:16px" onclick="gotoLine(${s.line})"><span style="color:var(--accent-hover)">${esc(s.k.startsWith('#')?'§':s.k)}</span><span>${esc(s.n)}</span></div>`).join(''):'<div class="sec-empty">Abre um ficheiro para ver os símbolos.</div>';}
function newFile(){palette('',{ph:'Caminho do novo ficheiro (relativo a dxtutor/) — ex.: desktop/src/novo.ts',verb:'Criar',text:(q:string)=>{q=q.trim();if(!q)return;const p=norm(q);if(FS[p]){toast('Já existe');openPath(p);return;}writeFile(p,'');openPath(p);}});}
function newFolder(){palette('',{ph:'Nome da nova pasta (relativo a dxtutor/)',verb:'Criar pasta',text:(q:string)=>{q=q.trim().replace(/\/$/,'');if(!q)return;writeFile(norm(q+'/.gitkeep'),'');OPEN.add('dxtutor/'+q);refresh(true,true);toast('Pasta criada: '+q);}});}

/* ── publicação no window: nomes que o resíduo (app.ts: refresh/show + Object.assign),
   o boot.ts (buildExplorer/renderLevel/collapseAll), o v6.ts (symbols) e as entradas
   do CMD/menus (newFile/newFolder) resolvem como globais. ── */
/* ── U4c (ADR-0004): também donos da selecção de linha (era do boot.ts), da árvore a partir
   do FS e do ícone por extensão (eram do app.ts). O syncTree publicado consulta a porta
   desktop (`desktopPorts.explorer`, U4h5b). ── */
/** Marca a linha `r` da árvore como seleccionada (só uma de cada vez). */
function sel(r: Element): void {
  $$(".row.sel").forEach((x) => x.classList.remove("sel"));
  r.classList.add("sel");
}

interface TreeNode {
  dir?: number;
  children: Record<string, TreeNode | { path: string }>;
  dpath?: string;
}

/** Reconstrói a árvore do projecto a partir dos caminhos do FS (pastas primeiro, por nome). */
function syncTree(): void {
  const mk = (dp: string): TreeNode => ({ dir: 1, children: {}, dpath: dp }),
    root = mk("dxtutor");
  Object.keys(FS).forEach((p) => {
    const parts = p.split("/").slice(1);
    let n = root,
      acc = "dxtutor";
    parts.forEach((s, i) => {
      if (i === parts.length - 1) n.children[s] = { path: p };
      else {
        acc += "/" + s;
        n = (n.children[s] as TreeNode) || (n.children[s] = mk(acc));
      }
    });
  });
  const isDir = (x: TreeNode | { path: string }): boolean => !!(x as TreeNode).dir;
  const sort = (n: TreeNode): void => {
    const o: TreeNode["children"] = {};
    Object.keys(n.children)
      .sort((a, b) => Number(isDir(n.children[b])) - Number(isDir(n.children[a])) || a.localeCompare(b))
      .forEach((k) => {
        o[k] = n.children[k];
        if (isDir(o[k])) sort(o[k] as TreeNode);
      });
    n.children = o;
  };
  sort(root);
  (TREE as { projects: { children: Record<string, unknown> } }).projects.children.dxtutor = root;
}

/** O ícone de um ficheiro pela extensão (Rust, Markdown, SQL; o resto genérico). */
function fIcon(p: string): string {
  const e = (window as unknown as { extOf: (p: string) => string }).extOf(p);
  return `<span class="ic x-${e}">${svg(e === "rs" ? "rust" : e === "md" ? "book" : e === "sql" ? "volume" : "file")}</span>`;
}

/** A parte desktop do explorador (ADR-0004, U4h5b), injectada em `desktopPorts.explorer`: com uma
 *  pasta real aberta, a raiz do explorador mostra o nome da pasta. Recebe a versão de base. */
export interface ExplorerDesktop { syncTree(virtual: () => void): void }
/* o syncTree PUBLICADO consulta a porta (antes o desktop reatribuía-o no `window`); só o app.ts o chama, pelo global */
const syncTreePublished = (): void => { const d = desktopPorts.explorer; if (d) d.syncTree(syncTree); else syncTree(); };
Object.assign(window, { renderLevel, buildExplorer, markActive, collapseAll, symbols, drawOutline, newFile, newFolder, sel, syncTree: syncTreePublished, fIcon });
