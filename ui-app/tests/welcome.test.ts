import { describe, expect, it, vi } from "vitest";
import { WALKTHROUGHS, stepAction, walkthrough, walkthroughKeys } from "../src/features/welcome/domain/walkthroughs";
import { currentStep, markDone, markOpened, parseState, progressOf, showOnStartup } from "../src/features/welcome/domain/progress";
import { defaultCloneParent, recentEntries } from "../src/features/welcome/domain/recent";
import { makeWelcome } from "../src/features/welcome/application/welcome-service";
import type { ApprovalRequest, ClonePlan } from "../src/features/welcome/application/ports";
import { WELCOME_UI_MESSAGES } from "../src/features/welcome/ui/messages";
import { renderWalk, renderWelcome } from "../src/features/welcome/ui/welcome-view";

/* r23 F6: a página de boas-vindas (Start · Recent · Walkthroughs). Recent é o histórico real (nunca pastas
 * inventadas); Clone é um comando que o backend constrói, aprovado e auditado; os walkthroughs guardam o
 * progresso de quem os vê. */

describe("domínio", () => {
  it("os walkthroughs: sem Cloud, os cartões antigos viraram «Build», e cada texto existe nas duas línguas", () => {
    expect(WALKTHROUGHS.map((w) => w.id)).toEqual(["start", "build", "codev", "project", "pair", "quality", "learn"]);
    expect(walkthrough("build")!.steps.map((s) => s.action)).toEqual(["studio", "team", "board", "run", "deploy", "infra"]);
    for (const k of walkthroughKeys()) {
      expect(WELCOME_UI_MESSAGES.en, k).toHaveProperty([k]);
      expect(WELCOME_UI_MESSAGES.ptAO, k).toHaveProperty([k]);
    }
    expect(Object.keys(WELCOME_UI_MESSAGES.ptAO).sort()).toEqual(Object.keys(WELCOME_UI_MESSAGES.en).sort());
  });

  it("um passo só do desktop tem alternativa no browser (ou nenhuma)", () => {
    const folder = walkthrough("start")!.steps.find((s) => s.id === "folder")!;
    expect(stepAction(folder, true)).toBe("openFolder");
    expect(stepAction(folder, false)).toBe("explorer");
    expect(stepAction({ id: "x", action: "openFolder", desktop: true }, false)).toBeNull();
  });

  it("o progresso: defensivo, «mark done», o passo actual e a escolha do arranque", () => {
    expect(parseState("lixo")).toEqual({ done: [], opened: [], show: true });
    expect(showOnStartup(null)).toBe(true);
    expect(showOnStartup({ show: false })).toBe(false);
    const w = walkthrough("pair")!;
    let s = markDone(parseState(null), "pair", "host");
    expect(markDone(s, "pair", "host")).toBe(s);
    expect(progressOf(s, w)).toEqual({ done: 1, total: 2, pct: 50 });
    expect(currentStep(s, w)).toBe(1);
    s = markDone(s, "pair", "join");
    expect(currentStep(s, w)).toBe(1);
    expect(markOpened(s, "pair").opened).toEqual(["pair"]);
  });

  it("as pastas recentes: nome e pasta-mãe, sem repetidos nem lixo; o clone vai para ao lado da mais recente", () => {
    const r = recentEntries(["/home/ana/work/alpha/", "/home/ana/work/alpha/", 3, "", "/beta", "C:\\code\\gamma"]);
    expect(r).toEqual([
      { path: "/home/ana/work/alpha/", name: "alpha", parent: "/home/ana/work" },
      { path: "/beta", name: "beta", parent: "/" },
      { path: "C:\\code\\gamma", name: "gamma", parent: "C:\\code" },
    ]);
    expect(recentEntries("x")).toEqual([]);
    expect(defaultCloneParent(r, "/home/ana")).toBe("/home/ana/work");
    expect(defaultCloneParent([], "/home/ana")).toBe("/home/ana");
  });
});

const PLAN: ClonePlan = { url: "https://github.com/o/r.git", parent: "/home/ana/work", name: "r", target: "/home/ana/work/r", exists: false, command: "git -C /home/ana/work clone -- https://github.com/o/r.git r" };

