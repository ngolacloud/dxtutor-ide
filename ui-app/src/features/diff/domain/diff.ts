/* ═════════ domínio: diff de linhas (LCS) ═════════
   Puro: só strings in → linhas out. A vista (features/diff.ts), a revisão (v5.ts) e o
   `git diff` do terminal simulado consomem-no.

   Diferenças em relação ao original do monólito:
     • aparar o prefixo e o sufixo comuns antes da tabela LCS — o caso típico (uma
       edição num ficheiro grande) passa de O(n·m) para O(k²) com k = zona alterada;
     • a tabela é Uint32Array (Uint16Array transbordava acima de 65 535 linhas comuns);
     • acima de MAX_CELLS células a tabela não é construída (um diff de 10k×10k linhas
       alocava ~200 MB e congelava a UI): a zona alterada sai como remoção + adição. */

/** Uma linha do diff: [marca, texto, nº na versão A, nº na versão B] ('' quando não existe). */
export type DiffRow = [" " | "-" | "+", string, number | "", number | ""];

export interface DiffStat {
  add: number;
  del: number;
}

/** Limite de células da tabela LCS (≈ 16 MB em Uint32). */
export const MAX_CELLS = 4_000_000;

const lines = (s: string | null | undefined): string[] => (s ? s.split("\n") : []);

export function diffLines(a: string | null | undefined, b: string | null | undefined): DiffRow[] {
  const A = lines(a),
    B = lines(b);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf])
    suf++;

  const out: DiffRow[] = [];
  for (let i = 0; i < pre; i++) out.push([" ", A[i], i + 1, i + 1]);

  const a0 = pre,
    b0 = pre,
    n = A.length - pre - suf,
    m = B.length - pre - suf;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (let i = 0; i < n; i++) out.push(["-", A[a0 + i], a0 + i + 1, ""]);
    for (let j = 0; j < m; j++) out.push(["+", B[b0 + j], "", b0 + j + 1]);
  } else {
    // L[i*(m+1)+j] = comprimento da LCS de A[a0+i..] e B[b0+j..] (zona do meio)
    const W = m + 1,
      L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * W + j] =
          A[a0 + i] === B[b0 + j]
            ? L[(i + 1) * W + j + 1] + 1
            : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (A[a0 + i] === B[b0 + j]) {
        out.push([" ", A[a0 + i], a0 + i + 1, b0 + j + 1]);
        i++;
        j++;
      } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) {
        out.push(["-", A[a0 + i], a0 + i + 1, ""]);
        i++;
      } else {
        out.push(["+", B[b0 + j], "", b0 + j + 1]);
        j++;
      }
    }
    for (; i < n; i++) out.push(["-", A[a0 + i], a0 + i + 1, ""]);
    for (; j < m; j++) out.push(["+", B[b0 + j], "", b0 + j + 1]);
  }

  for (let k = 0; k < suf; k++) {
    const ia = A.length - suf + k,
      ib = B.length - suf + k;
    out.push([" ", A[ia], ia + 1, ib + 1]);
  }
  return out;
}

export function diffStat(a: string | null | undefined, b: string | null | undefined): DiffStat {
  let add = 0,
    del = 0;
  for (const r of diffLines(a, b)) {
    if (r[0] === "+") add++;
    else if (r[0] === "-") del++;
  }
  return { add, del };
}
