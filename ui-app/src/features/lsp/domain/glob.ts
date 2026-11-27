/* ═════════ feature `lsp` — os padrões de nome de ficheiro de uma extensão VS Code (LSP P4) ═════════
   O `filenamePatterns` de uma linguagem que um VSIX contribui é um glob do VS Code. As MESMAS regras
   do backend (`tutor_eval::langcontrib::glob_regex`, com os mesmos casos nos testes): `**` seguido de `/`
   qualquer pasta (ou nenhuma), `**` qualquer coisa, `*` qualquer coisa menos `/`, `?` um carácter menos `/`,
   `{a,b}` alternativas (os espaços à volta não contam: `{txt, in}`), `[…]`/`[!…]` uma classe; sem
   distinguir maiúsculas. Um padrão com `/` casa com o caminho inteiro, senão com o nome. PURO. */

const cache = new Map<string, RegExp | null>();

/** O glob como RegExp ancorada (sem maiúsculas); `null` se não compila (chaveta por fechar…). */
export function globRegex(pattern: string): RegExp | null {
  if (cache.has(pattern)) return cache.get(pattern)!;
  const p = [...pattern.replace(/\\/g, "/")];
  let out = "^";
  let braces = 0;
  let ok = true;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        if (p[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") {
      braces++;
      out += "(?:";
      while (p[i + 1] === " ") i++;
    } else if (c === "}" && braces > 0) {
      braces--;
      out = out.replace(/ +$/, "") + ")";
    } else if (c === "," && braces > 0) {
      out = out.replace(/ +$/, "") + "|";
      while (p[i + 1] === " ") i++;
    } else if (c === "[") {
      const close = p.indexOf("]", i + 1);
      if (close > i + 1) {
        let body = p.slice(i + 1, close).join("");
        const neg = body[0] === "!" || body[0] === "^";
        if (neg) body = body.slice(1);
        out += `[${neg ? "^" : ""}${body.replace(/\\/g, "\\\\").replace(/\[/g, "\\[")}]`;
        i = close;
      } else out += "\\[";
    } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  if (braces > 0) ok = false;
  let re: RegExp | null = null;
  if (ok) {
    try {
      re = new RegExp(out + "$", "i");
    } catch {
      re = null;
    }
  }
  cache.set(pattern, re);
  return re;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** O padrão casa com o ficheiro em `path` (o caminho inteiro se o padrão tem `/`, senão o nome)? */
export function patternMatches(pattern: string, path: string): boolean {
  const p = path.replace(/\\/g, "/");
  const subject = /[/\\]/.test(pattern) ? p : fileName(p);
  return globRegex(pattern)?.test(subject) ?? false;
}
