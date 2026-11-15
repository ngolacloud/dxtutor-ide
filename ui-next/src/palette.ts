// Command palette: Ctrl+P fuzzy-opens real project files; Ctrl+Shift+P runs commands/views.
// A thin overlay, no framework. The item lists come from the app (real files, real actions).

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
}

/** Simple subsequence fuzzy match + score (lower = better). Pure, exported for tests. */
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let prev = -1;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    score += idx - ti + (prev >= 0 && idx === prev + 1 ? 0 : 2);
    prev = idx;
    ti = idx + 1;
  }
  return score + (t.length - q.length) * 0.01;
}

export class Palette {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private items: PaletteItem[] = [];
  private filtered: PaletteItem[] = [];
  private sel = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "pal-overlay hidden";
    this.el.innerHTML = `<div class="pal"><input class="pal-input" spellcheck="false" /><div class="pal-list"></div></div>`;
    document.body.appendChild(this.el);
    this.input = this.el.querySelector(".pal-input") as HTMLInputElement;
    this.list = this.el.querySelector(".pal-list") as HTMLElement;
    this.input.addEventListener("input", () => this.refilter());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("mousedown", (e) => { if (e.target === this.el) this.close(); });
  }

  open(prefix: string, items: PaletteItem[]): void {
    this.items = items;
    this.input.value = prefix;
    this.el.classList.remove("hidden");
    this.input.focus();
    this.refilter();
  }
  close(): void {
    this.el.classList.add("hidden");
  }
  get isOpen(): boolean {
    return !this.el.classList.contains("hidden");
  }

  /** Expose the current filtered labels (for the harness). */
  results(): string[] {
    return this.filtered.map((i) => i.label);
  }
  /** Set the query and refilter (for the harness). */
  setQuery(q: string): void {
    this.input.value = q;
    this.refilter();
  }

  private refilter(): void {
    const q = this.input.value.replace(/^[>]/, "").trim();
    this.filtered = this.items
      .map((it) => ({ it, s: fuzzy(q, it.label) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (a.s as number) - (b.s as number))
      .slice(0, 50)
      .map((x) => x.it);
    this.sel = 0;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { this.close(); return; }
    if (e.key === "ArrowDown") { this.sel = Math.min(this.sel + 1, this.filtered.length - 1); this.render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { this.sel = Math.max(this.sel - 1, 0); this.render(); e.preventDefault(); }
    else if (e.key === "Enter") { this.filtered[this.sel]?.run(); this.close(); e.preventDefault(); }
  }

  private render(): void {
    this.list.innerHTML = "";
    this.filtered.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "pal-row" + (i === this.sel ? " sel" : "");
      row.innerHTML = `<span class="pal-label"></span><span class="pal-hint"></span>`;
      (row.querySelector(".pal-label") as HTMLElement).textContent = it.label;
      (row.querySelector(".pal-hint") as HTMLElement).textContent = it.hint ?? "";
      row.onclick = () => { it.run(); this.close(); };
      this.list.appendChild(row);
    });
  }
}
