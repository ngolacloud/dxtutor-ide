import { test, expect } from "vitest";
import { diffLines, diffStat, MAX_CELLS, type DiffRow } from "../src/features/diff/domain/diff";

/** O diff do monólito, tal como estava (referência para o comportamento). */
function legacy(a: string | null, b: string | null): DiffRow[] {
  const A = a ? a.split("\n") : [],
    B = b ? b.split("\n") : [],
    n = A.length,
    m = B.length,
    L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffRow[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push([" ", A[i], i + 1, j + 1]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      out.push(["-", A[i], i + 1, ""]);
      i++;
    } else {
      out.push(["+", B[j], "", j + 1]);
      j++;
    }
  }
  while (i < n) (out.push(["-", A[i], i + 1, ""]), i++);
  while (j < m) (out.push(["+", B[j], "", j + 1]), j++);
  return out;
}

/** Reconstrói A e B a partir das linhas do diff — qualquer diff válido tem de o permitir. */
function rebuild(d: DiffRow[]): [string, string] {
  const a = d.filter((r) => r[0] !== "+").map((r) => r[1]),
    b = d.filter((r) => r[0] !== "-").map((r) => r[1]);
  return [a.join("\n"), b.join("\n")];
}

test("casos básicos: vazio, igual, só adições, só remoções", () => {
  expect(diffLines(null, null)).toEqual([]);
  expect(diffLines("a\nb", "a\nb")).toEqual([
    [" ", "a", 1, 1],
    [" ", "b", 2, 2],
  ]);
  expect(diffStat("", "x\ny")).toEqual({ add: 2, del: 0 });
  expect(diffStat("x\ny", null)).toEqual({ add: 0, del: 2 });
});

test("uma edição a meio: prefixo/sufixo preservados com a numeração certa", () => {
  const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd");
  expect(d).toEqual([
    [" ", "a", 1, 1],
    ["-", "b", 2, ""],
    ["+", "B", "", 2],
    [" ", "c", 3, 3],
    [" ", "d", 4, 4],
  ]);
});

test("mesma estatística e reconstrução que o diff original em casos aleatórios", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gen = (n: number) => Array.from({ length: n }, () => "l" + Math.floor(rnd() * 6)).join("\n");
  for (let k = 0; k < 300; k++) {
    const a = gen(Math.floor(rnd() * 25)),
      b = gen(Math.floor(rnd() * 25));
    const d = diffLines(a, b),
      ref = legacy(a, b);
    // mesmo nº de linhas comuns (ambos são LCS óptimos) …
    expect(d.filter((r) => r[0] === " ").length).toBe(ref.filter((r) => r[0] === " ").length);
    // … e o diff reconstrói exactamente as duas versões
    expect(rebuild(d)).toEqual([a ? a : "", b ? b : ""].map((s) => s.split("\n").join("\n")));
  }
});

test("ficheiro grande com uma edição: rápido e sem tabela gigante", () => {
  const big = Array.from({ length: 20000 }, (_, i) => "line " + i);
  const edited = big.slice();
  edited[10000] = "changed";
  const t0 = Date.now();
  const s = diffStat(big.join("\n"), edited.join("\n"));
  expect(s).toEqual({ add: 1, del: 1 });
  expect(Date.now() - t0).toBeLessThan(1000);
});

test("zona alterada acima do limite: cai para remoção + adição, ainda reconstruível", () => {
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const a = Array.from({ length: n }, (_, i) => "a" + i).join("\n"),
    b = Array.from({ length: n }, (_, i) => "b" + i).join("\n");
  const d = diffLines(a, b);
  expect(diffStat(a, b)).toEqual({ add: n, del: n });
  expect(rebuild(d)).toEqual([a, b]);
});
