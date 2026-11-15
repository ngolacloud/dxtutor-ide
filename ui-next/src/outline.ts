// Outline / CodeMap: the real symbols of the active file via file_outline (tree-sitter on the
// backend). Clicking a symbol jumps to its line. No simulation — an empty list means the file
// genuinely has no top-level symbols for its language.

import { api, type SymbolRange } from "./tauri";
import { t } from "./i18n";

const LANG: Record<string, string> = {
  rs: "rust", ts: "typescript", js: "javascript", py: "python", go: "go",
  c: "c", h: "c", cpp: "cpp", java: "java",
};

export function langOf(rel: string): string {
  return LANG[rel.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

export class Outline {
  private timer: number | null = null;

  constructor(
    private host: HTMLElement,
    private onJump: (line: number) => void,
  ) {
    this.render([], false);
  }

  /** Recompute the outline for a file (debounced). `rel` drives the language. */
  update(rel: string | null, content: string): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (!rel) { this.render([], false); return; }
    const lang = langOf(rel);
    if (!lang) { this.render([], true); return; }
    this.timer = setTimeout(() => {
      void api
        .fileOutline(content, lang)
        .then((syms) => this.render(syms, true))
        .catch(() => this.render([], true));
    }, 250) as unknown as number;
  }

  /** Synchronous fetch for the harness. */
  async fetch(rel: string, content: string): Promise<SymbolRange[]> {
    const lang = langOf(rel);
    if (!lang) return [];
    const syms = await api.fileOutline(content, lang).catch(() => []);
    this.render(syms, true);
    return syms;
  }

  private render(syms: SymbolRange[], fileOpen: boolean): void {
    if (!fileOpen) {
      this.host.innerHTML = `<div class="ol-empty">${t("outline.openFile")}</div>`;
      return;
    }
    if (syms.length === 0) {
      this.host.innerHTML = `<div class="ol-empty">${t("outline.noSymbols")}</div>`;
      return;
    }
    this.host.innerHTML = "";
    for (const s of syms) {
      const row = document.createElement("div");
      row.className = "ol-row";
      row.innerHTML = `<span class="ol-kind"></span><span class="ol-name"></span>`;
      (row.querySelector(".ol-kind") as HTMLElement).textContent = kindShort(s.kind);
      (row.querySelector(".ol-name") as HTMLElement).textContent = s.name;
      row.onclick = () => this.onJump(s.startLine);
      this.host.appendChild(row);
    }
  }
}

function kindShort(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("fn") || k.includes("func") || k.includes("method")) return "ƒ";
  if (k.includes("struct") || k.includes("class")) return "□";
  if (k.includes("enum")) return "∈";
  if (k.includes("trait") || k.includes("interface")) return "◇";
  if (k.includes("impl")) return "∴";
  return "•";
}
