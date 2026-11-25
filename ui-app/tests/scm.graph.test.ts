import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { filesOfShow, refLabelsAt, remoteGroups, trackOf, type RefsSnapshot } from "../src/features/scm/domain/refs";
import { makeGraphScreen } from "../src/features/scm/application/graph-screen";

/* r23 F3 (UI-SCM-08): o Commit Graph como ecrã principal do Git — a barra lateral (ramos com upstream e
 * ahead/behind, remotos, tags, stashes, worktrees, contribuidores) lida do `git_refs`, as etiquetas nas linhas
 * do grafo, e os ficheiros de um commit lidos a pedido do `git show`. */

const REFS: RefsSnapshot = {
  head: "main", headSha: "a1b2c3d",
  branches: [
    { name: "main", sha: "a1b2c3d", upstream: "origin/main", ahead: 2, behind: 1, gone: false, current: true },
    { name: "feature/x", sha: "e4f5a6b7", upstream: "origin/feature/x", ahead: 0, behind: 0, gone: true, current: false },
    { name: "develop", sha: "a1b2c3d", upstream: null, ahead: 0, behind: 0, gone: false, current: false },
  ],
  remotes: ["origin", "up"],
  remoteBranches: [{ remote: "origin", name: "main", sha: "0000aaa" }, { remote: "up", name: "main", sha: "a1b2c3d9" }],
  tags: [{ name: "v1.0", sha: "a1b2c3d", annotated: true }],
  stashes: [{ index: 0, message: "On main: wip", time: 1 }],
  worktrees: [{ path: "/w/repo", branch: "main", head: "a1b2c3d", current: true }],
  contributors: [{ name: "Ana", email: "ana@x.ao", commits: 12 }],
};

describe("domínio", () => {
  it("as etiquetas de um commit: o ramo actual primeiro, os outros, os remotos e as tags (hash curto de qualquer tamanho)", () => {
    expect(refLabelsAt(REFS, "a1b2c3d")).toEqual([
      { kind: "head", name: "main" }, { kind: "branch", name: "develop" }, { kind: "remote", name: "up/main" }, { kind: "tag", name: "v1.0" },
    ]);
    expect(refLabelsAt(REFS, "e4f5a6b")).toEqual([{ kind: "branch", name: "feature/x" }]);
    expect(refLabelsAt(REFS, "fffffff")).toEqual([]);
  });

  it("os remotos agrupados, o ahead/behind e os ficheiros de um `git show`", () => {
    expect(remoteGroups(REFS).map((g) => `${g.remote}:${g.branches.length}`)).toEqual(["origin:1", "up:1"]);
    expect(trackOf(REFS.branches[0])).toEqual({ ahead: 2, behind: 1, gone: false });
    expect(trackOf(REFS.branches[1])).toEqual({ ahead: 0, behind: 0, gone: true });
    expect(trackOf(REFS.branches[2])).toBeNull();
    expect(filesOfShow("commit abc\n\n a.rs | 2 +-\ndiff --git a/src/a.rs b/src/a.rs\n--- a\ndiff --git a/old.txt b/new.txt\n")).toEqual(["src/a.rs", "new.txt"]);
  });
});

describe("o caso de uso", () => {
  it("um pedido de refs de cada vez (outro a meio volta a ler no fim); trocar de pasta esquece; sem pasta, nada", async () => {
    let root: string | null = "/w/repo";
    let resolve!: (r: RefsSnapshot) => void;
    const refs = vi.fn(() => new Promise<RefsSnapshot>((r) => { resolve = r; }));
    const s = makeGraphScreen({ git: { refs, show: async () => "", predict: async () => [] }, root: () => root });
    const p = s.load();
    void s.load();
    expect(refs).toHaveBeenCalledTimes(1);
    expect(s.state().loading).toBe(true);
    resolve(REFS);
    await vi.waitFor(() => expect(refs).toHaveBeenCalledTimes(2));
    resolve(REFS);
    await p;
    await vi.waitFor(() => expect(s.state().loading).toBe(false));
    expect(s.state().refs?.head).toBe("main");
    root = null;
    await s.load();
    expect(s.state().refs).toBeNull();
  });

  it("os ficheiros de um commit: lidos uma vez, a pedido; um erro do git dá lista vazia", async () => {
    const show = vi.fn(async (_r: string, h: string) => { if (h === "bad") throw new Error("x"); return "diff --git a/a.rs b/a.rs\n"; });
    const s = makeGraphScreen({ git: { refs: async () => REFS, show, predict: async () => [] }, root: () => "/w" });
    await s.filesOf("abc");
    await s.filesOf("abc");
    expect(show).toHaveBeenCalledTimes(1);
    expect(s.state().files.abc).toEqual(["a.rs"]);
    await s.filesOf("bad");
    expect(s.state().files.bad).toEqual([]);
  });

  it("um erro a ler as refs fica no estado", async () => {
    const s = makeGraphScreen({ git: { refs: async () => { throw new Error("not a git repository"); }, show: async () => "", predict: async () => [] }, root: () => "/w" });
    await s.load();
    expect(s.state().error).toBe("not a git repository");
  });
});

