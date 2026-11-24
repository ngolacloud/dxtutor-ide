// U4c (ADR-0004): syncTree/fIcon (eram do app.ts) e sel (era do boot.ts) em features/explorer.ts.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let WSM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7f)
let EM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7e)
beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  EM = await import("../src/features/explorer");
  WSM = await import("../src/features/workspace");
});

it("syncTree reconstrói a árvore a partir do FS: pastas primeiro, por nome", () => {
  w.FS["dxtutor/zz/novo.rs"] = { content: "", orig: null };
  w.FS["dxtutor/aa.md"] = { content: "", orig: null };
  w.syncTree();
  const root = w.TREE.projects.children.dxtutor;
  const keys = Object.keys(root.children);
  const dirs = keys.filter((k) => root.children[k].dir);
  const files = keys.filter((k) => !root.children[k].dir);
  expect(keys).toEqual([...dirs, ...files]); // pastas antes dos ficheiros
  expect(dirs).toEqual([...dirs].sort((a, b) => a.localeCompare(b)));
  expect(root.children.zz.children["novo.rs"]).toEqual({ path: "dxtutor/zz/novo.rs" });
  expect(root.children.zz.dpath).toBe("dxtutor/zz");
});

it("fIcon escolhe o ícone pela extensão", () => {
  expect(w.fIcon("a/lib.rs")).toContain('class="ic x-rs"');
  expect(w.fIcon("README.md")).toContain('class="ic x-md"');
  expect(w.fIcon("db/001.sql")).toContain('class="ic x-sql"');
  expect(w.fIcon("Makefile")).toContain('class="ic x-"');
});

it("sel deixa uma só linha seleccionada", () => {
  document.body.insertAdjacentHTML("beforeend", '<div class="row" id="r1"></div><div class="row sel" id="r2"></div>');
  EM.sel(document.getElementById("r1"));
  expect(document.querySelectorAll(".row.sel").length).toBe(1);
  expect(document.getElementById("r1")!.classList.contains("sel")).toBe(true);
});

it("sem pasta aberta: a árvore fica vazia e o explorador mostra o estado vazio (sem pastas inventadas)", () => {
  WSM.resetWorkspace();
  w.syncTree();
  expect(w.TREE.projects.children).toEqual({});
  w.buildExplorer();
  const tree = document.querySelector("#exp-sections .tree")!;
  expect(tree.textContent).toContain("No folder open.");
  expect(tree.querySelector(".row")).toBeNull();
  expect(tree.querySelector("button")).toBeNull(); // no browser não há DXR: sem «Abrir pasta…»
});

it("sem pasta aberta no desktop: «Abrir pasta…» chama o DXR.open", () => {
  let opened = 0;
  w.DXR = { open: () => opened++ };
  try {
    WSM.resetWorkspace();
    w.syncTree();
    w.buildExplorer();
    const btn = document.querySelector("#exp-sections .tree button") as HTMLButtonElement;
    expect(btn.textContent).toBe("Abrir pasta…");
    btn.click();
    expect(opened).toBe(1);
  } finally {
    delete w.DXR;
  }
});
