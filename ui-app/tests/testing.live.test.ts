import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newRun, feed, finish, liveCommand, liveCounts, progress, findTestDef, testFnName } from "../src/features/testing/domain/live";
import { makeLiveRunner } from "../src/features/testing/application/live-runner";
import { renderLive } from "../src/features/testing/ui/live-view";
import { LIVE_MESSAGES } from "../src/features/testing/ui/live-messages";
import { bootApp } from "./harness";

/* O separador «Tests» do painel: a saída da suite lida linha a linha (cargo, go -v, pytest -v,
 * unittest -v, vitest, jest), o runner com um processo falso, e a vista. */

const run = (cmd: string, out: string, exit: number) => { const r = newRun(cmd, "t", 0); out.split("\n").forEach((l) => feed(r, l)); finish(r, exit, 1000); return r; };
const t = (k: keyof typeof LIVE_MESSAGES.en, p?: Record<string, string | number>) => (p ? LIVE_MESSAGES.en[k].replace(/\{(\w+)\}/g, (_, n) => String(p[n])) : LIVE_MESSAGES.en[k]);

describe("domínio — a corrida ao vivo", () => {
  it("cargo: compila, anuncia quantos testes, cada um com o estado, e o detalhe da falha com o sítio", () => {
    const r = newRun("cargo test", "t", 0);
    feed(r, "   Compiling lexer v0.1.0 (/p)");
    expect(r.phase).toBe("building");
    expect(r.now).toBe("Compiling lexer v0.1.0 (/p)");
    ["    Finished `test` profile [unoptimized] target(s) in 1.2s", "     Running unittests src/lib.rs (target/debug/deps/lexer-1)", "", "running 3 tests"].forEach((l) => feed(r, l));
    expect(r.total).toBe(3);
    feed(r, "test tests::empty ... ok");
    expect(progress(r)).toBeCloseTo(1 / 3);
    ["test tests::lex_ab ... FAILED", "test tests::slow ... ignored", "", "failures:", "", "---- tests::lex_ab stdout ----", "thread 'tests::lex_ab' panicked at src/lib.rs:31:9:", "assertion `left == right` failed", "  left: 1", " right: 2", "", "failures:", "    tests::lex_ab", "", "test result: FAILED. 1 passed; 1 failed; 1 ignored"].forEach((l) => feed(r, l));
    finish(r, 101, 500);
    expect(r.phase).toBe("failed");
    expect(liveCounts(r)).toEqual({ pass: 1, fail: 1, skip: 1, done: 3 });
    const f = r.cases.find((c) => c.status === "fail")!;
    expect(f.name).toBe("tests::lex_ab");
    expect(f.spot).toMatchObject({ file: "src/lib.rs", line: 31 });
    expect(f.detail.join("\n")).toContain("left: 1");
    expect(r.endedAt).toBe(500);
  });

  it("cargo que não compila: nenhum teste e o erro fica na corrida", () => {
    const r = run("cargo test", "   Compiling lexer v0.1.0\nerror[E0308]: mismatched types\n  --> src/lib.rs:12:18\n", 101);
    expect(r.cases).toEqual([]);
    expect(r.error).toContain("E0308");
  });

  it("go test -v: as linhas do teste antes do «--- FAIL» são o detalhe dele", () => {
    const r = run("go test -v ./...", "=== RUN   TestSum\n    sum_test.go:8: got 3, want 4\n--- FAIL: TestSum (0.01s)\n=== RUN   TestOk\n--- PASS: TestOk (0.00s)\nFAIL\nFAIL\tex.com/m\t0.02s", 1);
    expect(r.cases.map((c) => [c.name, c.status, c.ms])).toEqual([["TestSum", "fail", 10], ["TestOk", "pass", 0]]);
    expect(r.cases[0].spot).toMatchObject({ file: "sum_test.go", line: 8 });
  });

  it("pytest -v: o ficheiro, a percentagem e o bloco da falha", () => {
    const r = run("python -m pytest -v", "collected 2 items\n\ntests/test_calc.py::test_add FAILED [ 50%]\ntests/test_calc.py::test_sub PASSED [100%]\n\n=========== FAILURES ===========\n___________ test_add ___________\n\n    def test_add():\n>       assert add(1, 2) == 4\nE       assert 3 == 4\n\ntests/test_calc.py:5: AssertionError\n=========== short test summary info ===========", 1);
    expect(r.total).toBe(2);
    expect(r.cases.map((c) => [c.name, c.suite, c.status])).toEqual([["test_add", "tests/test_calc.py", "fail"], ["test_sub", "tests/test_calc.py", "pass"]]);
    expect(r.cases[0].detail.join("\n")).toContain("assert 3 == 4");
  });

  it("unittest -v e vitest", () => {
    const u = run("python -m unittest -v", "test_add (test_calc.CalcTest) ... FAIL\ntest_ok (test_calc.CalcTest) ... ok\n\nRan 2 tests in 0.001s", 1);
    expect(u.cases.map((c) => c.status)).toEqual(["fail", "pass"]);
    const v = run("npm test", " ✓ tests/a.test.ts (2 tests) 4ms\n   ✓ sum > adds 1ms\n   × sum > subtracts 2ms\n ✓ tests/b.test.ts (1 test) 1ms", 1);
    expect(v.cases.map((c) => [c.name, c.suite, c.status])).toEqual([["adds", "sum", "pass"], ["subtracts", "sum", "fail"]]);
  });

  it("o comando com saída legível ao vivo", () => {
    expect(liveCommand("go test ./...")).toBe("go test -v ./...");
    expect(liveCommand("python -m pytest -q")).toBe("python -m pytest -v");
    expect(liveCommand("cargo test")).toBe("cargo test");
  });

  it("encontra a definição de um teste", () => {
    expect(testFnName("tests::lex_ab")).toBe("lex_ab");
    expect(testFnName("test_add (test_calc.CalcTest)")).toBe("test_add");
    expect(findTestDef({ "p/a.rs": "fn a() {}\n#[test]\nfn lex_ab() {}\n" }, "tests::lex_ab")).toEqual({ key: "p/a.rs", line: 3 });
    expect(findTestDef({ "p/a.test.ts": "describe('sum', () => {\n  it('adds', () => {})\n})" }, "adds")).toEqual({ key: "p/a.test.ts", line: 2 });
  });
});

