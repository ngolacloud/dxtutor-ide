import { describe, expect, it, vi } from "vitest";
import { laneCells, parseCodevs, parseSprintPlan } from "../src/features/project/domain/plan";
import { parseProject } from "../src/features/project/domain/types";
import { makeProjectService } from "../src/features/project/application/project-service";
import type { ProjectDeps } from "../src/features/project/application/ports";
import { renderProject } from "../src/features/project/ui/view";
import { PROJECT_PLAN_MESSAGES } from "../src/features/project/ui/plan-messages";

/* Multi Co-Dev, phase 1: the parallel plan of a sprint (read-only). The planner's rules (overlaps,
   waves, balance, reasons) are tested in Rust (`tutor_board::project::plan`); here the shape the UI
   reads, the use case (the sprint's Co-Devs, the plan that follows the project) and the markup. */

const NOW = Date.UTC(2026, 10, 26, 12);
const DAY = 86_400_000;

const project = (codevs: number | null = 2) => ({
  root: "/shop",
  keyPrefix: "SH",
  method: "scrum",
  iterDays: 14,
  wip: {},
  dor: [],
  dod: [],
  issues: [
    { key: "SH-1", title: "Cart total", kind: "story", priority: "high", points: 5, state: "todo", sprint: "S1", rank: 0, ready: true, acceptance: [], dodDone: [], links: [], scope: ["src/cart/**"], deps: [], missing: [] },
    { key: "SH-2", title: "Pay", kind: "story", priority: "medium", points: 3, state: "todo", sprint: "S1", rank: 1, ready: true, acceptance: [], dodDone: [], links: [], scope: ["src/**/total.rs"], deps: [], missing: [] },
  ],
  sprints: [{ id: "S1", name: "Sprint 1", goal: "", start: NOW - DAY, end: NOW + 13 * DAY, state: "planned", capacity: null, budgetUsd: null, spentUsd: 0, codevs }],
  releases: [],
  retro: [],
  inbox: [],
});

const plan = {
  sprint: "S1",
  codevs: 2,
  lanes: [
    { codev: 1, points: 8, unestimated: 0, issues: [
      { key: "SH-1", title: "Cart total", points: 5, priority: "high", wave: 1, after: [], serialisedAfter: [], branchConflicts: [] },
      { key: "SH-2", title: "Pay", points: 3, priority: "medium", wave: 2, after: [], serialisedAfter: ["SH-1"], branchConflicts: ["src/lib.rs"] },
    ] },
    { codev: 2, points: 2, unestimated: 1, issues: [{ key: "SH-4", title: "Docs <b>", points: 2, priority: "low", wave: 1, after: [], serialisedAfter: [], branchConflicts: [] }] },
  ],
  waves: 2,
  leftOut: [
    { key: "SH-3", title: "Invite", reason: "not_ready", missing: ["critérios de aceitação"], keys: [] },
    { key: "SH-5", title: "Ship", reason: "in_flow", missing: [], keys: ["review"] },
    { key: "SH-6", title: "Later", reason: "blocked_by_deps", missing: [], keys: ["SH-9"] },
    { key: "SH-7", title: "Odd", reason: "something_else", missing: [], keys: [] },
  ],
  overlaps: [{ a: "SH-1", b: "SH-2", paths: ["src/cart/total.rs"], total: 3, globs: [["src/cart/**", "src/**/total.rs"], ["known", "src/**/total.rs"]] }],
  files: 42,
};

