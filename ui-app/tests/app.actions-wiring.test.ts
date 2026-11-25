// U5b (ADR-0004): os resíduos que tinham `on*="…"` inline (tasks, team, studio, tutor, graph, search,
// test, run, remote, explorer, diff, diagnostics, account, stack, welcome) emitem agora
// `data-action="dono:nome"`. Este teste desenha os panes e as vistas e prova a cablagem: nenhum handler
// inline restante, todo o `dono:nome` do markup tem acção registada, e alguns cliques fazem o mesmo
// que o inline fazia (os goldens tiram data-action/data-on, por isso não o provam).
import { beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";

type W = Window & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let w: W;
let TKM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7f)
let hasAction: (n: string) => boolean;

beforeEach(async () => {
  w = (await bootApp()) as W;
  TKM = await import("../src/features/tasks");
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
    /* os botões de sprint vêm do backlog (ADR-0006, R3c): sem issues só há «All» */
    const agent = Object.keys(w.AGENTS).find((k) => k !== "lead" && k !== "tutor")!;
    w.BL.issues.push({ id: "DX-1", title: "x", type: "feature", pts: 1, stage: "todo", sprint: 0, agent, attempts: 0, tests: [], res: "", note: "" });
    w.RP.tasks();
    click(document.querySelector('#pane-tasks [data-action="tasks:sprint"][data-on="0"]'));
    expect(TKM.TK.sprint).toBe(0);
    expect(document.querySelector('#pane-tasks [data-action="tasks:sprint"][data-on="0"]')!.classList.contains("on")).toBe(true);
  });

  it("studio: o separador do catálogo escreve SCAT e o «Connect» alterna SLINK", async () => {
    const h = host(); w.VIEW.studio({ id: "studio", kind: "studio" }, h);
    click(h.querySelector('[data-action="studio:cat"][data-on="gcp"]'));
    const SM = await import("../src/features/studio");
    expect(SM.SCAT).toBe("gcp");
    click(h.querySelector('[data-action="studio:link"]'));
    expect(SM.SLINK).toBe("");
  });

  it("os payloads de várias partes chegam com os mesmos tipos (caminho + linha numérica)", () => {
    const calls: unknown[][] = [];
    w.openPath = (...a: unknown[]) => calls.push(a);
    w.gotoLine = (...a: unknown[]) => calls.push(["gotoLine", ...a]);
    /* os resultados da pesquisa e o Outline têm listeners próprios desde o ADR-0006 (R2b/R2c, data-p/data-on;
       provados em search.r2b.test.ts e outline.r2c.test.ts): aqui fica o caminho+linha do Problems */
    document.body.insertAdjacentHTML("beforeend", `<div class="prob" data-action="diagnostics:open" data-on='["dxtutor/src/lib.rs",12]'></div>`);
    click(document.querySelector('[data-action="diagnostics:open"]'));
    expect(calls).toEqual([["dxtutor/src/lib.rs", 12]]);
  });

  it("graph: o botão do ficheiro pára a borbulha (não selecciona o commit), como o event.stopPropagation()", async () => {
    const opened: unknown[] = [];
    w.openPath = (p: unknown) => opened.push(p);
    const SCMG = await import("../src/features/scm");
    SCMG.setGraphSel(null);
    w.FS["x/y.rs"] = { content: "" };
    document.body.insertAdjacentHTML("beforeend", `<div class="gl-row" data-action="graph:select" data-on="abc"><div class="gl-det"><button id="gf" data-action="graph:file" data-on="x/y.rs">y.rs</button></div></div>`);
    click(document.getElementById("gf"));
    expect(opened).toEqual(["x/y.rs"]);
    expect(SCMG.graphSel()).toBe(null);
    click(document.querySelector(".gl-row"));
    expect(SCMG.graphSel()).toBe("abc");
  });

  /* ext: a lista e o detalhe usam o despachante da própria feature desde o ADR-0006 (R6b: ext-open,
     ext-install, ext-toggle, builtin-toggle…), cujos cliques o ext.golden.test.ts prova. */

  it("learn (U5c): o nível alterna no ONB.levels do window e volta ao passo 2", async () => {
    const LMod = await import("../src/features/learn");
    Object.assign(LMod.ONB, { lang: "rust", levels: ["beginner"] });
    document.body.insertAdjacentHTML("beforeend", `<button id="lv" data-action="learn:level" data-on="advanced"></button><button id="lv2" data-action="learn:level" data-on="beginner"></button>`);
    click(document.getElementById("lv"));
    click(document.getElementById("lv2"));
    expect(LMod.ONB.levels).toEqual(["advanced"]);
    // volta ao passo 2 do onboarding (o dos níveis) — desde a U7g o learn chama o seu ltOnboard directamente
    expect(document.querySelectorAll('#onb [data-action="learn:level"]').length).toBeGreaterThan(0);
  });

  it("board (U5c): os botões que o motor emite chamam a função publicada, com o sprint como número", () => {
    const calls: unknown[][] = [];
    w.runSprint = (...a: unknown[]) => calls.push(["runSprint", ...a]);
    w.openGraph = (...a: unknown[]) => calls.push(["openGraph", ...a]);
    document.body.insertAdjacentHTML("beforeend", `<div class="gate"><button id="rs" class="gb" data-action="board:runSprint" data-on="0"></button><button id="og" class="gb" data-action="board:openGraph"></button></div>`);
    click(document.getElementById("rs"));
    click(document.getElementById("og"));
    expect(calls).toEqual([["runSprint", 0], ["openGraph"]]);
  });

  it("desktop (U5c): a aprovação de um comando chega ao DXR com o id e o booleano", async () => {
    await import("../src/platform/desktop/llm");
    const got: unknown[][] = [];
    w.DXR = { approve: (...a: unknown[]) => got.push(a) };
    document.body.insertAdjacentHTML("beforeend", `<button id="ok" data-action="desktop:approve" data-on='["t1",true]'></button><button id="no" data-action="desktop:approve" data-on='["t1",false]'></button>`);
    click(document.getElementById("ok"));
    click(document.getElementById("no"));
    expect(got).toEqual([["t1", true], ["t1", false]]);
  });

  it("board (U5d): arrastar um cartão para outra coluna marca a coluna e chama o dropIssue com o id e o estágio", () => {
    const drops: unknown[][] = [];
    w.dropIssue = (...a: unknown[]) => drops.push(a);
    document.body.insertAdjacentHTML("beforeend", `<div class="kcol" id="c1" data-action="board:col" data-on="dev"><div class="kc" id="k1" draggable="true" data-action="board:card" data-on="DX-7"><span id="kt">t</span></div></div>`);
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] };
    const fire = (el: Element, type: string) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, "dataTransfer", { value: dt }); el.dispatchEvent(e); return e; };
    fire(document.getElementById("kt")!, "dragstart");
    expect(store["text/plain"]).toBe("DX-7");
    const over = fire(document.getElementById("kt")!, "dragover");
    expect(over.defaultPrevented).toBe(true);
    expect(document.getElementById("c1")!.classList.contains("over")).toBe(true);
    fire(document.getElementById("c1")!, "dragleave");
    expect(document.getElementById("c1")!.classList.contains("over")).toBe(false);
    fire(document.getElementById("c1")!, "dragover");
    const drop = fire(document.getElementById("k1")!, "drop");
    expect(drop.defaultPrevented).toBe(true);
    expect(document.getElementById("c1")!.classList.contains("over")).toBe(false);
    expect(drops).toEqual([["DX-7", "dev"]]);
  });
});
