// Fase 4 (ADR-0004): contribuições declarativas de extensões VS Code — JSONC, temas,
// snippets, gramáticas TextMate «lite» e language-configuration. Domínio puro.
import { describe, test, expect } from "vitest";
import { parseJsonc } from "../src/features/ext/domain/jsonc";
import { colorFor, mergeThemes, themeToCss, type VsTheme } from "../src/features/ext/domain/theme";
import { expandSnippet, matchSnippet, parseSnippets } from "../src/features/ext/domain/snippets";
import { compileOniguruma, highlightLines, loadGrammar, scopeClass, tokenizeLine, type RawGrammar } from "../src/features/ext/domain/textmate";
import {
  filesToRead,
  languageOf,
  parseLanguageConfig,
  resolveRelative,
  toggleLineComment,
  zipPathOf,
  KNOWN_LANGUAGE_SERVERS,
} from "../src/features/ext/domain/contributions";

describe("JSONC", () => {
  test("tira comentários e vírgulas finais, sem mexer nas strings", () => {
    const v = parseJsonc(`{
      // comentário
      "url": "http://x/*y*/", /* bloco */
      "list": [1, 2,],
      "a": {"b": "c",},
    }`);
    expect(v).toEqual({ url: "http://x/*y*/", list: [1, 2], a: { b: "c" } });
  });
  test("strings com aspas escapadas", () => {
    expect(parseJsonc(`{"q": "a \\" // b"}`)).toEqual({ q: 'a " // b' });
  });
});

