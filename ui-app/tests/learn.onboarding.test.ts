// Learning Track no harness (cadeia real de módulos, protótipo de browser = sem Tauri):
// o selector mostra as 10 linguagens oficiais, o painel de plugins diz que a instalação é
// no desktop, o dispatch delegado (data-action) escolhe a linguagem, e a leitura dos
// conceitos aparece quando a unidade a traz.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: any;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
  w.LTS.lang = null;
  w.LTS.levels = [];
  w.LTS.cur = null;
});

afterEach(() => {
  document.getElementById("onb")?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("selector de linguagens", () => {
  it("mostra as 10 linguagens oficiais; Rust e Go disponíveis, o resto «Coming soon»", () => {
    w.ltOnboard(1);
    const cards = [...document.querySelectorAll<HTMLButtonElement>("#onb .onb-lang")];
    expect(cards.map(c => c.querySelector("b")!.textContent)).toEqual(["Rust", "Go", "Python", "TypeScript", "Java", "Kotlin", "Swift", "C#", "C++", "SQL"]);
    const live = cards.filter(c => !c.disabled).map(c => c.dataset.on);
    expect(live).toEqual(["rust", "go"]);
    expect(cards[2].querySelector(".tag")!.textContent).toBe("Coming soon");
  });

  it("no browser, o painel de plugins remete para a app desktop", () => {
    w.ltOnboard(1);
    expect(document.querySelector("#onb .onb-plug")!.textContent).toMatch(/desktop app/);
    expect(document.querySelector("#onb-src")).toBeNull();
  });

  it("clicar num cartão disponível (data-action) passa ao passo do nível", () => {
    w.ltOnboard(1);
    document.querySelector<HTMLButtonElement>('#onb [data-action="lt-pick"][data-on="go"]')!.click();
    expect(w.ONB.lang).toBe("go");
    expect(document.querySelector("#onb h2")!.textContent).toBe("What's your level?");
  });
});

describe("leitura: apresentação do curso e conceitos do tópico", () => {
  function openStep(id: string, title: string): HTMLElement {
    w.ltOpen(id);
    const host = document.createElement("div");
    document.body.appendChild(host);
    w.renderLtView({ id: "lt", title, path: w.ltPath(w.ltFind(id).s) }, host);
    return host;
  }
  const card = (key: string) => document.querySelector<HTMLButtonElement>(`#lt-res [data-action="lt-read"][data-on="${key}"]`)?.closest(".lt-read") ?? null;

  it("todas as unidades embutidas (Rust e Go) trazem texto de conceitos, e cada curso a sua apresentação", () => {
    for (const lang of ["rust", "go"]) {
      w.LTS.lang = lang;
      expect(w.course().overview.length, `${lang}.overview`).toBeGreaterThan(500);
      for (const u of w.course().units) expect(u.concepts.length, `${lang}:${u.id}`).toBeGreaterThan(1000);
    }
  });

  it("no 1.º passo do curso abrem a apresentação e os conceitos; o botão fecha/abre", () => {
    w.LTS.lang = "rust";
    w.LTS.levels = ["basic"];
    const unit = w.course().units[0];
    const host = openStep(unit.steps[0].id, `${unit.steps[0].id}.rs`);
    expect(card("__overview")!.textContent).toMatch(/About Rust/);
    expect(card(unit.id)!.textContent).toMatch(/Concepts: /);
    expect(card(unit.id)!.querySelector(".lt-read-b")).not.toBeNull();
    card(unit.id)!.querySelector<HTMLButtonElement>("[data-action]")!.click();
    expect(card(unit.id)!.querySelector(".lt-read-b")).toBeNull();
    host.remove();
  });

  it("num passo seguinte a apresentação já não aparece e os conceitos ficam fechados", () => {
    w.LTS.lang = "rust";
    w.LTS.levels = ["basic"];
    const unit = w.course().units[0];
    w.LTS.done[`rust:${unit.steps[0].id}`] = 1;
    const host = openStep(unit.steps[1].id, `${unit.steps[1].id}.rs`);
    expect(card("__overview")).toBeNull();
    expect(card(unit.id)!.querySelector(".lt-read-b")).toBeNull();
    host.remove();
  });
});
