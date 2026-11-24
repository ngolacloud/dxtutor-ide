/* ═════════ feature `lsp` — os símbolos do ficheiro (documentSymbol) ═════════
   A resposta é uma árvore de `DocumentSymbol` (com `children` e `selectionRange`) ou uma lista
   plana de `SymbolInformation` (com `location` e `containerName`). Aqui vira uma lista plana,
   pela ordem do ficheiro, com a profundidade para indentar, e um filtro para o Go to Symbol. PURO. */

export interface SymbolEntry {
  name: string;
  /** `SymbolKind` do LSP (1–26). */
  kind: number;
  /** Etiqueta curta do tipo (`class`, `method`, `fn`…). */
  label: string;
  /** Ex. `: int` (jdtls) — o que o servidor põe em `detail`. */
  detail: string;
  /** A classe/função que o contém (`""` no topo). */
  container: string;
  depth: number;
  /** 1-based (como o editor). */
  line: number;
  character: number;
}

const LABELS: Readonly<Record<number, string>> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property",
  8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "fn", 13: "var", 14: "const",
  15: "string", 16: "number", 17: "bool", 18: "array", 19: "object", 20: "key", 21: "null",
  22: "member", 23: "struct", 24: "event", 25: "operator", 26: "type",
};

/** Etiqueta curta de um `SymbolKind`. */
export function kindLabel(kind: number): string {
  return LABELS[kind] ?? "sym";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function startOf(range: unknown): { line: number; character: number } | null {
  if (!isObj(range) || !isObj(range.start)) return null;
  const line = Number(range.start.line), character = Number(range.start.character);
  return Number.isFinite(line) && Number.isFinite(character) ? { line, character } : null;
}

/** A resposta de `documentSymbol` em lista plana, pela ordem do ficheiro (`[]` se vazia). */
export function flattenSymbols(result: unknown): SymbolEntry[] {
  if (!Array.isArray(result)) return [];
  const out: SymbolEntry[] = [];
  const walk = (items: unknown[], depth: number, container: string): void => {
    for (const s of items) {
      if (!isObj(s) || typeof s.name !== "string") continue;
      const kind = Number(s.kind) || 0;
      // DocumentSymbol: selectionRange (o nome) ou range; SymbolInformation: location.range
      const at = startOf(s.selectionRange) ?? startOf(s.range) ?? (isObj(s.location) ? startOf(s.location.range) : null);
      if (!at) continue;
      out.push({
        name: s.name,
        kind,
        label: kindLabel(kind),
        detail: typeof s.detail === "string" ? s.detail.trim() : "",
        container: typeof s.containerName === "string" ? s.containerName : container,
        depth,
        line: at.line + 1,
        character: at.character,
      });
      if (Array.isArray(s.children)) walk(s.children, depth + 1, s.name);
    }
  };
  walk(result, 0, "");
  // SymbolInformation não vem por ordem garantida
  return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.line - b.e.line || a.e.character - b.e.character || a.i - b.i).map((x) => x.e);
}

/** Os símbolos que servem para `query` (sem distinguir maiúsculas), por esta ordem: os que
 *  começam por ela com as mesmas maiúsculas (`mai` → `main` antes de `Main`), os que começam
 *  por ela, e os que a contêm; cada grupo pela ordem do ficheiro. Vazia → todos. */
export function filterSymbols(entries: readonly SymbolEntry[], query: string): SymbolEntry[] {
  const raw = query.trim(), q = raw.toLowerCase();
  if (!q) return [...entries];
  const tier = (name: string): number => (name.startsWith(raw) ? 0 : name.toLowerCase().startsWith(q) ? 1 : name.toLowerCase().includes(q) ? 2 : -1);
  return entries
    .map((e, i) => ({ e, i, t: tier(e.name) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}