describe("temas", () => {
  const theme: VsTheme = {
    colors: { "editor.background": "#101010", "editor.foreground": "#eeeeee", "editorLineNumber.foreground": "#555" },
    tokenColors: [
      { scope: "comment", settings: { foreground: "#6a9955", fontStyle: "italic" } },
      { scope: ["string", "string.quoted.double"], settings: { foreground: "#ce9178" } },
      { scope: "keyword", settings: { foreground: "#111111" } },
      { scope: "keyword.control", settings: { foreground: "#c586c0" } },
      { scope: "entity.name.function, support.function", settings: { foreground: "#dcdcaa" } },
      { scope: "constant.numeric", settings: { foreground: "#b5cea8" } },
      // Regressão (Dracula): uma excepção descendente não apaga a cor geral das strings.
      { scope: "meta.scope.for-loop.shell string", settings: { foreground: "#f8f8f2" } },
      { scope: "source.js constant.numeric", settings: { foreground: "#000001" } },
      { scope: "entity.name.type", settings: { foreground: "red; background:url(x)" } },
    ],
  };
  test("escolhe a regra mais específica (keyword.control vence keyword)", () => {
    expect(colorFor(theme, "kw")).toEqual({ color: "#c586c0", italic: false });
    expect(colorFor(theme, "cm")).toEqual({ color: "#6a9955", italic: true });
    expect(colorFor(theme, "num").color).toBe("#b5cea8");
    expect(colorFor(theme, "str").color).toBe("#ce9178");
  });
  test("CSS confinado ao editor e sem cores inseguras", () => {
    const css = themeToCss(theme, ".ed");
    expect(css).toContain(".ed{background:#101010;color:#eeeeee;}");
    expect(css).toContain(".ed .ed-gut{color:#555}");
    expect(css).toContain(".ed .ed-hl .fn{color:#dcdcaa");
    expect(css).not.toContain("url(");
    expect(css).not.toMatch(/\.ty\{/);
  });
  test("include: o tema filho ganha ao tema base", () => {
    const merged = mergeThemes(
      { colors: { "editor.background": "#000", "editor.foreground": "#fff" }, tokenColors: [{ scope: "string", settings: { foreground: "#111" } }] },
      { colors: { "editor.background": "#222" }, tokenColors: [{ scope: "string", settings: { foreground: "#333" } }] },
    );
    expect(merged.colors).toEqual({ "editor.background": "#222", "editor.foreground": "#fff" });
    expect(colorFor(merged, "str").color).toBe("#333");
  });
});

describe("snippets", () => {
  const snippets = parseSnippets(
    parseJsonc(`{
      "For loop": { "prefix": ["for", "fori"], "body": ["for (let \${1:i} = 0; $1 < \${2:n}; $1++) {", "\\t$0", "}"], "description": "loop" },
      "Log": { "prefix": "log", "body": "console.log(\${1:value});" },
      "Header": { "prefix": "hdr", "body": "// \${TM_FILENAME_BASE} (\${CURRENT_YEAR}) \\\\$ \${1|a,b|}" },
      "Broken": { "prefix": 3 }
    }`),
  );
  test("lê prefixos e corpos (string ou lista), ignora entradas inválidas", () => {
    expect(snippets.map(s => s.name)).toEqual(["For loop", "Log", "Header"]);
    expect(snippets[0].prefixes).toEqual(["for", "fori"]);
  });
  test("o prefixo tem de acabar no cursor e começar numa fronteira de palavra", () => {
    expect(matchSnippet("  for", snippets)!.snippet.name).toBe("For loop");
    expect(matchSnippet("  fori", snippets)!.prefix).toBe("fori");
    expect(matchSnippet("  platform", snippets)).toBeNull();
    expect(matchSnippet("x.log", snippets)!.snippet.name).toBe("Log");
  });
  test("expande tabstops, padrões, indentação e selecciona o primeiro tabstop", () => {
    const e = expandSnippet(snippets[0].body, {}, "  ", "    ");
    expect(e.text).toBe("for (let i = 0;  < n; ++) {\n      \n  }");
    expect(e.text.slice(e.selStart, e.selEnd)).toBe("i");
  });
  test("sem tabstops numerados o cursor vai para $0; sem nada, para o fim", () => {
    const zero = expandSnippet("a$0b");
    expect(zero).toEqual({ text: "ab", selStart: 1, selEnd: 1 });
    expect(expandSnippet("plain")).toEqual({ text: "plain", selStart: 5, selEnd: 5 });
  });
  test("variáveis, escapes e escolhas", () => {
    const e = expandSnippet(snippets[2].body, { filename: "src/app.ts", now: new Date(Date.UTC(2026, 10, 24)) });
    expect(e.text).toBe("// app (2026) $ a"); // `\$` no snippet é um `$` literal
    expect(e.text.slice(e.selStart, e.selEnd)).toBe("a");
  });
  test("padrões aninhados", () => {
    const e = expandSnippet("f(${1:x, ${2:y}})");
    expect(e.text).toBe("f(x, y)");
    expect(e.text.slice(e.selStart, e.selEnd)).toBe("x, y");
  });
});

const grammar: RawGrammar = {
  scopeName: "source.demo",
  patterns: [{ include: "#comments" }, { include: "#strings" }, { include: "#keywords" }, { include: "#numbers" }, { include: "#calls" }, { include: "#heredoc" }],
  repository: {
    comments: {
      patterns: [
        { name: "comment.line.double-slash.demo", match: "//.*$" },
        { name: "comment.block.demo", begin: "/\\*", end: "\\*/" },
      ],
    },
    strings: {
      name: "string.quoted.double.demo",
      begin: '"',
      end: '"',
      patterns: [{ name: "constant.character.escape.demo", match: "\\\\." }],
    },
    keywords: { name: "keyword.control.demo", match: "\\b(if|else|return|fn)\\b" },
    numbers: { name: "constant.numeric.demo", match: "(?x) \\b 0x \\h+ \\b | \\b \\d+ \\b" },
    calls: { match: "([A-Za-z_]\\w*)\\s*(?=\\()", captures: { "1": { name: "entity.name.function.demo" } } },
    heredoc: {
      name: "string.unquoted.heredoc.demo",
      begin: "<<(\\w+)",
      end: "^\\1$",
    },
  },
};

describe("gramáticas TextMate (lite)", () => {
  const g = loadGrammar(grammar);
  test("traduz Oniguruma comum e ignora o que não compila", () => {
    expect(compileOniguruma("\\h+")!.test("beef")).toBe(true);
    expect(compileOniguruma("a++b")!.test("aab")).toBe(true);
    expect(compileOniguruma("(?>ab)c")!.test("abc")).toBe(true);
    expect(compileOniguruma("(?i)select")!.test("SELECT")).toBe(true);
    expect(compileOniguruma("(unclosed")).toBeNull();
  });
  test("tokens com scopes, incluindo capturas", () => {
    const { tokens } = tokenizeLine(g, 'if foo(0x1F) "a\\nb" // fim', null);
    const pick = (text: string) => tokens.find(t => 'if foo(0x1F) "a\\nb" // fim'.slice(t.start, t.end) === text);
    expect(scopeClass(pick("if")!.scopes)).toBe("kw");
    expect(scopeClass(pick("foo")!.scopes)).toBe("fn");
    expect(scopeClass(pick("0x1F")!.scopes)).toBe("num");
    expect(pick("// fim")!.scopes).toContain("comment.line.double-slash.demo");
  });
  test("comentários de bloco atravessam linhas (estado entre linhas)", () => {
    const html = highlightLines(g, ["x /* começa", "continua if 1", "acaba */ return 2"]);
    expect(html[1]).toBe('<span class="cm">continua if 1</span>');
    expect(html[2]).toContain('<span class="cm">acaba */</span>');
    expect(html[2]).toContain('<span class="kw">return</span>');
    expect(html[2]).toContain('<span class="num">2</span>');
  });
  test("retro-referência do begin no end (heredoc)", () => {
    const html = highlightLines(g, ["<<EOT", "if 1", "EOT", "if"]);
    expect(html[1]).toBe('<span class="str">if 1</span>');
    expect(html[3]).toBe('<span class="kw">if</span>');
  });
  test("capturas com patterns re-tokenizam o texto capturado (chaves com pontos, como no TOML)", () => {
    const toml = loadGrammar({
      scopeName: "source.t",
      patterns: [
        {
          match: "^([\\w.]+)\\s*(=)",
          captures: {
            "1": { patterns: [{ match: "\\w+", name: "support.type.property-name.t" }, { match: "\\.", name: "punctuation.separator.dot.t" }] },
            "2": { name: "keyword.operator.t" },
          },
        },
      ],
    });
    expect(highlightLines(toml, ["a.b = 1"])[0]).toBe('<span class="ty">a</span>.<span class="ty">b</span> = 1');
  });

  test("escapa HTML e nunca fica preso em padrões vazios", () => {
    const empty = loadGrammar({ scopeName: "source.e", patterns: [{ name: "keyword.e", match: "\\b" }, { name: "keyword.x", match: "<b>" }] });
    expect(highlightLines(empty, ["a <b> c"])[0]).toBe('a <span class="kw">&lt;b&gt;</span> c');
  });
});

describe("linguagens, language-configuration e LSP", () => {
  const installed = [
    { id: "x.demo", languages: [{ id: "demo", extensions: [".dm"] }], grammars: [], themes: [], snippets: [], configs: [], warnings: [] },
  ];
  test("ficheiros a ler do VSIX e caminhos relativos", () => {
    const files = filesToRead({
      grammars: [{ language: "demo", scopeName: "source.demo", path: "./syntaxes/demo.tmLanguage.json" }],
      themes: [{ label: "Demo Dark", uiTheme: "vs-dark", path: "themes/dark.json" }],
      snippets: [{ language: "demo", path: "./snippets.json" }],
      languages: [{ id: "demo", extensions: [".dm"], configuration: "./language-configuration.json" }],
    });
    expect(files.map(f => [f.kind, f.zipPath])).toEqual([
      ["grammar", "extension/syntaxes/demo.tmLanguage.json"],
      ["theme", "extension/themes/dark.json"],
      ["snippets", "extension/snippets.json"],
      ["language-configuration", "extension/language-configuration.json"],
    ]);
    expect(resolveRelative("extension/themes/dark.json", "./base.json")).toBe("extension/themes/base.json");
    expect(resolveRelative("extension/themes/dark.json", "../common/x.json")).toBe("extension/common/x.json");
    expect(zipPathOf("extension/a.json")).toBe("extension/a.json");
  });
  test("linguagem de um ficheiro: as declaradas pelas extensões primeiro, depois as conhecidas", () => {
    expect(languageOf("dm", installed)).toBe("demo");
    expect(languageOf("rs", installed)).toBe("rust");
    expect(languageOf("zzz", installed)).toBeUndefined();
  });
  test("toggle de comentário: acrescenta na indentação comum, e tira", () => {
    const src = "fn a() {\n    x();\n\n    y();\n}";
    const on = toggleLineComment(src, src.indexOf("x"), src.indexOf("y") + 1, "//");
    expect(on.text).toBe("fn a() {\n    // x();\n\n    // y();\n}");
    const off = toggleLineComment(on.text, on.selStart, on.selEnd, "//");
    expect(off.text).toBe(src);
    expect(parseLanguageConfig({ comments: { lineComment: "#", blockComment: ["'''", "'''"] } })).toEqual({ lineComment: "#", blockComment: ["'''", "'''"] });
  });
  test("extensões que só arrancam um servidor LSP têm o servidor conhecido", () => {
    expect(KNOWN_LANGUAGE_SERVERS["llvm-vs-code-extensions.vscode-clangd"]).toEqual({ language: "cpp", server: "clangd" });
    expect(KNOWN_LANGUAGE_SERVERS["swiftlang.swift-vscode"].server).toBe("sourcekit-lsp");
  });
});
