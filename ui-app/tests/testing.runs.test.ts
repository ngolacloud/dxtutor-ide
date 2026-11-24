import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { caseFilter, counts, failureContext, flakyCases, flakyContext, fmtMs, groupBySuite, passRateTrend, slowestCases, statesFromReport } from "../src/features/testing/domain/runs";
import { makeRuns } from "../src/features/testing/application/runs-service";
import type { CaseResult, CaseStat, RunRow, TestRunReport, TestScope } from "../src/features/testing/domain/types";

/* A6 (docs/v2/UI-AUDIT.md item 3) na feature `testing`: os runners que o projecto tem de facto
 * (`test_runners`), as corridas com resultado por teste (`test_run`: todos, um, afectados,
 * «Watch» a cada gravação), o histórico guardado (`test_history`) e os pedidos ao Co-Dev.
 * Domínio puro, serviço com portas falsas e a cadeia real de módulos com o IPC falso. */

const res = (o: Partial<CaseResult> & { name: string }): CaseResult => ({
  id: `cargo:lib::${o.name}`, suite: "lib", file: null, status: "passed", durationMs: null, message: null, output: null, ...o,
});

describe("domínio: as corridas", () => {
  it("cada runner endereça um teste à sua maneira", () => {
    expect(caseFilter("cargo", res({ name: "tests::adds" }))).toBe("tests::adds");
    expect(caseFilter("cargo", res({ name: "src/lib.rs - add (line 3)" }))).toBeNull();
    expect(caseFilter("go", res({ name: "TestParse/empty" }))).toBe("TestParse/empty");
    expect(caseFilter("pytest", res({ name: "test_x", suite: "tests.test_mod.TestCalc" }))).toBe("tests/test_mod.py::TestCalc::test_x");
    expect(caseFilter("pytest", res({ name: "test_y[2]", suite: "tests.test_mod", file: "tests/test_mod.py" }))).toBe("tests/test_mod.py::test_y[2]");
    expect(caseFilter("unittest", res({ name: "test_add", suite: "test_calc.CalcTest" }))).toBe("test_calc.CalcTest.test_add");
    expect(caseFilter("maven", res({ name: "adds", suite: "com.acme.CalcTest" }))).toBe("CalcTest#adds");
    expect(caseFilter("gradle", res({ name: "adds", suite: "com.acme.CalcTest" }))).toBe("com.acme.CalcTest.adds");
    expect(caseFilter("vitest", res({ name: "sum (a+b) works" }))).toBe("^sum \\(a\\+b\\) works$");
  });

  it("agrupa por suite com as falhas primeiro, conta e formata durações", () => {
    const rs = [res({ name: "a", suite: "z" }), res({ name: "b", suite: "y" }), res({ name: "c", suite: "z", status: "failed" }), res({ name: "d", suite: "y", status: "skipped" })];
    expect(groupBySuite(rs).map((g) => [g.suite, g.failed])).toEqual([["z", 1], ["y", 0]]);
    expect(counts(rs)).toEqual({ passed: 2, failed: 1, skipped: 1 });
    expect([fmtMs(12), fmtMs(1500), fmtMs(42_000), fmtMs(125_000), fmtMs(null)]).toEqual(["12 ms", "1.5 s", "42 s", "2 min 5 s", ""]);
  });

  it("os cartões vêm só das corridas guardadas", () => {
    const row = (id: number, passed: number, failed: number): RunRow => ({ id, at: id, runner: "cargo:.", command: "cargo test", scope: "all", ok: failed === 0, durationMs: 1, passed, failed, skipped: 0 });
    expect(passRateTrend([row(3, 4, 0), row(2, 0, 0), row(1, 3, 1)])).toEqual([75, 100]); // uma corrida sem testes não conta
    const stat = (name: string, o: Partial<CaseStat>): CaseStat => ({ caseId: name, name, suite: "s", recent: "pp", last: "passed", flips: 0, flaky: false, avgMs: null, lastMessage: null, ...o });
    const cases = [stat("a", { flaky: true, flips: 2 }), stat("b", { flaky: true, flips: 4 }), stat("c", { avgMs: 900 }), stat("d", { avgMs: 30 })];
    expect(flakyCases(cases).map((c) => c.name)).toEqual(["b", "a"]);
    expect(slowestCases(cases).map((c) => c.name)).toEqual(["c", "d"]);
    expect(flakyContext(stat("x", { recent: "pfp", flips: 2, lastMessage: "boom" })).text).toContain("pfp");
  });

  it("a falha vai para o Co-Dev com o comando, a mensagem e a saída", () => {
    const ctx = failureContext({ kind: "cargo", command: "cargo test" }, res({ name: "adds", status: "failed", message: "left: 3, right: 4", output: "panicked at src/lib.rs:9", file: "src/lib.rs" }));
    expect(ctx).toMatchObject({ kind: "test", label: "adds", path: "src/lib.rs" });
    expect(ctx.text).toContain("cargo test");
    expect(ctx.text).toContain("left: 3, right: 4");
    expect(ctx.text).toContain("src/lib.rs:9");
  });

  it("os resultados de um runner acendem os testes descobertos da mesma linguagem", () => {
    const items = [
      { name: "adds", path: "tests::adds", file: "src/lib.rs", line: 3, ignored: false, lang: "rust" },
      { name: "TestX", path: "TestX", file: "x_test.go", line: 1, ignored: false, lang: "go" },
    ];
    const st = statesFromReport(items, { kind: "cargo", results: [res({ name: "tests::adds", status: "failed", message: "boom" })] });
    expect(st).toEqual({ "src/lib.rs::tests::adds": { status: "failed", output: "boom" } });
  });
});

