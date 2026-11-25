/* ═══════════ r23 F6 — Welcome: Start · Recent · Walkthroughs ═══════════
   The real app in desktop mode against a scripted backend. Proves the r23 acceptance — opening a recent
   folder from the Welcome opens the right workspace — and that «Clone Git Repository…» shows the exact
   command the backend built, runs only once approved, is audited, and opens the new folder. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const ws = (root: string) => ({ root, name: root.split("/").pop(), skipped: 0, truncated: false, files: [{ path: "README.md", content: `# ${root.split("/").pop()}\n` }] });
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info": return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: null };
      case "exec": return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
      case "load_workspace": return ws(String(args.root));
      case "get_providers_config": return { anthropicKey: "sk-e2e" };
      case "list_providers": case "list_tests": return [];
      case "git_clone_plan": return { url: args.url, parent: args.parentDir, name: "shop", target: `${args.parentDir}/shop`, exists: false, command: `git -C ${args.parentDir} clone -- ${args.url} shop` };
      case "git_clone": return `${args.parentDir}/shop`;
      default: return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = { core: { invoke }, event: { listen: async () => () => undefined } };
  w.__fake = { calls };
  try { localStorage.setItem("dx2.dx-recent", JSON.stringify(["/home/e2e/work/alpha", "/home/e2e/work/beta"])); localStorage.removeItem("dx2.dx-last-folder"); } catch { /* sem storage */ }
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await expect(page.locator(".wel")).toBeVisible();
}

test("the Welcome: a recent folder opens that workspace; walkthroughs keep progress", async ({ page }) => {
  await boot(page);
  const wel = page.locator(".wel");
  await expect(wel.locator(".wel-recent")).toHaveCount(2);
  await expect(wel.locator(".wel-walk")).toHaveCount(7);
  await page.screenshot({ path: test.info().outputPath("f6-welcome.png") });
  await wel.locator('[data-action="welcome:openRecent"][data-on="/home/e2e/work/beta"]').click();
  await expect.poll(async () => (await calls(page, "load_workspace")).map((a) => a.root)).toContain("/home/e2e/work/beta");
  await expect(page).toHaveTitle(/^beta — dxtutor IDE$/);

  // a walkthrough: its own tab, the first step, «Mark done» moves on
  await page.evaluate(() => (window as unknown as { show: (id: string) => void }).show("welcome"));
  await page.locator('.wel [data-action="welcome:openWalk"][data-on="quality"]').click();
  const walk = page.locator(".wel-walkpage");
  await expect(walk.locator(".wel-step.on")).toContainText("Run tests with the native tools");
  await walk.locator('[data-action="welcome:done"]').click();
  await expect(walk.locator(".wel-step.done")).toHaveCount(1);
  await expect(walk.locator(".wel-step.on")).toContainText("Debug without guessing");
  await page.screenshot({ path: test.info().outputPath("f6-walkthrough.png") });
});

test("Clone Git Repository…: the backend's exact command, approved, audited, then the new folder opens", async ({ page }) => {
  await boot(page);
  await page.locator('.wel [data-action="welcome:clone"]').click();
  const pal = page.locator("#pal-in");
  await expect(pal).toBeVisible();
  await pal.fill("https://github.com/acme/shop.git");
  await pal.press("Enter");
  await expect(pal).toHaveValue("/home/e2e/work"); // next to the most recent folder
  await pal.press("Enter");
  const appr = page.locator("#approval");
  await expect(appr.locator(".appr-cmd")).toHaveText("git -C /home/e2e/work clone -- https://github.com/acme/shop.git shop");
  await expect(appr.locator(".appr-scope")).toContainText("/home/e2e/work/shop");
  await page.screenshot({ path: test.info().outputPath("f6-clone-approval.png") });
  expect(await calls(page, "git_clone")).toEqual([]);
  await appr.locator("#appr-ok").click();
  await expect.poll(async () => (await calls(page, "load_workspace")).map((a) => a.root)).toContain("/home/e2e/work/shop");
  expect(await calls(page, "git_clone")).toEqual([{ url: "https://github.com/acme/shop.git", parentDir: "/home/e2e/work" }]);
  const audit = await calls(page, "audit_record");
  expect(audit.map((a) => (a.entry as { outcome: string }).outcome)).toEqual(["sent", "ok"]);
  expect(audit[0]).toMatchObject({ root: "/home/e2e/work/shop", entry: { feature: "welcome", action: "git.clone", approved: true } });
});

test("«Show welcome page on startup» off: the app starts on an empty editor", async ({ page }) => {
  await page.addInitScript(fakeBackend);
  await page.addInitScript(() => { try { localStorage.setItem("dx2.wel.v1", JSON.stringify({ done: [], opened: [], show: false })); } catch { /* sem storage */ } });
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await expect(page.locator("#st-build")).toBeVisible();
  await expect(page.locator(".wel")).toHaveCount(0);
  await page.evaluate(() => { const c = (window as unknown as { CMD: Array<[string, string, () => void]> }).CMD.find((x) => x[0] === "Help: Welcome"); c![2](); });
  await expect(page.locator(".wel")).toBeVisible();
  await expect(page.locator('.wel [data-action="welcome:toggleShow"]')).not.toBeChecked();
});
