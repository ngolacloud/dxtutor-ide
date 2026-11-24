import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { changeSetsOfWorkingTree, commitMessageFor, parseChangeSetGroups, rangesText, type ChangeSetGroup } from "../src/features/scm/domain/changesets";
import { makeGitExtras } from "../src/features/scm/application/git-extras";
import type { GitExtrasPort, GitWorkspacePort } from "../src/features/scm/application/extras-ports";
import { renderChangeSets } from "../src/features/scm/ui/git-views";
import { changeSetsSignal } from "../src/app/change-sets-signal";
import { makeHunkReview } from "../src/features/codev/application/hunk-review";

/* RF-E08 (docs/v2/RF-DELONIX-PLANO.md F2.7): os change sets do Co-Dev ainda na árvore de
 * trabalho, agrupados por issue no Source Control, com Stage e Discard por conjunto. Domínio
 * puro, caso de uso com portas falsas, a vista, e a cadeia real de módulos com o IPC falso. */

const row = (path: string, start: number, end: number, added = 1, removed = 0) => ({ path, start, end, added, removed, decidedBy: "human", decidedAt: 1 });
const GROUPS: ChangeSetGroup[] = [
  { issueKey: "DX-7", title: "Paginate the list", rows: [row("src/b.rs", 40, 41, 2, 1), row("src/a.rs", 10, 12, 3), row("src/a.rs", 3, 4), row("src/a.rs", 13, 13), row("src/gone.rs", 1, 1)] },
  { issueKey: null, title: "", rows: [row("src/a.rs", 90, 90)] },
  { issueKey: "DX-2", title: "Old", rows: [row("src/committed.rs", 1, 2)] },
];

describe("domínio", () => {
  it("só os ficheiros ainda alterados; intervalos juntos por ficheiro; um conjunto vazio sai", () => {
    const sets = changeSetsOfWorkingTree(GROUPS, ["src/a.rs", "src/b.rs"]);
    expect(sets.map((s) => s.issueKey)).toEqual(["DX-7", null]);
    const [dx7, chat] = sets;
    expect(dx7.files.map((f) => f.path)).toEqual(["src/a.rs", "src/b.rs"]);
    expect(dx7.files[0].ranges).toEqual([[3, 4], [10, 13]]); // 10–12 e 13 tocam-se: um só
    expect(rangesText(dx7.files[0])).toBe("3–4, 10–13");
    expect([dx7.added, dx7.removed]).toEqual([7, 1]);
    // src/a.rs também está no conjunto do chat: Stage/Discard levam os dois
    expect(dx7.files[0].shared).toBe(true);
    expect(dx7.files[1].shared).toBe(false);
    expect(chat.files[0].shared).toBe(true);
  });

  it("a mensagem do commit leva a chave (o trailer Issue:); sem issue não há sugestão", () => {
    const [dx7, chat] = changeSetsOfWorkingTree(GROUPS, ["src/a.rs"]);
    expect(commitMessageFor(dx7)).toBe("Paginate the list (DX-7)");
    expect(commitMessageFor({ ...dx7, title: " " })).toBe("DX-7");
    expect(commitMessageFor(chat)).toBe("");
  });

  it("o payload do backend é estreitado", () => {
    expect(parseChangeSetGroups(null)).toEqual([]);
    const g = parseChangeSetGroups([{ issueKey: "", title: 3, rows: [{ path: "a", start: "x" }, { start: 1 }, 7] }, "lixo"]);
    expect(g).toEqual([{ issueKey: null, title: "", rows: [{ path: "a", start: 0, end: 0, added: 0, removed: 0, decidedBy: "", decidedAt: 0 }] }]);
  });
});

