import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* A feature Testing ligada de ponta a ponta na cadeia real de módulos (ADR-0006, R2a), com o
 * IPC do Tauri falso: o pane (via o `RP.test` do app.ts), a barra de estado e o dispatch
 * delegado. O `__TAURI__` falso entra DEPOIS do boot (o painel desktop não arranca). */

let w: any;
let calls: Array<[string, Record<string, unknown>]>;

const ITEMS = [
  { name: "soma", path: "tests::soma", file: "src/lib.rs", line: 3, ignored: false, lang: "rust" },
  { name: "falha", path: "tests::falha", file: "src/lib.rs", line: 9, ignored: false, lang: "rust" },
];

function fakeTauri(handlers: Record<string, (a: Record<string, unknown>) => unknown>): void {
  w.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        calls.push([cmd, args]);
        if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd);
        return handlers[cmd](args);
      },
    },
  };
}

const pane = (): HTMLElement => document.getElementById("pane-test")!;
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(async () => {
  w = await bootApp();
  calls = [];
});

afterEach(() => {
  delete w.__TAURI__;
  delete w.DXR;
  vi.restoreAllMocks();
});

describe("sem pasta (browser)", () => {
  it("o pane diz como abrir uma pasta e não chama o backend", () => {
    fakeTauri({});
    w.RP.test();
    expect(pane().textContent).toMatch(/Abre uma pasta/);
    expect(calls).toEqual([]);
  });
});

describe("com pasta (desktop, IPC falso)", () => {
  beforeEach(() => {
    w.DXR = { root: "/proj", projectCmd: () => ({ cmd: "npm test" }) };
    fakeTauri({
      list_tests: () => ITEMS,
      run_test: (a) => ({ ran: true, passed: a.path === "tests::soma", output: a.path === "tests::soma" ? "ok" : "thread panicked: assertion failed" }),
      run_all_tests: () => ({ ran: true, passed: false, output: "test tests::soma ... ok\ntest tests::falha ... FAILED" }),
    });
  });

  it("descobre os testes ao abrir o pane e lista-os por ficheiro", async () => {
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().textContent).toMatch(/falha/));
    expect(calls[0]).toEqual(["list_tests", { root: "/proj" }]);
    expect(pane().textContent).toMatch(/src\/lib\.rs/);
    expect(pane().textContent).toMatch(/npm test/); // o comando do projecto continua disponível
  });

  it("▶ corre um teste com run_test; a falha mostra a saída real e a barra de estado conta", async () => {
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="run-test"]')).toBeTruthy());
    click(pane().querySelector('[data-action="run-test"][data-on="src/lib.rs::tests::falha"]')!);
    await vi.waitFor(() => expect(pane().textContent).toMatch(/assertion failed/));
    expect(calls).toContainEqual(["run_test", { root: "/proj", path: "tests::falha", lang: "rust" }]);
    expect(document.getElementById("st-tests")!.textContent).toBe("✓ 0 ✗ 1");
  });

  it("«Run all» corre a suíte com run_all_tests e marca cada teste pela saída", async () => {
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="run-all"]:not([disabled])')).toBeTruthy());
    click(pane().querySelector('[data-action="run-all"]')!);
    await vi.waitFor(() => expect(document.getElementById("st-tests")!.textContent).toBe("✓ 1 ✗ 1"));
    expect(calls).toContainEqual(["run_all_tests", { root: "/proj" }]);
    expect(pane().textContent).toMatch(/Última corrida da suíte/);
  });

  it("clicar num teste abre o ficheiro na linha", async () => {
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="open-test"]')).toBeTruthy());
    click(pane().querySelector('[data-action="open-test"][data-on="src/lib.rs::tests::falha"] .nm')!);
    expect(open).toHaveBeenCalledWith(w.ROOT + "src/lib.rs", 9);
  });

  it("«Correr no terminal» corre o comando de testes do projecto num terminal de tarefa", async () => {
    const run = vi.spyOn(w, "runTask").mockImplementation(() => {});
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="run-project-cmd"]')).toBeTruthy());
    click(pane().querySelector('[data-action="run-project-cmd"]')!);
    expect(run).toHaveBeenCalledWith("npm test");
  });
});
