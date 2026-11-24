/* ═══════════ A10 — the approved gaps (docs/v2/UI-AUDIT.md §3) ═══════════
   The real app in desktop mode against a scripted backend that answers like the real tools:
   `deps_report` (cargo update/audit), `onboard_map`, the git commands of a small repository
   (`git_changes`, `git_diff`), and the debugger's `debug_attach_targets` / `debug_attach`.
   Proves: updates and upgrades only reach the terminal once approved; the onboarding map opens files
   and runs entry points; a change is reviewed grouped by theme with each file's diff and «reviewed»
   marks; and attaching to a container picks the container and the process and runs over DAP. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const H = "a".repeat(40);
  const git = (args: string[]): { code: number; stdout: string; stderr: string } => {
    const a = args.join(" ");
    if (a === "rev-parse --is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
    if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "develop\n", stderr: "" };
    if (args[0] === "log") return { code: 0, stdout: `${H}\x1f\x1fAna\x1f1700000000\x1fstart\x1e`, stderr: "" };
    if (args[0] === "for-each-ref" && a.includes("refs/heads")) return { code: 0, stdout: `develop\x1f${H}\nmain\x1f${H}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info": return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec": return String(args.program) === "git" ? git((args.args as string[]) || []) : { code: 0, stdout: "", stderr: "" };
      case "load_workspace": return { root: "/proj", name: "proj", skipped: 0, truncated: false, files: [{ path: "Cargo.toml", content: '[package]\nname = "shop"\n' }, { path: "src/main.rs", content: "fn main() {\n    serve();\n}\nfn serve() {\n    let port = 8080;\n    println!(\"{port}\");\n}\n" }, { path: "README.md", content: "# shop\n" }] };
      case "get_providers_config": return { anthropicKey: "sk-e2e" };
      case "list_providers": case "list_tests": return [];
      case "deps_report": return { online: args.online, ecosystems: [{ kind: "cargo", dir: ".", notes: [], commands: ["cargo update --dry-run --verbose --offline", "cargo audit --json --no-fetch"],
        outdated: [{ name: "hyper", current: "1.12.0", compatible: "1.13.0", latest: null, direct: true, jump: "minor" }, { name: "ratatui", current: "0.29.0", compatible: null, latest: "0.30.2", direct: true, jump: "major" }],
        vulns: [{ id: "RUSTSEC-2026-0367", package: "zip", version: "2.1.0", severity: "critical", title: "Insecure Preservation of SUID/SGID Bits", url: "https://rustsec.org/advisories/RUSTSEC-2026-0367", fixed: [">=2.4.2"] }] }] };
      case "onboard_map": return { languages: [{ name: "Rust", files: 1, lines: 7 }], totalFiles: 3, tests: 0, git: true, notes: [],
        entries: [{ kind: "cargo-bin", name: "shop", file: "Cargo.toml", run: "cargo run -p shop" }], docs: ["README.md"], hot: [{ file: "src/main.rs", changes: 3 }], people: [{ name: "Ana", commits: 3 }], modules: [{ file: "src/main.rs", symbols: 2 }] };
      case "git_changes": return [{ path: "src/main.rs", status: "M", index: " ", work: "M" }, { path: "README.md", status: "M", index: " ", work: "M" }];
      case "git_diff": return args.file === "src/main.rs" ? "diff --git a/src/main.rs b/src/main.rs\n@@ -5 +5 @@\n-    let port = 80;\n+    let port = 8080;\n" : "diff --git a/README.md b/README.md\n@@ -1 +1,2 @@\n # shop\n+Run with cargo run.\n";
      case "git_stash": return { stashes: [], output: "" };
      case "git_worktree": return [];
      case "debug_available": return true;
      case "breakpoints_load": return [];
      case "debug_attach_targets": {
        const t = args.target as { kind: string; name: string };
        if (t.kind !== "local" && !t.name) return { ok: true, places: ["shop-web-1"], processes: [], adapter: null, notes: "" };
        return { ok: true, places: [], processes: [{ pid: 1, command: "/app/target/debug/shop" }, { pid: 41, command: "sh" }], adapter: "/usr/bin/lldb-dap", notes: "" };
      }
      case "debug_attach": return { engine: "dap", adapter: "docker exec -i shop-web-1 /usr/bin/lldb-dap" };
      case "debug_set_breakpoints": return [];
      case "debug_run": return { stopped: true, reason: "breakpoint", func: "shop::serve", file: "/proj/src/main.rs", line: 5, exited: false, exitCode: null, thread: 1 };
      case "debug_locals": return [{ name: "port", value: "8080" }];
      case "debug_stack": return [{ level: 0, func: "shop::serve", file: "/proj/src/main.rs", line: 5 }];
      case "debug_threads": return [{ id: 1, name: "shop", current: true }];
      case "debug_variables": return args.reference == null ? [{ name: "Locals", value: "", type: "", reference: 7, changed: false, path: "serve.Locals" }] : [{ name: "port", value: "8080", type: "i32", reference: 0, changed: false, path: "serve.Locals.port" }];
      default: return null;
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
  await page.waitForFunction(() => (window as unknown as { DXR?: { git?: boolean } }).DXR?.git === true);
  await page.evaluate(() => { const w = window as unknown as { runTask: (c: string) => void; __ran: string[] }; w.__ran = []; w.runTask = (c: string) => { w.__ran.push(c); }; });
}
const ran = (page: Page) => page.evaluate(() => (window as unknown as { __ran: string[] }).__ran);
const calls = (page: Page, cmd: string) => page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);
const palette = async (page: Page, label: string) => {
  await page.keyboard.press("Control+Shift+P");
  await page.locator("#pal-in").fill(">" + label);
  await page.locator("#pal-list .pi").first().click();
};

test("dependencies and the onboarding map", async ({ page }) => {
  await boot(page);
  await palette(page, "Project: Dependencies");
  const cb = page.locator(".cb").first();
  await expect(cb.locator(".cb-row.bad")).toContainText("zip 2.1.0");
  expect((await calls(page, "deps_report")).at(-1)).toEqual({ root: "/proj", online: false });
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await cb.locator('[data-action="cb-upgrade"][data-on="0|ratatui"]').click();
  await expect.poll(() => asked).toContain("cargo add ratatui@0.30.2");
  expect(await ran(page)).toEqual([]);
  page.once("dialog", (d) => void d.accept());
  await cb.locator('[data-action="cb-update"][data-on="0|hyper"]').click();
  await expect.poll(() => ran(page)).toEqual(["cargo update -p hyper"]);
  await page.screenshot({ path: test.info().outputPath("a10-deps.png") });

  await palette(page, "Project: Onboarding Map");
  const map = page.locator(".cb").filter({ has: page.locator(".cb-grid") }).first();
  await expect(map.locator(".cb-card").nth(1)).toContainText("cargo-bin");
  await map.locator('[data-action="cb-open"][data-on="README.md"]').click();
  await expect(page.locator("#tabs")).toContainText("README.md");
  await page.screenshot({ path: test.info().outputPath("a10-onboarding.png") });
});

test("reviewing the working tree grouped by theme", async ({ page }) => {
  await boot(page);
  await palette(page, "Git: Review Changes (working tree)");
  const rv = page.locator(".gx").filter({ has: page.locator(".gx-rg") }).first();
  await expect(rv.locator(".gx-rg")).toHaveCount(2);
  await expect(rv.locator(".gx-rgh").first()).toContainText("src");
  await rv.locator('[data-action="gx-review-file"][data-on="src/main.rs"]').click();
  await expect(rv.locator(".gx-diff")).toContainText("let port = 8080;");
  await rv.locator('[data-action="gx-review-mark"][data-on="src/main.rs"]').check();
  await expect(rv.locator(".gx-top .gx-meta")).toContainText("1 of 2 files reviewed");
  await page.screenshot({ path: test.info().outputPath("a10-review.png") });
});

test("attaching the debugger to a process in a container", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[data-pane="debug"]').first().click();
  await page.locator('#pane-debug [data-action="attach"]').click();
  await page.locator("#pal-list .pi", { hasText: "A Docker container" }).click();
  await page.locator("#pal-list .pi", { hasText: "shop-web-1" }).click();
  await page.locator("#pal-list .pi", { hasText: "/app/target/debug/shop" }).click();
  await page.locator("#pal-in").fill("/app");
  await page.locator("#pal-in").press("Enter");
  await expect(page.locator("#pane-debug .dbg-engine")).toContainText("docker exec -i shop-web-1");
  await expect(page.locator("#pane-debug")).toContainText("shop::serve");
  expect((await calls(page, "debug_attach")).at(-1)).toMatchObject({ target: { kind: "docker", name: "shop-web-1" }, pid: 1, adapter: "/usr/bin/lldb-dap", root: "/proj", remoteRoot: "/app" });
  await page.screenshot({ path: test.info().outputPath("a10-attach.png") });
});