describe("caso de uso — o runner ao vivo", () => {
  function rig(root: string | null = "/p", cmd: string | null = "cargo test") {
    let line: (l: string) => void = () => {};
    let exit: (c: number) => void = () => {};
    const killed: string[] = [];
    const renders: Array<string | null> = [];
    let revealed = 0;
    const r = makeLiveRunner({
      proc: { run: (_c, o) => { line = o.line; o.onId("p1"); return new Promise((res) => { exit = res; }); }, kill: async (id) => (killed.push(id), true) },
      root: () => root, testCommand: () => cmd, save: async () => {}, reveal: () => { revealed++; },
      render: (s) => renders.push(s ? s.phase : null), now: () => 42,
    });
    return { r, line: (l: string) => line(l), exit: (c: number) => exit(c), killed, renders, revealed: () => revealed };
  }
  const flush = () => new Promise((res) => setTimeout(res, 0));

  it("corre, mostra cada linha e devolve o resultado na forma do run_tests", async () => {
    const x = rig();
    const done = x.r.start({ source: "Code review" });
    await flush();
    expect(x.revealed()).toBe(1);
    x.line("running 1 test");
    x.line("test a ... ok");
    expect(x.r.state()!.cases.length).toBe(1);
    x.exit(0);
    const res = await done;
    expect(res).toMatchObject({ ran: true, passed: true });
    expect(res.output).toContain("$ cargo test\nrunning 1 test");
    expect(x.r.state()!.phase).toBe("passed");
  });

  it("Parar mata o processo e a corrida fica parada", async () => {
    const x = rig();
    const done = x.r.start({ source: "t" });
    await flush();
    await x.r.stop();
    expect(x.killed).toEqual(["p1"]);
    expect(x.r.state()!.phase).toBe("stopped");
    x.exit(143);
    expect(await done).toMatchObject({ ran: false, passed: false });
    expect(x.r.state()!.phase).toBe("stopped");
  });

  it("sem pasta ou sem comando, di-lo", async () => {
    expect(await rig(null).r.start({ source: "t" })).toMatchObject({ ran: false, output: "no-folder" });
    const y = rig("/p", null);
    await y.r.start({ source: "t" });
    expect(y.r.state()).toMatchObject({ phase: "error", error: "no-command" });
  });
});

