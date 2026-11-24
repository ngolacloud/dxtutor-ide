/// <reference types="vite/client" />
/* ═════════ dxtutor IDE — feature: workspace (ADR-0004, U4f) ═════════
   Dona das operações de base sobre os ficheiros da IDE: escrever um ficheiro
   (`writeFile` — cria as pastas na árvore e redesenha pelo `refresh`) e repor o
   workspace de demonstração (`loadSeed` — a semente `SEED` com `VITE_SEED=1`; sem ela, um
   workspace vazio) com um repositório git simulado novo. Vivia no app.ts (@ts-nocheck);
   aqui é tipada, sobre o dono dos ficheiros (`workspaceStore`). O que ainda é de outras
   partes do monólito (`refresh`, `STAGED`, `gitInit`) lê-se pela fachada `G`. */

import { workspaceStore } from "../app/store/workspace";
import { SEED } from "./workspace/seed";
import { $ } from "../core";
import { bus } from "../app/bus";
import { RP } from "../app/store/registry";

const SEED_ON = import.meta.env.VITE_SEED === "1";

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

/** Repõe o workspace: a semente de demonstração (com VITE_SEED=1) e um git simulado novo. */
function loadSeed(): void {
  const FS = workspaceStore.files,
    ROOT = workspaceStore.root;
  Object.keys(FS).forEach((k) => delete FS[k]);
  G.STAGED.clear();
  if (SEED_ON) {
    Object.entries(SEED.base).forEach(([p, c]) => {
      FS[ROOT + p] = { content: c, orig: c };
    });
    const s = FS[ROOT + "desktop/src/styles.css"];
    s.orig = s.content.replace("  --accent-hover: #f08a4b;\n", "");
    const a = FS[ROOT + "desktop/src/assistant.ts"];
    a.orig = a.content.replace(/\n\/\/ v2[\s\S]*$/, "\n");
    FS[ROOT + "desktop/src/theme.css"].orig = null;
  }
  G.gitInit();
}


/* ───── o refresh global e o «repor protótipo» (ADR-0004, U4j5a — eram do app.ts) ─────
   Lêem o resto do IDE pela fachada `RW` (o window), no acto — as mesmas funções publicadas que o app.ts
   resolvia por nome livre. */
interface RefreshTab { id: string; kind: string; path?: string }
const RW = window as unknown as {
  TB: RefreshTab[]; cur: string | null; PANE: string; RUN: { active: boolean };
  MISSIONS: unknown[]; DECS: unknown[]; CKPT: unknown[]; CHAT: unknown[];
  BL: { issues: unknown[]; seq: number; mig: number; adr: number }; SD: unknown; ST_SEED: unknown;
  stOf: (p: string) => unknown; syncTree: () => void; buildExplorer: () => void; drawProblems: () => void;
  badges: () => void; hydrate: () => void; tabOf: (id: string | null) => RefreshTab | undefined;
  show: (id: string | null) => void; paintEd: (p: string) => void; drawTabs: () => void; drawOutline: () => void;
  toast: (m: string) => void; saveSD: () => void; newChat: () => void; openTab: (t: RefreshTab & { title: string }) => void;
};
let SIG='';
/** O sinal global «o workspace mudou»: redesenha o explorador (se a árvore mudou), os problemas, os contadores, o
 *  painel lateral activo e o editor, e emite `workspace:changed` no bus. Era do app.ts (ADR-0004, U4j5a); como lá,
 *  usa as versões publicadas do show/paintEd/… (o show da barra de acções, o paintEd com breakpoints). */
