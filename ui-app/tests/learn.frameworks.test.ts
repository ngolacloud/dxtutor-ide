// Learning Track: a secção «Frameworks & tools» e os passos de projecto (vários ficheiros), na cadeia
// real de módulos, com o IPC do Tauri falso (o mesmo contrato de `commands/study.rs` e
// `commands/plugins.rs`). O curso servido é a projecção do plugin-fixture
// `crates/tutor-plugins/tests/fixtures/framework-project` (o que `course_dto` mandaria: sem os
// testes ocultos nem a solução).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let LM: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Array<[string, Record<string, unknown>]>;

const STARTER: Record<string, string> = {
  "shop/__init__.py": "",
  "shop/config.py": "VAT = 0.14\n",
  "shop/prices.py": "from shop.config import VAT\n\n\ndef with_vat(amount):\n    raise NotImplementedError\n",
  "shop/cart.py": "from shop.prices import with_vat\n\n\ndef total(items):\n    raise NotImplementedError\n",
};
const step = (over: Record<string, unknown>) => ({
  kind: "concept", id: "", title: "", points: 10, intro: "Briefing.", difficulty: 1, body: "", prompt: "", target: "", explanation: "",
  lineComments: [], placeholderPolicy: "shown", installCommands: [], runCommand: "", dependencies: [], instructions: "", entry: "", starter: "",
  ...over,
});
const COURSE = {
  id: "minishop-fixture", language: "python", category: "framework", subject: "minishop", title: "MiniShop (fixture)", level: "beginner",
  summary: "A tiny shop package.", overview: "MiniShop is a pretend framework.",
  units: [{ id: "msf-u1-prices", title: "Prices and carts", intro: "", concepts: "One rule, one module.", difficulty: 1, level: "basic", steps: [
    step({ kind: "concept", id: "msf-c1-modules", title: "Modules", body: "Reuse the price rule." }),
    step({ kind: "challenge", id: "msf-p1-cart", title: "A cart that charges VAT", points: 30, entry: "total", instructions: "Implement `with_vat` and `total`.",
      project: { main: "shop/cart.py", files: STARTER, readonly: ["shop/__init__.py", "shop/config.py"] } }),
  ] }],
};
const DJANGO = { ...COURSE, id: "django-basics", subject: "django", title: "Django", summary: "Django, hands-on.", units: [] };
const PLUGIN = {
  entry: { id: "fixture-minishop", name: "MiniShop (test fixture)", version: "0.1.0", source: "./fixture", sha256: null, installedAt: 0 },
  manifest: { schema: 1, id: "fixture-minishop", name: "MiniShop", version: "0.1.0", description: "", authors: [], license: "", repository: "", engine: ">=0.1.0", kind: "course",
    category: "framework", subject: { id: "minishop", name: "MiniShop", icon: "🛒", docs: "https://example.org/minishop/" },
    language: { id: "python", name: "Python", icon: "🐍", extension: "py", indent: "4", testCommand: "" }, courses: ["courses/minishop.toml"] },
  error: null,
};
const SOLVED_CART = "from shop.prices import with_vat\n\n\ndef total(items):\n    return with_vat(sum(q * p for q, p in items))\n";

function fakeTauri(submit: (a: Record<string, unknown>) => unknown): void {
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    plugin_list: () => [PLUGIN],
    list_courses: () => [
      { id: "minishop-fixture", language: "python", category: "framework", subject: "minishop", title: "MiniShop", level: "beginner", summary: "s" },
      { id: "django-basics", language: "python", category: "framework", subject: "django", title: "Django", level: "beginner", summary: "s" },
    ],
    get_course: (a) => (a.subject === "minishop" ? COURSE : a.subject === "django" ? DJANGO : Promise.reject(new Error("no course"))),
    submit_step: submit,
  };
  w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd);
    return handlers[cmd](args);
  } } };
}

beforeEach(async () => {
  w = await bootApp();
  calls = [];
  LM = await import("../src/features/learn");
  LM.course(); // hidrata o LTS (preguiçoso) antes de o mudar
  LM.LTS.lang = null; LM.LTS.levels = []; LM.LTS.cur = null; LM.LTS.done = {};
});

afterEach(() => {
  delete w.__TAURI__;
  document.getElementById("onb")?.remove();
  vi.restoreAllMocks();
});

const fwCards = () => [...document.querySelectorAll<HTMLButtonElement>("#onb .onb-fw .onb-lang")];
const ed = () => document.getElementById("ed-ta") as HTMLTextAreaElement;
const res = () => document.getElementById("lt-res")!;
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

