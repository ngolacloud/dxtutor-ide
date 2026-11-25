/* ═══════════ A5 — Project: Kanban, Scrum, XP or Scrum + XP (docs/v2/UI-AUDIT.md, item 5) ═══════════
   The real app in desktop mode against a scripted backend: a fake `window.__TAURI__` answers
   the desktop boot and plays the project store (`project_load/apply/issue/reports`) with the
   rule that matters here — the WIP limit, refused with `{code, overridable}` like the Rust
   store. The rules themselves are tested in Rust (tutor-board); this proves the UI: the
   Project activity, creating issues, moving a card by dragging it, the issue panel, the
   override that asks for a reason and retries with it, and reports that say what they need. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const now = Date.now();
  const P = {
    root: "/proj", keyPrefix: "PRJ", method: "kanban", iterDays: 14, wip: { progress: 1 } as Record<string, number>,
    dor: [] as string[], dod: [] as string[], issues: [] as Array<Record<string, unknown>>, sprints: [], releases: [], retro: [], inbox: [] as Array<Record<string, unknown>>,
  };
  const activity: Record<string, Array<Record<string, unknown>>> = {};
  let seq = 0;
  const log = (key: string, kind: string, from: string | null, to: string | null, note = "") =>
    (activity[key] ||= []).unshift({ at: Date.now(), actor: "e2e", kind, from, to, note });
  const snapshot = () => JSON.parse(JSON.stringify(P));
  const STATES = ["todo", "progress", "review", "accept", "done"];
  function apply(op: Record<string, unknown>): unknown {
    switch (op.op) {
      case "create_issue": {
        const key = `PRJ-${++seq}`;
        P.issues.push({ key, title: op.title, kind: "story", priority: "medium", points: null, assignee: "", pair: "", epic: "", cos: "standard", blocked: null, rank: seq, state: "todo", sprint: null, ready: false, description: "", branch: null, acceptance: [], dodDone: [], links: [], changeSets: 0, created: now, updated: now, since: now });
        log(key, "created", null, "todo");
        return snapshot();
      }
      case "move": {
        const i = P.issues.find((x) => x.key === op.key)!;
        const to = String(op.to);
        const n = P.issues.filter((x) => x.state === to && x.key !== op.key).length;
        const limit = P.wip[to];
        const step = Math.abs(STATES.indexOf(to) - STATES.indexOf(String(i.state))) > 1;
        if (!op.reason && step) throw { code: "step", message: `${op.key} só anda um passo de cada vez`, overridable: true };
        if (!op.reason && limit !== undefined && n >= limit) throw { code: "wip", message: `o limite de WIP de «${to}» é ${limit} e já há ${n}`, overridable: true };
        log(String(op.key), op.reason ? "override" : "moved", String(i.state), to, op.reason ? `excepção (wip): ${op.reason}` : "");
        i.state = to;
        i.since = Date.now();
        return snapshot();
      }
      case "propose":
        P.inbox.push({ id: P.inbox.length + 1, title: op.title, kind: op.kind ?? "story", points: op.points ?? null, source: op.source, detail: op.detail ?? "", created: now });
        return snapshot();
      default:
        return snapshot();
    }
  }
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "not a git repository" } : { code: 0, stdout: "e2e\n", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", files: [{ path: "README.md", content: "# proj\n" }], skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "project_load":
        return snapshot();
      case "project_apply":
        return apply(args.op as Record<string, unknown>);
      case "project_issue":
        // RF-B08: PRJ-2 had Co-Dev turns and an accepted block
        return String(args.key) === "PRJ-2"
          ? {
              activity: activity["PRJ-2"] ?? [],
              changeSets: [{ session: "", call: "c1", hunk: "c1:1", path: "src/iter.rs", start: 12, end: 14, added: 3, removed: 1, decidedBy: "human", decidedAt: 1 }],
              usage: { turns: 2, sessions: 1, models: ["claude-sonnet-5-5"], tokensIn: 5400, tokensOut: 900, costUsd: 0.12, unpriced: 0 },
            }
          : { activity: activity[String(args.key)] ?? [], changeSets: [] };
      case "project_reports":
        return { cycle: [], cycleMedian: null, cycleP85: null, throughput: [], cfd: [], burndown: null, velocity: [] };
      // RF-A05: the repository against the architect's rules — one violation in PRJ-2's file
      case "arch_conformance":
        return [{ rule: "library:moment", message: "forbidden library: moment", path: "src/iter.rs", line: 13 }];
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
        return () => undefined;
      },
    },
  };
  w.__fake = { calls };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("README.md")));
}

const sent = (page: Page, op: string) =>
  page.evaluate((op) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: { op?: { op?: string } } }> } }).__fake.calls.filter((c) => c.cmd === "project_apply" && c.args.op?.op === op).map((c) => c.args.op), op);

test("the Project activity: create, drag a card one step, the issue panel and the WIP override", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[title="Project"]').click();
  await expect(page.locator(".pj-empty")).toContainText(/No issues yet|Ainda não há issues/);

  const add = page.locator('.pj-new [data-action="pj-new"]').first();
  await add.fill("Tokenize numbers");
  await add.press("Enter");
  await expect(page.locator(".pj-card")).toHaveCount(1);
  await add.fill("Fix moved iterator");
  await add.press("Enter");
  await expect(page.locator(".pj-card")).toHaveCount(2);
  const heads = await page.locator(".pj-colhead span:first-child").allTextContents();
  expect(heads.length).toBe(5);

  // drag the first card to the next column (one step)
  const cols = page.locator(".pj-cols:not(.pj-heads) .pj-col");
  await page.locator('.pj-card[data-on="PRJ-1"]').dragTo(cols.nth(1));
  await expect(cols.nth(1).locator('.pj-card[data-on="PRJ-1"]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("a5-board.png") });

  // the second one hits the WIP limit (1): the store refuses, the UI asks for a reason and retries
  page.once("dialog", (d) => void d.accept("production is down"));
  await page.locator('.pj-card[data-on="PRJ-2"]').dragTo(cols.nth(1));
  await expect(cols.nth(1).locator(".pj-card")).toHaveCount(2);
  await expect(page.locator(".pj-colhead.over")).toHaveCount(1);
  const moves = await sent(page, "move");
  expect(moves.at(-2)).toEqual({ op: "move", key: "PRJ-2", to: "progress" });
  expect(moves.at(-1)).toEqual({ op: "move", key: "PRJ-2", to: "progress", reason: "production is down" });

  // the issue panel shows the override in the activity
  await page.locator('.pj-card[data-on="PRJ-2"]').click();
  await expect(page.locator(".pj-issue")).toBeVisible();
  await expect(page.locator(".pj-issue .pj-act").first()).toContainText("production is down");
  // RF-B08: what Co-Dev used on it, and its change set opens the diff
  await expect(page.locator(".pj-issue .pj-usage")).toContainText("2 turns in 1 session");
  await expect(page.locator(".pj-issue .pj-usage")).toContainText("5.4k in / 900 out tokens · $0.12");
  // RF-A05: the rules broken in the files Co-Dev changed for it, and Problems filtered by them
  await expect(page.locator('.pj-issue [data-action="pj-drift-open"]')).toContainText("src/iter.rs:13 forbidden library: moment");
  await page.screenshot({ path: test.info().outputPath("a5-issue.png") });
  await page.locator('.pj-issue [data-action="pj-drift-problems"]').click();
  await expect(page.locator('.ptab.on[data-pt="problems"]')).toHaveCount(1);
  await expect(page.locator(".pt-scope")).toContainText("Issue PRJ-2");
  await page.locator('.pj-issue [data-action="pj-diff"][data-on="src/iter.rs"]').click();
  await expect(page.locator(".tab.active")).toContainText("iter.rs");
});

test("reports without history say what they need; Studio proposals wait in the inbox", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[title="Project"]').click();
  await page.locator('.pj-tab[data-on="reports"]').click();
  await expect(page.locator(".pj-reports")).toContainText(/Needs at least two days of history|Precisa de pelo menos dois dias/);
  await expect(page.locator(".pj-reports svg")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("a5-reports.png") });

  // a proposal through the inbox registry (as the Studio's «Generate backlog» sends them)
  await page.evaluate(async () => {
    const w = window as unknown as { __TAURI__: { core: { invoke: (c: string, a: unknown) => Promise<unknown> } } };
    await w.__TAURI__.core.invoke("project_apply", { root: "/proj", op: { op: "propose", title: "API gateway", kind: "story", points: 5, source: "studio" } });
  });
  await page.locator('.pj-tab[data-on="board"]').click();
  await page.locator('.pj-tab[data-on="backlog"]').click();
  await page.locator('.pj-tab[data-on="board"]').click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: "/proj" } })));
  await expect(page.locator('.pj-tab[data-on="backlog"] .pj-count')).toHaveText("1");
  await page.locator('.pj-tab[data-on="backlog"]').click();
  await expect(page.locator(".pj-card-box.accent")).toContainText("API gateway");
});
