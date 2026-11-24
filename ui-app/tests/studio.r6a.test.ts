import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { sampleDesign } from "./fixtures/sample-design";

/* ADR-0006, R6a: o Studio já não abre um desenho semeado. O desenho nasce vazio e é do projecto:
 * com uma pasta aberta, `.dxtutor/studio.json` (versionável); sem pasta, o localStorage (chave
 * `studio4` — a `studio3` guardava o desenho semeado). O harness põe o desenho do projecto-exemplo
 * (tests/fixtures/sample-design.ts); aqui parte-se do que a app tem sem ele. */

let w: any;
const P = () => w.ROOT + ".dxtutor/studio.json";

beforeEach(async () => {
  localStorage.clear();
  w = await bootApp();
});

afterEach(() => {
  delete w.DXR;
  vi.restoreAllMocks();
});

describe("sem pasta (browser)", () => {
  it("sem nada guardado, o desenho é vazio e o canvas di-lo", () => {
    w.SD = w.loadSD();
    expect(w.SD).toEqual({ nodes: [], edges: [] });
    const host = document.createElement("div"); document.body.appendChild(host);
    w.VIEW.studio({}, host);
    expect(host.textContent).toMatch(/Empty design/);
    expect(host.textContent).not.toMatch(/Orders API|Billing Worker/);
    host.remove();
  });

  it("guarda no localStorage (studio4) e lê de volta; o studio3 antigo (semeado) é ignorado", () => {
    localStorage.setItem("dx2.studio3", JSON.stringify(sampleDesign()));
    expect(w.loadSD().nodes).toEqual([]);
    w.SD = { nodes: [{ id: "a", tech: "rust-axum", n: "API", x: 10, y: 10, st: "plan" }], edges: [] };
    w.saveSD();
    expect(w.loadSD().nodes.map((n: any) => n.n)).toEqual(["API"]);
  });

  it("um desenho guardado com tecnologia desconhecida não abre (fica vazio)", () => {
    localStorage.setItem("dx2.studio4", JSON.stringify({ nodes: [{ id: "a", tech: "nada", n: "x" }], edges: [] }));
    expect(w.loadSD()).toEqual({ nodes: [], edges: [] });
  });
});

describe("com pasta (desktop)", () => {
  beforeEach(() => { w.DXR = { root: "/proj" }; });

  it("guarda no projecto, em .dxtutor/studio.json (e não no localStorage)", () => {
    w.SD = sampleDesign();
    w.saveSD();
    expect(JSON.parse(w.FS[P()].content).nodes.length).toBe(8);
    expect(localStorage.getItem("dx2.studio4")).toBe(null);
  });

  it("ao abrir uma pasta, o desenho é o dela; sem studio.json, vazio", () => {
    w.FS[P()] = { content: JSON.stringify({ nodes: [{ id: "w", tech: "go-http", n: "Worker", x: 0, y: 0, st: "ok" }], edges: [] }), orig: null };
    document.dispatchEvent(new window.CustomEvent("dx:workspace", { detail: { root: "/proj" } }));
    expect(w.SD.nodes.map((n: any) => n.n)).toEqual(["Worker"]);
    delete w.FS[P()];
    document.dispatchEvent(new window.CustomEvent("dx:workspace", { detail: { root: "/proj" } }));
    expect(w.SD).toEqual({ nodes: [], edges: [] });
  });

  it("um studio.json inválido abre vazio e diz porquê", () => {
    w.FS[P()] = { content: "{oops", orig: null };
    const log = vi.spyOn(w, "log");
    expect(w.loadSD()).toEqual({ nodes: [], edges: [] });
    expect(log).toHaveBeenCalledWith("studio", expect.stringMatching(/não é um desenho válido/));
  });

  it("«Clear design» esvazia o desenho e grava-o no projecto", () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    w.VIEW.studio({}, host);
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === "Clear design")!;
    btn.click();
    expect(w.SD).toEqual({ nodes: [], edges: [] });
    expect(JSON.parse(w.FS[P()].content)).toEqual({ nodes: [], edges: [] });
    host.remove();
  });
});
