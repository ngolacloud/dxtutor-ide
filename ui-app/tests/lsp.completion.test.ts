// feature `lsp` — completion: domínio puro, cliente (portas falsas) e teclado (eventos reais, jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCompletion, autoTrigger, completionItems, filterCompletions, snippetToText, wordStartAt } from "../src/features/lsp/domain/completion";
import { makeLspClient, type CompletionResult } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindCompletionHooks } from "../src/features/lsp/ui/completion-hooks";

describe("completion — domínio", () => {
  it("CompletionList e CompletionItem[]; isIncomplete; detalhes e edição própria", () => {
    const list = completionItems({
      isIncomplete: true,
      items: [
        { label: "add", kind: 2, detail: "int add(int a, int b)", insertText: "add(${1:a}, ${2:b})", insertTextFormat: 2, sortText: "0001" },
        { label: "toString", kind: 2, textEdit: { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } }, newText: "toString()" } },
        { nope: true },
      ],
    });
    expect(list.incomplete).toBe(true);
    expect(list.items.map((i) => [i.label, i.kind, i.snippet, !!i.edit])).toEqual([["add", 2, true, false], ["toString", 2, false, true]]);
    expect(completionItems([{ label: "x" }]).items[0].insert).toBe("x");
    expect(completionItems(null)).toEqual({ items: [], incomplete: false });
  });

  it("filtro: primeiro os que começam pelo prefixo, depois no início de uma palavra do nome; sem repetidos", () => {
    const { items } = completionItems([
      { label: "greet", sortText: "2", detail: "fun" }, { label: "greet", sortText: "2", detail: "fun" }, // repetido (kotlin-language-server)
      { label: "regreet", sortText: "1" }, { label: "Greeting", sortText: "3" }, { label: "getGreeting", sortText: "4" },
      { label: "IntProgression", sortText: "0" }, { label: "other" },
    ]);
    // «regreet» e «IntProgression» têm «gre» a meio de uma palavra: ficam de fora
    expect(filterCompletions(items, "gre").map((i) => i.label)).toEqual(["greet", "Greeting", "getGreeting"]);
    expect(filterCompletions(items, "").length).toBe(6);
  });

  it("snippets: placeholders, paragens, escolhas, variáveis e escapes", () => {
    expect(snippetToText("add(${1:a}, ${2:b})")).toEqual({ text: "add(a, b)", caret: 4 });
    expect(snippetToText("println($0)")).toEqual({ text: "println()", caret: 8 });
    expect(snippetToText("for (${1:i} in ${2|list,set|}) {\n\t$0\n}")).toEqual({ text: "for (i in list) {\n\t\n}", caret: 5 });
    expect(snippetToText("cost \\$5 ${TM_FILENAME}x")).toEqual({ text: "cost $5 x", caret: 9 });
    expect(snippetToText("${1:outer ${2:inner}}")).toEqual({ text: "outer inner", caret: 0 });
  });

  it("aplicar: substitui o nome escrito; snippet com cursor na 1.ª paragem; edição própria; import automático", () => {
    const text = "class A {\n  int t = Util.ad\n}\n";
    const caret = text.indexOf("ad\n") + 2;
    const [snip] = completionItems([{ label: "add", insertText: "add(${1:a}, ${2:b})", insertTextFormat: 2 }]).items;
    const r = applyCompletion(text, snip, caret, wordStartAt(text, caret));
    expect(r.text).toBe("class A {\n  int t = Util.add(a, b)\n}\n");
    expect(r.text.slice(r.caret)).toBe("a, b)\n}\n");

    const withImport = completionItems([{
      label: "List", insertText: "List",
      additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import java.util.List;\n" }],
    }]).items[0];
    const src = "class A { Li }";
    const at = src.indexOf("Li") + 2;
    const out = applyCompletion(src, withImport, at, at - 2);
    expect(out.text).toBe("import java.util.List;\nclass A { List }");
    expect(out.text.slice(0, out.caret).endsWith("{ List")).toBe(true);
  });

  it("disparo automático: depois de «.» ou com 2+ letras; não com números ou 1 letra", () => {
    expect(autoTrigger("Util.", 5)).toEqual({ trigger: ".", wordStart: 5 });
    expect(autoTrigger("val x = gr", 10)).toEqual({ trigger: null, wordStart: 8 });
    expect(autoTrigger("val x = g", 9)).toBeNull();
    expect(autoTrigger("x = 12", 6)).toBeNull();
  });
});

