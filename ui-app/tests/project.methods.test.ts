import { describe, expect, it, vi } from "vitest";
import { cardOrder, dorOpen, lanes, sprintLoad } from "../src/features/project/domain/board";
import { parseMethodChange, parseProject, type Project } from "../src/features/project/domain/types";
import { makeProjectService } from "../src/features/project/application/project-service";
import type { ProjectDeps } from "../src/features/project/application/ports";
import { renderProject } from "../src/features/project/ui/view";
import { methodPreviewBox } from "../src/features/project/ui/panels";

/* Board B — each board method drives the rules, and Co-Dev follows the methodology. The rules live in
   Rust (`tutor_board::project::methods`, `move_check`, `capacity_rule`); here: what the UI reads of them,
   asks before them, and shows. */

const NOW = Date.UTC(2026, 10, 26, 12);
const DAY = 86_400_000;

const issue = (key: string, over: Record<string, unknown> = {}) => ({
  key, title: key, kind: "story", priority: "medium", points: 3, assignee: "", pair: "", epic: "", cos: "standard", blocked: null,
  rank: 0, state: "todo", sprint: null, ready: true, description: "", branch: null, acceptance: [], dodDone: [], dorDone: [], links: [],
  changeSets: 0, created: NOW, updated: NOW, since: NOW, missing: [], ...over,
});

const raw = (over: Record<string, unknown> = {}) => ({
  root: "/proj", keyPrefix: "PRJ", method: "kanban", iterDays: 14, wip: { progress: 3 }, dor: ["Estimated", "UX approved"], dod: ["Docs"],
  issues: [
    issue("PRJ-1", { rank: 0, cos: "standard", state: "progress" }),
    issue("PRJ-2", { rank: 1, cos: "intangible", state: "progress" }),
    issue("PRJ-3", { rank: 2, cos: "expedite", state: "progress" }),
    issue("PRJ-4", { rank: 3, cos: "fixed", dorDone: [true, false] }),
  ],
  sprints: [{ id: "S1", name: "Sprint 1", goal: "", start: NOW - DAY, end: NOW + 7 * DAY, state: "planned", capacity: 5 }],
  releases: [], retro: [], inbox: [], ...over,
});

const preview = { from: "kanban", to: "xp", changes: [{ field: "iter_days", from: 14, to: 7 }, { field: "wip.accept", from: 2, to: null }, { field: "dod", from: [], to: ["Tests written before the code (TDD)"] }], kept: [{ field: "wip.progress", from: 5, to: 2 }] };

function deps(over: Partial<ProjectDeps> = {}, refuse: (op: Record<string, unknown>) => unknown = () => null) {
  const calls: Array<Record<string, unknown>> = [];
  const d: ProjectDeps = {
    gateway: {
      available: () => true,
      load: vi.fn(async () => raw()),
      apply: vi.fn(async (_r: string, op: Record<string, unknown>) => {
        calls.push(op);
        const e = refuse(op);
        if (e) throw e;
        return raw();
      }),
      issue: vi.fn(async () => ({ activity: [], changeSets: [] })),
      reports: vi.fn(async () => ({})),
      methodPreview: vi.fn(async () => preview),
      issuePrompt: vi.fn(async () => ({ text: "prompt", lang: "en", source: "builtin", version: "v", tokens: 2, template: "t" })),
    },
    workspace: { root: () => "/proj", me: () => "Ana" },
    git: { available: () => false, branch: vi.fn(), log: vi.fn(async () => []) },
    codev: { available: () => true, work: vi.fn(), workWith: vi.fn() },
    dialog: { prompt: vi.fn(() => "the PO asked"), confirm: () => true },
    notify: { toast: vi.fn() },
    now: () => NOW,
    lang: () => "en",
    ...over,
  };
  return { d, calls };
}

