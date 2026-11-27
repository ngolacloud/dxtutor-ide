// New Project (os templates do Delonix): o domínio, o caso de uso com fakes e o modal pelo despachante partilhado.
import { beforeAll, expect, test, vi } from "vitest";
import { byGroup, nameProblem, parentOf, parseCreated, parsePlan, parseTemplates, slug } from "../src/features/newproject/domain/catalog";
import { makeNewProject, type NewProjectDeps } from "../src/features/newproject/application/new-project";
import { mountNewProject } from "../src/features/newproject/ui/view";
import { translator } from "../src/app/i18n";
import { NEW_PROJECT_MESSAGES } from "../src/features/newproject/ui/messages";

const T = [
  { id: "rust", name: "Rust", group: "language", language: "rust", icon: "🦀", summary: "A JSON API in Rust", version: "1.90", versions: ["1.89", "1.90"], port: "8000", tlsPort: null, health: "/h", files: 54 },
  { id: "fastapi", name: "FastAPI", group: "framework", language: "python", icon: "⚡", summary: "A FastAPI service", version: "0.142", versions: ["0.141", "0.142"], port: "8000", tlsPort: "8443", health: "/h", files: 83 },
  { id: "nginx", name: "nginx", group: "server", language: "nginx", icon: "🌐", summary: "An nginx edge", version: "1.30", versions: [], port: "8080", tlsPort: "8443", health: "/healthz", files: 18 },
  { id: "weird", group: "spaceship" },
  { name: "no id" },
];
const PLAN = { dir: "/w/shop-api", template: "fastapi", version: "0.142", files: 84, port: "8000", tlsPort: "8443", command: "create /w/shop-api from the Delonix template fastapi 0.142: 84 files, then git init (main) and commit «chore: scaffold»" };
const MADE = { dir: "/w/shop-api", template: "fastapi", version: "0.142", files: 84, port: "8000", health: "/h", tlsPort: "8443", lock: { kind: "missing", file: "uv.lock", command: "uv lock" }, git: { kind: "committed" } };

