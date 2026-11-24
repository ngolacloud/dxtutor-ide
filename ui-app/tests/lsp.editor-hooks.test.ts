// feature `lsp` — os ganchos no editor com eventos reais (jsdom): F12 e Ctrl+clique vão para
// a definição no cursor; o hover aparece no cartão e fecha com Escape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEditorHooks, showHover } from "../src/features/lsp/ui/editor-hooks";

let ta: HTMLTextAreaElement;
const defs: number[] = [];

beforeEach(() => {
  defs.length = 0;
  document.body.innerHTML = `<textarea id="ed-ta">class Main { int x; }</textarea><textarea id="other"></textarea>`;
  ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
  bindEditorHooks({ hoverAt: async () => [], definitionAt: async (o) => void defs.push(o), enabled: () => true });
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
    bindEditorHooks({ hoverAt: async () => [], definitionAt: async (o) => void defs.push(o), enabled: () => false });
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
});
