// feature `lsp` — a hierarquia de tipos (typeHierarchy): domínio, cliente (portas falsas) e o
// cartão / Shift+Alt+T (eventos reais em jsdom).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preparedTypes, typeNodes } from "../src/features/lsp/domain/type-hierarchy";
import { makeLspClient, type TypeEntry, type TypeHierarchyStart } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindTypeHierarchyHooks } from "../src/features/lsp/ui/type-hierarchy-hooks";

const at = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 4 } });
/** A forma do jdtls (medida): `data` dele, que tem de voltar intacto. */
const item = (name: string, kind: number, file: string, line = 0, character = 13) => ({
  name, kind, detail: "", uri: file.startsWith("jdt:") ? file : `file:///w/src/${file}`, range: at(line, 0), selectionRange: at(line, character), data: { id: `${name}#1` },
});
const BASE = item("Base", 5, "Base.java", 0, 22);
const SHAPE = item("Shape", 11, "Shape.java", 0, 17);
const OBJECT = item("Object", 5, "jdt://contents/java.base/java.lang/Object.class");
const CIRCLE = item("Circle", 5, "Circle.java");
const SQUARE = item("Square", 5, "Square.java");

describe("hierarquia de tipos — domínio", () => {
  it("lê os itens (o nome pelo selectionRange; sem caminho fora de um ficheiro) e guarda o original", () => {
    const n = typeNodes([BASE, OBJECT, { name: "x" }, "lixo"]);
    expect(n.map((t) => `${t.label} ${t.name} ${t.path ?? "-"}:${t.line}:${t.character}`)).toEqual([
      "class Base /w/src/Base.java:1:22",
      "class Object -:1:13",
    ]);
    expect(n[0].raw).toBe(BASE);
    expect(typeNodes(null)).toEqual([]);
  });

  it("a resposta do prepare: suportada ou não; sem servidor → null", () => {
    expect(preparedTypes({ supported: true, items: [BASE] })).toMatchObject({ supported: true, items: [{ name: "Base" }] });
    expect(preparedTypes({ supported: false, items: [] })).toEqual({ supported: false, items: [] });
    expect(preparedTypes(null)).toBeNull();
  });
});

