/* ═════════ dxtutor IDE — feature: Explorer (árvore de ficheiros + Outline + novo ficheiro/pasta) ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o subsistema EXPLORER
   que vivia no monólito `app.ts` (secção `/* explorer *​/`): o renderer recursivo das
   linhas da árvore (`renderLevel`), a construção do painel inteiro (`buildExplorer` —
   projectos + Outline + Timeline), `markActive`/`collapseAll`, a extracção de símbolos
   (`symbols`), o desenho do Outline (`drawOutline` — no desktop com pasta, pelo backend
   `file_outline`, ADR-0006 R2c) e os lançadores `newFile`/`newFolder`.

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
import { codeintelClient, type SymbolRange } from "../platform/tauri/codeintel";
import { translator } from "../app/i18n";
import { EXPLORER_MESSAGES } from "./explorer.messages";
import { EXPLORER_DESKTOP_MESSAGES } from "./explorer.desktop-messages";
import { SECOPEN, norm } from "./workspace";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(EXPLORER_MESSAGES);
const txd = translator(EXPLORER_DESKTOP_MESSAGES);

function renderLevel(obj:Record<string,any>,host:HTMLElement,depth:number,path:string[]){Object.keys(obj).forEach(name=>{const node=obj[name],pad=8+depth*12,row=document.createElement('div');
  let g=node.git||'';if(node.path)g=(stOf(node.path) as string).toLowerCase();else if(node.dpath)g=changes().some(p=>p.startsWith(node.dpath+'/'))?'m':'';
  row.className='row'+(g?' git-'+g:'');row.style.paddingLeft=pad+'px';if(node.path)row.dataset.path=node.path;else if(node.dpath)row.dataset.dpath=node.dpath;
  const open=node.dpath?OPEN.has(node.dpath):!!node.open;
  row.innerHTML=`<span class="chev${node.dir?'':' leaf'}">${svg('chev')}</span>${node.dir?`<span class="ic folder">${svg(open?'folderOpen':'folder')}</span>`:fIcon(name)}<span class="nm">${esc(name)}</span>${g?(node.dir?'<span class="dot"></span>':`<span class="deco">${g.toUpperCase()}</span>`):''}`;
  host.appendChild(row);
  if(node.dir){const kids=document.createElement('div');kids.className='children';const gd=document.createElement('span');gd.className='guide';gd.style.left=(pad+7)+'px';kids.appendChild(gd);host.appendChild(kids);let built=false;
    const expand=(o:boolean)=>{row.classList.toggle('open',o);kids.style.display=o?'block':'none';(row.querySelector('.ic') as HTMLElement).innerHTML=svg(o?'folderOpen':'folder');
      if(node.dpath){o?OPEN.add(node.dpath):OPEN.delete(node.dpath);}else node.open=o;
      if(o&&!built){built=true;if(node.children&&Object.keys(node.children).length)renderLevel(node.children,kids,depth+1,path.concat(name));
        else kids.insertAdjacentHTML('beforeend',`<div class="sec-empty" style="padding:2px 0 2px ${pad+28}px">${txd("emptyFolder")}</div>`);}};
    kids.style.display='none';row.onclick=e=>{e.stopPropagation();sel(row);expand(!row.classList.contains('open'));};if(open)expand(true);
  }else row.onclick=e=>{e.stopPropagation();if(node.path)openPath(node.path);};});}
function buildExplorer(){const host=$('#exp-sections');if(!host)return;host.innerHTML='';
  const sec=(lbl:string,open:boolean,flex?:number)=>{const s=document.createElement('div');s.className='section'+(flex?' flexible':'');const h=document.createElement('div');h.className='sec-hd'+(open?' open':'');h.innerHTML=`<span class="chev">${svg('chev')}</span><span class="lbl">${lbl}</span>`;
    const b=document.createElement('div');b.className='sec-body'+(open?' show':'');h.onclick=()=>{h.classList.toggle('open');b.classList.toggle('show');SECOPEN[lbl]=b.classList.contains('show');};s.append(h,b);host.appendChild(s);return b;};
  const tb=sec('projects',SECOPEN.projects!==false,1),tree=document.createElement('div');tree.className='tree';tb.appendChild(tree);renderLevel(TREE.projects.children,tree,0,['projects']);
  if(!Object.keys(TREE.projects.children).length)noFolder(tree);
  sec('Outline',SECOPEN.Outline!==false).id='outline';sec('Timeline',!!SECOPEN.Timeline).id='timeline';drawOutline();drawTimeline();markActive();}
/** Sem pasta aberta: o estado vazio (como o VS Code), com «Abrir pasta…» quando há desktop (`DXR`). */
function noFolder(host:HTMLElement){const d=document.createElement('div');d.className='sec-empty';d.textContent=txd('noFolder');host.appendChild(d);
  const dxr=(window as unknown as {DXR?:{open?:()=>void}}).DXR;if(!dxr||!dxr.open)return;
  const b=document.createElement('button');b.className='mini pri';b.style.margin='4px 0 0 12px';b.textContent='Abrir pasta…';b.addEventListener('click',()=>dxr.open!());host.appendChild(b);}
