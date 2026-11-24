/* Fixture de testes: o histórico git do projecto-exemplo (12 commits, main/develop, dois ramos de
   feature já fundidos, tags v0.1.0/v0.2.0). Era o que o `gitInit` da app semeava sem pasta aberta;
   a app deixou de inventar histórico (ADR-0006, R1d) — sem repositório git real, o modelo nasce
   vazio e o motor recusa mudar o git. Aqui é só dado de teste: `applySampleHistory` faz, sobre o
   modelo vazio, o que o antigo `gitInit` fazia (mesmos hashes, mensagens, pais, ramos, idades
   relativas ao relógio, árvores tiradas do `orig` do FS) e liga o espelho em memória como se uma
   pasta com git estivesse aberta (`window.REPO = true` — no desktop quem o diz é `DXR.git`).

   Chamar DEPOIS de `applySampleWorkspace` (as árvores de main/develop vêm do FS) e de `gitInit`. */

interface HistoryWindow {
  FS: Record<string, { content: string; orig: string | null }>;
  GIT: {
    c: Record<string, { h: string; m: string; p: string[]; b: string; a: string; t: number; files: string[] }>;
    order: string[];
    refs: Record<string, string>;
    trees: Record<string, Record<string, string>>;
    base: Record<string, Record<string, string>>;
    tags: Record<string, string>;
  };
  COMMITS: Array<{ h: string; m: string; n?: number }>;
  BRANCH: string;
  REPO?: boolean;
}

export function applySampleHistory(w: HistoryWindow): void {
  const git = w.GIT, FS = w.FS, now = Date.now();
  Object.assign(git, { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} });
  const tree: Record<string, string> = {};
  Object.keys(FS).forEach((p) => { if (FS[p].orig != null) tree[p] = FS[p].orig as string; });
  const add = (h: string, m: string, p: string[], b: string, ago: number): void => {
    git.c[h] = { h, m, p, b, a: "w", t: now - ago * 3600e3, files: [] }; git.order.unshift(h);
  };
  add("1a2b3c4", "chore: commit inicial", [], "main", 420); add("d1e5f60", "feat(store): workspaces em SQLite", ["1a2b3c4"], "develop", 380); add("d2a7c91", "feat(desktop): painel do Co-Dev", ["d1e5f60"], "develop", 300);
  add("m2f0e11", "Merge release/0.2.0 em main", ["1a2b3c4", "d2a7c91"], "main", 290); add("d3b8d22", "chore: actualizar dependências", ["d2a7c91"], "develop", 200);
  add("l1c9e33", "feat(tutor): percursos de aprendizagem", ["d3b8d22"], "feature/learning-paths", 170); add("l2d0f44", "feat(tutor): progresso por percurso", ["l1c9e33"], "feature/learning-paths", 150);
  add("s164943", "feat(arch): interactive canvas", ["d3b8d22"], "feature/studio-canvas", 140); add("d4e1a55", "Merge feature/learning-paths em develop", ["d3b8d22", "l2d0f44"], "develop", 120);
  add("s2a5b0d", "feat(arch): double-click a node to delete it", ["s164943"], "feature/studio-canvas", 90); add("s3c638e", "feat(arch): persist the Studio design", ["s2a5b0d"], "feature/studio-canvas", 60);
  add("d5f2b66", "Merge feature/studio-canvas em develop", ["d4e1a55", "s3c638e"], "develop", 30);
  git.refs = { main: "m2f0e11", develop: "d5f2b66" }; git.tags = { m2f0e11: "v0.2.0", "1a2b3c4": "v0.1.0" }; git.trees = { main: { ...tree }, develop: { ...tree } };
  w.BRANCH = "develop";
  const label = document.getElementById("st-branch-l"); if (label) label.textContent = "develop";
  w.COMMITS.length = 0; git.order.slice(0, 6).forEach((h) => w.COMMITS.push({ h, m: git.c[h].m }));
  w.REPO = true;
}