describe("na cadeia real (desktop com IPC falso)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let w: any, calls: Array<[string, Record<string, unknown>]>;
  const click = (el: Element | null) => { expect(el).not.toBeNull(); el!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
  beforeEach(async () => {
    w = await bootApp();
    calls = [];
    w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (cmd === "git_refs") return REFS;
      if (cmd === "git_show") return "diff --git a/src/lib.rs b/src/lib.rs\n";
      if (cmd === "git_predict_conflicts") return (args.branches as string[]).map((b) => ({ branch: b, clean: b !== "feature/x", files: b === "feature/x" ? ["src/lib.rs"] : [], error: null }));
      throw new Error("inesperado: " + cmd);
    } } };
    w.DXR = { root: "/w/repo", git: true };
    Object.assign(w.GIT, {
      c: { a1b2c3d: { h: "a1b2c3d", m: "feat: lib", p: ["0000aaa"], b: "main", a: "Ana", t: 1, files: [] }, "0000aaa": { h: "0000aaa", m: "init", p: [], b: "main", a: "Ana", t: 0, files: [] } },
      order: ["a1b2c3d", "0000aaa"], refs: { main: "a1b2c3d" }, tags: {},
    });
  });
  afterEach(() => { delete w.__TAURI__; delete w.DXR; Object.assign(w.GIT, { c: {}, order: [], refs: {}, tags: {} }); });

  it("o separador lê o git_refs, mostra a barra lateral e as etiquetas, e um commit mostra os seus ficheiros", async () => {
    const M = await import("../src/features/scm/graph-screen");
    const h = document.createElement("div");
    document.body.appendChild(h);
    w.VIEW.graph({ id: "graph", kind: "graph" }, h);
    await vi.waitFor(() => expect(h.querySelector(".gl-side .gl-sec")).not.toBeNull());
    expect(calls[0]).toEqual(["git_refs", { root: "/w/repo" }]);
    expect([...h.querySelectorAll(".gl-sec summary")].map((s) => s.textContent)).toEqual(["Branches3", "Remotes2", "Tags1", "Stashes1", "Worktrees1", "Contributors1"]);
    expect(h.querySelector(".gl-nm.cur")!.textContent).toBe("● main");
    // UI-SCM-13: the branches other than HEAD's are checked; feature/x would conflict
    expect(calls.find(([c]) => c === "git_predict_conflicts")).toEqual(["git_predict_conflicts", { root: "/w/repo", branches: ["feature/x", "develop"] }]);
    expect(h.querySelector('.gl-item[data-on="e4f5a6b7"] .gl-conf')!.getAttribute("title")).toContain("src/lib.rs");
    expect(h.querySelector(".gl-banner")!.textContent).toContain("1 branch(es) would conflict when merged into main: feature/x");
    expect(h.querySelector('.gl-item[data-on="a1b2c3d"] .gl-ab')!.textContent).toBe("↑2");
    expect([...h.querySelectorAll('.gl-row[data-on="a1b2c3d"] .gl-ref')].map((e) => e.textContent)).toEqual(["● main", "develop", "up/main", "v1.0"]);
    expect([...h.querySelectorAll('.gl-row[data-on="0000aaa"] .gl-ref')].map((e) => e.textContent)).toEqual(["origin/main"]);
    click(h.querySelector('.gl-item[data-action="graph:goto"][data-on="0000aaa"]'));
    await vi.waitFor(() => expect(M.graphScreen.state().files["0000aaa"]).toEqual(["src/lib.rs"]));
    expect(calls.some(([c, a]) => c === "git_show" && a.hash === "0000aaa")).toBe(true);
  });
});

import { isEmptyQuery, matches, parseQuery, tokenFor } from "../src/features/scm/domain/search";
import { conventionalOf } from "../src/features/scm/domain/conventional";