function fakes(groups: ChangeSetGroup[] = GROUPS, changed = ["src/a.rs", "src/b.rs"]) {
  const staged: string[] = [];
  const discarded: string[] = [];
  const toasts: string[] = [];
  const confirms: string[] = [];
  let message = "";
  let confirmAnswer = true;
  const git = {
    stash: async () => ({ stashes: [], output: "" }),
    worktree: async () => [],
    changes: async () => changed.map((path) => ({ path, status: "M" })),
    changeSets: async () => groups,
  } as unknown as GitExtrasPort;
  const ws = {
    root: () => "/p", project: () => "p", save: async () => undefined, changed: async () => undefined, branches: () => [], current: () => "main", cursor: () => null, open: () => undefined,
    commitMessage: () => message, setCommitMessage: (m: string) => { message = m; },
    stage: (p: string[]) => { staged.push(...p); }, discard: (p: string[]) => { discarded.push(...p); },
  } satisfies GitWorkspacePort;
  const x = makeGitExtras({
    git, ws,
    human: { confirm: (m) => { confirms.push(m); return confirmAnswer; }, text: async () => null, pick: async () => null, toast: (m) => toasts.push(m) },
    codev: { available: () => false, ask: () => undefined },
    tabs: { open: () => undefined, repaint: () => undefined },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { x, staged, discarded, toasts, confirms, msg: () => message, setMsg: (m: string) => { message = m; }, setConfirm: (v: boolean) => { confirmAnswer = v; } };
}

describe("aplicação", () => {
  it("o refreshSide traz os conjuntos; Stage prepara os ficheiros e sugere a mensagem com a chave", async () => {
    const f = fakes();
    await f.x.refreshSide();
    expect(f.x.state().changeSets.map((s) => s.issueKey)).toEqual(["DX-7", null]);
    f.x.stageSet("DX-7");
    expect(f.staged).toEqual(["src/a.rs", "src/b.rs"]);
    expect(f.msg()).toBe("Paginate the list (DX-7)");
    expect(f.toasts).toEqual(['csStaged {"n":2,"set":"DX-7"}']);
    // uma mensagem já escrita pelo humano não é tocada
    f.setMsg("my words");
    f.x.stageSet("");
    expect(f.msg()).toBe("my words");
    expect(f.staged.slice(2)).toEqual(["src/a.rs"]);
  });

  it("Discard pede confirmação com os ficheiros (e os partilhados); recusado, nada muda", async () => {
    const f = fakes();
    await f.x.refreshChangeSets();
    f.setConfirm(false);
    await f.x.discardSet("DX-7");
    expect(f.discarded).toEqual([]);
    expect(f.confirms[0]).toContain("src/a.rs (csShared)");
    expect(f.confirms[0]).toContain("src/b.rs");
    f.setConfirm(true);
    await f.x.discardSet("DX-7");
    expect(f.discarded).toEqual(["src/a.rs", "src/b.rs"]);
    await f.x.discardSet("NOPE-1"); // um conjunto que já não existe: nada
    expect(f.confirms).toHaveLength(2);
  });

  it("sem store do Project (erro do backend) a secção fica vazia, sem erro no pane", async () => {
    const f = fakes();
    await f.x.refreshChangeSets();
    const g = makeGitExtras({
      git: { changes: async () => [], changeSets: async () => { throw new Error("db"); } } as unknown as GitExtrasPort,
      ws: { root: () => "/p" } as unknown as GitWorkspacePort,
      human: { confirm: () => true, text: async () => null, pick: async () => null, toast: () => undefined },
      codev: { available: () => false, ask: () => undefined },
      tabs: { open: () => undefined, repaint: () => undefined },
      say: (k) => k,
    });
    await g.refreshChangeSets();
    expect(g.state().changeSets).toEqual([]);
    expect(g.state().sideError).toBe("");
  });
});

describe("o sinal do Co-Dev", () => {
  it("vários sinais seguidos são uma actualização", async () => {
    const seen = vi.fn();
    const off = changeSetsSignal.subscribe(seen);
    changeSetsSignal.notify();
    changeSetsSignal.notify();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    changeSetsSignal.notify();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("o Co-Dev avisa quando um bloco é aplicado e quando a validação do Auto acaba (não quando começa)", () => {
    const recorded = vi.fn();
    const r = makeHunkReview({
      review: async () => undefined, flush: async () => undefined, reloadFromDisk: async () => undefined,
      editor: { repaint: () => undefined, open: () => undefined, current: () => null, reveal: () => undefined, preview: () => undefined },
      every: () => () => undefined, pace: () => 40, notify: () => undefined, cancel: () => undefined,
      recorded,
    });
    r.sink.event("s", { kind: "validation", status: "running", checks: [], baseline: [] });
    expect(recorded).not.toHaveBeenCalled();
    r.sink.event("s", { kind: "hunk_applied", hunk: "c:1", provisional: false, fingerprint: "f" });
    r.sink.event("s", { kind: "validation", status: "passed", checks: [], baseline: [] });
    expect(recorded).toHaveBeenCalledTimes(2);
  });
});

describe("vista", () => {
  const t = (k: string) => k;
  it("um bloco por issue, com Stage/Discard e os ficheiros que abrem o diff; nada sem conjuntos", () => {
    expect(renderChangeSets(t as never, [], false)).toBe("");
    const host = document.createElement("div");
    host.innerHTML = renderChangeSets(t as never, changeSetsOfWorkingTree(GROUPS, ["src/a.rs", "src/b.rs"]), false);
    expect(host.querySelectorAll(".gx-cs-head")).toHaveLength(2);
    expect(host.querySelector('[data-action="gx-cs-stage"][data-on="DX-7"]')).not.toBeNull();
    expect(host.querySelector('[data-action="gx-cs-discard"][data-on=""]')).not.toBeNull();
    expect([...host.querySelectorAll('[data-action="gx-cs-open"]')].map((e) => (e as HTMLElement).dataset.on)).toEqual(["src/a.rs", "src/b.rs", "src/a.rs"]);
    expect(host.textContent).toContain("csNoIssue");
    expect(host.textContent).toContain("3–4, 10–13");
    expect(host.querySelectorAll('[title="csShared"]')).toHaveLength(2);
    host.innerHTML = renderChangeSets(t as never, changeSetsOfWorkingTree(GROUPS, ["src/a.rs"]), true);
    expect(host.querySelector('[data-action="gx-cs-stage"]')!.hasAttribute("disabled")).toBe(true);
  });
});

/* a cadeia real: o pane com a secção, o Stage e o diff pelo despachante */
let w: any;
let ipc: string[];
beforeEach(async () => {
  w = await bootApp();
  ipc = [];
  w.DXR = { root: "/proj", git: true, flush: () => undefined, idle: async () => undefined, reloadDisk: async () => undefined, syncGit: async () => undefined };
  w.REPO = true;
  w.ROOT = "/proj/";
  w.FS["/proj/src/a.rs"] = { content: "fn a() {}\n// paginate\n", orig: "fn a() {}\n" };
  const handlers: Record<string, () => unknown> = {
    git_stash: () => ({ stashes: [], output: "" }),
    git_worktree: () => [],
    git_changes: () => [{ path: "src/a.rs", status: "M" }],
    project_change_sets: () => [{ issueKey: "DX-7", title: "Paginate the list", rows: [row("src/a.rs", 2, 2)] }],
  };
  w.__TAURI__ = { core: { invoke: async (cmd: string) => { ipc.push(cmd); if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd); return handlers[cmd](); } } };
});
afterEach(() => { delete w.__TAURI__; delete w.DXR; delete w.REPO; delete w.FS["/proj/src/a.rs"]; w.STAGED.clear(); w.COMMIT_MSG = ""; });

describe("ligação", () => {
  it("o pane mostra o conjunto da DX-7; Stage prepara o ficheiro; o ficheiro abre o diff", async () => {
    if (!document.getElementById("pane-scm")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-scm"></div>');
    w.RP.scm();
    const pane = document.getElementById("pane-scm")!;
    await vi.waitFor(() => expect(pane.querySelector('[data-action="gx-cs-stage"][data-on="DX-7"]')).not.toBeNull());
    expect(pane.textContent).toContain("Co-Dev change sets");
    expect(pane.textContent).toContain("Paginate the list");
    expect(ipc).toContain("project_change_sets");
    (pane.querySelector('[data-action="gx-cs-stage"]') as HTMLElement).click();
    expect([...w.STAGED]).toEqual(["/proj/src/a.rs"]);
    expect(w.COMMIT_MSG).toBe("Paginate the list (DX-7)");
    // the repainted pane shows it in the message box (the message is set before staging repaints)
    expect((document.getElementById("scm-msg") as HTMLInputElement).value).toBe("Paginate the list (DX-7)");
    const opened: string[] = [];
    w.openDiff = (p: string) => opened.push(p);
    (document.querySelector('#pane-scm [data-action="gx-cs-open"]') as HTMLElement).click();
    expect(opened).toEqual(["/proj/src/a.rs"]);
  });

  it("um sinal do Co-Dev volta a pedir os change sets", async () => {
    if (!document.getElementById("pane-scm")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-scm"></div>');
    w.RP.scm();
    await vi.waitFor(() => expect(ipc).toContain("project_change_sets"));
    const before = ipc.filter((c) => c === "project_change_sets").length;
    // the app's own instance (bootApp loads the modules again for each test)
    const { changeSetsSignal: appSignal } = await import("../src/app/change-sets-signal");
    appSignal.notify();
    await vi.waitFor(() => expect(ipc.filter((c) => c === "project_change_sets").length).toBe(before + 1));
  });
});
