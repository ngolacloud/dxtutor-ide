// feature `lsp` — os símbolos do ficheiro (documentSymbol): domínio, cliente (portas falsas),
// o Go to Symbol (Ctrl+Shift+O, eventos reais em jsdom) e o Outline pela porta `desktopPorts.outline`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterSymbols, flattenSymbols, kindLabel, type SymbolEntry } from "../src/features/lsp/domain/symbols";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindSymbolHooks } from "../src/features/lsp/ui/symbol-hooks";
import { bootApp } from "./harness";

const r = (line: number, character: number, endChar = character + 3) => ({ start: { line, character }, end: { line, character: endChar } });

/** A forma do jdtls para `class Util { int count; static int add(int,int); enum Color { RED, GREEN } }`. */
const JDTLS = [
  {
    name: "Util", kind: 5, range: r(0, 0, 1), selectionRange: r(0, 13),
    children: [
      { name: "count", kind: 8, detail: " : int", range: r(1, 4), selectionRange: r(1, 16) },
      { name: "add(int, int)", kind: 6, detail: " : int", range: r(2, 4), selectionRange: r(3, 22) },
      { name: "Color", kind: 10, range: r(6, 4), selectionRange: r(6, 9), children: [
        { name: "RED", kind: 22, range: r(6, 17), selectionRange: r(6, 17) },
        { name: "GREEN", kind: 22, range: r(6, 22), selectionRange: r(6, 22) },
      ] },
    ],
  },
];

describe("símbolos — domínio", () => {
  it("achata a árvore de DocumentSymbol pela ordem do ficheiro, com profundidade e o nome (selectionRange)", () => {
    const s = flattenSymbols(JDTLS);
    expect(s.map((e) => `${"  ".repeat(e.depth)}${e.label} ${e.name} :${e.line}`)).toEqual([
      "class Util :1",
      "  field count :2",
      "  method add(int, int) :4", // a linha do nome, não a do javadoc (range)
      "  enum Color :7",
      "    member RED :7",
      "    member GREEN :7",
    ]);
    expect(s[1]).toMatchObject({ detail: ": int", container: "Util", character: 16 });
    expect(s[4].container).toBe("Color");
  });

  it("SymbolInformation (lista plana com location e containerName) sai ordenado", () => {
    const s = flattenSymbols([
      { name: "main", kind: 12, location: { uri: "file:///a.kt", range: r(6, 4) } },
      { name: "grow", kind: 6, containerName: "Box", location: { uri: "file:///a.kt", range: r(3, 8) } },
      { name: "greet", kind: 12, location: { uri: "file:///a.kt", range: r(0, 4) } },
      { kind: 5 }, // sem nome: ignorado
    ]);
    expect(s.map((e) => [e.name, e.line, e.container, e.depth])).toEqual([["greet", 1, "", 0], ["grow", 4, "Box", 0], ["main", 7, "", 0]]);
  });

  it("resposta vazia ou estranha → []; tipo desconhecido → sym", () => {
    expect(flattenSymbols(null)).toEqual([]);
    expect(flattenSymbols({})).toEqual([]);
    expect(kindLabel(5)).toBe("class");
    expect(kindLabel(99)).toBe("sym");
  });

  it("o filtro põe primeiro os que começam pelo texto (com as mesmas maiúsculas à frente), depois os que o contêm; sem texto, todos", () => {
    const s = flattenSymbols(JDTLS);
    expect(filterSymbols(s, "co").map((e) => e.name)).toEqual(["count", "Color"]);
    expect(filterSymbols(s, "Co").map((e) => e.name)).toEqual(["Color", "count"]);
    const main = flattenSymbols([{ name: "Main", kind: 5, selectionRange: r(0, 13), children: [{ name: "main(String[])", kind: 6, selectionRange: r(1, 23) }] }]);
    expect(filterSymbols(main, "mai").map((e) => e.name)).toEqual(["main(String[])", "Main"]);
    expect(filterSymbols(s, "re").map((e) => e.name)).toEqual(["RED", "GREEN"]);
    expect(filterSymbols(s, "  ")).toHaveLength(6);
    expect(filterSymbols(s, "zzz")).toEqual([]);
  });
});

