import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* Outline (ADR-0006, R2c): no browser, a extracção local; no desktop com pasta, o backend
 * `file_outline` (IPC falso aqui), com cache por conteúdo e debounce. */

let w: any;
let calls: Array<Record<string, unknown>>;
let LX: string;

const outline = (): HTMLElement => document.getElementById("outline")!;
const names = (): string[] => [...outline().querySelectorAll(".s-hit span:last-child")].map((s) => s.textContent || "");

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  calls = [];
  LX = w.ROOT + "crates/lexer/src/lib.rs";
  w.buildExplorer(); // o arranque (que monta o Explorer com o #outline) não corre no harness
});

afterEach(() => {
  delete w.__TAURI__;
  delete w.DXR;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("browser (sem pasta)", () => {
  it("a extracção local dá os símbolos do ficheiro aberto e não chama o backend", () => {
    w.openPath(LX);
    expect(names()).toEqual(expect.arrayContaining(["tokenize", "Token"]));
    expect(calls).toEqual([]);
  });

  it("clicar num símbolo vai para a linha (sem onclick inline)", () => {
    const go = vi.spyOn(w, "gotoLine").mockImplementation(() => {});
    w.openPath(LX);
    const hit = outline().querySelector<HTMLElement>(".s-hit")!;
    expect(hit.getAttribute("onclick")).toBe(null);
    hit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(go).toHaveBeenCalledWith(+hit.dataset.on!);
  });
});

describe("desktop com pasta: file_outline", () => {
  beforeEach(() => {
    w.DXR = { root: "/proj" };
    w.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          if (cmd !== "file_outline") throw new Error("inesperado: " + cmd);
          calls.push(args);
          return [
            { name: "Lexer", kind: "struct", startLine: 1, endLine: 4 },
            { name: "tokenize", kind: "function", startLine: 2, endLine: 14 },
            { name: "peek", kind: "method", startLine: 20, endLine: 22 },
          ];
        },
      },
    };
  });

  it("mostra os símbolos do backend com a língua, a pasta e o caminho absoluto", async () => {
    w.openPath(LX);
    expect(outline().textContent).toMatch(/Reading the symbols/);
    await vi.advanceTimersByTimeAsync(450);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ lang: "rust", root: "/proj", file: "/proj/crates/lexer/src/lib.rs" });
    expect(calls[0].code).toBe(w.FS[LX].content);
    expect(names()).toEqual(["Lexer", "tokenize", "peek"]);
    const kinds = [...outline().querySelectorAll(".s-hit span:first-child")].map((s) => s.textContent);
    expect(kinds).toEqual(["struct", "fn", "method"]);
  });

  it("redesenhar com o mesmo conteúdo usa a cache; mudar o texto pede de novo", async () => {
    w.openPath(LX);
    await vi.advanceTimersByTimeAsync(450);
    w.drawOutline(); w.drawOutline();
    await vi.advanceTimersByTimeAsync(450);
    expect(calls).toHaveLength(1);
    w.FS[LX].content += "\nfn mais() {}\n";
    w.drawOutline();
    expect(names()).toEqual(["Lexer", "tokenize", "peek"]); // o último resultado fica à vista
    await vi.advanceTimersByTimeAsync(450);
    expect(calls).toHaveLength(2);
  });

  it("Markdown/SQL não vão ao backend (fica a extracção local)", async () => {
    const md = Object.keys(w.FS).find((k: string) => k.endsWith(".md"))!;
    w.openPath(md);
    await vi.advanceTimersByTimeAsync(450);
    expect(calls).toEqual([]);
  });

  it("com o backend em erro, cai na extracção local", async () => {
    w.__TAURI__.core.invoke = async () => { throw new Error("file_outline task failed"); };
    w.openPath(LX);
    await vi.advanceTimersByTimeAsync(450);
    expect(names()).toEqual(expect.arrayContaining(["tokenize"]));
  });
});