const RUNNERS = [
  { id: "cargo:.", kind: "cargo" as const, dir: ".", command: "cargo test", available: true, reason: "" },
  { id: "maven:java", kind: "maven" as const, dir: "java", command: "mvn test", available: false, reason: "mvn not installed" },
];
const report = (scope: TestScope): TestRunReport => ({
  runner: "cargo:.", kind: "cargo", command: "cargo test", ran: true, ok: false, durationMs: 2300, note: "", output: "test result: FAILED",
  results: scope.kind === "case"
    ? [res({ name: scope.name, status: "passed", durationMs: 3 })]
    : [res({ name: "tests::adds", durationMs: 4 }), res({ name: "tests::subs", status: "failed", message: "assertion failed: 1 == 2", output: "thread panicked at src/lib.rs:20" })],
});

function fakes() {
  const calls: Array<[string, TestScope]> = [];
  const asked: Array<{ intent: string; text: string; context: Array<{ kind: string; text: string; path?: string }>; send?: boolean }> = [];
  let flushWatch: (() => void) | null = null;
  const runs = makeRuns({
    runners: {
      runners: async () => RUNNERS,
      run: async (_root, id, scope) => { calls.push([id, scope]); return report(scope); },
      history: async () => ({ runs: [], cases: [{ caseId: "cargo:lib::tests::subs", name: "tests::subs", suite: "lib", recent: "fpf", last: "failed", flips: 2, flaky: true, avgMs: 12, lastMessage: "x" }] }),
    },
    workspace: { root: () => "/proj", save: async () => undefined, currentFile: () => ({ path: "src/lib.rs", text: "pub fn add() {}" }) },
    codev: { available: () => true, ask: (r) => { asked.push(r); } },
    debounce: (f) => { flushWatch = f; return () => { flushWatch = null; }; },
  });
  return { runs, calls, asked, watch: () => flushWatch?.() };
}

describe("aplicação: o serviço das corridas", () => {
  it("carrega os runners e o histórico; corre todos, um teste no seu lugar e os afectados", async () => {
    const { runs, calls } = fakes();
    await runs.reload();
    expect(runs.hasRunners()).toBe(true);
    expect(runs.state().history?.cases).toHaveLength(1);
    await runs.run("maven:java", { kind: "all" }); // indisponível: nada corre
    await runs.run("cargo:.", { kind: "all" });
    await runs.runCase("cargo:.|cargo:lib::tests::subs");
    expect(calls).toEqual([["cargo:.", { kind: "all" }], ["cargo:.", { kind: "case", name: "tests::subs" }]]);
    expect(counts(runs.state().reports["cargo:."].results)).toEqual({ passed: 2, failed: 0, skipped: 0 });
  });

  it("«Watch» junta as gravações e corre os afectados; desligado, não corre", async () => {
    const { runs, calls, watch } = fakes();
    await runs.reload();
    runs.saved(["src/lib.rs"]);
    expect(calls).toEqual([]);
    runs.setWatch(true);
    runs.saved(["src/lib.rs"]);
    runs.saved(["src/main.rs"]);
    watch();
    await vi.waitFor(() => expect(calls).toEqual([["cargo:.", { kind: "changed", files: ["src/lib.rs", "src/main.rs"] }]]));
  });

  it("pede ao Co-Dev: explicar e corrigir a falha, o teste em falta, a causa de um instável", async () => {
    const { runs, asked } = fakes();
    await runs.reload();
    await runs.run("cargo:.", { kind: "all" });
    runs.askFailure("explain", "cargo:.|cargo:lib::tests::subs");
    runs.askFailure("fix", "cargo:.|cargo:lib::tests::subs");
    runs.writeMissingTest();
    runs.askFlaky("cargo:lib::tests::subs");
    expect(asked.map((a) => [a.intent, a.send ?? false, a.context[0]?.kind])).toEqual([["explain", true, "test"], ["fix", true, "test"], ["change", false, "file"], ["explain", true, "test"]]);
    expect(asked[1].text).toContain("cargo test");
    expect(asked[2].text).toContain("src/lib.rs");
    expect(asked[3].context[0].text).toContain("fpf");
  });

  it("uma corrida de cada vez, também contra as da descoberta", async () => {
    let other = true;
    const calls: string[] = [];
    const runs = makeRuns({
      runners: { runners: async () => RUNNERS, run: async (_r, id) => { calls.push(id); return report({ kind: "all" }); }, history: async () => ({ runs: [], cases: [] }) },
      workspace: { root: () => "/proj" },
      codev: { available: () => false, ask: () => undefined },
      busy: () => other,
    });
    await runs.reload();
    await runs.run("cargo:.", { kind: "all" });
    expect(calls).toEqual([]);
    other = false;
    await runs.run("cargo:.", { kind: "all" });
    expect(calls).toEqual(["cargo:."]);
  });
});

