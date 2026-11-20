/* ═══════════ feature `visualizer` — lexer (ADR-0002, Fase 2) ═══════════
   PURO: fonte → tokens do subconjunto de Rust. `vzErr` é a fábrica de erro com a
   linha anexada (`vline`), partilhada pelo parser e pelo interpretador. */

import type { Token } from "./types";

/** Erro do visualizador: um `Error` com a linha de origem (`vline`) e o marcador
 *  `vz` que o distingue de um erro interno. */
export interface VzError extends Error { vline?: number; vz?: number }

export function vzErr(m: string, line: number): VzError {
  const e = new Error(m) as VzError;
  e.vline = line;
  e.vz = 1;
  return e;
}

export function vzLex(src: string): Token[] {
  const T: Token[] = [];
  let i = 0, line = 1;
  const n = src.length, OPS = ["..=", "->", "=>", "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "::", ".."];
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9_]/.test(src[j])) j++; let f = false; if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) { f = true; j++; while (j < n && /[0-9_]/.test(src[j])) j++; } const num = Number(src.slice(i, j).replace(/_/g, "")); const m = src.slice(j).match(/^(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize|f32|f64)/); if (m) j += m[1].length; T.push({ k: "num", v: num, suf: m ? m[1] : null, f: f || (m && m[1][0] === "f"), line }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++; T.push({ k: "id", v: src.slice(i, j), line }); i = j; continue; }
    if (c === '"') { let j = i + 1, s = ""; while (j < n && src[j] !== '"') { if (src[j] === "\\") { const e = src[j + 1]; s += e === "n" ? "\n" : e === "t" ? "\t" : e; j += 2; } else { if (src[j] === "\n") line++; s += src[j++]; } } T.push({ k: "str", v: s, line }); i = j + 1; continue; }
    if (c === "'") { if (src[i + 2] === "'") { T.push({ k: "char", v: src[i + 1], line }); i += 3; continue; } if (src[i + 1] === "\\" && src[i + 3] === "'") { const e = src[i + 2]; T.push({ k: "char", v: e === "n" ? "\n" : e === "t" ? "\t" : e, line }); i += 4; continue; } let j = i + 1; while (/[A-Za-z_]/.test(src[j] || "")) j++; i = j; continue; }
    const op = OPS.find(o => src.startsWith(o, i)); if (op) { T.push({ k: "op", v: op, line }); i += op.length; continue; } T.push({ k: "op", v: c, line }); i++;
  }
  T.push({ k: "eof", line });
  return T;
}