describe("vista", () => {
  it("a correr: spinner, o que está a acontecer, contadores e Parar; acabada: o resumo e Correr de novo", () => {
    const r = newRun("cargo test", "Code review", 0);
    ["   Compiling lexer v0.1.0", "running 2 tests", "test a ... ok"].forEach((l) => feed(r, l));
    const h = document.createElement("div");
    h.innerHTML = renderLive(r, { filter: "all", log: false }, t, 3000);
    expect(h.querySelector(".tl-spin")).not.toBe(null);
    expect(h.querySelector(".tl-now")!.textContent).toBe("a");
    expect(h.querySelector(".tl-counts")!.textContent).toContain("1/2");
    expect(h.querySelector('[data-action="live:stop"]')).not.toBe(null);
    expect(h.querySelector(".tl-time")!.textContent).toBe("00:03");
    feed(r, "test b ... FAILED");
    finish(r, 101, 4000);
    h.innerHTML = renderLive(r, { filter: "failed", log: false }, t, 4000);
    expect(h.querySelectorAll(".tl-row").length).toBe(1);
    expect(h.querySelector(".tl-sum")!.textContent).toContain("2 tests · 1 passed · 1 failed");
    expect(h.querySelector('[data-action="live:rerun"]')).not.toBe(null);
  });
  it("as mesmas chaves em en e ptAO", () => expect(Object.keys(LIVE_MESSAGES.ptAO).sort()).toEqual(Object.keys(LIVE_MESSAGES.en).sort()));
});

describe("o separador «Tests» no harness (desktop falso)", () => {
  let w: any;
  beforeEach(async () => { w = await bootApp(); });
  afterEach(() => { delete w.DXR; });

  it("runLive cria o separador, mostra os testes a chegar e o clique abre a definição", async () => {
    const T = await import("../src/features/testing/index");
    let push!: (l: string) => void, end!: (c: number) => void;
    w.DXR = { root: "/p", projectCmd: () => ({ cmd: "cargo test" }), streamCmd: (_l: string, o: { line: (l: string) => void; onId: (id: string) => void }) => { push = o.line; o.onId("x"); return new Promise((r) => { end = r; }); }, killCmd: async () => true };
    w.FS[w.ROOT + "src/lib.rs"] = { content: "#[test]\nfn lex_ab() {}\n", orig: "" };
    const done = T.runLive({ source: "Tests" });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.ptab[data-pt="tests"]')).not.toBe(null);
    push("running 1 test");
    push("test tests::lex_ab ... ok");
    end(0);
    await done;
    await new Promise((r) => setTimeout(r, 20));
    const row = document.querySelector<HTMLElement>("#pc-tests .tl-row.pass")!;
    expect(row.textContent).toContain("tests::lex_ab");
    const opened: unknown[] = [];
    w.openPath = (...a: unknown[]) => opened.push(a);
    row.click();
    expect(opened).toEqual([[w.ROOT + "src/lib.rs", 2]]);
  });
});
