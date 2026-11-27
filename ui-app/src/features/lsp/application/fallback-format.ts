/* ═════════ feature `lsp` — o que o «Format Document» sem servidor fez, numa frase (LSP P5) ═════════
   O formatador seguro (`domain/safe-format.ts`) devolve um relatório; aqui ele vira o aviso que o
   humano vê: o que mudou («tirados os espaços no fim de 3 linhas; 2 linhas re-indentadas com tabs,
   como o resto do ficheiro»), o que ficou de propósito e porquê, ou que já estava formatado. PURO
   (recebe o catálogo por argumento). */

import { safeFormat, type SafeFormatResult } from "../domain/safe-format";
import { languageFor } from "../domain/registry";
import type { FallbackCopy } from "./fallback-messages";

/** A frase do aviso para um relatório do formatador seguro. */
export function describeSafeFormat(r: SafeFormatResult, languageName: string, copy: FallbackCopy): string {
  if (r.untouched) return copy("fmtPatch");
  const parts: string[] = [];
  if (r.trimmed) parts.push(r.trimmed === 1 ? copy("fmtTrimmedOne") : copy("fmtTrimmed", { n: r.trimmed }));
  if (r.reindented && r.indent) {
    const n = r.reindented;
    parts.push(
      r.indent.kind === "tabs"
        ? n === 1 ? copy("fmtTabsOne") : copy("fmtTabs", { n })
        : n === 1 ? copy("fmtSpacesOne", { size: r.indent.size }) : copy("fmtSpaces", { n, size: r.indent.size }),
    );
  }
  if (r.finalNewline === "added") parts.push(copy("fmtAdded"));
  if (r.finalNewline === "trimmed") parts.push(copy("fmtTrimmedEnd"));
  if (r.keptTrailing) parts.push(copy("fmtKeptTrailing", { n: r.keptTrailing }));
  if (r.keptIndent) parts.push(copy("fmtKeptIndent", { n: r.keptIndent, lang: languageName }));
  // sem mudanças, as partes que sobram são só o que ficou de propósito
  if (!r.changed) return parts.length ? copy("fmtNoneKept", { what: parts.join("; ") }) : copy("fmtNone");
  return copy("fmtDone", { what: parts.join("; ") });
}

/** Formata o texto de um ficheiro sem servidor: o texto novo (ou o mesmo) e a frase para o aviso. */
export function formatWithoutServer(path: string, text: string, copy: FallbackCopy, tabSize = 4): { text: string; changed: boolean; message: string } {
  const lang = languageFor(path, text);
  const r = safeFormat(text, { language: lang?.id ?? null, path, tabSize });
  return { text: r.text, changed: r.changed, message: describeSafeFormat(r, lang?.name ?? "", copy) };
}
