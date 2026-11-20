/* ═══════════ feature `board` — domínio: slug (ADR-0002, Fase 2) ═══════════
   Normalização de um texto para um identificador seguro (ramo gitflow, nome de
   ficheiro, nome de teste). PURO: sem DOM, sem `window`, sem Tauri.

   Cópia idêntica do `slug` léxico de app.ts (NÃO publicado) — studio.ts tem a sua
   própria cópia local; o motor do board (runIssue/genBacklogIssues) usa esta. */

export const slug = (s: string): string =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
