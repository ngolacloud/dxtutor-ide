/* ═══════════ F7 — the end-to-end acceptance of docs/v2/RF-DELONIX-PLANO.md (the RF's checklist) ═══════════
   The real app in desktop mode against a scripted backend: the project store (with the Definition
   of Ready, the issue prompt and the audit export) and Co-Dev's agent (a turn that answers the
   issue's request with a live hunk). The rules themselves are decided in Rust and tested there
   (tutor-board: Ready, finish, tests; tutor-agent: origin, scope, classifier, conformance,
   edit_lines; src-tauri: gates, budget, audit); this proves the flow a human sees, end to end:
   a story without criteria and scope is not Ready → filled in it is → «View prompt» shows the
   exact text with the architect's rules → «Work on it with Co-Dev» sends that text with the
   issue as its origin → the code appears in the editor with the writing line highlighted and
   no code in the chat → the human accepts the change. */
import { test, expect, type Page } from "@playwright/test";

const API = "pub fn list() -> Vec<u32> {\n    (0..30).collect()\n}\n";
const PROMPT = "# Papel\nÉs o Co-Dev deste projecto.\n\n# Issue PRJ-1 — Paginar a API\n\n# Restrições do arquitecto (obrigatórias)\n(.dxtutor/architecture.toml)\n[libraries]\nforbidden = [\"lodash\"]\n\n# Âmbito permitido\nFicheiros/pastas: src/**.";

function fakeBackend(seed: { api: string; prompt: string }): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const files: Record<string, string> = { "src/api.rs": seed.api };
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const agent = (session: string, event: unknown) => emit("codev-agent://event", { session, event });
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const now = Date.now();
  const P = {
    root: "/proj", keyPrefix: "PRJ", method: "kanban", iterDays: 14, wip: {} as Record<string, number>,
    dor: [] as string[], dod: [] as string[], issues: [] as Array<Record<string, unknown>>, sprints: [], releases: [], retro: [], inbox: [] as Array<Record<string, unknown>>,
  };
  const gwt = (t: string) => /dado|given/i.test(t) && /quando|when/i.test(t) && /então|then/i.test(t);
  /** The store's Definition of Ready (tutor-board readiness), the parts this flow touches. */
  const missing = (i: Record<string, unknown>): string[] => {
    const m: string[] = [];
    const acc = (i.acceptance as Array<{ text: string }>) ?? [];
    if (!acc.length) m.push("critérios de aceitação");
    else if (acc.some((c) => !gwt(c.text))) m.push("critério em Dado/Quando/Então");
    if (!i.storyAs || !i.storyWant || !i.storySo) m.push("Como / Quero / Para");
    if (!((i.scope as string[]) ?? []).length) m.push("âmbito de ficheiros");
    if (!i.ready) m.push("aprovação humana (Ready)");
    return m;
  };
  const snapshot = () => {
    P.issues.forEach((i) => (i.missing = missing(i)));
    return JSON.parse(JSON.stringify(P));
  };
  function apply(op: Record<string, unknown>): unknown {
    const issue = () => P.issues.find((x) => x.key === op.key)!;
    switch (op.op) {
      case "create_issue":
        P.issues.push({ key: "PRJ-1", title: op.title, kind: "story", priority: "medium", points: null, assignee: "", pair: "", epic: "", cos: "standard", blocked: null, rank: 1, state: "todo", sprint: null, ready: false, description: "", branch: null, acceptance: [], dodDone: [], links: [], changeSets: 0, created: now, updated: now, since: now, storyAs: "", storyWant: "", storySo: "", scope: [], deps: [], readyBy: null, attempts: 0, criteriaReport: null, templateVersion: null, budgetUsd: null, spentUsd: 0 });
        return snapshot();
      case "update_issue": {
        const i = issue();
        const map: Record<string, string> = { story_as: "storyAs", story_want: "storyWant", story_so: "storySo", scope: "scope", deps: "deps" };
        for (const [k, v] of Object.entries(op)) if (map[k]) i[map[k]] = v;
        if (op.ready === true) {
          const rest = missing(i).filter((m) => m !== "aprovação humana (Ready)");
          if (rest.length) throw { code: "dor", message: `ainda não está Ready — falta: ${rest.join("; ")}`, overridable: false };
          i.ready = true;
          i.readyBy = "e2e";
        }
        return snapshot();
      }
      case "set_acceptance":
        issue().acceptance = op.items;
        return snapshot();
      default:
        return snapshot();
    }
  }
  let reviewed: ((d: Array<{ hunk: string; accept: boolean }>) => void) | null = null;
  const NEW = "pub fn list(page: usize, size: usize) -> Vec<u32> {\n";
  async function turn(session: string): Promise<void> {
    agent(session, { kind: "stream", event: { type: "message_start", model: "claude-opus-5-5" } });
    agent(session, { kind: "stream", event: { type: "text_delta", index: 0, text: "Plano: src/api.rs 1–3 (fn list).\n```rust\npub fn list() {\n  todo!();\n  x();\n}\n```\n" } });
    agent(session, { kind: "hunk_start", hunk: "t:1", call: "t", path: "src/api.rs", op: "replace", range: { start: 1, end: 1 }, base: "ab", old: "pub fn list() -> Vec<u32> {\n" });
    for (const piece of ["pub fn list(", "page: usize, ", "size: usize)", " -> Vec<u32> {\n"]) {
      agent(session, { kind: "hunk_chunk", hunk: "t:1", text: piece });
      await later(150);
    }
    agent(session, { kind: "hunk_end", hunk: "t:1", text: NEW, lines: { added: 1, removed: 1 } });
    agent(session, { kind: "hunk_review", call: "t", hunks: ["t:1"], reason: "modo Assistido: aceitas cada alteração no editor" });
    const d = await new Promise<Array<{ hunk: string; accept: boolean }>>((r) => (reviewed = r));
    if (d.some((x) => x.accept)) {
      files["src/api.rs"] = files["src/api.rs"].replace("pub fn list() -> Vec<u32> {\n", NEW);
      agent(session, { kind: "hunk_applied", hunk: "t:1", provisional: false, fingerprint: "cd" });
    }
    agent(session, { kind: "tool_result", id: "t", name: "edit_lines", is_error: false, content: "src/api.rs: linhas 1–1 (+1 −1)" });
    agent(session, { kind: "notice", text: "PRJ-1: critérios respondidos e testes verdes — a issue está em Review; o Done é teu." });
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
      case "keys_status":
        return {};
      case "project_load":
        return snapshot();
      case "project_apply":
        return apply(args.op as Record<string, unknown>);
      case "project_issue":
        return { activity: [], changeSets: [], reports: [] };
      case "project_reports":
        return { cycle: [], cycleMedian: null, cycleP85: null, throughput: [], cfd: [], burndown: null, velocity: [] };
      case "project_issue_prompt":
        return { text: seed.prompt, lang: "pt", source: "builtin", version: "tpl-v1", tokens: 123 };
      case "codev_agent_start":
        return "S1";
      case "codev_agent_send":
        void turn(String(args.sessionId));
        return null;
      case "codev_agent_review":
        reviewed?.(args.decisions as Array<{ hunk: string; accept: boolean }>);
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
  w.__fake = { calls, files };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend, { api: API, prompt: PROMPT });
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/api.rs")));
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

