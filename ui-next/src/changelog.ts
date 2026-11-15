// Vista «O que mudou e porquê» (F12): a linha temporal REAL do repositório — git_log dá os
// commits (o «porquê» é a mensagem de commit verdadeira, escrita por quem mudou; nesta fase
// NÃO se geram explicações por LLM) e clicar num commit abre o `git show <hash>` real
// (cabeçalho + patch) tal-e-qual. Nada é resumido nem reescrito; datas vêm relativas do
// backend (%cr) e mostram-se como chegam. Assuntos/autores de commits são texto alheio →
// só por textContent, nunca HTML.

import { api, type GitCommit } from "./tauri";
import { t } from "./i18n";

export class Changelog {
  commits: GitCommit[] = [];
  private selected = "";
  private diff = "";
  private error: string | null = null;
  private loaded = false;

  constructor(private host: HTMLElement, private root: () => string) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** Relê a timeline real (git_log). Sem pasta/git → erro honesto, nunca lista inventada. */
  async refresh(): Promise<GitCommit[]> {
    const root = this.root();
    this.loaded = true;
    if (!root) {
      this.commits = [];
      this.error = t("cl.noFolder");
      this.render();
      return this.commits;
    }
    try {
      this.commits = await api.gitLog(root, 30);
      this.error = null;
    } catch (e) {
      this.commits = [];
      this.error = String(e);
    }
    this.render();
    return this.commits;
  }

  /** Abre o diff REAL de um commit (`git show <hash>`) no painel da vista. */
  async openCommit(hash: string): Promise<string> {
    this.diff = await api.gitShow(this.root(), hash);
    this.selected = hash;
    this.render();
    return this.diff;
  }

  state(): { commits: number; selected: string; diffLen: number } {
    return { commits: this.commits.length, selected: this.selected, diffLen: this.diff.length };
  }

  private render(): void {
    if (!this.loaded) {
      this.host.innerHTML = `<div class="cl-note">${t("cl.hint")}</div>`;
      return;
    }
    if (this.error) {
      this.host.innerHTML = `<div class="cl-note cl-error"></div>`;
      (this.host.querySelector(".cl-error") as HTMLElement).textContent = this.error;
      return;
    }
    const rows = this.commits.length
      ? this.commits.map(() =>
          `<div class="cl-row">
             <div class="cl-top"><span class="cl-subject"></span><span class="cl-hash"></span></div>
             <div class="cl-meta"><span class="cl-author"></span><span class="cl-date"></span><span class="cl-merge hidden">${t("cl.merge")}</span></div>
           </div>`).join("")
      : `<div class="cl-note">${t("cl.none")}</div>`;
    this.host.innerHTML = `
      <div class="cl-sect">${t("cl.timeline")}</div>
      <div class="cl-list">${rows}</div>
      <div class="cl-sect cl-diff-head ${this.selected ? "" : "hidden"}">${t("cl.diffOf")}</div>
      <div class="cl-diff ${this.selected ? "" : "hidden"}"><pre></pre></div>`;
    this.host.querySelectorAll<HTMLElement>(".cl-row").forEach((row, i) => {
      const c = this.commits[i];
      row.setAttribute("data-hash", c.hash);
      row.classList.toggle("on", c.hash === this.selected);
      (row.querySelector(".cl-subject") as HTMLElement).textContent = c.subject;
      (row.querySelector(".cl-hash") as HTMLElement).textContent = c.short;
      (row.querySelector(".cl-author") as HTMLElement).textContent = c.author;
      (row.querySelector(".cl-date") as HTMLElement).textContent = c.date;
      (row.querySelector(".cl-merge") as HTMLElement).classList.toggle("hidden", c.parents.length < 2);
      row.onclick = () =>
        void this.openCommit(c.hash).catch((e) => { this.error = String(e); this.render(); });
    });
    if (this.selected) (this.host.querySelector(".cl-diff pre") as HTMLElement).textContent = this.diff;
  }
}
