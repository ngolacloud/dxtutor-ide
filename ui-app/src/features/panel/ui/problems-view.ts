/* ═════════ feature `panel` — vista do Problems ═════════
   Como no VS Code: agrupado por ficheiro (recolhível), ícone de severidade, mensagem,
   fonte(código) e [Ln, Col]; filtro de texto e de severidades; clique abre o ficheiro na
   linha. Mais uma linha de estado honesta: a correr, quando acabou, que checkers
   correram, e o que ficou de fora por falta de ferramenta. */

import type { Problem } from "../domain/types";
import { counts, filterProblems, groupByFile, type ProblemFilter } from "../domain/problems";
import { duration } from "../domain/naming";
import type { ProblemsState } from "../application/problems-service";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const ICON: Record<string, string> = { error: "✖", warning: "⚠", info: "ℹ" };

export function renderProblems(el: HTMLElement, o: {
  state: Readonly<ProblemsState>;
  problems: Problem[];
  filter: ProblemFilter;
  collapsed: ReadonlySet<string>;
  root: string | null;
}): void {
  const { state, filter, collapsed } = o;
  if (!o.root) {
    el.innerHTML = `<div class="sec-empty">Open a folder to see its problems.</div>`;
    return;
  }
  const shown = filterProblems(o.problems, filter);
  const groups = groupByFile(shown);
  const scan = state.scan;
  const checks = scan?.checks ?? [];
  const status = state.running
    ? `<span class="pb-spin"></span> Checking the workspace…`
    : state.error
      ? `<span class="pb-err">✖ ${esc(state.error)}</span>`
      : scan
        ? `${checks.length ? checks.map((c) => `<span class="pb-chk${c.error ? " er" : ""}" title="${esc(c.command)}${c.error ? "\n\n" + esc(c.error) : ""}">${c.error ? "✖" : "✓"} ${esc(c.source)} <i>${duration(c.millis)}</i></span>`).join("") : "No checker applies to this folder"}${state.finishedAt ? `<span class="pb-at">${new Date(state.finishedAt).toLocaleTimeString()}</span>` : ""}`
        : "Not checked yet";
  const skipped = (scan?.skipped ?? []).map((s) => `<div class="pb-skip">⚠ ${esc(s)}</div>`).join("");
  const hidden = o.problems.length - shown.length;
  let body: string;
  if (!scan && !o.problems.length) body = state.running ? "" : `<div class="sec-empty">No problems have been detected in the workspace yet.</div>`;
  else if (!o.problems.length) body = `<div class="sec-empty">No problems have been detected in the workspace.</div>`;
  else if (!shown.length) body = `<div class="sec-empty">No results with the current filter (${hidden} hidden). <a data-action="pb-clear-filter">Clear filter</a></div>`;
  else
    body = groups
      .map((g) => {
        const open = !collapsed.has(g.file);
        const slash = g.file.lastIndexOf("/");
        const name = g.file.slice(slash + 1), dir = slash > 0 ? g.file.slice(0, slash) : "";
        const head = `<div class="pb-file" data-action="pb-toggle" data-on="${esc(g.file)}"><span class="pb-chev${open ? " open" : ""}">›</span><span class="pb-fn">${esc(name)}</span><span class="pb-dir">${esc(dir)}</span><span class="pb-cnt">${g.items.length}</span></div>`;
        if (!open) return head;
        return head + g.items
          .map((p) => {
            const msg = p.message.split("\n")[0];
            return `<div class="pb-row" data-action="pb-open" data-on="${esc(p.file)}|${p.line}" title="${esc(p.message)}"><span class="pb-ic ${p.severity}">${ICON[p.severity]}</span><span class="pb-msg">${esc(msg)}</span><span class="pb-src">${esc(p.source)}${p.code ? `(${esc(p.code)})` : ""}</span><span class="pb-loc">[Ln ${p.line}, Col ${p.col}]</span></div>`;
          })
          .join("");
      })
      .join("");
  el.innerHTML = `<div class="pb-status">${status}</div>${skipped}${body}`;
}

/** Texto curto para o separador e para a barra de estado. */
export function problemCounts(ps: readonly Problem[]): { total: number; errors: number; warnings: number } {
  const c = counts(ps);
  return { total: ps.length, errors: c.errors, warnings: c.warnings + c.infos };
}
