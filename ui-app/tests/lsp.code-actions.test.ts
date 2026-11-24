// feature `lsp` — code actions: domínio, cliente (portas falsas) e Ctrl+. (eventos reais, jsdom).
import { beforeEach, describe, expect, it } from "vitest";
import { clientSideEdit, codeActionItems, kindLabel } from "../src/features/lsp/domain/code-actions";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindEditorHooks, type EditorHooksDeps } from "../src/features/lsp/ui/editor-hooks";

const MAIN = "class Main {\n  String broken = 42;\n}\n";
const fixEdit = { changes: { "file:///w/Main.java": [{ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }, newText: "int" }] } };

describe("code actions — domínio", () => {
  it("CodeAction e Command simples; correcção preferida primeiro, depois refactor e source", () => {
    const items = codeActionItems([
      { title: "Generate toString()", kind: "source.generate.toString", edit: { changes: {} } },
      { title: "Convert Java to Kotlin", command: "convertJavaToKotlin", arguments: ["file:///a.kt"] },
      { title: "Extract to method", kind: "refactor.extract" },
      { title: "Add Javadoc", kind: "quickassist" },
      { title: "Change type of 'broken' to 'int'", kind: "quickfix", edit: fixEdit },
      { title: "Remove", kind: "quickfix", isPreferred: true, edit: fixEdit },
      { title: "Disabled one", kind: "refactor", disabled: { reason: "Selection is not an expression" } },
      { nope: true },
    ]);
    expect(items.map((a) => a.title)).toEqual([
      "Remove", "Change type of 'broken' to 'int'", "Extract to method", "Disabled one", "Generate toString()", "Convert Java to Kotlin", "Add Javadoc",
    ]);
    expect(items.find((a) => a.title === "Convert Java to Kotlin")!.command).toEqual({ command: "convertJavaToKotlin", arguments: ["file:///a.kt"] });
    expect(items.find((a) => a.title === "Disabled one")!.disabled).toBe("Selection is not an expression");
    expect(codeActionItems(null)).toEqual([]);
  });

  it("comandos que só trazem uma edição (java.apply.workspaceEdit) e etiquetas do tipo", () => {
    expect(clientSideEdit({ command: "java.apply.workspaceEdit", arguments: [fixEdit] })).toBe(fixEdit);
    expect(clientSideEdit({ command: "java.apply.workspaceEdit", arguments: ["x"] })).toBeNull();
    expect(clientSideEdit({ command: "convertJavaToKotlin", arguments: [fixEdit] })).toBeNull();
    expect(clientSideEdit(null)).toBeNull();
    expect([kindLabel("quickfix"), kindLabel("refactor.extract"), kindLabel("source.organizeImports"), kindLabel("quickassist"), kindLabel("")]).toEqual(["fix", "refactor", "source", "quickassist", ""]);
  });
});

