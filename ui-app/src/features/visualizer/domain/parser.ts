/* ═══════════ feature `visualizer` — parser (ADR-0002, Fase 2) ═══════════
   PURO: tokens → AST `{fns}` do subconjunto de Rust. A lógica é VERBATIM do
   monólito; só se acrescentaram anotações de tipo e asserções (`as`) apagáveis em
   compile-time — o runtime é idêntico (o golden/caracterização prova-o byte-a-byte).
   Os nós saem como `VzNode` (campos opcionais discriminados por `k`); o parser
   constrói-os e inspecciona poucos campos (`.k`/`.name`/`.parts`), daí as asserções. */

import type { Ast, FnDef, FnParam, Token, VzNode } from "./types";
import { vzErr, vzLex, type VzError } from "./lexer";

export function vzParse(src: string): Ast {
  const T = vzLex(src);
  let p = 0;
  const pk = (o = 0): Token => T[Math.min(p + o, T.length - 1)], nx = (): Token => T[p++], is = (v: string, o = 0): boolean => { const t = pk(o); return (t.k === "op" || t.k === "id") && t.v === v; };
  const E = (m: string): VzError => vzErr(m, pk().line), eat = (v: string): Token => { if (!is(v)) throw E(`expected \`${v}\`, found \`${pk().k === "eof" ? "end of file" : pk().v}\``); return nx(); }, ident = (): string => { const t = pk(); if (t.k !== "id") throw E(`expected a name, found \`${t.v}\``); p++; return t.v as string; };
  const NOPE: Record<string, string> = { struct: "structs", enum: "enums", impl: "impl blocks", trait: "traits", mod: "modules", match: "match", const: "constants", static: "statics", unsafe: "unsafe code", async: "async code", dyn: "trait objects", where: "where clauses", type: "type aliases", Some: "Option", None: "Option", Ok: "Result", Err: "Result", Box: "Box", Rc: "Rc", HashMap: "HashMap" };
  const nope = (t: { v?: string | number; line: number }): VzError => vzErr(`${NOPE[t.v as string] || "`" + t.v + "`"} ${/s$/.test(NOPE[t.v as string] || "") ? "are" : "is"} not in the browser visualizer's Rust subset yet. The desktop app traces any program with the real compiler.`, t.line);
  function type(): string {
    if (is("&") || is("&&")) { nx(); const m = is("mut") ? (nx(), "mut ") : ""; return "&" + m + type(); }
    if (is("[")) { nx(); const t = type(); if (is(";")) { nx(); const n = nx(); eat("]"); return `[${t}; ${n.v}]`; } eat("]"); return `[${t}]`; }
    if (is("(")) { nx(); eat(")"); return "()"; } if (is("impl") || is("dyn")) throw nope(pk()); let n = ident(); while (is("::")) { nx(); n += "::" + ident(); } if (NOPE[n]) throw nope({ v: n, line: pk().line });
    if (is("<")) { nx(); const a = [type()]; while (is(",")) { nx(); a.push(type()); } eat(">"); n += `<${a.join(", ")}>`; } return n;
  }
  const fns: Record<string, FnDef> = {};
  function items_(): void {
    while (pk().k !== "eof") {
      if (is("#")) { nx(); if (is("!")) nx(); eat("["); let d = 1; while (d && pk().k !== "eof") { const t = nx(); if (t.v === "[") d++; else if (t.v === "]") d--; } continue; }
      if (is("use")) { while (!is(";") && pk().k !== "eof") nx(); nx(); continue; } if (is("pub")) { nx(); continue; }
      if (is("fn")) { const ft = nx(), name = ident(); if (is("<")) throw E("Generic functions are not in the browser subset yet."); eat("("); const params: FnParam[] = []; while (!is(")")) { const mut = is("mut") ? (nx(), true) : false; const pn = ident(); eat(":"); params.push({ name: pn, mut, ty: type() }); if (is(",")) nx(); else break; } eat(")"); let ret: string | null = null; if (is("->")) { nx(); ret = type(); } if (is("where")) throw nope(pk()); const body = block(); fns[name] = { name, params, ret, body, line: ft.line }; continue; }
      throw NOPE[pk().v as string] ? nope(pk()) : E(`unexpected \`${pk().v}\` at the top level`);
    }
  }
  function block(): VzNode { const st = eat("{"), stmts: VzNode[] = []; let tail: VzNode | boolean | null = null; while (!is("}")) { if (pk().k === "eof") throw vzErr("unclosed `{`", st.line); const s = stmt(); if (s.tail) { tail = (s.e as VzNode) ?? null; break; } if (s.k !== "empty") stmts.push(s); } const en = eat("}"); return { k: "block", stmts, tail, line: st.line, end: en.line }; }
  function stmt(): VzNode { const t = pk(); if (is(";")) { nx(); return { k: "empty" }; }
    if (is("let")) { nx(); const mut = is("mut") ? (nx(), true) : false; if (is("(")) throw vzErr("Tuple patterns are not in the browser subset yet.", t.line); const name = ident(); let ty: string | null = null; if (is(":")) { nx(); ty = type(); } let init: VzNode | null = null; if (is("=")) { nx(); init = expr(); } eat(";"); return { k: "let", name, mut, ty, init, line: t.line }; }
    if (is("while")) { nx(); if (is("let")) throw vzErr("`while let` needs Option, not in the subset yet.", t.line); const cond = expr(); return { k: "while", cond, body: block(), line: t.line }; }
    if (is("for")) { nx(); const name = ident(); eat("in"); const it = expr(); return { k: "for", name, it, body: block(), line: t.line }; }
    if (is("loop")) { nx(); return { k: "loop", body: block(), line: t.line }; }
    if (is("return")) { nx(); const e = is(";") || is("}") ? null : expr(); if (is(";")) nx(); return { k: "ret", e, line: t.line }; }
    if (is("break") || is("continue")) { nx(); if (is(";")) nx(); return { k: t.v === "break" ? "brk" : "cont", line: t.line }; }
    if (t.k === "id" && NOPE[t.v as string] && t.v !== "Some") throw nope(t);
    const e = expr(); if (is(";")) { nx(); return { k: "expr", e, line: t.line }; } if (is("}")) return { tail: true, e }; if (e.k === "if" || e.k === "block") return { k: "expr", e, line: t.line }; throw E("expected `;`"); }
  const BP: Record<string, number> = { "=": 1, "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "..": 2, "..=": 2, "||": 3, "&&": 4, "==": 5, "!=": 5, "<": 5, ">": 5, "<=": 5, ">=": 5, "+": 8, "-": 8, "*": 9, "/": 9, "%": 9 };
  function expr(min = 0): VzNode { let l = unary(); for (; ;) { const t = pk(); if (t.k === "id" && t.v === "as") { if (10 < min) break; nx(); l = { k: "cast", e: l, ty: type(), line: t.line }; continue; }
      if (t.k !== "op") break; const b = BP[t.v as string]; if (!b || b < min) break; nx(); if (b === 1) { l = { k: "assign", op: t.v as string, tg: l, e: expr(1), line: t.line }; continue; } if (b === 2) { l = { k: "range", a: l, b: expr(3), incl: t.v === "..=", line: t.line }; continue; } l = { k: "bin", op: t.v as string, a: l, b: expr(b + 1), line: t.line }; } return l; }
  function unary(): VzNode { const t = pk(); if (is("-") || is("!")) { nx(); return { k: "un", op: t.v as string, e: unary(), line: t.line }; } if (is("&") || is("&&")) { nx(); const mut = is("mut") ? (nx(), true) : false; return { k: "ref", mut, e: unary(), line: t.line }; }
    if (is("*")) { nx(); return { k: "deref", e: unary(), line: t.line }; } if (is("|") || is("||")) throw vzErr("Closures are not in the browser subset yet.", t.line); return post(prim()); }
  function list(c: string): VzNode[] { const a: VzNode[] = []; while (!is(c)) { a.push(expr()); if (is(",")) nx(); else break; } eat(c); return a; }
  function post(e: VzNode): VzNode { for (; ;) { const t = pk(); if (is("(") && (e.k === "var" || e.k === "path")) { nx(); e = { k: "call", fn: (e.k === "var" ? e.name : e.parts!.join("::")) as string, args: list(")"), line: t.line }; continue; }
      if (is(".")) { nx(); if (pk().k === "num") throw vzErr("Tuples are not in the browser subset yet.", t.line); const m = ident(); if (is("::")) throw vzErr("Turbofish `::<>` is not in the subset yet — annotate the variable type instead.", t.line); if (!is("(")) throw vzErr(`Field access \`.${m}\` needs structs, not in the subset yet.`, t.line); nx(); e = { k: "mcall", obj: e, m, args: list(")"), line: t.line }; continue; }
      if (is("[")) { nx(); if (is("..") || is("]")) throw vzErr("Range slicing `[a..b]` is not in the subset yet.", t.line); const i = expr(); if (i.k === "range") throw vzErr("Range slicing `[a..b]` is not in the subset yet.", t.line); eat("]"); e = { k: "idx", e, i, line: t.line }; continue; }
      if (is("?")) throw vzErr("The `?` operator needs Result, not in the subset yet.", t.line); return e; } }
  function prim(): VzNode { const t = pk();
    if (t.k === "num") { nx(); return t.f ? { k: "float", v: t.v, line: t.line } : { k: "int", v: t.v, suf: t.suf, line: t.line }; }
    if (t.k === "str") { nx(); return { k: "strlit", v: t.v, line: t.line }; } if (t.k === "char") { nx(); return { k: "charlit", v: t.v, line: t.line }; }
    if (is("true") || is("false")) { nx(); return { k: "bool", v: t.v === "true", line: t.line }; }
    if (is("(")) { nx(); if (is(")")) { nx(); return { k: "unit", line: t.line }; } const e = expr(); if (is(",")) throw vzErr("Tuples are not in the browser subset yet.", t.line); eat(")"); return e; }
    if (is("[")) { nx(); if (is("]")) { nx(); return { k: "arr", items: [], line: t.line }; } const f = expr(); if (is(";")) { nx(); const n = expr(); eat("]"); return { k: "arrrep", e: f, n, line: t.line }; } const items = [f]; while (is(",")) { nx(); if (is("]")) break; items.push(expr()); } eat("]"); return { k: "arr", items, line: t.line }; }
    if (is("{")) return block(); if (is("if")) { return ifx(); }
    if (t.k === "id") { if (NOPE[t.v as string]) throw nope(t); if (["while", "for", "loop"].includes(t.v as string)) throw vzErr(`\`${t.v}\` as a value is not in the subset yet.`, t.line); nx();
      if (is("!") && (is("(", 1) || is("[", 1))) { nx(); const open = nx().v;
        if (t.v === "vec") { if (open !== "[") throw vzErr("use vec![…]", t.line); if (is("]")) { nx(); return { k: "vec", items: [], line: t.line }; } const f = expr(); if (is(";")) { nx(); const n = expr(); eat("]"); return { k: "vecrep", e: f, n, line: t.line }; } const items = [f]; while (is(",")) { nx(); if (is("]")) break; items.push(expr()); } eat("]"); return { k: "vec", items, line: t.line }; }
        return { k: "mac", name: t.v as string, args: list(open === "(" ? ")" : "]"), line: t.line }; }
      if (is("::")) { const parts: string[] = [t.v as string]; while (is("::")) { nx(); if (is("<")) throw vzErr("Turbofish `::<>` is not in the subset yet.", t.line); parts.push(ident()); } return { k: "path", parts, line: t.line }; }
      return { k: "var", name: t.v as string, line: t.line }; }
    throw E(`unexpected \`${t.k === "eof" ? "end of file" : t.v}\``); }
  function ifx(): VzNode { const t = eat("if"); if (is("let")) throw vzErr("`if let` needs Option, not in the subset yet.", t.line); const c = expr(), th = block(); let el: VzNode | null = null; if (is("else")) { nx(); el = is("if") ? ifx() : block(); } return { k: "if", c, th, el, line: t.line }; }
  items_(); return { fns };
}
