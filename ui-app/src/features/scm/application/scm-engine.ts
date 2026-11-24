/* ═══════════ feature `scm` — application: motor git/scm (ADR-0002, Fase 3) ═══════════
   Os casos de uso git/scm, puros face ao mundo: recebem as capacidades por portas
   (`ScmDeps`) e dependem só de `domain/`. Sem DOM, sem `window`, sem Tauri — a
   composição (`features/scm.ts`) injecta os adaptadores do legacy-bridge.

   O estado é mutado no SÍTIO (mesma referência que o resíduo publica), por isso os
   consumidores do monólito continuam a vê-lo.

   ADR-0005, R1d — sem git simulado. `gitInit` deixa de semear um histórico inventado
   (12 commits, main/develop, tags v0.1.0/v0.2.0): o modelo nasce vazio, sem ramo. Sem um
   repositório git real aberto (`store.repo()` — no desktop, a pasta aberta é um repo), as
   operações que mudam o git (commit/checkout/merge/gitflow) recusam com um aviso em vez de
   inventar commits e ramos em memória. Com repo, este motor é o espelho optimista do
   repositório: o `bridge.ts` decora-o com git real e reconstrói o DAG (`syncGit`). O
   gitflow (`gfStart`/`gfFinish`) muda de ramo e faz merge pela porta `flow`, que a
   composição liga às versões DECORADAS do `window` — antes chamava o `checkout`/`gitMerge`
   locais e, no desktop, o repositório nunca saía do ramo actual. */

import { statusOf, listChanges } from "../domain/status";
import { isFlow, slug } from "../domain/gitflow";
import type { Commit } from "../domain/types";
import type { ScmDeps, ScmEngine, CommitResult } from "./ports";

/** Aviso único de «sem repositório» (commit/checkout/merge/gitflow sem git aberto). */
export const NO_REPO = "Sem repositório git — abre uma pasta com git na app desktop";