/* a cadeia real de módulos com o IPC do Tauri falso (como testing.wiring.test.ts) */
let w: any;
let ipc: Array<[string, Record<string, unknown>]>;
let asked: any[];
const pane = (): HTMLElement => document.getElementById("pane-test")!;
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(async () => {
  w = await bootApp();
  ipc = []; asked = [];
  const { codevAsk } = await import("../src/app/codev-ask");
  codevAsk.register(async (r) => { asked.push(r); }, () => undefined);
  w.DXR = { root: "/proj", projectCmd: () => null };
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    list_tests: () => [{ name: "subs", path: "tests::subs", file: "src/lib.rs", line: 9, ignored: false, lang: "rust" }],
    test_runners: () => RUNNERS,
    test_run: (a) => report(a.scope as TestScope),
    test_history: () => ({ runs: ipc.some(([c]) => c === "test_run") ? [{ id: 1, at: Date.now(), runner: "cargo:.", command: "cargo test", scope: "all", ok: false, durationMs: 2300, passed: 1, failed: 1, skipped: 0 }] : [], cases: [] }),
  };
  w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => { ipc.push([cmd, args]); if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd); return handlers[cmd](args); } } };
});

afterEach(() => {
  delete w.__TAURI__;
  delete w.DXR;
});

describe("ligação: o pane com os runners reais", () => {
  it("descobre primeiro, depois mostra os runners (e porque um não está disponível)", async () => {
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="runner-all"][data-on="cargo:."]')).toBeTruthy());
    expect(ipc[0][0]).toBe("list_tests");
    expect(pane().textContent).toContain("mvn not installed");
    expect(pane().querySelector('[data-action="runner-all"][data-on="maven:java"]')).toBeNull();
    expect(pane().textContent).toContain("Tests in the code");
    expect(pane().textContent).toContain("No runs kept yet");
  });

  it("corre um runner: resultados por suite, a falha aberta, o Co-Dev e os cartões; acende a lista", async () => {
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(pane().querySelector('[data-action="runner-all"][data-on="cargo:."]')).toBeTruthy());
    click(pane().querySelector('[data-action="runner-all"][data-on="cargo:."]')!);
    await vi.waitFor(() => expect(pane().querySelectorAll(".tr-case")).toHaveLength(2));
    expect(ipc).toContainEqual(["test_run", { root: "/proj", runner: "cargo:.", scope: { kind: "all" } }]);
    expect(pane().querySelector(".tr-sum")!.textContent).toContain("1 failed");
    await vi.waitFor(() => expect(pane().querySelector(".tr-cards")!.textContent).toContain("50%"));
    expect(document.getElementById("st-tests")!.textContent).toBe("✓ 0 ✗ 1"); // a lista descoberta acendeu
    click(pane().querySelector('[data-action="case-select"][data-on="cargo:.|cargo:lib::tests::subs"]')!);
    expect(pane().querySelector(".tr-msg")!.textContent).toBe("assertion failed: 1 == 2");
    click(pane().querySelector('[data-action="ask-failure"][data-on="fix|cargo:.|cargo:lib::tests::subs"]')!);
    expect(asked[0]).toMatchObject({ intent: "fix", send: true });
    click(pane().querySelector('[data-action="runner-changed"][data-on="cargo:."]')!);
    await vi.waitFor(() => expect(ipc).toContainEqual(["test_run", { root: "/proj", runner: "cargo:.", scope: { kind: "changed", files: [] } }]));
  });

  it("«Watch» corre os afectados de cada gravação", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      w.PANE = "test";
      w.RP.test();
      await vi.waitFor(() => expect(pane().querySelector('[data-action="watch"]')).toBeTruthy());
      const box = pane().querySelector<HTMLInputElement>('[data-action="watch"]')!;
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }));
      document.dispatchEvent(new CustomEvent("dx:saved", { detail: { root: "/proj", files: ["src/lib.rs"] } }));
      vi.advanceTimersByTime(500);
      await vi.waitFor(() => expect(ipc).toContainEqual(["test_run", { root: "/proj", runner: "cargo:.", scope: { kind: "changed", files: ["src/lib.rs"] } }]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem o comando dos runners (backend antigo), o pane fica exactamente como antes", async () => {
    w.__TAURI__.core.invoke = async (cmd: string, args: Record<string, unknown>) => {
      ipc.push([cmd, args]);
      if (cmd === "list_tests") return [];
      throw new Error("comando inesperado: " + cmd);
    };
    w.PANE = "test";
    w.RP.test();
    await vi.waitFor(() => expect(ipc.some(([c]) => c === "test_runners")).toBe(true));
    await Promise.resolve();
    expect(pane().textContent).not.toContain("Runners");
    expect(pane().textContent).toMatch(/Não encontrei testes/);
  });
});
