// LSP P5 com as linguagens dos VSIX (LSP P4), no editor real do harness: a gramática de uma extensão instalada ganha à
// que vem com o dxtutor para a mesma linguagem, e a gramática real do Perl (vscode.perl) já não deixa um comentário `#`
// correr para as linhas seguintes (o tokenizador lê cada linha com o seu `\n` e ancora o `\G`).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { vsixZip } from "./fixtures/vsix";

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a janela do harness
let DP: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let FB: typeof import("../src/features/lsp/fallback");

beforeEach(async () => {
  delete (window as any).EXS; // eslint-disable-line @typescript-eslint/no-explicit-any
  w = await bootApp();
  DP = (await import("../src/app/desktop")).desktopPorts;
  FB = await import("../src/features/lsp/fallback");
  vi.spyOn(w, "toast").mockImplementation(() => {});
}, 60_000);
afterEach(() => vi.restoreAllMocks());

type Zip = { file: (p: string) => { async: () => Promise<string> } | null; files: Record<string, unknown> };
async function install(zip: Zip): Promise<void> {
  DP.ext = { loadJSZip: async () => ({ loadAsync: async () => zip }) };
  await w.loadVsix(new Uint8Array());
}
const row = (n: number) => document.querySelectorAll("#ed-hl .l")[n].innerHTML;

it("uma extensão com a gramática do Python ganha à que vem com o dxtutor", async () => {
  const KEY = w.ROOT + "src/app.py";
  w.FS[KEY] = { content: "def main():\n    pass\n", orig: null };
  w.openPath(KEY);
  await FB.fallbackHighlighter.idle();
  expect(row(0)).toContain('<span class="kw">def</span>'); // a do dxtutor (MagicPython)
  const files: Record<string, string> = {
    "extension/package.json": JSON.stringify({
      publisher: "acme",
      name: "py-colors",
      version: "1.0.0",
      contributes: { languages: [{ id: "python", extensions: [".py"] }], grammars: [{ language: "python", scopeName: "source.python", path: "./py.tmLanguage.json" }] },
    }),
    "extension/py.tmLanguage.json": JSON.stringify({ scopeName: "source.python", patterns: [{ match: "\\bdef\\b", name: "entity.name.type.acme" }] }),
  };
  await install({ file: (p) => (p in files ? { async: async () => files[p] } : null), files: {} });
  w.openPath(KEY);
  expect(row(0)).toBe('<span class="ty">def</span> main():'); // a da extensão
});

it("Perl (gramática real do VSIX): um comentário `#` acaba na sua linha", async () => {
  await install(vsixZip("vscode.perl"));
  const KEY = w.ROOT + "bin/tool.pl";
  w.FS[KEY] = { content: "my $x = 1; # set x\nprint $x;\n", orig: null };
  w.openPath(KEY);
  expect(row(0)).toContain('<span class="cm">');
  expect(row(1)).not.toContain('class="cm"');
  expect(row(1)).toContain(">print<");
});
