import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReports } from "../src/features/project/domain/types";
import { makeProjectService } from "../src/features/project/application/project-service";
import type { ProjectDeps } from "../src/features/project/application/ports";
import { renderProject } from "../src/features/project/ui/view";
import { bindActions } from "../src/features/project/ui/actions";
import { insightText, withheldText } from "../src/features/project/ui/reports-view";
import { PROJECT_REPORTS_MESSAGES } from "../src/features/project/ui/reports-messages";

/* Board A: the honest sprint charts (each day with that day's scope and estimates, the ideal line from the
   commitment, committed vs done per closed sprint) and the «Insights» panel for the project manager. The
   numbers are computed and tested in Rust (`tutor_board::project::{reports,insights}`); here, how the UI
   reads them and what it shows. */

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;

const issue = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  title: `Issue ${key}`,
  kind: "story",
  priority: "medium",
  points: 3,
  assignee: "",
  pair: "",
  epic: "",
  cos: "standard",
  blocked: null,
  rank: 0,
  state: "progress",
  sprint: "S2",
  ready: true,
  description: "",
  branch: null,
  acceptance: [],
  dodDone: [],
  links: [],
  changeSets: 0,
  created: NOW - 5 * DAY,
  updated: NOW,
  since: NOW - DAY,
  ...over,
});

const raw = (method = "scrum") => ({
  root: "/proj",
  keyPrefix: "PRJ",
  method,
  iterDays: 10,
  wip: {},
  dor: [],
  dod: [],
  issues: [issue("PRJ-1"), issue("PRJ-2", { points: 8 }), issue("PRJ-4", { points: null })],
  sprints: [{ id: "S2", name: "Sprint 2", goal: "", start: NOW - 4 * DAY, end: NOW + 6 * DAY, state: "active", capacity: null }],
  releases: [],
  retro: [],
  inbox: [],
});

/** What `project_reports` answers for a sprint four days in, with history (see reports.rs). */
const REPORTS = {
  cycle: [],
  cycleMedian: null,
  cycleP85: null,
  throughput: [],
  cfd: [],
  burndown: {
    sprint: "S2",
    name: "Sprint 2",
    start: NOW - 4 * DAY,
    end: NOW + 6 * DAY,
    total: 11,
    committed: 11,
    scope: 16,
    days: [0, 1, 2, 3, 4].map((d) => ({ day: NOW - (4 - d) * DAY, scope: d < 2 ? 11 : 16, done: d, remaining: (d < 2 ? 11 : 16) - d })),
    partial: false,
    unestimated: ["PRJ-4"],
  },
  velocity: [
    { sprint: "S0", name: "Sprint 0", points: 9, committed: null, committedDone: null, added: null, removed: null, carried: null, partial: true },
    { sprint: "S1", name: "Sprint 1", points: 6, committed: 11, committedDone: 3, added: 3, removed: 3, carried: 5, partial: false },
  ],
  insights: [
    { code: "forecast_late", severity: "risk", params: { rate: 1, windowDays: 4, remaining: 12, projectedDone: 6, lateDays: 6, daysLeft: 6, partial: false }, keys: ["PRJ-2", "PRJ-1"] },
    { code: "scope_creep", severity: "risk", params: { added: 5, addedCount: 1, removed: 0, removedCount: 0, reestimated: 0, net: 5, committed: 11, pct: 45 }, keys: ["PRJ-9"] },
    { code: "unestimated", severity: "warn", params: { count: 1 }, keys: ["PRJ-4"] },
  ],
  withheld: [{ code: "reliability_wait", params: { need: 2, have: 1 } }],
  historySince: NOW - 30 * DAY,
};

function service(reports: unknown, method = "scrum") {
  const d: ProjectDeps = {
    gateway: {
      available: () => true,
      load: vi.fn(async () => raw(method)),
      apply: vi.fn(async () => raw(method)),
      issue: vi.fn(async () => ({ activity: [], changeSets: [] })),
      reports: vi.fn(async () => reports),
    },
    workspace: { root: () => "/proj", me: () => "Ana" },
    git: { available: () => false, branch: vi.fn(async () => undefined), log: vi.fn(async () => []) },
    codev: { available: () => false, work: vi.fn() },
    dialog: { prompt: vi.fn(() => null), confirm: () => true },
    notify: { toast: () => undefined },
    now: () => NOW,
  };
  return makeProjectService(d);
}

