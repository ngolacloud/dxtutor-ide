/* P2: o HEAD dos ficheiros alterados num só `git cat-file --batch` (platform/desktop/git-batch.ts), contra a
   saída de um git real; o texto chega como o `exec` o dá (UTF-8 com substituição). */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catFileRequests, parseCatFileBatch } from "../src/platform/desktop/git-batch";

const hasGit = spawnSync("git", ["--version"]).status === 0;

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "dxt-catfile-"));
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: d });
  g("init", "-q");
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src/a.rs"), "fn main() { println!(\"olá — ✓ 😀\"); }\n");
  writeFileSync(join(d, "no-newline.txt"), "last line");
  writeFileSync(join(d, "empty.txt"), "");
  writeFileSync(join(d, "bin.dat"), Buffer.from([0x66, 0xff, 0xfe, 0x0a, 0x00]));
  g("add", "-A");
  g("commit", "-qm", "init");
  return d;
}

/** Como o backend devolve o stdout: bytes → UTF-8 com U+FFFD nos inválidos. */
const asExec = (stdin: string, cwd: string) =>
  new TextDecoder().decode(execFileSync("git", ["cat-file", "--batch"], { cwd, input: stdin }));

describe.skipIf(!hasGit)("git cat-file --batch → o HEAD de cada ficheiro", () => {
  it("dá o conteúdo de cada pedido pela ordem, null para o que não existe no HEAD", () => {
    const d = repo();
    try {
      const paths = ["src/a.rs", "gone.rs", "no-newline.txt", "empty.txt"];
      const out = asExec(catFileRequests(paths)!, d);
      expect(parseCatFileBatch(out, paths.length)).toEqual([
        "fn main() { println!(\"olá — ✓ 😀\"); }\n",
        null,
        "last line",
        "",
      ]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("um blob que não é UTF-8 válido (ou uma pasta, cujos ids vêm em binário) não bate com os tamanhos: a resposta não serve (volta ao git show)", () => {
    const d = repo();
    try {
      const paths = ["bin.dat", "src/a.rs"];
      expect(parseCatFileBatch(asExec(catFileRequests(paths)!, d), paths.length)).toBeNull();
      expect(parseCatFileBatch(asExec(catFileRequests(["src", "src/a.rs"])!, d), 2)).toBeNull();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("o protocolo", () => {
  it("recusa um caminho com fim de linha, e uma saída curta, longa ou mal formada", () => {
    expect(catFileRequests(["a\nb"])).toBeNull();
    expect(catFileRequests(["a b", "c"])).toBe("HEAD:./a b\nHEAD:./c\n");
    const oid = "a".repeat(40);
    expect(parseCatFileBatch(`${oid} blob 2\nhi\n`, 1)).toEqual(["hi"]);
    expect(parseCatFileBatch(`${oid} blob 2\nhi\n`, 2)).toBeNull();
    expect(parseCatFileBatch(`${oid} blob 2\nhi\nextra`, 1)).toBeNull();
    expect(parseCatFileBatch(`${oid} blob 3\nhi\n`, 1)).toBeNull();
    expect(parseCatFileBatch(`fatal: not a git repository\n`, 1)).toBeNull();
  });
});
