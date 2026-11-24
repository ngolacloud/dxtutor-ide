import { describe, expect, it } from "vitest";
import { countStates, groupByFile, parseSuiteOutput, statesAfterSuite, statusBarText, testKey } from "../src/features/testing/domain/results";
import type { TestItem } from "../src/features/testing/domain/types";

/* Domínio puro do pane Testing (ADR-0006, R2a): dados→dados, sem harness nem `window`. */

const rs = (path: string, file = "src/lib.rs", line = 1, ignored = false): TestItem => ({ name: path.split("::").pop()!, path, file, line, ignored, lang: "rust" });
const go = (name: string, file = "x_test.go"): TestItem => ({ name, path: name, file, line: 1, ignored: false, lang: "go" });
const py = (name: string, file = "test_x.py"): TestItem => ({ name, path: name, file, line: 1, ignored: false, lang: "python" });

describe("testKey / groupByFile", () => {
  it("a chave junta ficheiro e caminho (o mesmo caminho em dois ficheiros não colide)", () => {
    expect(testKey(rs("tests::a", "a.rs"))).toBe("a.rs::tests::a");
    expect(testKey(rs("tests::a", "b.rs"))).not.toBe(testKey(rs("tests::a", "a.rs")));
  });

  it("agrupa por ficheiro mantendo a ordem da descoberta", () => {
    const g = groupByFile([rs("t::a", "a.rs"), rs("t::b", "a.rs"), rs("t::c", "b.rs")]);
    expect(g.map((x) => [x.file, x.items.length])).toEqual([["a.rs", 2], ["b.rs", 1]]);
  });
});

describe("parseSuiteOutput — o estado de cada teste na saída de «Run all»", () => {
  it("Rust: ok/FAILED/ignored, com o caminho do crate à frente ou só a folha", () => {
    const items = [rs("tests::soma"), rs("tests::falha"), rs("tests::lento"), rs("integra", "tests/it.rs")];
    const out = [
      "running 3 tests",
      "test tests::soma ... ok",
      "test tests::falha ... FAILED",
      "test tests::lento ... ignored",
      "test integra ... ok",
    ].join("\n");
    const m = parseSuiteOutput(out, items);
    expect(m.get("src/lib.rs::tests::soma")).toBe("passed");
    expect(m.get("src/lib.rs::tests::falha")).toBe("failed");
    expect(m.get("src/lib.rs::tests::lento")).toBe("ignored");
    expect(m.get("tests/it.rs::integra")).toBe("passed");
  });

  it("Go: --- PASS/FAIL/SKIP; os subtestes não decidem pelo pai", () => {
    const items = [go("TestA"), go("TestB"), go("TestC")];
    const out = "=== RUN   TestA\n--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\n    --- PASS: TestB/caso (0.00s)\n--- SKIP: TestC (0.00s)";
    const m = parseSuiteOutput(out, items);
    expect(m.get("x_test.go::TestA")).toBe("passed");
    expect(m.get("x_test.go::TestB")).toBe("failed");
    expect(m.get("x_test.go::TestC")).toBe("ignored");
  });

  it("Python (unittest -v): ok/FAIL/ERROR/skipped, nos formatos novo e antigo", () => {
    const items = [py("test_a"), py("test_b"), py("test_c"), py("test_d")];
    const out = "test_a (test_x.T.test_a) ... ok\ntest_b (test_x.T) ... FAIL\ntest_c (test_x.T.test_c) ... ERROR\ntest_d (test_x.T.test_d) ... skipped 'x'";
    const m = parseSuiteOutput(out, items);
    expect([...m.values()]).toEqual(["passed", "failed", "failed", "ignored"]);
  });

  it("não confunde línguas: uma linha do cargo não marca um teste Go com o mesmo nome", () => {
    const m = parseSuiteOutput("test TestA ... ok", [go("TestA")]);
    expect(m.size).toBe(0);
  });
});

describe("statesAfterSuite", () => {
  it("o que a saída diz manda; depois #[ignore]; depois uma suíte verde passa os outros", () => {
    const items = [rs("t::a"), rs("t::b", "src/lib.rs", 2, true), go("TestC")];
    const s = statesAfterSuite(items, { ran: true, passed: true, output: "test t::a ... ok" });
    expect(s[testKey(items[0])].status).toBe("passed");
    expect(s[testKey(items[1])].status).toBe("ignored");
    expect(s[testKey(items[2])].status).toBe("passed"); // go test sem -v não nomeia os que passam
  });

  it("numa suíte que falhou, o que a saída não nomeia fica por decidir (sem inventar)", () => {
    const items = [go("TestA"), go("TestB")];
    const s = statesAfterSuite(items, { ran: true, passed: false, output: "--- FAIL: TestB (0.01s)" });
    expect(s[testKey(items[0])].status).toBe("idle");
    expect(s[testKey(items[1])].status).toBe("failed");
  });

  it("uma suíte que nem correu não passa nada", () => {
    const items = [rs("t::a")];
    expect(statesAfterSuite(items, { ran: false, passed: false, output: "timed out" })[testKey(items[0])].status).toBe("idle");
  });
});

describe("countStates / statusBarText", () => {
  it("conta e escreve a barra só com resultados reais", () => {
    const items = [rs("t::a"), rs("t::b"), rs("t::c")];
    const st = { [testKey(items[0])]: { status: "passed" as const }, [testKey(items[1])]: { status: "failed" as const } };
    const c = countStates(items, st);
    expect(c).toEqual({ passed: 1, failed: 1, ignored: 0, total: 3 });
    expect(statusBarText(c, false)).toBe("✓ 1 ✗ 1");
    expect(statusBarText(c, true)).toBe("⟳ testes…");
    expect(statusBarText(countStates(items, {}), false)).toBe("");
  });
});