async function setField(page: Page, field: string, value: string): Promise<void> {
  const el = page.locator(`.pj-issue [data-action="pj-field"][data-on="${field}"]`);
  await el.fill(value);
  await el.dispatchEvent("change");
}

test("RF acceptance: a story becomes Ready, goes to Co-Dev with the template, and the change is reviewed in the editor", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[title="Project"]').click();
  const add = page.locator('.pj-new [data-action="pj-new"]').first();
  await add.fill("Paginar a API");
  await add.press("Enter");
  await page.locator('.pj-card[data-on="PRJ-1"]').click();
  await expect(page.locator(".pj-issue")).toBeVisible();

  // 1. without criteria and scope the story is not Ready: what is missing, and no Co-Dev
  await expect(page.locator(".pj-missing")).toContainText("critérios de aceitação");
  await expect(page.locator(".pj-missing")).toContainText("âmbito de ficheiros");
  await expect(page.locator('.pj-issue [data-action="pj-work"]')).toBeDisabled();
  await page.locator('.pj-issue [data-action="pj-ready"]').check();
  await expect.poll(async () => (await calls(page, "project_apply")).some((a) => (a.op as { ready?: boolean }).ready === true)).toBe(true);
  await expect(page.locator('.pj-issue [data-action="pj-work"]')).toBeDisabled();

  // 2. the story, a Given/When/Then criterion and the scope → Ready → Co-Dev may work on it
  await setField(page, "story_as", "cliente da API");
  await setField(page, "story_want", "pedir as encomendas por páginas");
  await setField(page, "story_so", "não receber milhares de linhas");
  await setField(page, "scope", "src/**");
  const crit = page.locator('.pj-issue [data-action="pj-crit-add"]');
  await crit.fill("Dado 30 encomendas, quando peço a página 2 com 10, então recebo as 11–20");
  await crit.press("Enter");
  await expect(page.locator(".pj-missing")).toHaveCount(0);
  await page.locator('.pj-issue [data-action="pj-ready"]').check();
  await expect(page.locator('.pj-issue [data-action="pj-work"]')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("f7-ready.png") });

  // 3. «View prompt»: the exact text, with the architect's rules, and its tokens
  await page.locator('.pj-issue [data-action="pj-prompt"]').click();
  await expect(page.locator(".pj-prompt")).toContainText("≈ 123 tokens");
  await expect(page.locator(".pj-prompt-text")).toContainText("Restrições do arquitecto");
  await expect(page.locator(".pj-prompt-text")).toContainText('forbidden = ["lodash"]');

  // 4. «Work on it with Co-Dev» sends that text, with the issue as the request's origin
  await page.locator('.pj-issue [data-action="pj-work"]').click();
  await expect.poll(async () => (await calls(page, "codev_agent_send")).length).toBe(1);
  const send = (await calls(page, "codev_agent_send"))[0];
  expect(send.text).toBe(PROMPT);
  expect(send.origin).toEqual({ kind: "issue", issue: "PRJ-1", scope: ["src/**"], template: "tpl-v1" });

  // 5. the code appears in the editor, the writing line marked; the chat has no code
  await expect(page.locator("#ed-hl .l.hk-new").first()).toBeVisible();
  await expect(page.locator("#ed-hl .l.hk-old")).toHaveCount(1);
  await expect(page.locator("#ag-msgs pre")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("f7-streaming.png") });

  // 6. the human accepts the change; the issue goes to Review (Done stays human)
  await page.locator('.hk-bar [data-action="hunk-accept"]').click();
  await expect.poll(async () => (await calls(page, "codev_agent_review")).length).toBe(1);
  expect((await calls(page, "codev_agent_review"))[0].decisions).toEqual([{ hunk: "t:1", accept: true }]);
  await expect(page.locator("#ag-msgs")).toContainText("a issue está em Review; o Done é teu");
  await page.screenshot({ path: test.info().outputPath("f7-review.png") });
});
