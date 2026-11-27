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

  it("a faixa de aprovação (LSP P2): o pedido do projecto, a linha a mais e «Review…»", () => {
    w.openPath(KEY());
    const review = vi.fn(), dismissed = vi.fn();
    bridge.editor.notice(KEY(), { kind: "approval", title: "zls is waiting for your approval", detail: "This project's .dxtutor/lsp.json asks dxtutor to run /p/bin/zls.", hint: "The program is inside the project folder." }, dismissed, { review });
    const el = document.getElementById("lsp-missing")!;
    expect(el.classList.contains("lsp-approval")).toBe(true);
    expect(el.textContent).toContain("zls is waiting for your approval");
    expect(el.querySelector(".lsp-hint")!.textContent).toBe("The program is inside the project folder.");
    expect(el.querySelector(".lsp-install")).toBe(null);
    (el.querySelector('[data-k="review"]') as HTMLButtonElement).click();
    expect(review).toHaveBeenCalled();
    (el.querySelector('[data-k="dismiss"]') as HTMLButtonElement).click();
    expect(dismissed).toHaveBeenCalled();
  });

  it("a faixa de servidor em falta lembra os overrides e «Configure…» abre o lsp.json", () => {
    w.openPath(KEY());
    const configure = vi.fn();
    bridge.editor.notice(KEY(), { ...notice, kind: "missing", hint: "Have the server somewhere else, or want another one? Set it in your lsp.json." }, undefined, { configure });
    const el = document.getElementById("lsp-missing")!;
    expect(el.querySelector(".lsp-hint")!.textContent).toContain("lsp.json");
    (el.querySelector('[data-k="configure"]') as HTMLButtonElement).click();
    expect(configure).toHaveBeenCalled();
    // sem a acção, não há botão
    bridge.editor.notice(KEY(), notice);
    expect(document.querySelector('#lsp-missing [data-k="configure"]')).toBe(null);
  });

  it("as maneiras de instalar (LSP P3): escolher troca o comando e a frase; «Install» só para as que o dxtutor corre", () => {
    w.openPath(KEY());
    const install = vi.fn(), copy = vi.fn(), recheck = vi.fn();
    const ways = [
      { id: "rustup", label: "rustup", shown: "/u/.cargo/bin/rustup component add rust-analyzer", runnable: true, available: true, note: "Adds the component to your Rust toolchain." },
      { id: "github", label: "GitHub release", shown: "https://github.com/rust-lang/rust-analyzer/releases/download/2026-11-02/ra.gz", runnable: true, available: true, note: "dxtutor downloads this pinned release." },
      { id: "brew", label: "Homebrew (you run it) — brew not found", shown: "brew install rust-analyzer", runnable: false, available: false, note: "Install brew first." },
      { id: "apt", label: "apt (you run it)", shown: "sudo apt-get install x", runnable: false, available: true, note: "it may ask for sudo" },
    ];
    bridge.editor.notice(KEY(), { ...notice, kind: "missing", ways, way: "github" }, undefined, { install, copy, recheck });
    const el = document.getElementById("lsp-missing")!;
    const sel = el.querySelector("select.lsp-way") as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.value, o.disabled])).toEqual([["rustup", false], ["github", false], ["brew", true], ["apt", false]]);
    expect(sel.value).toBe("github");
    expect(el.querySelector(".lsp-install code")!.textContent).toBe(ways[1].shown);
    expect(el.querySelector(".lsp-way-note")!.textContent).toBe(ways[1].note);
    const btn = el.querySelector('[data-k="install"]') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(install).toHaveBeenCalledWith("github");
    // apt: só se mostra e copia
    sel.value = "apt";
    sel.dispatchEvent(new Event("change"));
    expect(el.querySelector(".lsp-install code")!.textContent).toBe("sudo apt-get install x");
    expect(btn.hidden).toBe(true);
    (el.querySelector('[data-k="copy"]') as HTMLButtonElement).click();
    expect(copy).toHaveBeenCalledWith("apt");
    (el.querySelector('[data-k="recheck"]') as HTMLButtonElement).click();
    expect(recheck).toHaveBeenCalled();
    // uma só maneira: sem lista, o rótulo
    bridge.editor.notice(KEY(), { ...notice, kind: "missing", ways: [ways[0]], way: "rustup" }, undefined, { install });
    const one = document.getElementById("lsp-missing")!;
    expect(one.querySelector("select")).toBe(null);
    expect(one.querySelector(".lsp-way-one")!.textContent).toBe("rustup");
  });
});
