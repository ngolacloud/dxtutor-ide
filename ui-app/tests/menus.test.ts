// U4d2 (ADR-0004): o mecanismo dos menus em features/menus.ts.
import { beforeEach, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let MNM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7f)
const pops = () => document.querySelectorAll(".menu-pop").length;

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  MNM = await import("../src/features/menus");
  document.querySelector("#menubar")!.innerHTML = "";
  w.MENUS.length = 0;
  w.MENUS.push(
    { t: "File", items: [{ l: "Abrir", k: "Ctrl+O", act: vi.fn() }, { sep: true }, { l: "Recentes", sub: [{ l: "a" }, { l: "b" }] }] },
    { t: "View", items: [{ l: "Tema", act: "__acaoMenuTeste" }, { l: "Sem acção" }] },
  );
  w.buildMenubar();
});

it("a barra tem um botão por menu; clicar abre, clicar de novo fecha", () => {
  const tops = document.querySelectorAll<HTMLElement>("#menubar .menu-top");
  expect(Array.from(tops).map((b) => b.textContent)).toEqual(["File", "View"]);
  tops[0].click();
  expect(pops()).toBe(1);
  expect(tops[0].classList.contains("open")).toBe(true);
  expect(document.querySelector(".menu-pop .key")!.textContent).toBe("Ctrl+O");
  tops[0].click();
  expect(pops()).toBe(0);
  expect(tops[0].classList.contains("open")).toBe(false);
});

it("com um menu aberto, passar o rato por outro troca de menu", () => {
  const tops = document.querySelectorAll<HTMLElement>("#menubar .menu-top");
  tops[0].click();
  tops[1].dispatchEvent(new MouseEvent("mouseenter"));
  expect(tops[1].classList.contains("open")).toBe(true);
  expect(document.querySelector(".menu-pop")!.textContent).toContain("Tema");
});

it("acção por função, por nome no window e sem acção (toast); submenus abrem ao passar o rato", () => {
  const file = w.MENUS[0].items[0].act as ReturnType<typeof vi.fn>;
  w.__acaoMenuTeste = vi.fn();
  const pop = MNM.renderPop(w.MENUS[0].items, 0, 0) as HTMLElement;
  (pop.querySelector(".mi") as HTMLElement).click();
  expect(file).toHaveBeenCalledTimes(1);
  expect(pops()).toBe(0); // a acção fecha os menus
  const pop2 = MNM.renderPop(w.MENUS[0].items, 0, 0) as HTMLElement;
  const rec = Array.from(pop2.querySelectorAll<HTMLElement>(".mi")).find((m) => m.textContent!.includes("Recentes"))!;
  rec.dispatchEvent(new MouseEvent("mouseenter"));
  expect(pop2.querySelectorAll(".menu-pop").length).toBe(1);
  MNM.closeMenus();
  const pop3 = MNM.renderPop(w.MENUS[1].items, 0, 0) as HTMLElement;
  (pop3.querySelector(".mi") as HTMLElement).click();
  expect(w.__acaoMenuTeste).toHaveBeenCalledTimes(1);
});