function setup(answer: unknown, opts: { installed?: boolean } = {}) {
  const calls: string[] = [];
  const files: Record<string, string> = { "p/Util.java": "class Util {}", "p/notes.md": "# x" };
  const lsp = {
    start: async () => {},
    didOpen: async (path: string) => void calls.push(`open ${path}`),
    didChange: async (path: string, _t: string, v: number) => void calls.push(`change ${path} v${v}`),
    documentSymbols: async (path: string) => (calls.push(`symbols ${path}`), answer),
    serverStatus: async () => ({ language: "java", server: "jdtls", installed: opts.installed ?? true }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => "p/Util.java", text: (k) => files[k] ?? null };
  const editor = { repaint() {}, open() {}, notice() {}, reload() {}, writeFile() {}, notify() {} } as unknown as EditorPort;
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  return { client, calls, files };
}

describe("símbolos — cliente", () => {
  it("abre o documento, envia o texto actual e devolve a lista plana", async () => {
    const t = setup(JDTLS);
    expect((await t.client.symbolsFor("p/Util.java"))!.map((e) => e.name)).toEqual(["Util", "count", "add(int, int)", "Color", "RED", "GREEN"]);
    t.files["p/Util.java"] += "\n// editado";
    await t.client.symbolsFor("p/Util.java");
    expect(t.calls).toEqual(["open /w/Util.java", "symbols /w/Util.java", "change /w/Util.java v2", "symbols /w/Util.java"]);
  });

  it("a meio da abertura do ficheiro (start/didOpen em curso), espera por ela antes de pedir", async () => {
    const calls: string[] = [];
    let finishStart!: () => void, finishOpen!: () => void;
    const lsp = {
      start: () => (calls.push("start"), new Promise<void>((r) => (finishStart = () => (calls.push("start ok"), r())))),
      didOpen: () => (calls.push("didOpen"), new Promise<void>((r) => (finishOpen = () => (calls.push("didOpen ok"), r())))),
      didChange: async () => void calls.push("didChange"),
      documentSymbols: async () => (calls.push("symbols"), JDTLS),
      serverStatus: async () => ({ language: "java", server: "jdtls", installed: true }),
      onDiagnostics: () => {},
    } as unknown as LspPort;
    const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => "p/Util.java", text: () => "class Util {}" };
    const editor = { repaint() {}, open() {}, notice() {}, reload() {}, writeFile() {}, notify() {} } as unknown as EditorPort;
    const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const tab = client.onTab("p/Util.java"); // o separador abre o ficheiro…
    await flush();
    const syms = client.symbolsFor("p/Util.java"); // …e o Outline pede os símbolos a meio
    await flush();
    finishStart();
    await flush();
    expect(calls).toEqual(["start", "start ok", "didOpen"]); // um só start e um só didOpen; ainda sem pedido
    finishOpen();
    await tab;
    expect((await syms)!.length).toBe(6);
    expect(calls).toEqual(["start", "start ok", "didOpen", "didOpen ok", "symbols"]);
  });

  it("sem servidor para o ficheiro (ou servidor em falta, ou sem sessão) → null", async () => {
    expect(await setup(JDTLS).client.symbolsFor("p/notes.md")).toBeNull();
    expect(await setup(JDTLS, { installed: false }).client.symbolsFor("p/Util.java")).toBeNull();
    expect(await setup(null).client.symbolsFor("p/Util.java")).toBeNull();
    expect(await setup([]).client.symbolsFor("p/Util.java")).toEqual([]);
  });
});

