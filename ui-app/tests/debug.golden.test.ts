import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança da feature Run and Debug (`ui-app/src/features/debug.ts`), via o
 * harness que carrega a cadeia real de módulos.
 *
 * ADR-0006, R1c2 (decisão registada no ADR): as sessões simuladas saíram — o passo-a-passo
 * guionado do lexer de demonstração e as sondas `kubectl` inventadas a um pod em crash —
 * e com elas os goldens `pane-pre-session`/`feed-pre-session`/`pane-code-session`/
 * `feed-code-session`, as caracterizações `lexTrace-*`/`crashTrace-dns`/`debugConfigs`
 * e os testes de dispatch de start/step/watch-add. Ficam: os goldens do pane e do
 * assistente sem depurador (regenerados — o texto passou a dizer que não há adaptador
 * ligado), o pane com breakpoints, o dispatch dos breakpoints e a semântica do Set.
 *
 * Diff de golden = regressão (corrige o código, nunca o snapshot — ver skill
 * ui-golden-check).
 *
 * Fixtures do runtime que o harness exclui (vivem em v6.ts/boot6): os containers
 * #pane-debug e #pc-dbg, reproduzidos 1:1 em `provideV6Fixtures()`. */

let w: any;
/** Um ficheiro da fixture do harness (tests/fixtures/sample-workspace.ts). */
let LX: string;

/** Reproduz as peças que v6.ts/boot6 dão em runtime e o harness exclui. */
function provideV6Fixtures(): void {
  const side = document.querySelector(".side");
  if (side && !document.getElementById("pane-debug")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-debug"></div>');
  const pb = document.querySelector(".panel-body");
  if (pb && !document.getElementById("pc-dbg")) pb.insertAdjacentHTML("beforeend", '<div class="pcontent" id="pc-dbg"></div>');
}

function paneGolden(): string { return golden(document.getElementById("pane-debug")!); }
function feedGolden(): string { return golden(document.getElementById("pc-dbg")!); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // O `window` persiste entre testes no jsdom; `debug.ts` reutiliza o `window.BPS`
  // existente ao reavaliar. Limpar ANTES do boot para cada teste arrancar sem breakpoints.
  if ((window as any).BPS instanceof Set) (window as any).BPS.clear();
  w = await bootApp();
  // `toggleBp` grava em LS («bps6»), que sobrevive entre testes neste jsdom; a hidratação
  // é preguiçosa (na primeira entrada), por isso esvaziar aqui chega.
  w.LS.set("bps6", []);
  provideV6Fixtures();
  LX = w.ROOT + "crates/lexer/src/lib.rs";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — Run and Debug (renderDebugPane / drawDbg)", () => {
  it("sem sessão: o pane oferece começar (gdb) e o assistente explica como", () => {
    w.renderDebugPane();
    w.drawDbg();
    expect(paneGolden()).toMatchSnapshot("pane-no-session");
    expect(feedGolden()).toMatchSnapshot("feed-no-session");
  });

  it("com breakpoints: a lista mostra ficheiro e linha", () => {
    w.toggleBp(LX, 5);
    w.toggleBp(LX, 10);
    w.renderDebugPane();
    expect(paneGolden()).toMatchSnapshot("pane-breakpoints");
  });
});

describe("sem sessões simuladas (ADR-0006, R1c2)", () => {
  it("os motores e geradores simulados já não são publicados", () => {
    for (const n of ["dbgState", "dbgFeed", "dbgApplyClone", "dbgFix", "dbgFinish", "lexTrace", "crashTrace", "debugConfigs", "dbgLaunch", "lexVariant", "LXL", "lexBug"]) {
      expect(w[n], n).toBeUndefined();
    }
  });
});

