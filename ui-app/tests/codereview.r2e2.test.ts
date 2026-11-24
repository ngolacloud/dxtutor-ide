import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* Code review (ADR-0006, R2e2): no desktop com pasta, a tab junta às regras locais os
 * analisadores reais do projecto (`review_code`, IPC falso aqui). No browser nada muda. */

let w: any;
let calls: Array<Record<string, unknown>>;
let LX: string;

const REPORT = {
  version: null,
  analyzers: [
    { id: "clippy", language: "rust", status: "ran", detail: null, filesCovered: 1 },
    { id: "ruff", language: "python", status: "unavailable", detail: "ruff not found", filesCovered: 0 },
  ],
  findings: [
    {
      analyzer: "rustc", rule: "E0382", class: "bug", severity: "error", message: "borrow of moved value: `chars`",
      primary: { file: "crates/lexer/src/lib.rs", startLine: 10, startCol: 8, endLine: 10, endCol: 13, label: null },
      related: [], evidence: "value moved here", consequence: "does not compile", verification: "cargo check",
    },
    {
      analyzer: "clippy", rule: "clippy::needless_return", class: "opportunity", severity: "warning", message: "unneeded `return` statement",
      primary: { file: "crates/lexer/src/lib.rs", startLine: 13, startCol: 5, endLine: 13, endCol: 11, label: null },
      related: [], evidence: null, consequence: null, verification: null,
    },
  ],
};

function host(): HTMLElement {
  const h = document.createElement("div");
  document.body.appendChild(h);
  return h;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  w = await bootApp();
  calls = [];
  LX = w.ROOT + "crates/lexer/src/lib.rs";
});
afterEach(() => {
  delete w.__TAURI__;
  delete w.DXR;
  vi.restoreAllMocks();
});

describe("browser (sem pasta)", () => {
  it("só as regras locais: sem a secção dos analisadores", () => {
    const h = host();
    w.renderCreviewView({ path: LX }, h);
    expect(h.querySelector(".cr-analyzers")).toBe(null);
  });
});

describe("desktop com pasta: review_code", () => {
  beforeEach(() => {
    w.DXR = { root: "/proj" };
    w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, ...args }); return REPORT; } } };
  });

  it("pede a revisão do ficheiro (âmbito file, caminho relativo) e mostra os achados com a classe honesta", async () => {
    const h = host();
    w.renderCreviewView({ path: LX }, h);
    expect(h.querySelector(".cr-analyzers")!.textContent).toMatch(/Running the installed analyzers/);
    await flush();
    expect(calls).toEqual([{ cmd: "review_code", root: "/proj", scope: "file", path: "crates/lexer/src/lib.rs", version: null }]);
    const sec = h.querySelector(".cr-analyzers")!;
    expect(sec.textContent).toMatch(/borrow of moved value/);
    expect(sec.textContent).toMatch(/rustc · E0382/);
    expect(sec.textContent).toMatch(/Se ficar: does not compile/);
    expect(sec.textContent).toMatch(/Verificar: cargo check/);
    const tags = [...sec.querySelectorAll(".rv .tag")].map((t) => t.textContent);
    expect(tags).toEqual(["bug", "oportunidade"]);
    expect(sec.textContent).toMatch(/clippy · correu/);
    expect(sec.textContent).toMatch(/ruff · não instalado/);
  });

  it("«line N» abre o ficheiro na linha do achado", async () => {
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    const h = host();
    w.renderCreviewView({ path: LX }, h);
    await flush();
    h.querySelector<HTMLElement>('.cr-analyzers [data-action="open-line"]')!.click();
    expect(open).toHaveBeenCalledWith(LX, 10);
  });

  it("um resultado que chega depois de a tab mudar não pinta", async () => {
    let resolve!: (v: unknown) => void;
    w.__TAURI__.core.invoke = () => new Promise((r) => { resolve = r; });
    const h = host();
    w.renderCreviewView({ path: LX }, h);
    const old = h.querySelector(".cr-analyzers")!;
    h.innerHTML = "<p>outra tab</p>"; // a tab foi redesenhada / fechada
    resolve(REPORT);
    await flush();
    expect(old.textContent).toMatch(/Running/); // o nó antigo, fora do DOM, ficou como estava
    expect(h.textContent).toBe("outra tab");
  });

  it("sem achados, di-lo; um erro do backend diz-se", async () => {
    w.__TAURI__.core.invoke = async () => ({ ...REPORT, findings: [] });
    const h = host();
    w.renderCreviewView({ path: LX }, h);
    await flush();
    expect(h.querySelector(".cr-analyzers")!.textContent).toMatch(/No findings from the analyzers/);
    w.__TAURI__.core.invoke = async () => { throw new Error("review task failed: x"); };
    const h2 = host();
    w.renderCreviewView({ path: LX }, h2);
    await flush();
    expect(h2.querySelector(".cr-analyzers")!.textContent).toMatch(/A revisão falhou: review task failed: x/);
  });
});
