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
   injectadas por argumento. O Explain e o Code review não montam markup nem falam
   com o chat: colhem os factos e entregam-nos à porta `doc` (o painel de documento
   ao lado do código, `doc-session.ts`). */

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
  explainCmd(): void;
  reviewTab(path: string): void;
}

export function makeReviewEngine(deps: ReviewDeps): ReviewEngine {
  const { workspace, diagnostics, code, doc } = deps;

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

  /** Code review: abre a revisão interactiva no painel ao lado do código (as regras, os
   *  analisadores e a revisão com IA), já não numa tab que tapa o ficheiro. */
  function reviewCmd(): void {
    const p = curFile();
    if (!p) return;
    doc.review({ path: p });
  }

  /** A revisão em tab inteira (o «Open as tab» do painel e as sessões antigas). */
  function reviewTab(p: string): void {
    workspace.open({ id: "creview:" + p, title: "Review · " + p.split("/").pop(), kind: "creview", path: p });
  }

  function hoodCmd(): void {
    const p = curFile();
    if (!p) return;
    workspace.open({ id: "hood:" + p, title: "Under the hood · " + p.split("/").pop(), kind: "hood", path: p });
  }

  /** Explain: a resposta abre no painel de documento ao lado do código (não no chat). Com
   *  modelo, o painel pede-a e mostra-a a chegar; sem modelo, mostra o resumo local destes factos. */
  function explainCmd(): void {
    const p = curFile(), sel = code.selText(), f = workspace.files()[p];
    if (!f) return;
    const sy = code.symbols(p), dg = diagnostics.all().filter(d => d.p === p), rv = reviewFindings(p).slice(0, 3);
    const m = f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m);
    doc.explain({
      path: p,
      selection: sel.trim() ? { text: sel, line: code.selLine() } : null,
      card: {
        path: p,
        lineCount: f.content.split("\n").length,
        symbols: sy.map(s => ({ n: s.n, line: s.line })),
        firstComment: m?.[2] ?? null,
        diagnostics: dg.map(d => ({ line: d.line, msg: d.msg })),
        findings: rv.map(r => ({ t: r.t, l: r.l })),
      },
    });
  }

  return { curFile, reviewFindings, reviewCmd, reviewTab, hoodCmd, explainCmd };
}
