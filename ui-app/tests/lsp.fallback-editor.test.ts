// LSP P5 — o editor sem servidor de linguagem, no editor real do harness (cadeia de módulos do main.ts, no
// browser: nenhum servidor): o realce pela gramática do dxtutor (e a de uma extensão ganha), o completion por
// palavras (a mesma lista e teclas, marcada como palavras; nunca misturada com as do servidor), o Toggle Block
// Comment (Ctrl+Shift+A) e o Ctrl+/ com o comentário de bloco, e o «Format Document» que diz o que fez.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { bindCompletionHooks } from "../src/features/lsp/ui/completion-hooks";
import { completionItems } from "../src/features/lsp/domain/completion";

type W = Window & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a janela do harness
let w: W;
let FB: typeof import("../src/features/lsp/fallback");

const PY = "import os\n\n\ndef compute_total(values):\n    # soma\n    return sum(values)\n";

function open(rel: string, content: string): HTMLTextAreaElement {
  const key = w.ROOT + rel;
  w.FS[key] = { content, orig: content };
  w.openPath(key);
  return document.getElementById("ed-ta") as HTMLTextAreaElement;
}
const key = (ta: HTMLElement, k: string, o: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o });
  ta.dispatchEvent(e);
  return e;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  w = (await bootApp()) as unknown as W;
  FB = await import("../src/features/lsp/fallback");
});
afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById("lsp-complete")?.remove();
});

describe("realce sem extensão: a gramática que vem com o dxtutor", () => {
  it("um .py ganha o realce do MagicPython (palavras-chave, comentários) quando a gramática carrega", async () => {
    open("src/calc.py", PY);
    await FB.fallbackHighlighter.idle(); // o editor repinta-se sozinho quando a gramática chega
    const rows = [...document.querySelectorAll("#ed-hl > .l")].map((r) => r.innerHTML);
    expect(rows[3]).toContain('<span class="kw">def</span>');
    expect(rows[4]).toContain('<span class="cm"> soma</span>');
    expect(rows[5]).toContain('<span class="kw">return</span>');
    expect(rows[5]).toContain('<span class="fn">sum</span>');
  });

  it("um Dockerfile (sem extensão, pelo nome) também", async () => {
    open("Dockerfile", "FROM node:20\nRUN npm ci\n");
    await FB.fallbackHighlighter.idle();
    expect(document.querySelector("#ed-hl > .l")!.innerHTML).toContain('<span class="kw">FROM</span>');
  });

  it("a gramática de uma extensão instalada ganha à do dxtutor", async () => {
    open("src/calc.py", PY);
    await FB.fallbackHighlighter.idle();
    vi.spyOn(w, "vsxHighlight").mockImplementation(((_ext: string, lines: string[]) => lines.map(() => '<span class="ty">vsx</span>')) as never);
    w.paintEd(w.ROOT + "src/calc.py");
    expect(document.querySelector("#ed-hl > .l")!.innerHTML).toBe('<span class="ty">vsx</span>');
  });

  it("uma linguagem sem gramática do dxtutor fica com o realce de sempre", () => {
    open("src/main.rs", "fn main() {}\n");
    expect(document.querySelector("#ed-hl > .l")!.innerHTML).toBe(w.hlLine("fn main() {}", "rs"));
  });
});

describe("comentários de bloco", () => {
  it("Ctrl+Shift+A no editor comenta a selecção com o comentário de bloco da linguagem — e não abre o assistente", () => {
    const ta = open("src/lib.rs", "let x = a + b;\n");
    const pane = w.PANE;
    ta.focus();
    ta.setSelectionRange(8, 13);
    const e = key(ta, "A", { ctrlKey: true, shiftKey: true, code: "KeyA" });
    expect(e.defaultPrevented).toBe(true);
    expect(ta.value).toBe("let x = /* a + b */;\n");
    expect(w.FS[w.ROOT + "src/lib.rs"].content).toBe("let x = /* a + b */;\n");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([11, 16]);
    expect(w.PANE).toBe(pane);
    // Shift+Alt+A (o do VS Code no Windows/macOS) descomenta
    key(ta, "A", { altKey: true, shiftKey: true, code: "KeyA" });
    expect(ta.value).toBe("let x = a + b;\n");
  });

  it("fora do editor, Ctrl+Shift+A continua a abrir o assistente", () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "A", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(w.PANE).toBe("codev");
  });

  it("numa linguagem sem comentário de bloco (Python), diz que não há e não mexe no texto", () => {
    const toast = vi.spyOn(w, "toast").mockImplementation(() => {});
    const ta = open("src/calc.py", PY);
    ta.setSelectionRange(0, 3);
    key(ta, "A", { ctrlKey: true, shiftKey: true, code: "KeyA" });
    expect(ta.value).toBe(PY);
    expect(toast).toHaveBeenCalledWith("Python has no block comment — Ctrl+/ comments the lines");
  });

  it("Ctrl+/ numa linguagem sem comentário de linha (CSS) comenta a linha com o bloco", () => {
    const ta = open("web/site.css", "body {\n  color: red;\n}\n");
    ta.setSelectionRange(10, 10);
    key(ta, "/", { ctrlKey: true });
    expect(ta.value).toBe("body {\n  /* color: red; */\n}\n");
    key(ta, "/", { ctrlKey: true });
    expect(ta.value).toBe("body {\n  color: red;\n}\n");
  });
});

