// U5b (ADR-0004): os resíduos que tinham `on*="…"` inline (tasks, team, studio, tutor, graph, search,
// test, run, remote, explorer, diff, diagnostics, account, stack, welcome) emitem agora
// `data-action="dono:nome"`. Este teste desenha os panes e as vistas e prova a cablagem: nenhum handler
// inline restante, todo o `dono:nome` do markup tem acção registada, e alguns cliques fazem o mesmo
// que o inline fazia (os goldens tiram data-action/data-on, por isso não o provam).
import { beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";

type W = Window & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let w: W;
let hasAction: (n: string) => boolean;

beforeEach(async () => {
  w = (await bootApp()) as W;
  ({ hasAction } = await import("../src/app/actions"));
  const side = document.querySelector(".side")!;
  for (const p of ["tasks", "tutor", "search", "test", "run", "remote", "account"])
    if (!document.getElementById("pane-" + p)) side.insertAdjacentHTML("beforeend", `<div class="pane" id="pane-${p}"></div>`);
});

const click = (el: Element | null) => { expect(el).not.toBeNull(); el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); };
const host = () => { const h = document.createElement("div"); document.body.appendChild(h); return h; };

function assertWired(root: ParentNode): number {
  expect(root.querySelectorAll("[onclick],[onchange],[oninput]").length).toBe(0);
  const named = [...root.querySelectorAll<HTMLElement>("[data-action]")].map((e) => e.dataset.action!).filter((a) => a.includes(":"));
  for (const a of named) expect(hasAction(a), a).toBe(true);
  return named.length;
}

describe("cablagem das acções partilhadas (U5b)", () => {
  it("os panes laterais não têm handlers inline e todas as acções têm dono", () => {
    let n = 0;
    for (const p of ["tasks", "tutor", "search", "test", "run", "remote", "account"]) { w.RP[p](); n += assertWired(document.getElementById("pane-" + p)!); }
    expect(n).toBeGreaterThan(5);
  });

  it("as vistas (Studio, Team, grafo, boas-vindas) não têm handlers inline e todas as acções têm dono", () => {
    for (const v of ["studio", "team", "graph", "welcome"]) { const h = host(); w.VIEW[v]({ id: v, kind: v }, h); assertWired(h); }
  });

  it("tasks: o filtro de sprint escreve TK.sprint (número) e redesenha", () => {
    w.RP.tasks();
    click(document.querySelector('#pane-tasks [data-action="tasks:sprint"][data-on="0"]'));
    expect(w.TK.sprint).toBe(0);
    expect(document.querySelector('#pane-tasks [data-action="tasks:sprint"][data-on="0"]')!.classList.contains("on")).toBe(true);
  });

  it("studio: o separador do catálogo escreve SCAT e o «Connect» alterna SLINK", () => {
    const h = host(); w.VIEW.studio({ id: "studio", kind: "studio" }, h);
    click(h.querySelector('[data-action="studio:cat"][data-on="gcp"]'));
    expect(w.SCAT).toBe("gcp");
    click(h.querySelector('[data-action="studio:link"]'));
    expect(w.SLINK).toBe("");
  });

  it("os payloads de várias partes chegam com os mesmos tipos (caminho + linha numérica)", () => {
    const calls: unknown[][] = [];
    w.openPath = (...a: unknown[]) => calls.push(a);
    w.gotoLine = (...a: unknown[]) => calls.push(["gotoLine", ...a]);
    document.body.insertAdjacentHTML("beforeend", `<div class="prob" data-action="diagnostics:open" data-on='["dxtutor/src/lib.rs",12]'></div><div data-action="search:hit" data-on='["a/b.rs",3]'></div><div data-action="explorer:gotoLine" data-on="7"></div>`);
    click(document.querySelector('[data-action="diagnostics:open"]'));
    click(document.querySelector('[data-action="search:hit"]'));
    click(document.querySelector('[data-action="explorer:gotoLine"]'));
    expect(calls).toEqual([["dxtutor/src/lib.rs", 12], ["a/b.rs", 3], ["gotoLine", 7]]);
  });

  it("graph: o botão do ficheiro pára a borbulha (não selecciona o commit), como o event.stopPropagation()", () => {
    const opened: unknown[] = [];
    w.openPath = (p: unknown) => opened.push(p);
    w.GSEL = null;
    w.FS["x/y.rs"] = { content: "" };
    document.body.insertAdjacentHTML("beforeend", `<div class="gl-row" data-action="graph:select" data-on="abc"><div class="gl-det"><button id="gf" data-action="graph:file" data-on="x/y.rs">y.rs</button></div></div>`);
    click(document.getElementById("gf"));
    expect(opened).toEqual(["x/y.rs"]);
    expect(w.GSEL).toBe(null);
    click(document.querySelector(".gl-row"));
    expect(w.GSEL).toBe("abc");
  });
});
