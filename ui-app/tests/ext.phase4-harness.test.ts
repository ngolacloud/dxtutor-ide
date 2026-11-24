// Fase 4 (ADR-0004) na cadeia real de módulos: a página de detalhe de uma extensão
// instalada por VSIX mostra o que ela contribui (e é honesta sobre o que não corre), e o
// editor ganha o toggle de comentário (Ctrl+/) e os snippets (Tab) publicados pela feature.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: any;

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Fase 4 — extensões VS Code", () => {
  it("detalhe de um VSIX com contribuições: tema, gramática, snippets, LSP e a nota honesta", () => {
    w.EXS.vsix.push({
      id: "llvm-vs-code-extensions.vscode-clangd", n: "clangd", pub: "llvm", d: "C/C++", ctx: [], vsix: 1,
      contrib: { themes: ["Night"], grammars: ["cpp"], snippets: 3, languages: ["cpp"], lsp: "clangd", warnings: ["grammar x: only JSON grammars are supported"] },
    });
    w.EXS.inst["llvm-vs-code-extensions.vscode-clangd"] = { on: 1 };
    const host = document.createElement("div");
    w.renderExtd({ ext: "llvm-vs-code-extensions.vscode-clangd" }, host);
    const text = host.textContent || "";
    expect(text).toContain("What this extension adds here");
    expect(text).toContain("there is no VS Code extension host");
    expect(text).toContain("Color theme Night");
    expect(text).toContain("Syntax highlighting (TextMate) for cpp");
    expect(text).toContain("3 snippets");
    expect(text).toContain("dxtutor runs clangd");
    expect(text).toContain("only JSON grammars");
    expect(host.querySelector('[onclick^="vsxApplyTheme"]')).not.toBeNull();
    expect(text).not.toContain("extension host. Here its commands");
  });

  it("Ctrl+/ comenta e descomenta com o marcador da linguagem (sem extensão: o por omissão)", () => {
    const ta = document.createElement("textarea");
    ta.value = "fn main() {\n    let x = 1;\n}";
    ta.setSelectionRange(ta.value.indexOf("let"), ta.value.indexOf("let"));
    expect(w.vsxToggleComment(ta, "src/main.rs")).toBe(true);
    expect(ta.value).toBe("fn main() {\n    // let x = 1;\n}");
    w.vsxToggleComment(ta, "src/main.rs");
    expect(ta.value).toBe("fn main() {\n    let x = 1;\n}");
    const py = document.createElement("textarea");
    py.value = "x = 1";
    expect(w.vsxToggleComment(py, "a.py")).toBe(true);
    expect(py.value).toBe("# x = 1");
    expect(w.vsxToggleComment(document.createElement("textarea"), "notes.unknownext")).toBe(false);
  });

  it("sem extensões instaladas, o Tab não expande nada e o realce é o de sempre", () => {
    const ta = document.createElement("textarea");
    ta.value = "for";
    ta.setSelectionRange(3, 3);
    expect(w.vsxSnippet(ta, "a.rs")).toBe(false);
    expect(w.vsxHighlight("rs", ["fn main() {}"])).toBeNull();
  });
});
