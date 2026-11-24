// O aviso de servidor de linguagem em falta, no editor real (cadeia de módulos do harness).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: any;
let bridge: typeof import("../src/features/lsp/infrastructure/legacy-bridge");
let bus: typeof import("../src/app/bus").bus;
const KEY = () => w.ROOT + "crates/lexer/src/lib.rs";
const notice = { title: "No Rust language server", detail: "dxtutor looked for rust-analyzer and did not find it.", install: "rustup component add rust-analyzer" };

beforeEach(async () => {
  w = await bootApp();
  bridge = await import("../src/features/lsp/infrastructure/legacy-bridge");
  bus = (await import("../src/app/bus")).bus;
});
afterEach(() => vi.restoreAllMocks());

describe("aviso de servidor em falta", () => {
  it("o editor anuncia cada desenho da vista de um ficheiro (editor:file-view)", () => {
    const seen: string[] = [];
    bus.on("editor:file-view", ({ path }) => void seen.push(path));
    w.openPath(KEY());
    expect(seen).toContain(KEY());
  });

  it("aparece por cima do editor do ficheiro aberto, com o que falta e como instalar; Dismiss tira-o", () => {
    w.openPath(KEY());
    const dismissed = vi.fn();
    bridge.editor.notice(KEY(), notice, dismissed);
    const el = document.getElementById("lsp-missing")!;
    expect(el.nextElementSibling!.classList.contains("ed")).toBe(true);
    expect(el.textContent).toMatch(/No Rust language server/);
    expect(el.querySelector("code")!.textContent).toBe("rustup component add rust-analyzer");
    bridge.editor.notice(KEY(), notice, dismissed); // repor não duplica
    expect(document.querySelectorAll("#lsp-missing").length).toBe(1);
    document.getElementById("lsp-missing")!.querySelector("button")!.click();
    expect(document.getElementById("lsp-missing")).toBe(null);
    expect(dismissed).toHaveBeenCalled();
  });

  it("não aparece noutro ficheiro, e null tira-o", () => {
    w.openPath(KEY());
    bridge.editor.notice(w.ROOT + "outro.rs", notice);
    expect(document.getElementById("lsp-missing")).toBe(null);
    bridge.editor.notice(KEY(), notice);
    bridge.editor.notice(KEY(), null);
    expect(document.getElementById("lsp-missing")).toBe(null);
  });
});