function setup(prepare: unknown) {
  const calls: string[] = [];
  const files: Record<string, string> = { "p/src/Base.java": "public abstract class Base implements Shape {}", "p/src/Circle.java": "", "p/src/Shape.java": "", "p/App.kt": "open class Base" };
  let current = "p/src/Base.java";
  const lsp = {
    start: async () => {},
    didOpen: async () => {},
    didChange: async () => {},
    prepareTypeHierarchy: async (path: string, l: number, c: number) => (calls.push(`prepare ${path} ${l}:${c}`), prepare),
    typeHierarchy: async (path: string, it: { name: string; data?: unknown }, dir: string) => {
      calls.push(`${dir} ${path} ${it.name} data=${JSON.stringify(it.data)}`);
      if (it.name === "Base") return dir === "subtypes" ? [CIRCLE, SQUARE] : [SHAPE, OBJECT];
      return [];
    },
    serverStatus: async (path: string) => ({ language: path.endsWith(".kt") ? "kotlin" : "java", server: "x", installed: true }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => current, text: (k) => files[k] ?? null };
  const shown: string[] = [];
  const editor = { repaint() {}, notice() {}, reload() {}, writeFile() {}, notify() {}, open: (k: string, l: number, c: number) => void shown.push(`open ${k} ${l}:${c}`) } as unknown as EditorPort;
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  return { client, calls, shown, setCurrent: (k: string) => (current = k) };
}

describe("hierarquia de tipos — cliente", () => {
  it("o tipo no cursor e os de baixo/de cima, com o item original de volta ao servidor", async () => {
    const t = setup({ supported: true, items: [BASE] });
    const r = (await t.client.typeHierarchyAt(23)) as Extract<TypeHierarchyStart, { status: "ok" }>;
    expect(r.status).toBe("ok");
    expect(r.root).toMatchObject({ name: "Base", key: "p/src/Base.java", file: "src/Base.java", line: 1 });
    const subs = await t.client.typeHierarchyChildren(r.root, "subtypes");
    expect(subs.map((s) => `${s.name} ${s.key}`)).toEqual(["Circle p/src/Circle.java", "Square null"]); // Square.java não está no FS
    const sups = await t.client.typeHierarchyChildren(r.root, "supertypes");
    expect(sups.map((s) => `${s.name} ${s.key ?? "-"} ${s.file || "(sem ficheiro)"}`)).toEqual(["Shape p/src/Shape.java src/Shape.java", "Object - (sem ficheiro)"]);
    expect(t.calls).toEqual([
      "prepare /w/src/Base.java 0:23",
      'subtypes /w/src/Base.java Base data={"id":"Base#1"}',
      'supertypes /w/src/Base.java Base data={"id":"Base#1"}',
    ]);
    t.client.openType(subs[0]);
    t.client.openType(sups[1]); // fora da pasta: não abre
    expect(t.shown).toEqual(["open p/src/Circle.java 1:13"]);
  });

  it("servidor sem hierarquia de tipos (kotlin-language-server) e cursor sem tipo", async () => {
    const kt = setup({ supported: false, items: [] });
    kt.setCurrent("p/App.kt");
    expect(await kt.client.typeHierarchyAt(5)).toEqual({ status: "unsupported", language: "kotlin" });
    expect(await setup({ supported: true, items: [] }).client.typeHierarchyAt(0)).toEqual({ status: "none" });
    expect(await setup(null).client.typeHierarchyAt(0)).toBeNull();
  });
});

describe("hierarquia de tipos — Shift+Alt+T e o cartão", () => {
  let ta: HTMLTextAreaElement;
  const log: string[] = [];
  let start: TypeHierarchyStart | null;
  let enabled = true;
  let show: () => void;
  const globalShortcut = () => void log.push("atalho global");
  const wait = () => new Promise((r) => setTimeout(r, 0));
  const entry = (n: ReturnType<typeof item>, key: string | null): TypeEntry => ({ ...typeNodes([n])[0], key, file: key ? key.slice(2) : "" });
  const ROOT = entry(BASE, "p/src/Base.java");
  const kids: Record<string, TypeEntry[]> = {
    "subtypes:Base": [entry(CIRCLE, "p/src/Circle.java"), entry(SQUARE, "p/src/Square.java")],
    "subtypes:Circle": [],
    "supertypes:Base": [entry(SHAPE, "p/src/Shape.java"), entry(OBJECT, null)],
  };
  const press = (k: string, mods: KeyboardEventInit = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
  const rows = () =>
    [...document.querySelectorAll<HTMLElement>("#lsp-types .lsp-type")].map(
      (r) => `${r.querySelector(".lsp-type-tw")!.textContent}${"  ".repeat(Number(r.getAttribute("aria-level")) - 1)}${r.querySelector(".lsp-sym-n")!.textContent}${r.classList.contains("sel") ? " *" : ""}${r.classList.contains("off") ? " [off]" : ""}`,
    );

  beforeEach(() => {
    log.length = 0;
    enabled = true;
    start = { status: "ok", root: ROOT };
    document.body.innerHTML = `<div class="ed"><textarea id="ed-ta">public abstract class Base implements Shape {}</textarea></div>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    ta.setSelectionRange(23, 23);
    document.addEventListener("keydown", globalShortcut);
    show = bindTypeHierarchyHooks({
      typeHierarchyAt: async (o) => (log.push(`at ${o}`), start),
      typeHierarchyChildren: async (t, dir) => (log.push(`${dir} ${t.name}`), kids[`${dir}:${t.name}`] ?? []),
      openType: (t) => void log.push(`open ${t.name}`),
      notify: (m) => void log.push(`notify ${m}`),
      enabled: () => enabled,
    });
  });
  afterEach(() => {
    document.removeEventListener("keydown", globalShortcut);
    document.getElementById("lsp-types")?.remove();
  });

  it("Shift+Alt+T abre a hierarquia com os subtipos já carregados; a tecla não chega ao atalho global", async () => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "T", code: "KeyT", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));
    await wait();
    await wait();
    expect(log).toEqual(["at 23", "subtypes Base"]);
    expect(rows()).toEqual(["▾Base *", "▸  Circle", "▸  Square"]);
    expect(document.querySelector("#lsp-types .lsp-types-dir.on")!.textContent).toBe("Subtypes");
  });

  it("↓ e → abrem um nó (folha: «·»); ← sobe; Enter abre o tipo", async () => {
    show();
    await wait();
    await wait();
    press("ArrowDown");
    press("ArrowRight");
    await wait();
    expect(rows()).toEqual(["▾Base", "·  Circle *", "▸  Square"]);
    press("ArrowLeft");
    expect(rows()[0]).toBe("▾Base *");
    press("ArrowDown");
    press("Enter");
    expect(log.at(-1)).toBe("open Circle");
    expect(document.getElementById("lsp-types")).toBeNull();
    expect(document.activeElement).not.toBe(ta); // escolher abre o tipo (o editor muda de ficheiro), não volta ao cursor antigo
  });

  it("Tab troca para os supertipos; os de fora da pasta não abrem", async () => {
    show();
    await wait();
    await wait();
    press("Tab");
    await wait();
    expect(log).toContain("supertypes Base");
    expect(rows()).toEqual(["▾Base *", "▸  Shape", "▸  Object [off]"]);
    press("ArrowUp"); // dá a volta → Object
    press("Enter");
    expect(log.filter((l) => l.startsWith("open"))).toEqual([]);
    press("Escape");
    expect(document.getElementById("lsp-types")).toBeNull();
    expect(document.activeElement).toBe(ta);
  });

  it("o cartão fica dentro da área do editor (não passa para o painel do Co-Dev à direita)", async () => {
    // a janela tem 1400px; o editor (#ebody) vai de 300 a 900 e o Co-Dev fica à direita dele
    document.body.innerHTML = `<div id="ebody"><div class="ed"><textarea id="ed-ta">public abstract class Base implements Shape {}</textarea></div></div>`;
    const ta2 = document.getElementById("ed-ta") as HTMLTextAreaElement;
    ta2.setSelectionRange(23, 23);
    const rect = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    document.getElementById("ebody")!.getBoundingClientRect = rect(300, 40, 600, 500);
    ta2.getBoundingClientRect = rect(850, 40, 50, 500); // o cursor está perto da margem direita do editor
    const html = document.documentElement, size = { clientWidth: 1400, clientHeight: 900 };
    const saved = Object.fromEntries(Object.keys(size).map((k) => [k, Object.getOwnPropertyDescriptor(html, k)]));
    Object.keys(size).forEach((k) => Object.defineProperty(html, k, { configurable: true, value: size[k as keyof typeof size] }));
    const proto = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.id === "lsp-types" ? rect(0, 0, 560, 120)() : proto.call(this);
    };
    try {
      show();
      await wait();
      await wait();
      const card = document.getElementById("lsp-types")!;
      expect(card.style.maxWidth).toBe("584px"); // a largura do editor menos as margens
      expect(card.style.left).toBe("332px"); // 900 − 560 − 8: encostado à margem direita do editor, não à da janela
    } finally {
      HTMLElement.prototype.getBoundingClientRect = proto;
      Object.keys(size).forEach((k) => (saved[k] ? Object.defineProperty(html, k, saved[k]!) : delete (html as unknown as Record<string, unknown>)[k]));
    }
  });

  it("diz quando o servidor não tem hierarquia, quando não há tipo, e sem pasta não intercepta", async () => {
    start = { status: "unsupported", language: "kotlin" };
    show();
    await wait();
    start = { status: "none" };
    show();
    await wait();
    expect(log.filter((l) => l.startsWith("notify"))).toEqual([
      "notify Type hierarchy: the kotlin language server does not support it",
      "notify Type hierarchy: no type at the cursor",
    ]);
    enabled = false;
    log.length = 0;
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "T", code: "KeyT", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));
    await wait();
    expect(log).toEqual(["atalho global"]);
  });
});
