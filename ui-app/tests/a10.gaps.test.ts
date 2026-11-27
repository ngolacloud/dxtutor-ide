import { describe, expect, it, vi } from "vitest";
import { isVuln, mapText, sortVulns, upgradeLatest, updateCompatible } from "../src/features/codebase/domain/rules";
import { makeCodebase } from "../src/features/codebase/application/codebase-service";
import { renderDeps, renderMap } from "../src/features/codebase/ui/codebase-view";
import { diffStat, groupFiles, groupOf } from "../src/features/scm/domain/review";
import { makeGitExtras } from "../src/features/scm/application/git-extras";
import type { GitExtrasPort } from "../src/features/scm/application/extras-ports";
import { makeDebugEngine } from "../src/features/debug/application/debug-engine";
import type { DebugPort } from "../src/features/debug/application/ports";
import type { Session } from "../src/features/debug/domain/session";
import type { DepsReport, OnboardMap } from "../src/features/codebase/domain/types";

/* A10 (docs/v2/UI-AUDIT.md §3), as lacunas aprovadas: dependências (atrasadas e vulneráveis, actualizar por
 * comando aprovado), o mapa de onboarding, a revisão de uma alteração grande agrupada por tema, e o attach
 * do depurador a um processo (local, num contentor ou num pod). */

const REPORT: DepsReport = {
  online: false,
  ecosystems: [{
    kind: "cargo", dir: ".", commands: ["cargo update --dry-run --verbose --offline", "cargo audit --json --no-fetch"], notes: [],
    outdated: [
      { name: "hyper", current: "1.12.0", compatible: "1.13.0", latest: null, direct: true, jump: "minor" },
      { name: "ratatui", current: "0.29.0", compatible: null, latest: "0.30.2", direct: true, jump: "major" },
      { name: "base64", current: "0.22.1", compatible: null, latest: "0.23.1", direct: false, jump: "major" },
    ],
    vulns: [
      { id: "RUSTSEC-2024-1", package: "x", version: "0.1.0", severity: "unmaintained", title: "x is unmaintained", url: "", fixed: [] },
      { id: "RUSTSEC-2026-0367", package: "zip", version: "2.1.0", severity: "critical", title: "Insecure SUID", url: "https://rustsec.org/advisories/RUSTSEC-2026-0367", fixed: [">=2.4.2"] },
    ],
  }, { kind: "npm", dir: "ui-app", commands: [], notes: ["npm asks the registry: check online to see what is outdated and vulnerable."], outdated: [], vulns: [] }],
};
const MAP: OnboardMap = {
  languages: [{ name: "Rust", files: 120, lines: 40000 }, { name: "TypeScript", files: 300, lines: 60000 }], totalFiles: 900,
  entries: [{ kind: "cargo-bin", name: "dxtutor-ide", file: "src-tauri/Cargo.toml", run: "cargo run -p dxtutor-ide" }, { kind: "npm-script", name: "dev", file: "package.json", run: "npm run dev" }],
  docs: ["README.md", "docs/architecture/ADR-0002.md"], hot: [{ file: "ui-app/src/features/scm.ts", changes: 14 }], people: [{ name: "Ana", commits: 80 }],
  modules: [{ file: "src-tauri/src/lib.rs", symbols: 140 }], tests: 210, git: true, notes: [],
};

