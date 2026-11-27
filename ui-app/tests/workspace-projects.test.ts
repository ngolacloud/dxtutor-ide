// H2: the projects of the workspace and the current one; and the Co-Dev adapter sends the session's kind and
// project to the backend (the `backlog` flag was missing from the adapter until H2 — no test went through it).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseWorkspace, projectDir, workspaceProjects } from "../src/app/workspace-projects";

const WS = {
  projects: [
    { name: "shop", path: ".", language: "typescript", markers: ["package.json"], test: null, lint: null, declared: false },
    { name: "web", path: "apps/web", language: "typescript", markers: ["package.json"], test: "pnpm test", lint: "pnpm run lint", declared: false },
    { name: "orders", path: "services/orders", language: "rust", markers: ["Cargo.toml"], test: "cargo test", lint: "cargo clippy", declared: true },
    { nope: 1 },
  ],
  notes: [],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="status"><span id="st-tests"></span></div>';
  localStorage.clear();
});

test("the workspace answer is narrowed and a project's folder is under the workspace", () => {
  const ps = parseWorkspace(WS);
  expect(ps.map((p) => p.path)).toEqual([".", "apps/web", "services/orders"]);
  expect(ps[1]).toEqual({ name: "web", path: "apps/web", language: "typescript", test: "pnpm test", lint: "pnpm run lint", declared: false });
  expect(projectDir("/w/shop", ".")).toBe("/w/shop");
  expect(projectDir("/w/shop/", "apps/web")).toBe("/w/shop/apps/web");
  expect(parseWorkspace(null)).toEqual([]);
});

test("the root project is current by default; a pick is remembered per folder and announced", async () => {
  await workspaceProjects.load("/w/shop", async () => WS);
  expect(workspaceProjects.currentPath()).toBe(".");
  expect(workspaceProjects.currentDir()).toBe("/w/shop");
  const chip = document.getElementById("st-project")!;
  expect(chip.style.display).toBe("");
  expect(chip.textContent).toBe("◫ shop");
  const seen = vi.fn();
  const off = workspaceProjects.onChange(seen);
  workspaceProjects.select("services/orders");
  expect(seen).toHaveBeenCalledTimes(1);
  expect(workspaceProjects.currentDir()).toBe("/w/shop/services/orders");
  expect(chip.textContent).toBe("◫ orders");
  workspaceProjects.select("nope");
  expect(workspaceProjects.currentPath()).toBe("services/orders", );
  off();
  // reopening the folder keeps the pick
  await workspaceProjects.load("/w/shop", async () => WS);
  expect(workspaceProjects.currentPath()).toBe("services/orders");
});

test("one project: no chip; a failed read leaves the workspace root", async () => {
  await workspaceProjects.load("/w/one", async () => ({ projects: [{ name: "one", path: "." }] }));
  expect(document.getElementById("st-project")!.style.display).toBe("none");
  await workspaceProjects.load("/w/bad", async () => {
    throw new Error("x");
  });
  expect(workspaceProjects.currentDir()).toBe("/w/bad");
});

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

test("the Co-Dev adapter sends the backlog flag and the project to codev_agent_start", async () => {
  const invoke = vi.fn(async () => "S1");
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = { core: { invoke } };
  const { agentGateway } = await import("../src/features/codev/infrastructure/agent-gateway");
  await agentGateway.start({ root: "/w/shop", provider: "claude", model: "m", effort: "high", testCmd: null, lintCmd: null, mode: "manual", backlog: true, project: "apps/web" });
  const [cmd, args] = invoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
  expect(cmd).toBe("codev_agent_start");
  expect(args).toMatchObject({ root: "/w/shop", backlog: true, project: "apps/web", architecture: false });
});