describe("a pesquisa do grafo", () => {
  const c = { m: "feat(api)!: paginate the list (DX-12)", a: "Ana Lima", files: ["src/api/list.rs", "README.md"], branches: ["main", "origin/main"] };
  it("o tipo convencional", () => {
    expect(conventionalOf(c.m)).toEqual({ type: "feat", scope: "api", breaking: true });
    expect(conventionalOf("Merge branch x")).toBeNull();
    expect(conventionalOf("wip: x")).toBeNull();
  });
  it("tokens, aspas, chaves diferentes AND e a mesma chave OR", () => {
    expect(parseQuery('author:"Ana Lima" type:feat type:fix list')).toEqual({ free: ["list"], keys: { author: ["Ana Lima"], type: ["feat", "fix"] } });
    expect(isEmptyQuery(parseQuery("  "))).toBe(true);
    expect(matches(parseQuery('author:"ana lima" type:fix type:feat'), c)).toBe(true);
    expect(matches(parseQuery("type:fix"), c)).toBe(false);
    expect(matches(parseQuery("file:api/ issue:dx-12 branch:origin message:paginate"), c)).toBe(true);
    expect(matches(parseQuery("file:Cargo.toml"), c)).toBe(false);
    expect(matches(parseQuery("paginate ana"), c)).toBe(true);
    expect(matches(parseQuery("unknown:x"), { ...c, m: "unknown:x" })).toBe(true); // an unknown key is free text
    expect(tokenFor("author", "Ana Lima")).toBe('author:"Ana Lima"');
  });
});

describe("a pesquisa na cadeia real", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let w: any;
  beforeEach(async () => {
    w = await bootApp();
    Object.assign(w.GIT, {
      c: {
        c3: { h: "c3", m: "fix: off by one (DX-2)", p: ["c2"], b: "main", a: "Rui", t: 3, files: ["src/a.rs"] },
        c2: { h: "c2", m: "docs: readme", p: ["c1"], b: "main", a: "Ana", t: 2, files: ["README.md"] },
        c1: { h: "c1", m: "feat: start", p: [], b: "main", a: "Ana", t: 1, files: ["src/a.rs"] },
      },
      order: ["c3", "c2", "c1"], refs: { main: "c3" }, tags: {},
    });
  });
  afterEach(() => { Object.assign(w.GIT, { c: {}, order: [], refs: {}, tags: {} }); });

  it("realçar esbate, filtrar esconde; as etiquetas de tipo e de issue juntam um token", async () => {
    const M = await import("../src/features/scm/graph-screen");
    M.graphScreen.setQuery(""); M.graphScreen.setMode("highlight");
    const h = document.createElement("div");
    document.body.appendChild(h);
    w.VIEW.graph({ id: "graph", kind: "graph" }, h);
    expect([...h.querySelectorAll(".gl-row .gl-chip")].map((e) => e.textContent)).toEqual(["fix", "DX-2", "docs", "feat"]);
    h.querySelector<HTMLElement>('.gl-chip[data-on="type:docs"]')!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(M.graphScreen.state().query).toBe("type:docs");
    expect([...h.querySelectorAll(".gl-row")].map((r) => `${(r as HTMLElement).dataset.on}${r.classList.contains("dim") ? "-" : "+"}`)).toEqual(["c3-", "c2+", "c1-"]);
    M.graphScreen.setQuery("file:src/a.rs");
    M.graphScreen.setMode("filter");
    expect([...h.querySelectorAll(".gl-row")].map((r) => (r as HTMLElement).dataset.on)).toEqual(["c3", "c1"]);
    expect(h.querySelector(".gl-bar")!.textContent).toContain("2 of 3");
    expect(h.querySelectorAll(".gl-svg path")).toHaveLength(0); // c1 is not c3's parent: no line between them
    M.graphScreen.setQuery(""); M.graphScreen.setMode("highlight");
  });
});

import { activityBuckets } from "../src/features/scm/domain/activity";