describe("«Format Document» sem servidor (Shift+Alt+F)", () => {
  it("só arruma o que é seguro, no estilo do ficheiro, e o aviso diz o que fez", () => {
    const toast = vi.spyOn(w, "toast").mockImplementation(() => {});
    const ta = open("src/util.py", "def f():\n    a = 1   \n    b = 2\n\tc = 3");
    ta.focus();
    key(ta, "F", { shiftKey: true, altKey: true, code: "KeyF" });
    expect(w.FS[w.ROOT + "src/util.py"].content).toBe("def f():\n    a = 1\n    b = 2\n    c = 3\n");
    // (o harness reavalia os atalhos globais a cada teste e o document guarda os listeners antigos: o formatador corre
    // mais de uma vez aqui; o primeiro formata, os outros dizem que já está)
    expect(toast).toHaveBeenNthCalledWith(1, 
      "Formatted without a language server: trailing spaces removed on 1 line; 1 line re-indented with 4 spaces, like the rest of the file; final newline added",
    );
  });
});

describe("completion por palavras", () => {
  it("no editor do browser (sem servidor): escrever 2 letras abre as palavras do ficheiro, marcadas como palavras; Enter aceita", async () => {
    await import("../src/features/lsp/index"); // liga os ganchos (no browser: só as palavras)
    const ta = open("src/calc.py", PY + "\nco");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(250);
    const box = document.getElementById("lsp-complete")!;
    expect(box).not.toBeNull();
    expect(box.classList.contains("lsp-words")).toBe(true);
    expect(box.querySelector(".lsp-c-note")!.textContent).toBe("Words from your open files — no suggestions from a language server");
    const rows = [...box.querySelectorAll(".lsp-c-row")].map((r) => [r.querySelector(".lsp-c-label")!.textContent, r.querySelector(".lsp-c-detail")!.textContent]);
    expect(rows).toEqual([["compute_total", "word"]]);
    key(ta, "Enter");
    expect(ta.value.endsWith("\ncompute_total")).toBe(true);
    expect(w.FS[w.ROOT + "src/calc.py"].content.endsWith("\ncompute_total")).toBe(true);
    expect(document.getElementById("lsp-complete")).toBeNull();
  });
});

describe("palavras só quando o servidor não sugere nada", () => {
  let ta: HTMLTextAreaElement;
  let server: ReturnType<typeof completionItems>["items"];
  const words = vi.fn((text: string, offset: number) => ({ items: completionItems([{ label: "fromWords" }]).items, incomplete: false, wordStart: offset - 2 + 0 * text.length }));
  beforeEach(() => {
    document.body.innerHTML = `<textarea id="ed-ta"></textarea>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    ta.value = "fr";
    ta.focus();
    ta.setSelectionRange(2, 2);
    words.mockClear();
    bindCompletionHooks({
      completionAt: async () => (server.length ? { items: server, incomplete: false, wordStart: 0 } : null),
      enabled: () => true,
      words,
      wordsNote: () => "Words",
    });
  });
  const labels = () => [...document.querySelectorAll("#lsp-complete .lsp-c-label")].map((e) => e.textContent);

  it("o servidor respondeu com sugestões: são só as dele, sem a linha das palavras", async () => {
    server = completionItems([{ label: "fromServer" }]).items;
    key(ta, " ", { ctrlKey: true, code: "Space" });
    await wait(0);
    expect(labels()).toEqual(["fromServer"]);
    expect(words).not.toHaveBeenCalled();
    expect(document.querySelector("#lsp-complete .lsp-c-note")).toBeNull();
  });

  it("sem sugestões do servidor: as palavras (Ctrl+Espaço pede-as como explícitas)", async () => {
    server = [];
    key(ta, " ", { ctrlKey: true, code: "Space" });
    await wait(0);
    expect(labels()).toEqual(["fromWords"]);
    expect(words).toHaveBeenCalledWith("fr", 2, true);
    expect(document.querySelector("#lsp-complete .lsp-c-note")!.textContent).toBe("Words");
  });

  it("uma palavra igual ao que já está escrito não aparece (o Enter fica para a linha nova)", async () => {
    server = [];
    words.mockImplementationOnce((_t: string, offset: number) => ({ items: completionItems([{ label: "fr" }]).items, incomplete: false, wordStart: offset - 2 }));
    key(ta, " ", { ctrlKey: true, code: "Space" });
    await wait(0);
    expect(document.getElementById("lsp-complete")).toBeNull();
  });
});
