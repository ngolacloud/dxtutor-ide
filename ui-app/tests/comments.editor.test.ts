// feature `comments` no editor real (cadeia de módulos do harness): o botão na margem, a caixa
// «Start discussion» e o pedido que chega ao `codev.ask` — pelo despachante de acções e pelo teclado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: any;
let ask: ReturnType<typeof vi.fn>;
const KEY = () => w.ROOT + "crates/lexer/src/lib.rs";

const move = (target: Element, clientY: number): void => {
  target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientY }));
};
const key = (target: Element, k: string, ctrl = false): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: ctrl, bubbles: true, cancelable: true }));
};

beforeEach(async () => {
  w = await bootApp();
  const { codevAsk } = await import("../src/app/codev-ask");
  ask = vi.fn(async () => {});
  vi.spyOn(codevAsk, "ask").mockImplementation(ask as never);
  vi.spyOn(codevAsk, "available").mockReturnValue(true);
  await import("../src/features/comments/index");
  w.openPath(KEY());
});
afterEach(() => vi.restoreAllMocks());

describe("comentários de linha", () => {
  it("o botão segue a linha sob o ponteiro, dentro da .ed-wrap, fora da margem", () => {
    const ta = document.getElementById("ed-ta")!;
    move(ta, 22 * 2 + 5); // jsdom: a .ed-wrap começa em y=0 → linha 3
    const g = document.getElementById("cmt-gutter")!;
    expect(g.hidden).toBe(false);
    expect(g.parentElement).toBe(ta.parentElement);
    expect(g.style.top).toBe("44px");
    expect(g.querySelector("button")!.getAttribute("data-on")).toBe("3");
    expect(document.querySelector("#ed-gut #cmt-gutter")).toBe(null);
    move(document.body, 10); // fora do editor
    expect(g.hidden).toBe(true);
  });

  it("clicar abre a caixa por baixo da linha; Add Comment to Chat junta o comentário ao chat, sem enviar", async () => {
    move(document.getElementById("ed-ta")!, 5); // linha 1
    (document.querySelector("#cmt-gutter button") as HTMLButtonElement).click();
    const box = document.getElementById("cmt-box")!;
    expect(box.hidden).toBe(false);
    expect(box.style.top).toBe("24px");
    expect(box.querySelector(".cmt-title")!.textContent).toBe("Start discussion");
    expect(box.querySelector(".cmt-where")!.textContent).toBe("lib.rs:1");
    const add = box.querySelector(".cmt-add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const input = box.querySelector(".cmt-input") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);
    input.value = "explica este módulo";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(add.disabled).toBe(false);
    add.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(ask).toHaveBeenCalledTimes(1);
    const r = ask.mock.calls[0][0];
    expect(r).toMatchObject({ intent: "chat", send: false });
    expect(r.context[0]).toMatchObject({ kind: "comment", label: "lib.rs:1 · explica este módulo", path: "crates/lexer/src/lib.rs" });
    expect(r.context[0].text).toContain("crates/lexer/src/lib.rs, line 1:");
    expect(r.context[0].text).toContain("Comment: explica este módulo");
    expect(box.hidden).toBe(true);
    expect(document.getElementById("cmt-band")!.hidden).toBe(true);
  });

  it("Ctrl+Enter junta, Esc fecha sem perguntar, o lixo descarta", async () => {
    const ta = document.getElementById("ed-ta")!;
    const open = (): HTMLTextAreaElement => {
      move(ta, 22 + 3);
      (document.querySelector("#cmt-gutter button") as HTMLButtonElement).click();
      return document.querySelector("#cmt-box .cmt-input") as HTMLTextAreaElement;
    };
    let input = open();
    key(input, "Escape");
    expect(document.getElementById("cmt-box")!.hidden).toBe(true);
    input = open();
    input.value = "x";
    (document.querySelector("#cmt-box .cmt-del") as HTMLButtonElement).click();
    expect(document.getElementById("cmt-box")!.hidden).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    input = open();
    input.value = "renomeia";
    key(input, "Enter", true);
    await new Promise((r) => setTimeout(r, 0));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].context[0].label).toBe("lib.rs:2 · renomeia");
  });

  it("uma vista nova do ficheiro fecha a caixa que estava aberta", () => {
    move(document.getElementById("ed-ta")!, 5);
    (document.querySelector("#cmt-gutter button") as HTMLButtonElement).click();
    expect(document.getElementById("cmt-box")!.hidden).toBe(false);
    w.openPath(KEY()); // redesenha a vista: os nós antigos saem
    const box = document.getElementById("cmt-box");
    expect(!box || box.hidden).toBe(true);
  });
});