describe("selector: «Frameworks & tools» à parte das linguagens", () => {
  it("no browser, os 8 oficiais aparecem «Coming soon», desactivados, sem resumo (como uma linguagem sem plugin)", () => {
    LM.ltOnboard(1);
    expect(document.querySelector("#onb .onb-sec")!.textContent).toBe("Frameworks & tools");
    const cards = fwCards();
    expect(cards.map(c => c.querySelector("b")!.textContent)).toEqual(["Dxjs", "Seiva", "Django", "Delonix Engine", "Docker", "Podman", "Kubernetes", "Odoo"]);
    expect(cards.every(c => c.disabled && c.classList.contains("soon") && !c.dataset.action)).toBe(true);
    expect(cards.every(c => c.querySelector(".tag")!.textContent === "Coming soon" && !c.querySelector("small"))).toBe(true);
    // As linguagens continuam a ser 10.
    expect(document.querySelectorAll("#onb .onb-langs:not(.onb-fw) .onb-lang")).toHaveLength(10);
  });

  it("no desktop, um curso de framework acende o cartão oficial; o da comunidade entra no fim", async () => {
    fakeTauri(() => { throw new Error("não avalia aqui"); });
    LM.ltOnboard(1);
    await vi.waitFor(() => expect(fwCards()).toHaveLength(9));
    const django = fwCards().find(c => c.dataset.on === "django")!;
    expect(django.disabled).toBe(false);
    expect(django.querySelector(".tag")!.textContent).toBe("Available");
    const mini = fwCards()[8];
    expect(mini.querySelector("b")!.textContent).toBe("MiniShop");
    expect(mini.querySelector(".tag")!.textContent).toBe("Community");
    expect(calls).toContainEqual(["get_course", { language: "python", subject: "minishop" }]);
    // O plugin de framework (runtime python) não vira cartão de linguagem «Community».
    expect(document.querySelectorAll("#onb .onb-langs:not(.onb-fw) .onb-lang")).toHaveLength(10);
    click(mini);
    expect(LM.ONB.lang).toBe("minishop");
  });
});

describe("o curso Dxjs embutido (Learn P1)", () => {
  const DXJS = {
    id: "dxjs-basics", language: "typescript", category: "framework", subject: "dxjs", title: "Dxjs: Reactive UIs from Signals Up",
    level: "intermediate", summary: "Learn dxjs from signals up.", overview: "dxjs is a fine-grained reactive UI engine.",
    units: [{ id: "dxjs-u01-signals", title: "Signals: reactive values", intro: "", concepts: "A signal holds a value.", difficulty: 1, level: "basic", steps: [
      step({ kind: "concept", id: "dxjs-u01-c1-signal", title: "A signal is a reactive cell", body: "Read by calling." }),
    ] }],
  };

  it("servido pelo backend sem plugin instalado, acende o cartão Dxjs e mostra a documentação e o Node exigido", async () => {
    const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
      plugin_list: () => [],
      list_courses: () => [{ id: "dxjs-basics", language: "typescript", category: "framework", subject: "dxjs", title: DXJS.title, level: "intermediate", summary: DXJS.summary }],
      get_course: (a) => (a.subject === "dxjs" && a.language === "typescript" ? DXJS : Promise.reject(new Error("no course"))),
    };
    w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd);
      return handlers[cmd](args);
    } } };
    LM.ltOnboard(1);
    await vi.waitFor(() => expect(fwCards().find(c => c.dataset.on === "dxjs")?.disabled).toBe(false));
    const dxjs = fwCards().find(c => c.dataset.on === "dxjs")!;
    expect(dxjs.querySelector(".tag")!.textContent).toBe("Available");
    expect(dxjs.querySelector("small")!.textContent).toBe("Learn dxjs from signals up.");
    // Os outros sete continuam «Coming soon», e as linguagens não ganham um cartão TypeScript a mais.
    expect(fwCards().filter(c => c.disabled)).toHaveLength(7);
    expect(document.querySelectorAll("#onb .onb-langs:not(.onb-fw) .onb-lang")).toHaveLength(10);
    expect(calls).toContainEqual(["get_course", { language: "typescript", subject: "dxjs" }]);
    document.getElementById("onb")!.classList.remove("show");
    LM.LTS.lang = "dxjs"; LM.LTS.levels = ["basic"];
    LM.ltOpen("dxjs-u01-c1-signal");
    await vi.waitFor(() => expect(res().textContent).toMatch(/About Dxjs/));
    expect(res().querySelector<HTMLAnchorElement>(".lt-sub a")!.getAttribute("href")).toBe("https://ngolacloud.github.io/dxjs/");
    expect(res().textContent).toContain("Node.js 22.18 or newer. dxjs 1.3.0 itself comes with the course");
  });
});

