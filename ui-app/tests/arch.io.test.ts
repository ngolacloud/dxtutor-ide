// Studio de arquitectura (F5): exportar SVG/PNG/Mermaid/ficheiro do desenho e importar
// Mermaid — domínio dos ficheiros, SVG autónomo, caso de uso, vista e o adaptador Tauri
// (nomes e argumentos dos comandos, com um invoke falso).
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { addComponent, connect, emptyDesign, fromArchitecture } from "../src/features/arch/domain/design";
import { defaultExportName, designFile, isSafeRel, mermaidBlocks, readDesignFile } from "../src/features/arch/domain/files";
import { layout } from "../src/features/arch/domain/geometry";
import { makeArchStudio, NEEDS_DESKTOP } from "../src/features/arch/application/studio";
import type { ArchGateway } from "../src/features/arch/application/ports";
import type { Design } from "../src/features/arch/domain/types";
import { makeRenderer, standaloneSvg } from "../src/features/arch/ui/export";
import { makeArchView } from "../src/features/arch/ui/view";
import { bindActions } from "../src/features/arch/ui/actions";
import { archActions } from "../src/features/arch/ui/table";
import { tauriArchGateway } from "../src/features/arch/infrastructure/tauri";
import { reference } from "./fixtures/arch-reference";
import { fakeFiles, ioGateway } from "./fixtures/arch-fakes";

const DELONIX_MD = [
  "# Arquitectura", "", "```mermaid", "graph TB", '    OP["Operador"]', '    DLX["Delonix Engine"]', '    OP -- "delonix" --> DLX', "```", "",
  "```mermaid", "sequenceDiagram", "    A->>B: oi", "```", "",
  "```mermaid", "graph TB", '    subgraph HOST["Host Linux"]', '        CLI["delonix"]', "    end", "```", "",
].join("\n");

describe("ficheiros", () => {
  test("nome por omissão a partir dos painéis", () => {
    expect(defaultExportName(reference())).toBe("docker-vs-kubernetes");
    expect(defaultExportName(emptyDesign())).toBe("architecture");
  });

  test("só caminhos relativos dentro do projecto", () => {
    for (const ok of ["docs/architecture/x.svg", "x.png", "a/b/c.arch.json"]) expect(isSafeRel(ok)).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x.svg", "docs/../../x", "C:/x.svg", "docs\\x.svg", "docs//x.svg"]) expect(isSafeRel(bad)).toBe(false);
  });

  test("o ficheiro do desenho guarda o modelo E as posições", () => {
    const d = reference();
    expect(readDesignFile(designFile(d))).toEqual(d);
    expect(readDesignFile(JSON.stringify(d))).toEqual(d); // um desenho solto também abre
    for (const junk of ["", "{", "[]", "42", '{"a":1}', '{"dxtutorArch":1,"design":{}}']) expect(readDesignFile(junk)).toBeNull();
  });

  test("os blocos graph/flowchart de um Markdown (os sequenceDiagram ficam de fora)", () => {
    const b = mermaidBlocks(DELONIX_MD);
    expect(b.map((x) => x.label)).toEqual(["#1 · graph TB · OP, DLX…", "#3 · graph TB · HOST, CLI…"]);
    expect(b[1].source).toContain('subgraph HOST["Host Linux"]');
    expect(mermaidBlocks("flowchart LR\n  a --> b")).toHaveLength(1); // fonte solta
    expect(mermaidBlocks("sequenceDiagram\n A->>B: x")).toHaveLength(0);
  });
});

describe("SVG autónomo", () => {
  test("fiel ao canvas, sem variáveis CSS, sem grelha, sem atributos de interacção; XML válido", () => {
    const { svg, w, h } = standaloneSvg(reference(), { "--bg-base": "#101010", "--green": "#00ff88" });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toMatch(/ data-[a-z]+=/);
    expect(svg).not.toContain("arch-grid");
    expect(svg).not.toContain('stroke="transparent"');
    expect(svg).not.toContain("cursor:");
    expect(svg).toContain('fill="#101010"'); // o fundo vem do tema
    expect(svg).toContain('stroke="#00ff88"'); // as setas de dados (verde do tema)
    expect(svg).toContain(">Kubernetes</text>");
    expect(svg).toContain(">docker run checkout:v2</text>");
    expect(w).toBeGreaterThan(760);
    expect(h).toBeGreaterThan(440);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.getAttribute("width")).toBe(String(w));
  });

  test("sem tema (ex.: headless), usa as cores do tema escuro por omissão", () => {
    const svg = makeRenderer(() => ({})).svg(reference());
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).toContain('fill="#0f0f11"');
  });
});

