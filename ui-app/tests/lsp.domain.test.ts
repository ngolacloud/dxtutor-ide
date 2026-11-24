// feature `lsp` — domínio puro: linguagens, posições/geometria, respostas e caminhos.
import { describe, expect, it } from "vitest";
import { languageIdFor } from "../src/features/lsp/domain/languages";
import { offsetAtPoint, offsetToPosition, pointOfOffset, positionToOffset, wordAt } from "../src/features/lsp/domain/positions";
import { allTargets, firstTarget, hoverBlocks, isIndexing, plainMarkdown, renameRange, uriToPath, workspaceEditFiles } from "../src/features/lsp/domain/results";
import { applyTextEdits } from "../src/features/lsp/domain/edits";
import { absoluteToKey, keyToAbsolute } from "../src/features/lsp/domain/paths";

describe("languageIdFor", () => {
  it("dá o languageId das linguagens com servidor e null para o resto", () => {
    expect(languageIdFor("proj/src/Main.java")).toBe("java");
    expect(languageIdFor("proj/App.kt")).toBe("kotlin");
    expect(languageIdFor("proj/build.gradle.kts")).toBe("kotlin");
    expect(languageIdFor("q.SQL")).toBe("sql");
    expect(languageIdFor("a/b.tsx")).toBe("typescriptreact");
    expect(languageIdFor("README.md")).toBeNull();
    expect(languageIdFor("Makefile")).toBeNull();
    expect(languageIdFor(".gitignore")).toBeNull();
  });
});

describe("posições", () => {
  const text = "class A {\n  int x;\n}\n";
  it("offset ↔ {line, character}", () => {
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
    expect(offsetToPosition(text, text.indexOf("x"))).toEqual({ line: 1, character: 6 });
    expect(positionToOffset(text, { line: 1, character: 6 })).toBe(text.indexOf("x"));
    // presa ao fim da linha e do texto
    expect(positionToOffset(text, { line: 0, character: 99 })).toBe(9);
    expect(positionToOffset(text, { line: 9, character: 0 })).toBe(text.length);
  });

  it("ponto do rato → offset, com tabs expandidos", () => {
    const m = { lineHeight: 22, charWidth: 8, tabSize: 4 };
    const src = "ab\n\tcd";
    expect(offsetAtPoint(src, 8 * 1 + 1, 5, m)).toBe(1); // 'b'
    // na linha 2, o tab ocupa as colunas 0–3; 'c' está na coluna 4
    expect(offsetAtPoint(src, 8 * 2, 22 + 3, m)).toBe(3); // ainda o tab
    expect(offsetAtPoint(src, 8 * 4 + 2, 22 + 3, m)).toBe(4); // 'c'
    expect(offsetAtPoint(src, 8 * 20, 5, m)).toBeNull(); // depois do fim da linha
    expect(offsetAtPoint(src, 4, 22 * 5, m)).toBeNull(); // abaixo da última linha
  });
});

describe("respostas do servidor", () => {
  it("hover: MarkupContent markdown com bloco de código", () => {
    expect(hoverBlocks({ contents: { kind: "markdown", value: "```java\nint sum(int a)\n```\nAdds numbers." } })).toEqual([
      { code: true, text: "int sum(int a)" },
      { code: false, text: "Adds numbers." },
    ]);
  });
  it("hover: o markdown da documentação fica legível (caso real do jdtls)", () => {
    const jdtls = "```java\nint Util.add(int a, int b)\n```\nAdds two numbers.\n\n*  **Parameters:**\n    \n    * **a** <!-- -->\n    * **b**\n\nSource: *[tmp_6dc65fb](file:///tmp/x/Util.java#3)*";
    expect(hoverBlocks({ contents: { kind: "markdown", value: jdtls } })).toEqual([
      { code: true, text: "int Util.add(int a, int b)" },
      { code: false, text: "Adds two numbers.\n\n• Parameters:\n\n    • a\n    • b\n\nSource: tmp_6dc65fb" },
    ]);
    expect(plainMarkdown("use `List<T>` and \\*not\\* *this* or __that__")).toBe("use List<T> and *not* this or that");
  });

  it("hover: MarkedString antigo, lista e texto simples", () => {
    expect(hoverBlocks({ contents: [{ language: "kotlin", value: "fun f(): Int" }, "doc"] })).toEqual([
      { code: true, text: "fun f(): Int" },
      { code: false, text: "doc" },
    ]);
    expect(hoverBlocks({ contents: { kind: "plaintext", value: " x " } })).toEqual([{ code: false, text: "x" }]);
    expect(hoverBlocks(null)).toEqual([]);
    expect(hoverBlocks({ contents: "" })).toEqual([]);
  });
  it("definição: Location, Location[] e LocationLink[]", () => {
    const loc = { uri: "file:///w/p/A.java", range: { start: { line: 3, character: 7 }, end: { line: 3, character: 8 } } };
    expect(firstTarget(loc)).toEqual({ path: "/w/p/A.java", uri: loc.uri, line: 3, character: 7 });
    expect(firstTarget([loc])?.line).toBe(3);
    const link = { targetUri: "file:///w/p/B%20C.kt", targetRange: {}, targetSelectionRange: { start: { line: 1, character: 2 } } };
    expect(firstTarget([link])).toEqual({ path: "/w/p/B C.kt", uri: link.targetUri, line: 1, character: 2 });
    expect(firstTarget([])).toBeNull();
    expect(firstTarget(null)).toBeNull();
  });
  it("URIs que não são ficheiros e o aviso de indexação", () => {
    expect(uriToPath("jdt://contents/rt.jar/java.lang/String.class")).toBeNull();
    expect(isIndexing({ indexing: true })).toBe(true);
    expect(isIndexing([])).toBe(false);
  });
});

