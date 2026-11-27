// LSP P5 — o editor sem servidor de linguagem, domínio puro: as palavras do completion, os comentários de
// bloco (Ctrl+Shift+A e o Ctrl+/ de uma linguagem sem comentário de linha) e o «Format Document» seguro.
import { describe, expect, it } from "vitest";
import { collectWords, wordItems, wordRangeAt } from "../src/features/lsp/domain/words";
import { toggleBlockComment, toggleLinesWithBlock, type CommentPair } from "../src/features/lsp/domain/comments";
import { detectIndent, safeFormat } from "../src/features/lsp/domain/safe-format";
import { describeSafeFormat, formatWithoutServer } from "../src/features/lsp/application/fallback-format";
import { makeWordCompletion } from "../src/features/lsp/application/word-completion";
import { LSP_FALLBACK_MESSAGES } from "../src/features/lsp/application/fallback-messages";
import { translator } from "../src/app/i18n";

const C: CommentPair = ["/*", "*/"];
const HTML: CommentPair = ["<!--", "-->"];
const t = translator(LSP_FALLBACK_MESSAGES);

/** `|` marca o cursor; `[` e `]` a selecção. */
function at(marked: string): { text: string; s: number; e: number } {
  const text = marked.replace(/[|[\]]/g, "");
  const caret = marked.indexOf("|");
  if (caret >= 0) return { text, s: caret, e: caret };
  const s = marked.indexOf("["), e = marked.indexOf("]") - 1;
  return { text, s, e };
}
/** O resultado com o cursor/selecção marcados da mesma maneira. */
const mark = (r: { text: string; selStart: number; selEnd: number }): string =>
  r.selStart === r.selEnd ? r.text.slice(0, r.selStart) + "|" + r.text.slice(r.selStart) : r.text.slice(0, r.selStart) + "[" + r.text.slice(r.selStart, r.selEnd) + "]" + r.text.slice(r.selEnd);
const block = (m: string, p: CommentPair = C) => {
  const x = at(m);
  return mark(toggleBlockComment(x.text, x.s, x.e, p));
};
const lines = (m: string, p: CommentPair = C) => {
  const x = at(m);
  return mark(toggleLinesWithBlock(x.text, x.s, x.e, p));
};

describe("palavras do completion", () => {
  it("as palavras do ficheiro, sem a que se está a escrever, com a distância ao cursor", () => {
    const text = "const total = 1;\nconst totalPrice = total + 2;\nlet tot";
    const caret = text.length;
    const hits = collectWords(text, wordRangeAt(text, caret), caret);
    const words = hits.map((h) => h.word).sort();
    expect(words).toEqual(["const", "let", "total", "totalPrice"]);
    expect(words).not.toContain("tot"); // a que se escreve
    expect(hits.find((h) => h.word === "total")!.count).toBe(2);
    // a mais perto do cursor ganha a ordem
    const items = wordItems([{ hits, detail: "word" }]);
    expect(items.map((i) => i.label)).toEqual(["let", "total", "totalPrice", "const"]);
    expect(items[0]).toMatchObject({ kind: 1, detail: "word", insert: "let", snippet: false, edit: null });
  });

  it("nomes com letras acentuadas, `_` e `$`; números e nomes colados a dígitos não contam; curtas e compridas também não", () => {
    const text = `valorTotal _priv $el 0x1fab 3px ab ${"x".repeat(80)} função`;
    expect(collectWords(text, null, null).map((h) => h.word)).toEqual(["valorTotal", "_priv", "$el", "função"]);
  });

  it("o nome no cursor é do início ao fim (o cursor pode estar a meio)", () => {
    expect(wordRangeAt("let fooBar = 1", 6)).toEqual({ start: 4, end: 10 });
    expect(wordRangeAt("a  b", 2)).toEqual({ start: 2, end: 2 });
  });

  it("vários ficheiros: primeiro o aberto, depois os outros; cada palavra uma vez, com o sítio de onde vem", () => {
    const items = wordItems([
      { hits: [{ word: "alpha", distance: 3, count: 1 }], detail: "word" },
      { hits: [{ word: "alpha", distance: 0, count: 1 }, { word: "beta", distance: 9, count: 1 }], detail: "word · b.py" },
    ]);
    expect(items.map((i) => [i.label, i.detail, i.sortText])).toEqual([
      ["alpha", "word", "000000"],
      ["beta", "word · b.py", "000001"],
    ]);
  });

  it("o caso de uso: só abre sozinho com 2+ letras num ficheiro de código; Ctrl+Espaço sempre; os outros separadores da mesma linguagem", () => {
    const files = { key: "src/a.py" as string | null, others: [{ key: "src/a.py", text: "x" }, { key: "src/b.py", text: "def compute_total(): pass" }, { key: "README.md", text: "compute everything" }] };
    const wc = makeWordCompletion({ files: { currentKey: () => files.key, others: () => files.others }, copy: t });
    const text = "def compute(): pass\nco";
    const r = wc.at(text, text.length, false)!;
    expect(r.wordStart).toBe(text.length - 2);
    // as do ficheiro aberto pela distância ao cursor, depois as do outro .py (o README não é Python)
    expect(r.items.map((i) => [i.label, i.detail])).toEqual([["pass", "word"], ["compute", "word"], ["def", "word"], ["compute_total", "word · b.py"]]);
    expect(wc.at("def x\nc", 7, false)).toBeNull(); // 1 letra
    expect(wc.at("def x\nc", 7, true)).not.toBeNull(); // Ctrl+Espaço
    expect(wc.at("x = 3", 5, true)).toBeNull(); // a escrever um número
    files.key = "notes.md";
    expect(wc.at("compute everything\nco", 21, false)).toBeNull(); // texto corrido: só com Ctrl+Espaço
    expect(wc.at("compute everything\nco", 21, true)!.items.map((i) => i.label)).toContain("compute");
    files.key = null; // sem ficheiro conhecido (o Learning Track): só com Ctrl+Espaço
    expect(wc.at("value = 1\nva", 12, false)).toBeNull();
  });
});