function studio(o: { desktop?: boolean; root?: string | null; prompts?: (string | null)[]; confirm?: boolean; gateway?: Partial<ArchGateway>; initial?: Design } = {}) {
  const prompts = [...(o.prompts ?? [])];
  const confirms: string[] = [];
  const saves: { root: string; rel: string; text: string }[] = [];
  const files = fakeFiles();
  const gateway: ArchGateway = {
    available: () => o.desktop ?? true,
    validate: async () => [], preview: async () => [], scaffold: async () => [],
    ...ioGateway,
    saveExport: async (root, rel, bytes) => { saves.push({ root, rel, text: new TextDecoder().decode(bytes) }); return rel; },
    ...o.gateway,
  };
  const st = makeArchStudio({
    gateway, files,
    store: { load: () => o.initial ?? null, save: () => {} },
    workspace: { root: () => (o.root === undefined ? "/p" : o.root), confirm: (m) => { confirms.push(m); return o.confirm ?? true; }, prompt: (_m, init) => (prompts.length ? prompts.shift()! : init) },
    renderer: makeRenderer(() => ({})),
    repaint: () => {},
  });
  st.ensureLoaded();
  return { st, confirms, saves, files };
}

describe("caso de uso: exportar", () => {
  test("no desktop com pasta: pergunta o caminho, confirma e escreve em docs/architecture/", async () => {
    const t = studio({ initial: reference() });
    expect(await t.st.exportAs("svg")).toBe("docs/architecture/docker-vs-kubernetes.svg");
    expect(t.saves[0].root).toBe("/p");
    expect(t.saves[0].text).toContain("<svg");
    expect(t.confirms[0]).toMatch(/Write docs\/architecture\/docker-vs-kubernetes\.svg in \/p\?/);
    expect(t.st.state().ioMessage).toBe("docs/architecture/docker-vs-kubernetes.svg written.");
  });

  test("um caminho para fora do projecto é recusado; cancelar não escreve", async () => {
    const out = studio({ initial: reference(), prompts: ["../fora.svg"] });
    expect(await out.st.exportAs("svg")).toBeNull();
    expect(out.st.state().ioError).toMatch(/inside the project/);
    expect(out.saves).toHaveLength(0);
    const no = studio({ initial: reference(), confirm: false });
    expect(await no.st.exportAs("json")).toBeNull();
    expect(no.saves).toHaveLength(0);
  });

  test("o ficheiro do desenho e o Mermaid", async () => {
    const t = studio({ initial: reference(), gateway: { exportMermaid: async (a) => `graph TB\n%% ${a.components.length} comps\n` } });
    await t.st.exportAs("json");
    expect(readDesignFile(t.saves[0].text)).toEqual(reference());
    await t.st.exportAs("mermaid");
    expect(t.saves[1].rel).toBe("docs/architecture/docker-vs-kubernetes.mmd");
    expect(t.saves[1].text).toBe("graph TB\n%% 21 comps\n");
  });

  test("no browser: descarrega; o Mermaid precisa do backend", async () => {
    const t = studio({ initial: reference(), desktop: false });
    expect(await t.st.exportAs("svg")).toBe("docker-vs-kubernetes.svg");
    expect(t.files.downloads[0]).toMatchObject({ name: "docker-vs-kubernetes.svg", mime: "image/svg+xml" });
    expect(await t.st.exportAs("mermaid")).toBeNull();
    expect(t.st.state().ioError).toBe(NEEDS_DESKTOP);
  });

  test("um desenho vazio não se exporta", async () => {
    const t = studio();
    expect(await t.st.exportAs("svg")).toBeNull();
    expect(t.st.state().ioError).toMatch(/empty/);
  });
});

/** O que o Rust devolve ao importar o diagrama do runtime do Delonix (forma reduzida). */
function importedRuntime(): Design {
  return fromArchitecture({
    components: [
      { id: "CLI", name: "delonix", kind: "process", outbox: false, group: "HOST" },
      { id: "STATE", name: "Estado JSON", kind: "state", outbox: false, group: "HOST" },
      { id: "SHIM", name: "log shim", kind: "process", outbox: false, group: "PERCONT" },
      { id: "KUBELET2", name: "kubelet", kind: "process", outbox: false },
    ],
    connections: [
      { from: "CLI", to: "STATE", event: "", style: "data", label: "lê e escreve" },
      { from: "CLI", to: "SHIM", event: "", style: "data", label: "fork" },
      { from: "KUBELET2", to: "CLI", event: "", style: "data" },
    ],
    groups: [
      { id: "HOST", label: "Host Linux", kind: "host", style: "dashed" },
      { id: "PERCONT", label: "Por container", kind: "boundary", style: "dashed", parent: "HOST" },
    ],
    views: [],
  });
}

