import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { caseFilter, counts, failureContext, flakyCases, flakyContext, fmtMs, groupBySuite, passRateTrend, slowestCases } from "../src/features/test-model";
import type { CaseResult, CaseStat, RunRow, TestRunReport, TestScope } from "../src/platform/tauri/tests";

/* A6 (docs/v2/UI-AUDIT.md item 3): the Testing pane on the desktop lists the runners the
 * project really has, runs them with per-test results (all, affected, one test, watch on
 * save), keeps the history cards from the stored runs and hands a failure or a flaky test to
 * Co-Dev. A fake port stands in for `test_runners`/`test_run`/`test_history`. */

const res = (o: Partial<CaseResult> & { name: string }): CaseResult => ({
  id: `cargo:lib::${o.name}`, suite: "lib", file: null, status: "passed", durationMs: null, message: null, output: null, ...o,
});

describe("the test model", () => {
  it("addresses one test the way each runner needs", () => {
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

  it("groups by suite with failures first, counts and formats durations", () => {
    const rs = [res({ name: "a", suite: "z" }), res({ name: "b", suite: "y" }), res({ name: "c", suite: "z", status: "failed" }), res({ name: "d", suite: "y", status: "skipped" })];
    expect(groupBySuite(rs).map((g) => [g.suite, g.failed])).toEqual([["z", 1], ["y", 0]]);
    expect(counts(rs)).toEqual({ passed: 2, failed: 1, skipped: 1 });
    expect([fmtMs(12), fmtMs(1500), fmtMs(42_000), fmtMs(125_000), fmtMs(null)]).toEqual(["12 ms", "1.5 s", "42 s", "2 min 5 s", ""]);
  });

  it("computes the history cards from the kept runs only", () => {
    const row = (id: number, passed: number, failed: number): RunRow => ({ id, at: id, runner: "cargo:.", command: "cargo test", scope: "all", ok: failed === 0, durationMs: 1, passed, failed, skipped: 0 });
    // newest first, as test_history returns them; a run with no tests is not a data point
    expect(passRateTrend([row(3, 4, 0), row(2, 0, 0), row(1, 3, 1)])).toEqual([75, 100]);
    const stat = (name: string, o: Partial<CaseStat>): CaseStat => ({ caseId: name, name, suite: "s", recent: "pp", last: "passed", flips: 0, flaky: false, avgMs: null, lastMessage: null, ...o });
    const cases = [stat("a", { flaky: true, flips: 2 }), stat("b", { flaky: true, flips: 4 }), stat("c", { avgMs: 900 }), stat("d", { avgMs: 30 })];
    expect(flakyCases(cases).map((c) => c.name)).toEqual(["b", "a"]);
    expect(slowestCases(cases).map((c) => c.name)).toEqual(["c", "d"]);
    expect(flakyContext(stat("x", { recent: "pfp", flips: 2, lastMessage: "boom" })).text).toContain("pfp");
  });

  it("gives Co-Dev the failure with the command, message and output", () => {
    const ctx = failureContext({ kind: "cargo", command: "cargo test" }, res({ name: "adds", status: "failed", message: "left: 3, right: 4", output: "panicked at src/lib.rs:9", file: "src/lib.rs" }));
    expect(ctx).toMatchObject({ kind: "test", label: "adds", path: "src/lib.rs" });
    expect(ctx.text).toContain("cargo test");
    expect(ctx.text).toContain("left: 3, right: 4");
    expect(ctx.text).toContain("src/lib.rs:9");
  });
});

let w: any;
let calls: Array<[string, TestScope]>;
let asked: any[];
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

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pane = () => document.getElementById("pane-test")!;
const el = (sel: string, on?: string) => [...pane().querySelectorAll(sel)].find((e) => on === undefined || e.getAttribute("data-on") === on) as HTMLElement | undefined;
const click = (sel: string, on?: string) => el(sel, on)!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  calls = []; asked = [];
  const { desktopPorts } = await import("../src/app/desktop");
  const { codevAsk } = await import("../src/app/codev-ask");
  codevAsk.register(async (r) => { asked.push(r); }, () => undefined);
  desktopPorts.tests = {
    root: () => "/proj",
    list: async () => [],
    run: async () => ({ ran: true, passed: true, output: "" }),
    runAll: async () => ({ ran: true, passed: true, output: "" }),
    open: () => undefined,
    runners: async () => RUNNERS,
    runRunner: async (id, scope) => { calls.push([id, scope]); return report(scope); },
    history: async () => ({
      runs: calls.length ? [{ id: 2, at: Date.now(), runner: "cargo:.", command: "cargo test", scope: "all", ok: false, durationMs: 2300, passed: 1, failed: 1, skipped: 0 }, { id: 1, at: Date.now() - 1, runner: "cargo:.", command: "cargo test", scope: "all", ok: true, durationMs: 2000, passed: 2, failed: 0, skipped: 0 }] : [],
      cases: calls.length ? [{ caseId: "cargo:lib::tests::subs", name: "tests::subs", suite: "lib", recent: "fpf", last: "failed", flips: 2, flaky: true, avgMs: 12, lastMessage: "assertion failed" }] : [],
    }),
    currentFile: () => ({ path: "src/lib.rs", text: "pub fn add() {}" }),
  };
});