async function reportsOf(reports: unknown, method = "scrum") {
  const s = service(reports, method);
  await s.open();
  s.setView("reports");
  await vi.waitFor(() => expect(s.state().reports).not.toBeNull());
  return s;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the reports the backend computes, as the UI reads them", () => {
  it("reads the new history fields and keeps the old shape working (nothing invented)", () => {
    const r = parseReports(REPORTS);
    expect(r.burndown?.committed).toBe(11);
    expect(r.burndown?.days[2]).toEqual({ day: NOW - 2 * DAY, scope: 16, done: 2, remaining: 14 });
    expect(r.velocity[1]).toMatchObject({ committed: 11, committedDone: 3, carried: 5, partial: false });
    expect(r.insights[0]).toMatchObject({ code: "forecast_late", severity: "risk", keys: ["PRJ-2", "PRJ-1"] });
    expect(r.historySince).toBe(NOW - 30 * DAY);
    const old = parseReports({ burndown: { sprint: "S1", start: 1, end: 2, total: 6, days: [{ day: 1, remaining: 6 }] }, velocity: [{ sprint: "S1", name: "S", points: 3 }] });
    expect(old.burndown).toMatchObject({ committed: null, partial: false, unestimated: [] });
    expect(old.burndown?.days[0]).toEqual({ day: 1, remaining: 6, scope: 6, done: 0 });
    expect(old.velocity[0]).toMatchObject({ points: 3, committed: null, partial: false });
    expect(old.insights).toEqual([]);
    expect(old.withheld).toEqual([]);
    expect(parseReports({ insights: [{ code: "x", severity: "panic", params: { a: Infinity, b: "ok" }, keys: [1, "K-1"] }] }).insights[0]).toEqual({
      code: "x",
      severity: "info",
      params: { b: "ok" },
      keys: ["K-1"],
    });
  });

  it("every insight and every withheld reason has its sentence in both languages", () => {
    const en = Object.keys(PROJECT_REPORTS_MESSAGES.en).sort();
    expect(Object.keys(PROJECT_REPORTS_MESSAGES.ptAO).sort()).toEqual(en);
    for (const code of ["forecast_done", "forecast_on_track", "forecast_late", "forecast_stalled", "forecast_overdue", "scope_creep", "unestimated", "reliability", "aging", "blocked", "blocked_sprint", "cost_per_point", "cost_overrun", "rework"]) {
      expect(en, code).toContain(code);
    }
    for (const code of ["forecast_wait", "forecast_unestimated", "scope_creep_partial", "reliability_wait", "aging_wait", "cost_wait", "rework_wait"]) {
      expect(en, code).toContain(`w_${code}`);
    }
    // every {param} of an English sentence is also in the Portuguese one
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of en) {
      const key = k as keyof typeof PROJECT_REPORTS_MESSAGES.en;
      expect(names(PROJECT_REPORTS_MESSAGES.ptAO[key]), k).toEqual(names(PROJECT_REPORTS_MESSAGES.en[key]));
    }
  });

  it("the sentences take the numbers the backend computed, with their variants", () => {
    expect(insightText(parseReports(REPORTS).insights[0])).toBe(
      "At risk: at 1 points a day (last 4 days), about 6 of the 12 points left get done by the end — 6 more day(s) would be needed.",
    );
    const blocked = (longestDays: number | null, sprintDays: number) => insightText({ code: "blocked", severity: "warn", params: { count: 2, longestDays, longestKey: "PRJ-1", unknownSince: 0, sprintDays }, keys: [] });
    expect(blocked(3, 0)).toBe("2 issue(s) blocked now; the longest for 3 days.");
    expect(blocked(null, 1.5)).toBe("2 issue(s) blocked now (when the block began was not recorded). The sprint's issues have been blocked 1.5 days in total.");
    expect(insightText({ code: "scope_creep", severity: "warn", params: { added: 2, addedCount: 1, removed: 0, removedCount: 0, reestimated: 0, net: 2, committed: 0, pct: null }, keys: [] })).toContain("nothing estimated was committed");
    expect(insightText({ code: "cost_per_point", severity: "info", params: { perPoint: 0.5, issues: 3, points: 9, total: 4.5, outliers: 0, unpriced: 2 }, keys: [] })).toBe(
      "Co-Dev costs $0.5 per point (3 finished issues, 9 points, $4.5). 2 turn(s) have no price and are not counted.",
    );
    expect(insightText({ code: "from_the_future", severity: "info", params: {}, keys: [] })).toBe("from_the_future");
    expect(withheldText({ code: "aging_wait", params: { need: 5, have: 2 } })).toBe("Aging cards: needs 5 finished issues to know the usual cycle time (has 2).");
  });
});