/* ADR-0006, R4 — depuração real pelo gdb do backend (`debug_*`, IPC falso aqui). */
describe("sessão real (gdb, IPC falso)", () => {
  let calls: Array<[string, any]>;
  let stops: any[];
  const msg = () => document.getElementById("pane-debug")!.textContent || "";
  const ipc = (handlers: Record<string, (a: any) => unknown>) => {
    w.__TAURI__ = { core: { invoke: async (cmd: string, a: any) => { calls.push([cmd, a]); if (!handlers[cmd]) throw new Error("inesperado " + cmd); return handlers[cmd](a); } } };
  };
  beforeEach(() => { calls = []; stops = []; });
  afterEach(() => { delete w.__TAURI__; delete w.DXR; });

  it("sem pasta, diz para abrir uma (e não chama o backend)", async () => {
    ipc({});
    await w.startDebug();
    expect(msg()).toMatch(/Open a folder/);
    expect(calls).toEqual([]);
  });

  it("sem gdb, di-lo com o que instalar e não cria sessão", async () => {
    w.DXR = { root: "/proj" };
    ipc({ debug_available: () => false });
    await w.startDebug();
    expect(msg()).toMatch(/gdb is not installed/);
    expect(document.querySelector("#pane-debug .dbg-ctl")).toBe(null);
  });

  it("um workspace Cargo só com bibliotecas não tem programa para correr", async () => {
    w.DXR = { root: "/proj", exec: vi.fn(async () => ({ ok: true })) };
    ipc({ debug_available: () => true });
    await w.startDebug();
    expect(msg()).toMatch(/has no binaries/);
    expect(w.DXR.exec).not.toHaveBeenCalled();
  });

  it("constrói, lança o gdb, põe os breakpoints, corre e pára: variáveis, pilha, editor na linha; step; até ao fim", async () => {
    w.FS[w.ROOT + "crates/app/Cargo.toml"] = { content: '[package]\nname = "app"\n', orig: null };
    w.FS[w.ROOT + "crates/app/src/main.rs"] = { content: "fn main() {\n    let x = 1;\n    println!(\"{x}\");\n}\n", orig: null };
    w.DXR = { root: "/proj", exec: vi.fn(async () => ({ ok: true, out: "Finished" })) };
    w.toggleBp(w.ROOT + "crates/app/src/main.rs", 2);
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    stops = [
      { stopped: true, reason: "breakpoint-hit", func: "app::main", file: "/proj/crates/app/src/main.rs", line: 2, exited: false, exitCode: null },
      { stopped: true, reason: "end-stepping-range", func: "app::main", file: "/proj/crates/app/src/main.rs", line: 3, exited: false, exitCode: null },
      { stopped: true, reason: "exited-normally", func: "", file: "", line: 0, exited: true, exitCode: 0 },
    ];
    ipc({
      debug_available: () => true, debug_launch: () => null, debug_break: () => 1,
      debug_run: () => stops[0], debug_step: () => stops[1], debug_continue: () => stops[2],
      debug_locals: () => [{ name: "x", value: "1" }], debug_stack: () => [{ level: 0, func: "app::main", file: "/proj/crates/app/src/main.rs", line: 2 }],
      debug_stop: () => null,
    });
    w.PANE = "debug";
    await w.startDebug();
    expect(w.DXR.exec).toHaveBeenCalledWith("cargo build");
    expect(calls.map((c) => c[0])).toEqual(["debug_available", "debug_launch", "debug_break", "debug_run", "debug_locals", "debug_stack"]);
    expect(calls[1][1]).toMatchObject({ program: "/proj/target/debug/app", cwd: "/proj" });
    expect(calls[2][1]).toMatchObject({ file: "crates/app/src/main.rs", line: 2 });
    expect(msg()).toMatch(/Parado em app::main/);
    expect(msg()).toMatch(/x1/); // a variável local
    expect(open).toHaveBeenCalledWith(w.ROOT + "crates/app/src/main.rs", 2);
    expect(w.dbgCurrent()).toEqual({ path: w.ROOT + "crates/app/src/main.rs", line: 2 });

    await w.dbgStep();
    expect(calls.some((c) => c[0] === "debug_step" && c[1].into === false)).toBe(true);
    expect(w.dbgCurrent()!.line).toBe(3);

    await w.startDebug(); // F5 parado = continuar
    expect(calls.some((c) => c[0] === "debug_continue")).toBe(true);
    expect(calls[calls.length - 1][0]).toBe("debug_stop");
    expect(msg()).toMatch(/O programa terminou com o código 0/);
    expect(w.dbgCurrent()).toBe(null);
  });

  it("um erro do gdb diz-se e fecha a sessão", async () => {
    w.FS[w.ROOT + "crates/app/Cargo.toml"] = { content: '[package]\nname = "app"\n', orig: null };
    w.FS[w.ROOT + "crates/app/src/main.rs"] = { content: "fn main() {}\n", orig: null };
    w.DXR = { root: "/proj", exec: vi.fn(async () => ({ ok: true })) };
    ipc({ debug_available: () => true, debug_launch: () => { throw new Error("gdb not found on PATH"); }, debug_stop: () => null });
    await w.startDebug();
    expect(msg()).toMatch(/Debugging failed: gdb not found on PATH/);
    expect(document.querySelector("#pane-debug .dbg-ctl")).toBe(null);
  });
});

describe("dispatch delegado (data-action) — Fase 4", () => {
  // O golden strippa data-action/data-on, logo NÃO prova que o listener delegado
  // dispara. Estes testes disparam eventos reais e observam o efeito.
  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  it("bp-del: clicar «×» de um breakpoint remove-o do Set (closest vence a linha)", () => {
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(LX + ":7")).toBe(true);
    w.renderDebugPane();
    const del = document.querySelector(`#pane-debug [data-action="bp-del"][data-on="${LX}:7"]`)!;
    expect(del).toBeTruthy();
    click(del);
    expect(w.dbgBreaks.has(LX + ":7")).toBe(false);
  });

  it("open-bp: clicar a linha abre o ficheiro na linha do breakpoint", () => {
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    w.toggleBp(LX, 7);
    w.renderDebugPane();
    click(document.querySelector(`#pane-debug .scm-row[data-on="${LX}:7"] .nm`)!);
    expect(open).toHaveBeenCalledWith(LX, 7);
  });
});

describe("caracterização do motor — breakpoints (toggleBp/BPS)", () => {
  // Só a semântica do Set (chave `path:line`, alternância idempotente); a persistência
  // em LS é porta de infra e o beforeEach esvazia-a.
  it("BPS nasce vazio para cada teste", () => {
    expect([...w.dbgBreaks]).toEqual([]);
  });

  it("toggleBp alterna por chave path:line (add/remove idempotente)", () => {
    const key = LX + ":7";
    expect(w.dbgBreaks.has(key)).toBe(false);
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(true);
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(false);
  });
});
