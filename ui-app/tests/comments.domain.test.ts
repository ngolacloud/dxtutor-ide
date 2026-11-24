// feature `comments` — domínio puro e caso de uso (portas falsas).
import { describe, expect, it, vi } from "vitest";
import { commentContext, lineAtY, lineCount, lineOfOffset, linesText, preview, rangeFor, rangeLabel } from "../src/features/comments/domain/comment";
import { makeLineComments } from "../src/features/comments/application/line-comments";
import type { EditorPort } from "../src/features/comments/application/ports";

const SRC = "use std::fs;\nuse std::path::Path;\n\nfn main() {\n    let p = Path::new(\"x\");\n}\n";
const WORDS = { line: "{path}, line {line}", lines: "{path}, lines {from}–{to}", comment: "Comment" };

describe("domínio", () => {
  it("linhas: contagem, linha de um offset e linha sob o ponteiro", () => {
    expect(lineCount(SRC)).toBe(7);
    expect(lineOfOffset(SRC, 0)).toBe(1);
    expect(lineOfOffset(SRC, SRC.indexOf("Path;"))).toBe(2);
    expect(lineOfOffset(SRC, 10_000)).toBe(7);
    expect(lineAtY(0, 22, 7)).toBe(1);
    expect(lineAtY(21.9, 22, 7)).toBe(1);
    expect(lineAtY(22, 22, 7)).toBe(2);
    expect(lineAtY(7 * 22, 22, 7)).toBe(null); // abaixo da última linha
    expect(lineAtY(-1, 22, 7)).toBe(null);
  });

  it("a selecção que contém a linha apontada define o bloco; fora dela, só a linha", () => {
    const a = SRC.indexOf("fn main"), b = SRC.indexOf("}\n") + 1;
    expect(rangeFor(5, SRC, a, b)).toEqual({ from: 4, to: 6 });
    expect(rangeFor(2, SRC, a, b)).toEqual({ from: 2, to: 2 });
    expect(rangeFor(3, SRC, 5, 5)).toEqual({ from: 3, to: 3 });
    // uma selecção que acaba no início de uma linha não a inclui
    const l2 = SRC.indexOf("use std::path"), l3 = SRC.indexOf("\n\n") + 1;
    expect(rangeFor(2, SRC, l2, l3)).toEqual({ from: 2, to: 2 });
  });

  it("texto, rótulo e pré-visualização", () => {
    expect(linesText(SRC, { from: 4, to: 6 })).toBe('fn main() {\n    let p = Path::new("x");\n}');
    expect(rangeLabel("src/main.rs", { from: 2, to: 2 })).toBe("main.rs:2");
    expect(rangeLabel("src/main.rs", { from: 4, to: 6 })).toBe("main.rs:4–6");
    expect(preview("  usa   o\nPathBuf aqui  ")).toBe("usa o PathBuf aqui");
    expect(preview("x".repeat(40), 10)).toBe("xxxxxxxxx…");
  });

  it("o contexto leva onde, o código e o comentário; vazio não gera nada", () => {
    const c = commentContext({ path: "src/main.rs", text: SRC, range: { from: 2, to: 2 }, comment: " Troca por PathBuf ", words: WORDS })!;
    expect(c).toEqual({
      kind: "comment",
      label: "main.rs:2 · Troca por PathBuf",
      text: "src/main.rs, line 2:\n```\nuse std::path::Path;\n```\nComment: Troca por PathBuf",
      path: "src/main.rs",
    });
    const r = commentContext({ path: "src/main.rs", text: SRC, range: { from: 4, to: 6 }, comment: "simplifica", words: WORDS })!;
    expect(r.text.startsWith("src/main.rs, lines 4–6:\n```\nfn main() {")).toBe(true);
    expect(commentContext({ path: "a.rs", text: SRC, range: { from: 1, to: 1 }, comment: "   ", words: WORDS })).toBe(null);
  });
});

describe("caso de uso", () => {
  function setup(o: Partial<EditorPort> = {}, available = true) {
    const editor: EditorPort = {
      path: () => "src/main.rs",
      text: () => SRC,
      selection: () => ({ start: 0, end: 0 }),
      showingProposal: () => false,
      ...o,
    };
    const ask = vi.fn(async () => {});
    const lc = makeLineComments({ editor, ask: { available: () => available, ask }, words: () => WORDS });
    return { lc, ask };
  }

  it("abre na linha, junta ao chat sem enviar e fecha", async () => {
    const { lc, ask } = setup();
    expect(lc.canComment()).toBe(true);
    expect(lc.openAt(2)).toEqual({ path: "src/main.rs", range: { from: 2, to: 2 }, label: "main.rs:2" });
    expect(await lc.add("")).toBe(false); // vazio: fica aberto
    expect(lc.current()).not.toBe(null);
    expect(await lc.add("usa PathBuf")).toBe(true);
    expect(ask).toHaveBeenCalledWith({
      intent: "chat",
      send: false,
      context: [expect.objectContaining({ kind: "comment", label: "main.rs:2 · usa PathBuf", path: "src/main.rs" })],
    });
    expect(lc.current()).toBe(null);
  });

  it("descartar não pergunta nada", async () => {
    const { lc, ask } = setup();
    lc.openAt(3);
    lc.discard();
    expect(await lc.add("x")).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("sem ficheiro, sem Co-Dev ou com uma proposta por cima, não abre", () => {
    expect(setup({ path: () => null }).lc.openAt(1)).toBe(null);
    expect(setup({}, false).lc.openAt(1)).toBe(null);
    const p = setup({ showingProposal: () => true }).lc;
    expect(p.canComment()).toBe(false);
    expect(p.openAt(1)).toBe(null);
  });

  it("com uma selecção que contém a linha, o comentário abrange-a", () => {
    const a = SRC.indexOf("fn main"), b = SRC.indexOf("}\n") + 1;
    const { lc } = setup({ selection: () => ({ start: a, end: b }) });
    expect(lc.openAt(5)!.label).toBe("main.rs:4–6");
  });
});
