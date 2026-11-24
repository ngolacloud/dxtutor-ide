/* ═══════════ A4 — Source Control beyond the basics (docs/v2/UI-AUDIT.md item 9) ═══════════
   The real app in desktop mode against a scripted backend that answers like a small git
   repository (`exec git …` for the graph, and the A4 commands `git_blame`, `git_history`,
   `git_show_path`, `git_stash`, `git_worktree`, `git_rebase` as `tutor_eval::gitx` does).
   Proves: the caret line's blame at the end of the line and in the status bar, a click opens
   the line's history (commits, diff, who knows the code, blame by age); the pane's stashes and
   worktrees; «Stash changes» asks the backend; and the interactive rebase runs only the plan
   the human edited and approved. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const now = Math.floor(Date.now() / 1000);
  const H = { a: "a".repeat(40), b: "b".repeat(40), c: "c".repeat(40), d: "d".repeat(40) };
  const commits = [
    { hash: H.d, short: "ddddddd", subject: "fix the eof token", author: "Rui", time: now - 3600, parents: 1 },
    { hash: H.c, short: "ccccccc", subject: "lex digits", author: "Ana", time: now - 86400 * 3, parents: 1 },
    { hash: H.b, short: "bbbbbbb", subject: "add the lexer", author: "Ana", time: now - 86400 * 20, parents: 1 },
  ];
  const plan = { onto: "main", branch: "develop", dirty: false, published: false, commits: [commits[1], commits[0]] };
  const git = (args: string[]): { code: number; stdout: string; stderr: string } => {
    const a = args.join(" ");
    if (a === "rev-parse --is-inside-work-tree") return { code: 0, stdout: "true\n", stderr: "" };
    if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "develop\n", stderr: "" };
    if (args[0] === "log") return { code: 0, stdout: [H.d, H.c, H.b].map((h, i, all) => `${h}\x1f${all[i + 1] || ""}\x1f${commits[i].author}\x1f${commits[i].time}\x1f${commits[i].subject}\x1e`).join(""), stderr: "" };
    if (args[0] === "for-each-ref" && a.includes("refs/heads")) return { code: 0, stdout: `develop\x1f${H.d}\nmain\x1f${H.b}\n`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? git((args.args as string[]) || []) : { code: 0, stdout: "e2e\n", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", files: [{ path: "src/lib.rs", content: "pub fn lex(s: &str) -> Vec<Tok> {\n    let mut out = vec![];\n    for c in s.chars() { out.push(tok(c)); }\n    out\n}\n" }], skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
      case "list_tests":
        return [];
      case "git_blame":
        return {
          path: "src/lib.rs",
          lines: [
            { line: 1, commit: "bbbbbbbb", author: "Ana", time: commits[2].time, summary: "add the lexer" },
            { line: 2, commit: "bbbbbbbb", author: "Ana", time: commits[2].time, summary: "add the lexer" },
            { line: 3, commit: "cccccccc", author: "Ana", time: commits[1].time, summary: "lex digits" },
            { line: 4, commit: "dddddddd", author: "Rui", time: commits[0].time, summary: "fix the eof token" },
            { line: 5, commit: "bbbbbbbb", author: "Ana", time: commits[2].time, summary: "add the lexer" },
          ],
          authors: [{ author: "Ana", lines: 4, share: 80, last: commits[1].time }, { author: "Rui", lines: 1, share: 20, last: commits[0].time }],
          uncommitted: 0,
        };
      case "git_history":
        return args.start ? [commits[0]] : commits;
      case "git_show_path":
        return `commit ${args.hash}\nAuthor: Rui <rui@example.com>\n\n    fix the eof token\n\ndiff --git a/src/lib.rs b/src/lib.rs\n@@ -3,2 +3,2 @@\n-    for c in s.chars() { out.push(tok(c)) }\n+    for c in s.chars() { out.push(tok(c)); }\n`;
      case "git_stash":
        return { stashes: [{ index: 0, message: "On develop: lexer experiment", time: now - 7200 }], output: "" };
      case "git_worktree":
        return [{ path: "/proj", head: "dddddddd", branch: "develop", locked: false, prunable: false, current: true }, { path: "/proj-feature-parser", head: "eeeeeeee", branch: "feature/parser", locked: false, prunable: false, current: false }];
      case "git_rebase":
        return (args.op as { op: string }).op === "run" ? { ...plan, commits: [commits[1]] } : plan;
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
  await page.waitForFunction(() => (window as unknown as { DXR?: { git?: boolean } }).DXR?.git === true);
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

test("blame on the caret line, the line's history, stashes, worktrees and the interactive rebase", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as unknown as { openPath: (p: string, l?: number) => void; ROOT: string }).openPath((window as unknown as { ROOT: string }).ROOT + "src/lib.rs", 4));
  const ta = page.locator("#ed-ta");
  await ta.click();
  await page.evaluate(() => { const t = document.getElementById("ed-ta") as HTMLTextAreaElement; const i = t.value.split("\n").slice(0, 3).join("\n").length + 2; t.setSelectionRange(i, i); t.dispatchEvent(new KeyboardEvent("keyup")); });
  // the caret line's blame: at the end of the line and in the status bar
  await expect(page.locator("#ed-hl .bl-inline")).toContainText("Rui");
  await expect(page.locator("#ed-hl .bl-inline")).toContainText("fix the eof token");
  await expect(page.locator("#st-blame")).toContainText("Rui");
  await page.screenshot({ path: test.info().outputPath("a4-blame.png") });

  // a click opens that line's history
  await page.locator("#st-blame").click();
  const hist = page.locator(".gx").filter({ has: page.locator(".gx-commit") }).first();
  await expect(hist.locator(".gx-commit")).toHaveCount(1);
  expect((await calls(page, "git_history")).at(-1)).toMatchObject({ root: "/proj", path: "src/lib.rs", start: 4, end: 4 });
  await expect(hist.locator(".gx-diff")).toContainText("out.push(tok(c));");
  await hist.locator('[data-action="gx-history-file"]').click();
  await expect(page.locator(".gx-commit")).toHaveCount(3);
  await expect(page.locator(".gx-card").first()).toContainText("Who knows this code");
  await expect(page.locator(".gx-blk")).toHaveCount(4);
  await page.screenshot({ path: test.info().outputPath("a4-history.png") });

  // the pane: stashes, worktrees, more git
  await page.locator('#activity .act[data-pane="scm"]').first().click();
  const pane = page.locator("#pane-scm");
  await expect(pane).toContainText("lexer experiment");
  await expect(pane).toContainText("feature/parser");
  await page.screenshot({ path: test.info().outputPath("a4-pane.png") });
  await pane.locator('[data-action="gx-stash-push"]').click();
  await expect(page.locator("#pal-in")).toHaveValue("WIP on develop");
  await page.locator("#pal-in").press("Enter");
  await expect.poll(async () => (await calls(page, "git_stash")).map((a) => a.op).find((o) => (o as { op: string }).op === "push")).toEqual({ op: "push", message: "WIP on develop", untracked: false });

  // interactive rebase: edit the plan, approve the exact command
  await pane.locator('[data-action="gx-rebase"]').click();
  await page.locator("#pal-list .pi", { hasText: "main" }).first().click();
  const rb = page.locator(".gx").filter({ has: page.locator(".gx-steps") }).first();
  await expect(rb.locator(".gx-step")).toHaveCount(2);
  await rb.locator('select[data-action="gx-rb-action"][data-on="1"]').selectOption("fixup");
  await expect(rb.locator(".gx-cmd")).toContainText("fixup dddddddd");
  await page.screenshot({ path: test.info().outputPath("a4-rebase.png") });
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.accept(); });
  await rb.locator('[data-action="gx-rb-run"]').click();
  await expect.poll(async () => (await calls(page, "git_rebase")).map((a) => a.op).find((o) => (o as { op: string }).op === "run")).toEqual({ op: "run", onto: "main", steps: [{ action: "pick", hash: "c".repeat(40) }, { action: "fixup", hash: "d".repeat(40) }] });
  expect(asked).toContain("git rebase -i main");
});