export function makeScmEngine(deps: ScmDeps): ScmEngine {
  const { workspace, store, flow, notifier, logger, view, terminal, clock, ids } = deps;

  /** Sem repositório git aberto, avisa e devolve `false` (o chamador devolve o seu «nada»). */
  const noRepo = (): boolean => { if (store.repo()) return false; notifier.toast(NO_REPO); return true; };

  /* wrappers internos sobre o domínio puro, injectando o `FS` vivo */
  const stOf = (p: string): string => statusOf(workspace.files()[p], p);
  const changes = (): string[] => listChanges(workspace.files());

  /** O modelo de um workspace sem repositório: DAG vazio, sem ramo nem commits. */
  function gitInit(): void {
    Object.assign(store.git(), { c: {}, order: [], refs: {}, trees: {}, base: {}, tags: {} });
    store.setBranch("");
    store.commits().length = 0;
  }

  /* commit v4 git-aware (actualiza o DAG, as árvores e as refs; aceita autor) */
  function commit(msg?: string, author?: string): CommitResult | null {
    if (noRepo()) return null;
    const FS = workspace.files(), st = store.staged();
    msg = msg || store.commitMsg().trim(); const list = (st.size ? [...st] : changes()).filter((p) => FS[p] && stOf(p));
    if (!list.length) { notifier.toast("Nada para commitar"); return null; }
    if (!msg) { notifier.toast("Escreve a mensagem de commit"); view.focusCommitInput(); return null; }
    const git = store.git(), h = ids.next(), b = store.branch(), tr = git.trees[b] || (git.trees[b] = {}); /* repo acabado de criar: o ramo ainda não tem árvore */
    list.forEach((p) => { FS[p].orig = FS[p].content; tr[p] = FS[p].content; }); st.clear(); store.setCommitMsg("");
    git.c[h] = { h, m: msg, p: git.refs[b] ? [git.refs[b]] : [], b, a: author || store.author(), t: clock.now(), files: list.slice() }; git.order.unshift(h); git.refs[b] = h;
    const c = { h, m: msg, n: list.length }; store.commits().unshift(c); view.refresh(false, true); notifier.toast(`Commit ${h} em ${b} · ${list.length} ficheiro(s)`); return c;
  }

  /* commit v2 (botão «Commit»): só carimba FS.orig + COMMITS, sem tocar no DAG */
  function commitV2(msg?: string): CommitResult | null {
    if (noRepo()) return null;
    const FS = workspace.files(), st = store.staged();
    msg = msg || store.commitMsg().trim(); const list = (st.size ? [...st] : changes()).filter((p) => FS[p] && stOf(p));
    if (!list.length) { notifier.toast("Nada para commitar"); return null; } if (!msg) { notifier.toast("Escreve a mensagem de commit"); view.focusCommitInput(); return null; }
    list.forEach((p) => { FS[p].orig = FS[p].content; }); st.clear(); store.setCommitMsg(""); const c = { h: ids.next(), m: msg, n: list.length }; store.commits().unshift(c); view.refresh(false, true); view.drawTimeline(); notifier.toast(`Commit ${c.h} · ${list.length} ficheiro(s)`); return c;
  }

  function checkout(b: string, create?: boolean): boolean {
    if (noRepo()) return false;
    const FS = workspace.files(), git = store.git();
    if (create) { const from = store.branch(); if (git.refs[b]) { notifier.toast("O ramo já existe: " + b); return false; } git.refs[b] = git.refs[from]; git.trees[b] = { ...git.trees[from] }; git.base[b] = { ...git.trees[from] }; }
    const tr = git.trees[b]; if (!tr) { notifier.toast("Ramo desconhecido: " + b); return false; } const dirty: Record<string, string> = {}; changes().forEach((p) => (dirty[p] = FS[p].content));
    Object.keys(FS).forEach((k) => { if (!/\/learn\//.test(k)) delete FS[k]; }); Object.keys(tr).forEach((p) => { FS[p] = { content: p in dirty ? dirty[p] : tr[p], orig: tr[p] }; }); Object.keys(dirty).forEach((p) => { if (!FS[p]) FS[p] = { content: dirty[p], orig: null }; });
    store.setBranch(b); store.staged().clear(); view.refresh(false, true); terminal.refreshPrompt(); return true;
  }

  function gitMerge(src: string, author?: string): Commit | null {
    if (noRepo()) return null;
    const FS = workspace.files(), git = store.git(), dst = store.branch(), ts = git.trees[src], td = git.trees[dst]; if (!ts || src === dst) return null;
    const base = git.base[src + ">" + dst] || git.base[src] || {}, mfiles: string[] = [];
    Object.keys(ts).forEach((p) => { if (ts[p] !== td[p] && ts[p] !== base[p]) { td[p] = ts[p]; mfiles.push(p); if (FS[p] && stOf(p)) FS[p].orig = ts[p]; else FS[p] = { content: ts[p], orig: ts[p] }; } });
    const h = ids.next(); git.c[h] = { h, m: `Merge ${src} em ${dst}`, p: [git.refs[dst], git.refs[src]], b: dst, a: author || "w", t: clock.now(), files: mfiles }; git.order.unshift(h); git.refs[dst] = h; git.base[src + ">" + dst] = { ...ts }; store.commits().unshift({ h, m: git.c[h].m }); view.refresh(false, true); return git.c[h];
  }

  function gfStart(kind: string, name: string): string {
    if (noRepo()) return "";
    if (store.branch() !== "develop" && kind !== "hotfix") flow.checkout("develop"); if (kind === "hotfix" && store.branch() !== "main") flow.checkout("main");
    const b = kind + "/" + slug(name); if (store.git().refs[b]) flow.checkout(b); else flow.checkout(b, true); logger.log("gitflow", `início de ${b} a partir de ${kind === "hotfix" ? "main" : "develop"}`); return b;
  }

  function gfFinish(b?: string, author?: string): Commit | null {
    if (noRepo()) return null;
    const git = store.git();
    b = b || store.branch(); if (!isFlow(b) || !git.refs[b]) return null; let m: Commit | null;
    if (/^(release|hotfix)\//.test(b)) { flow.checkout("main"); m = flow.merge(b, author); if (m) git.tags[m.h] = "v" + b.split("/")[1]; flow.checkout("develop"); flow.merge(b, author); } else { flow.checkout("develop"); m = flow.merge(b, author); }
    delete git.refs[b]; delete git.trees[b]; view.refresh(false, true); logger.log("gitflow", `fim de ${b}: merge ${/^(release|hotfix)/.test(b) ? "em main (com tag) e develop" : "em develop"}`); view.rerender("graph"); return m;
  }

  function stage(p: string): void { const st = store.staged(); st.has(p) ? st.delete(p) : st.add(p); view.rerenderPane(); }

  function discard(p: string): void { const FS = workspace.files(); const f = FS[p]; if (f.orig == null) delete FS[p]; else f.content = f.orig; store.staged().delete(p); view.refresh(); notifier.toast("Alterações descartadas: " + p.split("/").pop()); }

  return { gitInit, commit, commitV2, checkout, gitMerge, gfStart, gfFinish, stage, discard };
}
