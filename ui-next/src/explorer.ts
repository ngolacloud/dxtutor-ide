// The file explorer: renders the real workspace tree and reports clicks. No demo data —
// the tree is always built from what the backend returned for the opened folder.

import type { TreeNode } from "./workspace";
import { svg, fileIcon } from "./icons";
import { t } from "./i18n";

/** Operações de ficheiro reais (create_path/rename_path/delete_path) — o dono é o App. */
export interface ExplorerOps {
  newFile(dirRel: string): void;
  rename(rel: string): void;
  remove(rel: string): void;
}

export class Explorer {
  private expanded = new Set<string>();
  private selected = "";
  private ops: ExplorerOps | null = null;

  constructor(
    private host: HTMLElement,
    private onOpen: (rel: string) => void,
  ) {
    // Clique-direito no espaço vazio da árvore → novo ficheiro na raiz.
    this.host.oncontextmenu = (e) => {
      if ((e.target as HTMLElement).closest(".row")) return;
      e.preventDefault();
      if (!this.ops) return;
      this.menu(e.clientX, e.clientY, [{ label: t("tree.newFile"), run: () => this.ops?.newFile("") }]);
    };
  }

  /** Liga as operações CRUD (sem elas o menu de contexto não aparece). */
  wireOps(ops: ExplorerOps): void {
    this.ops = ops;
  }

  // ── Menu de contexto (efémero: labels via t() no momento, dispensa applyLocale) ──
  private menu(x: number, y: number, items: { label: string; run: () => void }[]): void {
    document.querySelector(".ctx-menu")?.remove();
    const m = document.createElement("div");
    m.className = "ctx-menu";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "mi";
      row.textContent = it.label;
      row.onclick = () => { m.remove(); it.run(); };
      m.appendChild(row);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
    const dismiss = (): void => { m.remove(); document.removeEventListener("mousedown", onDown, true); };
    const onDown = (e: MouseEvent): void => { if (!m.contains(e.target as Node)) dismiss(); };
    document.addEventListener("mousedown", onDown, true);
  }

  private menuFor(path: string, dir: boolean, isRoot: boolean, x: number, y: number): void {
    if (!this.ops) return;
    const ops = this.ops;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const items = [{ label: t("tree.newFile"), run: () => ops.newFile(dir ? path : parent) }];
    if (!isRoot) {
      items.push({ label: t("tree.rename"), run: () => ops.rename(path) });
      items.push({ label: t("tree.delete"), run: () => ops.remove(path) });
    }
    this.menu(x, y, items);
  }

  /** Render a tree. `rootLabel` names the opened folder (shown as the top row). */
  render(tree: TreeNode, rootLabel: string): void {
    this.host.innerHTML = "";
    if (tree.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = t("tree.empty");
      this.host.appendChild(empty);
      return;
    }
    // The root is always expanded and shown as a labelled header row.
    this.expanded.add("");
    const rootRow = this.rowEl(rootLabel, "", true, 0, true);
    this.host.appendChild(rootRow);
    this.renderChildren(tree, 1);
  }

  private renderChildren(node: TreeNode, depth: number): void {
    for (const child of node.children) {
      const row = this.rowEl(child.name, child.path, child.dir, depth, false);
      this.host.appendChild(row);
      if (child.dir && this.expanded.has(child.path)) {
        this.renderChildren(child, depth + 1);
      }
    }
  }

  private rowEl(name: string, path: string, dir: boolean, depth: number, isRoot: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "row" + (path === this.selected ? " sel" : "");
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.dataset.path = path;

    const open = this.expanded.has(path);
    const tw = document.createElement("span");
    tw.className = "tw" + (dir && open ? " open" : "");
    tw.innerHTML = dir ? svg("chev") : "";
    row.appendChild(tw);

    const ic = document.createElement("span");
    ic.className = "ic" + (dir ? " dir" : "");
    ic.innerHTML = dir ? svg(open ? "folderOpen" : "folder", "fill") : fileIcon(name);
    row.appendChild(ic);

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = name;
    row.appendChild(nm);

    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.menuFor(path, dir, isRoot, e.clientX, e.clientY);
    };
    row.onclick = () => {
      if (dir) {
        if (isRoot) return; // root stays open
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.rerender();
      } else {
        this.selected = path;
        this.onOpen(path);
        this.markSelected();
      }
    };
    return row;
  }

  private rerenderCb: (() => void) | null = null;
  /** Wire a re-render callback (the host owns the tree data). */
  onRerender(cb: () => void): void {
    this.rerenderCb = cb;
  }
  private rerender(): void {
    this.rerenderCb?.();
  }

  private markSelected(): void {
    this.host.querySelectorAll(".row").forEach((r) => {
      const el = r as HTMLElement;
      el.classList.toggle("sel", el.dataset.path === this.selected);
    });
  }
}
