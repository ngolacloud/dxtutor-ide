/* ═══════════ A6 — Testing: real runners, per-test results, history (docs/v2/UI-AUDIT.md item 3) ═══════════
   The real app in desktop mode against a scripted backend that answers `test_runners`,
   `test_run` and `test_history` the way `commands/tests.rs` does: a cargo runner (and a Maven
   one whose tool is missing), a run with one pass and one failure, and the kept history.
   Proves the pane draws the runners, the results by suite, the failure detail and the
   history cards, that «Run this test» and «Δ» ask the backend for the right scope, and that
   «Fix with Co-Dev» hands the failure to the agent. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const runs: Array<Record<string, unknown>> = [];
  const result = (name: string, status: string, extra: Record<string, unknown> = {}) => ({ id: `cargo:lexer::${name}`, name, suite: "lexer", file: null, status, durationMs: 4, message: null, output: null, ...extra });
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "e2e\n", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", files: [{ path: "Cargo.toml", content: "[package]\nname = \"lexer\"\n" }, { path: "src/lib.rs", content: "pub fn lex() {}\n" }], skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
      case "list_tests":
        return [];
      case "test_runners":
        return [
          { id: "cargo:.", kind: "cargo", dir: ".", command: "cargo test", available: true, reason: "" },
          { id: "maven:java", kind: "maven", dir: "java", command: "mvn test", available: false, reason: "mvn is not installed" },
        ];
      case "test_run": {
        const scope = args.scope as { kind: string; name?: string };
        const results = scope.kind === "case"
          ? [result(String(scope.name), "passed")]
          : [result("tests::digits", "passed", { durationMs: 12 }), result("tests::eof", "failed", { durationMs: 230, message: "assertion `left == right` failed\n  left: 3\n right: 4", output: "thread 'tests::eof' panicked at src/lib.rs:20:9" }), result("tests::unicode", "skipped")];
        const p = results.filter((r) => r.status === "passed").length, f = results.filter((r) => r.status === "failed").length;
        runs.unshift({ id: runs.length + 1, at: Date.now(), runner: "cargo:.", command: "cargo test", scope: scope.kind, ok: f === 0, durationMs: 1840, passed: p, failed: f, skipped: results.length - p - f });
        return { runner: "cargo:.", kind: "cargo", command: "cargo test", ran: true, ok: f === 0, durationMs: 1840, results, output: "test result: FAILED. 1 passed; 1 failed", note: "" };
      }
      case "test_history":
        return {
          runs: runs.length ? [...runs, { id: 0, at: Date.now() - 3_600_000, runner: "cargo:.", command: "cargo test", scope: "all", ok: true, durationMs: 1700, passed: 3, failed: 0, skipped: 0 }] : [],
          cases: runs.length
            ? [
                { caseId: "cargo:lexer::tests::eof", name: "tests::eof", suite: "lexer", recent: "fpf", last: "failed", flips: 2, flaky: true, avgMs: 230, lastMessage: "assertion failed" },
                { caseId: "cargo:lexer::tests::digits", name: "tests::digits", suite: "lexer", recent: "pp", last: "passed", flips: 0, flaky: false, avgMs: 12, lastMessage: null },
              ]
            : [],
        };
      case "codev_agent_start":
        return "S1";
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = { core: { invoke }, event: { listen: async (event: string, h: Handler) => { (listeners[event] ||= []).push(h); return () => undefined; } } };
  w.__fake = { calls };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/lib.rs")));
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

test("the Testing pane: real runners, results by suite, failure detail, history and Co-Dev", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[data-pane="test"]').first().click();
  const pane = page.locator("#pane-test");
  await expect(pane.locator(".tr-runner")).toHaveCount(2);
  await expect(pane).toContainText("mvn is not installed");
  await expect(pane).toContainText("No runs kept yet");

  // run all: per-test results by suite, then the history cards
  await pane.locator('[data-action="test-runner-all"][data-on="cargo:."]').click();
  await expect(pane.locator(".tr-case")).toHaveCount(3);
  await expect(pane.locator(".tr-sum")).toContainText("1 passed");
  await expect(pane.locator(".tr-sum")).toContainText("1 failed");
  await expect(pane.locator(".tr-cards")).toContainText("Pass rate");
  await expect(pane.locator(".tr-cards")).toContainText("tests::eof");
  expect((await calls(page, "test_run")).at(-1)).toEqual({ root: "/proj", runner: "cargo:.", scope: { kind: "all" } });

  // the failure's detail
  await pane.locator('[data-action="test-case-sel"][data-on="cargo:.|cargo:lexer::tests::eof"]').click();
  await expect(pane.locator(".tr-msg")).toContainText("left: 3");
  await expect(pane.locator(".tr-detail .tr-out")).toContainText("src/lib.rs:20:9");
  await page.screenshot({ path: test.info().outputPath("a6-testing.png") });

  // one test on its own, with the name cargo needs
  await pane.locator('[data-action="test-case-run"][data-on="cargo:.|cargo:lexer::tests::eof"]').click();
  await expect.poll(async () => (await calls(page, "test_run")).at(-1)).toEqual({ root: "/proj", runner: "cargo:.", scope: { kind: "case", name: "tests::eof" } });
  await expect(pane.locator(".tr-sum")).toContainText("2 passed");

  // affected tests: the backend takes the files from git
  await pane.locator('[data-action="test-runner-changed"][data-on="cargo:."]').click();
  await expect.poll(async () => (await calls(page, "test_run")).at(-1)).toEqual({ root: "/proj", runner: "cargo:.", scope: { kind: "changed", files: [] } });

  // «Fix with Co-Dev» sends the failure to the agent
  await pane.locator('[data-action="test-case-sel"][data-on="cargo:.|cargo:lexer::tests::eof"]').click();
  if (!(await pane.locator(".tr-detail").count())) await pane.locator('[data-action="test-case-sel"][data-on="cargo:.|cargo:lexer::tests::eof"]').click();
  await pane.locator('[data-action="test-ask"][data-on="fix|cargo:.|cargo:lexer::tests::eof"]').click();
  await expect.poll(async () => JSON.stringify(await calls(page, "codev_agent_send"))).toContain("tests::eof");
});
