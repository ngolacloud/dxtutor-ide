import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* A0.5 (docs/v2/UI-AUDIT.md): with a folder open on the desktop app, the Testing pane lists
 * the project's REAL tests (list_tests) and runs them (run_test / run_all_tests) instead of
 * the simulated engine. A fake port stands in for the backend; the browser path (no port)
 * keeps the old pane, which the existing tests cover. */

let w: any;
let ran: string[];
const ITEMS = [
  { name: "tokenize_digits", path: "tests::tokenize_digits", file: "src/lib.rs", line: 20, ignored: false, lang: "rust" },
  { name: "tokenize_eof", path: "tests::tokenize_eof", file: "src/lib.rs", line: 26, ignored: false, lang: "rust" },
  { name: "TestParse", path: "TestParse", file: "parse_test.go", line: 5, ignored: false, lang: "go" },
];

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const pane = () => document.getElementById("pane-test")!;
const click = (sel: string, on?: string) => {
  const el = [...pane().querySelectorAll(sel)].find((e) => on === undefined || e.getAttribute("data-on") === on)!;
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
};

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  ran = [];
  const { desktopPorts } = await import("../src/app/desktop");
  desktopPorts.tests = {
    root: () => "/proj",
    list: async () => ITEMS,
    run: async (t) => { ran.push(t.path); return { ran: true, passed: t.name !== "tokenize_eof", output: `ran ${t.path}` }; },
    runAll: async () => { ran.push("ALL"); return { ran: true, passed: false, output: "test tests::tokenize_digits ... ok\ntest tests::tokenize_eof ... FAILED\n--- PASS: TestParse (0.00s)\n" }; },
    open: (file, line) => { ran.push(`open:${file}:${line}`); },
  };
});

afterEach(async () => {
  const { desktopPorts } = await import("../src/app/desktop");
  delete desktopPorts.tests;
  vi.useRealTimers();
});

describe("Testing pane on the desktop uses the real test commands", () => {
  it("discovers the project's tests and groups them by file", async () => {
    w.renderTestPane();
    expect(pane().textContent).toContain("A descobrir");
    await flush();
    const text = pane().textContent!;
    expect(text).toContain("src/lib.rs");
    expect(text).toContain("parse_test.go");
    expect(text).toContain("tokenize_digits");
    expect(text).toContain("3 por correr");
    expect(text).not.toContain("O resultado é calculado a partir do conteúdo actual dos ficheiros");
  });

  it("runs one test and shows its real result and output", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-run"]', "rust:tests::tokenize_eof");
    await flush();
    expect(ran).toEqual(["tests::tokenize_eof"]);
    expect(pane().textContent).toContain("1 falhados");
    expect(pane().textContent).toContain("ran tests::tokenize_eof");
  });

  it("Run all reads each test's result from the runner output", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-run-all"]');
    await flush();
    expect(ran).toEqual(["ALL"]);
    expect(pane().textContent).toContain("2 passados");
    expect(pane().textContent).toContain("1 falhados");
  });

  it("re-runs only the failed tests", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-run-all"]'); await flush();
    ran = [];
    click('[data-action="test-rerun-failed"]'); await flush();
    expect(ran).toEqual(["tests::tokenize_eof"]);
  });

  it("opens a test at its line", async () => {
    w.renderTestPane(); await flush();
    click('[data-action="test-open"]', "go:TestParse");
    expect(ran).toEqual(["open:parse_test.go:5"]);
  });
});
