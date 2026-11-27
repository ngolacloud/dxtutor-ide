// LSP P5 — as gramáticas TextMate que vêm com o dxtutor: o manifesto (ficheiro exacto, sha256, licença), o
// tokenizador «lite» num excerto real de cada linguagem, e o realce incremental (o mesmo resultado que o
// documento inteiro, só com as linhas que mudaram).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GRAMMAR_MANIFEST, bundledGrammarFor } from "../src/features/lsp/domain/grammars";
import { languageById } from "../src/features/lsp/domain/registry";
import { bundledGrammarFiles } from "../src/features/lsp/infrastructure/grammars";
import { makeFallbackHighlighter } from "../src/features/lsp/application/fallback-highlight";
import { highlightLines, loadGrammar, type RawGrammar } from "../src/features/ext/domain/textmate";

const DIR = resolve(__dirname, "../../languages/grammars");
const raw = (file: string): RawGrammar => JSON.parse(readFileSync(resolve(DIR, file), "utf8")) as RawGrammar;

/** As classes de cada pedaço realçado de uma linha: `[[texto, classe], …]` (sem os pedaços sem classe). */
function spans(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /<span class="(\w+)">([^<]*)<\/span>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push([m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), m[1]]);
  return out;
}
const classOf = (lineHtml: string, text: string): string | undefined => spans(lineHtml).find(([t]) => t === text)?.[1];

describe("o manifesto das gramáticas", () => {
  it("cada ficheiro é o fixado: o mesmo sha256 e tamanho, o scopeName, uma linguagem do registo, e um import()", () => {
    expect(GRAMMAR_MANIFEST.source.commit).toMatch(/^[0-9a-f]{40}$/);
    for (const g of GRAMMAR_MANIFEST.grammars) {
      const bytes = readFileSync(resolve(DIR, g.file));
      expect(createHash("sha256").update(bytes).digest("hex"), g.file).toBe(g.sha256);
      expect(bytes.length, g.file).toBe(g.bytes);
      expect(raw(g.file).scopeName).toBe(g.scopeName);
      expect(languageById(g.language), g.language).not.toBeNull();
      expect(["MIT", "Apache-2.0"]).toContain(g.license);
    }
    expect(bundledGrammarFiles.files().sort()).toEqual(GRAMMAR_MANIFEST.grammars.map((g) => g.file).sort());
  });

  it("pequeno de propósito: duas gramáticas, ~100 KB, cada uma com o seu aviso de licença", () => {
    const total = GRAMMAR_MANIFEST.grammars.reduce((n, g) => n + g.bytes, 0);
    expect(total).toBeLessThan(150_000);
    const notices = readFileSync(resolve(DIR, "THIRD-PARTY-NOTICES.md"), "utf8");
    for (const g of GRAMMAR_MANIFEST.grammars) {
      expect(notices).toContain(g.file);
      expect(notices).toContain(g.upstreamCommit);
    }
    expect(notices).toContain("Copyright (c) 2015-present MagicStack Inc.");
    expect(notices).toContain("Apache License");
    expect(notices).toContain("Copyright (c) 2015 - present Microsoft Corporation");
  });

  it("a gramática de uma linguagem do registo (e nenhuma para as que o tokenizador não faz bem)", () => {
    expect(bundledGrammarFor("python")?.file).toBe("python.tmLanguage.json");
    expect(bundledGrammarFor("dockerfile")?.file).toBe("dockerfile.tmLanguage.json");
    for (const left of ["go", "java", "c", "cpp", "csharp", "swift", "shellscript", "makefile", "ruby", "lua", "rust", "typescript"]) expect(bundledGrammarFor(left)).toBeNull();
    expect(bundledGrammarFor(null)).toBeNull();
  });

  it("o adaptador carrega o JSON pelo import() (e nada para um ficheiro que não conhece)", async () => {
    expect((await bundledGrammarFiles.load("dockerfile.tmLanguage.json"))?.scopeName).toBe("source.dockerfile");
    expect(await bundledGrammarFiles.load("nope.tmLanguage.json")).toBeNull();
  });
});