describe("o minimapa e a linha WIP", () => {
  it("commits por intervalo, os que batem e o mais recente de cada um", () => {
    const b = activityBuckets([{ h: "a", t: 0, match: true }, { h: "b", t: 10, match: false }, { h: "c", t: 100, match: true }, { h: "d", t: 95, match: false }], 2);
    expect(b.map((x) => [x.count, x.matched, x.newest])).toEqual([[2, 1, "b"], [2, 1, "c"]]);
    expect(activityBuckets([])).toEqual([]);
    expect(activityBuckets([{ h: "a", t: 5, match: false }])).toHaveLength(1);
  });

  it("no desktop com alterações por commitar: a linha WIP leva ao Source Control; as barras levam ao commit", async () => {
    const w = (await bootApp()) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.DXR = { root: "/w/repo", git: true };
    w.__TAURI__ = { core: { invoke: async () => { throw new Error("offline"); } } };
    Object.assign(w.GIT, {
      c: { b2: { h: "b2", m: "feat: two", p: ["b1"], b: "main", a: "Ana", t: 2_000_000_000, files: [] }, b1: { h: "b1", m: "feat: one", p: [], b: "main", a: "Ana", t: 1_000_000_000, files: [] } },
      order: ["b2", "b1"], refs: { main: "b2" }, tags: {},
    });
    const key = w.ROOT + "wip.txt";
    w.FS[key] = { content: "new", orig: "old" };
    const panes: string[] = [];
    w.goPane = (p: string) => panes.push(p);
    try {
      const h = document.createElement("div");
      document.body.appendChild(h);
      w.VIEW.graph({ id: "graph", kind: "graph" }, h);
      const wip = h.querySelector(".gl-wip")!;
      expect(wip.textContent).toMatch(/Uncommitted changes \(\d+ files\)/);
      wip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(panes).toEqual(["scm"]);
      const bars = h.querySelectorAll(".gl-mbar");
      expect(bars).toHaveLength(2);
      bars[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      const M = await import("../src/features/scm");
      expect(M.graphSel()).toBe("b1");
    } finally {
      delete w.FS[key]; delete w.DXR; delete w.__TAURI__; delete w.goPane;
      Object.assign(w.GIT, { c: {}, order: [], refs: {}, tags: {} });
    }
  });
});

import { makeHunks } from "../src/features/scm/application/hunks";
import { renderHunks } from "../src/features/scm/ui/hunks-view";
import type { FileHunksData } from "../src/features/scm/application/extras-ports";

describe("staging por hunk (UI-SCM-10)", () => {
  const H = (id: string, add = 1): FileHunksData["hunks"][number] => ({ id, header: `@@ -1,3 +1,3 @@ fn ${id}`, oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" a", "-b", "+B"], added: add, removed: 1 });
  function fake() {
    const side: Record<string, FileHunksData["hunks"]> = { un: [H("h1"), H("h2")], st: [] };
    const calls: string[] = [];
    let changed = 0;
    const h = makeHunks({
      git: {
        hunks: async (_r, path, staged) => ({ path, staged, binary: false, hunks: [...side[staged ? "st" : "un"]] }),
        stageHunks: async (_r, path, ids, unstage) => {
          calls.push(`${unstage ? "unstage" : "stage"}:${path}:${ids.join()}`);
          const [from, to] = unstage ? ["st", "un"] : ["un", "st"];
          side[to].push(...side[from].filter((x) => ids.includes(x.id))); side[from] = side[from].filter((x) => !ids.includes(x.id));
          return { path, staged: unstage, binary: false, hunks: side[from] };
        },
      },
      root: () => "/w", changed: async () => { changed++; },
    });
    return { h, calls, changed: () => changed };
  }

  it("abrir lê os dois lados; marcar faz stage só desse hunk e tira-o de volta; o pane é avisado", async () => {
    const f = fake();
    await f.h.toggle("src/a.rs");
    expect(f.h.entry("src/a.rs")!.unstaged!.hunks.map((x) => x.id)).toEqual(["h1", "h2"]);
    await f.h.stage("src/a.rs", "h2");
    expect(f.calls).toEqual(["stage:src/a.rs:h2"]);
    expect(f.h.entry("src/a.rs")!.staged!.hunks.map((x) => x.id)).toEqual(["h2"]);
    expect(f.h.partly("src/a.rs")).toBe(true);
    await f.h.unstage("src/a.rs", "h2");
    expect(f.h.entry("src/a.rs")!.staged!.hunks).toEqual([]);
    expect(f.changed()).toBe(2);
    await f.h.toggle("src/a.rs");
    expect(f.h.entry("src/a.rs")).toBeUndefined();
  });

  it("a vista: por marcar os de fora, marcados os do índice, a pré-visualização e os erros", () => {
    const t = (k: string) => k;
    const d = document.createElement("div");
    d.innerHTML = renderHunks(t as never, "src/a.rs", { unstaged: { path: "src/a.rs", staged: false, binary: false, hunks: [H("h1")] }, staged: { path: "src/a.rs", staged: true, binary: false, hunks: [H("h2", 3)] }, busy: false, error: null });
    const boxes = [...d.querySelectorAll<HTMLInputElement>('[data-action="scm-hunk"]')];
    expect(boxes.map((b) => [b.dataset.on, b.checked])).toEqual([["src/a.rs|h1|stage", false], ["src/a.rs|h2|unstage", true]]);
    expect(d.querySelector(".hk-h code")!.textContent).toBe("@@ -1,3 +1,3 @@");
    expect(d.querySelector(".hk-l.add")!.textContent).toBe("+B");
    d.innerHTML = renderHunks(t as never, "x", { unstaged: null, staged: null, busy: false, error: "the file changed" });
    expect(d.textContent).toBe("the file changed");
    d.innerHTML = renderHunks(t as never, "x", { unstaged: { path: "x", staged: false, binary: true, hunks: [] }, staged: { path: "x", staged: true, binary: false, hunks: [] }, busy: false, error: null });
    expect(d.textContent).toBe("binary");
  });

  it("no pane real: só no desktop com repositório aparece o botão; abrir mostra os hunks e marcar chama o git_stage_hunks", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (await bootApp()) as unknown as Record<string, any>;
    const key = w.ROOT + "src/x.rs";
    w.FS[key] = { content: "new", orig: "old" };
    try {
      w.RP.scm();
      expect(document.querySelector('[data-action="scm-hunks"]')).toBeNull(); // the browser (and the goldens): nothing
      const calls: string[] = [];
      w.DXR = { root: "/w/repo", git: true };
      w.__TAURI__ = { core: { invoke: async (cmd: string, a: Record<string, unknown>) => {
        calls.push(`${cmd}:${a.path}:${a.staged ?? a.unstage ?? ""}`);
        if (cmd === "git_hunks") return { path: a.path, staged: a.staged, binary: false, hunks: a.staged ? [] : [H("h1")] };
        if (cmd === "git_stage_hunks") return { path: a.path, staged: false, binary: false, hunks: [] };
        throw new Error(cmd);
      } } };
      w.RP.scm();
      const btn = document.querySelector<HTMLElement>('[data-action="scm-hunks"][data-on="src/x.rs"]');
      expect(btn).not.toBeNull();
      btn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await vi.waitFor(() => expect(document.querySelector('#pane-scm [data-action="scm-hunk"]')).not.toBeNull());
      const box = document.querySelector<HTMLInputElement>('#pane-scm [data-action="scm-hunk"]')!;
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(calls).toContain("git_stage_hunks:src/x.rs:false"));
    } finally { delete w.FS[key]; delete w.DXR; delete w.__TAURI__; }
  });
});

