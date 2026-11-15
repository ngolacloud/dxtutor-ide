// Source Control panel: the real git state of the open folder. Lists changes (git_changes),
// commits a message (git_commit, stage-all first), and shows history (git_log). No demo — an
// empty list means the working tree is genuinely clean.

import { api, type GitChange, type GitCommit } from "./tauri";
import { layout, renderGraph, graphMetrics } from "./graph";
import { t } from "./i18n";

export class Scm {
  private changes: GitChange[] = [];
  private log: GitCommit[] = [];

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private onCommitted: () => void,
    private onOpenDiff: (rel: string) => void,
  ) {
    this.host.innerHTML = `
      <div class="scm-commit">
        <input class="scm-msg" spellcheck="false" />
        <button class="scm-btn"></button>
      </div>
      <div class="scm-sec scm-sec-ch"></div>
      <div class="scm-changes"></div>
      <div class="scm-sec scm-sec-hist"></div>
      <div class="scm-log"></div>`;
    this.applyLocale();
    (this.host.querySelector(".scm-btn") as HTMLButtonElement).onclick = () => void this.commit();
    (this.host.querySelector(".scm-msg") as HTMLInputElement).addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.commit();
    });
  }

  /** Repinta os rótulos estáticos do painel na locale corrente. */
  applyLocale(): void {
    (this.host.querySelector(".scm-msg") as HTMLInputElement).placeholder = t("scm.msgPlaceholder");
    (this.host.querySelector(".scm-btn") as HTMLElement).textContent = t("scm.commit");
    (this.host.querySelector(".scm-sec-ch") as HTMLElement).textContent = t("scm.changes");
    (this.host.querySelector(".scm-sec-hist") as HTMLElement).textContent = t("scm.history");
  }

  /** Reload the real git state. Safe to call whenever the workspace changes. */
  async refresh(): Promise<void> {
    const root = this.root();
    if (!root) return;
    try {
      [this.changes, this.log] = await Promise.all([api.gitChanges(root), api.gitLog(root, 30)]);
    } catch {
      this.changes = [];
      this.log = [];
    }
    this.render();
  }

  async commit(): Promise<boolean> {
    const root = this.root();
    const input = this.host.querySelector(".scm-msg") as HTMLInputElement;
    const msg = input.value.trim();
    if (!root || !msg || this.changes.length === 0) return false;
    await api.gitStageAll(root);
    await api.gitCommit(root, msg);
    input.value = "";
    await this.refresh();
    this.onCommitted();
    return true;
  }

  get changeCount(): number {
    return this.changes.length;
  }
  get head(): GitCommit | undefined {
    return this.log[0];
  }

  private render(): void {
    const ch = this.host.querySelector(".scm-changes") as HTMLElement;
    ch.innerHTML = "";
    if (this.changes.length === 0) {
      ch.innerHTML = `<div class="scm-empty">${t("scm.noChanges")}</div>`;
    } else {
      for (const c of this.changes) {
        const row = document.createElement("div");
        row.className = "scm-row";
        const letter = c.status.trim()[0] ?? "M";
        row.innerHTML = `<span class="scm-st ${stClass(letter)}">${letter}</span><span class="scm-path"></span>`;
        (row.querySelector(".scm-path") as HTMLElement).textContent = c.path;
        // Clicar numa alteração abre o diff real (git_show HEAD:<rel> vs buffer).
        row.onclick = () => this.onOpenDiff(c.path);
        ch.appendChild(row);
      }
    }
    const lg = this.host.querySelector(".scm-log") as HTMLElement;
    lg.innerHTML = "";
    if (this.log.length === 0) return;
    // Real DAG: an SVG graph on the left, commit rows aligned to it by height.
    const g = layout(this.log);
    const gw = graphMetrics.laneWidth(g.lanes);
    const graphCol = document.createElement("div");
    graphCol.className = "scm-graph";
    graphCol.style.width = `${gw}px`;
    graphCol.innerHTML = renderGraph(g);
    const rows = document.createElement("div");
    rows.className = "scm-logrows";
    for (const c of this.log) {
      const row = document.createElement("div");
      row.className = "scm-logrow";
      row.style.height = `${graphMetrics.ROW_H}px`;
      row.innerHTML = `<span class="scm-hash"></span><span class="scm-subj"></span>`;
      (row.querySelector(".scm-hash") as HTMLElement).textContent = c.short;
      (row.querySelector(".scm-subj") as HTMLElement).textContent = c.subject;
      rows.appendChild(row);
    }
    lg.appendChild(graphCol);
    lg.appendChild(rows);
  }

  /** The laid-out graph for the current log — exposed for the harness. */
  graphInfo(): { nodes: number; lanes: number; edges: number } {
    const g = layout(this.log);
    return { nodes: g.nodes.length, lanes: g.lanes, edges: g.edges.length };
  }
}

function stClass(letter: string): string {
  if (letter === "?" || letter === "A") return "u";
  if (letter === "D") return "d";
  return "m";
}