describe("Toggle Block Comment (Ctrl+Shift+A)", () => {
  it("envolve a selecção, com um espaço de cada lado, e a selecção fica no texto", () => {
    expect(block("let x = [a + b];")).toBe("let x = /* [a + b] */;");
  });
  it("sem selecção, um comentário vazio com o cursor no meio", () => {
    expect(block("foo(|);")).toBe("foo(/* | */);");
  });
  it("tira o comentário que envolve a selecção, ou onde está o cursor — e o espaço interior com ele", () => {
    expect(block("let x = /* [a + b] */;")).toBe("let x = [a + b];");
    expect(block("let x = [/* a + b */];")).toBe("let x = [a + b];");
    expect(block("let x = /* a |+ b */;")).toBe("let x = a |+ b;");
    expect(block("let x = /*a+b|*/;")).toBe("let x = a+b|;");
  });
  it("é reversível: comentar e descomentar devolve o texto e a selecção", () => {
    const once = toggleBlockComment("call(arg)", 5, 8, C);
    expect(once.text).toBe("call(/* arg */)");
    const back = toggleBlockComment(once.text, once.selStart, once.selEnd, C);
    expect(back).toEqual({ text: "call(arg)", selStart: 5, selEnd: 8 });
  });
  it("várias linhas: a abertura antes da selecção na primeira linha, o fecho depois dela na última", () => {
    expect(block("[a\nb]")).toBe("/* [a\nb] */");
    expect(block("/* [a\nb] */")).toBe("[a\nb]");
  });
  it("o comentário vazio do Ctrl+Shift+A sai com outro Ctrl+Shift+A", () => {
    const once = toggleBlockComment("x", 1, 1, C);
    expect(once.text).toBe("x/*  */");
    expect(toggleBlockComment(once.text, once.selStart, once.selEnd, C)).toEqual({ text: "x", selStart: 1, selEnd: 1 });
  });
  it("aninhados: um fecho a meio quer dizer dois comentários — acrescenta outro à volta (como o VS Code)", () => {
    expect(block("[/* a */ b /* c */]")).toBe("/* [/* a */ b /* c */] */");
    expect(block("[a /* b */ c]")).toBe("/* [a /* b */ c] */");
    // com o cursor dentro do comentário de dentro, é esse que sai
    expect(block("x /* a /* b| */ c */")).toBe("x /* a b| c */");
  });
  it("duas linhas com comentários diferentes não se juntam num só", () => {
    // a selecção vai do fim de um ao início do outro: comenta-se ela, não se tira nenhum
    expect(block("/* a [*/\nb /*] c */")).toBe("/* a /* [*/\nb /*] */ c */");
  });
  it("outros marcadores: HTML, Lua, Haskell", () => {
    expect(block("<p>[hi]</p>", HTML)).toBe("<p><!-- [hi] --></p>");
    expect(block("<p><!-- [hi] --></p>", HTML)).toBe("<p>[hi]</p>");
    expect(block("[print(x)]", ["--[[", "]]"])).toBe("--[[ [print(x)] ]]");
    expect(block("x = {- [1] -} 2", ["{-", "-}"])).toBe("x = [1] 2");
  });
  it("marcadores sem par (só abre, ou só fecha) não contam", () => {
    expect(block("a /* [b]")).toBe("a /* /* [b] */");
    expect(block("[b] */ c")).toBe("/* [b] */ */ c");
    expect(block("*/ a /* |")).toBe("*/ a /* /* | */");
  });
});