import { makeUndo } from "../src/features/scm/application/undo";
import type { UndoEntryData } from "../src/features/scm/application/extras-ports";

describe("o undo do git (UI-SCM-12)", () => {
  const E = (id: number, label: string): UndoEntryData => ({ id, label, at: 1_000 * id, head: "main", headSha: "abc1234", refs: [], index: "t", worktree: null });
  function fake(o: { approve?: boolean; auditFails?: boolean; restoreFails?: boolean } = {}) {
    const list: UndoEntryData[] = [E(1, "commit: one")], asked: Array<{ title: string; command: string; destructive?: boolean }> = [], toasts: string[] = [], audited: Array<{ outcome?: string; approved: boolean }> = [];
    let restored = 0, changed = 0;
    const u = makeUndo({
      git: {
        snapshot: async (_r, label) => { const e = E(list.length + 1, label); list.unshift(e); return e; },
        list: async () => [...list],
        plan: async (_r, id) => ({ entry: list.find((e) => e.id === id)!, commands: [["symbolic-ref", "HEAD", "refs/heads/main"]], display: "git symbolic-ref HEAD refs/heads/main" }),
        restore: async () => { if (o.restoreFails) throw new Error("index.lock exists"); restored++; return E(99, "before undo"); },
      },
      root: () => "/w", changed: async () => { changed++; },
      human: { approve: async (r) => { asked.push(r); return { approved: o.approve ?? true, reason: "", decidedAt: 5 }; }, toast: (m) => toasts.push(m) },
      audit: { record: async (_r, e) => { if (o.auditFails) throw new Error("db"); audited.push(e); } },
      say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    return { u, asked, toasts, audited, restored: () => restored, changed: () => changed };
  }

  it("a fotografia entra na lista; desfazer mostra os comandos exactos, audita antes e depois, e repõe", async () => {
    const f = fake();
    await f.u.snapshot("checkout develop");
    await vi.waitFor(() => expect(f.u.entries().map((e) => e.label)).toEqual(["checkout develop", "commit: one"]));
    expect(await f.u.undo(2)).toBe(true);
    expect(f.asked[0]).toMatchObject({ title: 'undoTitle {"label":"checkout develop"}', command: "git symbolic-ref HEAD refs/heads/main", destructive: true });
    expect(f.audited.map((a) => a.outcome)).toEqual(["sent", "ok"]);
    expect([f.restored(), f.changed()]).toEqual([1, 1]);
  });

  it("recusado: auditado e nada reposto; sem auditoria não corre; uma falha do git fica auditada", async () => {
    const no = fake({ approve: false });
    expect(await no.u.undo(1)).toBe(false);
    await vi.waitFor(() => expect(no.audited).toEqual([expect.objectContaining({ approved: false })]));
    expect(no.restored()).toBe(0);
    const blind = fake({ auditFails: true });
    expect(await blind.u.undo(1)).toBe(false);
    expect(blind.restored()).toBe(0);
    expect(blind.toasts.at(-1)).toContain("notAudited");
    const broken = fake({ restoreFails: true });
    expect(await broken.u.undo(1)).toBe(false);
    await vi.waitFor(() => expect(broken.audited.map((a) => a.outcome)).toEqual(["sent", "failed"]));
    expect(broken.toasts.at(-1)).toContain("index.lock");
  });

  it("uma resposta que não é lista (backend antigo/guionado) dá lista vazia, sem rebentar o pane", async () => {
    const u = makeUndo({ git: { snapshot: async () => E(1, "x"), list: async () => null as unknown as UndoEntryData[], plan: async () => { throw new Error(); }, restore: async () => E(1, "x") }, root: () => "/w", changed: async () => {}, human: { approve: async () => ({ approved: false, reason: "", decidedAt: 1 }), toast: () => {} }, audit: { record: async () => {} }, say: (k) => k });
    await u.refresh();
    expect(u.entries()).toEqual([]);
  });

  it("«Undo last» usa a mais recente; sem nenhuma, di-lo", async () => {
    const f = fake();
    await f.u.undoLast();
    expect(f.asked[0].title).toContain("commit: one");
    const empty = makeUndo({ git: { snapshot: async () => E(1, "x"), list: async () => [], plan: async () => { throw new Error(); }, restore: async () => E(1, "x") }, root: () => "/w", changed: async () => {}, human: { approve: async () => ({ approved: true, reason: "", decidedAt: 1 }), toast: (m) => f.toasts.push(m) }, audit: { record: async () => {} }, say: (k) => k });
    expect(await empty.undoLast()).toBe(false);
    expect(f.toasts.at(-1)).toBe("undoNone");
  });
});

import { blockCount, hasMarkers, takeSide } from "../src/features/scm/domain/conflicts";
import { makeMerge3, type CheckResult } from "../src/features/scm/application/merge3";
import type { MergeStateData } from "../src/features/scm/application/extras-ports";
import { renderMerge3 } from "../src/features/scm/ui/merge3-view";

describe("o merge a três (UI-SCM-13)", () => {
  const W = "a\n<<<<<<< HEAD\nours 1\n||||||| base\nbase\n=======\ntheirs 1\n>>>>>>> feature/x\nb\n<<<<<<< HEAD\nours 2\n=======\ntheirs 2\n>>>>>>> feature/x\nc";
  it("os marcadores: contar, ficar com um lado ou com os dois", () => {
    expect([hasMarkers(W), blockCount(W)]).toEqual([true, 2]);
    expect(takeSide(W, "ours")).toBe("a\nours 1\nb\nours 2\nc");
    expect(takeSide(W, "theirs")).toBe("a\ntheirs 1\nb\ntheirs 2\nc");
    expect(takeSide(W, "both")).toBe("a\nours 1\ntheirs 1\nb\nours 2\ntheirs 2\nc");
    expect(hasMarkers("a\n=======\nb")).toBe(false);
  });

  function fake(o: { check?: CheckResult; approve?: boolean } = {}) {
    let state: MergeStateData = { merging: true, message: "Merge feature/x into main", conflicts: ["f.txt", "g.txt"], output: "" };
    const ops: string[] = [], audited: Array<{ action: string; outcome?: string; approved: boolean }> = [], toasts: string[] = [], asked: unknown[] = [];
    let opened = 0, changed = 0;
    const m = makeMerge3({
      git: {
        merge: async (_r, op) => {
          ops.push(op.op === "resolve" ? `resolve:${op.path}:${op.content}` : op.op);
          if (op.op === "resolve") state = { ...state, conflicts: state.conflicts.filter((f) => f !== op.path) };
          if (op.op === "commit" || op.op === "abort") state = { merging: false, message: "", conflicts: [], output: "" };
          return state;
        },
        stages: async (_r, path) => ({ path, base: "base", ours: "ours", theirs: "theirs", working: W }),
      },
      root: () => "/w", changed: async () => { changed++; }, openTab: () => { opened++; },
      check: async () => o.check ?? { cmd: "cargo check", ok: true, summary: "✓ exit 0" },
      human: { approve: async () => ({ approved: o.approve ?? true, reason: "", decidedAt: 1 }), toast: (t) => toasts.push(t) },
      audit: { record: async (_r, e) => { audited.push(e); } },
      codev: { available: () => true, ask: (r) => asked.push(r) },
      say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    return { m, ops, audited, toasts, asked, opened: () => opened, changed: () => changed };
  }

  it("abre no primeiro ficheiro; com marcadores não marca como resolvido; ficar com um lado e resolver passa ao seguinte", async () => {
    const f = fake();
    await f.m.open();
    expect(f.opened()).toBe(1);
    expect(f.m.state().selected).toBe("f.txt");
    expect(f.m.blocks("f.txt")).toBe(2);
    await f.m.resolve("f.txt");
    expect(f.toasts.at(-1)).toContain("mergeMarkersLeft");
    f.m.take("f.txt", "theirs");
    await f.m.resolve("f.txt");
    expect(f.ops).toContain("resolve:f.txt:a\ntheirs 1\nb\ntheirs 2\nc");
    expect(f.m.state().selected).toBe("g.txt");
    f.m.askCodev("g.txt");
    expect(f.asked[0]).toMatchObject({ intent: "change", send: false });
  });

  it("concluir: com conflitos recusa; a verificação falhada não deixa commitar; passada, aprova, audita e commita", async () => {
    const bad = fake({ check: { cmd: "cargo check", ok: false, summary: "✖ exit 101" } });
    await bad.m.open();
    expect(await bad.m.complete()).toBe(false);
    expect(bad.toasts.at(-1)).toContain("mergeStillUnmerged");
    for (const p of ["f.txt", "g.txt"]) { await bad.m.select(p); bad.m.take(p, "ours"); await bad.m.resolve(p); }
    expect(await bad.m.complete()).toBe(false);
    expect(bad.toasts.at(-1)).toContain("mergeCheckFailed");
    expect(bad.ops).not.toContain("commit");
    const good = fake();
    await good.m.open();
    for (const p of ["f.txt", "g.txt"]) { await good.m.select(p); good.m.take(p, "both"); await good.m.resolve(p); }
    expect(await good.m.complete()).toBe(true);
    expect(good.ops.at(-2)).toBe("commit");
    expect(good.audited.map((a) => `${a.action}:${a.outcome}`)).toEqual(["git.merge.commit:sent", "git.merge.commit:ok"]);
  });

  it("abortar é aprovado e auditado; recusado, nada", async () => {
    const no = fake({ approve: false });
    await no.m.open();
    await no.m.abort();
    expect(no.ops).not.toContain("abort");
    const yes = fake();
    await yes.m.open();
    await yes.m.abort();
    expect(yes.ops).toContain("abort");
    expect(yes.audited.map((a) => `${a.action}:${a.outcome}`)).toEqual(["git.merge.abort:sent", "git.merge.abort:ok"]);
  });

  it("a vista: os ficheiros, as três versões e o resultado", async () => {
    const f = fake();
    await f.m.open();
    const d = document.createElement("div");
    d.innerHTML = renderMerge3(((k: string) => k) as never, f.m.state(), true, (p) => f.m.blocks(p));
    expect([...d.querySelectorAll(".gm-file")].map((e) => e.textContent)).toEqual(["⚠f.txt", "⚠g.txt"]);
    expect([...d.querySelectorAll(".gm-pre")].map((e) => e.textContent)).toEqual(["base", "ours", "theirs"]);
    expect((d.querySelector(".gm-result") as HTMLTextAreaElement).value).toBe(W);
    expect(d.querySelector('[data-action="gx-merge-complete"]')!.hasAttribute("disabled")).toBe(true);
  });
});

import { makeSync } from "../src/features/scm/application/sync";
import type { SyncPlanData } from "../src/features/scm/application/extras-ports";

describe("o sync (fetch, pull, push)", () => {
  const P = (op: "fetch" | "pull" | "push", display: string, up: string | null = "origin/main"): SyncPlanData => ({ op, branch: "main", upstream: up, remote: "origin", ahead: 2, behind: 1, setsUpstream: !up, argv: [], display });
  function fake(o: { approve?: boolean; fail?: boolean } = {}) {
    const ran: string[] = [], snaps: string[] = [], audited: Array<{ action: string; outcome?: string; approved: boolean }> = [], asked: Array<{ title: string; command: string; scope?: string }> = [], toasts: string[] = [];
    const s = makeSync({
      git: { plan: async (_r, op) => P(op, op === "push" ? "git push origin main:main" : op === "pull" ? "git pull --rebase --autostash" : "git fetch --all --prune"), run: async (_r, op, exp) => { if (o.fail) throw new Error("rejected (non-fast-forward)"); ran.push(`${op}:${exp}`); return "done"; } },
      root: () => "/w", changed: async () => {}, snapshot: async (l) => { snaps.push(l); },
      human: { approve: async (r) => { asked.push(r); return { approved: o.approve ?? true, reason: "", decidedAt: 1 }; }, toast: (m) => toasts.push(m) },
      audit: { record: async (_r, e) => { audited.push(e); } },
      say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    return { s, ran, snaps, audited, asked, toasts };
  }
  it("o diálogo mostra o comando do backend e o upstream; aprovado, corre exactamente esse e audita; o pull tira a fotografia", async () => {
    const f = fake();
    expect(await f.s.run("push")).toBe(true);
    expect(f.asked[0]).toMatchObject({ title: "sync-push", command: "git push origin main:main", scope: 'syncScope {"b":"main","u":"origin/main","a":2,"n":1}' });
    expect(f.ran).toEqual(["push:git push origin main:main"]);
    expect(f.audited.map((a) => `${a.action}:${a.outcome}`)).toEqual(["git.push:sent", "git.push:ok"]);
    await f.s.run("pull");
    expect(f.snaps).toEqual(["pull origin/main"]);
  });
  it("recusado: nada corre, fica auditado; uma falha fica auditada como failed", async () => {
    const no = fake({ approve: false });
    expect(await no.s.run("push")).toBe(false);
    expect(no.ran).toEqual([]);
    const bad = fake({ fail: true });
    expect(await bad.s.run("push")).toBe(false);
    expect(bad.audited.map((a) => a.outcome)).toEqual(["sent", "failed"]);
    expect(bad.toasts.at(-1)).toContain("non-fast-forward");
  });
});

import { prIssue, prSeverity, prWorktreeCommands, sortPrs, type Pr } from "../src/features/scm/domain/launchpad";
import { makeLaunchpad } from "../src/features/scm/application/launchpad";
import { renderLaunchpad } from "../src/features/scm/ui/launchpad-view";

describe("o Launchpad (UI-SCM-14)", () => {
  const pr = (n: number, o: Partial<Pr> = {}): Pr => ({ number: n, title: `feat: thing ${n}`, author: "ana", head: `feature/dx-${n}-x`, base: "develop", url: `https://github.com/o/r/pull/${n}`, draft: false, state: "OPEN", review: "", checks: { passed: 1, failed: 0, pending: 0 }, updatedAt: `2026-11-2${n}T00:00:00Z`, ...o });
  it("gravidade, ordem, a issue ligada e os comandos da worktree", () => {
    expect(prSeverity(pr(1, { checks: { passed: 0, failed: 1, pending: 0 } }))).toBe("high");
    expect(prSeverity(pr(2, { review: "REVIEW_REQUIRED" }))).toBe("medium");
    expect(prSeverity(pr(3))).toBe("low");
    expect(sortPrs([pr(3), pr(2, { review: "REVIEW_REQUIRED" }), pr(1, { review: "CHANGES_REQUESTED" })]).map((p) => p.number)).toEqual([1, 2, 3]);
    expect(prIssue(pr(4, { title: "fix: x (PRJ-9)" }))).toBe("PRJ-9");
    expect(prIssue(pr(5))).toBe("DX-5");
    expect(prWorktreeCommands(7, "../r-pr-7", "origin")).toBe("git fetch origin pull/7/head:pr/7\ngit worktree add ../r-pr-7 pr/7");
  });

  function fake(o: { installed?: boolean; signedIn?: boolean; approve?: boolean } = {}) {
    const wt: unknown[] = [], audited: Array<{ action: string; outcome?: string }> = [], asked: Array<{ command: string }> = [];
    const lp = makeLaunchpad({
      gh: { status: async () => ({ installed: o.installed ?? true, version: "gh 2.105.0", signedIn: o.signedIn ?? true, notes: o.installed === false ? "Install the GitHub CLI" : "" }), prs: async (_r, f) => (f === "review" ? [pr(3), pr(1, { checks: { passed: 0, failed: 2, pending: 0 } })] : [pr(2)]), runsFor: async () => [], prsFor: async () => [] },
      git: { worktree: async (_r, op) => { wt.push(op); return []; } }, root: () => "/w", project: () => "repo", remote: () => "origin",
      human: { approve: async (r) => { asked.push(r); return { approved: o.approve ?? true, reason: "", decidedAt: 1 }; }, text: async (_p, _v, init) => init ?? null, toast: () => {} },
      audit: { record: async (_r, e) => { audited.push(e); } }, changed: async () => {}, openTab: () => {}, say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    return { lp, wt, audited, asked };
  }

  it("lê os PRs por gravidade; a worktree do PR é aprovada com os dois comandos e auditada", async () => {
    const f = fake();
    await f.lp.open();
    expect(f.lp.state().review!.map((p) => p.number)).toEqual([1, 3]);
    expect(await f.lp.checkoutWorktree(1)).toBe(true);
    expect(f.asked[0].command).toBe("git fetch origin pull/1/head:pr/1\ngit worktree add ../repo-pr-1 pr/1");
    expect(f.wt).toEqual([{ op: "add_pr", number: 1, path: "../repo-pr-1", remote: "origin" }]);
    expect(f.audited.map((a) => `${a.action}:${a.outcome}`)).toEqual(["git.worktree.pr:sent", "git.worktree.pr:ok"]);
    const d = document.createElement("div");
    d.innerHTML = renderLaunchpad(((k: string) => k) as never, f.lp.state());
    expect(d.querySelectorAll(".lp-row.sev-high")).toHaveLength(1);
    expect(d.querySelector('[data-action="gx-lp-open"]')!.getAttribute("data-on")).toBe("https://github.com/o/r/pull/1");
  });

  it("sem gh, ou sem sessão, diz-o e não lista nada (nada inventado)", async () => {
    const none = fake({ installed: false });
    await none.lp.load();
    expect(none.lp.state().review).toBeNull();
    const d = document.createElement("div");
    d.innerHTML = renderLaunchpad(((k: string) => k) as never, none.lp.state());
    expect(d.textContent).toContain("lpNotInstalled");
    const out = fake({ signedIn: false });
    await out.lp.load();
    d.innerHTML = renderLaunchpad(((k: string) => k) as never, out.lp.state());
    expect(d.textContent).toContain("lpSignedOut");
  });
});
