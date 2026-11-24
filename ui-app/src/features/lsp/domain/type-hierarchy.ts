/* ═════════ feature `lsp` — a hierarquia de tipos (typeHierarchy) ═════════
   `prepareTypeHierarchy` dá o tipo no cursor; `typeHierarchy/supertypes|subtypes` dá os de cima
   ou de baixo de um item. Cada `TypeHierarchyItem` tem de voltar ao servidor TAL COMO VEIO (o jdtls
   põe lá um `data` dele), por isso guarda-se o original em `raw`. Os tipos fora da pasta (ex. as
   classes do JDK, `jdt://…`) não têm caminho: mostram-se, mas não se abrem. PURO. */

import { uriToPath } from "./results";
import { kindLabel } from "./symbols";

export type TypeDirection = "supertypes" | "subtypes";

export interface TypeNode {
  name: string;
  kind: number;
  label: string;
  /** Ex. o pacote (o jdtls põe-no em `detail`; às vezes vazio). */
  detail: string;
  /** Caminho absoluto; `null` se o tipo não está num ficheiro (ex. `jdt://` do JDK). */
  path: string | null;
  /** 1-based (o nome do tipo, `selectionRange`). */
  line: number;
  character: number;
  /** O item original, para pedir os de cima/de baixo dele. */
  raw: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function startOf(range: unknown): { line: number; character: number } | null {
  if (!isObj(range) || !isObj(range.start)) return null;
  const line = Number(range.start.line), character = Number(range.start.character);
  return Number.isFinite(line) && Number.isFinite(character) ? { line, character } : null;
}

/** Os `TypeHierarchyItem` de uma resposta (`[]` se vazia ou estranha). */
export function typeNodes(result: unknown): TypeNode[] {
  if (!Array.isArray(result)) return [];
  const out: TypeNode[] = [];
  for (const it of result) {
    if (!isObj(it) || typeof it.name !== "string" || typeof it.uri !== "string") continue;
    const at = startOf(it.selectionRange) ?? startOf(it.range);
    if (!at) continue;
    const kind = Number(it.kind) || 0;
    out.push({
      name: it.name,
      kind,
      label: kindLabel(kind),
      detail: typeof it.detail === "string" ? it.detail.trim() : "",
      path: uriToPath(it.uri),
      line: at.line + 1,
      character: at.character,
      raw: it,
    });
  }
  return out;
}

/** A resposta do `lsp_prepare_type_hierarchy`: `{ supported, items }`, ou `null` (sem servidor). */
export function preparedTypes(res: unknown): { supported: boolean; items: TypeNode[] } | null {
  if (!isObj(res)) return null;
  return { supported: res.supported !== false, items: typeNodes(res.items) };
}