describe("the Reports view", () => {
  it("shows the insights first, the most severe first, and what still lacks history", async () => {
    const s = await reportsOf(REPORTS);
    document.body.innerHTML = renderProject(s.state(), NOW);
    const ins = document.querySelector(".pj-insights")!;
    expect(document.querySelector(".pj-reports > .pj-card-box")).toBe(ins);
    const rows = [...ins.querySelectorAll<HTMLElement>(".pj-ins")];
    expect(rows.map((r) => r.dataset.code)).toEqual(["forecast_late", "scope_creep", "unestimated"]);
    expect(rows[0].classList.contains("sev-risk")).toBe(true);
    expect(rows[0].textContent).toContain("about 6 of the 12 points left");
    expect(ins.querySelector(".pj-ins-held summary")!.textContent).toBe("Not enough data yet (1)");
    expect(ins.querySelector(".pj-ins-held")!.textContent).toContain("needs 2 closed sprints with a recorded commitment (has 1)");
  });

  it("an issue key opens the issue; a key that no longer exists is shown, not linked", async () => {
    const s = await reportsOf(REPORTS);
    document.body.innerHTML = renderProject(s.state(), NOW);
    const chips = [...document.querySelectorAll<HTMLElement>('.pj-ins[data-code="forecast_late"] .pj-ins-key')];
    expect(chips.map((c) => [c.textContent, c.dataset.action, c.dataset.on])).toEqual([
      ["PRJ-2", "pj-open", "PRJ-2"],
      ["PRJ-1", "pj-open", "PRJ-1"],
    ]);
    const gone = document.querySelector('.pj-ins[data-code="scope_creep"] .pj-ins-key')!;
    expect(gone.classList.contains("gone")).toBe(true);
    expect(gone.hasAttribute("data-action")).toBe(false);
    // the same table entry as the composition root (index.ts: «pj-open» selects the issue)
    bindActions({ "pj-open": { click: (e) => s.select(e.on) } });
    chips[0].click();
    expect(s.state().selected).toBe("PRJ-2");
    document.body.innerHTML = renderProject(s.state(), NOW);
    expect(document.querySelector(".pj")!.classList.contains("with-issue")).toBe(true);
  });

  it("draws the burndown from the commitment, the burnup with its scope line and committed vs done", async () => {
    const s = await reportsOf(REPORTS);
    document.body.innerHTML = renderProject(s.state(), NOW);
    const html = document.querySelector(".pj-reports")!.innerHTML;
    expect(html).toContain("12 of 16 points left in Sprint 2 · the ideal line starts at the 11 committed");
    expect(html).toContain("4 of 16 points done");
    expect(document.querySelectorAll(".pj-scope")).toHaveLength(1);
    expect(document.querySelectorAll(".pj-done")).toHaveLength(1);
    expect(document.querySelectorAll(".pj-commit")).toHaveLength(1);
    // the ideal line starts at the commitment, scaled to the highest point (16), not off the chart
    const ideal = document.querySelector(".pj-ideal")!.getAttribute("points")!.split(" ")[0];
    expect(Number(ideal.split(",")[1])).toBeGreaterThan(0);
    expect(document.querySelector(".pj-unest")!.textContent).toContain("PRJ-4");
    // velocity: two bars for the recorded sprint, one (marked) for the partial one
    expect(document.querySelectorAll(".pj-bar.commit")).toHaveLength(1);
    expect(document.querySelectorAll(".pj-bar.partial")).toHaveLength(1);
    expect(html).toContain("Sprint 0*");
    expect(html).toContain("Sprint 1: committed 11, done 6 (3 of the commitment); +3 added, −3 removed, 5 carried over");
    expect(html).not.toContain("started before dxtutor recorded sprint history");
  });

  it("a sprint that started before the history says so", async () => {
    const partial = { ...REPORTS, burndown: { ...REPORTS.burndown, committed: null, total: 11, partial: true, unestimated: [] } };
    const s = await reportsOf(partial);
    document.body.innerHTML = renderProject(s.state(), NOW);
    const html = document.querySelector(".pj-reports")!.innerHTML;
    expect(html).toContain("the ideal line starts at the 11 of the first day");
    expect(html).toContain("This sprint started before dxtutor recorded sprint history (");
    expect(document.querySelectorAll(".pj-commit")).toHaveLength(0);
  });

  it("without history: no charts, and the insights say they need it (Kanban has no sprint charts)", async () => {
    const empty = { cycle: [], cycleMedian: null, cycleP85: null, throughput: [], cfd: [], burndown: null, velocity: [] };
    const s = await reportsOf(empty);
    const html = renderProject(s.state(), NOW);
    expect(html).toContain("No insights yet");
    expect(html).toContain("Start a sprint to see its burndown.");
    expect(html).toContain("Appears once a sprint or iteration is running.");
    expect(html).not.toContain("<svg");
    const k = await reportsOf(empty, "kanban");
    const kh = renderProject(k.state(), NOW);
    expect(kh).toContain("No insights yet");
    expect(kh).not.toContain("Burnup");
    expect(kh).not.toContain("Velocity");
  });

});
