import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* Pesquisa (ADR-0006, R2b): no browser procura nos ficheiros carregados; no desktop com pasta
 * procura em toda a pasta pelo backend (`search_project`, IPC falso aqui). */

let w: any;
let calls: Array<[string, Record<string, unknown>]>;

const res = (): HTMLElement => document.getElementById("s-res")!;
const type = (q: string) => { const i = document.getElementById("s-q") as HTMLInputElement; i.value = q; i.dispatchEvent(new window.Event("input")); };
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  // os textos verificados abaixo são os portugueses: desde a U6c do ADR-0004 o «resultados em» vem do catálogo,
  // na língua da interface — este teste fixa o português
  (w as unknown as { LOCALE: string }).LOCALE = "ptAO";
  calls = [];
  w.renderSearchPane();
});

afterEach(() => {
  delete w.__TAURI__;
  delete w.DXR;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("browser (sem pasta): os ficheiros carregados", () => {
  it("procura no FS e abre o ficheiro na linha ao clicar", () => {
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    type("tokenize");
    expect(res().textContent).toMatch(/resultados em/);
    const hit = res().querySelector<HTMLElement>(".s-hit[data-p]")!;
    expect(hit.dataset.p).toBe(w.ROOT + "crates/lexer/src/lib.rs");
    click(hit);
    expect(open).toHaveBeenCalledWith(w.ROOT + "crates/lexer/src/lib.rs", +hit.dataset.l!);
  });

  it("os resultados já não têm handlers inline", () => {
    type("tokenize");
    expect(res().querySelector("[onclick]")).toBe(null);
  });
});

describe("desktop com pasta: search_project", () => {
  let reply: (q: string) => unknown;
  beforeEach(() => {
    w.DXR = { root: "/proj" };
    reply = () => [];
    w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push([cmd, args]); return reply(String(args.query)); } } };
  });

  it("procura em toda a pasta pelo backend (sem distinguir maiúsculas) e agrupa por ficheiro", async () => {
    reply = () => [
      { file: "src/b.rs", line: 9, col: 5, text: "    Tokenize(x)" },
      { file: "crates/lexer/src/lib.rs", line: 2, col: 8, text: "pub fn tokenize(src: &str)" },
      { file: "src/b.rs", line: 3, col: 1, text: "tokenize();" },
    ];
    type("tokenize");
    expect(res().textContent).toMatch(/A procurar/);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toEqual([["search_project", { root: "/proj", query: "tokenize", max: 2000, ignoreCase: true }]]);
    expect(res().textContent).toMatch(/3 resultados em 2 ficheiros/);
    const lines = [...res().querySelectorAll(".s-hit .n")].map((n) => n.textContent);
    expect(lines).toEqual(["2", "3", "9"]); // ficheiros por ordem e linhas ordenadas
    expect(res().querySelector("mark")!.textContent).toBe("tokenize");
  });

  it("um ficheiro que o carregamento saltou aparece, mas explica-se em vez de abrir", async () => {
    reply = () => [{ file: "assets/big.sql", line: 1, col: 1, text: "tokenize" }];
    const toast = vi.spyOn(w, "toast").mockImplementation(() => {});
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    type("tokenize");
    await vi.advanceTimersByTimeAsync(250);
    click(res().querySelector(".s-hit")!);
    expect(open).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/não está carregado/));
  });

  it("escrever depressa só pergunta uma vez (debounce) e pela última query", async () => {
    type("t"); type("to"); type("tok");
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.map((c) => c[1].query)).toEqual(["tok"]);
  });

  it("uma resposta atrasada não pinta por cima de uma mais recente", async () => {
    let first!: (v: unknown) => void;
    w.__TAURI__.core.invoke = async (_c: string, args: Record<string, unknown>) =>
      args.query === "a" ? new Promise((r) => { first = r; }) : [{ file: "x.rs", line: 1, col: 1, text: "bb" }];
    type("a");
    await vi.advanceTimersByTimeAsync(250);
    type("bb");
    await vi.advanceTimersByTimeAsync(250);
    expect(res().textContent).toMatch(/1 resultados em 1 ficheiros/);
    first([{ file: "old.rs", line: 1, col: 1, text: "a" }, { file: "old2.rs", line: 1, col: 1, text: "a" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(res().textContent).toMatch(/1 resultados em 1 ficheiros/);
  });

  it("um erro do backend diz-se no pane", async () => {
    w.__TAURI__.core.invoke = async () => { throw new Error("search task failed: boom"); };
    type("x");
    await vi.advanceTimersByTimeAsync(250);
    expect(res().textContent).toMatch(/A pesquisa falhou: search task failed: boom/);
  });
});
