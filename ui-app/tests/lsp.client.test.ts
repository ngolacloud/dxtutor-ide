// feature `lsp` — o cliente do editor com portas falsas (sem Tauri, sem DOM).
import { describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";

function setup(opts: { root?: string | null; files?: Record<string, string>; hover?: unknown; definition?: unknown; references?: unknown; prepare?: unknown; prepareThrows?: boolean; rename?: unknown; renameSeq?: unknown[]; missing?: string[] } = {}) {
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
    references: async (path, l, c) => (calls.push(`refs ${path} ${l}:${c}`), opts.references ?? null),
    prepareRename: async (path, l, c) => {
      calls.push(`prepare ${path} ${l}:${c}`);
      if (opts.prepareThrows) throw new Error("method not found");
      return opts.prepare ?? null;
    },
    rename: async (path, l, c, n) => {
      calls.push(`rename ${path} ${l}:${c} ${n}`);
      // `renameSeq`: respostas sucessivas (ex. null e depois edições, como o jdtls logo após editar)
      return opts.renameSeq ? opts.renameSeq.shift() ?? null : opts.rename ?? null;
    },
    onDiagnostics: (cb) => (diagCb = cb),
    serverStatus: async (path) => {
      const language = path.endsWith(".kt") ? "kotlin" : path.endsWith(".java") ? "java" : null;
      if (!language) return null;
      calls.push(`status ${language}`);
      const missing = (opts.missing ?? []).includes(language);
      return { language, server: language === "java" ? "jdtls" : "kotlin-language-server", installed: !missing, problem: missing ? "não encontrado" : null };
    },
  };
  const workspace: WorkspacePort = {
    diskRoot: () => (opts.root === undefined ? "/home/u/proj" : opts.root),
    virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => (id && id in files ? id : null),
    currentFileKey: () => current,
    text: (k) => files[k] ?? null,
  };
  const shown: string[] = [];
  const notices = new Map<string, string | null>();
  let dismiss: (() => void) | undefined;
  const editor: EditorPort = {
    repaint: (k) => void shown.push(`repaint ${k}`),
    open: (k, line, ch) => void shown.push(`open ${k} ${line}:${ch}`),
    notify: (m) => void shown.push(`notify ${m}`),
    writeFile: (k, text) => {
      files[k] = text;
      shown.push(`write ${k}`);
    },
    reload: (k) => void shown.push(`reload ${k}`),
    notice: (k, n, onDismiss) => { notices.set(k, n ? n.title : null); dismiss = onDismiss; },
  };
  const deferred: (() => void)[] = [];
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => deferred.push(f), sleep: async () => {} });
  lsp.onDiagnostics((u) => client.onDiagnostics(u));
  const activate = (k: string | null) => {
    current = k;
    return client.onTab(k);
  };
  return { client, calls, shown, files, activate, deferred, diag: (u: string) => diagCb(u), notices, dismiss: () => dismiss?.() };
}