describe("Ctrl+/ numa linguagem sem comentário de linha (CSS, HTML, Markdown)", () => {
  it("comenta a linha do cursor (do primeiro carácter ao fim) e o cursor fica no mesmo carácter", () => {
    expect(lines("  color: r|ed;", C)).toBe("  /* color: r|ed; */");
  });
  it("e descomenta, onde quer que esteja o cursor na linha", () => {
    expect(lines("  /* color: r|ed; */", C)).toBe("  color: r|ed;");
    expect(lines("|  /* color: red; */", C)).toBe("|  color: red;");
  });
  it("várias linhas: um só bloco, da primeira à última; uma selecção que acaba no início de uma linha não a inclui", () => {
    expect(lines("<ul>\n  [<li>a</li>\n  <li>b</li>]\n</ul>", HTML)).toBe("<ul>\n  <!-- [<li>a</li>\n  <li>b</li>] -->\n</ul>");
    expect(lines("[a {}\nb {}\n]c {}", C)).toBe("/* [a {}\nb {} */\n]c {}");
    expect(lines("<!-- [a\nb] -->", HTML)).toBe("[a\nb]");
  });
  it("uma linha vazia leva um comentário vazio com o cursor no meio", () => {
    expect(lines("a\n  |\nb", C)).toBe("a\n  /* | */\nb");
  });
  it("é reversível", () => {
    const src = "h1 { margin: 0 }";
    const once = toggleLinesWithBlock(src, 3, 3, C);
    expect(once.text).toBe("/* h1 { margin: 0 } */");
    expect(toggleLinesWithBlock(once.text, once.selStart, once.selEnd, C)).toEqual({ text: src, selStart: 3, selEnd: 3 });
  });
});

