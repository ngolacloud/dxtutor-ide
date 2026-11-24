/* ═════════ feature `panel` — Problems (domínio puro) ═════════
   Agrupar, filtrar e contar diagnósticos, e juntar as duas fontes: os checkers do
   projecto (scan) e os diagnósticos ao vivo de um language server. */

import type { Problem, Severity } from "./types";

export interface ProblemGroup {
  file: string;
  items: Problem[];
  errors: number;
  warnings: number;
}

export interface ProblemFilter {
  text: string;
  errors: boolean;
  warnings: boolean;
  infos: boolean;
}

export const ALL: ProblemFilter = { text: "", errors: true, warnings: true, infos: true };

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function counts(ps: readonly Problem[]): { errors: number; warnings: number; infos: number } {
  let errors = 0, warnings = 0, infos = 0;
  for (const p of ps) {
    if (p.severity === "error") errors++;
    else if (p.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}

/** Filtro do VS Code: texto (mensagem, ficheiro, código, fonte; `!termo` exclui) + severidades. */
export function filterProblems(ps: readonly Problem[], f: ProblemFilter): Problem[] {
  const terms = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return ps.filter((p) => {
    if (p.severity === "error" && !f.errors) return false;
    if (p.severity === "warning" && !f.warnings) return false;
    if (p.severity === "info" && !f.infos) return false;
    if (!terms.length) return true;
    const hay = `${p.message} ${p.file} ${p.code ?? ""} ${p.source}`.toLowerCase();
    return terms.every((t) => (t.startsWith("!") ? !hay.includes(t.slice(1)) : hay.includes(t)));
  });
}

/** Agrupa por ficheiro; ficheiros com erros primeiro, depois por nome; dentro, por
 *  severidade e linha. */
export function groupByFile(ps: readonly Problem[]): ProblemGroup[] {
  const by = new Map<string, Problem[]>();
  for (const p of ps) {
    const l = by.get(p.file);
    if (l) l.push(p);
    else by.set(p.file, [p]);
  }
  return [...by.entries()]
    .map(([file, items]) => {
      const c = counts(items);
      items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.line - b.line || a.col - b.col);
      return { file, items, errors: c.errors, warnings: c.warnings };
    })
    .sort((a, b) => (b.errors > 0 ? 1 : 0) - (a.errors > 0 ? 1 : 0) || a.file.localeCompare(b.file));
}

/** Junta scan + LSP: para um ficheiro com diagnósticos LSP, o LSP (ao vivo) substitui os
 *  da mesma fonte; o resto do scan mantém-se. */
export function mergeLive(scan: readonly Problem[], live: ReadonlyMap<string, readonly Problem[]>): Problem[] {
  if (!live.size) return [...scan];
  const out = scan.filter((p) => {
    const l = live.get(p.file);
    return !l || !l.some((x) => x.source === p.source);
  });
  for (const l of live.values()) out.push(...l);
  return out;
}

/** Diagnóstico LSP (`textDocument/publishDiagnostics`) → Problem relativo à raiz. */
export function fromLsp(uri: string, d: { range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }; severity?: number; message?: string; code?: unknown; source?: string }, root: string): Problem | null {
  let path: string;
  try {
    path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
  } catch {
    return null;
  }
  const r = root.replace(/\/+$/, "") + "/";
  if (!path.startsWith(r)) return null;
  const s = d.range?.start ?? {}, e = d.range?.end ?? {};
  const sev: Severity = d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
  return {
    file: path.slice(r.length),
    line: (s.line ?? 0) + 1,
    col: (s.character ?? 0) + 1,
    endLine: (e.line ?? s.line ?? 0) + 1,
    endCol: (e.character ?? s.character ?? 0) + 1,
    severity: sev,
    message: d.message ?? "",
    code: d.code == null ? null : String(typeof d.code === "object" ? (d.code as { value?: unknown }).value ?? "" : d.code),
    source: d.source ?? "lsp",
  };
}

/** One broken rule of the architect, as `arch_conformance` reports it (RF-A05). */
export interface RuleViolation {
  rule: string;
  message: string;
  path: string;
  line: number | null;
}

/** The drift of the architect's rules as Problems (RF-A05, docs/v2/RF-DELONIX-PLANO.md F5.6): by
 *  file, next to the compilers' and linters', refreshed on every scan (so a new violation shows
 *  up in the same session). `null` (no rules file) gives none. */
export function fromRuleViolations(vs: readonly RuleViolation[] | null | undefined): Problem[] {
  return (vs ?? []).map((v) => ({
    file: v.path,
    line: v.line ?? 1,
    col: 1,
    endLine: v.line ?? 1,
    endCol: 1,
    severity: "error" as Severity,
    message: v.message,
    code: v.rule,
    source: "arquitectura",
  }));
}