describe("the plan as the UI reads it", () => {
  it("narrows the planner's answer and drops what it does not know", () => {
    const p = parseSprintPlan(plan)!;
    expect(p.lanes.map((l) => l.issues.map((i) => i.key))).toEqual([["SH-1", "SH-2"], ["SH-4"]]);
    expect(p.lanes[0].issues[1].serialisedAfter).toEqual(["SH-1"]);
    expect(p.leftOut.map((l) => l.reason)).toEqual(["not_ready", "in_flow", "blocked_by_deps"]);
    expect(p.overlaps[0].globs[0]).toEqual(["src/cart/**", "src/**/total.rs"]);
    expect(parseSprintPlan({ nope: 1 })).toBeNull();
    expect(parseSprintPlan(null)).toBeNull();
  });

  it("lays a lane out by wave, with the idle waves empty", () => {
    const p = parseSprintPlan(plan)!;
    expect(laneCells(p.lanes[1], 2).map((c) => c?.key ?? null)).toEqual(["SH-4", null]);
    expect(laneCells(p.lanes[0], 2).map((c) => c?.key ?? null)).toEqual(["SH-1", "SH-2"]);
  });

  it("reads the Co-Dev count typed by the human", () => {
    expect(parseCodevs("3")).toBe(3);
    expect(parseCodevs(" ")).toBeNull();
    expect(parseCodevs("0")).toBeUndefined();
    expect(parseCodevs("9")).toBeUndefined();
    expect(parseCodevs("2.5")).toBeUndefined();
  });

  it("the sprint keeps its Co-Devs", () => {
    expect(parseProject(project(3))!.sprints[0].codevs).toBe(3);
    expect(parseProject(project(null))!.sprints[0].codevs).toBeNull();
  });

  it("every text has both languages", () => {
    expect(Object.keys(PROJECT_PLAN_MESSAGES.ptAO).sort()).toEqual(Object.keys(PROJECT_PLAN_MESSAGES.en).sort());
  });
});

function deps(over: Partial<ProjectDeps> = {}) {
  const ops: Array<Record<string, unknown>> = [];
  const asked: Array<[string, string | null, number | null]> = [];
  const toasts: string[] = [];
  let codevs: number | null = 2;
  const d: ProjectDeps = {
    gateway: {
      available: () => true,
      load: vi.fn(async () => project(codevs)),
      apply: vi.fn(async (_r: string, op: Record<string, unknown>) => {
        ops.push(op);
        if (op.op === "set_sprint_codevs") codevs = op.codevs as number | null;
        return project(codevs);
      }),
      issue: vi.fn(async () => ({ activity: [], changeSets: [] })),
      reports: vi.fn(async () => ({})),
      sprintPlan: vi.fn(async (root: string, sprint: string | null, n: number | null) => {
        asked.push([root, sprint, n]);
        return { ...plan, codevs: codevs ?? 1 };
      }),
    },
    workspace: { root: () => "/shop", me: () => "Ana" },
    git: { available: () => true, branch: vi.fn(async () => undefined), log: vi.fn(async () => []) },
    codev: { available: () => true, work: vi.fn() },
    dialog: { prompt: () => null, confirm: () => true },
    notify: { toast: (m) => toasts.push(m) },
    now: () => NOW,
    ...over,
  };
  return { d, ops, asked, toasts };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the parallel plan use case", () => {
  it("asks the planner for the sprint, read-only, and closes", async () => {
    const { d, ops, asked } = deps();
    const s = makeProjectService(d);
    await s.open();
    await s.loadPlan("S1");
    expect(asked).toEqual([["/shop", "S1", null]]);
    expect(ops).toEqual([], "the plan changes nothing");
    expect(s.state().sprintPlan).toMatchObject({ sprint: "S1", loading: false, error: null });
    expect(s.state().sprintPlan!.data!.lanes).toHaveLength(2);
    s.closePlan();
    expect(s.state().sprintPlan).toBeNull();
  });

  it("the sprint's Co-Devs are stored in the project; the open plan follows", async () => {
    const { d, ops, asked, toasts } = deps();
    const s = makeProjectService(d);
    await s.open();
    await s.loadPlan("S1");
    expect(await s.setCodevs("S1", 4)).toBe(true);
    expect(ops).toEqual([{ op: "set_sprint_codevs", id: "S1", codevs: 4 }]);
    await flush();
    expect(asked).toHaveLength(2);
    expect(s.state().sprintPlan!.data!.codevs).toBe(4);
    expect(await s.setCodevs("S1", undefined)).toBe(false);
    expect(toasts.at(-1)).toMatch(/1 a 8|1 to 8/);
    expect(ops).toHaveLength(1);
  });

  it("a planner error is shown in the plan; without the desktop it says so", async () => {
    const { d } = deps();
    d.gateway.sprintPlan = vi.fn(async () => {
      throw { code: "not_found", message: "não há uma sprint activa nem planeada", overridable: false };
    });
    const s = makeProjectService(d);
    await s.open();
    await s.loadPlan("S1");
    expect(s.state().sprintPlan!.error).toBe("não há uma sprint activa nem planeada");
    const { d: d2, toasts } = deps();
    delete d2.gateway.sprintPlan;
    const s2 = makeProjectService(d2);
    await s2.open();
    await s2.loadPlan("S1");
    expect(s2.state().sprintPlan).toBeNull();
    expect(toasts).toHaveLength(1);
  });

  it("only the newest request paints", async () => {
    const { d } = deps();
    let release: (v: unknown) => void = () => undefined;
    const calls: number[] = [];
    d.gateway.sprintPlan = vi.fn((_r: string, _s: string | null, _n: number | null) => {
      calls.push(calls.length);
      if (calls.length === 1) return new Promise((r) => (release = r));
      return Promise.resolve({ ...plan, waves: 7 });
    });
    const s = makeProjectService(d);
    await s.open();
    const first = s.loadPlan("S1");
    await s.loadPlan("S1");
    release({ ...plan, waves: 1 });
    await first;
    expect(s.state().sprintPlan!.data!.waves).toBe(7);
  });
});

