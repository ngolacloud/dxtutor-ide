// LSP P4: as contribuições de um VSIX alimentam o editor e o LSP — com VSIX reais em miniatura
// (`fixtures/vsix`): as linguagens (`filenames`, `filenamePatterns`, `aliases`, `firstLine`), as gramáticas em plist
// XML, o registo de linguagens por cima (ganha sempre, e diz-se), o servidor que a extensão escolhe pelo
// `vscodeExtensions` + `vscodeLanguages`, e o que sai ao desinstalar.
import { afterEach, describe, expect, test } from "vitest";
import { parsePlist, looksLikeXml } from "../src/features/ext/domain/plist";
import { highlightLines, loadGrammar, type RawGrammar } from "../src/features/ext/domain/textmate";
import {
  contributedLanguages,
  languageConflicts,
  languagesOf,
  toggleBlockComment,
  type ExtensionContributions,
} from "../src/features/ext/domain/contributions";
import { makeContribEngine } from "../src/features/ext/application/contributions-engine";
import {
  REGISTRY,
  contributedServerOf,
  languageFor,
  languageForName,
  useContributed,
  useRegistry,
  type ContributedLanguage,
} from "../src/features/lsp/domain/registry";
import { globRegex, patternMatches } from "../src/features/lsp/domain/glob";
import { languageIdFor } from "../src/features/lsp/domain/languages";
import { makeContributionsSync } from "../src/features/lsp/application/contributions";
import { vsixFile, vsixManifest, vsixZip, type VsixId } from "./fixtures/vsix";

afterEach(() => {
  useContributed(() => []);
  useRegistry(null);
});

function engine(active: (id: string) => boolean = () => true) {
  let saved: ExtensionContributions[] = [];
  let changes = 0;
  const contrib = makeContribEngine({
    store: { load: () => saved, save: (all) => ((saved = all), true) },
    style: { set: () => {} },
    prefs: { get: () => null, set: () => {} },
    active,
    onChange: () => changes++,
  });
  return { contrib, changes: () => changes };
}

async function install(contrib: ReturnType<typeof engine>["contrib"], id: VsixId) {
  const m = vsixManifest(id);
  const c = await contrib.readFromVsix(vsixZip(id), `${m.publisher}.${m.name}`.toLowerCase(), m.contributes as never);
  contrib.install(c);
  return c;
}

/** O registo com as linguagens destes VSIX por baixo. */
async function withVsix(...ids: VsixId[]) {
  const e = engine();
  for (const id of ids) await install(e.contrib, id);
  useContributed(() => e.contrib.languages());
  return e;
}

describe("property lists XML (as gramáticas .tmLanguage)", () => {
  test("todos os tipos, entidades, CDATA, comentários e DOCTYPE; o texto das strings fica como está", () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- um comentário -->
<plist version="1.0">
<dict>
  <key>name</key><string>A &amp; B &lt;x&gt; &#65;&#x42; &quot;q&quot; &apos;</string>
  <key>regex</key><string>(?x)
    ^\\s* # comentário
  </string>
  <key>cdata</key><string><![CDATA[<b> & ]]>fim</string>
  <key>n</key><integer>-3</integer>
  <key>r</key><real>1.5</real>
  <key>yes</key><true/>
  <key>no</key><false/>
  <key>empty</key><string/>
  <key>list</key><array><string>a</string><!-- x --><dict/><array/></array>
  <key>d</key><date>2024-01-01T00:00:00Z</date>
  <key>bin</key><data> AAEC
    Aw== </data>
</dict>
</plist>`;
    expect(looksLikeXml(xml)).toBe(true);
    expect(looksLikeXml('{ "a": 1 }')).toBe(false);
    expect(parsePlist(xml)).toEqual({
      name: `A & B <x> AB "q" '`,
      regex: "(?x)\n    ^\\s* # comentário\n  ",
      cdata: "<b> & fim",
      n: -3,
      r: 1.5,
      yes: true,
      no: false,
      empty: "",
      list: ["a", {}, []],
      d: "2024-01-01T00:00:00Z",
      bin: "AAECAw==",
    });
  });

  test("um documento mal formado dá um erro com a linha", () => {
    expect(() => parsePlist("<plist><dict><key>a</key></dict></plist>")).toThrow(/without a value/);
    expect(() => parsePlist("<plist><dict><string>a</string></dict></plist>")).toThrow(/expected <key>/);
    expect(() => parsePlist("<plist>\n<dict>\n<key>a</key><string>x</dict></plist>")).toThrow(/expected <\/string> \(line 3\)/);
    expect(() => parsePlist("<plist><integer>x</integer></plist>")).toThrow(/not a number/);
    expect(() => parsePlist("<plist><string>&nope;</string></plist>")).toThrow(/unknown entity/);
    expect(() => parsePlist("<plist><foo/></plist>")).toThrow(/unknown element <foo>/);
    expect(() => parsePlist("<plist><true/></plist> lixo")).toThrow(/text after/);
  });

  test("a gramática real do Apache (mrmlnc.vscode-apache) lê-se e realça uma linha", () => {
    const g = parsePlist(vsixFile("mrmlnc.vscode-apache", "extension/syntaxes/Apache.tmLanguage")) as RawGrammar & { name: string };
    expect(g.scopeName).toBe("source.apacheconf");
    expect(g.name).toBe("Apache Conf");
    expect(Array.isArray(g.patterns) && g.patterns.length).toBeGreaterThan(10);
    const html = highlightLines(loadGrammar(g), ["# comentário", '<VirtualHost *:80>', "  ServerName example.com"]);
    expect(html[0]).toBe('<span class="cm"># comentário</span>');
    expect(html[1]).toContain("VirtualHost");
    expect(html[1]).toContain("<span");
  });
});

