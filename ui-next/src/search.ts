// Project search: real text search over the open folder via search_project. Each hit is a
// real file:line match; clicking it opens the file at that position. No demo results.

import { api, type SearchHit } from "./tauri";
import { t } from "./i18n";

export class Search {
  private input: HTMLInputElement;
  private list: HTMLElement;
  private hits: SearchHit[] = [];

  constructor(
    host: HTMLElement,
    private root: () => string,
    private onOpen: (rel: string, line: number, col: number) => void,
  ) {
    host.innerHTML = `
      <div class="sr-box"><input class="sr-input" spellcheck="false" /></div>
      <div class="sr-summary"></div>
      <div class="sr-list"></div>`;
    this.input = host.querySelector(".sr-input") as HTMLInputElement;
    this.applyLocale();
    this.list = host.querySelector(".sr-list") as HTMLElement;
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.run(); });
  }

  focus(): void {
    this.input.focus();
  }

  /** Repinta o placeholder na locale corrente. */
  applyLocale(): void {
    this.input.placeholder = t("search.placeholder");
  }

  /** Run the real backend search. Exposed for the harness. */
  async run(query?: string): Promise<SearchHit[]> {
    const q = (query ?? this.input.value).trim();
    if (query !== undefined) this.input.value = query;
    const root = this.root();
    if (!root || !q) { this.hits = []; this.render(); return []; }
    try {
      this.hits = await api.searchProject(root, q);
    } catch {
      this.hits = [];
    }
    this.render();
    return this.hits;
  }

  get hitCount(): number {
    return this.hits.length;
  }

  private render(): void {
    const sum = this.input.parentElement!.parentElement!.querySelector(".sr-summary") as HTMLElement;
    sum.textContent = this.hits.length ? t("search.results", { n: this.hits.length }) : "";
    this.list.innerHTML = "";
    for (const h of this.hits) {
      const row = document.createElement("div");
      row.className = "sr-row";
      row.innerHTML = `<span class="sr-loc"></span><span class="sr-text"></span>`;
      (row.querySelector(".sr-loc") as HTMLElement).textContent = `${h.file.split("/").pop()}:${h.line}`;
      (row.querySelector(".sr-loc") as HTMLElement).title = `${h.file}:${h.line}`;
      (row.querySelector(".sr-text") as HTMLElement).textContent = h.text.trim().slice(0, 120);
      row.onclick = () => this.onOpen(h.file, h.line, h.col);
      this.list.appendChild(row);
    }
  }
}
