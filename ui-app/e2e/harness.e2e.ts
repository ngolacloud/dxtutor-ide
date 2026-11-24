/* ═══════════ A3 — the Co-Dev harness: the «Co-Dev run» tab (docs/v2/UI-AUDIT.md item 11) ═══════════
   The real app in desktop mode against a scripted backend that plays one agent turn as
   `codev_agent.rs` emits it: an approved plan with steps and files, a task list, a reviewer
   sub-agent, the usage, a checkpoint and the turn's report. Proves the tab draws them, that
   «Rewind to here» asks the backend for files AND conversation, that the permission rules
   are saved through the backend, and that the report also lands in the chat. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const agent = (session: string, event: unknown) => emit("codev-agent://event", { session, event });
  let rules = { allow: ["edit"], deny: [] as string[] };
  let cps: Array<Record<string, unknown>> = [];
  function turn(s: string): void {
    agent(s, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(s, { kind: "tool_start", id: "p1", name: "exit_plan", input: { plan: "**Goal:** stop moving the iterator.", steps: [{ text: "Borrow `chars` in the loop", files: [{ path: "src/lib.rs", start: 3, end: 3 }] }, { text: "Run the tests" }] } });
    agent(s, { kind: "tool_start", id: "t1", name: "todo_write", input: { todos: [{ content: "Borrow the iterator", status: "completed" }, { content: "Run the tests", status: "in_progress" }] } });
    agent(s, { kind: "tool_start", id: "a1", name: "task", input: { description: "review the change", role: "reviewer", prompt: "x" } });
    agent(s, { kind: "tool_result", id: "a1", name: "task", is_error: false, content: "no findings" });
    agent(s, { kind: "checkpoint", id: 1, label: "corrige o E0382" });
    cps = [{ id: 1, label: "corrige o E0382", created: Math.floor(Date.now() / 1000), commit: "abc", conversation: true }];
    agent(s, { kind: "usage", request: { input_tokens: 24000, output_tokens: 300, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 }, turn: { input_tokens: 24000, output_tokens: 900, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 } });
    agent(s, { kind: "stream", event: { type: "text_delta", index: 0, text: "Feito." } });
    agent(s, { kind: "report", title: "corrige o E0382", markdown: "**Files changed:**\n- `src/lib.rs` +1 −1 (1 change(s))\n**Commands:**\n- ✓ `cargo test`" });
    agent(s, { kind: "done", outcome: { type: "done", truncated: false } });
  }
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "e2e\n", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", files: [{ path: "src/lib.rs", content: "fn count(chars: Vec<char>) -> usize {\n    let mut n = 0;\n    for c in chars {\n        n += 1;\n    }\n    n\n}\n" }], skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "codev_agent_start":
        return "S1";
      case "codev_agent_send":
        setTimeout(() => turn(String(args.sessionId)), 50);
        return null;
      case "codev_agent_checkpoints":
        return cps;
      case "codev_agent_rewind":
        return "ficheiros repostos para o checkpoint 1; a conversa voltou a antes desse pedido";
      case "codev_agent_permissions":
        return { project: rules, user: { allow: [], deny: [] }, projectFile: "/proj/.dxtutor/permissions.json", userFile: "/home/e2e/.config/dxtutor/permissions.json" };
      case "codev_agent_save_permissions":
        rules = args.rules as typeof rules;
        return null;
      case "codev_agent_extensions":
        return { commands: [{ name: "rever", description: "revê um ficheiro" }], skills: [], hooks: { present: true, trusted: false }, mcp: { present: false, trusted: false }, mcpServers: ["github"] };
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

test("the «Co-Dev run» tab: plan with files, tasks, reviewer, context, report, rewind and rules", async ({ page }) => {
  await boot(page);
  const input = page.locator("#ag-input");
  await input.click();
  await input.fill("corrige o E0382 em src/lib.rs");
  await input.press("Enter");
  // the report also lands in the chat, collapsed
  await expect(page.locator("#ag-msgs .agent-report summary")).toContainText(/Turn report|Relatório do turno/);

  // open the tab from the Co-Dev menu
  await page.locator("#menubar .menu-top", { hasText: "Co-Dev" }).first().click();
  await page.locator(".menu-pop .mi", { hasText: /Run, checkpoints and permissions|Execução, checkpoints e permissões/ }).first().click();
  const tab = page.locator(".hx-run");
  await expect(tab).toBeVisible();
  await expect(tab.locator('[data-action="hx-open"]')).toHaveText("src/lib.rs:3");
  await expect(tab.locator(".hx-todos li")).toHaveCount(2);
  await expect(tab.locator(".hx-role.r-reviewer")).toHaveText("reviewer");
  await expect(tab).toContainText("30,000 tokens in context of 200,000 (15%)");
  const [bar, fill] = await Promise.all([tab.locator(".hx-gauge").boundingBox(), tab.locator(".hx-gauge-fill").boundingBox()]);
  expect(Math.round((fill!.width / bar!.width) * 100)).toBeGreaterThanOrEqual(13);
  expect(fill!.height).toBeGreaterThan(3); // the fill is actually visible
  await expect(tab.locator(".hx-report")).toContainText("src/lib.rs");
  await expect(tab.locator('textarea[name="allow"]')).toHaveValue("edit");
  await page.screenshot({ path: test.info().outputPath("a3-run.png") });

  // «Rewind to here»: files and conversation, through the backend
  page.once("dialog", (d) => void d.accept());
  await tab.locator('[data-action="hx-rewind"][data-on="1|1"]').click();
  await expect.poll(async () => (await calls(page, "codev_agent_rewind")).at(-1)).toEqual({ sessionId: "S1", checkpoint: 1, conversation: true });

  // the rules are saved through the backend
  await tab.locator('textarea[name="allow"]').fill("edit\nbash:cargo test");
  await tab.locator('textarea[name="deny"]').fill("bash:git push");
  await tab.locator('[data-action="hx-perm-save"]').click();
  await expect.poll(async () => (await calls(page, "codev_agent_save_permissions")).at(-1)).toEqual({ root: "/proj", rules: { allow: ["edit", "bash:cargo test"], deny: ["bash:git push"] } });
});