describe("as linguagens do package.json", () => {
  test("Apache: aliases e extensões sem o ponto; ms-python: padrões com espaços e linguagens do registo", () => {
    const apache = languagesOf(vsixManifest("mrmlnc.vscode-apache").contributes as never);
    expect(apache).toEqual([
      {
        id: "apacheconf",
        aliases: ["Apache", "apache"],
        extensions: ["conf", ".conf", "htaccess", ".htaccess", "htgroups", ".htgroups", "htpasswd", ".htpasswd"],
        filenames: [],
        filenamePatterns: [],
      },
    ]);
    const py = languagesOf(vsixManifest("ms-python.python").contributes as never);
    expect(py.map((l) => l.id)).toEqual(["jinja", "pip-requirements", "yaml", "ini", "toml", "json"]);
    expect(py[1].filenamePatterns).toContain("**/*requirements*.{txt, in}");
  });

  test("entradas com o mesmo id juntam-se; só texto passa", () => {
    const l = languagesOf({
      languages: [
        { id: "x", extensions: [".x", 3 as never], aliases: ["X"] },
        { id: "x", filenames: ["Xfile"], firstLine: "^#!x" },
        { extensions: [".nada"] },
      ],
    });
    expect(l).toEqual([{ id: "x", extensions: [".x"], filenames: ["Xfile"], filenamePatterns: [], aliases: ["X"], firstLine: "^#!x" }]);
  });

  test("juntadas por id entre extensões: o primeiro alias é o nome, o comentário vem do language-configuration", () => {
    const merged = contributedLanguages([
      { id: "a.one", languages: [{ id: "x", extensions: [".x"] }], grammars: [], themes: [], snippets: [], configs: [{ language: "x", config: { lineComment: ";" } }], warnings: [] },
      { id: "b.two", languages: [{ id: "x", extensions: ["X", ".y"], aliases: ["Ex"] }], grammars: [], themes: [], snippets: [], configs: [], warnings: [] },
    ]);
    expect(merged).toEqual([
      { id: "x", name: "Ex", extensions: [".x", ".y"], filenames: [], filenamePatterns: [], lineComment: ";", from: ["a.one", "b.two"] },
    ]);
  });
});

