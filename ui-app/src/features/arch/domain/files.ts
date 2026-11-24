/* ═════════ feature `arch` — ficheiros do Studio (exportar e abrir) ═════════
   O formato do ficheiro do desenho (`.arch.json`: o modelo E a geometria), o nome por
   omissão de uma exportação, a validação de um caminho relativo dentro do projecto e a
   extracção dos blocos Mermaid `graph`/`flowchart` de um Markdown (ex.: o ARCHITECTURE.md
   do Delonix). PURO: sem DOM, sem window. */

import { parseDesign, slug } from "./design";
import type { Design } from "./types";

export type ExportFormat = "svg" | "png" | "mermaid" | "json";

export const EXPORT_EXT: Record<ExportFormat, string> = { svg: "svg", png: "png", mermaid: "mmd", json: "arch.json" };
export const EXPORT_MIME: Record<ExportFormat, string> = {
  svg: "image/svg+xml", png: "image/png", mermaid: "text/plain", json: "application/json",
};
/** A pasta, dentro do projecto, onde as exportações vão por omissão. */
export const EXPORT_DIR = "docs/architecture";

/** O nome por omissão: os títulos dos painéis («docker-vs-kubernetes»), ou «architecture». */
export function defaultExportName(d: Design): string {
  const titles = d.views.map((v) => slug(v.title).replace(/-+/g, "-").replace(/^-|-$/g, "")).filter(Boolean);
  return titles.length ? titles.join("-vs-") : "architecture";
}

/** Um caminho relativo que fica dentro do projecto (sem `..`, sem raiz, sem `\`). */
export function isSafeRel(rel: string): boolean {
  if (!rel.trim() || rel.startsWith("/") || rel.includes("\\") || /^[a-zA-Z]:/.test(rel)) return false;
  return rel.split("/").every((p) => p !== ".." && p !== "");
}

const FILE_TAG = "dxtutorArch";

/** O ficheiro do desenho: o desenho do cliente (modelo + posições), legível e estável. */
export function designFile(d: Design): string {
  return JSON.stringify({ [FILE_TAG]: 1, design: d }, null, 2) + "\n";
}

/** Lê um ficheiro de desenho. Aceita o formato do Studio (`{dxtutorArch, design}`) e um
 *  desenho solto (`{components, connections, …}`). `null` se não for nada disso. */
export function readDesignFile(text: string): Design | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const body = r[FILE_TAG] !== undefined ? r.design : raw;
  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).components)) return null;
  return parseDesign(body);
}

/** Um bloco Mermaid de um Markdown que se pode importar. */
export interface MermaidBlock {
  /** Para mostrar: «#2 · graph TB · HOST, CLI, CRIBIN…». */
  label: string;
  source: string;
}

/** Os blocos ```mermaid de um Markdown que são `graph`/`flowchart` (os `sequenceDiagram`
 *  não se importam). Um texto sem blocos é tratado como uma fonte Mermaid única. */
export function mermaidBlocks(text: string): MermaidBlock[] {
  const fences = [...text.matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const sources = fences.length ? fences : [text];
  const out: MermaidBlock[] = [];
  sources.forEach((src, i) => {
    const lines = src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
    const head = lines[0] ?? "";
    if (!/^(graph|flowchart)\b/.test(head)) return;
    const ids = lines.slice(1).map((l) => /^(?:subgraph\s+)?([A-Za-z0-9_]+)/.exec(l)?.[1]).filter((x): x is string => !!x && x !== "end");
    const names = [...new Set(ids)].slice(0, 3).join(", ");
    out.push({ label: `#${i + 1} · ${head}${names ? ` · ${names}…` : ""}`, source: src });
  });
  return out;
}
