/* ═════════ dxtutor IDE — desktop: o HEAD de muitos ficheiros num só processo (P2) ═════════
   O `markChanged` pedia `git show HEAD:./<p>` a cada ficheiro alterado, um processo de cada vez (100 ficheiros
   alterados = 100 processos). `git cat-file --batch` lê os pedidos do stdin e responde a todos num processo:
   `<oid> blob <bytes>\n<conteúdo>\n`, ou `<pedido> missing\n`. Os tamanhos são em BYTES e o `exec` devolve o
   stdout como texto UTF-8 (bytes inválidos trocados por U+FFFD): para texto válido, re-codificar dá os mesmos
   bytes; se não bater (um blob binário), a resposta não serve e quem chama volta ao `git show` por ficheiro. */

/** Os pedidos do stdin: um `HEAD:./<caminho>` por linha (um caminho com fim de linha não cabe no protocolo). */
export function catFileRequests(paths: string[]): string | null {
  if (paths.some(p => p.includes("\n"))) return null;
  return paths.map(p => `HEAD:./${p}\n`).join("");
}

/**
 * O conteúdo de cada pedido, pela ordem (null: não existe no HEAD), ou null quando a saída não bate com
 * `n` respostas bem formadas.
 */
export function parseCatFileBatch(out: string, n: number): (string | null)[] | null {
  const b = new TextEncoder().encode(out), dec = new TextDecoder();
  const res: (string | null)[] = [];
  let i = 0;
  while (res.length < n) {
    const nl = b.indexOf(10, i);
    if (nl < 0) return null;
    const head = dec.decode(b.subarray(i, nl));
    i = nl + 1;
    if (head.endsWith(" missing") || head.endsWith(" ambiguous")) { res.push(null); continue; }
    const m = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(head);
    if (!m) return null;
    const size = Number(m[2]);
    if (i + size >= b.length || b[i + size] !== 10) return null;
    // um caminho que é uma pasta no HEAD responde `tree`: não é o conteúdo de um ficheiro
    res.push(m[1] === "blob" ? dec.decode(b.subarray(i, i + size)) : null);
    i += size + 1;
  }
  return i === b.length ? res : null;
}