test("o catálogo estreita-se e agrupa-se pela ordem do diálogo", () => {
  const ts = parseTemplates(T);
  expect(ts.map((t) => t.id)).toEqual(["rust", "fastapi", "nginx", "weird"]);
  expect(ts[3]).toMatchObject({ name: "weird", group: "other", icon: "📦", versions: [] });
  expect(byGroup(ts).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([["language", ["rust"]], ["framework", ["fastapi"]], ["server", ["nginx"]], ["other", ["weird"]]]);
  expect(parseTemplates(null)).toEqual([]);
});

test("a regra do nome é a do Delonix (uma etiqueta DNS)", () => {
  expect(nameProblem("shop-api")).toBeNull();
  for (const bad of ["Shop", "-a", "a-", "a_b", "a b", "x".repeat(64)]) expect(nameProblem(bad)).toBe("shape");
  expect(nameProblem("")).toBe("empty");
  expect(slug("My Shop_API!")).toBe("my-shop-api");
  expect(parentOf("/home/ana/work/shop/")).toBe("/home/ana/work");
  expect(parsePlan(PLAN)!.command).toContain("chore: scaffold");
  expect(parsePlan({ dir: "/x" })).toBeNull();
  expect(parseCreated(MADE)!.lock).toEqual({ kind: "missing", file: "uv.lock", command: "uv lock" });
  expect(parseCreated({ ...MADE, git: { kind: "failed", detail: "x" } })!.git).toEqual({ kind: "failed", detail: "x" });
});

function setup(approve = true, extra: Partial<NewProjectDeps["scaffold"]> = {}) {
  const deps: NewProjectDeps = {
    scaffold: { available: () => true, templates: vi.fn(async () => T), plan: vi.fn(async () => PLAN), create: vi.fn(async () => MADE), ...extra },
    workspace: { defaultParent: () => "/w", pickFolder: vi.fn(async () => "/projects"), open: vi.fn(async () => undefined) },
    human: { approve: vi.fn(async () => ({ approved: approve })) },
    copy: (k, p) => `${k}${p ? JSON.stringify(p) : ""}`,
  };
  return { deps, np: makeNewProject(deps) };
}

test("abrir carrega os templates; escolher sugere nome e versão; criar passa pelo plano, pela aprovação e abre a pasta", async () => {
  const { deps, np } = setup();
  np.open();
  await vi.waitFor(() => expect(np.state().templates).not.toBeNull());
  expect(np.state()).toMatchObject({ open: true, step: "pick", parent: "/w" });
  np.pick("fastapi");
  expect(np.state()).toMatchObject({ step: "form", name: "fastapi-app", version: "0.142" });
  expect(np.setName("Shop")).toBe("shape");
  expect(await np.create()).toBe(false);
  expect(deps.scaffold.plan).not.toHaveBeenCalled();
  expect(np.setName("shop-api")).toBeNull();
  np.setVersion("0.141");
  expect(await np.create()).toBe(true);
  expect(deps.scaffold.plan).toHaveBeenCalledWith("/w", "shop-api", "fastapi", "0.141");
  expect(deps.human.approve).toHaveBeenCalledWith({ title: 'approveTitle{"name":"shop-api","template":"FastAPI"}', command: PLAN.command, scope: "/w/shop-api" });
  expect(deps.scaffold.create).toHaveBeenCalledWith("/w", "shop-api", "fastapi", "0.141");
  expect(deps.workspace.open).toHaveBeenCalledWith("/w/shop-api");
  expect(np.state()).toMatchObject({ step: "done", result: { dir: "/w/shop-api" } });
});

test("recusado no diálogo, nada é criado; um erro do backend fica no formulário", async () => {
  const r = setup(false);
  r.np.open();
  await vi.waitFor(() => expect(r.np.state().templates).not.toBeNull());
  r.np.pick("rust");
  expect(await r.np.create()).toBe(false);
  expect(r.deps.scaffold.create).not.toHaveBeenCalled();
  expect(r.np.state().step).toBe("form");
  const e = setup(true, { plan: vi.fn(async () => { throw "/w/rust-app already exists and is not an empty folder — choose another name"; }) });
  e.np.open();
  await vi.waitFor(() => expect(e.np.state().templates).not.toBeNull());
  e.np.pick("rust");
  expect(await e.np.create()).toBe(false);
  expect(e.np.state()).toMatchObject({ step: "form", error: "/w/rust-app already exists and is not an empty folder — choose another name" });
  const off = setup(true, { available: () => false });
  off.np.open();
  expect(off.np.state().error).toBe("needsDesktop");
  expect(off.deps.scaffold.templates).not.toHaveBeenCalled();
});

let ui: ReturnType<typeof setup>;
beforeAll(() => {
  ui = setup();
  mountNewProject(ui.np, translator(NEW_PROJECT_MESSAGES));
});
const click = (sel: string) => (document.querySelector(sel) as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

test("o modal: os cartões por grupo, o formulário que valida o nome ao escrever, e o resultado", async () => {
  ui.np.open();
  await vi.waitFor(() => expect(document.querySelectorAll(".np-card").length).toBe(4));
  const np = document.getElementById("np")!;
  expect(np.classList.contains("show")).toBe(true);
  expect(Array.from(np.querySelectorAll(".np-sec")).map((h) => h.textContent)).toEqual(["Languages", "Frameworks", "Web servers", "Other"]);
  click('[data-action="newproject:pick"][data-on="fastapi"]');
  const name = document.getElementById("np-name") as HTMLInputElement;
  expect(name.value).toBe("fastapi-app");
  expect(np.textContent).toContain("It will be created in /w/fastapi-app.");
  expect(np.textContent).toContain("Port 8000 · HTTPS 8443");
  name.value = "Bad Name";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.getElementById("np-name-err")!.textContent).toContain("e.g. bad-name");
  expect((document.querySelector('[data-action="newproject:create"]') as HTMLButtonElement).disabled).toBe(true);
  name.value = "shop-api";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  expect((document.querySelector('[data-action="newproject:create"]') as HTMLButtonElement).disabled).toBe(false);
  click('[data-action="newproject:create"]');
  await vi.waitFor(() => expect(np.querySelector(".np-ok")).not.toBeNull());
  expect(np.querySelector(".np-ok")!.textContent).toBe("Project shop-api created (84 files) and opened as your workspace.");
  expect(np.textContent).toContain("uv.lock was not generated: install the package manager and run `uv lock` in the project.");
  expect(np.textContent).toContain("It serves HTTPS on 8443");
  click('[data-action="newproject:close"]');
  expect(np.classList.contains("show")).toBe(false);
});