describe("chave do editor ↔ caminho no disco", () => {
  it("converte nos dois sentidos e recusa o que está fora", () => {
    expect(keyToAbsolute("proj/src/A.java", "proj/", "/home/u/proj")).toBe("/home/u/proj/src/A.java");
    expect(keyToAbsolute("other/A.java", "proj/", "/home/u/proj")).toBeNull();
    expect(keyToAbsolute("proj/../x", "proj/", "/home/u/proj")).toBeNull();
    expect(absoluteToKey("/home/u/proj/src/A.java", "proj/", "/home/u/proj/")).toBe("proj/src/A.java");
    expect(absoluteToKey("/home/u/project/A.java", "proj/", "/home/u/proj")).toBeNull();
  });
});

describe("referências e rename (domínio)", () => {
  it("allTargets: todas as localizações, sem repetidos", () => {
    const a = { uri: "file:///w/A.java", range: { start: { line: 1, character: 2 } } };
    const b = { uri: "file:///w/B.java", range: { start: { line: 3, character: 4 } } };
    expect(allTargets([a, b, a]).map((t) => `${t.path}:${t.line}`)).toEqual(["/w/A.java:1", "/w/B.java:3"]);
    expect(allTargets(null)).toEqual([]);
  });

  it("workspaceEditFiles: forma changes e forma documentChanges (operações de ficheiro contadas)", () => {
    const r = (l: number, c1: number, c2: number) => ({ start: { line: l, character: c1 }, end: { line: l, character: c2 } });
    expect(workspaceEditFiles({ changes: { "file:///w/A.kt": [{ range: r(0, 4, 9), newText: "salute" }] } })).toEqual({
      files: [{ uri: "file:///w/A.kt", path: "/w/A.kt", edits: [{ range: r(0, 4, 9), newText: "salute" }] }],
      fileOps: 0,
    });
    const dc = workspaceEditFiles({
      documentChanges: [
        { textDocument: { uri: "file:///w/A.java", version: 2 }, edits: [{ range: r(2, 1, 4), newText: "sum" }] },
        { kind: "rename", oldUri: "file:///w/A.java", newUri: "file:///w/B.java" },
        { textDocument: { uri: "file:///w/A.java", version: 2 }, edits: [{ range: r(5, 0, 3), newText: "sum" }] },
      ],
    });
    expect(dc.files).toHaveLength(1);
    expect(dc.files[0].edits).toHaveLength(2);
    expect(dc.fileOps).toBe(1);
    expect(workspaceEditFiles(null)).toEqual({ files: [], fileOps: 0 });
  });

  it("renameRange: Range, {range, placeholder}, {defaultBehavior} e recusa", () => {
    const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } };
    expect(renameRange(range)).toEqual({ range, placeholder: null });
    expect(renameRange({ range, placeholder: "greet" })).toEqual({ range, placeholder: "greet" });
    expect(renameRange({ defaultBehavior: true })).toEqual({ range: null, placeholder: null });
    expect(renameRange(null)).toBeNull();
  });

  it("applyTextEdits: do fim para o princípio, em várias linhas; sobrepostas lançam", () => {
    const text = "fun greet() {}\nval a = greet()\nval b = greet()\n";
    const at = (line: number, ch: number) => ({ start: { line, character: ch }, end: { line, character: ch + 5 } });
    const out = applyTextEdits(text, [at(1, 8), at(0, 4), at(2, 8)].map((range) => ({ range, newText: "salute" })));
    expect(out).toBe("fun salute() {}\nval a = salute()\nval b = salute()\n");
    expect(() => applyTextEdits(text, [{ range: at(0, 4), newText: "x" }, { range: at(0, 6), newText: "y" }])).toThrow();
  });

  it("wordAt e pointOfOffset", () => {
    const text = "\tint total = Util.add(1, 2);";
    const add = text.indexOf("add");
    expect(wordAt(text, add + 1)).toEqual({ start: add, end: add + 3, word: "add" });
    expect(wordAt(text, text.indexOf("("))?.word).toBe("add"); // logo a seguir ao nome
    expect(wordAt(text, text.indexOf(" = ") + 1)).toBeNull();
    expect(pointOfOffset(text, 1, { lineHeight: 22, charWidth: 8, tabSize: 4 })).toEqual({ x: 32, y: 0 });
  });
});
