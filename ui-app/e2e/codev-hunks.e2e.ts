/* ═══════════ A2 — Co-Dev writes in the editor, hunk by hunk (docs/v2/RF-CODEV-STREAM.md) ═══════════
   The real app in a real browser, in desktop mode, against a scripted backend: a fake
   `window.__TAURI__` injected before boot answers the IPC commands the desktop boot needs
   (app_info, exec, load_workspace, providers…) and plays one agent turn exactly as
   `codev_agent.rs` emits it — a hunk streamed into the editor, a `hunk_review`, and then
   `hunk_applied` or `hunk_rejected` according to the `codev_agent_review` the UI sends.
   Proves: the hunk is drawn in the editor while it is written; the chat keeps prose (the
   long code block in the reply is not drawn); Accept writes the file, Reject leaves it.
   Texts are matched in both languages: the browser runs the i18n layer (en by default). */
import { test, expect, type Page } from "@playwright/test";

const LIB = "fn count(chars: Vec<char>) -> usize {\n    let mut n = 0;\n    for c in chars {\n        n += 1;\n    }\n    n\n}\n";

/** Runs in the page before any script: the fake desktop backend. */
function fakeBackend(lib: string): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const files: Record<string, string> = { "src/lib.rs": lib };
  const calls: Array<{ cmd: string; args: unknown }> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const agent = (session: string, event: unknown) => emit("codev-agent://event", { session, event });
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let reviewed: ((d: Array<{ hunk: string; accept: boolean; reason?: string }>) => void) | null = null;
  const NEW_LINE = "    while let Some(_c) = chars.iter().next() {\n";

  async function turn(session: string): Promise<void> {
    agent(session, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(session, { kind: "stream", event: { type: "text_delta", index: 0, text: "Troco o ciclo para não mover o vector.\n```rust\nfn a() {\n  b();\n  c();\n}\n```\n" } });
    agent(session, { kind: "hunk_start", hunk: "toolu_1:1", call: "toolu_1", path: "src/lib.rs", op: "replace", range: { start: 3, end: 3 }, base: "ab", old: "    for c in chars {\n" });
    for (const piece of ["    ", "while let Some(_c) ", "= chars.iter()", ".next()"]) {
      agent(session, { kind: "hunk_chunk", hunk: "toolu_1:1", text: piece });
      await later(120);
    }
    agent(session, { kind: "hunk_chunk", hunk: "toolu_1:1", text: " {\n" });
    agent(session, { kind: "hunk_end", hunk: "toolu_1:1", text: NEW_LINE, lines: { added: 1, removed: 1 } });
    agent(session, { kind: "hunk_review", call: "toolu_1", hunks: ["toolu_1:1"], reason: "modo Assistido: aceitas cada alteração no editor" });
    const decisions = await new Promise<Array<{ hunk: string; accept: boolean; reason?: string }>>((r) => (reviewed = r));
    const ok = decisions.some((d) => d.hunk === "toolu_1:1" && d.accept);
    if (ok) {
      files["src/lib.rs"] = files["src/lib.rs"].replace("    for c in chars {\n", NEW_LINE);
      agent(session, { kind: "hunk_applied", hunk: "toolu_1:1", provisional: false, fingerprint: "cd" });
    } else {
      agent(session, { kind: "hunk_rejected", hunk: "toolu_1:1", by: "human", reason: decisions[0]?.reason ?? "recusado" });
    }
    agent(session, { kind: "tool_result", id: "toolu_1", name: "edit", is_error: !ok, content: ok ? "src/lib.rs: applied 1 of 1 change(s) (line 3)" : "src/lib.rs: the human rejected the change" });
    agent(session, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(session, { kind: "stream", event: { type: "text_delta", index: 0, text: ok ? "Feito." : "Fica como estava." } });
    agent(session, { kind: "done", outcome: { type: "done", truncated: false } });
  }

  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", configDir: "/home/e2e/.config/dxtutor", openAtStart: "/proj" };
      case "exec": {
        const program = String(args.program);
        if (program === "whoami") return { code: 0, stdout: "e2e\n", stderr: "" };
        if (program === "hostname") return { code: 0, stdout: "host\n", stderr: "" };
        return { code: 128, stdout: "", stderr: "not a git repository" };
      }
      case "load_workspace":
        return { root: "/proj", name: "proj", files: Object.entries(files).map(([path, content]) => ({ path, content })), skipped: 0, truncated: false };
      case "write_file":
        files[String(args.rel ?? args.path)] = String(args.content ?? "");
        return null;
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "codev_agent_start":
        return "S1";
      case "codev_agent_send":
        void turn(String(args.sessionId));
        return null;
      case "codev_agent_review":
        reviewed?.(args.decisions as Array<{ hunk: string; accept: boolean }>);
        return null;
      case "keys_status":
        return {};
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (event: string, h: Handler) => {
        (listeners[event] ||= []).push(h);
        return () => (listeners[event] = (listeners[event] || []).filter((x) => x !== h));
      },
    },
  };
  w.__fake = { calls, files };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend, LIB);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  // the desktop boot opened the fake folder
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/lib.rs")));
}

async function askCodev(page: Page, text: string): Promise<void> {
  const input = page.locator("#ag-input");
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}

