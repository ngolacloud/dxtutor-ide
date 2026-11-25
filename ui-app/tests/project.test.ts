import { describe, expect, it, vi } from "vitest";
import { boardIssues, branchName, doneProgress, keyIn, lanes, summary, viewsFor, wipOf } from "../src/features/project/domain/board";
import { parseError, parseProject } from "../src/features/project/domain/types";
import { makeProjectService } from "../src/features/project/application/project-service";
import type { ProjectDeps } from "../src/features/project/application/ports";
import { renderProject } from "../src/features/project/ui/view";

/* Project (docs/v2/UI-AUDIT.md item 5, phase A5): the store's snapshot as the UI reads it,
   the board selectors, the use case (rules refused by the store may be overridden with a
   reason) and the markup. The rules themselves are tested in Rust (tutor-board). */

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;

const raw = (over: Record<string, unknown> = {}) => ({
  root: "/proj",
  keyPrefix: "PRJ",
  method: "scrumxp",
  iterDays: 14,
  wip: { progress: 1, review: 2 },
  dor: ["Criteria written"],
  dod: ["Code reviewed", "Tests green"],
  issues: [
    { key: "PRJ-1", title: "Tokenize numbers", kind: "story", priority: "high", points: 3, assignee: "Ana", pair: "João", epic: "Lexer", cos: "standard", blocked: null, rank: 0, state: "progress", sprint: "S1", ready: true, description: "", branch: null, acceptance: [{ text: "123 is one token", done: true }], dodDone: [true, false], links: [{ kind: "commit", ref: "abc1234", title: "PRJ-1 tokens", at: NOW }], changeSets: 2, created: NOW - 3 * DAY, updated: NOW, since: NOW - 2 * DAY },
    { key: "PRJ-2", title: "Fix moved iterator", kind: "bug", priority: "medium", points: 2, assignee: "Walter", pair: "", epic: "Lexer", cos: "expedite", blocked: "waiting for review", rank: 1, state: "progress", sprint: "S1", ready: true, description: "", branch: null, acceptance: [], dodDone: [], links: [], changeSets: 0, created: NOW - DAY, updated: NOW, since: NOW - DAY },
    { key: "PRJ-3", title: "Invite members", kind: "story", priority: "low", points: 5, assignee: "", pair: "", epic: "", cos: "standard", blocked: null, rank: 2, state: "todo", sprint: null, ready: false, description: "", branch: null, acceptance: [], dodDone: [], links: [], changeSets: 0, created: NOW, updated: NOW, since: NOW },
  ],
  sprints: [{ id: "S1", name: "Sprint 1", goal: "The lexer compiles", start: NOW - 7 * DAY, end: NOW + 7 * DAY, state: "active", capacity: 10 }],
  releases: [],
  retro: [],
  inbox: [{ id: 4, title: "API gateway", kind: "story", points: 5, source: "studio", detail: "", created: NOW }],
  ...over,
});