describe("caso de uso: importar", () => {
  test("Mermaid colado: substitui (com confirmação), arruma de cima para baixo e mostra os avisos", async () => {
    let source = "";
    const t = studio({ initial: reference(), gateway: { importMermaid: async (s) => { source = s; return { design: importedRuntime(), warnings: ["4 component(s) without dxtutor metadata"] }; } } });
    expect(await t.st.importMermaid("graph TB\n  CLI --> STATE")).toBe(true);
    expect(source).toBe("graph TB\n  CLI --> STATE");
    expect(t.confirms[0]).toMatch(/Replace the current design/);
    const d = t.st.state().design;
    expect(d.components.map((c) => c.id)).toEqual(["CLI", "STATE", "SHIM", "KUBELET2"]);
    const l = layout(d);
    expect(new Set(d.components.map((c) => `${c.x},${c.y}`)).size).toBe(4); // já não estão todos na origem
    expect(l.nodes.get("CLI")!.y).toBeLessThan(l.nodes.get("STATE")!.y);
    expect(t.st.state().importWarnings).toEqual(["4 component(s) without dxtutor metadata"]);
    expect(t.st.state().ioMessage).toMatch(/Imported 4 components, 3 arrows and 2 groups/);
  });

  test("sem confirmação, o desenho actual fica; um erro do parser aparece", async () => {
    const keep = studio({ initial: reference(), confirm: false, gateway: { importMermaid: async () => ({ design: importedRuntime(), warnings: [] }) } });
    expect(await keep.st.importMermaid("graph TB")).toBe(false);
    expect(keep.st.state().design.components).toHaveLength(21);
    const bad = studio({ gateway: { importMermaid: async () => { throw "not a flowchart (sequenceDiagram): only `graph` and `flowchart` diagrams can be imported"; } } });
    expect(await bad.st.importMermaid("sequenceDiagram")).toBe(false);
    expect(bad.st.state().ioError).toMatch(/not a flowchart/);
    const browser = studio({ desktop: false });
    expect(await browser.st.importMermaid("graph TB")).toBe(false);
    expect(browser.st.state().ioError).toBe(NEEDS_DESKTOP);
  });

  test("abrir do projecto: .arch.json com posições; um Markdown com vários diagramas deixa escolher", async () => {
    const files: Record<string, string> = { "docs/architecture/x.arch.json": designFile(reference()), "ARCHITECTURE.md": DELONIX_MD };
    const imported: string[] = [];
    const t = studio({
      gateway: {
        readFile: async (_root, rel) => { if (!(rel in files)) throw `cannot read \`${rel}\``; return files[rel]; },
        importMermaid: async (s) => { imported.push(s); return { design: importedRuntime(), warnings: [] }; },
      },
    });
    await t.st.openFromProject("docs/architecture/x.arch.json");
    expect(t.st.state().design).toEqual(reference());
    await t.st.openFromProject("ARCHITECTURE.md");
    expect(t.st.state().mdBlocks!.map((b) => b.label)).toEqual(["#1 · graph TB · OP, DLX…", "#3 · graph TB · HOST, CLI…"]);
    await t.st.importBlock(1);
    expect(imported[0]).toContain('subgraph HOST["Host Linux"]');
    expect(t.st.state().mdBlocks).toBeNull();
    await t.st.openFromProject("../segredo.md");
    expect(t.st.state().ioError).toMatch(/inside the project/);
    await t.st.openFromProject("nao-existe.md");
    expect(t.st.state().ioError).toMatch(/cannot read/);
    const noFolder = studio({ root: null });
    await noFolder.st.openFromProject("x.md");
    expect(noFolder.st.state().ioError).toMatch(/Open a folder/);
  });
});