describe("«Format Document» sem servidor — só o que é seguro", () => {
  const fmt = (text: string, language: string | null = "typescript", path = "a.ts") => safeFormat(text, { language, path });

  it("o estilo de indentação do ficheiro: tabs ou espaços (e a largura de um nível)", () => {
    expect(detectIndent(["a", "  b", "    c", "  d"])).toEqual({ kind: "spaces", size: 2 });
    expect(detectIndent(["a", "    b", "        c", "\td"])).toEqual({ kind: "spaces", size: 4 });
    expect(detectIndent(["a", "\tb", "\t\tc", "    d"])).toEqual({ kind: "tabs", size: 4 });
    expect(detectIndent(["a", "b"])).toBeNull();
    expect(detectIndent(["\ta", "  b"])).toBeNull(); // empate: sem estilo
    // ` * ` de um comentário (subida de 1) não é um nível
    expect(detectIndent(["/**", " * x", " */", "f() {", "  y", "}"])).toEqual({ kind: "spaces", size: 2 });
  });

  it("espaços no fim, a quebra final e as linhas vazias a mais no fim; o relatório diz o quê", () => {
    const r = fmt("const a = 1;   \nlet b;\t\n\n\n");
    expect(r.text).toBe("const a = 1;\nlet b;\n");
    expect(r).toMatchObject({ changed: true, trimmed: 2, reindented: 0, finalNewline: "trimmed" });
    expect(fmt("x").text).toBe("x\n");
    expect(fmt("x").finalNewline).toBe("added");
    expect(fmt("x\n")).toMatchObject({ changed: false, finalNewline: null });
    expect(fmt("")).toMatchObject({ text: "", changed: false });
    expect(fmt("  \n\n")).toMatchObject({ text: "", changed: true, finalNewline: "trimmed" });
  });

  it("re-indenta no estilo do PRÓPRIO ficheiro: um tab num ficheiro de espaços, espaços num ficheiro de tabs (o alinhamento fica)", () => {
    const spaces = fmt("f() {\n  a();\n\tb();\n  if (x) {\n    c();\n  }\n}\n");
    expect(spaces.text).toBe("f() {\n  a();\n  b();\n  if (x) {\n    c();\n  }\n}\n");
    expect(spaces).toMatchObject({ reindented: 1, indent: { kind: "spaces", size: 2 } });
    const tabs = fmt("func f() {\n\ta()\n\tb(x,\n\t  y)\n    c()\n\t\td()\n}\n", "go", "a.go");
    expect(tabs.text).toBe("func f() {\n\ta()\n\tb(x,\n\t  y)\n\tc()\n\t\td()\n}\n");
    expect(tabs).toMatchObject({ reindented: 1, indent: { kind: "tabs", size: 4 } });
    // nunca muda nada a meio de uma linha nem parte/junta linhas
    const src = "x  =  [1,2,   3];   \n\tlong_call(a,b)";
    const out = fmt(src).text.replace(/\n$/, "").split("\n");
    expect(out.length).toBe(src.split("\n").length);
    expect(out[0]).toBe("x  =  [1,2,   3];");
  });

  it("sem estilo dominante, a indentação fica", () => {
    expect(fmt("a\n\tb\n  c\n").text).toBe("a\n\tb\n  c\n");
  });

  it("CRLF fica CRLF", () => {
    expect(fmt("a  \r\nb\r\n\r\n").text).toBe("a\r\nb\r\n");
    expect(fmt("a\r\nb").text).toBe("a\r\nb\r\n");
  });

  it("onde o espaço é sintaxe não mexe: Markdown (espaços no fim), Makefile/shell/YAML/Haskell (indentação), .diff/.patch (nada)", () => {
    const md = fmt("linha com quebra  \nseguinte\n\n\n", "markdown", "README.md");
    expect(md.text).toBe("linha com quebra  \nseguinte\n");
    expect(md).toMatchObject({ trimmed: 0, keptTrailing: 1, finalNewline: "trimmed" });
    const mk = fmt("all:\n\tcc a.c\n\tcc b.c\nifeq ($(X),1)\n    Y := 2\nendif\n", "makefile", "Makefile");
    expect(mk.text).toBe("all:\n\tcc a.c\n\tcc b.c\nifeq ($(X),1)\n    Y := 2\nendif\n");
    expect(mk).toMatchObject({ reindented: 0, keptIndent: 1 });
    const sh = fmt("f() {\n  cat <<-EOF\n\thello\n\tEOF\n}\n", "shellscript", "a.sh");
    expect(sh.text).toBe("f() {\n  cat <<-EOF\n\thello\n\tEOF\n}\n");
    expect(fmt("+a  \n-b\n", null, "fix.patch")).toMatchObject({ text: "+a  \n-b\n", changed: false, untouched: true });
  });

  it("a frase do aviso diz o que mudou, o que ficou e porquê — em en e em ptAO", () => {
    const r = fmt("f() {\n  a();  \n  c();\n\tb();\n}");
    expect(describeSafeFormat(r, "TypeScript", t)).toBe(
      "Formatted without a language server: trailing spaces removed on 1 line; 1 line re-indented with 2 spaces, like the rest of the file; final newline added",
    );
    expect(describeSafeFormat(fmt("ok\n"), "TypeScript", t)).toBe("Already formatted — without a language server only whitespace is tidied");
    expect(formatWithoutServer("Makefile", "all:\n\tcc\n    X=1\n\tld\n", t).message).toBe("Nothing to change without a language server: indentation kept on 1 lines (Makefile: indentation is syntax)");
    expect(formatWithoutServer("x.diff", "a  \n", t)).toMatchObject({ changed: false, message: "A .diff or .patch file is left as it is" });
    const w = window as unknown as { LOCALE?: string };
    w.LOCALE = "ptAO";
    try {
      expect(describeSafeFormat(fmt("a  \nb  \n"), "TypeScript", t)).toBe("Formatado sem servidor de linguagem: tirados os espaços no fim de 2 linhas");
    } finally {
      w.LOCALE = "en";
    }
  });
});