function fakes(opts: { desktop?: boolean; approve?: boolean; auditFails?: boolean; cloneFails?: boolean; plan?: Partial<ClonePlan> } = {}) {
  const texts: Array<string | null> = ["https://github.com/o/r.git", "/home/ana/work"];
  const asked: ApprovalRequest[] = [], toasts: string[] = [], opened: Array<string | undefined> = [], cloned: string[] = [];
  const audited: Array<{ root: string; action: string; approved: boolean; outcome?: string; command: string }> = [];
  let saved: unknown = null;
  const w = makeWelcome({
    workspace: { desktop: () => opts.desktop ?? true, home: () => "/home/ana", recent: () => ["/home/ana/work/alpha", "/home/ana/work/beta"], open: async (p) => { opened.push(p); } },
    git: {
      clonePlan: vi.fn(async (url: string, parent: string) => { if (url === "bad") throw new Error("unsupported repository URL"); return { ...PLAN, url, parent, ...opts.plan }; }),
      clone: async (url) => { if (opts.cloneFails) throw new Error("Repository not found"); cloned.push(url); return PLAN.target; },
    },
    human: { approve: async (r) => { asked.push(r); return { approved: opts.approve ?? true, reason: "", decidedAt: 9 }; }, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m) },
    audit: { record: async (root, e) => { if (opts.auditFails) throw new Error("db locked"); audited.push({ root, ...e }); } },
    store: { load: () => saved, save: (v) => { saved = v; } },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { w, texts, asked, toasts, opened, cloned, audited, saved: () => saved };
}

describe("o serviço", () => {
  it("Recent é o histórico real no desktop e vazio no browser", () => {
    expect(fakes().w.recent().map((r) => r.name)).toEqual(["alpha", "beta"]);
    expect(fakes({ desktop: false }).w.recent()).toEqual([]);
  });

  it("Clone: o comando do backend no diálogo, auditado antes de correr e com o resultado, e abre a pasta nova", async () => {
    const f = fakes();
    await expect(f.w.clone()).resolves.toBe("/home/ana/work/r");
    expect(f.asked[0]).toEqual({ title: 'cloneTitle {"name":"r"}', command: PLAN.command, scope: 'cloneScope {"target":"/home/ana/work/r"}' });
    expect(f.cloned).toEqual(["https://github.com/o/r.git"]);
    expect(f.audited.map((a) => `${a.root}:${a.action}:${a.outcome}`)).toEqual(["/home/ana/work/r:git.clone:sent", "/home/ana/work/r:git.clone:ok"]);
    expect(f.opened).toEqual(["/home/ana/work/r"]);
  });

  it("Clone recusado: auditado, nada clonado; sem auditoria não corre; a pasta existe: não pergunta", async () => {
    const no = fakes({ approve: false });
    await no.w.clone();
    await vi.waitFor(() => expect(no.audited).toHaveLength(1));
    expect(no.audited[0]).toMatchObject({ approved: false });
    expect(no.audited[0].outcome).toBeUndefined();
    expect(no.cloned).toEqual([]);
    const blind = fakes({ auditFails: true });
    await blind.w.clone();
    expect(blind.cloned).toEqual([]);
    expect(blind.toasts.at(-1)).toContain("notAudited");
    const there = fakes({ plan: { exists: true } });
    await there.w.clone();
    expect(there.asked).toEqual([]);
    expect(there.toasts.at(-1)).toContain("cloneExists");
  });

  it("Clone: URL recusado pelo backend, falha do git (auditada), cancelar a pergunta, e no browser nada", async () => {
    const bad = fakes();
    bad.texts[0] = "bad";
    await bad.w.clone();
    expect(bad.toasts.at(-1)).toContain("unsupported repository URL");
    const fail = fakes({ cloneFails: true });
    await fail.w.clone();
    await vi.waitFor(() => expect(fail.audited.map((a) => a.outcome)).toEqual(["sent", "failed"]));
    expect(fail.opened).toEqual([]);
    expect(fail.toasts.at(-1)).toContain("Repository not found");
    const cancel = fakes();
    cancel.texts[0] = null;
    await cancel.w.clone();
    expect(cancel.asked).toEqual([]);
    const web = fakes({ desktop: false });
    await expect(web.w.clone()).resolves.toBeNull();
  });

  it("os walkthroughs: «new» até abrir, abre no passo por fazer, «mark done» avança e guarda", () => {
    const f = fakes();
    expect(f.w.walkthroughs().find((x) => x.w.id === "quality")!.fresh).toBe(true);
    f.w.openWalk("quality");
    expect(f.w.walkthroughs().find((x) => x.w.id === "quality")!.fresh).toBe(false);
    expect(f.w.selected("quality")).toBe(0);
    f.w.done("quality", "tests");
    expect(f.w.selected("quality")).toBe(1);
    expect(f.saved()).toMatchObject({ done: ["quality.tests"], opened: ["quality"] });
    f.w.setShow(false);
    expect(f.saved()).toMatchObject({ show: false });
  });
});

describe("a vista", () => {
  const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
  const ic = (n: string) => `<i data-ic="${n}"></i>`;
  it("Start, Recent (real ou vazio, sem pastas inventadas) e os walkthroughs com progresso", () => {
    const f = fakes();
    const h = document.createElement("div");
    h.innerHTML = renderWelcome(t as never, ic, { desktop: true, cloning: false, tagline: "x", recent: f.w.recent(), moreRecent: true, walks: f.w.walkthroughs(), show: true });
    expect([...h.querySelectorAll('[data-action="welcome:openRecent"]')].map((e) => (e as HTMLElement).dataset.on)).toEqual(["/home/ana/work/alpha", "/home/ana/work/beta"]);
    expect(h.querySelector('[data-action="welcome:moreRecent"]')).not.toBeNull();
    expect(h.querySelectorAll(".wel-walk")).toHaveLength(7);
    expect(h.querySelector('[data-action="welcome:clone"]')!.hasAttribute("disabled")).toBe(false);
    expect((h.querySelector('[data-action="welcome:toggleShow"]') as HTMLInputElement).checked).toBe(true);
    h.innerHTML = renderWelcome(t as never, ic, { desktop: false, cloning: false, tagline: "x", recent: [], moreRecent: false, walks: [], show: false });
    expect(h.textContent).toContain("noRecentBrowser");
    expect(h.querySelector('[data-action="welcome:clone"]')!.hasAttribute("disabled")).toBe(true);
    expect(h.querySelector('[data-action="welcome:openFolder"]')!.hasAttribute("disabled")).toBe(true);
  });

  it("um walkthrough: os passos, o seleccionado com a sua acção, e o feito marcado", () => {
    const w = walkthrough("start")!;
    const st = markDone(parseState(null), "start", "theme");
    const h = document.createElement("div");
    h.innerHTML = renderWalk(t as never, ic, w, st, 2, progressOf(st, w), false);
    expect(h.querySelectorAll(".wel-step")).toHaveLength(5);
    expect(h.querySelector(".wel-step.done")!.textContent).toContain("start.theme");
    expect(h.querySelector(".wel-step.on")!.textContent).toContain("start.folder");
    expect(h.querySelector('[data-action="welcome:run"]')!.textContent).toBe("showExplorer"); // no browser
    expect(h.querySelector('[data-action="welcome:done"]')).not.toBeNull();
  });
});
