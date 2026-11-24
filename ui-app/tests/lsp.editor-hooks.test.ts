// feature `lsp` — os ganchos no editor com eventos reais (jsdom): F12 e Ctrl+clique vão para
// a definição no cursor; o hover aparece no cartão e fecha com Escape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEditorHooks, showHover, type EditorHooksDeps } from "../src/features/lsp/ui/editor-hooks";
import type { Reference } from "../src/features/lsp/application/lsp-client";

let ta: HTMLTextAreaElement;
const defs: number[] = [];
const log: string[] = [];
const REFS: Reference[] = [
  { key: "p/Util.java", label: "Util.java", line: 3, character: 4, preview: "static int add(int a, int b)" },
  { key: null, label: "jdt://String.class", line: 1, character: 0, preview: "" },
];

function deps(over: Partial<EditorHooksDeps> = {}): EditorHooksDeps {
  return {
    hoverAt: async () => [],
    definitionAt: async (o) => void defs.push(o),
    referencesAt: async (o) => (log.push(`refs ${o}`), REFS),
    prepareRenameAt: async (o) => (log.push(`prepare ${o}`), { placeholder: "Main", start: 6, end: 10 }),
    renameAt: async (o, n) => (log.push(`rename ${o} ${n}`), { files: 1, edits: 1, skipped: [] }),
    openReference: (r) => void log.push(`open ${r.key}:${r.line}`),
    enabled: () => true,
    ...over,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  defs.length = 0;
  log.length = 0;
  document.body.innerHTML = `<textarea id="ed-ta">class Main { int x; }</textarea><textarea id="other"></textarea>`;
  ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
  bindEditorHooks(deps());
});
afterEach(() => vi.useRealTimers());

describe("ganchos LSP no editor", () => {
  it("F12 pede a definição no cursor; outras teclas e outras textareas não", () => {
    ta.setSelectionRange(17, 17);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.getElementById("other")!.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
    expect(defs).toEqual([17]);
  });

  it("Ctrl+clique pede a definição; um clique simples não", () => {
    ta.setSelectionRange(6, 6);
    ta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ta.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(defs).toEqual([6]);
  });

  it("desligado sem pasta real", () => {
    bindEditorHooks(deps({ enabled: () => false }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
    expect(defs).toEqual([]);
  });

  it("o cartão mostra código e texto, e fecha ao carregar numa tecla", () => {
    showHover([{ code: true, text: "int x" }, { code: false, text: "<b>doc</b>" }], 10, 10);
    const card = document.getElementById("lsp-hover")!;
    expect(card.classList.contains("hidden")).toBe(false);
    expect(card.querySelector("pre.lsp-code")!.textContent).toBe("int x");
    // texto do servidor entra como texto, nunca como HTML
    expect(card.querySelector(".lsp-text")!.innerHTML).toBe("&lt;b&gt;doc&lt;/b&gt;");
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card.classList.contains("hidden")).toBe(true);
  });

  it("Shift+F12 lista as referências; clicar abre-a; a que está fora da pasta fica desactivada", async () => {
    ta.setSelectionRange(8, 8);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true, bubbles: true }));
    await flush();
    expect(log).toEqual(["refs 8"]);
    expect(defs).toEqual([]); // Shift+F12 não é a definição
    const pop = document.getElementById("lsp-refs")!;
    expect(pop.querySelector(".lsp-pop-h")!.textContent).toBe("2 references in 2 files");
    const rows = [...pop.querySelectorAll<HTMLButtonElement>(".lsp-ref")];
    expect(rows.map((b) => b.textContent)).toEqual(["Util.java:3static int add(int a, int b)", "jdt://String.class:1outside this folder"]);
    expect(rows[1].disabled).toBe(true);
    rows[0].click();
    expect(log).toEqual(["refs 8", "open p/Util.java:3"]);
    expect(document.getElementById("lsp-refs")).toBeNull();
  });

  it("F2 abre a caixa com o nome actual; Enter aplica o rename no cursor; Escape cancela", async () => {
    ta.setSelectionRange(8, 8);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    await flush();
    const input = document.querySelector<HTMLInputElement>("#lsp-rename input")!;
    expect(input.value).toBe("Main");
    expect(document.activeElement).toBe(input);
    input.value = "Program";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(log).toEqual(["prepare 8", "rename 8 Program"]);
    expect(document.getElementById("lsp-rename")).toBeNull();

    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    await flush();
    const again = document.querySelector<HTMLInputElement>("#lsp-rename input")!;
    again.value = "Other";
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(log.filter((l) => l.startsWith("rename"))).toEqual(["rename 8 Program"]);
    expect(document.getElementById("lsp-rename")).toBeNull();
  });
});
