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
    const s = makeGraphScreen({ git: { refs, show: async () => "" }, root: () => root });
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
    const s = makeGraphScreen({ git: { refs: async () => REFS, show }, root: () => "/w" });
    await s.filesOf("abc");
    await s.filesOf("abc");
    expect(show).toHaveBeenCalledTimes(1);
    expect(s.state().files.abc).toEqual(["a.rs"]);
    await s.filesOf("bad");
    expect(s.state().files.bad).toEqual([]);
  });

  it("um erro a ler as refs fica no estado", async () => {
    const s = makeGraphScreen({ git: { refs: async () => { throw new Error("not a git repository"); }, show: async () => "" }, root: () => "/w" });
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
