/* ═══════════ feature `scm` — application: motor git/scm (ADR-0002, Fase 3) ═══════════
   Os casos de uso git/scm, puros face ao mundo: recebem as capacidades por portas
   (`ScmDeps`) e dependem só de `domain/`. Sem DOM, sem `window`, sem Tauri — a
   composição (`features/scm.ts`) injecta os adaptadores do legacy-bridge.

   O comportamento é o do motor original de `features/scm.ts` (migrado 1:1): só mudou
   DE ONDE vêm o `FS`/`GIT`/`BRANCH`/`toast`/`refresh`/… — agora das portas, antes de
   globais `window.*`. O estado é mutado no SÍTIO (mesma referência que o resíduo
   publica), por isso os consumidores do monólito continuam a vê-lo. */

import { statusOf, listChanges } from "../domain/status";
import { isFlow, slug } from "../domain/gitflow";
import type { Commit } from "../domain/types";
import type { ScmDeps, ScmEngine, CommitResult } from "./ports";

export function makeScmEngine(deps: ScmDeps): ScmEngine {
  const { workspace, store, notifier, logger, view, terminal, clock, ids } = deps;

  /* wrappers internos sobre o domínio puro, injectando o `FS` vivo */
  const stOf = (p: string): string => statusOf(workspace.files()[p], p);
  const changes = (): string[] => listChanges(workspace.files());

  function gitInit(): void {
    const git = store.git();
    Object.assign(git, { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} });
    const FS = workspace.files();
    const tree: Record<string, string> = {};
    Object.keys(FS).forEach((p) => { if (FS[p].orig != null) tree[p] = FS[p].orig as string; });
    const add = (h: string, m: string, p: string[], b: string, ago: number): void => {
      git.c[h] = { h, m, p, b, a: "w", t: clock.now() - ago * 3600e3, files: [] }; git.order.unshift(h);
    };
    add("1a2b3c4", "chore: commit inicial", [], "main", 420); add("d1e5f60", "feat(store): workspaces em SQLite", ["1a2b3c4"], "develop", 380); add("d2a7c91", "feat(desktop): painel do Co-Dev", ["d1e5f60"], "develop", 300);
    add("m2f0e11", "Merge release/0.2.0 em main", ["1a2b3c4", "d2a7c91"], "main", 290); add("d3b8d22", "chore: actualizar dependências", ["d2a7c91"], "develop", 200);
    add("l1c9e33", "feat(tutor): percursos de aprendizagem", ["d3b8d22"], "feature/learning-paths", 170); add("l2d0f44", "feat(tutor): progresso por percurso", ["l1c9e33"], "feature/learning-paths", 150);
    add("s164943", "feat(arch): interactive canvas", ["d3b8d22"], "feature/studio-canvas", 140); add("d4e1a55", "Merge feature/learning-paths em develop", ["d3b8d22", "l2d0f44"], "develop", 120);
    add("s2a5b0d", "feat(arch): double-click a node to delete it", ["s164943"], "feature/studio-canvas", 90); add("s3c638e", "feat(arch): persist the Studio design", ["s2a5b0d"], "feature/studio-canvas", 60);
    add("d5f2b66", "Merge feature/studio-canvas em develop", ["d4e1a55", "s3c638e"], "develop", 30);
    git.refs = { main: "m2f0e11", develop: "d5f2b66" }; git.tags = { m2f0e11: "v0.2.0", "1a2b3c4": "v0.1.0" }; git.trees = { main: { ...tree }, develop: { ...tree } };
    store.setBranch("develop");
    const C = store.commits(); C.length = 0; git.order.slice(0, 6).forEach((h) => C.push({ h, m: git.c[h].m }));
  }

  /* commit v4 git-aware (actualiza o DAG, as árvores e as refs; aceita autor) */
  function commit(msg?: string, author?: string): CommitResult | null {
    const FS = workspace.files(), st = store.staged();
    msg = msg || store.commitMsg().trim(); const list = (st.size ? [...st] : changes()).filter((p) => FS[p] && stOf(p));
    if (!list.length) { notifier.toast("Nada para commitar"); return null; }
    if (!msg) { notifier.toast("Escreve a mensagem de commit"); view.focusCommitInput(); return null; }
    const git = store.git(), h = ids.next(), b = store.branch(), tr = git.trees[b];
    list.forEach((p) => { FS[p].orig = FS[p].content; tr[p] = FS[p].content; }); st.clear(); store.setCommitMsg("");
    git.c[h] = { h, m: msg, p: git.refs[b] ? [git.refs[b]] : [], b, a: author || store.author(), t: clock.now(), files: list.slice() }; git.order.unshift(h); git.refs[b] = h;
    const c = { h, m: msg, n: list.length }; store.commits().unshift(c); view.refresh(false, true); notifier.toast(`Commit ${h} em ${b} · ${list.length} ficheiro(s)`); return c;
  }

  /* commit v2 (botão «Commit»): só carimba FS.orig + COMMITS, sem tocar no DAG */
  function commitV2(msg?: string): CommitResult | null {
    const FS = workspace.files(), st = store.staged();
    msg = msg || store.commitMsg().trim(); const list = (st.size ? [...st] : changes()).filter((p) => FS[p] && stOf(p));
    if (!list.length) { notifier.toast("Nada para commitar"); return null; } if (!msg) { notifier.toast("Escreve a mensagem de commit"); view.focusCommitInput(); return null; }
    list.forEach((p) => { FS[p].orig = FS[p].content; }); st.clear(); store.setCommitMsg(""); const c = { h: ids.next(), m: msg, n: list.length }; store.commits().unshift(c); view.refresh(false, true); view.drawTimeline(); notifier.toast(`Commit ${c.h} · ${list.length} ficheiro(s)`); return c;
  }

  function checkout(b: string, create?: boolean): boolean {
    const FS = workspace.files(), git = store.git();
    if (create) { const from = store.branch(); if (git.refs[b]) { notifier.toast("O ramo já existe: " + b); return false; } git.refs[b] = git.refs[from]; git.trees[b] = { ...git.trees[from] }; git.base[b] = { ...git.trees[from] }; }
    const tr = git.trees[b]; if (!tr) { notifier.toast("Ramo desconhecido: " + b); return false; } const dirty: Record<string, string> = {}; changes().forEach((p) => (dirty[p] = FS[p].content));
    Object.keys(FS).forEach((k) => { if (!/\/learn\//.test(k)) delete FS[k]; }); Object.keys(tr).forEach((p) => { FS[p] = { content: p in dirty ? dirty[p] : tr[p], orig: tr[p] }; }); Object.keys(dirty).forEach((p) => { if (!FS[p]) FS[p] = { content: dirty[p], orig: null }; });
    store.setBranch(b); store.staged().clear(); view.refresh(false, true); terminal.refreshPrompt(); return true;
  }

  function gitMerge(src: string, author?: string): Commit | null {
    const FS = workspace.files(), git = store.git(), dst = store.branch(), ts = git.trees[src], td = git.trees[dst]; if (!ts || src === dst) return null;
    const base = git.base[src + ">" + dst] || git.base[src] || {}, mfiles: string[] = [];
    Object.keys(ts).forEach((p) => { if (ts[p] !== td[p] && ts[p] !== base[p]) { td[p] = ts[p]; mfiles.push(p); if (FS[p] && stOf(p)) FS[p].orig = ts[p]; else FS[p] = { content: ts[p], orig: ts[p] }; } });
    const h = ids.next(); git.c[h] = { h, m: `Merge ${src} em ${dst}`, p: [git.refs[dst], git.refs[src]], b: dst, a: author || "w", t: clock.now(), files: mfiles }; git.order.unshift(h); git.refs[dst] = h; git.base[src + ">" + dst] = { ...ts }; store.commits().unshift({ h, m: git.c[h].m }); view.refresh(false, true); return git.c[h];
  }

  function gfStart(kind: string, name: string): string {
    if (store.branch() !== "develop" && kind !== "hotfix") checkout("develop"); if (kind === "hotfix" && store.branch() !== "main") checkout("main");
    const b = kind + "/" + slug(name); store.git().refs[b] ? checkout(b) : checkout(b, true); logger.log("gitflow", `início de ${b} a partir de ${kind === "hotfix" ? "main" : "develop"}`); return b;
  }

  function gfFinish(b?: string, author?: string): Commit | null {
    const git = store.git();
    b = b || store.branch(); if (!isFlow(b) || !git.refs[b]) return null; let m: Commit | null;
    if (/^(release|hotfix)\//.test(b)) { checkout("main"); m = gitMerge(b, author); if (m) git.tags[m.h] = "v" + b.split("/")[1]; checkout("develop"); gitMerge(b, author); } else { checkout("develop"); m = gitMerge(b, author); }
    delete git.refs[b]; delete git.trees[b]; view.refresh(false, true); logger.log("gitflow", `fim de ${b}: merge ${/^(release|hotfix)/.test(b) ? "em main (com tag) e develop" : "em develop"}`); view.rerender("graph"); return m;
  }

  function stage(p: string): void { const st = store.staged(); st.has(p) ? st.delete(p) : st.add(p); view.rerenderPane(); }

  function discard(p: string): void { const FS = workspace.files(); const f = FS[p]; if (f.orig == null) delete FS[p]; else f.content = f.orig; store.staged().delete(p); view.refresh(); notifier.toast("Alterações descartadas: " + p.split("/").pop()); }

  return { gitInit, commit, commitV2, checkout, gitMerge, gfStart, gfFinish, stage, discard };
}