describe("Board B — the board's selectors", () => {
  const p = parseProject(raw()) as Project;

  it("Kanban lists each column by class of service, then rank; the other methods by rank", () => {
    const col = (m: Project["method"]) => lanes(p.issues, "none", m)[0].columns.progress.map((i) => i.key);
    expect(col("kanban")).toEqual(["PRJ-3", "PRJ-1", "PRJ-2"]);
    expect(col("scrum")).toEqual(["PRJ-1", "PRJ-2", "PRJ-3"]);
    expect([...p.issues].sort(cardOrder("kanban")).map((i) => i.key)).toEqual(["PRJ-3", "PRJ-4", "PRJ-1", "PRJ-2"]);
  });

  it("reads the DoR flags and the sprint load", () => {
    const i4 = p.issues.find((i) => i.key === "PRJ-4")!;
    expect(i4.dorDone).toEqual([true, false]);
    expect(dorOpen(i4, p)).toEqual(["UX approved"]);
    const planned = parseProject(raw({ issues: [issue("PRJ-1", { sprint: "S1", points: 3 }), issue("PRJ-2", { sprint: "S1", points: 4 })] }))!;
    expect(sprintLoad(planned, planned.sprints[0])).toEqual({ points: 7, capacity: 5, left: -2 });
  });

  it("parses the method preview and refuses other shapes", () => {
    expect(parseMethodChange(preview)?.changes).toHaveLength(3);
    expect(parseMethodChange({ to: "agile" })).toBeNull();
    expect(parseMethodChange(null)).toBeNull();
  });
});

describe("Board B — the use case", () => {
  it("choosing a method previews what changes; Apply sends it with the language, Cancel drops it", async () => {
    const { d, calls } = deps();
    const s = makeProjectService(d);
    await s.open();
    await s.chooseMethod("xp");
    expect(d.gateway.methodPreview).toHaveBeenCalledWith("/proj", "xp", "en");
    expect(s.state().methodPreview?.to).toBe("xp");
    expect(calls).toEqual([]);
    s.cancelMethod();
    expect(s.state().methodPreview).toBeNull();
    await s.chooseMethod("xp");
    expect(await s.applyMethod()).toBe(true);
    expect(calls).toEqual([{ op: "settings", method: "xp", lang: "en" }]);
    expect(s.state().methodPreview).toBeNull();
    // the current method: nothing to preview
    await s.chooseMethod("kanban");
    expect(s.state().methodPreview).toBeNull();
  });

  it("a capacity refusal when planning asks for a reason and retries with it", async () => {
    const capacity = { code: "capacity", message: "a capacidade de «Sprint 1» é 5 pontos e ficaria com 6", overridable: true };
    const { d, calls } = deps({}, (op) => (op.op === "plan_issue" && !op.reason ? capacity : null));
    const s = makeProjectService(d);
    await s.open();
    expect(await s.plan("PRJ-4", "S1")).toBe(true);
    expect(d.dialog.prompt).toHaveBeenCalledWith(expect.stringContaining("ficaria com 6"));
    expect(calls).toEqual([
      { op: "plan_issue", key: "PRJ-4", sprint: "S1" },
      { op: "plan_issue", key: "PRJ-4", sprint: "S1", reason: "the PO asked" },
    ]);
  });

  it("Co-Dev starts with the normal move to In progress; refused and no reason, it does not start", async () => {
    const wip = { code: "wip", message: "o limite de WIP de «progress» é 3 e já há 3", overridable: true };
    const { d, calls } = deps({ dialog: { prompt: vi.fn(() => null), confirm: () => true } }, (op) => (op.op === "move" && !op.reason ? wip : null));
    const s = makeProjectService(d);
    await s.open();
    await s.work("PRJ-4");
    expect(calls).toEqual([{ op: "move", key: "PRJ-4", to: "progress" }]);
    expect(d.codev.workWith).not.toHaveBeenCalled();
    // with a reason, the override is recorded and Co-Dev starts
    const ok = deps({}, (op) => (op.op === "move" && !op.reason ? wip : null));
    const s2 = makeProjectService(ok.d);
    await s2.open();
    await s2.work("PRJ-4");
    expect(ok.calls).toEqual([
      { op: "move", key: "PRJ-4", to: "progress" },
      { op: "move", key: "PRJ-4", to: "progress", reason: "the PO asked" },
    ]);
    expect(ok.d.codev.workWith).toHaveBeenCalledOnce();
    // an issue already in progress starts without a move
    await s2.work("PRJ-1");
    expect(ok.calls).toHaveLength(2);
  });

  it("ticks the project's DoR items on the issue", async () => {
    const { d, calls } = deps();
    const s = makeProjectService(d);
    await s.open();
    await s.toggleDor("PRJ-4", 1);
    expect(calls).toEqual([{ op: "update_issue", key: "PRJ-4", dor_done: [true, true] }]);
  });
});

