// Workspace state + the pure logic behind it (tree building, autosave diffing). The pure
// functions are exported so they can be unit-tested without a backend or a DOM.

import { api, type FileEntry, type Loaded } from "./tauri";

export interface TreeNode {
  name: string;
  path: string; // relative to root, "" for the root
  dir: boolean;
  children: TreeNode[];
}

/** Build a nested tree from a flat list of relative file paths. Pure. */
export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part && c.dir === !isLeaf);
      if (!child) {
        child = { name: part, path, dir: !isLeaf, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  sortTree(root);
  return root;
}

/** Directories first, then files, each alphabetical. Pure (mutates in place). */
export function sortTree(node: TreeNode): void {
  node.children.sort((a, b) =>
    a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name),
  );
  node.children.forEach(sortTree);
}

/** The files whose buffer differs from what's on disk — the autosave work list. Pure. */
export function dirtyFiles(
  buffers: Map<string, string>,
  disk: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const [rel, content] of buffers) {
    if (disk.get(rel) !== content) out.push(rel);
  }
  return out;
}

/** Live workspace: the opened folder, its files, and their in-memory buffers. */
export class Workspace {
  root = "";
  name = "";
  readonly disk = new Map<string, string>(); // last-known on-disk content
  readonly buffers = new Map<string, string>(); // current editor content
  skipped = 0;
  truncated = false;

  get open(): boolean {
    return this.root !== "";
  }

  /** Recently opened folder roots, most-recent first (persisted in localStorage). */
  static recent(): string[] {
    try {
      return JSON.parse(localStorage.getItem("dxnext-recent") ?? "[]") as string[];
    } catch {
      return [];
    }
  }

  async openFolder(path: string): Promise<Loaded> {
    const loaded = await api.loadWorkspace(path);
    this.root = loaded.root;
    this.name = loaded.name;
    try {
      const rec = [loaded.root, ...Workspace.recent().filter((r) => r !== loaded.root)].slice(0, 6);
      localStorage.setItem("dxnext-recent", JSON.stringify(rec));
    } catch { /* ignore storage errors */ }
    this.disk.clear();
    this.buffers.clear();
    for (const f of loaded.files) {
      this.disk.set(f.path, f.content);
      this.buffers.set(f.path, f.content);
    }
    this.skipped = loaded.skipped;
    this.truncated = loaded.truncated;
    return loaded;
  }

  tree(): TreeNode {
    return buildTree([...this.buffers.keys()].map((path) => ({ path, content: "" })));
  }

  setBuffer(rel: string, content: string): void {
    this.buffers.set(rel, content);
  }

  /** Persist every dirty buffer to disk via the real backend. Returns the paths written. */
  async flush(): Promise<string[]> {
    const dirty = dirtyFiles(this.buffers, this.disk);
    for (const rel of dirty) {
      const content = this.buffers.get(rel) ?? "";
      await api.writeFile(this.root, rel, content);
      this.disk.set(rel, content);
    }
    return dirty;
  }
}