describe("dependências", () => {
  it("o comando exacto de cada actualização e a gravidade", () => {
    const e = { kind: "cargo" as const, dir: "." };
    expect(updateCompatible(e, REPORT.ecosystems[0].outdated[0])).toBe("cargo update -p hyper");
    expect(upgradeLatest(e, REPORT.ecosystems[0].outdated[1])).toBe("cargo add ratatui@0.30.2");
    expect(upgradeLatest(e, REPORT.ecosystems[0].outdated[2])).toBeNull(); // transitive: not ours to bump
    expect(upgradeLatest({ kind: "npm", dir: "ui-app" }, { name: "react", current: "18.2.0", compatible: null, latest: "19.1.0", direct: true, jump: "major" })).toBe("cd ui-app && npm install react@19.1.0");
    expect(upgradeLatest({ kind: "go", dir: "." }, { name: "golang.org/x/net", current: "0.20.0", compatible: null, latest: "0.31.0", direct: true, jump: "major" })).toBe("go get golang.org/x/net@v0.31.0");
    expect(sortVulns(REPORT.ecosystems[0].vulns).map((v) => v.severity)).toEqual(["critical", "unmaintained"]);
    expect(REPORT.ecosystems[0].vulns.map(isVuln)).toEqual([false, true]);
  });

  it("actualizar pede aprovação com o comando; planear e explicar vão ao Co-Dev; a vista mostra tudo", async () => {
    const ran: string[] = [], confirms: string[] = [], asked: Array<{ intent: string; text: string; send?: boolean }> = [];
    let yes = true;
    const cb = makeCodebase({
      port: { deps: async () => REPORT, map: async () => MAP },
      world: { root: () => "/p", runInTerminal: (c) => ran.push(c), open: vi.fn(), showTests: vi.fn() },
      human: { confirm: (m) => { confirms.push(m); return yes; }, toast: vi.fn() },
      codev: { available: () => true, ask: (r) => asked.push(r) },
      say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    await cb.loadDeps(false);
    yes = false;
    cb.update(0, "ratatui", true);
    expect(ran).toEqual([]);
    expect(confirms[0]).toContain("cargo add ratatui@0.30.2");
    yes = true;
    cb.update(0, "hyper", false);
    expect(ran).toEqual(["cargo update -p hyper"]);
    cb.planUpgrade(0, "ratatui");
    expect(asked[0]).toMatchObject({ intent: "change", send: false });
    cb.explainVuln(0, "RUSTSEC-2026-0367");
    expect(asked[1].intent).toBe("explain");
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const host = document.createElement("div");
    host.innerHTML = renderDeps(t as never, cb.state(), true, true);
    expect(host.querySelector(".cb-row.bad .cb-sev")?.textContent).toBe("critical");
    expect(host.querySelector('[data-action="cb-update"][data-on="0|hyper"]')).not.toBeNull();
    expect(host.querySelector('[data-action="cb-upgrade"][data-on="0|base64"]')).toBeNull();
    expect(host.textContent).toContain("check online");
    expect(renderDeps(t as never, cb.state(), true, false)).toContain("needDesktop");
  });
});

describe("onboarding", () => {
  it("o mapa em texto para o Co-Dev, a visita e correr um ponto de entrada com aprovação", async () => {
    expect(mapText(MAP)).toContain("cargo-bin dxtutor-ide — src-tauri/Cargo.toml — cargo run -p dxtutor-ide");
    const ran: string[] = [], asked: Array<{ text: string; context: Array<{ text: string }> }> = [];
    const cb = makeCodebase({
      port: { deps: async () => REPORT, map: async () => MAP },
      world: { root: () => "/p", runInTerminal: (c) => ran.push(c), open: vi.fn(), showTests: vi.fn() },
      human: { confirm: () => true, toast: vi.fn() },
      codev: { available: () => true, ask: (r) => asked.push(r) },
      say: (k) => k,
    });
    await cb.loadMap();
    cb.tour();
    expect(asked[0].context[0].text).toContain("ui-app/src/features/scm.ts (14)");
    cb.runEntry(1);
    expect(ran).toEqual(["npm run dev"]);
    const host = document.createElement("div");
    host.innerHTML = renderMap(((k: string) => k) as never, cb.state(), true, true);
    expect(host.querySelectorAll('[data-action="cb-open"]').length).toBeGreaterThan(3);
    expect(host.querySelector('[data-action="cb-run"][data-on="0"]')).not.toBeNull();
  });
});

describe("rever uma alteração grande", () => {
  it("agrupa por tema e conta as linhas", () => {
    expect(["src/lib.test.ts", "tests/flow.rs", "pkg/x_test.go", "docs/a.md", "Dockerfile", "infra/main.tf", ".github/workflows/ci.yml", "Cargo.lock", "app.css", "crates/tutor-eval/src/gitx.rs", "README.md"].map(groupOf))
      .toEqual(["tests", "tests", "tests", "docs", "infra", "infra", "infra", "config", "styles", "src:crates/tutor-eval", "docs"]);
    const g = groupFiles([{ path: "a/x.rs", status: "M", added: 3, removed: 1 }, { path: "docs/r.md", status: "A", added: 50, removed: 0 }, { path: "a/y.rs", status: "M", added: 10, removed: 2 }]);
    expect(g.map((x) => [x.key, x.files.map((f) => f.path)])).toEqual([["docs", ["docs/r.md"]], ["src:a", ["a/y.rs", "a/x.rs"]]]);
    expect(diffStat("--- a/x\n+++ b/x\n@@\n-old\n+new\n+more\n ctx")).toEqual({ added: 2, removed: 1 });
  });

  it("árvore de trabalho e ramo contra a base, revisto, e o Co-Dev por grupo", async () => {
    const asked: Array<{ intent: string; context: Array<{ text: string }> }> = [];
    const picks: Array<string | null> = ["develop"];
    const port = {
      changes: async () => [{ path: "src/a.rs", status: "M" }, { path: "tests/a.rs", status: "A" }],
      worktreeDiff: async (_r: string, p: string) => (p === "src/a.rs" ? "--- a\n+++ b\n-x\n+y\n+z" : "+++ b\n+t"),
      rangeDiff: vi.fn(async () => "+++ b\n+branch line"),
      compare: async () => ({ base: "develop", target: "feature/x", ahead: [], behind: [], files: [{ path: "src/b.rs", status: "M", added: 4, removed: 1 }] }),
    } as unknown as GitExtrasPort;
    const x = makeGitExtras({
      git: port,
      ws: { root: () => "/p", project: () => "p", save: async () => undefined, changed: async () => undefined, branches: () => ["develop", "feature/x"], current: () => "feature/x", cursor: () => null, commitMessage: () => "", open: vi.fn() },
      audit: { record: async () => undefined },
      human: { approve: async () => ({ approved: true, reason: "", decidedAt: 1 }), text: async () => null, pick: async () => picks.shift() ?? null, toast: vi.fn() },
      codev: { available: () => true, ask: (r) => asked.push(r) },
      tabs: { open: vi.fn(), repaint: vi.fn() },
      say: (k) => k,
    });
    await x.openReview("worktree");
    const r = x.state().review!;
    expect(r.groups.map((g) => g.key)).toEqual(["src:src", "tests"]);
    expect(r.files.find((f) => f.path === "src/a.rs")).toMatchObject({ added: 2, removed: 1 });
    x.markReviewed("src/a.rs", true);
    expect(x.state().review!.reviewed).toEqual(["src/a.rs"]);
    await x.askReviewGroup("src:src");
    expect(asked[0]).toMatchObject({ intent: "review" });
    expect(asked[0].context[0].text).toContain("+z");
    await x.openReview("branch");
    expect(x.state().review!.files[0].path).toBe("src/b.rs");
    await x.toggleReviewFile("src/b.rs");
    expect(port.rangeDiff).toHaveBeenCalledWith("/p", "develop", "feature/x", "src/b.rs");
    expect(x.state().review!.diffs["src/b.rs"]).toContain("branch line");
  });
});

describe("attach do depurador", () => {
  function harness(adapter: string | null) {
    let session: Session | null = null;
    const calls: Array<[string, unknown[]]> = [];
    const picks: Array<string | null> = [];
    const asks: Array<string | null> = [];
    let msg = "";
    const dbg: DebugPort = {
      available: async () => true,
      launch: async () => ({ engine: "dap", adapter: "lldb-dap" }),
      breakAt: async () => 1, run: async (id) => { calls.push(["run", [id]]); return { stopped: true, reason: "breakpoint", func: "handle", file: "/app/src/main.rs", line: 9, exited: false, exitCode: null, thread: 1 }; },
      cont: async () => ({ stopped: false, reason: "exited", func: "", file: "", line: 0, exited: true, exitCode: 0 }),
      step: async () => ({ stopped: false, reason: "", func: "", file: "", line: 0, exited: true, exitCode: 0 }),
      locals: async () => [], stack: async () => [], stop: async () => undefined,
      setBreakpoints: async (...a) => { calls.push(["setBreakpoints", a]); return []; },
      variables: async () => [], threads: async () => [],
      attachTargets: async (t) => { calls.push(["targets", [t]]); return t.name ? { ok: true, places: [], processes: [{ pid: 1, command: "/app/server --port 8080" }, { pid: 30, command: "sh" }], adapter, notes: adapter ? "" : "This image has no DAP adapter: add lldb-dap to it" } : { ok: true, places: ["shop-web-1", "shop-db-1"], processes: [], adapter: null, notes: "" }; },
      attach: async (...a) => { calls.push(["attach", a]); return { engine: "dap", adapter: "docker exec -i shop-web-1 /usr/bin/lldb-dap" }; },
    };
    const engine = makeDebugEngine({
      store: { session: () => session, setSession: (s) => { session = s; }, breakpoints: () => new Set(["/R/src/main.rs:9"]), hydrate: () => undefined, save: () => undefined, setMessage: (m) => { msg = m; } },
      dbg,
      workspace: { root: () => "/home/u/shop", fsRoot: () => "/R/", content: () => null, keys: () => [], exec: async () => ({ ok: true, out: "" }) },
      editor: { currentTab: () => null, openPath: vi.fn(), paintEd: vi.fn() },
      shell: { goPane: vi.fn(), setPanelTab: vi.fn() },
      picker: { choose: async () => picks.shift() ?? null, ask: async () => asks.shift() ?? null },
      view: { refresh: () => undefined },
      notifier: { toast: vi.fn() },
      newId: () => "A1",
      kubeTarget: () => ({ context: "kind-dev", namespace: "shop", kubeconfig: "" }),
      say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    });
    return { engine, calls, picks, asks, session: () => session, msg: () => msg };
  }

  it("contentor: escolhe o contentor e o processo, mapeia os caminhos, anexa e pára no breakpoint", async () => {
    const h = harness("/usr/bin/lldb-dap");
    h.picks.push("attachDocker", "shop-web-1", "1 · /app/server --port 8080");
    h.asks.push("/app");
    await h.engine.attach();
    const att = h.calls.find(([c]) => c === "attach")![1];
    expect(att).toEqual(["A1", { kind: "docker", name: "shop-web-1", context: "kind-dev", namespace: "shop", kubeconfig: "" }, 1, "/usr/bin/lldb-dap", "/home/u/shop", "/app"]);
    expect(h.calls.find(([c]) => c === "setBreakpoints")![1]).toEqual(["A1", "src/main.rs", [{ line: 9 }]]);
    expect(h.session()).toMatchObject({ engine: "dap", status: "stopped" });
    expect(h.session()!.program).toBe("shop-web-1:/app/server (pid 1)");
  });

  it("sem adaptador na imagem, diz o que instalar e não anexa; o pod usa o cluster do Infra", async () => {
    const h = harness(null);
    h.picks.push("attachPod {\"c\":\"kind-dev\",\"n\":\"shop\"}", "shop-web-1", "1 · /app/server --port 8080");
    await h.engine.attach();
    expect(h.calls.some(([c]) => c === "attach")).toBe(false);
    expect(h.msg()).toContain("no DAP adapter");
    expect((h.calls.find(([c]) => c === "targets")![1][0] as { kind: string }).kind).toBe("kubectl");
  });
});