describe("o tokenizador «lite» num excerto real", () => {
  it("Python (MagicPython): palavras-chave, strings (f-strings), comentários, números, constantes, builtins, decoradores fora", () => {
    const src = [
      "import os",
      "from typing import List",
      "",
      "class Point(Base):",
      "    def dist(self, other: \"Point\") -> float:",
      "        # squared distance",
      "        x = f\"{self.x:>4} and {other!r}\"",
      "        return (self.x - other.x) ** 2 + 0x1F + 3.5e-2",
      "async def main():",
      "    await run(None, True, 'single')",
      "    print(len(os.environ))",
    ];
    const html = highlightLines(loadGrammar(raw("python.tmLanguage.json")), src);
    expect(classOf(html[0], "import")).toBe("kw");
    expect(classOf(html[3], "class")).toBe("kw");
    expect(classOf(html[4], "def")).toBe("kw");
    expect(classOf(html[4], "self")).toBe("kw"); // variable.language
    expect(classOf(html[4], "Point")).toBe("str");
    expect(classOf(html[4], "float")).toBe("ty");
    expect(classOf(html[5], " squared distance")).toBe("cm");
    expect(classOf(html[6], " and ")).toBe("str");
    expect(classOf(html[7], "return")).toBe("kw");
    expect(classOf(html[7], "2")).toBe("num");
    expect(classOf(html[7], "3.5e-2")).toBe("num");
    expect(classOf(html[8], "async def")).toBe("kw");
    expect(classOf(html[9], "None")).toBe("num");
    expect(classOf(html[9], "True")).toBe("num");
    expect(classOf(html[9], "single")).toBe("str");
    expect(classOf(html[10], "print")).toBe("fn");
    // nada fica aberto de uma linha para a seguinte: a última linha começa como a primeira
    expect(html.every((h) => !h.includes("undefined"))).toBe(true);
  });

  it("Dockerfile: instruções, comentários, strings, e o resto das linhas sem realce a mais", () => {
    const src = [
      "# syntax=docker/dockerfile:1",
      "FROM node:20-alpine AS build",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci && \\",
      "    npm run build",
      "ENV PORT=8080 NODE_ENV=\"production\"",
      "CMD [\"node\", \"dist/index.js\"]",
    ];
    const html = highlightLines(loadGrammar(raw("dockerfile.tmLanguage.json")), src);
    expect(classOf(html[0], " syntax=docker/dockerfile:1")).toBe("cm");
    expect(classOf(html[1], "FROM")).toBe("kw");
    expect(classOf(html[1], "AS")).toBe("kw");
    expect(classOf(html[2], "WORKDIR")).toBe("kw");
    expect(classOf(html[4], "RUN")).toBe("kw");
    expect(spans(html[5])).toEqual([]); // a continuação é só texto
    expect(classOf(html[6], "\"production\"")).toBe("str");
    expect(classOf(html[7], "CMD")).toBe("kw");
    expect(classOf(html[7], "\"node\"")).toBe("str");
  });
});

