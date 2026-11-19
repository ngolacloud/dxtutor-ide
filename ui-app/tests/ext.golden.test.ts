import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature `ext` / Open VSX) para
 * `ui-app/src/features/ext.ts`, via o harness que carrega a cadeia real de
 * módulos. Goldens de markup + caracterização do motor (catálogo/instalação/
 * toggle/remover/pesquisa/CMD/formatDoc), ANTES de extrair para Clean
 * Architecture. A partir daqui, diff de golden = regressão (corrige o código,
 * nunca o snapshot — ver skill ui-golden-check).
 *
 * Determinismo: o render do `ext` não usa Math.random nem Date (a cor das
 * linhas sai de charCodeAt → estável; o estado inicial é fixo). `projectContext`
 * deriva só de Object.keys(FS) semeado (VITE_SEED=1), logo a secção
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

beforeEach(async () => {
  vi.useFakeTimers();
  delete (window as any).EXS;
  w = await bootApp();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("goldens de DOM — pane de extensões e tab de detalhe", () => {
  it("#pane-ext (estado inicial: rust-analyzer instalado, recomendadas, Open VSX)", () => {
    w.renderExtPane();
    const el = document.querySelector("#pane-ext")!;
    expect(golden(el)).toMatchSnapshot();
  });

  it("tab de detalhe — rust-analyzer (bundled)", () => {
    const host = document.createElement("div");
    w.renderExtd({ ext: "rust-lang.rust-analyzer" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("tab de detalhe — Prettier (efeito ao vivo + comandos + botão Install)", () => {
    const host = document.createElement("div");
    w.renderExtd({ ext: "esbenp.prettier-vscode" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("tab de detalhe — GitLens (comando, não instalada)", () => {
    const host = document.createElement("div");
    w.renderExtd({ ext: "eamodio.gitlens" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("tab de detalhe — id inexistente (extensão removida)", () => {
    const host = document.createElement("div");
    w.renderExtd({ ext: "nao.existe" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("caracterização do motor Open VSX", () => {
  it("estado inicial: só rust-analyzer instalado (bundled, on); catálogo com 13", () => {
    expect(w.EXS.inst).toEqual({ "rust-lang.rust-analyzer": { on: 1 } });
    expect(w.EXS.vsix).toEqual([]);
    expect(w.extAll().length).toBe(13);
    expect(w.extOn("rust-lang.rust-analyzer")).toBeTruthy();
    expect(w.extOn("esbenp.prettier-vscode")).toBeFalsy();
  });

  it("instalar regista a extensão e os seus comandos na paleta (CMD tag 'ext')", () => {
    const antes = w.CMD.filter((c: any[]) => c[3] === "ext").length;
    w.extInstall("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"]).toEqual({ on: 1 });
    const depois = w.CMD.filter((c: any[]) => c[3] === "ext");
    expect(depois.length).toBe(antes + 1);
    expect(depois.map((c: any[]) => c[0])).toContain("Prettier: Format Document");
    // o pane passa a mostrar 2 instaladas
    w.renderExtPane();
    const cnt = document.querySelector("#pane-ext .scm-grp .cnt")!;
    expect(cnt.textContent).toBe("2");
  });

  it("toggle alterna on/off da extensão instalada", () => {
    w.extInstall("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"].on).toBe(1);
    w.extToggle("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"].on).toBe(false);
    w.extToggle("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"].on).toBe(true);
  });

  it("remover desinstala uma extensão não-bundled", () => {
    w.extInstall("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"]).toBeTruthy();
    w.extRemove("esbenp.prettier-vscode");
    expect(w.EXS.inst["esbenp.prettier-vscode"]).toBeUndefined();
  });

  it("remover NÃO desinstala uma extensão bundled (guarda)", () => {
    w.extRemove("rust-lang.rust-analyzer");
    expect(w.EXS.inst["rust-lang.rust-analyzer"]).toBeTruthy();
  });

  it("a pesquisa (#ex-q) filtra as linhas do pane", () => {
    w.renderExtPane();
    const qi = document.querySelector<HTMLInputElement>("#ex-q")!;
    qi.value = "prettier";
    qi.oninput!(new Event("input"));
    const rows = document.querySelectorAll("#pane-ext .ex-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Prettier");
  });

  it("formatDoc apara espaços finais, normaliza indentação e a última linha", () => {
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
