/* ═════════ dxtutor IDE — feature: workspace (ADR-0004, U4f) ═════════
   Dona das operações de base sobre os ficheiros da IDE: escrever um ficheiro
   (`writeFile` — cria as pastas na árvore e redesenha pelo `refresh`) e repor o
   workspace vazio (`resetWorkspace`) com um repositório git simulado novo. Vivia no app.ts (@ts-nocheck);
   aqui é tipada, sobre o dono dos ficheiros (`workspaceStore`). O que ainda é de outras
   partes do monólito (`refresh`, `STAGED`, `gitInit`) lê-se pela fachada `G`. */

import { workspaceStore } from "../app/store/workspace";

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

/* ───── caminhos do workspace (ADR-0004, U4j3 — eram do app.ts) ─────
   A raiz lógica é constante ('dxtutor/'), como era a const do app.ts. */
const ROOT = workspaceStore.root;
const extOf = (p: string): string => (p.includes('.') ? p.split('.').pop() as string : '').toLowerCase();
const short = (p: string): string => p.replace(ROOT, '');
const norm = (p: string): string => { p = String(p || '').replace(/^\.?\//, ''); return p.startsWith(ROOT) ? p : ROOT + p; };
/** Caminho de um ficheiro do Learning Track (fachada lida pelo learn.ts). */
const LF = (p: string): string => ROOT + 'learn/' + p;
/** As secções do explorador abertas/fechadas (sem dono próprio; lido por nome livre). */
const SECOPEN: Record<string, boolean> = {};

Object.assign(window, { writeFile, resetWorkspace, extOf, short, norm, LF, SECOPEN });

export { writeFile, resetWorkspace, extOf, short, norm, LF };
