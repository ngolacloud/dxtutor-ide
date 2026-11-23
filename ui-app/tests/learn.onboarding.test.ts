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

describe("leitura dos conceitos do tópico", () => {
  it("abre sozinha no 1.º passo da unidade e fecha/abre pelo botão", () => {
    w.LTS.lang = "rust";
    w.LTS.levels = ["basic"];
    const unit = w.course().units[0];
    const first = unit.steps[0];
    unit.concepts = "## Variables\n\nA variable names a value.";
    w.ltOpen(first.id);
    const host = document.createElement("div");
    document.body.appendChild(host);
    w.renderLtView({ id: "lt", title: `${first.id}.rs`, path: w.ltPath(first) }, host);
    const read = () => document.querySelector("#lt-res .lt-read");
    expect(read()!.textContent).toMatch(/Concepts: /);
    expect(read()!.querySelector(".lt-read-b")!.innerHTML).toMatch(/A variable names a value/);
    document.querySelector<HTMLButtonElement>('#lt-res [data-action="lt-read"]')!.click();
    expect(read()!.querySelector(".lt-read-b")).toBeNull();
    host.remove();
    unit.concepts = "";
  });
});