describe("símbolos — Go to Symbol (Ctrl+Shift+O)", () => {
  let ta: HTMLTextAreaElement;
  const log: string[] = [];
  let answer: SymbolEntry[] | null;
  let enabled = true;
  let goToSymbol: () => void;
  const globalShortcut = () => void log.push("atalho global");
  const flush = () => new Promise((res) => setTimeout(res, 0));
  const ctrlShiftO = () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "O", code: "KeyO", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const typeFilter = (v: string) => {
    const inp = document.querySelector<HTMLInputElement>("#lsp-symbols input")!;
    inp.value = v;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const rows = () => [...document.querySelectorAll("#lsp-symbols .lsp-sym")].map((b) => b.querySelector(".lsp-sym-n")!.textContent + (b.classList.contains("sel") ? " *" : ""));

  beforeEach(() => {
    log.length = 0;
    answer = flattenSymbols(JDTLS);
    enabled = true;
    document.body.innerHTML = `<div class="ed"><textarea id="ed-ta">class Util {}</textarea></div>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    document.addEventListener("keydown", globalShortcut);
    goToSymbol = bindSymbolHooks({
      currentFileKey: () => "p/Util.java",
      symbolsFor: async (k) => (log.push(`symbols ${k}`), answer),
      open: (k, line, ch) => void log.push(`open ${k} ${line}:${ch}`),
      notify: (m) => void log.push(`notify ${m}`),
      enabled: () => enabled,
    });
  });
  afterEach(() => {
    document.removeEventListener("keydown", globalShortcut);
    document.getElementById("lsp-symbols")?.remove();
  });

  it("lista os símbolos indentados, com o campo de filtro focado; a tecla não chega ao atalho global", async () => {
    ta.focus();
    ctrlShiftO();
    await flush();
    expect(log).toEqual(["symbols p/Util.java"]);
    expect(rows()).toEqual(["Util *", "count", "add(int, int)", "Color", "RED", "GREEN"]);
    expect(document.activeElement).toBe(document.querySelector("#lsp-symbols input"));
    const pads = [...document.querySelectorAll<HTMLElement>("#lsp-symbols .lsp-sym")].map((b) => b.style.paddingLeft);
    expect(pads.slice(0, 5)).toEqual(["12px", "26px", "26px", "26px", "40px"]);
  });

  it("filtrar, ↓ e Enter abrem o símbolo na linha e coluna do nome", async () => {
    ctrlShiftO();
    await flush();
    typeFilter("co");
    expect(rows()).toEqual(["count *", "Color"]);
    key("ArrowDown");
    expect(rows()).toEqual(["count", "Color *"]);
    key("Enter");
    expect(log.at(-1)).toBe("open p/Util.java 7:9");
    expect(document.getElementById("lsp-symbols")).toBeNull();
  });

  it("clicar numa linha abre-a; Escape fecha e devolve o foco ao editor", async () => {
    ctrlShiftO();
    await flush();
    document.querySelectorAll<HTMLElement>("#lsp-symbols .lsp-sym")[2].click();
    expect(log.at(-1)).toBe("open p/Util.java 4:22");
    goToSymbol(); // a paleta
    await flush();
    key("Escape");
    expect(document.getElementById("lsp-symbols")).toBeNull();
    expect(document.activeElement).toBe(ta);
  });

  it("sem servidor avisa; sem pasta real a tecla não é interceptada", async () => {
    answer = null;
    ctrlShiftO();
    await flush();
    expect(log).toEqual(["symbols p/Util.java", "notify Go to Symbol: no language server for this file"]);
    expect(document.getElementById("lsp-symbols")).toBeNull();
    log.length = 0;
    enabled = false;
    ctrlShiftO();
    await flush();
    expect(log).toEqual(["atalho global"]);
  });
});

describe("símbolos — Outline pela porta desktopPorts.outline", () => {
  let w: any;
  let desktopPorts: Record<string, any>;
  const outline = (): HTMLElement => document.getElementById("outline")!;
  const hits = () => [...outline().querySelectorAll<HTMLElement>(".s-hit")].map((h) => `${h.style.paddingLeft} ${h.textContent}`);

  beforeEach(async () => {
    vi.useFakeTimers();
    w = await bootApp();
    desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, any>;
    w.buildExplorer();
    w.DXR = { root: "/proj" };
  });
  afterEach(() => {
    delete desktopPorts.outline;
    delete w.DXR;
    vi.useRealTimers();
  });

  it("uma linguagem fora do file_outline (Java) mostra os símbolos do servidor, indentados", async () => {
    const asked: string[] = [];
    desktopPorts.outline = {
      covers: (p: string) => p.endsWith(".java"),
      symbols: async (p: string) => (asked.push(p), [{ k: "class", n: "Util", line: 1, d: 0 }, { k: "method", n: "add(int, int)", line: 4, d: 1 }]),
    };
    const key = w.ROOT + "src/Util.java";
    w.writeFile(key, "class Util {\n\n\n  static int add(int a, int b) { return a + b; }\n}\n");
    w.openPath(key);
    expect(outline().textContent).toMatch(/Reading the symbols/);
    await vi.advanceTimersByTimeAsync(450);
    expect(asked).toEqual([key]);
    expect(hits()).toEqual(["16px classUtil", "28px methodadd(int, int)"]);
  });

  it("sem resposta do servidor (null) fica a extracção local; Markdown não vai ao servidor", async () => {
    const asked: string[] = [];
    desktopPorts.outline = { covers: (p: string) => p.endsWith(".java"), symbols: async (p: string) => (asked.push(p), null) };
    const key = w.ROOT + "src/Util.java";
    w.writeFile(key, "class Util {}\n");
    w.openPath(key);
    await vi.advanceTimersByTimeAsync(450);
    expect(asked).toEqual([key]);
    expect(outline().textContent).not.toMatch(/Reading the symbols/);
    const md = Object.keys(w.FS).find((k: string) => k.endsWith(".md"))!;
    w.openPath(md);
    await vi.advanceTimersByTimeAsync(450);
    expect(asked).toEqual([key]);
  });
});
