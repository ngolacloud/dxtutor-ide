// The top menu bar (File/Edit/View/Co-Dev/Help). Plain dropdowns, real actions — no demo.

export interface MenuItem {
  label: string;
  run?: () => void;
  sep?: boolean;
}
export interface Menu {
  title: string;
  items: MenuItem[];
}

export class MenuBar {
  private open: HTMLElement | null = null;

  constructor(private host: HTMLElement, private menus: Menu[]) {
    this.render();
    document.addEventListener("mousedown", (e) => {
      if (this.open && !this.host.contains(e.target as Node)) this.close();
    });
  }

  private render(): void {
    this.host.innerHTML = "";
    for (const m of this.menus) {
      const btn = document.createElement("button");
      btn.className = "mb-title";
      btn.textContent = m.title;
      btn.onclick = (e) => { e.stopPropagation(); this.toggle(btn, m); };
      this.host.appendChild(btn);
    }
  }

  private toggle(btn: HTMLElement, m: Menu): void {
    if (this.open?.dataset.for === m.title) { this.close(); return; }
    this.close();
    const drop = document.createElement("div");
    drop.className = "mb-drop";
    drop.dataset.for = m.title;
    for (const it of m.items) {
      if (it.sep) { const s = document.createElement("div"); s.className = "mb-sep"; drop.appendChild(s); continue; }
      const row = document.createElement("div");
      row.className = "mb-item";
      row.textContent = it.label;
      row.onclick = () => { this.close(); it.run?.(); };
      drop.appendChild(row);
    }
    const r = btn.getBoundingClientRect();
    drop.style.left = `${r.left}px`;
    drop.style.top = `${r.bottom}px`;
    document.body.appendChild(drop);
    this.open = drop;
  }

  /** Replace the menu set (e.g. after a locale change) and re-render the bar. */
  setMenus(menus: Menu[]): void {
    this.close();
    this.menus = menus;
    this.render();
  }

  /** Open a menu by title (for the harness). Returns the item labels shown. */
  openMenu(title: string): string[] {
    const btn = [...this.host.querySelectorAll<HTMLElement>(".mb-title")].find((b) => b.textContent === title);
    const m = this.menus.find((x) => x.title === title);
    if (!btn || !m) return [];
    this.toggle(btn, m);
    return [...(this.open?.querySelectorAll(".mb-item") ?? [])].map((e) => e.textContent ?? "");
  }

  close(): void {
    this.open?.remove();
    this.open = null;
  }
}
