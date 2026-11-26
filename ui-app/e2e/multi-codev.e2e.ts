/* ═══════════ Multi Co-Dev, phase 2 — several Co-Dev sessions, the scope check and the functional approval ═══════════
   The real app in desktop mode against a scripted backend: the project store with three Ready issues
   (DX-1 on `src/a/**`, DX-2 on `src/b/**`, DX-3 on `src/**`) and Co-Dev's agent, whose turns write a
   live hunk in the issue's folder and wait for the human's decision. The scope check
   (`project_scope_overlap`) answers like the Rust rule: DX-3 overlaps whatever runs. Proves: a second
   issue opens a second session (the first keeps running), the «Co-Devs» strip switches the chat and
   the hunks in the editor, a decision goes to its own session, an overlapping issue is refused with the
   files, and the functional approval is recorded with its note. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const files: Record<string, string> = { "src/a/cart.rs": "pub fn cart() {}\n", "src/b/pay.rs": "pub fn pay() {}\n" };
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const agent = (session: string, event: unknown) => emit("codev-agent://event", { session, event });
  const now = Date.now();
  const issue = (key: string, title: string, scope: string) => ({
    key, title, kind: "story", priority: "medium", points: 2, assignee: "e2e", pair: "", epic: "", cos: "standard", blocked: null, rank: Number(key.slice(3)), state: "todo", sprint: null, ready: true, description: "", branch: null,
    acceptance: [{ text: `Given ${title} When it runs Then it works`, done: false }], dodDone: [], links: [], changeSets: 0, created: now, updated: now, since: now,
    storyAs: "a", storyWant: "b", storySo: "c", scope: [scope], deps: [], readyBy: "e2e", attempts: 0, criteriaReport: null, templateVersion: null, missing: [], budgetUsd: null, spentUsd: 0, functional: null as unknown,
  });
  const P = {
    root: "/proj", keyPrefix: "DX", method: "kanban", iterDays: 14, wip: {}, dor: [], dod: [], checks: [],
    issues: [issue("DX-1", "Cart", "src/a/**"), issue("DX-2", "Pay", "src/b/**"), issue("DX-3", "Everything", "src/**")], sprints: [], releases: [], retro: [], inbox: [],
  };
  const snapshot = () => JSON.parse(JSON.stringify(P));
  const fileOf: Record<string, string> = { "DX-1": "src/a/cart.rs", "DX-2": "src/b/pay.rs" };
  let sessions = 0;
  const issueOf: Record<string, string> = {};
  function turn(session: string, text: string): void {
    const key = /Issue (DX-\d)/.exec(text)?.[1] ?? "";
    issueOf[session] = key;
    const path = fileOf[key];
    agent(session, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(session, { kind: "stream", event: { type: "text_delta", index: 0, text: `Working on ${key} in ${path}.` } });
    if (!path) return;
    const old = files[path];
    agent(session, { kind: "hunk_start", hunk: `${key}:1`, call: `call-${key}`, path, op: "replace", range: { start: 1, end: 1 }, base: "ab", old });
    agent(session, { kind: "hunk_chunk", hunk: `${key}:1`, text: old.replace("{}", "{ /* done */ }") });
    agent(session, { kind: "hunk_end", hunk: `${key}:1`, text: old.replace("{}", "{ /* done */ }"), lines: { added: 1, removed: 1 } });
    agent(session, { kind: "hunk_review", call: `call-${key}`, hunks: [`${key}:1`], reason: "modo Assistido: aceitas cada alteração no editor" });
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
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "keys_status":
        return {};
      case "project_load":
        return snapshot();
      case "project_apply": {
        const op = args.op as Record<string, unknown>;
        const i = P.issues.find((x) => x.key === op.key);
        if (op.op === "approve_functional" && i) i.functional = { by: "e2e", at: Date.now(), note: op.note ?? "" };
        return snapshot();
      }
      case "project_issue":
        return { activity: [], changeSets: [], reports: [] };
      case "project_reports":
        return { cycle: [], cycleMedian: null, cycleP85: null, throughput: [], cfd: [], burndown: null, velocity: [] };
      case "project_issue_prompt":
        return { text: `# Issue ${String(args.key)}\nDo it.`, lang: "en", source: "builtin", version: "tpl-v1", tokens: 12 };
      // the Rust rule, scripted: DX-3 (src/**) overlaps whatever runs
      case "project_scope_overlap": {
        const key = String(args.key);
        const running = args.running as string[];
        return {
          overlaps: key === "DX-3" ? running.map((b) => ({ a: key, b, paths: [fileOf[b]], total: 1, globs: [["src/**", P.issues.find((x) => x.key === b)!.scope[0]]] })) : [],
          files: 2,
        };
      }
      case "codev_agent_start":
        return `S${++sessions}`;
      case "codev_agent_send":
        setTimeout(() => turn(String(args.sessionId), String(args.text)), 30);
        return null;
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
  w.__fake = { calls };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/a/cart.rs")));
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

