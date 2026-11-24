// feature `lsp` — o cliente do editor com portas falsas (sem Tauri, sem DOM).
import { describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";

function setup(opts: { root?: string | null; files?: Record<string, string>; hover?: unknown; definition?: unknown } = {}) {
  const calls: string[] = [];
  let diagCb: (uri: string) => void = () => {};
  const files: Record<string, string> = opts.files ?? { "proj/src/Main.java": "class Main {\n  int x;\n}\n" };
  let current: string | null = null;
  const lsp: LspPort = {
    start: async (root) => void calls.push(`start ${root}`),
    didOpen: async (path, _t, lang) => void calls.push(`open ${path} ${lang}`),
    didChange: async (path, text, v) => void calls.push(`change ${path} v${v} ${text.length}`),
    hover: async (path, l, c) => (calls.push(`hover ${path} ${l}:${c}`), opts.hover ?? null),
    definition: async (path, l, c) => (calls.push(`def ${path} ${l}:${c}`), opts.definition ?? null),
    onDiagnostics: (cb) => (diagCb = cb),
  };
  const workspace: WorkspacePort = {
    diskRoot: () => (opts.root === undefined ? "/home/u/proj" : opts.root),
    virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => (id && id in files ? id : null),
    currentFileKey: () => current,
    text: (k) => files[k] ?? null,
  };
  const shown: string[] = [];
  const editor: EditorPort = {
    repaint: (k) => void shown.push(`repaint ${k}`),
    open: (k, line, ch) => void shown.push(`open ${k} ${line}:${ch}`),
    notify: (m) => void shown.push(`notify ${m}`),
  };
  const deferred: (() => void)[] = [];
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => deferred.push(f) });
  lsp.onDiagnostics((u) => client.onDiagnostics(u));
  const activate = (k: string | null) => {
    current = k;
    return client.onTab(k);
  };
  return { client, calls, shown, files, activate, deferred, diag: (u: string) => diagCb(u) };
}

describe("cliente LSP do editor", () => {
  it("arranca o servidor da pasta uma vez e abre cada ficheiro uma vez", async () => {
    const t = setup({ files: { "proj/src/Main.java": "class Main {}", "proj/App.kt": "fun main() {}" } });
    await t.activate("proj/src/Main.java");
    await t.activate("proj/App.kt");
    await t.activate("proj/src/Main.java");
    expect(t.calls).toEqual([
      "start /home/u/proj",
      "open /home/u/proj/src/Main.java java",
      "open /home/u/proj/App.kt kotlin",
    ]);
  });

  it("depois de editar envia didChange com versões crescentes", async () => {
    const t = setup();
    await t.activate("proj/src/Main.java");
    t.files["proj/src/Main.java"] += "// a";
    await t.client.onEdit();
    await t.client.onEdit();
    expect(t.calls.slice(2)).toEqual([
      `change /home/u/proj/src/Main.java v2 ${t.files["proj/src/Main.java"].length}`,
      `change /home/u/proj/src/Main.java v3 ${t.files["proj/src/Main.java"].length}`,
    ]);
    expect(t.client.opened().get("/home/u/proj/src/Main.java")).toBe(3);
  });

  it("ignora ficheiros sem servidor e o workspace de exemplo (sem pasta real)", async () => {
    const t = setup({ files: { "proj/README.md": "# hi" } });
    await t.activate("proj/README.md");
    await t.client.onEdit();
    expect(t.calls).toEqual([]);
    const s = setup({ root: null });
    await s.activate("proj/src/Main.java");
    expect(s.calls).toEqual([]);
  });

  it("hover na posição LSP do offset", async () => {
    const t = setup({ hover: { contents: { kind: "markdown", value: "```java\nint x\n```" } } });
    await t.activate("proj/src/Main.java");
    const text = t.files["proj/src/Main.java"];
    expect(await t.client.hoverAt(text.indexOf("x"))).toEqual([{ code: true, text: "int x" }]);
    expect(t.calls).toContain("hover /home/u/proj/src/Main.java 1:6");
  });

  it("definição dentro da pasta abre o ficheiro na linha/coluna; fora dela avisa", async () => {
    const def = { uri: "file:///home/u/proj/src/Util.java", range: { start: { line: 4, character: 2 } } };
    const t = setup({ definition: [def] });
    await t.activate("proj/src/Main.java");
    await t.client.definitionAt(3);
    expect(t.shown).toEqual(["open proj/src/Util.java 5:2"]);

    const out = setup({ definition: { uri: "jdt://contents/String.class", range: { start: { line: 0, character: 0 } } } });
    await out.activate("proj/src/Main.java");
    await out.client.definitionAt(3);
    expect(out.shown).toEqual(["notify The definition is outside this folder: jdt://contents/String.class"]);
  });

  it("definição: avisa quando o servidor ainda indexa ou não encontra nada", async () => {
    const idx = setup({ definition: { indexing: true } });
    await idx.activate("proj/src/Main.java");
    await idx.client.definitionAt(0);
    expect(idx.shown[0]).toMatch(/still indexing/);
    const none = setup({ definition: [] });
    await none.activate("proj/src/Main.java");
    await none.client.definitionAt(0);
    expect(none.shown).toEqual(["notify No definition found"]);
  });

  it("diagnósticos do ficheiro aberto voltam a pintar o editor (adiado); de outros não", async () => {
    const t = setup({ files: { "proj/src/Main.java": "x", "proj/B.java": "y" } });
    await t.activate("proj/src/Main.java");
    t.diag("file:///home/u/proj/B.java");
    t.diag("file:///home/u/proj/src/Main.java");
    expect(t.shown).toEqual([]);
    t.deferred.forEach((f) => f());
    expect(t.shown).toEqual(["repaint proj/src/Main.java"]);
  });
});