test("a hunk streams into the editor and Accept writes it", async ({ page }) => {
  await boot(page);
  await askCodev(page, "corrige o E0382 em src/lib.rs");

  // while Co-Dev types: the old line struck, the new one growing, labelled
  await expect(page.locator("#ed-hl .l.hk-old")).toHaveCount(1);
  await expect(page.locator("#ed-hl .l.hk-new").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("a2-streaming.png") });

  // waiting for the human: the bar on the hunk and the bar in the chat
  const accept = page.locator('.hk-bar [data-action="hunk-accept"]');
  await expect(accept).toBeVisible();
  // the bar over the editor follows the app's language too
  await expect(accept).toHaveText(/^(Aceitar|Accept)$/);
  expect(await page.evaluate(() => (window as unknown as { LOCALE?: string }).LOCALE === "en")).toBe(
    (await accept.textContent()) === "Accept",
  );
  await expect(page.locator(".hk-gate")).toContainText(/1 (alteração\(ões\) no editor|change\(s\) in the editor)/);
  // the chat keeps prose: the long code block of the reply is not drawn
  await expect(page.locator("#ag-msgs")).toContainText(/O código é aplicado no editor|Code is applied in the editor/);
  await expect(page.locator("#ag-msgs pre")).toHaveCount(0);
  // I1: nothing written before the decision
  expect(await page.evaluate(() => (window as unknown as { __fake: { files: Record<string, string> } }).__fake.files["src/lib.rs"])).toBe(LIB);
  await page.screenshot({ path: test.info().outputPath("a2-review.png") });

  await page.locator('.hk-bar [data-action="hunk-accept"]').click();
  await expect(page.locator(".hk-gate .gdone")).toContainText(/aplicada|applied/);
  await expect(page.locator("#ed-hl .l.hk-new")).toHaveCount(0);
  await expect(page.locator("#ed-ta")).toHaveValue(/while let Some\(_c\)/);
  const sent = await page.evaluate(() => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: { decisions?: unknown } }> } }).__fake.calls.find((c) => c.cmd === "codev_agent_review")?.args.decisions);
  expect(sent).toEqual([{ hunk: "toolu_1:1", accept: true }]);
  await page.screenshot({ path: test.info().outputPath("a2-accepted.png") });
});

test("F3.4 at 1440×900: the line being written, the written block, the margin mark gone on accept; the chat says where", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await askCodev(page, "corrige o E0382 em src/lib.rs");

  // while Co-Dev types: the line being written carries the «Co-Dev» label, the margin marks the block
  await expect(page.locator("#ed-hl .l.hk-writing")).toHaveCount(1);
  await expect(page.locator("#ed-gut .hk-new").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("f34-writing-1440x900.png") });

  // F3.2: the chat says where it writes, with a link to the file; the code block left out has its button
  const writing = page.locator("#ag-msgs .cd-writing");
  await expect(writing).toContainText(/(Writing|A escrever) src\/lib\.rs \d/);
  await expect(page.locator("#ag-msgs .cd-apply")).toBeVisible();

  // the written block, waiting for the decision
  const accept = page.locator('.hk-bar [data-action="hunk-accept"]');
  await expect(accept).toBeVisible();
  await expect(page.locator("#ed-hl .l.hk-writing")).toHaveCount(0);
  await expect(page.locator("#ed-hl .l.hk-new").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("f34-written-1440x900.png") });

  // accepted: the overlay and the margin mark go, the file has the change
  await accept.click();
  await expect(page.locator(".hk-gate .gdone")).toContainText(/aplicada|applied/);
  await expect(page.locator("#ed-gut .hk-new")).toHaveCount(0);
  await expect(page.locator("#ed-gut .hk-old")).toHaveCount(0);
  await expect(page.locator("#ed-hl .l.hk-new")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("f34-accepted-1440x900.png") });

  // the link in the chat opens the file
  await writing.locator(".cd-writing-path").click();
  await expect(page.locator(".tab.active")).toContainText("lib.rs");
});

test("Reject leaves the file as it was", async ({ page }) => {
  await boot(page);
  await askCodev(page, "corrige o E0382 em src/lib.rs");
  await expect(page.locator('.hk-bar [data-action="hunk-reject"]')).toBeVisible();
  await page.locator('.hk-bar [data-action="hunk-reject"]').click();
  await expect(page.locator(".hk-gate .gdone")).toContainText(/rejeitadas|rejected/);
  await expect(page.locator("#ed-hl .l.hk-old")).toHaveCount(0);
  await expect(page.locator("#ed-ta")).toHaveValue(LIB);
  await page.screenshot({ path: test.info().outputPath("a2-rejected.png") });
});

test("RF-E07: Ctrl+Z right after the accepted block puts back exactly the text from before", async ({ page }) => {
  await boot(page);
  await askCodev(page, "corrige o E0382 em src/lib.rs");
  await page.locator('.hk-bar [data-action="hunk-accept"]').click();
  const ta = page.locator("#ed-ta");
  await expect(ta).toHaveValue(/while let Some\(_c\)/);
  await ta.focus();
  await page.keyboard.press("Control+z");
  await expect(ta).toHaveValue(LIB);
  // the autosave takes the undo to the disk too
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fake: { files: Record<string, string> } }).__fake.files["src/lib.rs"])).toBe(LIB);
});