describe("completion — cliente", () => {
  it("dá ao servidor o texto acabado de escrever antes de perguntar", async () => {
    const calls: string[] = [];
    const files: Record<string, string> = { "p/A.java": "class A {}" };
    const lsp = {
      start: async () => {},
      didOpen: async () => void calls.push("open"),
      didChange: async (_p: string, t: string, v: number) => void calls.push(`change v${v} ${t}`),
      completion: async (_p: string, l: number, c: number, trig: string | null) => (calls.push(`complete ${l}:${c} ${trig}`), { items: [{ label: "length" }] }),
      onDiagnostics: () => {},
    } as unknown as LspPort;
    const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => "p/A.java", text: (k) => files[k] ?? null };
    const editor = { repaint() {}, open() {}, notify() {}, writeFile() {}, reload() {} } as EditorPort;
    const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f() });
    await client.onTab("p/A.java");
    files["p/A.java"] = "class A { s.le }";
    const res = await client.completionAt(14, ".");
    expect(calls).toEqual(["open", "change v2 class A { s.le }", "complete 0:14 ."]);
    expect(res).toMatchObject({ incomplete: false, wordStart: 12 });
    // sem alterações, não repete o didChange
    await client.completionAt(14, null);
    expect(calls.filter((c) => c.startsWith("change"))).toHaveLength(1);
  });
});

describe("completion — teclado", () => {
  let ta: HTMLTextAreaElement;
  const asked: string[] = [];
  let result: CompletionResult | null;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    asked.length = 0;
    document.body.innerHTML = `<textarea id="ed-ta"></textarea>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    ta.value = "int t = Util.";
    ta.focus();
    ta.setSelectionRange(13, 13);
    result = {
      items: completionItems([{ label: "add", detail: "int add(int, int)", insertText: "add(${1:a}, ${2:b})", insertTextFormat: 2, sortText: "1" }, { label: "abs", sortText: "2" }]).items,
      incomplete: false,
      wordStart: 13,
    };
    bindCompletionHooks({ completionAt: async (o, t) => (asked.push(`${o} ${t}`), result), enabled: () => true });
  });
  afterEach(() => vi.useRealTimers());

  const key = (k: string, o: KeyboardEventInit = {}) => ta.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));

  it("Ctrl+Espaço abre; ↓ escolhe; Enter aplica e dispara input (o editor actualiza o FS)", async () => {
    let inputs = 0;
    ta.addEventListener("input", () => inputs++);
    key(" ", { ctrlKey: true, code: "Space" });
    await flush();
    expect(asked).toEqual(["13 null"]);
    const rows = [...document.querySelectorAll("#lsp-complete .lsp-c-row")];
    expect(rows.map((r) => r.querySelector(".lsp-c-label")!.textContent)).toEqual(["add", "abs"]);
    key("ArrowDown");
    key("ArrowUp");
    expect(document.querySelector("#lsp-complete .lsp-c-row.on .lsp-c-label")!.textContent).toBe("add");
    expect(document.querySelector("#lsp-complete .lsp-c-doc")!.textContent).toBe("int add(int, int)");
    key("Enter");
    expect(ta.value).toBe("int t = Util.add(a, b)");
    expect(ta.selectionStart).toBe(17); // dentro dos parênteses, na 1.ª paragem
    expect(inputs).toBe(1);
    expect(document.getElementById("lsp-complete")).toBeNull();
  });

  it("com a lista aberta, o Tab aceita e o editor não o recebe; Escape fecha", async () => {
    let editorSawTab = false;
    ta.onkeydown = (e) => {
      if (e.key === "Tab") editorSawTab = true;
    };
    key(" ", { ctrlKey: true, code: "Space" });
    await flush();
    key("Tab");
    expect(editorSawTab).toBe(false);
    expect(ta.value).toBe("int t = Util.add(a, b)");
    key(" ", { ctrlKey: true, code: "Space" });
    await flush();
    key("Escape");
    expect(document.getElementById("lsp-complete")).toBeNull();
    key("Tab");
    expect(editorSawTab).toBe(true); // lista fechada: o Tab volta a ser do editor
  });

  it("abre sozinha depois de «.»; escrever filtra; um carácter que não é de nome fecha", async () => {
    vi.useFakeTimers();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(asked).toEqual(["13 ."]);
    expect(document.querySelectorAll("#lsp-complete .lsp-c-row")).toHaveLength(2);
    ta.value += "ad";
    ta.setSelectionRange(15, 15);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...document.querySelectorAll("#lsp-complete .lsp-c-label")].map((l) => l.textContent)).toEqual(["add"]);
    ta.value += " ";
    ta.setSelectionRange(16, 16);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("lsp-complete")).toBeNull();
  });
});
