// U5 (ADR-0004): o despachante das acções delegadas partilhadas (src/app/actions.ts) tem de se
// comportar como os handlers inline que substitui — borbulhar pelos antepassados, `stop()` como o
// `event.stopPropagation()`, correr antes dos outros listeners do document, ceder a um
// `el.onclick = f` posterior — e a moldura do IDE (index.html) tem de chamar as mesmas funções.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

type Mod = typeof import("../src/app/actions");
let A: Mod;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  A = await import("../src/app/actions");
});

const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("despachante partilhado", () => {
  it("corre todos os antepassados com acção, de dentro para fora, como o inline borbulhava", () => {
    const seen: string[] = [];
    A.registerActions({ "t:outer": { click: (c) => seen.push("outer:" + c.on) }, "t:inner": { click: (c) => seen.push("inner:" + c.on) } });
    document.body.innerHTML = `<div data-action="t:outer" data-on="o"><button data-action="t:inner" data-on="i"><span id="x">x</span></button></div>`;
    click(document.getElementById("x")!);
    expect(seen).toEqual(["inner:i", "outer:o"]);
  });

  it("stop() pára os antepassados e os listeners do document registados depois", () => {
    const seen: string[] = [];
    A.registerActions({ "t:outer": { click: () => seen.push("outer") }, "t:inner": { click: (c) => { c.stop(); seen.push("inner"); } } });
    document.addEventListener("click", () => seen.push("document"));
    document.body.innerHTML = `<div data-action="t:outer"><button id="b" data-action="t:inner"></button></div>`;
    click(document.getElementById("b")!);
    expect(seen).toEqual(["inner"]);
  });

  it("corre antes dos listeners do document registados depois (o inline corria no elemento)", () => {
    const seen: string[] = [];
    A.registerActions({ "t:a": { click: () => seen.push("action") } });
    document.addEventListener("click", () => seen.push("document"));
    document.body.innerHTML = `<button id="b" data-action="t:a"></button>`;
    click(document.getElementById("b")!);
    expect(seen).toEqual(["action", "document"]);
  });

  it("cede a um `el.onclick = f` posterior (que trocava o handler inline)", () => {
    const seen: string[] = [];
    A.registerActions({ "t:a": { click: () => seen.push("action") } });
    document.body.innerHTML = `<button id="b" data-action="t:a"></button>`;
    const b = document.getElementById("b")!;
    b.onclick = () => seen.push("property");
    click(b);
    expect(seen).toEqual(["property"]);
  });

  it("o caminho fixa-se no início: um handler que redesenha não corta os antepassados", () => {
    const seen: string[] = [];
    A.registerActions({ "t:outer": { click: () => seen.push("outer") }, "t:inner": { click: (c) => { c.el.remove(); seen.push("inner"); } } });
    document.body.innerHTML = `<div data-action="t:outer"><button id="b" data-action="t:inner"></button></div>`;
    click(document.getElementById("b")!);
    expect(seen).toEqual(["inner", "outer"]);
  });

  it("responde só ao tipo de evento registado e passa o value dos campos", () => {
    const seen: string[] = [];
    A.registerActions({ "t:sel": { change: (c) => seen.push("change:" + c.value) }, "t:in": { input: (c) => seen.push("input:" + c.value) } });
    document.body.innerHTML = `<select id="s" data-action="t:sel"><option>a</option><option selected>b</option></select><input id="i" data-action="t:in" value="v">`;
    click(document.getElementById("s")!);
    document.getElementById("s")!.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("i")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toEqual(["change:b", "input:v"]);
  });

  it("aceita um nó de texto como alvo (arrastar texto) e ignora acções sem registo", () => {
    const seen: string[] = [];
    A.registerActions({ "t:a": { click: () => seen.push("a") } });
    document.body.innerHTML = `<div data-action="t:a"><span data-action="outra:coisa">texto</span></div>`;
    document.querySelector("span")!.firstChild!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual(["a"]);
  });

  it("exige dono no nome e recusa registos duplicados", () => {
    expect(() => A.registerActions({ semdono: { click: () => {} } })).toThrow(/sem dono/);
    A.registerActions({ "t:a": { click: () => {} } });
    expect(() => A.registerActions({ "t:a": { click: () => {} } })).toThrow(/duas vezes/);
  });

  it("args() descodifica o payload de várias partes", () => {
    let got: unknown;
    A.registerActions({ "t:a": { click: (c) => { got = A.args<[string, number]>(c); } } });
    document.body.innerHTML = `<button id="b" data-action="t:a" data-on='["p/x.rs",10]'></button>`;
    click(document.getElementById("b")!);
    expect(got).toEqual(["p/x.rs", 10]);
  });
});

describe("moldura do IDE (index.html) — U5a", () => {
  it("não tem handlers inline e cada botão chama a mesma função publicada, com o mesmo argumento", async () => {
    const w = await bootApp();
    expect(document.querySelectorAll("[onclick],[onchange],[oninput]").length).toBe(0);
    const W = w as unknown as Record<string, unknown>;
    const calls: string[] = [];
    for (const f of ["toggleSide", "togglePanel", "toggleAgent", "newFile", "newFolder", "collapseAll", "termClear", "pickModel",
      "assistantCenter", "openManager", "newChat", "pickBranch", "cycleMode", "toggleNotes", "refresh", "palette", "goPane", "agCtl", "setPanelTab"])
      W[f] = (...a: unknown[]) => calls.push(`${f}(${a.map((x) => JSON.stringify(x)).join(",")})`);
    const clickSel = (s: string) => click(document.querySelector(s)!);
    clickSel(".cmd-center"); clickSel("#tgl-side"); clickSel("#tgl-panel"); clickSel("#tgl-agent"); clickSel('.tb-ic[data-ic="account"]');
    clickSel('#pane-explorer [data-ic="refresh"]'); clickSel("#rc-pause"); clickSel("#st-prob"); clickSel("#st-tests"); clickSel("#st-pos"); clickSel("#st-mode"); clickSel("#st-bell");
    expect(calls).toEqual(['palette("")', "toggleSide()", "togglePanel()", "toggleAgent()", 'goPane("account")',
      "refresh(false,true)", 'agCtl("pause")', 'setPanelTab("problems")', 'goPane("test")', 'palette(":")', "cycleMode()", "toggleNotes()"]);
  });
});
