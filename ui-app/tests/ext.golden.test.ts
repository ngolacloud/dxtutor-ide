import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature `ext` / Open VSX) para
 * `ui-app/src/features/ext.ts`, via o harness que carrega a cadeia real de
 * módulos. Goldens de markup + caracterização do motor (catálogo/instalação/
 * toggle/remover/pesquisa/CMD/formatDoc), ANTES de extrair para Clean
 * Architecture. A partir daqui, diff de golden = regressão (corrige o código,
 * nunca o snapshot — ver skill ui-golden-check).
 *
 * ADR-0006, R6b: já não há catálogo fixo (13 extensões escritas à mão, uma «bundled» nunca
 * instalada, três «com efeito» que eram código do dxtutor). Os goldens e a caracterização
 * passam ao pane real: instaladas (VSIX), recomendadas pela pilha do projecto (ids reais do Open
 * VSX), pesquisa no Open VSX (só desktop) e as funcionalidades do dxtutor. Decisão registada no
 * ADR-0006.
 *
 * Determinismo: o render do `ext` não usa Math.random nem Date (a cor das
 * linhas sai de charCodeAt → estável; o estado inicial é fixo). `projectContext`
 * deriva só de Object.keys(FS) (a fixture sample-workspace do harness), logo a secção
 * «Recommended» é estável. Timers falsos só para neutralizar o setTimeout do
 * toast e o polling de arranque — não há relógio a caracterizar.
 *
 * Isolamento: `isolate:true` do vitest é por FICHEIRO; dentro deste ficheiro os
 * testes partilham `window`. Como `EXS` é window-backed (`window.EXS`),
 * apaga-se antes de cada boot para o estado inicial ser limpo. (O `LS` do app
 * não persiste neste jsdom — localStorage sem clear/getItem reais —, por isso
 * não há fuga por LS; só por `window.EXS`.)
 *
 * Nota: chamamos `renderExtPane()`/`renderExtd()` DIRECTAMENTE (não via
 * `RP.ext`/`VIEW.extd`), tal como o golden do Co-Dev chama `renderCodevPane()`:
 * o harness exclui v5/v6, logo os shims de v6 não existem aqui e `RP.ext` seria
 * a versão morta de app.ts — a função a extrair é a de ext.ts. */

let w: any;
let DP: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o desktopPorts da cadeia do bootApp (U7k)

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear(); // o estado instalado (ext7) não passa de um teste para o outro
  delete (window as any).EXS;
  w = await bootApp();
  DP = (await import("../src/app/desktop")).desktopPorts;
});

