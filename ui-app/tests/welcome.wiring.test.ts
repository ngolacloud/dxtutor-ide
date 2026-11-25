import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";

/* r23 F6 ligada de ponta a ponta na cadeia real de módulos: a página de boas-vindas (VIEW.welcome), os
 * walkthroughs (VIEW.walk), o despacho delegado, os comandos da paleta e os adaptadores Tauri. O desktop
 * entra como `DXR` + `__TAURI__` falsos DEPOIS do boot. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let w: any;
const click = (el: Element | null) => { expect(el).not.toBeNull(); el!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
const host = (): HTMLElement => { const h = document.createElement("div"); document.body.appendChild(h); return h; };

beforeEach(async () => { w = await bootApp(); localStorage.clear(); });
afterEach(() => { delete w.__TAURI__; delete w.DXR; document.querySelectorAll("#approval").forEach((e) => e.remove()); });

describe("no browser", () => {
  it("sem pastas inventadas: Recent vazio, Open Folder e Clone desligados", () => {
    const h = host();
    w.VIEW.welcome({ id: "welcome", kind: "welcome" }, h);
    expect(h.querySelectorAll('[data-action="welcome:openRecent"]')).toHaveLength(0);
    expect(h.textContent).toContain("Recent folders appear here in the desktop app.");
    expect(h.querySelector('[data-action="welcome:clone"]')!.hasAttribute("disabled")).toBe(true);
  });
});

describe("no desktop", () => {
  let opened: Array<string | undefined>;
  beforeEach(() => {
    opened = [];
    w.__TAURI__ = { core: { invoke: async () => null } };
    w.DXR = { open: async (p?: string) => { opened.push(p); }, info: { home: "/home/ana" } };
    localStorage.setItem("dx2.dx-recent", JSON.stringify(["/home/ana/work/alpha", "/home/ana/work/beta"]));
  });

  it("abrir uma pasta recente abre essa pasta; Open Folder pede ao sistema", async () => {
    const h = host();
    w.VIEW.welcome({ id: "welcome", kind: "welcome" }, h);
    expect([...h.querySelectorAll(".wel-recent")].map((e) => e.textContent)).toEqual(["alpha/home/ana/work", "beta/home/ana/work"]);
    click(h.querySelector('[data-action="welcome:openRecent"][data-on="/home/ana/work/beta"]'));
    click(h.querySelector('[data-action="welcome:openFolder"]'));
    await Promise.resolve();
    expect(opened).toEqual(["/home/ana/work/beta", undefined]);
  });

  it("um walkthrough abre no seu separador, «Mark done» avança e o progresso fica guardado; a escolha do arranque também", async () => {
    const h = host();
    w.VIEW.welcome({ id: "welcome", kind: "welcome" }, h);
    expect(h.querySelector('[data-action="welcome:openWalk"][data-on="quality"] .wel-new')).not.toBeNull();
    click(h.querySelector('[data-action="welcome:openWalk"][data-on="quality"]'));
    const tab = (await import("../src/app/store")).editorStore.tabs;
    expect(tab.some((t: { id: string; kind: string }) => t.id === "walk:quality" && t.kind === "walk")).toBe(true);
    const wh = host();
    w.VIEW.walk({ id: "walk:quality", kind: "walk" }, wh);
    expect(wh.querySelector(".wel-step.on")!.textContent).toContain("Run tests with the native tools");
    click(wh.querySelector('[data-action="welcome:done"]'));
    expect(wh.querySelector(".wel-step.on")!.textContent).toContain("Debug without guessing");
    expect(JSON.parse(localStorage.getItem("dx2.wel.v1")!)).toMatchObject({ done: ["quality.tests"], opened: ["quality"] });
    const box = h.querySelector('[data-action="welcome:toggleShow"]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("dx2.wel.v1")!).show).toBe(false);
  });

  it("os comandos «Help: Welcome» e «Help: Walkthroughs» estão na paleta", async () => {
    const { CMD } = await import("../src/app/commands");
    expect(CMD.map((c) => c[0])).toEqual(expect.arrayContaining(["Help: Welcome", "Help: Walkthroughs"]));
  });
});

describe("os adaptadores Tauri", () => {
  it("git_clone_plan/git_clone e o audit_record com feature welcome", async () => {
    const { tauriGit, tauriAudit } = await import("../src/features/welcome/infrastructure/tauri");
    const calls: Array<[string, unknown]> = [];
    const inv = (async (cmd: string, args?: unknown) => { calls.push([cmd, args]); return cmd === "git_clone" ? "/w/r" : { name: "r" }; }) as never;
    await tauriGit(inv).clonePlan("https://h/r.git", "/w");
    await expect(tauriGit(inv).clone("https://h/r.git", "/w")).resolves.toBe("/w/r");
    await tauriAudit(inv).record("/w/r", { action: "git.clone", command: "git -C /w clone -- https://h/r.git r", scope: "/w/r", approved: true, reason: "", decidedAt: 3, outcome: "ok" });
    expect(calls).toEqual([
      ["git_clone_plan", { url: "https://h/r.git", parentDir: "/w" }],
      ["git_clone", { url: "https://h/r.git", parentDir: "/w" }],
      ["audit_record", { root: "/w/r", entry: { feature: "welcome", action: "git.clone", command: "git -C /w clone -- https://h/r.git r", scope: "/w/r", approved: true, reason: undefined, decidedAt: 3, outcome: "ok" } }],
    ]);
  });
});