describe("the snapshot and the board selectors", () => {
  const p = parseProject(raw())!;

  it("parses the store's snapshot and refuses other shapes", () => {
    expect(p.issues).toHaveLength(3);
    expect(p.issues[0].links[0].ref).toBe("abc1234");
    expect(p.wip).toEqual({ progress: 1, review: 2 });
    expect(parseProject({ nope: 1 })).toBeNull();
    expect(parseError({ code: "wip", message: "limit", overridable: true })).toEqual({ code: "wip", message: "limit", overridable: true });
    expect(parseError(new Error("boom")).code).toBe("db");
  });

  it("shows the active sprint's issues, in swimlanes, with filters", () => {
    const f = { q: "", quick: [] as Array<"mine" | "bugs" | "blocked">, me: "Ana" };
    expect(boardIssues(p, f).map((i) => i.key)).toEqual(["PRJ-1", "PRJ-2"]);
    expect(boardIssues(p, { ...f, quick: ["mine"] }).map((i) => i.key)).toEqual(["PRJ-1"]);
    expect(boardIssues(p, { ...f, quick: ["blocked"] }).map((i) => i.key)).toEqual(["PRJ-2"]);
    expect(boardIssues(p, { ...f, q: "iterator" }).map((i) => i.key)).toEqual(["PRJ-2"]);
    const kanban = parseProject(raw({ method: "kanban" }))!;
    expect(boardIssues(kanban, f)).toHaveLength(3);
    const ls = lanes(boardIssues(kanban, f), "epic");
    expect(ls.map((l) => [l.name, l.count])).toEqual([["Lexer", 2], ["", 1]]);
    expect(ls[0].columns.progress.map((i) => i.key)).toEqual(["PRJ-1", "PRJ-2"]);
  });

  it("computes WIP, the sprint summary and DoD progress", () => {
    expect(wipOf(p, p.issues, "progress")).toEqual({ count: 2, limit: 1, over: true });
    expect(wipOf(p, p.issues, "accept")).toEqual({ count: 0, limit: null, over: false });
    expect(summary(p, NOW)).toEqual({ title: "Sprint 1", goal: "The lexer compiles", daysLeft: 7, points: 5, donePoints: 0 });
    expect(summary(parseProject(raw({ method: "kanban" }))!, NOW).title).toBe("Continuous flow");
    expect(doneProgress(p.issues[0], p)).toEqual({ done: 2, total: 3 });
  });

  it("names branches and finds keys; each method has its views", () => {
    expect(branchName(p.issues[0])).toBe("feature/prj-1-tokenize-numbers");
    expect(branchName(p.issues[1])).toBe("fix/prj-2-fix-moved-iterator");
    expect(keyIn("feature/prj-12-x", "PRJ")).toBe("PRJ-12");
    expect(keyIn("XPRJ-1", "PRJ")).toBeNull();
    expect(viewsFor("kanban")).toEqual(["board", "backlog", "releases", "reports", "settings"]);
    expect(viewsFor("scrum")).toContain("planning");
    expect(viewsFor("scrum")).toContain("retro");
  });
});

function deps(over: Partial<ProjectDeps> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const toasts: string[] = [];
  let snapshot = raw();
  const d: ProjectDeps = {
    gateway: {
      available: () => true,
      load: vi.fn(async () => snapshot),
      apply: vi.fn(async (_r: string, op: Record<string, unknown>) => {
        calls.push(op);
        if (op.op === "move" && op.to === "progress" && !op.reason) throw { code: "wip", message: "WIP limit 1 reached", overridable: true };
        if (op.op === "move" && op.to === "done") throw { code: "not_found", message: "a issue não existe", overridable: false };
        snapshot = raw();
        return snapshot;
      }),
      issue: vi.fn(async () => ({ activity: [{ at: NOW, actor: "Ana", kind: "moved", from: "todo", to: "progress", note: "" }], changeSets: [] })),
      reports: vi.fn(async () => ({ cycle: [], throughput: [], cfd: [], burndown: null, velocity: [] })),
    },
    workspace: { root: () => "/proj", me: () => "Ana" },
    git: { available: () => true, branch: vi.fn(async () => undefined), log: vi.fn(async () => [{ hash: "abc", subject: "PRJ-1 x", at: NOW }]) },
    codev: { available: () => true, work: vi.fn() },
    dialog: { prompt: vi.fn(() => "production is down"), confirm: () => true },
    notify: { toast: (m) => toasts.push(m) },
    now: () => NOW,
    ...over,
  };
  return { d, calls, toasts };
}