afterEach(() => {
  delete (window as any).__TAURI__;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

/** Um VSIX mínimo (o JSZip do harness é falso: devolve estes ficheiros). */
function fakeJSZip(pkg: Record<string, unknown>) {
  const files: Record<string, string> = { "extension/package.json": JSON.stringify(pkg) };
  const zip = { file: (p: string) => (p in files ? { async: async () => files[p] } : null), files: {} };
  DP.ext = { loadJSZip: async () => ({ loadAsync: async () => zip }) }; // a porta desktop (U7k — era o window.loadJSZip)
}

describe("goldens de DOM — pane de extensões e tab de detalhe", () => {
  it("#pane-ext no browser: nada instalado, recomendadas pela pilha do projecto, funcionalidades do dxtutor", () => {
    w.renderExtPane();
    expect(golden(document.getElementById("pane-ext")!)).toMatchSnapshot();
  });

  it("tab de detalhe — uma recomendação ainda por instalar", () => {
    const id = w.extAll().find((x: any) => x.why)!.id;
    const host = document.createElement("div");
    w.renderExtd({ ext: id }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("tab de detalhe — id inexistente (extensão removida)", () => {
    const host = document.createElement("div");
    w.renderExtd({ ext: "nobody.nothing" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("o pane real (ADR-0006, R6b)", () => {
  it("estado inicial: nada instalado, nenhuma extensão «bundled»; as funcionalidades nascem desligadas", () => {
    expect(w.EXS).toEqual({ inst: {}, vsix: [], builtin: {} });
    expect(w.EXT).toBeUndefined();
    expect(w.builtinOn("inline-diagnostics")).toBe(false);
    expect(w.builtinOn("yaml")).toBe(false);
  });

  it("as recomendações são ids reais do Open VSX escolhidos pela pilha do projecto", () => {
    const rec = w.extAll().filter((x: any) => x.why).map((x: any) => x.id);
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((id: string) => /^[\w-]+\.[\w-]+$/.test(id))).toBe(true);
    w.renderExtPane();
    expect(document.querySelector("#pane-ext")!.textContent).toMatch(/Recommended for this project/);
  });

  it("no browser, Install diz que precisa da app desktop e não instala nada", async () => {
    const toast = vi.spyOn(w, "toast");
    w.renderExtPane();
    click(document.querySelector('#pane-ext [data-action="ext-install"]')!);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/needs the desktop app/)));
    expect(w.EXS.inst).toEqual({});
  });

  it("no desktop, Install descarrega o VSIX do Open VSX e instala-o (com os comandos na paleta)", async () => {
    const calls: string[] = [];
    w.__TAURI__ = { core: { invoke: async (cmd: string, a: any) => { calls.push(cmd + ":" + (a.id || a.query)); return btoa("PK"); } } };
    fakeJSZip({ publisher: "rust-lang", name: "rust-analyzer", displayName: "rust-analyzer", version: "0.4.1", contributes: { commands: [{ title: "Restart server", category: "rust-analyzer", command: "ra.restart" }] } });
    await w.extInstall("rust-lang.rust-analyzer");
    expect(calls).toEqual(["vsix_fetch_open_vsx:rust-lang.rust-analyzer"]);
    expect(w.EXS.inst["rust-lang.rust-analyzer"]).toEqual({ on: 1 });
    expect(w.EXS.vsix[0]).toMatchObject({ id: "rust-lang.rust-analyzer", ver: "0.4.1", vsix: 1 });
    expect(w.CMD.some((c: any) => c[0] === "rust-analyzer: Restart server" && c[3] === "ext")).toBe(true);
  });

  it("no desktop, a pesquisa vai ao Open VSX (com debounce) e mostra os resultados com os números reais", async () => {
    const calls: string[] = [];
    w.__TAURI__ = { core: { invoke: async (cmd: string, a: any) => { calls.push(cmd + ":" + a.query); return [{ id: "golang.go", name: "Go", publisher: "golang", description: "Rich Go language support", version: "0.1.0", downloads: 1234567, verified: true }]; } } };
    w.PANE = "ext";
    w.renderExtPane();
    const qi = document.getElementById("ex-q") as HTMLInputElement;
    qi.value = "go"; qi.oninput!(new Event("input"));
    expect(document.querySelector("#pane-ext")!.textContent).toMatch(/Searching Open VSX/);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toEqual(["vsix_search_open_vsx:go"]);
    const t = document.querySelector("#pane-ext")!.textContent || "";
    expect(t).toMatch(/Rich Go language support/);
    expect(t).toMatch(/1\.2M downloads · verified/);
  });

  it("toggle e remover agem sobre um VSIX instalado", () => {
    w.EXS.vsix.push({ id: "acme.demo", n: "Demo", pub: "acme", d: "", ctx: [], vsix: 1 });
    w.EXS.inst["acme.demo"] = { on: 1 };
    w.extToggle("acme.demo");
    expect(w.EXS.inst["acme.demo"].on).toBe(false);
    w.extRemove("acme.demo");
    expect(w.EXS.inst["acme.demo"]).toBeUndefined();
    expect(w.EXS.vsix).toEqual([]);
  });

  it("as funcionalidades do dxtutor ligam-se no pane (diagnósticos na linha)", () => {
    w.renderExtPane();
    click(document.querySelector('#pane-ext [data-action="builtin-toggle"][data-on="inline-diagnostics"]')!);
    expect(w.builtinOn("inline-diagnostics")).toBe(true);
  });

  it("formatDoc (Format Document do dxtutor) apara espaços finais, normaliza indentação e a última linha", () => {
    w.FS["scratch.ts"] = { content: "const a=1   \n\tb\n\n\n" };
    w.openTab({ id: "f:scratch.ts", path: "scratch.ts", kind: "file", title: "scratch.ts" }, false);
    (window as any).cur = "f:scratch.ts";
    w.formatDoc();
    expect(w.FS["scratch.ts"].content).toBe("const a=1\n    b\n");
  });

  it("formatDoc sem ficheiro aberto não altera nada nem rebenta (guarda)", () => {
    (window as any).cur = null;
    expect(() => w.formatDoc()).not.toThrow();
  });
});
