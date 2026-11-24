// feature `lsp` — os símbolos da pasta (workspace/symbol): domínio, cliente (portas falsas) e o
// Go to Symbol in Workspace (Ctrl+T, eventos reais em jsdom).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateInFile, rankWorkspaceSymbols, workspaceSymbolHits } from "../src/features/lsp/domain/workspace-symbols";
import { makeLspClient, type WorkspaceSymbolResult, type WorkspaceSymbolSearch } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindWorkspaceSymbolHooks } from "../src/features/lsp/ui/workspace-symbol-hooks";

const at = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 3 } });
/** As formas medidas: o jdtls manda a posição; o kotlin-language-server só o URI e `containerName: "null"`. */
const RESPONSES = [
  {
    language: "java",
    result: [
      { name: "Util", kind: 5, containerName: "", location: { uri: "file:///w/src/Util.java", range: at(0, 13) } },
      { name: "add", kind: 6, containerName: "Util", location: { uri: "file:///w/src/Util.java", range: at(1, 22) } },
      { name: "add", kind: 6, containerName: "Util", location: { uri: "file:///w/src/Util.java", range: at(1, 22) } }, // repetido
      { name: "String", kind: 5, containerName: "java.lang", location: { uri: "jdt://contents/java.base/java.lang/String.class" } }, // sem caminho
    ],
  },
  {
    language: "kotlin",
    result: [
      { name: "greet", kind: 12, containerName: "null", location: { uri: "file:///w/App.kt" } },
      { name: "grow", kind: 12, containerName: "Box", location: { uri: "file:///w/Box.kt" } },
      { name: "Gadd", kind: 5, containerName: "null", location: { uri: "file:///elsewhere/Gadd.kt" } },
    ],
  },
];

describe("símbolos da pasta — domínio", () => {
  it("junta as respostas dos servidores, sem repetidos; sem linha quando o servidor não a manda", () => {
    const h = workspaceSymbolHits(RESPONSES);
    expect(h.map((x) => `${x.language} ${x.label} ${x.name} ${x.container || "-"} ${x.path}:${x.line ?? "?"}`)).toEqual([
      "java class Util - /w/src/Util.java:1",
      "java method add Util /w/src/Util.java:2",
      "kotlin fn greet - /w/App.kt:?",
      "kotlin fn grow Box /w/Box.kt:?",
      "kotlin class Gadd - /elsewhere/Gadd.kt:?",
    ]);
    expect(h[1].character).toBe(22);
    expect(workspaceSymbolHits(null)).toEqual([]);
    expect(workspaceSymbolHits([{ language: "java", result: null }])).toEqual([]);
  });

  it("ordena: mesmas maiúsculas, prefixo, contém, e o resto pela ordem do servidor", () => {
    const h = workspaceSymbolHits(RESPONSES);
    expect(rankWorkspaceSymbols(h, "g").map((x) => x.name)).toEqual(["greet", "grow", "Gadd", "Util", "add"]);
    expect(rankWorkspaceSymbols(h, "G").map((x) => x.name)).toEqual(["Gadd", "greet", "grow", "Util", "add"]);
    expect(rankWorkspaceSymbols(h, "dd").map((x) => x.name).slice(0, 2)).toEqual(["add", "Gadd"]);
    expect(rankWorkspaceSymbols(h, "", 2)).toHaveLength(2);
  });

  it("a posição no ficheiro de um símbolo sem ela: mesmo nome e tipo (e contentor), senão o nome", () => {
    const file = [
      { name: "Box", kind: 5, container: "", line: 1, character: 6 },
      { name: "grow", kind: 6, container: "Box", line: 2, character: 8 },
      { name: "grow", kind: 12, container: "", line: 9, character: 4 },
    ];
    expect(locateInFile({ name: "grow", kind: 12, container: "" }, file)?.line).toBe(9);
    expect(locateInFile({ name: "grow", kind: 6, container: "Box" }, file)?.line).toBe(2);
    expect(locateInFile({ name: "grow", kind: 99, container: "" }, file)?.line).toBe(2);
    expect(locateInFile({ name: "nope", kind: 12, container: "" }, file)).toBeNull();
  });
});

