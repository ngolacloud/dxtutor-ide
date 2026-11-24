// Fase 4 (ADR-0005): o motor das contribuições, de ponta a ponta, com um VSIX em memória —
// lê tema (com include), gramática, snippets e language-configuration; guarda; serve ao
// editor realce, snippets, comentário e o tema activo.
import { describe, test, expect } from "vitest";
import { makeContribEngine } from "../src/features/ext/application/contributions-engine";
import { makeExtEngine } from "../src/features/ext/application/ext-engine";
import type { ExtensionContributions } from "../src/features/ext/domain/contributions";
import type { ExsState } from "../src/features/ext/domain/types";

const FILES: Record<string, string> = {
  "extension/package.json": JSON.stringify({
    publisher: "acme",
    name: "demo-lang",
    displayName: "Demo Lang",
    version: "1.2.0",
    contributes: {
      languages: [{ id: "demo", extensions: [".dm"], configuration: "./language-configuration.json" }],
      grammars: [
        { language: "demo", scopeName: "source.demo", path: "./syntaxes/demo.tmLanguage.json" },
        { language: "other", scopeName: "source.other", path: "./syntaxes/other.tmLanguage" },
      ],
      themes: [{ label: "Demo Night", uiTheme: "vs-dark", path: "./themes/night.json" }],
      snippets: [{ language: "demo", path: "./snippets/demo.json" }, { language: "demo", path: "./snippets/missing.json" }],
      commands: [{ command: "demo.run", title: "Run", category: "Demo" }],
    },
  }),
  "extension/language-configuration.json": `{ // JSONC
    "comments": { "lineComment": ";;" },
  }`,
  "extension/syntaxes/demo.tmLanguage.json": JSON.stringify({
    scopeName: "source.demo",
    patterns: [
      { name: "comment.line.demo", match: ";;.*$" },
      { name: "keyword.control.demo", match: "\\b(let|show)\\b" },
      { name: "constant.numeric.demo", match: "\\b\\d+\\b" },
    ],
  }),
  "extension/themes/base.json": JSON.stringify({ colors: { "editor.background": "#000000", "editor.foreground": "#ffffff" }, tokenColors: [{ scope: "comment", settings: { foreground: "#777777" } }] }),
  "extension/themes/night.json": `{ "include": "./base.json", "colors": { "editor.background": "#0b1020" },
    "tokenColors": [ { "scope": "keyword", "settings": { "foreground": "#ff79c6" } }, ] }`,
  "extension/snippets/demo.json": JSON.stringify({ Show: { prefix: "sh", body: "show ${1:value}" } }),
};

const zip = { file: (p: string) => (p in FILES ? { async: async () => FILES[p] } : null) };

function setup() {
  let saved: ExtensionContributions[] = [];
  let css = "";
  const prefs = new Map<string, string | null>();
  const contrib = makeContribEngine({
    store: { load: () => saved, save: all => ((saved = all), true) },
    style: { set: c => (css = c) },
    prefs: { get: k => prefs.get(k) ?? null, set: (k, v) => prefs.set(k, v) },
  });
  return { contrib, css: () => css, saved: () => saved };
}

describe("motor de contribuições", () => {
  test("lê tudo o que o VSIX contribui e avisa do que não consegue", async () => {
    const { contrib } = setup();
    const manifest = JSON.parse(FILES["extension/package.json"]);
    const c = await contrib.readFromVsix(zip, "acme.demo-lang", manifest.contributes);
    expect(c.languages).toEqual([{ id: "demo", extensions: [".dm"] }]);
    expect(c.grammars.map(g => g.language)).toEqual(["demo"]);
    expect(c.themes[0].theme.colors).toEqual({ "editor.background": "#0b1020", "editor.foreground": "#ffffff" });
    expect(c.snippets[0].snippets[0].name).toBe("Show");
    expect(c.configs[0].config.lineComment).toBe(";;");
    expect(c.warnings.join("\n")).toMatch(/only JSON grammars/);
    expect(c.warnings.join("\n")).toMatch(/missing\.json not found/);
  });

  test("depois de instalado: realce, snippets, comentário e tema", async () => {
    const { contrib, css } = setup();
    const manifest = JSON.parse(FILES["extension/package.json"]);
    contrib.install(await contrib.readFromVsix(zip, "acme.demo-lang", manifest.contributes));
    expect(contrib.highlight("dm", ["let x 42 ;; nota"])).toEqual([
      '<span class="kw">let</span> x <span class="num">42</span> <span class="cm">;; nota</span>',
    ]);
    expect(contrib.highlight("rs", ["fn main"])).toBeNull();
    const r = contrib.expandAt("dm", "  sh", {}, "  ", "    ")!;
    expect(r.prefix).toBe("sh");
    expect(r.expansion.text).toBe("show value");
    expect(contrib.lineCommentFor("dm")).toBe(";;");
    expect(contrib.lineCommentFor("rs")).toBeNull();
    expect(contrib.themes()).toEqual([{ extId: "acme.demo-lang", label: "Demo Night", uiTheme: "vs-dark" }]);
    contrib.applyTheme("Demo Night");
    expect(css()).toContain(".ed{background:#0b1020;color:#ffffff;}");
    expect(css()).toContain(".ed .ed-hl .kw{color:#ff79c6");
    expect(contrib.activeTheme()).toBe("Demo Night");
    contrib.remove("acme.demo-lang");
    expect(css()).toBe("");
    expect(contrib.highlight("dm", ["let"])).toBeNull();
  });

  test("o motor de extensões instala o VSIX com o resumo das contribuições e os temas na paleta", async () => {
    const { contrib } = setup();
    const state: ExsState = { inst: {}, vsix: [] };
    const CMD: Array<[string, string, (() => unknown)?, string?]> = [];
    const toasts: string[] = [];
    const engine = makeExtEngine({
      catalogue: [],
      state: { read: () => state },
      storage: { save: () => {} },
      palette: { entries: () => CMD },
      editor: { files: () => ({}), current: () => null, tabOf: () => null, extOf: p => p.split(".").pop() || "", refresh: () => {} },
      tabs: { open: () => {} },
      vsix: { load: async () => ({ loadAsync: async () => zip }) },
      notifier: { toast: m => toasts.push(m) },
      rerender: () => {},
      contrib,
    });
    await engine.loadVsix({} as File);
    const item = state.vsix[0];
    expect(item.id).toBe("acme.demo-lang");
    expect(item.contrib).toMatchObject({ themes: ["Demo Night"], grammars: ["demo"], snippets: 1, languages: ["demo"] });
    expect(CMD.map(c => c[0])).toEqual(["Demo: Run", "Color Theme: Demo Night", "Color Theme: dxtutor default"]);
    CMD[1][2]!();
    expect(contrib.activeTheme()).toBe("Demo Night");
    engine.extRemove("acme.demo-lang");
    expect(contrib.get("acme.demo-lang")).toBeUndefined();
    expect(contrib.activeTheme()).toBeNull();
  });
});
