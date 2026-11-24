import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { commandsFor, nodePm, type ProjectFiles } from "../src/features/run-commands";

/* Run (ADR-0006, R2d): os projectos da pasta pelo backend (`detect_projects`, IPC falso aqui)
 * e os comandos de cada um pela regra pura; sem a lista fixa do workspace de demonstração. */

const files = (map: Record<string, string>): ProjectFiles => ({ has: (f) => f in map, read: (f) => map[f] ?? null });

describe("commandsFor — os comandos habituais de cada ecossistema", () => {
  it("Rust e Go", () => {
    expect(commandsFor("rust", files({})).map((c) => c.cmd)).toEqual(["cargo run", "cargo build", "cargo test"]);
    expect(commandsFor("go", files({})).map((c) => c.cmd)).toEqual(["go run .", "go build ./...", "go test ./..."]);
  });

  it("Node: os scripts reais do package.json, com o gestor do lockfile", () => {
    const f = files({ "package.json": JSON.stringify({ scripts: { dev: "vite", test: "vitest run" } }), "pnpm-lock.yaml": "" });
    expect(nodePm(f)).toBe("pnpm");
    expect(commandsFor("node", f)).toEqual([{ cmd: "pnpm run dev", label: "vite" }, { cmd: "pnpm run test", label: "vitest run" }]);
    expect(commandsFor("node", files({ "package.json": "{}" })).map((c) => c.cmd)).toEqual(["npm install"]);
    expect(commandsFor("node", files({ "package.json": "{ estragado" })).map((c) => c.cmd)).toEqual(["npm install"]);
  });

  it("Python, Java (Maven/Gradle), PHP, Ruby; tipo desconhecido não inventa", () => {
    expect(commandsFor("python", files({ "manage.py": "" }))[0].cmd).toBe("python3 manage.py runserver");
    expect(commandsFor("java", files({ "pom.xml": "" })).map((c) => c.cmd)).toEqual(["mvn -q package", "mvn -q test"]);
    expect(commandsFor("java", files({ gradlew: "" }))[0].cmd).toBe("./gradlew build");
    expect(commandsFor("php", files({}))[0].cmd).toBe("composer install");
    expect(commandsFor("ruby", files({ Rakefile: "" })).map((c) => c.cmd)).toContain("bundle exec rake");
    expect(commandsFor("cobol", files({}))).toEqual([]);
  });
});

let w: any;
let calls: Array<[string, Record<string, unknown>]>;
const pane = (): HTMLElement => document.getElementById("pane-run")!;
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

describe("o pane Run na cadeia real", () => {
  beforeEach(async () => {
    w = await bootApp();
    calls = [];
  });
  afterEach(() => {
    delete w.__TAURI__;
    delete w.DXR;
    vi.restoreAllMocks();
  });

  it("sem pasta, diz como abrir uma (e já não mostra a lista fixa)", () => {
    w.renderRunPane();
    expect(pane().textContent).toMatch(/Open a folder/);
    expect(pane().textContent).not.toMatch(/dx lint|cargo test -p lexer/);
  });

  it("menus e paleta abrem o pane em vez de correrem comandos fixos", () => {
    w.buildMenus(); // o que o arranque monta (o boot não corre no harness)
    const run = w.MENUS.find((m: any) => m.t === "Run");
    const labels = run.items.map((i: any) => i.l);
    expect(labels).toContain("Run Project…");
    expect(labels.join(" ")).not.toMatch(/dx lint|cargo/);
    expect(w.CMD.map((c: any) => c[0]).join(" ")).not.toMatch(/Tarefa: (cargo|dx lint)/);
  });

  describe("com pasta (desktop, IPC falso)", () => {
    const runTask = vi.fn();
    beforeEach(() => {
      runTask.mockReset();
      w.DXR = { root: "/proj", term: { runTask } };
      w.FS[w.ROOT + "web/package.json"] = { content: JSON.stringify({ scripts: { dev: "vite" } }), orig: null };
      w.__TAURI__ = {
        core: {
          invoke: async (cmd: string, args: Record<string, unknown>) => {
            calls.push([cmd, args]);
            return [
              { name: "proj", path: "/proj", kind: "rust" },
              { name: "web", path: "/proj/web", kind: "node" },
            ];
          },
        },
      };
    });

    it("lista os projectos detectados e os comandos de cada um", async () => {
      w.PANE = "run";
      w.renderRunPane();
      expect(pane().textContent).toMatch(/A detectar/);
      await vi.waitFor(() => expect(pane().textContent).toMatch(/npm run dev/));
      expect(calls).toEqual([["detect_projects", { root: "/proj" }]]);
      expect(pane().textContent).toMatch(/cargo run/);
      expect(pane().textContent).toMatch(/web\//);
      expect(pane().querySelector("[onclick]")).toBe(null);
    });

    it("clicar num comando corre-o num terminal de tarefa na pasta do projecto", async () => {
      w.PANE = "run";
      w.renderRunPane();
      await vi.waitFor(() => expect(pane().querySelector('[data-run-cmd="npm run dev"]')).toBeTruthy());
      click(pane().querySelector('[data-run-cmd="npm run dev"] .nm')!);
      expect(runTask).toHaveBeenCalledWith("npm run dev", { cwd: "/proj/web", label: "npm run dev" });
    });

    it("sem terminal de tarefa, corre pelo runTask com cd para a sub-pasta", async () => {
      delete w.DXR.term;
      const rt = vi.spyOn(w, "runTask").mockImplementation(() => {});
      w.PANE = "run";
      w.renderRunPane();
      await vi.waitFor(() => expect(pane().querySelector('[data-run-cmd="npm run dev"]')).toBeTruthy());
      click(pane().querySelector('[data-run-cmd="npm run dev"]')!);
      expect(rt).toHaveBeenCalledWith("cd '/proj/web' && npm run dev");
    });

    it("um erro do backend diz-se no pane", async () => {
      w.__TAURI__.core.invoke = async () => { throw new Error("detect failed"); };
      w.PANE = "run";
      w.renderRunPane();
      await vi.waitFor(() => expect(pane().textContent).toMatch(/Could not detect the projects: detect failed/));
    });
  });
});
