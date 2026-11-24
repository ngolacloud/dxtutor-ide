// U4b (ADR-0004): separadores do editor em features/tabs.ts, com a lista TB com dono.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let TM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7e)
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const titles = () => Array.from(document.querySelectorAll("#tabs .tab .nm")).map((e) => e.textContent);

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  TM = await import("../src/features/tabs");
  w.TB = []; // começa sem separadores (o boot do app.ts não corre no harness)
  w.show(null);
});

it("a lista de separadores tem dono: TB é o editorStore.tabs (mesmo array)", async () => {
  const { editorStore } = await import("../src/app/store/editor");
  expect(editorStore.tabs).toBe(w.TB);
  w.TB = [{ id: "x", title: "x", kind: "welcome" }]; // reatribuição como no boot do app.ts
  expect(editorStore.tabs).toBe(w.TB);
  expect(editorStore.tabs[0].id).toBe("x");
});

it("openPath abre e activa; o ecrã vazio volta quando se fecha o último", () => {
  const p = Object.keys(w.FS).find((k: string) => k.endsWith("/lib.rs"))!;
  w.openPath(p);
  expect(w.cur).toBe(p);
  expect(titles()).toEqual(["lib.rs"]);
  expect($("#tabs .tab.active .nm").textContent).toBe("lib.rs");
  expect($("#breadcrumbs").textContent).toContain("lib.rs");
  TM.closeTab(p);
  expect(w.cur).toBe(null);
  expect(titles()).toEqual([]);
  expect($("#ebody .empty").textContent).toContain("dxtutor IDE");
});

it("fechar o activo passa ao anterior; stepTab percorre em ciclo; ficheiro inexistente avisa", () => {
  const files = Object.keys(w.FS).filter((k: string) => k.endsWith(".rs")).slice(0, 3);
  files.forEach((p: string) => w.openPath(p));
  expect(w.cur).toBe(files[2]);
  TM.stepTab(1); // do último volta ao primeiro
  expect(w.cur).toBe(files[0]);
  TM.stepTab(-1);
  expect(w.cur).toBe(files[2]);
  TM.closeTab(files[2]);
  expect(w.cur).toBe(files[1]);
  TM.closeTab("nao-existe"); // sem efeito
  expect(w.TB.length).toBe(2);
  w.openPath("dxtutor/nao/existe.rs");
  expect(w.TB.length).toBe(2);
});

it("mudar de separador emite editor:tab no bus", async () => {
  const { bus } = await import("../src/app/bus");
  const seen: Array<string | null> = [];
  bus.on("editor:tab", (p) => seen.push(p.id));
  const [a, b] = Object.keys(w.FS).filter((k: string) => k.endsWith(".rs")).slice(0, 2);
  w.openPath(a);
  w.openPath(b);
  TM.setActive(a);
  expect(seen).toEqual([a, b, a]);
});
