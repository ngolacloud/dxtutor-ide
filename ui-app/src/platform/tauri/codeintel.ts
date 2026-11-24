/* ═════════ cliente IPC: inteligência de código (outline) — ADR-0006, R2c ═════════
   Contrato de `file_outline` (src-tauri/src/commands/codeintel.rs): os símbolos de um ficheiro
   — pelo servidor de língua quando há (`root` + `file` absoluto), senão `syn` (Rust) ou o
   scanner sintáctico (Go/Python/JS/TS). */
import { invoke, type Invoker } from "./core";

/** `codemap::SymbolKind` (lowercase). */
export type SymbolKind = "function" | "method" | "struct" | "enum" | "trait" | "other";

/** `codemap::SymbolRange` (camelCase): linhas 1-based, inclusivas. */
export interface SymbolRange {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
}

export const codeintelClient = (inv: Invoker = invoke) => ({
  outline: (code: string, lang: string, root?: string | null, file?: string | null): Promise<SymbolRange[]> =>
    inv<SymbolRange[]>("file_outline", { code, lang, root: root ?? null, file: file ?? null }),
});

export type CodeintelClient = ReturnType<typeof codeintelClient>;