function refresh(fromEd?: boolean, force?: boolean): void {const FS=workspaceStore.files,TB=RW.TB;const sig=Object.keys(FS).map(p=>p+RW.stOf(p)).join('|');
  TB.filter(t=>t.kind==='file'&&!FS[t.path as string]).forEach(t=>{TB.splice(TB.indexOf(t),1);if(RW.cur===t.id)RW.cur=null;});
  if(sig!==SIG||force){SIG=sig;RW.syncTree();RW.buildExplorer();}
  RW.drawProblems();RW.badges();if(RP[RW.PANE]&&RW.PANE!=='search')RP[RW.PANE]();RW.hydrate();
  if(!fromEd){const t=RW.tabOf(RW.cur);if(!t)RW.show(TB.length?TB[TB.length-1].id:null);else if(t.kind==='file'){const ta=$('#ed-ta') as HTMLTextAreaElement|null,top=$('#ebody')!.scrollTop;if(ta&&ta.value!==FS[t.path as string].content){ta.value=FS[t.path as string].content;}if(ta){RW.paintEd(t.path as string);$('#ebody')!.scrollTop=top;}RW.drawTabs();}else if(t.kind==='diff'||t.kind==='manager'){const top=$('#ebody')!.scrollTop;RW.show(RW.cur);$('#ebody')!.scrollTop=top;}else RW.drawTabs();}
  else if(RW.tabOf(RW.cur)&&RW.tabOf(RW.cur)!.kind==='file')RW.paintEd(RW.tabOf(RW.cur)!.path as string);RW.drawOutline();
  /* U3c (ADR-0004): o fim do refresh é o sinal «o workspace mudou» — quem reagia
     decorando o refresh (grafo/board, autosave do desktop, sync do PairCode) subscreve */
  bus.emit('workspace:changed',{fromEditor:!!fromEd,force:!!force});}
/** Repõe o protótipo no estado inicial (entrada «Repor protótipo» da paleta). Era do app.ts (ADR-0004, U4j5a). */
function resetAll(): void{if(RW.RUN.active){RW.toast('Pára a execução primeiro');return;}loadSeed();RW.MISSIONS.length=0;RW.DECS.length=0;RW.CKPT.length=0;RW.CHAT.length=0;RW.BL.issues.length=0;RW.BL.seq=11;RW.BL.mig=3;RW.BL.adr=4;RW.SD=JSON.parse(JSON.stringify(RW.ST_SEED));RW.saveSD();RW.TB=[];RW.newChat();refresh(false,true);RW.openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'});RW.toast('Protótipo reposto ao estado inicial');}

/* ───── caminhos do workspace (ADR-0004, U4j3 — eram do app.ts) ─────
   A raiz lógica é constante ('dxtutor/'), como era a const do app.ts. */
const ROOT = workspaceStore.root;
const extOf = (p: string): string => (p.includes('.') ? p.split('.').pop() as string : '').toLowerCase();
const short = (p: string): string => p.replace(ROOT, '');
const norm = (p: string): string => { p = String(p || '').replace(/^\.?\//, ''); return p.startsWith(ROOT) ? p : ROOT + p; };
/** Os ficheiros de que o protótipo e os cenários do Co-Dev falam por nome. */
const P_LX=ROOT+'crates/lexer/src/lib.rs',P_REPO=ROOT+'crates/store/src/conversations.rs',P_MIG=ROOT+'db/migrations/0002_conversations.sql',P_TEST=ROOT+'crates/store/tests/conversations_test.rs',P_HIST=ROOT+'desktop/src/history.ts',P_ADR=ROOT+'.dxtutor/arquitectura/ADR-003-historico.md',P_STORE=ROOT+'crates/store/src/lib.rs';
/** Caminho de um ficheiro do Learning Track (fachada lida pelo learn.ts). */
const LF = (p: string): string => ROOT + 'learn/' + p;
/** As secções do explorador abertas/fechadas (sem dono próprio; lido por nome livre). */
const SECOPEN: Record<string, boolean> = {};

Object.assign(window, { SEED, writeFile, loadSeed, refresh, resetAll, extOf, short, norm, P_LX, P_REPO, P_MIG, P_TEST, P_HIST, P_ADR, P_STORE, LF, SECOPEN });

export { SEED, writeFile, loadSeed, refresh, resetAll, extOf, short, norm, P_LX, P_REPO, P_MIG, P_TEST, P_HIST, P_ADR, P_STORE, LF };