describe("the Project use case", () => {
  it("is unavailable outside the desktop app (nothing invented)", async () => {
    const { d } = deps({ gateway: { ...deps().d.gateway, available: () => false } });
    const s = makeProjectService(d);
    await s.open();
    expect(s.state().status).toBe("unavailable");
    expect(renderProject(s.state(), NOW)).toContain("stored in the desktop app's SQLite database");
  });

  it("a move refused by a rule asks for a reason and retries with it", async () => {
    const { d, calls } = deps();
    const s = makeProjectService(d);
    await s.open();
    expect(await s.move("PRJ-3", "progress")).toBe(true);
    expect(d.dialog.prompt).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      { op: "move", key: "PRJ-3", to: "progress" },
      { op: "move", key: "PRJ-3", to: "progress", reason: "production is down" },
    ]);
  });

  it("no reason, no move; errors that cannot be overridden become a toast", async () => {
    const { d, calls, toasts } = deps({ dialog: { prompt: () => null, confirm: () => true } });
    const s = makeProjectService(d);
    await s.open();
    expect(await s.move("PRJ-3", "progress")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await s.move("PRJ-1", "done")).toBe(false);
    expect(toasts).toEqual(["a issue não existe"]);
  });

  it("creates the branch with git, links commits and hands the issue to Co-Dev", async () => {
    const { d, calls } = deps();
    const s = makeProjectService(d);
    await s.open();
    await s.createBranch("PRJ-1");
    expect(d.git.branch).toHaveBeenCalledWith("feature/prj-1-tokenize-numbers");
    expect(calls).toContainEqual({ op: "update_issue", key: "PRJ-1", branch: "feature/prj-1-tokenize-numbers" });
    await s.syncCommits();
    expect(calls).toContainEqual({ op: "link_commits", commits: [{ hash: "abc", subject: "PRJ-1 x", at: NOW }] });
    s.work("PRJ-1");
    expect(d.codev.work).toHaveBeenCalledWith(expect.objectContaining({ key: "PRJ-1" }), expect.objectContaining({ root: "/proj" }));
  });

  it("selecting an issue loads its history", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    s.select("PRJ-1");
    await vi.waitFor(() => expect(s.state().detail?.activity).toHaveLength(1));
  });
});

