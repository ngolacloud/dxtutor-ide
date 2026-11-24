/* ═════════ feature `lsp` — os símbolos da pasta (workspace/symbol) ═════════
   O backend pergunta a cada servidor que está a correr na pasta e devolve `[{ language, result }]`;
   cada `result` é uma lista de `SymbolInformation` (com `location.range`) ou de `WorkspaceSymbol`
   (o kotlin-language-server manda só `location.uri`, sem linha — a posição procura-se depois
   no ficheiro). Aqui vira uma lista única, sem repetidos, ordenada para a consulta. PURO. */

import { uriToPath } from "./results";
import { kindLabel } from "./symbols";

export interface WorkspaceSymbolHit {
  name: string;
  /** `SymbolKind` do LSP. */
  kind: number;
  label: string;
  /** A classe/módulo que o contém (`""` se nenhum; o kotlin-language-server manda `"null"`). */
  container: string;
  language: string;
  /** Caminho absoluto do ficheiro. */
  path: string;
  /** 1-based; `null` quando o servidor não mandou a posição. */
  line: number | null;
  character: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function hitOf(s: unknown, language: string): WorkspaceSymbolHit | null {
  if (!isObj(s) || typeof s.name !== "string" || !isObj(s.location) || typeof s.location.uri !== "string") return null;
  const path = uriToPath(s.location.uri);
  if (!path) return null;
  const range = s.location.range;
  const start = isObj(range) && isObj(range.start) ? range.start : null;
  const line = start && Number.isFinite(Number(start.line)) ? Number(start.line) + 1 : null;
  const character = start && Number.isFinite(Number(start.character)) ? Number(start.character) : null;
  const kind = Number(s.kind) || 0;
  const c = typeof s.containerName === "string" && s.containerName !== "null" ? s.containerName : "";
  return { name: s.name, kind, label: kindLabel(kind), container: c, language, path, line, character: line === null ? null : character };
}

/** As respostas do backend (`[{ language, result }]`) numa lista só, sem repetidos. */
export function workspaceSymbolHits(responses: unknown): WorkspaceSymbolHit[] {
  if (!Array.isArray(responses)) return [];
  const out: WorkspaceSymbolHit[] = [];
  const seen = new Set<string>();
  for (const r of responses) {
    if (!isObj(r) || !Array.isArray(r.result)) continue;
    const language = typeof r.language === "string" ? r.language : "";
    for (const s of r.result) {
      const h = hitOf(s, language);
      if (!h) continue;
      const id = `${h.path}\u0000${h.line}\u0000${h.kind}\u0000${h.name}\u0000${h.container}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(h);
    }
  }
  return out;
}

/** Ordena para a consulta: os que começam por ela com as mesmas maiúsculas, os que começam
 *  por ela, os que a contêm, e o resto (o servidor também faz correspondências aproximadas);
 *  dentro de cada grupo, a ordem do servidor. No máximo `limit`. */
export function rankWorkspaceSymbols(hits: readonly WorkspaceSymbolHit[], query: string, limit = 200): WorkspaceSymbolHit[] {
  const raw = query.trim(), q = raw.toLowerCase();
  const tier = (n: string): number => (!q ? 0 : n.startsWith(raw) ? 0 : n.toLowerCase().startsWith(q) ? 1 : n.toLowerCase().includes(q) ? 2 : 3);
  return hits
    .map((h, i) => ({ h, i, t: tier(h.name) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h);
}

/** No ficheiro já aberto, a posição de um símbolo que veio sem ela: o primeiro símbolo do
 *  ficheiro com o mesmo nome e tipo (e o mesmo contentor, se o houver); senão, o mesmo nome. */
export function locateInFile<T extends { name: string; kind: number; container: string; line: number; character: number }>(
  hit: Pick<WorkspaceSymbolHit, "name" | "kind" | "container">,
  fileSymbols: readonly T[],
): T | null {
  const same = fileSymbols.filter((s) => s.name === hit.name);
  return (
    same.find((s) => s.kind === hit.kind && (!hit.container || s.container === hit.container)) ??
    same.find((s) => s.kind === hit.kind) ??
    same[0] ??
    null
  );
}
