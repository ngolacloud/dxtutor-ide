/* ═══════════ feature `visualizer` — inferência de tipos por uso (ADR-0002, Fase 2) ═══════════
   PURO: percorre o AST e deduz tipos prováveis de variáveis não anotadas (ex. o
   índice de um `v[i]` é `usize`, o argumento passado a `fn(x: i32)` é `i32`). Lógica
   VERBATIM; só anotações e asserções (`as`/`!`) apagáveis — `walk` recebe nós, arrays
   e primitivos, daí os `cast`s pontuais. */

import type { Ast, Hint, Hints, VzNode } from "./types";
import { VZSZ } from "./constants";

export function vzHints(ast: Ast): Hints {
  const H: Hints = {};
  for (const f of Object.values(ast.fns)) {
    const h: Record<string, Hint> = (H[f.name] = {}), isLen = (x: VzNode | null | undefined): boolean => !!(x && x.k === "mcall" && ["len", "capacity"].includes(x.m as string));
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const node = n as VzNode;
      if (node.k === "call" && ast.fns[node.fn as string]) node.args!.forEach((a, i) => { const p = ast.fns[node.fn as string].params[i]; if (!p) return; if (a.k === "ref" && a.e!.k === "var") { const m = p.ty.match(/^&(?:mut )?\[([^;\]]+)\]$/) || p.ty.match(/^&(?:mut )?Vec<(.+)>$/); if (m) h[a.e!.name as string] = h[a.e!.name as string] || { el: m[1] }; } else if (a.k === "var" && VZSZ[p.ty]) h[a.name as string] = h[a.name as string] || { t: p.ty }; });
      if (node.k === "bin" && ["<", ">", "<=", ">=", "==", "!="].includes(node.op as string)) { if (node.a!.k === "var" && isLen(node.b)) h[node.a!.name as string] = h[node.a!.name as string] || { t: "usize" }; if (node.b!.k === "var" && isLen(node.a)) h[node.b!.name as string] = h[node.b!.name as string] || { t: "usize" }; }
      if (node.k === "idx" && node.i && node.i.k === "var") h[node.i.name as string] = h[node.i.name as string] || { t: "usize" }; if (node.k === "ret" && node.e && node.e.k === "var" && f.ret && VZSZ[f.ret]) h[node.e.name as string] = h[node.e.name as string] || { t: f.ret };
      const rec = n as Record<string, unknown>;
      for (const k in rec) if (k !== "k" && typeof rec[k] === "object") walk(rec[k]);
    };
    walk(f.body);
    const tail = f.body.tail as VzNode | undefined;
    if (tail && tail.k === "var" && f.ret && VZSZ[f.ret]) h[tail.name as string] = h[tail.name as string] || { t: f.ret };
  }
  return H;
}
