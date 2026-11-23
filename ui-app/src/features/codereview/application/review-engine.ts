/* ═══════ feature Explain · Code-Review · Under-the-Hood — casos de uso (ADR-0002, Fase 3) ═══════
   A orquestração extraída do resíduo `features/codereview.ts`: escolher o ficheiro
   em foco (`curFile`), colher os achados da revisão (`reviewFindings`, delegando na
   regra pura do `domain/`), abrir as tabs de Code review / Under the hood
   (`reviewCmd`/`hoodCmd`) e conduzir o Explain (`explainCmd`). Importa SÓ `domain/`
   (as formas + a regra) e `ports.ts` (as capacidades do mundo). Sem DOM, sem
   `window`, sem Tauri, sem HTML — tudo o que precisa chega por `deps` (A7/A8).

   Fiel ao comportamento anterior (UI/comportamento congelados): a mesma escolha de
   ficheiro, os mesmos prompts de conversa, a mesma ordem de efeitos. Só mudou a
   PROVENIÊNCIA das capacidades — antes globais resolvidos pelo bridge, agora
   injectadas por argumento. O Explain não monta markup: colhe os factos e
   entrega-os à porta `view.explainCard`, que é dona do cartão. */

import type { Finding } from "../domain/types";
import { reviewFindings as reviewRules } from "../domain/review";
import type { ReviewDeps } from "./ports";

/** A superfície pública do motor — o resíduo liga estes nomes ao `window` (os
 *  consumidores em v6.ts/debug.ts/visualizer.ts e o selftest do bridge resolvem-nos
 *  por nome livre). */
export interface ReviewEngine {
  curFile(): string;
  reviewFindings(path: string): Finding[];
  reviewCmd(): void;
  hoodCmd(): void;
  explainCmd(fromDebug?: boolean): void;
}

export function makeReviewEngine(deps: ReviewDeps): ReviewEngine {
  const { workspace, agent, diagnostics, code, view } = deps;

  /** O ficheiro a que os comandos se aplicam: o separador activo se for um ficheiro
   *  de `FS`, senão a 1ª alteração não-commitada, senão o primeiro ficheiro do
   *  workspace; `""` sem ficheiros (os comandos não fazem nada). */
  function curFile(): string {
    const t = workspace.tabOf(workspace.currentTabId());
    if (t && t.path && workspace.files()[t.path]) return t.path;
    const c = workspace.changes();
    if (c[0]) return c[0];
    return Object.keys(workspace.files())[0] || "";
  }

  /** Colhe do `FS` o conteúdo e a extensão e delega em `reviewRules` (domain). */
  function reviewFindings(p: string): Finding[] {
    const f = workspace.files()[p];
    if (!f) return [];
    return reviewRules({
      path: p,
      content: f.content,
      ext: workspace.extOf(p),
    });
  }

  function reviewCmd(): void {
    const p = curFile();
    if (!p) return;
    workspace.open({ id: "creview:" + p, title: "Review · " + p.split("/").pop(), kind: "creview", path: p });
  }

  function hoodCmd(): void {
    const p = curFile();
    if (!p) return;
    workspace.open({ id: "hood:" + p, title: "Under the hood · " + p.split("/").pop(), kind: "hood", path: p });
  }

  function explainCmd(fromDebug?: boolean): void {
    const p = curFile(), sel = fromDebug ? "" : code.selText(), f = workspace.files()[p];
    if (!f) return;
    agent.focus(true);
    const ds = code.dbgState();
    const what = fromDebug && ds ? `the debugging session I just ran (${ds.end ? ds.end.t : ""})` : sel ? `this excerpt from ${workspace.short(p)}` : workspace.short(p);
    if (agent.sample() && agent.claudeOn()) {
      agent.setActiveProvider("claude"); agent.updateUI();
      agent.liveChat(fromDebug && ds ? `Explain in depth, as a senior engineer teaching me, what this debug session found and the underlying concept:\n${ds.feed.map(x => x.h.replace(/<[^>]+>/g, "")).join("\n")}` : `Explain ${what}: what it does, how, and what a senior would watch out for. Be concrete.\n${sel || f.content.slice(0, 5000)}`);
      return;
    }
    agent.user(`Explain ${what}.`);
    const sy = code.symbols(p), dg = diagnostics.all().filter(d => d.p === p), rv = reviewFindings(p).slice(0, 2);
    const m = f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m);
    view.explainCard({
      path: p,
      dbgEnd: fromDebug && ds && ds.end ? ds.end.b : null,
      lineCount: f.content.split("\n").length,
      symbols: sy.map(s => ({ n: s.n })),
      firstComment: m?.[2] ?? null,
      diagnostics: dg.map(d => d.msg),
      findings: rv.map(r => ({ t: r.t, l: r.l })),
    });
  }

  return { curFile, reviewFindings, reviewCmd, hoodCmd, explainCmd };
}
