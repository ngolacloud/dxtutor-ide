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

Object.assign(window, { SEED, writeFile, loadSeed });

export { SEED, writeFile, loadSeed };