describe("Board B — the markup", () => {
  it("marks expedite cards, ticks the DoR per issue and keeps those items out of the missing list", async () => {
    const r = raw();
    r.issues[3] = issue("PRJ-4", { rank: 3, cos: "fixed", dorDone: [true, false], missing: ["DoR: «UX approved»", "âmbito de ficheiros"] });
    const { d } = deps({ gateway: { ...deps().d.gateway, load: vi.fn(async () => r) } });
    const s = makeProjectService(d);
    await s.open();
    s.select("PRJ-4");
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    expect(host.querySelector('.pj-card[data-on="PRJ-3"] .pj-flag.exp')?.textContent).toContain("expedite");
    expect(host.querySelector('.pj-card[data-on="PRJ-1"] .pj-flag.exp')).toBeNull();
    const dor = [...host.querySelectorAll<HTMLInputElement>('[data-action="pj-dor"]')];
    expect(dor.map((c) => c.checked)).toEqual([true, false]);
    const missing = host.querySelector(".pj-missing")!.textContent!;
    expect(missing).toContain("âmbito de ficheiros");
    expect(missing).not.toContain("UX approved");
  });

  it("Settings shows each method's rules and the preview with what changes and what stays", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    s.setView("settings");
    await s.chooseMethod("xp");
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    expect(host.querySelector('.pj-methodcard[data-on="xp"] .pj-rules')?.textContent).toContain("TDD");
    expect(host.querySelector('.pj-methodcard[data-on="kanban"] .pj-rules')?.textContent).toContain("expedite");
    const box = host.querySelector(".pj-method-preview")!.textContent!;
    expect(box).toContain("Switch to XP");
    expect(box).toContain("Iteration length (days): 14 → 7");
    expect(box).toContain("2 → no limit");
    expect(box).toContain("(empty) → «Tests written before the code (TDD)»");
    expect(box).toContain("These stay, because you set them:");
    expect(box).toMatch(/WIP limit · In Progress: 5(?! →)/);
    expect(host.querySelector('[data-action="pj-method-apply"]')).not.toBeNull();
    expect(methodPreviewBox(parseProject(raw())!, { from: "kanban", to: "scrum", changes: [], kept: [] })).toContain("No setting changes.");
  });

  it("Planning says the capacity left, or that planning more needs a reason", async () => {
    const r = raw({ method: "scrum", issues: [issue("PRJ-1", { sprint: "S1", points: 3 })] });
    const { d } = deps({ gateway: { ...deps().d.gateway, load: vi.fn(async () => r) } });
    const s = makeProjectService(d);
    await s.open();
    s.setView("planning");
    const host = document.createElement("div");
    host.innerHTML = renderProject(s.state(), NOW);
    expect(host.textContent).toContain("2 points left");
    r.issues = [issue("PRJ-1", { sprint: "S1", points: 8 })];
    await s.open();
    host.innerHTML = renderProject(s.state(), NOW);
    expect(host.textContent).toContain("over capacity: planning more needs a reason");
  });
});