describe("cliente LSP do editor", () => {
  it("arranca o servidor da pasta uma vez e abre cada ficheiro uma vez", async () => {
    const t = setup({ files: { "proj/src/Main.java": "class Main {}", "proj/App.kt": "fun main() {}" } });
    await t.activate("proj/src/Main.java");
    await t.activate("proj/App.kt");
    await t.activate("proj/src/Main.java");
    expect(t.calls.filter((c) => !c.startsWith("status "))).toEqual([
      "start /home/u/proj",
      "open /home/u/proj/src/Main.java java",
      "open /home/u/proj/App.kt kotlin",
    ]);
    expect(t.calls.filter((c) => c.startsWith("status "))).toEqual(["status java", "status kotlin"]); // uma vez por linguagem
  });

  it("depois de editar envia didChange com versões crescentes (e não repete o mesmo texto)", async () => {
    const t = setup();
    await t.activate("proj/src/Main.java");
    t.files["proj/src/Main.java"] += "// a";
    await t.client.onEdit();
    const v2 = t.files["proj/src/Main.java"].length;
    t.files["proj/src/Main.java"] += "b";
    await t.client.onEdit();
    await t.client.onEdit(); // sem alterações: nada
    expect(t.calls.filter((c) => c.startsWith("change "))).toEqual([
      `change /home/u/proj/src/Main.java v2 ${v2}`,
      `change /home/u/proj/src/Main.java v3 ${v2 + 1}`,
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

  it("servidor em falta: aviso no editor com o que falta, e nada é enviado ao backend", async () => {
    const t = setup({ missing: ["java"] });
    await t.activate("proj/src/Main.java");
    expect(t.notices.get("proj/src/Main.java")).toBe("No Java language server");
    expect(t.calls).toEqual(["status java"]); // nem lsp_start nem didOpen
    await t.client.hoverAt(3);
    expect(t.calls.filter((c) => c.startsWith("hover"))).toEqual([]);
  });

  it("o aviso volta a cada desenho da vista até ser fechado; servidor instalado não avisa", async () => {
    const t = setup({ missing: ["java"], files: { "proj/src/Main.java": "class Main {}", "proj/App.kt": "fun main() {}" } });
    await t.activate("proj/src/Main.java");
    t.notices.clear();
    await t.client.onFileView("proj/src/Main.java");
    expect(t.notices.get("proj/src/Main.java")).toBe("No Java language server");
    t.dismiss();
    await t.client.onFileView("proj/src/Main.java");
    expect(t.notices.get("proj/src/Main.java")).toBe(null);
    await t.activate("proj/App.kt");
    expect(t.notices.get("proj/App.kt")).toBe(null);
    expect(t.calls).toContain("open /home/u/proj/App.kt kotlin");
  });
});

describe("sincronização antes dos pedidos", () => {
  it("rename logo depois de escrever (antes do didChange atrasado) pergunta sobre o texto novo", async () => {
    const t = setup({ files: { "proj/src/Main.java": "class Main {}" }, rename: { changes: {} } });
    await t.activate("proj/src/Main.java");
    t.files["proj/src/Main.java"] = "class Main { int y; }";
    await t.client.renameAt(17, "z");
    const change = t.calls.findIndex((c) => c.startsWith("change"));
    const rename = t.calls.findIndex((c) => c.startsWith("rename"));
    expect(change).toBeGreaterThan(-1);
    expect(change).toBeLessThan(rename);
  });
});

describe("referências e rename no cliente", () => {
  const MAIN = "class Main {\n  int t = Util.add(1, 2);\n}\n";
  const UTIL = "class Util {\n  static int add(int a, int b) { return a + b; }\n}\n";
  const loc = (file: string, line: number, ch: number) => ({ uri: `file:///home/u/proj/${file}`, range: { start: { line, character: ch }, end: { line, character: ch + 3 } } });
  const files = () => ({ "proj/src/Main.java": MAIN, "proj/src/Util.java": UTIL });

  it("referências com ficheiro, linha (1-based) e o texto da linha; fora da pasta sem chave", async () => {
    const t = setup({ files: files(), references: [loc("src/Util.java", 1, 13), loc("src/Main.java", 1, 15), { uri: "jdt://x/String.class", range: { start: { line: 0, character: 0 } } }] });
    await t.activate("proj/src/Main.java");
    const refs = await t.client.referencesAt(MAIN.indexOf("add"));
    expect(t.calls).toContain("refs /home/u/proj/src/Main.java 1:15");
    expect(refs).toEqual([
      { key: "proj/src/Util.java", label: "src/Util.java", line: 2, character: 13, preview: "static int add(int a, int b) { return a + b; }" },
      { key: "proj/src/Main.java", label: "src/Main.java", line: 2, character: 15, preview: "int t = Util.add(1, 2);" },
      { key: null, label: "jdt://x/String.class", line: 1, character: 0, preview: "" },
    ]);
  });

  it("referências pedidas na declaração (não no uso) e a declaração acrescentada se o servidor a omitir", async () => {
    // como o kotlin-language-server: na declaração devolve só os usos, sem a própria declaração
    const t = setup({ files: files(), definition: [loc("src/Util.java", 1, 13)], references: [loc("src/Main.java", 1, 15)] });
    await t.activate("proj/src/Main.java");
    const refs = await t.client.referencesAt(MAIN.indexOf("add"));
    expect(t.calls).toContain("refs /home/u/proj/src/Util.java 1:13");
    expect(t.calls).toContain("open /home/u/proj/src/Util.java java"); // a declaração abre-se no servidor
    expect(refs!.map((r) => `${r.label}:${r.line}`)).toEqual(["src/Util.java:2", "src/Main.java:2"]);
  });

  it("prepareRename: usa o intervalo do servidor; sem prepareRename, a palavra no cursor; recusa avisa", async () => {
    const at = MAIN.indexOf("add") + 1;
    const ranged = setup({ files: files(), prepare: { start: { line: 1, character: 15 }, end: { line: 1, character: 18 } } });
    await ranged.activate("proj/src/Main.java");
    expect(await ranged.client.prepareRenameAt(at)).toEqual({ placeholder: "add", start: MAIN.indexOf("add"), end: MAIN.indexOf("add") + 3 });

    const unsupported = setup({ files: files(), prepareThrows: true });
    await unsupported.activate("proj/src/Main.java");
    expect((await unsupported.client.prepareRenameAt(at))?.placeholder).toBe("add");

    const refused = setup({ files: files(), prepare: { neither: true } });
    await refused.activate("proj/src/Main.java");
    expect(await refused.client.prepareRenameAt(at)).toBeNull();
    expect(refused.shown).toEqual(["notify This symbol can't be renamed"]);
  });

  it("rename aplica as edições aos dois ficheiros, avisa o servidor dos abertos e salta o que está fora", async () => {
    const edit = (file: string, line: number, ch: number) => ({ textDocument: { uri: `file:///home/u/proj/${file}`, version: 1 }, edits: [{ range: { start: { line, character: ch }, end: { line, character: ch + 3 } }, newText: "sum" }] });
    const t = setup({ files: files(), rename: { documentChanges: [edit("src/Main.java", 1, 15), edit("src/Util.java", 1, 13), { textDocument: { uri: "file:///elsewhere/X.java" }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "z" }] }] } });
    await t.activate("proj/src/Main.java");
    const res = await t.client.renameAt(MAIN.indexOf("add"), "  sum ");
    expect(res).toEqual({ files: 2, edits: 2, skipped: ["/elsewhere/X.java"] });
    expect(t.files["proj/src/Main.java"]).toBe(MAIN.replace("add", "sum"));
    expect(t.files["proj/src/Util.java"]).toBe(UTIL.replace("add", "sum"));
    expect(t.calls).toContain("rename /home/u/proj/src/Main.java 1:15 sum");
    // o Main.java estava aberto no servidor: didChange com a versão seguinte; o Util.java não
    expect(t.calls.filter((c) => c.startsWith("change"))).toEqual([`change /home/u/proj/src/Main.java v2 ${MAIN.length}`]);
    expect(t.shown).toContain("reload proj/src/Main.java");
    expect(t.shown.at(-1)).toBe("notify Renamed to sum: 2 change(s) in 2 file(s) — 1 file(s) skipped");
  });

  it("rename que volta null (servidor ainda a reprocessar) é perguntado de novo; null persistente desiste", async () => {
    const edits = { changes: { "file:///home/u/proj/src/Main.java": [{ range: { start: { line: 1, character: 15 }, end: { line: 1, character: 18 } }, newText: "sum" }] } };
    const t = setup({ files: files(), renameSeq: [null, edits] });
    await t.activate("proj/src/Main.java");
    expect(await t.client.renameAt(MAIN.indexOf("add"), "sum")).toEqual({ files: 1, edits: 1, skipped: [] });
    expect(t.calls.filter((c) => c.startsWith("rename"))).toHaveLength(2);

    const never = setup({ files: files() });
    await never.activate("proj/src/Main.java");
    expect(await never.client.renameAt(MAIN.indexOf("add"), "sum")).toBeNull();
    expect(never.calls.filter((c) => c.startsWith("rename"))).toHaveLength(3); // 1 + 2 tentativas
    expect(never.shown.at(-1)).toBe("notify Nothing to rename here");
  });

  it("rename sem edições ou ainda a indexar avisa e não grava nada", async () => {
    const none = setup({ files: files(), rename: { changes: {} } });
    await none.activate("proj/src/Main.java");
    expect(await none.client.renameAt(5, "x")).toBeNull();
    expect(none.shown).toEqual(["notify Nothing to rename here"]);
    const idx = setup({ files: files(), rename: { indexing: true } });
    await idx.activate("proj/src/Main.java");
    expect(await idx.client.renameAt(5, "x")).toBeNull();
    expect(idx.shown[0]).toMatch(/still indexing/);
  });
});