function setup(actions: unknown, onExecute?: (cmd: string, args: unknown[] | null) => unknown) {
  const calls: string[] = [];
  const files: Record<string, string> = { "p/Main.java": MAIN };
  let applyEditCb: (e: unknown) => void = () => {};
  const lsp = {
    start: async () => {},
    didOpen: async () => {},
    didChange: async (path: string, _t: string, v: number) => void calls.push(`change ${path} v${v}`),
    codeAction: async (path: string, sl: number, sc: number, el: number, ec: number) => (calls.push(`actions ${path} ${sl}:${sc}-${el}:${ec}`), actions),
    executeCommand: async (path: string, cmd: string, args: unknown[] | null) => {
      calls.push(`execute ${cmd} ${JSON.stringify(args)}`);
      return onExecute ? onExecute(cmd, args) : null;
    },
    onApplyEdit: (cb: (e: unknown) => void) => (applyEditCb = cb),
    serverStatus: async () => ({ language: "java", server: "jdtls", installed: true }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => "p/Main.java", text: (k) => files[k] ?? null };
  const shown: string[] = [];
  const editor = {
    repaint() {}, open() {}, notice() {},
    notify: (m: string) => void shown.push(m),
    writeFile: (k: string, t: string) => void (files[k] = t),
    reload: (k: string) => void shown.push(`reload ${k}`),
  } as unknown as EditorPort;
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  lsp.onApplyEdit((e) => void client.onApplyEdit(e));
  return { client, calls, files, shown, applyEdit: (e: unknown) => applyEditCb(e) };
}

describe("code actions — cliente", () => {
  it("pede as acções para o intervalo e aplica a edição da escolhida", async () => {
    const t = setup([{ title: "Change type of 'broken' to 'int'", kind: "quickfix", edit: fixEdit }]);
    await t.client.onTab("p/Main.java");
    const at = MAIN.indexOf("broken");
    const actions = await t.client.codeActionsAt(at, at + 6);
    expect(t.calls).toContain("actions /w/Main.java 1:9-1:15");
    await t.client.applyCodeAction(actions![0]);
    expect(t.files["p/Main.java"]).toBe("class Main {\n  int broken = 42;\n}\n");
    expect(t.calls.filter((c) => c.startsWith("change"))).toEqual(["change /w/Main.java v2"]); // o servidor tem-no aberto
    expect(t.shown.at(-1)).toBe("Change type of 'broken' to 'int': 1 change(s) in 1 file(s)");
  });

  it("comando executado no servidor: as edições chegam por workspace/applyEdit", async () => {
    let t: ReturnType<typeof setup>;
    t = setup([{ title: "Organize imports", command: "java.action.organizeImports", arguments: ["file:///w/Main.java"] }], () => {
      t.applyEdit(fixEdit); // o servidor pede para aplicar a edição durante o executeCommand
      return null;
    });
    await t.client.onTab("p/Main.java");
    const [a] = (await t.client.codeActionsAt(0, 0))!;
    await t.client.applyCodeAction(a);
    expect(t.calls).toContain('execute java.action.organizeImports ["file:///w/Main.java"]');
    await new Promise((r) => setTimeout(r, 0));
    expect(t.files["p/Main.java"]).toContain("int broken");
  });

  it("java.apply.workspaceEdit aplica-se aqui (sem ir ao servidor); desactivada só avisa", async () => {
    const t = setup([
      { title: "Fix it", command: { command: "java.apply.workspaceEdit", arguments: [fixEdit] } },
      { title: "Extract", kind: "refactor.extract", disabled: { reason: "No selection" } },
    ]);
    await t.client.onTab("p/Main.java");
    const actions = (await t.client.codeActionsAt(0, 0))!;
    await t.client.applyCodeAction(actions.find((a) => a.title === "Fix it")!);
    expect(t.calls.some((c) => c.startsWith("execute"))).toBe(false);
    expect(t.files["p/Main.java"]).toContain("int broken");
    await t.client.applyCodeAction(actions.find((a) => a.title === "Extract")!);
    expect(t.shown.at(-1)).toBe("Extract: No selection");
  });
});

describe("code actions — Ctrl+.", () => {
  let ta: HTMLTextAreaElement;
  const log: string[] = [];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const deps = (): EditorHooksDeps => ({
    hoverAt: async () => [], definitionAt: async () => {}, referencesAt: async () => null,
    prepareRenameAt: async () => null, renameAt: async () => null, openReference: () => {},
    codeActionsAt: async (s, e) => (log.push(`actions ${s}-${e}`), codeActionItems([
      { title: "Generate toString()", kind: "source.generate.toString", edit: {} },
      { title: "Change type of 'broken' to 'int'", kind: "quickfix", edit: fixEdit },
    ])),
    applyCodeAction: async (a) => void log.push(`apply ${a.title}`),
    enabled: () => true,
  });

  beforeEach(() => {
    log.length = 0;
    document.body.innerHTML = `<textarea id="ed-ta">${MAIN}</textarea>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    bindEditorHooks(deps());
  });

  it("abre o menu para a selecção, com a correcção primeiro; clicar aplica; Escape fecha", async () => {
    ta.focus();
    ta.setSelectionRange(17, 23);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(log).toEqual(["actions 17-23"]);
    const rows = [...document.querySelectorAll<HTMLButtonElement>("#lsp-actions .lsp-action")];
    expect(rows.map((r) => r.textContent)).toEqual(["fixChange type of 'broken' to 'int'", "sourceGenerate toString()"]);
    expect(document.activeElement).toBe(rows[0]);
    rows[0].click();
    expect(log).toEqual(["actions 17-23", "apply Change type of 'broken' to 'int'"]);
    expect(document.getElementById("lsp-actions")).toBeNull();

    ta.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true, cancelable: true }));
    await flush();
    document.getElementById("lsp-actions")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("lsp-actions")).toBeNull();
  });
});