describe("o realce incremental", () => {
  const PY = readFileSync(resolve(__dirname, "../../scripts/sync-ui-courses.py"), "utf8").split("\n");
  const full = (lines: readonly string[]) => highlightLines(loadGrammar(raw("python.tmLanguage.json")), [...lines]);
  /** Um realçador com a gramática do Python e um `defer` à mão (os pedaços correm quando se pede). */
  function setup(o: { budget?: number; chunk?: number; maxDocs?: number } = {}) {
    const queue: Array<() => void> = [];
    let loads = 0;
    const h = makeFallbackHighlighter({
      files: { load: async (f) => (loads++, f === "python.tmLanguage.json" ? raw(f) : null) },
      defer: (f) => queue.push(f),
      ...o,
    });
    const drain = () => {
      while (queue.length) queue.shift()!();
    };
    return { h, queue, drain, loads: () => loads };
  }

  it("a primeira vez carrega a gramática e pede para repintar; depois dá o mesmo que o documento inteiro", async () => {
    const { h, loads } = setup();
    let repaints = 0;
    expect(h.highlight("a.py", PY, () => repaints++)).toBeNull();
    await h.idle();
    expect(repaints).toBe(1);
    expect(h.highlight("a.py", PY, () => repaints++)).toEqual(full(PY));
    expect(loads()).toBe(1);
    // uma linguagem sem gramática do dxtutor, ou que não carregou: nada (o editor usa o realce de sempre)
    expect(h.highlight("a.rs", ["fn main() {}"], () => {})).toBeNull();
  });

  it("um ficheiro sem extensão pelo nome (Dockerfile) ou pelo shebang (python)", async () => {
    const { h } = setup();
    h.highlight("bin/tool", ["#!/usr/bin/env python3", "x = 1"], () => {});
    await h.idle();
    expect(h.highlight("bin/tool", ["#!/usr/bin/env python3", "x = 1"], () => {})).toEqual(full(["#!/usr/bin/env python3", "x = 1"]));
  });

  it("depois de cada edição (mudar, inserir, apagar linhas; abrir uma string de várias linhas), o mesmo que realçar tudo de novo", async () => {
    const { h, drain } = setup({ budget: 10_000 });
    h.highlight("a.py", PY, () => {});
    await h.idle();
    let doc = [...PY];
    const steps: Array<(d: string[]) => void> = [
      (d) => (d[10] = d[10] + "  # edited"),
      (d) => d.splice(5, 0, "import re", "x = 'a'"),
      (d) => d.splice(20, 3),
      (d) => (d[2] = 'S = """open a docstring'), // todo o resto passa a string…
      (d) => (d[2] = "S = 1"), // …e volta
      (d) => d.splice(d.length - 1, 0, "def tail():", "    return None"),
    ];
    for (const step of steps) {
      step(doc);
      doc = [...doc];
      expect(h.highlight("a.py", doc, () => {})).toEqual(full(doc));
      drain();
    }
  });

  it("um documento grande: só `budget` linhas de uma vez; o resto em pedaços e um repaint no fim; as por fazer ficam com o realce antigo", async () => {
    const big = Array.from({ length: 12 }, () => PY).flat();
    const { h, queue, drain } = setup({ budget: 50, chunk: 100 });
    h.highlight("big.py", big, () => {});
    await Promise.resolve();
    await Promise.resolve();
    let repaints = 0;
    const first = h.highlight("big.py", big, () => repaints++)!;
    expect(first.slice(0, 50)).toEqual(full(big.slice(0, 50)));
    expect(first[60]).toBeUndefined(); // ainda por fazer (o editor usa o realce de sempre)
    expect(queue.length).toBe(1);
    drain();
    expect(repaints).toBe(1);
    expect(h.highlight("big.py", big, () => {})).toEqual(full(big));
    // uma tecla no meio: só essa linha (e as seguintes até o estado bater) volta a ser tokenizada
    const edited = [...big];
    edited[300] = edited[300] + "x";
    const after = h.highlight("big.py", edited, () => {})!;
    expect(after).toEqual(full(edited));
    expect(queue.length).toBe(0);
    // abrir uma string de várias linhas no início muda tudo: o que não coube no budget mostra o realce antigo
    // (da mesma linha, deslocada pela que entrou) até ficar feito
    const opened = [...edited];
    opened.splice(1, 0, "x = '''");
    const partial = h.highlight("big.py", opened, () => repaints++)!;
    expect(partial.slice(0, 51)).toEqual(full(opened).slice(0, 51));
    expect(partial[401]).toBe(after[400]);
    expect(partial[401]).not.toBe(full(opened)[401]);
    drain();
    expect(repaints).toBe(2);
    expect(h.highlight("big.py", opened, () => {})).toEqual(full(opened));
  });

  it("guarda no máximo `maxDocs` ficheiros; um que saiu volta a ser feito (e um pedaço de um que saiu não pinta nada)", async () => {
    const { h, queue } = setup({ maxDocs: 2, budget: 5, chunk: 5 });
    h.highlight("a.py", PY, () => {});
    await h.idle();
    let painted = 0;
    h.highlight("a.py", PY, () => painted++); // agenda o resto de a.py
    h.highlight("b.py", ["x = 1"], () => {});
    h.highlight("c.py", ["y = 2"], () => {}); // a.py sai
    while (queue.length) queue.shift()!();
    expect(painted).toBe(0);
    expect(h.highlight("a.py", ["z = 3"], () => {})).toEqual(full(["z = 3"]));
  });
});