function setup(answer: unknown, opts: { root?: string | null; throws?: boolean } = {}) {
  const calls: string[] = [];
  const files: Record<string, string> = { "p/src/Util.java": "class Util {}", "p/App.kt": "fun greet() {}", "p/Box.kt": "class Box {\n  fun grow() {}\n}\n" };
  let current = "p/src/Util.java";
  const lsp = {
    start: async () => {},
    didOpen: async (path: string) => void calls.push(`open ${path}`),
    didChange: async (path: string) => void calls.push(`change ${path}`),
    workspaceSymbols: async (root: string, q: string) => {
      calls.push(`ws ${root} ${JSON.stringify(q)}`);
      if (opts.throws) throw new Error("boom");
      return answer;
    },
    documentSymbols: async (path: string) => {
      calls.push(`symbols ${path}`);
      return [{ name: "Box", kind: 5, selectionRange: at(0, 6), children: [{ name: "grow", kind: 6, selectionRange: at(1, 6) }] }];
    },
    serverStatus: async () => ({ language: "java", server: "jdtls", installed: true }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => (opts.root === undefined ? "/w" : opts.root),
    virtualPrefix: () => "p/",
    fileKeyOfTab: (id) => id,
    currentFileKey: () => current,
    text: (k) => files[k] ?? null,
  };
  const shown: string[] = [];
  const editor = { repaint() {}, notice() {}, reload() {}, writeFile() {}, notify() {}, open: (k: string, l: number, c: number) => void shown.push(`open ${k} ${l}:${c}`) } as unknown as EditorPort;
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  return { client, calls, files, shown, setCurrent: (k: string) => (current = k) };
}

describe("símbolos da pasta — cliente", () => {
  it("pergunta na pasta aberta e devolve onde abrir cada símbolo (fora da pasta: sem chave)", async () => {
    const t = setup(RESPONSES);
    const r = (await t.client.workspaceSymbolsFor("g"))!;
    expect(r.servers).toBe(2);
    expect(r.items.map((s) => `${s.name} ${s.key ?? "-"} ${s.file}`)).toEqual([
      "greet p/App.kt App.kt",
      "grow p/Box.kt Box.kt",
      "Gadd - /elsewhere/Gadd.kt",
      "Util p/src/Util.java src/Util.java",
      "add p/src/Util.java src/Util.java",
    ]);
    expect(t.calls).toEqual(['ws /w "g"']);
  });

  it("o texto por enviar do ficheiro aberto vai antes da pesquisa", async () => {
    const t = setup([]);
    await t.client.onTab("p/src/Util.java");
    t.files["p/src/Util.java"] += "\nclass Mais {}";
    await t.client.workspaceSymbolsFor("Ma");
    expect(t.calls).toEqual(["open /w/src/Util.java", "change /w/src/Util.java", 'ws /w "Ma"']);
  });

  it("sem pasta → null; sem servidores ou em erro → nenhum servidor", async () => {
    expect(await setup(RESPONSES, { root: null }).client.workspaceSymbolsFor("g")).toBeNull();
    expect(await setup([]).client.workspaceSymbolsFor("g")).toEqual({ items: [], servers: 0 });
    expect(await setup(RESPONSES, { throws: true }).client.workspaceSymbolsFor("g")).toEqual({ items: [], servers: 0 });
  });

  it("abrir: com posição vai direito a ela; sem posição abre o ficheiro e procura o símbolo nele", async () => {
    const t = setup(RESPONSES);
    const items = (await t.client.workspaceSymbolsFor("g"))!.items;
    await t.client.openWorkspaceSymbol(items.find((s) => s.name === "add")!);
    expect(t.shown).toEqual(["open p/src/Util.java 2:22"]);
    t.shown.length = 0;
    await t.client.openWorkspaceSymbol(items.find((s) => s.name === "grow")!);
    expect(t.shown).toEqual(["open p/Box.kt 1:0", "open p/Box.kt 2:6"]);
    expect(t.calls).toContain("symbols /w/Box.kt");
    t.shown.length = 0;
    await t.client.openWorkspaceSymbol(items.find((s) => s.name === "Gadd")!); // fora da pasta
    expect(t.shown).toEqual([]);
  });
});

describe("símbolos da pasta — Ctrl+T", () => {
  let ta: HTMLTextAreaElement;
  const log: string[] = [];
  let answer: WorkspaceSymbolSearch | null;
  let enabled = true;
  let goTo: () => void;
  const globalShortcut = () => void log.push("atalho global");
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const ctrlT = (target: EventTarget = ta) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", ctrlKey: true, bubbles: true, cancelable: true }));
  const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const type = async (v: string) => {
    const inp = document.querySelector<HTMLInputElement>("#lsp-wsymbols input")!;
    inp.value = v;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200); // a pausa antes de perguntar
  };
  const rows = () =>
    [...document.querySelectorAll<HTMLButtonElement>("#lsp-wsymbols .lsp-sym")].map(
      (b) => `${b.querySelector(".lsp-sym-n")!.textContent} ${b.querySelector(".lsp-ref-t")!.textContent}${b.disabled ? " [off]" : ""}${b.classList.contains("sel") ? " *" : ""}`,
    );
  const status = () => document.querySelector<HTMLElement>("#lsp-wsymbols .lsp-sym-none")!;
  const item = (name: string, key: string | null, line: number | null, container = ""): WorkspaceSymbolResult => ({
    name, kind: 12, label: "fn", container, language: "kotlin", path: `/w/${name}`, line, character: line === null ? null : 0, key, file: key ? key.slice(2) : `/x/${name}.kt`,
  });

  beforeEach(() => {
    log.length = 0;
    enabled = true;
    answer = { servers: 2, items: [item("greet", "p/App.kt", null), item("Gadd", null, null), item("grow", "p/Box.kt", 2, "Box")] };
    document.body.innerHTML = `<div class="ed"><textarea id="ed-ta">x</textarea></div><input id="other">`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    document.addEventListener("keydown", globalShortcut);
    goTo = bindWorkspaceSymbolHooks({
      workspaceSymbolsFor: async (q) => (log.push(`search ${JSON.stringify(q)}`), answer),
      openWorkspaceSymbol: async (s) => void log.push(`open ${s.name}`),
      enabled: () => enabled,
    });
  });
  afterEach(() => {
    document.removeEventListener("keydown", globalShortcut);
    document.getElementById("lsp-wsymbols")?.remove();
  });

  it("Ctrl+T no editor abre a pesquisa (já com uma primeira lista) e não chega ao atalho global", async () => {
    ctrlT();
    await wait();
    expect(log).toEqual(['search ""']);
    expect(document.activeElement).toBe(document.querySelector("#lsp-wsymbols input"));
    expect(rows()).toEqual(["greet App.kt *", "Gadd outside this folder [off]", "grow in Box  Box.kt:2"]);
  });

  it("escrever pergunta de novo depois da pausa; ↓ salta os de fora da pasta; Enter abre", async () => {
    ctrlT();
    await wait();
    await type("g");
    expect(log).toEqual(['search ""', 'search "g"']);
    key("ArrowDown");
    expect(rows()[2]).toMatch(/\*$/);
    key("Enter");
    expect(log.at(-1)).toBe("open grow");
    expect(document.getElementById("lsp-wsymbols")).toBeNull();
  });

  it("diz quando não há servidores a correr na pasta, ou nada serve", async () => {
    answer = { servers: 0, items: [] };
    goTo(); // a paleta
    await wait();
    expect(status().textContent).toMatch(/No language server is running in this folder/);
    answer = { servers: 1, items: [] };
    await type("zzz");
    expect(status().textContent).toBe("No matching symbols");
    key("Escape");
    expect(document.getElementById("lsp-wsymbols")).toBeNull();
    expect(document.activeElement).toBe(ta);
  });

  it("noutro campo de texto, ou sem pasta real, o Ctrl+T não é interceptado", async () => {
    ctrlT(document.getElementById("other")!);
    enabled = false;
    ctrlT();
    await wait();
    expect(log).toEqual(["atalho global", "atalho global"]);
    expect(document.getElementById("lsp-wsymbols")).toBeNull();
  });
});