afterEach(async () => {
  const { desktopPorts } = await import("../src/app/desktop");
  delete desktopPorts.tests;
  vi.useRealTimers();
});

describe("the Testing pane with the project's real runners", () => {
  it("lists the runners with their command, and why one is unavailable", async () => {
    w.renderTestPane(); await flush();
    const t = pane().textContent!;
    expect(t).toContain("cargo test");
    expect(t).toContain("mvn not installed");
    expect(el('[data-action="test-runner-all"]', "maven:java")).toBeUndefined();
    expect(t).toContain("No runs kept yet");
  });

  it("runs all with per-test results grouped by suite, then the history cards", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-runner-all"]', "cargo:.");
    await flush();
    expect(calls).toEqual([["cargo:.", { kind: "all" }]]);
    const t = pane().textContent!;
    expect(t).toContain("1 passed");
    expect(t).toContain("1 failed");
    expect(t).toContain("2.3 s");
    expect(pane().querySelectorAll(".tr-case")).toHaveLength(2);
    await flush();
    expect(pane().querySelector(".tr-cards")!.textContent).toContain("50%");
    expect(pane().querySelector(".tr-cards")!.textContent).toContain("tests::subs");
  });

  it("opens a failure, asks Co-Dev to explain or fix it, and re-runs just that test", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-runner-all"]', "cargo:."); await flush();
    click('[data-action="test-case-sel"]', "cargo:.|cargo:lib::tests::subs");
    expect(pane().querySelector(".tr-msg")!.textContent).toBe("assertion failed: 1 == 2");
    click('[data-action="test-ask"]', "explain|cargo:.|cargo:lib::tests::subs");
    click('[data-action="test-ask"]', "fix|cargo:.|cargo:lib::tests::subs");
    expect(asked.map((a) => [a.intent, a.send, a.context[0].kind])).toEqual([["explain", true, "test"], ["fix", true, "test"]]);
    expect(asked[1].text).toContain("cargo test");
    click('[data-action="test-case-run"]', "cargo:.|cargo:lib::tests::subs"); await flush();
    expect(calls.at(-1)).toEqual(["cargo:.", { kind: "case", name: "tests::subs" }]);
    // the single run updates that result in place; the other stays
    expect(pane().textContent).toContain("2 passed");
  });

  it("runs the affected tests, and with Watch on, the tests affected by each save", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-runner-changed"]', "cargo:."); await flush();
    expect(calls.at(-1)).toEqual(["cargo:.", { kind: "changed", files: [] }]);
    const box = el('[data-action="test-watch"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.click();
    document.dispatchEvent(new CustomEvent("dx:saved", { detail: { root: "/proj", files: ["src/lib.rs"] } }));
    document.dispatchEvent(new CustomEvent("dx:saved", { detail: { root: "/proj", files: ["src/main.rs"] } }));
    vi.advanceTimersByTime(500); await flush();
    expect(calls.at(-1)).toEqual(["cargo:.", { kind: "changed", files: ["src/lib.rs", "src/main.rs"] }]);
  });

  it("asks Co-Dev for a missing test of the open file, and for the cause of a flaky test", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-runner-all"]', "cargo:."); await flush(); await flush();
    click('[data-action="test-write"]');
    expect(asked[0]).toMatchObject({ intent: "change", context: [{ kind: "file", path: "src/lib.rs" }] });
    expect(asked[0].text).toContain("cargo test");
    click('[data-action="test-flaky-ask"]', "cargo:lib::tests::subs");
    expect(asked[1].intent).toBe("explain");
    expect(asked[1].context[0].text).toContain("fpf");
  });
});