describe("the Project markup", () => {
  it("draws the method's columns, WIP over the limit, cards and the inbox count", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    const heads = [...host.querySelectorAll(".pj-colhead span:first-child")].map((e) => e.textContent);
    expect(heads).toEqual(["To Do", "Pairing (TDD)", "In Review", "Acceptance", "Done"]);
    expect(host.querySelector(".pj-colhead.over")?.textContent).toContain("2 / 1");
    expect(host.querySelectorAll(".pj-card")).toHaveLength(2);
    expect(host.querySelector('.pj-card[data-on="PRJ-2"] .pj-flag.bad')?.textContent).toBe("blocked");
    expect(host.querySelector('.pj-tab[data-on="backlog"] .pj-count')?.textContent).toBe("1");
    expect(host.querySelector(".pj-h1")?.textContent).toContain("Sprint 1");
  });

  it("the issue panel shows criteria, DoD, development and activity", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    s.select("PRJ-1");
    await vi.waitFor(() => expect(s.state().detail).not.toBeNull());
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    const panel = host.querySelector(".pj-issue")!;
    expect(panel.querySelector(".pj-issue-title")?.getAttribute("value")).toBe("Tokenize numbers");
    expect(panel.textContent).toContain("123 is one token");
    expect(panel.textContent).toContain("git checkout -b feature/prj-1-tokenize-numbers");
    expect(panel.textContent).toContain("abc1234");
    expect(panel.querySelectorAll('[data-action="pj-dod"]')).toHaveLength(2);
    expect(panel.querySelector(".pj-act")?.textContent).toContain("Ana");
  });

  it("RF-B08: the issue panel sums what Co-Dev used and each change set opens its diff", async () => {
    const usage = { turns: 3, sessions: 2, models: ["claude-sonnet-5-5", "llama3"], tokensIn: 12345, tokensOut: 800, costUsd: 0.4567, unpriced: 1 };
    const change = { session: "", call: "c1", hunk: "c1:1", path: "src/lexer.rs", start: 40, end: 52, added: 13, removed: 2, decidedBy: "human", decidedAt: NOW };
    const issue = vi.fn(async () => ({ activity: [], changeSets: [change], usage }));
    const { d } = deps({ gateway: { ...deps().d.gateway, issue } });
    const s = makeProjectService(d);
    await s.open();
    s.select("PRJ-1");
    await vi.waitFor(() => expect(s.state().detail?.usage.turns).toBe(3));
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    const u = host.querySelector(".pj-usage")!.textContent!;
    expect(u).toContain("3 turns in 2 sessions");
    expect(u).toContain("claude-sonnet-5-5, llama3");
    expect(u).toContain("12.3k in / 800 out tokens");
    expect(u).toContain("$0.46 (+1 turn not priced)");
    expect(host.querySelector('[data-action="pj-diff"]')?.getAttribute("data-on")).toBe("src/lexer.rs");
    // without turns there is no usage line (and an old backend without `usage` reads as none)
    issue.mockResolvedValueOnce({ activity: [], changeSets: [] } as never);
    s.select("PRJ-2");
    await vi.waitFor(() => expect(s.state().detail?.usage).toEqual({ turns: 0, sessions: 0, models: [], tokensIn: 0, tokensOut: 0, costUsd: 0, unpriced: 0 }));
    host.innerHTML = renderProject(s.state(), NOW);
    expect(host.querySelector(".pj-usage")).toBeNull();
  });

  it("reports without history say what they need", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    s.setView("reports");
    await vi.waitFor(() => expect(s.state().reports).not.toBeNull());
    const html = renderProject(s.state(), NOW);
    expect(html).toContain("Start a sprint to see its burndown.");
    expect(html).toContain("Appears once issues reach Done");
    expect(html).not.toContain("<svg");
  });

  it("RF-T01: exports the Co-Dev audit log of an issue as JSON, or says there is none", async () => {
    const files: Array<[string, string]> = [];
    const rows = [{ event: "call", tool: "bash", command: "git push", outcome: "denied", decidedBy: "human:Ana" }];
    const audit = vi.fn(async (_r: string, k: string | null) => (k === "PRJ-1" ? rows : []));
    const { d, toasts } = deps({ gateway: { ...deps().d.gateway, audit }, download: (n, t) => files.push([n, t]) });
    const s = makeProjectService(d);
    await s.open();
    await s.exportAudit("PRJ-1");
    expect(audit).toHaveBeenCalledWith("/proj", "PRJ-1");
    expect(files[0][0]).toBe("audit-PRJ-1.json");
    expect(JSON.parse(files[0][1])).toEqual(rows);
    await s.exportAudit("PRJ-3");
    expect(files).toHaveLength(1);
    expect(toasts.at(-1)).toContain("Ainda não há registo do Co-Dev para PRJ-3");
  });

  it("F4: Co-Dev works on an issue only when Ready, with the exact prompt; «View prompt» shows it", async () => {
    const snap = raw();
    const issues = snap.issues as Array<Record<string, unknown>>;
    issues[0].scope = ["src/**"];
    issues[2].missing = ["âmbito de ficheiros", "aprovação humana (Ready)"];
    const prompt = { text: "# Papel\nÉs o Co-Dev deste projecto.", lang: "pt", source: "builtin", version: "abc123", tokens: 42 };
    const issuePrompt = vi.fn(async () => prompt);
    const workWith = vi.fn();
    const { d, toasts } = deps({ gateway: { ...deps().d.gateway, load: vi.fn(async () => snap), issuePrompt }, codev: { available: () => true, work: vi.fn(), workWith } });
    const s = makeProjectService(d);
    await s.open();
    await s.work("PRJ-3");
    expect(workWith).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toContain("PRJ-3 ainda não está Ready — falta: âmbito de ficheiros");
    await s.work("PRJ-1");
    expect(issuePrompt).toHaveBeenCalledWith("/proj", "PRJ-1");
    // the prompt as the backend sent it (plus `template`, empty when an older backend leaves it out)
    expect(workWith).toHaveBeenCalledWith(expect.objectContaining({ key: "PRJ-1", scope: ["src/**"] }), { template: "", ...prompt });
    // the panel: what is missing, the button off, and the prompt as it is sent
    await s.select("PRJ-3");
    let html = renderProject(s.state(), NOW);
    expect(html).toContain("Missing for Ready");
    expect(html).toMatch(/data-action="pj-work" disabled/);
    await s.select("PRJ-1");
    await s.viewPrompt("PRJ-1");
    html = renderProject(s.state(), NOW);
    expect(html).toContain("≈ 42 tokens");
    expect(html).toContain("# Papel");
    s.closePrompt();
    expect(renderProject(s.state(), NOW)).not.toContain("≈ 42 tokens");
  });

  it("RF-B04: «Edit template» cria o template do projecto a partir do embutido e abre-o; o do projecto só se abre", async () => {
    const files = { write: vi.fn(async () => undefined), open: vi.fn(async () => undefined) };
    const builtin = { text: "# Papel\n…", lang: "pt", source: "builtin", version: "v1", tokens: 9, template: "# Papel\n{{id}} — {{titulo}}" };
    let answer = false;
    const issuePrompt = vi.fn(async () => builtin);
    const { d, toasts } = deps({ gateway: { ...deps().d.gateway, issuePrompt }, templates: files, dialog: { prompt: () => null, confirm: () => answer } });
    const s = makeProjectService(d);
    await s.open();
    await s.select("PRJ-1");
    await s.viewPrompt("PRJ-1");
    expect(renderProject(s.state(), NOW)).toContain('data-action="pj-template"');
    // declined: nothing is written
    await s.editTemplate();
    expect(files.write).not.toHaveBeenCalled();
    answer = true;
    await s.editTemplate();
    expect(files.write).toHaveBeenCalledWith("/proj", ".dxtutor/prompts/issue.pt.md", "# Papel\n{{id}} — {{titulo}}");
    expect(files.open).toHaveBeenCalledWith(".dxtutor/prompts/issue.pt.md");
    expect(toasts.at(-1)).toContain("«View prompt» shows the new version");
    // the project's own template: opened as it is, never overwritten
    issuePrompt.mockResolvedValueOnce({ ...builtin, lang: "en", source: ".dxtutor/prompts/issue.en.md", template: "mine" });
    await s.viewPrompt("PRJ-1");
    files.write.mockClear();
    await s.editTemplate();
    expect(files.write).not.toHaveBeenCalled();
    expect(files.open).toHaveBeenLastCalledWith(".dxtutor/prompts/issue.en.md");
    // outside the desktop (no templates port): it says where
    const o = deps({ gateway: { ...deps().d.gateway, issuePrompt } });
    const off = makeProjectService(o.d);
    await off.open();
    await off.select("PRJ-1");
    await off.viewPrompt("PRJ-1");
    await off.editTemplate();
    expect(o.toasts.at(-1)).toBe("O template edita-se na app desktop, com uma pasta aberta");
  });

  it("RF-T03: o orçamento e o gasto do Co-Dev na issue e no sprint", async () => {
    const snap = raw();
    (snap.issues as Array<Record<string, unknown>>)[0].budgetUsd = 1;
    (snap.issues as Array<Record<string, unknown>>)[0].spentUsd = 0.75;
    (snap.sprints as Array<Record<string, unknown>>)[0].budgetUsd = 5;
    (snap.sprints as Array<Record<string, unknown>>)[0].spentUsd = 5.2;
    const { d } = deps({ gateway: { ...deps().d.gateway, load: vi.fn(async () => snap) } });
    const s = makeProjectService(d);
    await s.open();
    await s.select("PRJ-1");
    expect(renderProject(s.state(), NOW)).toContain("spent $0.75 of $1.00");
    s.setView("planning");
    const html = renderProject(s.state(), NOW);
    expect(html).toContain("Co-Dev $5.20 of $5.00 budget");
    expect(html).toContain('pj-dim bad"><span>Co-Dev $5.20');
  });

  it("RF-P03: numa sessão PairCode, quem não conduz não executa a issue com o Co-Dev", async () => {
    const workWith = vi.fn();
    const issuePrompt = vi.fn(async () => ({ text: "p", lang: "pt", source: "builtin", version: "v", tokens: 1 }));
    const { d, toasts } = deps({ gateway: { ...deps().d.gateway, issuePrompt }, codev: { available: () => true, work: vi.fn(), workWith }, canDrive: () => false, navigatorMessage: "só quem conduz" });
    const s = makeProjectService(d);
    await s.open();
    await s.work("PRJ-1");
    expect(workWith).not.toHaveBeenCalled();
    expect(issuePrompt).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toBe("só quem conduz");
  });
});