describe("passo de projecto (vários ficheiros)", () => {
  async function openProject() {
    fakeTauri((a) => a);
    LM.ltOnboard(1);
    await vi.waitFor(() => expect(fwCards()).toHaveLength(9));
    document.getElementById("onb")!.classList.remove("show");
    LM.LTS.lang = "minishop"; LM.LTS.levels = ["basic"];
    LM.LTS.done["minishop:msf-c1-modules"] = 1;
    LM.ltOpen("msf-p1-cart");
    await vi.waitFor(() => expect(document.querySelector(".lt-files")).toBeTruthy());
  }

  it("mostra os ficheiros (principal primeiro), abre o principal, e o só de leitura não se edita", async () => {
    await openProject();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>(".lt-files .lt-fbtn")];
    expect(tabs.map(t => t.dataset.on)).toEqual(["shop/cart.py", "shop/__init__.py", "shop/config.py", "shop/prices.py"]);
    expect(tabs[0].classList.contains("on")).toBe(true);
    expect(tabs.filter(t => t.classList.contains("ro")).map(t => t.dataset.on)).toEqual(["shop/__init__.py", "shop/config.py"]);
    expect(ed().value).toBe(STARTER["shop/cart.py"]);
    expect(ed().readOnly).toBe(false);
    expect(res().textContent).toMatch(/Project step: Submit sends every file you can edit/);
    click(tabs[2]);
    expect(ed().value).toBe("VAT = 0.14\n");
    expect(ed().readOnly).toBe(true);
    expect(document.querySelector(".lt-fbtn.on")!.getAttribute("data-on")).toBe("shop/config.py");
  });

  it("«Submit» entrega só os editáveis, com o que o aluno escreveu, na linguagem do runtime; a solução em ficheiros aparece ao passar", async () => {
    const passed = { correctness: { passed: true, summary: "testes passaram", raw: "" }, gabarito: { solution: "", time: "", space: "", justification: "Sum first, VAT once.", files: { "shop/cart.py": SOLVED_CART } } };
    await openProject();
    w.__TAURI__.core.invoke = async (cmd: string, args: Record<string, unknown>) => { calls.push([cmd, args]); return passed; };
    ed().value = SOLVED_CART;
    ed().dispatchEvent(new window.Event("input"));
    click(document.querySelector('[data-action="learn:go"]')!);
    await vi.waitFor(() => expect(res().textContent).toMatch(/Passed/));
    const sub = calls.find(c => c[0] === "submit_step")!;
    expect(sub[1]).toEqual({
      stepId: "msf-p1-cart", code: SOLVED_CART, language: "python",
      files: { "shop/cart.py": SOLVED_CART, "shop/prices.py": STARTER["shop/prices.py"] },
    });
    expect(res().textContent).toContain("shop/cart.py");
    expect(res().textContent).toContain("Sum first, VAT once.");
    expect(res().querySelector(".lt-cx")).toBeNull(); // sem time/space num projecto
    expect(LM.LTS.done["minishop:msf-p1-cart"]).toBe(1);
  });

  it("no 1.º passo, «About» traz a documentação oficial do subject (do manifesto do plugin)", async () => {
    await openProject();
    LM.ltOpen("msf-c1-modules");
    await vi.waitFor(() => expect(res().textContent).toMatch(/About MiniShop/));
    const a = res().querySelector<HTMLAnchorElement>(".lt-sub a")!;
    expect(a.getAttribute("href")).toBe("https://example.org/minishop/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(document.querySelector(".lt-files")).toBeNull(); // um passo de um só ficheiro não tem a lista
  });

  it("um chumbo mostra a saída dos testes e não marca o passo", async () => {
    await openProject();
    w.__TAURI__.core.invoke = async (cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return { correctness: { passed: false, summary: "testes falharam", raw: "NotImplementedError in shop/prices.py" }, gabarito: null };
    };
    click(document.querySelector('[data-action="learn:go"]')!);
    await vi.waitFor(() => expect(res().textContent).toMatch(/NotImplementedError in shop\/prices\.py/));
    expect(LM.LTS.done["minishop:msf-p1-cart"]).toBeUndefined();
  });
});