describe("o registo de linguagens com as linguagens dos VSIX por baixo", () => {
  test("Apache (só do VSIX): o nome inteiro, a extensão sem ponto, a barra de estado e o comentário", async () => {
    await withVsix("mrmlnc.vscode-apache");
    for (const f of ["site/.htaccess", "/etc/httpd/httpd.CONF", "x/.htpasswd"]) expect(languageFor(f)?.id, f).toBe("apacheconf");
    const l = languageFor("site/.htaccess")!;
    expect(l).toMatchObject({ name: "Apache", lineComment: "#", lspLanguageId: "apacheconf", contributedBy: ["mrmlnc.vscode-apache"] });
    expect(l.server).toBeUndefined();
    expect(languageIdFor("site/.htaccess")).toBeNull(); // sem servidor no registo: o LSP não o abre
  });

  test("Perl: a primeira linha (só quando o nome não diz nada), e a do registo primeiro", async () => {
    await withVsix("vscode.perl");
    expect(languageFor("bin/tool", "#!/usr/bin/env perl\nprint 1;")?.name).toBe("Perl");
    expect(languageFor("bin/run", "#!/bin/bash")?.id).toBe("shellscript");
    expect(languageFor("lib/A.pm")?.id).toBe("perl");
    expect(languageFor("a.py", "#!/usr/bin/env perl")?.id).toBe("python");
  });

  test("Go: o gopls para go.mod/go.sum/go.work (vscodeLanguages), não para go.asm; o `go` do VSIX É o do registo", async () => {
    await withVsix("golang.go");
    for (const f of ["svc/go.mod", "svc/GO.SUM", "go.work"]) {
      const l = languageFor(f)!;
      expect(l.server, f).toBe("go");
      expect(languageIdFor(f), f).toBe(l.id); // o id do VSIX é o languageId do LSP
    }
    expect(languageFor("svc/go.mod")?.name).toBe("Go Module File");
    expect(languageFor("x/asm_amd64.s")?.id).toBe("go.asm");
    expect(languageIdFor("x/asm_amd64.s")).toBeNull();
    expect(languageFor("main.go")).toBe(REGISTRY.languages.find((l) => l.id === "go"));
  });

  test("ms-python: requirements são pip-requirements sem servidor (o pyright não os lê); yaml/toml/json do VSIX são os do registo", async () => {
    await withVsix("ms-python.python");
    for (const f of ["requirements.txt", "app/dev-requirements.in", "requirements/base.txt", "x/constraints/a.txt"]) {
      expect(languageFor(f)?.id, f).toBe("pip-requirements");
      expect(languageIdFor(f), f).toBeNull();
    }
    expect(languageFor(".condarc")?.id).toBe("yaml");
    expect(languageFor("Pipfile")?.name).toBe("TOML");
    expect(languageFor("Pipfile.lock")?.id).toBe("json");
    expect(languageFor("notes.txt")).toBeNull();
  });

  test("um override que tira o servidor ao Go tira-o também ao go.mod", async () => {
    await withVsix("golang.go");
    useRegistry({ ...REGISTRY, languages: REGISTRY.languages.map((l) => (l.id === "go" ? { ...l, server: undefined } : l)) });
    expect(languageFor("go.mod")?.server).toBeUndefined();
  });

  test("o registo ganha os conflitos, e a extensão diz quais", () => {
    const c: ExtensionContributions = {
      id: "acme.objc",
      languages: [
        { id: "objective-c", extensions: [".h", "m"], filenames: ["Makefile"], filenamePatterns: ["**/inc/*.h", "*.{h,mm}"] },
        { id: "go", extensions: [".go"] },
      ],
      grammars: [], themes: [], snippets: [], configs: [], warnings: [],
    };
    useContributed(() => contributedLanguages([c]));
    expect(languageForName("a.h")?.id).toBe("cpp");
    expect(languageForName("Makefile")?.id).toBe("makefile");
    expect(languageForName("a.m")?.id).toBe("objective-c");
    expect(languageConflicts(c)).toEqual([
      { language: "objective-c", claim: ".h", kept: "C++" },
      { language: "objective-c", claim: "Makefile", kept: "Makefile" },
      { language: "objective-c", claim: "**/inc/*.h", kept: "C++" },
    ]);
  });

  test("a extensão escolhe o servidor só com vscodeExtensions E vscodeLanguages", () => {
    const lang = (from: string): ContributedLanguage => ({ id: "go.mod", name: "go.mod", extensions: [], filenames: ["go.mod"], filenamePatterns: [], from: [from] });
    expect(contributedServerOf(lang("golang.go"))?.label).toBe("gopls");
    expect(contributedServerOf(lang("someone.go-mod-syntax"))).toBeNull();
    expect(contributedServerOf({ ...lang("golang.go"), id: "go.asm" })).toBeNull();
  });
});

describe("globs (os mesmos casos do backend, tutor_eval::langcontrib::globs)", () => {
  test("padrões do VS Code", () => {
    const m = patternMatches;
    expect(m("**/*requirements*.{txt, in}", "/w/dev-requirements.in")).toBe(true);
    expect(m("**/*requirements*.{txt, in}", "requirements.txt")).toBe(true);
    expect(m("**/*requirements*.{txt, in}", "/w/requirements.md")).toBe(false);
    expect(m("**/.github/workflows/*.yml", "/p/.github/workflows/ci.yml")).toBe(true);
    expect(m("**/.github/workflows/*.yml", "/p/.github/workflows/sub/ci.yml")).toBe(false);
    expect(m("*.conf", "/etc/a.conf")).toBe(true);
    expect(m("Jenkinsfile*", "C:\\w\\Jenkinsfile.prod")).toBe(true);
    expect(m("file?.[ch]", "/w/file1.c")).toBe(true);
    expect(m("file?.[!ch]", "/w/file1.c")).toBe(false);
    expect(m("a.(x)+", "/w/a.(x)+")).toBe(true);
    expect(globRegex("{a,b")).toBeNull();
  });
});

