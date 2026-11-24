/* ═══════════ A7 — Run and Debug over DAP (docs/v2/UI-AUDIT.md item 4) ═══════════
   The real app in desktop mode against a scripted backend that answers the `debug_*` commands
   the way a session over lldb-dap does (`tutor_eval::dapc`): the launch says «dap», the
   breakpoints go per file with their condition, the program prints on `debug://output`, and a
   stop gives threads, scopes and variables that change after a step. Proves: the gutter's menu
   makes a conditional breakpoint; the pane shows the variables as a tree with what changed,
   the threads, the watch, the output; the editor shows the values inline; step out goes to the
   adapter; and the snapshot is kept with the chosen issue. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  let stops = 0;
  const v = (name: string, value: string, o: Record<string, unknown> = {}) => ({ name, value, type: "i32", reference: 0, changed: false, path: name, ...o });
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
      case "load_workspace":
        return {
          root: "/proj", name: "proj", skipped: 0, truncated: false,
          files: [
            { path: "Cargo.toml", content: '[package]\nname = "lexer"\nversion = "0.1.0"\n' },
            { path: "src/main.rs", content: "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\nfn main() {\n    let mut total = 0;\n    for i in 0..5 {\n        total = add(total, i);\n    }\n    println!(\"{total}\");\n}\n" },
          ],
        };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
      case "list_tests":
        return [];
      case "debug_available":
        return true;
      case "debug_launch":
        return { engine: "dap", adapter: "lldb-dap" };
      case "debug_set_breakpoints":
        return ((args.breakpoints as Array<{ line: number }>) || []).map((b) => ({ line: b.line, verified: true, message: null }));
      case "breakpoints_load":
        return [];
      case "breakpoints_save":
      case "debug_stop":
      case "debug_snapshot":
        return null;
      case "debug_run":
      case "debug_continue":
      case "debug_step": {
        stops++;
        emit("debug://output", { id: args.id, category: "stdout", text: `stop ${stops}\n` });
        return { stopped: true, reason: stops === 1 ? "breakpoint" : "step", func: "main", file: "/proj/src/main.rs", line: stops === 1 ? 7 : 8, exited: false, exitCode: null, thread: 1 };
      }
      case "debug_locals":
        return [{ name: "i", value: "3" }, { name: "total", value: stops > 1 ? "6" : "3" }];
      case "debug_stack":
        return [{ level: 0, func: "main", file: "/proj/src/main.rs", line: stops === 1 ? 7 : 8 }, { level: 1, func: "std::rt::lang_start", file: "", line: 0 }];
      case "debug_threads":
        return [{ id: 1, name: "main", current: true }, { id: 2, name: "worker-1", current: false }];
      case "debug_variables": {
        const o = stops > 1 ? 100 : 0;
        if (args.reference == null) return [v("Locals", "", { reference: 10 + o, type: "", path: "main.Locals" })];
        return [v("i", "3", { path: "main.Locals.i" }), v("total", stops > 1 ? "6" : "3", { changed: stops > 1, path: "main.Locals.total" })];
      }
      case "debug_evaluate":
        return v(String(args.expression), stops > 1 ? "12" : "6");
      case "project_load":
        return { issues: [{ key: "DXT-7", title: "total is off by one", state: "progress" }] };
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
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/main.rs")));
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

test("conditional breakpoint from the gutter, variables tree with changes, inline values, watch, output and snapshot", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as unknown as { openPath: (p: string) => void; ROOT: string }).openPath((window as unknown as { ROOT: string }).ROOT + "src/main.rs"));
  const gut = page.locator("#ed-gut > div");
  await expect(gut).toHaveCount(11);
  // the gutter's menu: a conditional breakpoint on line 7
  await gut.nth(6).click({ button: "right" });
  await page.locator("#bp-menu .mi", { hasText: "Add a condition" }).click();
  await page.locator("#pal-in").fill("i == 3");
  await page.locator("#pal-in").press("Enter");
  await page.locator('#activity .act[data-pane="debug"]').first().click();
  const pane = page.locator("#pane-debug");
  await expect(pane.locator(".bpm")).toContainText("when i == 3");
  expect((await calls(page, "breakpoints_save")).at(-1)).toMatchObject({ root: "/proj", file: "src/main.rs", breakpoints: [{ file: "src/main.rs", line: 7, condition: "i == 3", enabled: true }] });

  // start: the launch says DAP, the breakpoints go per file with their condition
  await pane.locator('[data-action="start"]').click();
  await expect(pane.locator(".dbg-engine")).toContainText("lldb-dap");
  expect((await calls(page, "debug_set_breakpoints")).at(-1)).toEqual({ id: expect.any(String), file: "src/main.rs", breakpoints: [{ line: 7, condition: "i == 3" }] });
  await expect(pane.locator(".dvx .k").filter({ hasText: /^total$/ })).toBeVisible();
  await expect(pane.locator('[data-action="thread"]')).toHaveCount(2);
  await expect(pane.locator(".dbg-out")).toContainText("stop 1");
  // a watch, then a step: total changes and is flagged; the watch follows
  await pane.locator(".dbg-watch-in").fill("total * 2");
  await pane.locator(".dbg-watch-in").press("Enter");
  await expect(pane.locator(".dvx", { hasText: "total * 2" })).toContainText("6");
  await pane.locator('[data-action="step"]').click();
  await expect(pane.locator(".dvx.chg .k").filter({ hasText: /^total$/ })).toBeVisible();
  await expect(pane.locator(".dvx", { hasText: "total * 2" })).toContainText("12");
  // the values inline, next to the lines above the stop
  await expect(page.locator("#ed-hl .dv-inline").first()).toContainText("total = 6");
  await page.screenshot({ path: test.info().outputPath("a7-debug.png") });

  // step out goes to the adapter
  await pane.locator('[data-action="step-out"]').click();
  await expect.poll(async () => (await calls(page, "debug_step")).at(-1)).toMatchObject({ into: false, kind: "out" });

  // the snapshot is kept with the chosen issue
  await pane.locator('[data-action="snapshot"]').click();
  await page.locator("#pal-list .pi", { hasText: "DXT-7" }).first().click();
  await expect.poll(async () => (await calls(page, "debug_snapshot")).at(-1)).toMatchObject({ root: "/proj", issue: "DXT-7", title: "Debug: main at main.rs:8" });
  expect(String((await calls(page, "debug_snapshot")).at(-1)?.markdown)).toContain("← changed");
});
