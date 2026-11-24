/* ═════════ dxtutor IDE — feature: workspace (ADR-0004, U4f) ═════════
   Dona das operações de base sobre os ficheiros da IDE: escrever um ficheiro
   (`writeFile` — cria as pastas na árvore e redesenha pelo `refresh`) e repor o
   workspace vazio (`resetWorkspace`) com um repositório git simulado novo. Vivia no app.ts (@ts-nocheck);
   aqui é tipada, sobre o dono dos ficheiros (`workspaceStore`). O que ainda é de outras
   partes do monólito (`refresh`, `STAGED`, `gitInit`) lê-se pela fachada `G`. */

import { workspaceStore } from "../app/store/workspace";
import { $ } from "../core";
import { bus } from "../app/bus";
import { RP } from "../app/store/registry";
import { drawTabs } from "./tabs";

const G = window as unknown as {
  refresh: (fromEd?: boolean, force?: boolean) => void;
  STAGED: Set<string>;
  gitInit: () => void;
};

/** Escreve (ou cria) o ficheiro `p`; um ficheiro novo abre as pastas até ele na árvore. */
function writeFile(p: string, content: string): void {
  const FS = workspaceStore.files;
  if (FS[p]) FS[p].content = content;
  else {
    FS[p] = { content, orig: null };
    const d = p.split("/");
    d.pop();
    while (d.length) {
      workspaceStore.openDirs.add(d.join("/"));
      d.pop();
    }
  }
  G.refresh();
}

/** Repõe o workspace vazio (sem ficheiros nem nada em stage) e um git simulado novo. A app não
 *  traz dados de demonstração (ADR-0006, R1a): os ficheiros chegam da pasta aberta (desktop). */
function resetWorkspace(): void {
  const FS = workspaceStore.files;
  Object.keys(FS).forEach((k) => delete FS[k]);
  G.STAGED.clear();
  G.gitInit();
}


/* ───── o refresh global (ADR-0004, U4j5a — era do app.ts) ─────
   Lêem o resto do IDE pela fachada `RW` (o window), no acto — as mesmas funções publicadas que o app.ts
   resolvia por nome livre. */
interface RefreshTab { id: string; kind: string; path?: string }
const RW = window as unknown as {
  TB: RefreshTab[]; cur: string | null; PANE: string;
  stOf: (p: string) => unknown; syncTree: () => void; buildExplorer: () => void; drawProblems: () => void;
  badges: () => void; hydrate: () => void; tabOf: (id: string | null) => RefreshTab | undefined;
  show: (id: string | null) => void; paintEd: (p: string) => void; drawTabs: () => void; drawOutline: () => void;
};
let SIG='';
/** O sinal global «o workspace mudou»: redesenha o explorador (se a árvore mudou), os problemas, os contadores, o
 *  painel lateral activo e o editor, e emite `workspace:changed` no bus. Era do app.ts (ADR-0004, U4j5a); como lá,
 *  usa as versões publicadas do show/paintEd/… (o show da barra de acções, o paintEd com breakpoints). */
function refresh(fromEd?: boolean, force?: boolean): void {const FS=workspaceStore.files,TB=RW.TB;const sig=Object.keys(FS).map(p=>p+RW.stOf(p)).join('|');
  TB.filter(t=>t.kind==='file'&&!FS[t.path as string]).forEach(t=>{TB.splice(TB.indexOf(t),1);if(RW.cur===t.id)RW.cur=null;});
  if(sig!==SIG||force){SIG=sig;RW.syncTree();RW.buildExplorer();}
  RW.drawProblems();RW.badges();if(RP[RW.PANE]&&RW.PANE!=='search')RP[RW.PANE]();RW.hydrate();
  if(!fromEd){const t=RW.tabOf(RW.cur);if(!t)RW.show(TB.length?TB[TB.length-1].id:null);else if(t.kind==='file'){const ta=$('#ed-ta') as HTMLTextAreaElement|null,top=$('#ebody')!.scrollTop;if(ta&&ta.value!==FS[t.path as string].content){ta.value=FS[t.path as string].content;}if(ta){RW.paintEd(t.path as string);$('#ebody')!.scrollTop=top;}drawTabs();}else if(t.kind==='diff'||t.kind==='manager'){const top=$('#ebody')!.scrollTop;RW.show(RW.cur);$('#ebody')!.scrollTop=top;}else drawTabs();}
  else if(RW.tabOf(RW.cur)&&RW.tabOf(RW.cur)!.kind==='file')RW.paintEd(RW.tabOf(RW.cur)!.path as string);RW.drawOutline();
  /* U3c (ADR-0004): o fim do refresh é o sinal «o workspace mudou» — quem reagia
     decorando o refresh (grafo/board, autosave do desktop, sync do PairCode) subscreve */
  bus.emit('workspace:changed',{fromEditor:!!fromEd,force:!!force});}
/* (o resetAll — «Repor protótipo» — saiu na R0 do ADR-0006: esvaziava o FS e o autosave do desktop apagava a pasta aberta) */

/* ───── caminhos do workspace (ADR-0004, U4j3 — eram do app.ts) ─────
   A raiz lógica é constante ('dxtutor/'), como era a const do app.ts. */
const ROOT = workspaceStore.root;
const extOf = (p: string): string => (p.includes('.') ? p.split('.').pop() as string : '').toLowerCase();
const short = (p: string): string => p.replace(ROOT, '');
const norm = (p: string): string => { p = String(p || '').replace(/^\.?\//, ''); return p.startsWith(ROOT) ? p : ROOT + p; };
/** Caminho de um ficheiro do Learning Track (fachada lida pelo learn.ts). */
const LF = (p: string): string => ROOT + 'learn/' + p;
/** As secções do explorador abertas/fechadas (sem dono próprio; lido por nome livre). */
export const SECOPEN: Record<string, boolean> = {};

Object.assign(window, { writeFile, resetWorkspace, refresh, extOf, short, norm, LF });

export { writeFile, resetWorkspace, refresh, extOf, short, norm, LF };
