/* ═════════ feature `panel` — links no terminal (domínio puro) ═════════
   Como no VS Code, `src/lib.rs:10:8`, `src/a.ts(12,5)` ou `https://…` na saída do
   terminal são clicáveis. Aqui só se detecta e resolve; a UI regista o link provider
   do xterm e confirma que o ficheiro existe no workspace antes de sublinhar. */

export interface DetectedLink {
  /** Índice (0-based) do primeiro carácter e do primeiro a seguir ao link. */
  start: number;
  end: number;
  kind: "file" | "url";
  text: string;
  path?: string;
  line?: number;
  col?: number;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]}]/g;
// caminho com extensão, opcionalmente seguido de :linha[:coluna] ou (linha,coluna)
const FILE_RE = /(?:[A-Za-z]:)?(?:~|\.{1,2})?(?:[\\/]?[\w@.+-]+)*[\\/]?[\w@+-]+\.[A-Za-z][\w]{0,9}(?::(\d+)(?::(\d+))?|\((\d+),\s*(\d+)\))?/g;

/** Todos os links de uma linha de texto (sem sobreposições; URLs primeiro). */
export function detectLinks(line: string): DetectedLink[] {
  const out: DetectedLink[] = [];
  for (const m of line.matchAll(URL_RE)) {
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "url", text: m[0] });
  }
  const taken = (s: number, e: number) => out.some((l) => s < l.end && e > l.start);
  for (const m of line.matchAll(FILE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (taken(start, end)) continue;
    const path = m[0].replace(/(?::\d+(?::\d+)?|\(\d+,\s*\d+\))$/, "");
    // descarta versões/números soltos ("v1.2", "0.10") e domínios sem caminho
    if (!/[\\/]/.test(path) && !/^[\w@+-]+\.(rs|ts|tsx|js|jsx|mjs|cjs|go|py|java|kt|swift|cs|cpp|cc|c|h|hpp|sql|toml|json|yaml|yml|md|css|html|sh|lock|txt|vue|svelte)$/.test(path)) continue;
    const ln = m[1] ?? m[3];
    const col = m[2] ?? m[4];
    out.push({
      start,
      end,
      kind: "file",
      text: m[0],
      path,
      line: ln ? parseInt(ln, 10) : undefined,
      col: col ? parseInt(col, 10) : undefined,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Normaliza `a/./b/../c` sem tocar no disco. */
function normalize(p: string): string {
  const abs = p.startsWith("/");
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return (abs ? "/" : "") + parts.join("/");
}

/** Caminho de um link → candidatos relativos à raiz do workspace, por ordem de
 *  preferência (relativo ao cwd do terminal, depois à raiz). Vazio fora do workspace. */
export function linkCandidates(path: string, cwd: string | null, root: string, home: string | null): string[] {
  const r = root.replace(/\/+$/, "");
  let p = path.replace(/\\/g, "/");
  if (p.startsWith("~/") && home) p = home.replace(/\/+$/, "") + p.slice(1);
  const rel = (abs: string): string | null => {
    const n = normalize(abs);
    return n.startsWith(r + "/") ? n.slice(r.length + 1) : null;
  };
  if (p.startsWith("/")) {
    const x = rel(p);
    return x ? [x] : [];
  }
  const out: string[] = [];
  if (cwd) {
    const x = rel(cwd.replace(/\/+$/, "") + "/" + p);
    if (x) out.push(x);
  }
  const y = rel(r + "/" + p);
  if (y && !out.includes(y)) out.push(y);
  return out;
}