describe("o motor das contribuições com VSIX reais", () => {
  test("Apache: a gramática plist instala-se e realça pela linguagem; o comentário vem do language-configuration", async () => {
    const { contrib } = engine();
    const c = await install(contrib, "mrmlnc.vscode-apache");
    expect(c.warnings).toEqual([]);
    expect(c.grammars.map((g) => [g.language, g.scopeName])).toEqual([["apacheconf", "source.apacheconf"]]);
    expect(contrib.highlight("apacheconf", ["# x"])).toEqual(['<span class="cm"># x</span>']);
    expect(contrib.lineCommentFor("apacheconf")).toBe("#");
    expect(contrib.languages().map((l) => [l.id, l.name, l.lineComment])).toEqual([["apacheconf", "Apache", "#"]]);
  });

  test("Perl: a gramática JSON real realça e a primeira linha fica guardada", async () => {
    const { contrib } = engine();
    const c = await install(contrib, "vscode.perl");
    expect(c.warnings).toEqual([]);
    expect(c.languages[0]).toMatchObject({ id: "perl", firstLine: "^#!.*\\bperl\\b", aliases: ["Perl", "perl"] });
    // (sem comentários no fim da linha: o comentário do Perl acaba num `\n` e num `(?!\G)`, que o TextMate «lite»
    // ainda não trata — o comentário continuaria nas linhas seguintes; limitação do tokenizador, não da leitura)
    const html = contrib.highlight("perl", ["my $x = 1;", 'print "ok";'])!;
    expect(html[0]).toBe('<span class="kw">my</span> $x = 1;');
    expect(html[1]).toContain('<span class="str">');
  });

  test("Go: gramáticas JSON partilhadas por duas linguagens; remover e desligar tiram tudo e avisam", async () => {
    let on = true;
    const e = engine((id) => id !== "golang.go" || on);
    await install(e.contrib, "golang.go");
    expect(e.changes()).toBe(1);
    expect(e.contrib.languages().map((l) => l.id)).toEqual(["go", "go.asm", "go.mod", "go.work", "go.sum", "gotmpl"]);
    expect(e.contrib.highlight("go.work", ["go 1.22"])).not.toBeNull();
    expect(e.contrib.lineCommentFor("go.mod")).toBe("//");
    on = false;
    e.contrib.refresh();
    expect(e.changes()).toBe(2);
    expect(e.contrib.languages()).toEqual([]);
    expect(e.contrib.highlight("go.mod", ["module x"])).toBeNull();
    on = true;
    e.contrib.refresh();
    expect(e.contrib.languages()).toHaveLength(6);
    e.contrib.remove("golang.go");
    expect(e.changes()).toBe(4);
    expect(e.contrib.languages()).toEqual([]);
    expect(e.contrib.lineCommentFor("go.mod")).toBeNull();
  });

  test("uma gramática que não é TextMate dá um aviso, não rebenta", async () => {
    const { contrib } = engine();
    const files: Record<string, string> = { "extension/g.json": '{ "nada": 1 }', "extension/g.plist": "<plist><dict><key>a</key>" };
    const zip = { file: (p: string) => (p in files ? { async: async () => files[p] } : null) };
    const c = await contrib.readFromVsix(zip, "a.b", {
      languages: [{ id: "q" }],
      grammars: [{ language: "q", path: "./g.json" }, { language: "q", path: "./g.plist" }],
    });
    expect(c.grammars).toEqual([]);
    expect(c.warnings.join("\n")).toMatch(/g\.json: not a TextMate grammar/);
    expect(c.warnings.join("\n")).toMatch(/g\.plist: plist:/);
  });
});

describe("comentário de bloco (uma linguagem sem comentário de linha)", () => {
  test("põe e tira os marcadores à volta das linhas tocadas", () => {
    const t = "<p>\n  <b>x</b>\n</p>";
    const on = toggleBlockComment(t, t.indexOf("<b>"), t.indexOf("<b>"), ["<!--", "-->"]);
    expect(on.text).toBe("<p>\n  <!-- <b>x</b> -->\n</p>");
    const off = toggleBlockComment(on.text, on.selStart, on.selEnd, ["<!--", "-->"]);
    expect(off.text).toBe(t);
    expect(toggleBlockComment("\n\n", 0, 0, ["/*", "*/"]).text).toBe("\n\n");
  });
});

describe("as linguagens no backend (lsp_contributions)", () => {
  test("só vão quando mudaram; um envio que falha repete-se", async () => {
    let langs: ContributedLanguage[] = [];
    const sent: unknown[] = [];
    let fail = false;
    const s = makeContributionsSync({
      languages: () => langs,
      send: async (l) => {
        if (fail) throw new Error("x");
        sent.push(l);
      },
    });
    await s.sync();
    await s.sync();
    expect(sent).toEqual([[]]);
    langs = [{ id: "go.mod", name: "Go Module File", extensions: [], filenames: ["go.mod"], filenamePatterns: [], from: ["golang.go"] }];
    fail = true;
    await expect(s.sync()).rejects.toThrow();
    fail = false;
    await s.sync();
    await s.sync();
    expect(sent).toHaveLength(2);
  });
});