describe("vista: ⇄ Import / Export", () => {
  test("a barra abre o painel; os botões exportam por data-action; importar lê a caixa de texto", async () => {
    document.body.innerHTML = "<div id=h></div>";
    const host = document.getElementById("h")!;
    let pasted = "";
    const files = fakeFiles();
    let v: ReturnType<typeof makeArchView> | null = null;
    const live = makeArchStudio({
      gateway: { available: () => true, validate: async () => [], preview: async () => [], scaffold: async () => [], ...ioGateway, importMermaid: async (s) => { pasted = s; return { design: importedRuntime(), warnings: ["guessed"] }; } },
      store: { load: () => reference(), save: () => {} }, files, renderer: makeRenderer(() => ({})),
      workspace: { root: () => null, confirm: () => true, prompt: () => null }, repaint: (s) => v?.repaint(s),
    });
    v = makeArchView({ studio: live, root: () => null, savesToProject: () => false });
    bindActions(archActions(live, () => null));
    v.mount(host);
    (host.querySelector('[data-action="arch-io"]') as HTMLElement).click();
    expect(host.querySelector("[data-arch-insp]")!.textContent).toMatch(/Downloaded by the browser/);
    (host.querySelector('[data-action="arch-export"][data-on="svg"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(files.downloads.map((d) => d.name)).toEqual(["docker-vs-kubernetes.svg"]);
    (host.querySelector("[data-arch-mermaid]") as HTMLTextAreaElement).value = "graph TB\n  CLI --> STATE";
    (host.querySelector('[data-action="arch-import-mermaid"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(pasted).toBe("graph TB\n  CLI --> STATE");
    expect(host.querySelector("[data-arch-insp]")!.textContent).toMatch(/Imported 4 components/);
    expect(host.querySelector("[data-arch-insp]")!.textContent).toMatch(/guessed/);
    expect(host.querySelectorAll("[data-n]")).toHaveLength(4);
  });
});

describe("adaptador Tauri (contrato dos comandos)", () => {
  type Call = { cmd: string; args: Record<string, unknown> };
  const calls: Call[] = [];
  const G = globalThis as unknown as { __TAURI__?: unknown };
  beforeEach(() => {
    calls.length = 0;
    G.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "arch_import_mermaid") {
            // a forma real do serde: sem os campos opcionais vazios
            return { arch: { components: [{ id: "A", name: "A", kind: "process", outbox: false }, { id: "B", name: "B", kind: "state", outbox: false, group: "H" }], connections: [{ from: "A", to: "B", event: "", style: "control", label: "fork" }], groups: [{ id: "H", label: "Host", kind: "host", style: "dashed" }] }, warnings: ["w"] };
          }
          if (cmd === "arch_export_mermaid") return "graph TB\n";
          if (cmd === "arch_save_export") return args.rel;
          if (cmd === "read_text_file") return "conteúdo";
          return null;
        },
      },
    };
  });
  afterEach(() => { delete G.__TAURI__; });

  test("nomes, argumentos e a leitura tolerante da resposta", async () => {
    expect(tauriArchGateway.available()).toBe(true);
    const r = await tauriArchGateway.importMermaid("graph TB\n A --> B");
    expect(calls[0]).toEqual({ cmd: "arch_import_mermaid", args: { source: "graph TB\n A --> B" } });
    expect(r.warnings).toEqual(["w"]);
    expect(r.design.groups[0]).toMatchObject({ id: "H", label: "Host", kind: "host", style: "dashed" });
    expect(r.design.components[1].group).toBe("H");
    expect(r.design.connections[0]).toMatchObject({ style: "control", label: "fork" });
    expect(r.design.views).toEqual([]);

    const d = emptyDesign();
    addComponent(d, "cli", "a");
    addComponent(d, "daemon", "b");
    connect(d, "a", "b");
    await tauriArchGateway.exportMermaid({ components: d.components.map(({ x, y, ...c }) => (void x, void y, c)), connections: d.connections, groups: [], views: [] });
    expect(calls[1].cmd).toBe("arch_export_mermaid");
    expect((calls[1].args.arch as { components: unknown[] }).components).toHaveLength(2);

    expect(await tauriArchGateway.saveExport("/p", "docs/architecture/x.png", new Uint8Array([137, 80, 78, 71]))).toBe("docs/architecture/x.png");
    expect(calls[2]).toEqual({ cmd: "arch_save_export", args: { root: "/p", rel: "docs/architecture/x.png", bytes: [137, 80, 78, 71] } });

    expect(await tauriArchGateway.readFile("/p/", "ARCHITECTURE.md")).toBe("conteúdo");
    expect(calls[3]).toEqual({ cmd: "read_text_file", args: { path: "/p/ARCHITECTURE.md" } });
  });
});