describe("the parallel plan markup", () => {
  it("the planning view has the Co-Devs field and the button; the plan shows lanes, waves, left-out and overlaps", async () => {
    const { d } = deps();
    const s = makeProjectService(d);
    await s.open();
    s.setView("planning");
    let html = renderProject(s.state(), NOW);
    expect(html).toContain('data-action="pj-sprint-codevs" data-on="S1" value="2"');
    expect(html).toContain('data-action="pj-sprint-plan" data-on="S1"');
    expect(html).not.toContain("pj-plan-grid");
    await s.loadPlan("S1");
    html = renderProject(s.state(), NOW);
    expect(html).toContain("Co-Dev 1");
    expect(html).toContain("Co-Dev 2");
    expect(html).toContain("8 pts");
    expect(html).toContain("+1 not estimated");
    expect(html).toContain("Wave 1");
    expect(html).toContain("Wave 2");
    expect(html.match(/pj-plan-idle/g)).toHaveLength(1);
    expect(html).toContain("serialised after <code>SH-1</code>");
    expect(html).toContain("branch conflicts with HEAD: <code>src/lib.rs</code>");
    expect(html).toContain("Docs &lt;b&gt;");
    expect(html).toContain("Not Ready — missing: critérios de aceitação");
    expect(html).toContain("Already in the flow (In Review)");
    expect(html).toContain("Waits for <code>SH-9</code>");
    expect(html).toContain("<code>src/cart/**</code> ∩ <code>src/**/total.rs</code>");
    expect(html).toContain("<code>known files</code> ∩");
    expect(html).toContain("+2 more");
    expect(html).toContain("2 Co-Dev(s) · 2 wave(s) · overlaps checked against 42 file(s)");
    expect(html).toContain('data-action="pj-open" data-on="SH-2"');
    expect(html).toContain('data-action="pj-plan-close"');
  });

  it("an empty plan says there is nothing Ready yet", async () => {
    const { d } = deps();
    d.gateway.sprintPlan = vi.fn(async () => ({ ...plan, lanes: [{ codev: 1, points: 0, unestimated: 0, issues: [] }], waves: 0, leftOut: [], overlaps: [] }));
    const s = makeProjectService(d);
    await s.open();
    s.setView("planning");
    await s.loadPlan("S1");
    const html = renderProject(s.state(), NOW);
    expect(html).toContain("No Ready issue to plan in this sprint yet.");
    expect(html).toContain("No two issues of the sprint can change the same file.");
  });
});
