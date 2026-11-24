/* ═══════════ feature `ext` — JSON com comentários (JSONC) ═══════════
   Os ficheiros de uma extensão VS Code (temas, snippets, language-configuration) são
   muitas vezes JSONC: comentários de linha e de bloco e vírgulas finais. O `JSON.parse`
   recusa-os, por isso tiramo-los primeiro, sem tocar no conteúdo das strings. PURO. */

/** Remove comentários e vírgulas finais (fora de strings) e faz `JSON.parse`. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '"') {
      // Copia a string inteira, respeitando escapes.
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Vírgulas finais antes de } ou ] (já sem comentários nem strings no caminho).
  return JSON.parse(removeTrailingCommas(out));
}

function removeTrailingCommas(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "}" || s[j] === "]") {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}