async function work(page: Page, key: string): Promise<void> {
  // the hunk opened its file in the editor: back to the Project tab
  await page.locator('#activity .act[title="Project"]').click();
  await page.locator(`.pj-card[data-on="${key}"]`).click();
  await expect(page.locator(".pj-issue")).toContainText(key);
  await page.locator('.pj-issue [data-action="pj-work"]').click();
}

test("two Co-Devs at once: a session per issue, the strip switches the chat and the hunks, an overlap is refused", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[title="Project"]').click();

  // 1. DX-1 goes to Co-Dev: one session, no strip (as before)
  await work(page, "DX-1");
  await expect(page.locator("#ag-msgs")).toContainText("Working on DX-1");
  await expect(page.locator("#ag-codevs")).toHaveCount(0);
  await expect(page.locator(".hk-bar [data-action='hunk-accept']")).toHaveCount(1);

  // 2. DX-2: checked against DX-1, no overlap → a second session; DX-1 keeps running
  await work(page, "DX-2");
  await expect.poll(async () => (await calls(page, "project_scope_overlap")).length).toBe(1);
  expect((await calls(page, "project_scope_overlap"))[0]).toEqual({ root: "/proj", key: "DX-2", running: ["DX-1"] });
  await expect(page.locator("#ag-msgs")).toContainText("Working on DX-2");
  await expect(page.locator("#ag-msgs")).not.toContainText("Working on DX-1");
  await expect(page.locator("#ag-codevs .cdv-card")).toHaveCount(2);
  await expect(page.locator("#ag-codevs .cdv-card.sel")).toContainText("Co-Dev · DX-2");
  // DX-1 waits for the human's decision on its hunk, in the background
  await expect(page.locator("#ag-codevs .cdv-card", { hasText: "DX-1" })).toHaveClass(/st-decision/);
  expect(await calls(page, "codev_agent_close")).toEqual([]);
  // the editor shows DX-2's hunk only
  await expect(page.locator(".tab.active")).toContainText("pay.rs");
  await expect(page.locator(".hk-bar [data-action='hunk-accept']")).toHaveCount(1);
  await expect(page.locator(".hk-bar [data-action='hunk-accept']")).toHaveAttribute("data-on", "DX-2:1");
  await page.screenshot({ path: test.info().outputPath("multi-codev-strip.png") });

  // 3. the strip shows DX-1's chat and its hunk; the decision goes to DX-1's session
  await page.locator("#ag-codevs .cdv-card", { hasText: "DX-1" }).locator(".cdv-pick").click();
  await expect(page.locator("#ag-msgs")).toContainText("Working on DX-1");
  await expect(page.locator("#ag-msgs")).not.toContainText("Working on DX-2");
  await expect(page.locator(".tab.active")).toContainText("cart.rs");
  await page.locator(".hk-bar [data-action='hunk-accept'][data-on='DX-1:1']").click();
  await expect.poll(async () => (await calls(page, "codev_agent_review")).length).toBe(1);
  expect((await calls(page, "codev_agent_review"))[0]).toMatchObject({ sessionId: "S1", call: "call-DX-1", decisions: [{ hunk: "DX-1:1", accept: true }] });

  // 4. DX-3 (src/**) overlaps both: refused with the files, no third session
  page.once("dialog", (d) => {
    expect(d.message()).toContain("src/a/cart.rs");
    void d.dismiss();
  });
  await work(page, "DX-3");
  await expect(page.locator("#toast")).toContainText(/DX-3/);
  expect((await calls(page, "codev_agent_start")).length).toBe(2);
  await expect(page.locator("#ag-codevs .cdv-card")).toHaveCount(2);

  // 5. closing DX-2's Co-Dev ends its session; the strip goes with one session left
  await page.locator("#ag-codevs .cdv-card", { hasText: "DX-2" }).locator(".cdv-x").click();
  await expect.poll(async () => (await calls(page, "codev_agent_close")).map((a) => a.sessionId)).toEqual(["S2"]);
  await expect(page.locator("#ag-codevs")).toHaveCount(0);
});

test("the functional approval is recorded on the issue with its note", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[title="Project"]').click();
  await page.locator('.pj-card[data-on="DX-1"]').click();
  page.once("dialog", (d) => void d.accept("tried it on staging"));
  await page.locator('.pj-issue [data-action="pj-functional-approve"]').click();
  await expect.poll(async () => (await calls(page, "project_apply")).map((a) => a.op)).toContainEqual({ op: "approve_functional", key: "DX-1", note: "tried it on staging" });
  await expect(page.locator(".pj-issue .pj-functional")).toContainText("tried it on staging");
  await expect(page.locator('.pj-issue [data-action="pj-functional-revoke"]')).toBeVisible();
});