function markActive(){$$('#exp-sections .row.sel').forEach(x=>x.classList.remove('sel'));const t=tabOf(cur);if(t&&t.path){const r=$(`#exp-sections .row[data-path="${esc(t.path)}"]`);if(r)r.classList.add('sel');}}
function collapseAll(){OPEN.clear();Object.values(TREE.projects.children).forEach(n=>{(n as any).open=false;});buildExplorer();}
function symbols(p:string){const f=FS[p];if(!f)return[];const out:{k:string;n:string;line:number}[]=[];f.content.split('\n').forEach((l,i)=>{const m=l.match(/^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|function|CREATE TABLE|CREATE INDEX)\s+(?:.*?\bfor\s+)?([A-Za-z_]\w*)/)||l.match(/^(#{1,3})\s+(.+)/)||l.match(/^(export)\s+(?:async\s+)?(?:function|const)\s+(\w+)/);if(m)out.push({k:m[1].replace('CREATE ','').toLowerCase(),n:m[2],line:i+1});});return out;}
/* ───── Outline real (ADR-0006, R2c) ─────
   No desktop com pasta aberta, os símbolos de um ficheiro de código vêm do backend
   (`file_outline`: servidor de língua quando há, senão `syn`/scanner sintáctico). Cada
   pedido arranca um servidor de língua, por isso: cache por ficheiro+conteúdo (teclar não
   pede de novo enquanto o texto não mudar), debounce, um pedido de cada vez, e o último
   resultado fica à vista até chegar o novo. As linguagens que o `file_outline` não cobre mas o
   servidor de linguagem do editor sim (Java, Kotlin, C#, C++, Swift, SQL…) vêm do `documentSymbol`
   dele (`desktopPorts.outline`, registada pela feature `lsp`), com a mesma cache. Sem pasta
   (browser), ou sem servidor (Markdown…), fica a extracção local `symbols()`. */
const OUTLINE_LANG: Record<string, string> = { rs: "rust", go: "go", py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript" };
const KIND_LABEL: Record<string, string> = { function: "fn", method: "method", struct: "struct", enum: "enum", trait: "trait", other: "sym" };
/** Um símbolo do Outline: tipo, nome, linha (1-based) e profundidade (para indentar; 0 = topo). */
export type OutSym = { k: string; n: string; line: number; d?: number };
const OUTLINE = new Map<string, { content: string; syms: OutSym[] }>();
let outlineTimer: ReturnType<typeof setTimeout> | undefined, outlineBusy = false, outlineRetry = false;
const dxRoot = (): string | null => (window as unknown as { DXR?: { root?: string | null } }).DXR?.root ?? null;

/** O ficheiro `p` tem outline do backend? (pasta aberta + língua coberta) */
function outlineLang(p: string): string | null {
  if (!dxRoot() || !p.startsWith(ROOT)) return null;
  const e = (window as unknown as { extOf: (p: string) => string }).extOf(p);
  return OUTLINE_LANG[e] ?? null;
}
/** O ficheiro `p` tem outline pelo servidor de linguagem do editor? (fora do `file_outline`) */
function lspOutline(p: string): boolean {
  return !!dxRoot() && p.startsWith(ROOT) && !outlineLang(p) && !!desktopPorts.outline?.covers(p);
}
function fetchOutline(p: string): void {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    const f = FS[p], root = dxRoot(), lang = outlineLang(p), viaLsp = !lang && lspOutline(p);
    if (!f || !root || (!lang && !viaLsp)) return;
    if (outlineBusy) { outlineRetry = true; return; }
    outlineBusy = true;
    const content = f.content, abs = root.replace(/\/$/, "") + "/" + p.slice(ROOT.length);
    const req: Promise<OutSym[] | null> = lang
      ? codeintelClient().outline(content, lang, root, abs).then((r: SymbolRange[]) => r.map((x) => ({ k: KIND_LABEL[x.kind] ?? x.kind, n: x.name, line: x.startLine })))
      : desktopPorts.outline!.symbols(p);
    req.then(
      (syms) => { OUTLINE.set(p, { content, syms: syms ?? symbols(p) }); }, /* sem resposta do servidor: a extracção local */
      () => { OUTLINE.set(p, { content, syms: symbols(p) }); }, /* backend indisponível: a extracção local */
    ).finally(() => {
      outlineBusy = false;
      const t = tabOf(cur);
      if (t && t.path === p) drawOutline();
      if (outlineRetry) { outlineRetry = false; const t2 = tabOf(cur); if (t2 && t2.path) fetchOutline(t2.path); }
    });
  }, 400);
}
/** Os símbolos a mostrar para `p`: do backend (cache/pedido) ou da extracção local; `null` = a ler. */
function outlineOf(p: string): OutSym[] | null {
  if (!outlineLang(p) && !lspOutline(p)) return symbols(p);
  const c = OUTLINE.get(p), f = FS[p];
  if (!c || (f && c.content !== f.content)) fetchOutline(p);
  return c ? c.syms : null;
}
function drawOutline(){const o=$('#outline');if(!o)return;const t=tabOf(cur),sy=t&&t.path?outlineOf(t.path):[];
  o.innerHTML=sy===null?`<div class="sec-empty">${txd('readingSymbols')}</div>`:sy.length?sy.map(s=>`<div class="s-hit" style="padding-left:${16+(s.d??0)*12}px" data-on="${s.line}"><span style="color:var(--accent-hover)">${esc(s.k.startsWith('#')?'§':s.k)}</span><span>${esc(s.n)}</span></div>`).join(''):t&&t.path?'<div class="sec-empty">Sem símbolos neste ficheiro.</div>':`<div class="sec-empty">${txt("openAFileTo")}</div>`;}
/* clicar num símbolo vai para a linha (sem onclick inline; o #outline é recriado pelo buildExplorer) */
document.addEventListener('click',(e)=>{const h=(e.target as HTMLElement|null)?.closest<HTMLElement>('#outline .s-hit[data-on]');if(h)gotoLine(+(h.dataset.on as string));});
function newFile(){palette('',{ph:'Caminho do novo ficheiro (relativo a dxtutor/) — ex.: desktop/src/novo.ts',verb:'Criar',text:(q:string)=>{q=q.trim();if(!q)return;const p=norm(q);if(FS[p]){toast('Já existe');openPath(p);return;}writeFile(p,'');openPath(p);}});}
function newFolder(){palette('',{ph:'Nome da nova pasta (relativo a dxtutor/)',verb:'Criar pasta',text:(q:string)=>{q=q.trim().replace(/\/$/,'');if(!q)return;writeFile(norm(q+'/.gitkeep'),'');OPEN.add('dxtutor/'+q);refresh(true,true);toast('Pasta criada: '+q);}});}

/* ── publicação no window: nomes que o resíduo (app.ts: refresh/show + Object.assign),
   o boot.ts (buildExplorer/renderLevel/collapseAll), o v6.ts (symbols) e as entradas
   do CMD/menus (newFile/newFolder) resolvem como globais. ── */
/* ── U4c (ADR-0004): também donos da selecção de linha (era do boot.ts), da árvore a partir
   do FS e do ícone por extensão (eram do app.ts). O syncTree publicado consulta a porta
   desktop (`desktopPorts.explorer`, U4h5b). ── */
/** Marca a linha `r` da árvore como seleccionada (só uma de cada vez). */
export function sel(r: Element): void {
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
    root = mk("dxtutor"),
    tree = (TREE as { projects: { children: Record<string, unknown> } }).projects;
  /* sem ficheiros não há projecto a mostrar (o bridge do desktop repõe a raiz de uma pasta vazia) */
  if (!Object.keys(FS).length) {
    tree.children = {};
    return;
  }
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
  tree.children = { dxtutor: root };
}

/** O ícone de um ficheiro pela extensão (Rust, Markdown, SQL; o resto genérico). */
function fIcon(p: string): string {
  const e = (window as unknown as { extOf: (p: string) => string }).extOf(p);
  return `<span class="ic x-${e}">${svg(e === "rs" ? "rust" : e === "md" ? "book" : e === "sql" ? "volume" : "file")}</span>`;
}

/** A parte desktop do explorador (ADR-0004, U4h5b), injectada em `desktopPorts.explorer`: com uma
 *  pasta real aberta, a raiz do explorador mostra o nome da pasta. Recebe a versão de base. */
export interface ExplorerDesktop { syncTree(virtual: () => void): void }
/** Os símbolos do Outline pelo servidor de linguagem do editor (feature `lsp`), injectados em
 *  `desktopPorts.outline`: `covers(p)` diz se a linguagem de `p` tem servidor; `symbols(p)` dá
 *  os símbolos, ou `null` se o servidor não respondeu (fica a extracção local). */
export interface OutlineDesktop { covers(p: string): boolean; symbols(p: string): Promise<OutSym[] | null> }
/* o syncTree PUBLICADO consulta a porta (antes o desktop reatribuía-o no `window`); só o app.ts o chama, pelo global */
const syncTreePublished = (): void => { const d = desktopPorts.explorer; if (d) d.syncTree(syncTree); else syncTree(); };
Object.assign(window, { buildExplorer, markActive, collapseAll, symbols, drawOutline, newFile, newFolder, syncTree: syncTreePublished, fIcon });

