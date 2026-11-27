import { describe, expect, it, vi, beforeEach } from "vitest";
import { blockers, canIntegrate, checkRows, evidenceText, parseEvent, parseIntegrated, parseState, type ReviewState } from "../src/features/integration/domain/types";
import { makeReviewService } from "../src/features/integration/application/review-service";
import type { ReviewDeps, ReviewGateway } from "../src/features/integration/application/ports";
import { INTEGRATION_MESSAGES, type IntegrationKey } from "../src/features/integration/application/messages";
import { conditionText, renderPanel, showPanel, type T } from "../src/features/integration/ui/panel-view";
import { renderProject } from "../src/features/project/ui/view";
import { parseProject } from "../src/features/project/domain/types";

/* Multi Co-Dev, phase 4: the review panel. The gate itself (the three conditions, stale tips, the exact
   command, the audit) is Rust's — `cargo test -p tutor-board integration`, `-p tutor-eval gitwork::integrate`,
   `-p dxtutor-ide codev_review`. Here: the backend's answers are narrowed so that nothing malformed opens the
   gate, the panel says every condition with its evidence and why «Integrate» is off, and the use case asks
   the shared approval dialog with the backend's command, audits a refusal and never integrates by itself. */

const t: T = (k, p) => {
  const s = INTEGRATION_MESSAGES.en[k];
  return p ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in p ? String(p[n]) : all)) : s;
};

const TIPS = { target: "main", base: "b".repeat(40), branch: "feature/dx-2-pay", head: "h".repeat(40) };

const review = (over: Record<string, unknown> = {}) => ({
  id: 7,
  key: "DX-2",
  tips: TIPS,
  candidate: "c".repeat(40),
  tree: "e".repeat(40),
  criteria: ["Given a cart When I pay Then it is paid", "Given a payment When the test runs Then it passes"],
  required: [{ name: "tests", command: "cargo test" }],
  checks: [{ name: "tests", command: "cargo test", exit: 0, passed: true, tail: "test result: ok. 3 passed", ms: 4200, timedOut: false }],
  archRules: true,
  arch: [],
  conflicts: [],
  scan: { tool: "built-in", files: 1, findings: [] },
  verdict: {
    overall: "met",
    summary: "Both hold.",
    criteria: [
      { index: 1, text: "Given a cart When I pay Then it is paid", status: "met", evidence: [{ kind: "file", ref: "src/pay.rs", lines: "1-4" }], note: "" },
      { index: 2, text: "Given a payment When the test runs Then it passes", status: "met", evidence: [{ kind: "test", ref: "pays" }, { kind: "output", ref: "tests", detail: "ok" }], note: "" },
    ],
  },
  reviewer: "claude-opus-5-5",
  tokensIn: 900,
  tokensOut: 100,
  state: "reviewed",
  error: null,
  actor: "Ana",
  created: 1,
  updated: 2,
  ...over,
});

const ok = (items: string[] = []) => ({ ok: true, code: "ok", items });
const no = (code: string, items: string[] = []) => ({ ok: false, code, items });

const raw = (over: Record<string, unknown> = {}) => ({
  key: "DX-2",
  title: "Pay by card",
  review: review(),
  running: false,
  tips: TIPS,
  tipsError: null,
  ahead: 2,
  checks: [{ name: "tests", command: "cargo test" }],
  criteria: review().criteria,
  gate: { checks: ok(["tests"]), reviewer: ok(), functional: ok(["Rita"]), ok: true },
  request: "git -C /p merge-tree …",
  requestBlocked: null,
  integrate: "git -C /p merge --ff-only " + "c".repeat(40),
  uncommitted: [],
  session: "S2",
  ...over,
});

const state = (over: Record<string, unknown> = {}): ReviewState => parseState(raw(over))!;

describe("the backend's answers, narrowed", () => {
  it("reads the gate, the review with its evidence, and what each button runs", () => {
    const s = state();
    expect(s.gate.ok).toBe(true);
    expect(s.review!.checks[0]).toMatchObject({ name: "tests", exit: 0, passed: true });
    expect(s.review!.verdict!.criteria[1].evidence.map(evidenceText)).toEqual(["test pays", "output tests — «ok»"]);
    expect(evidenceText({ kind: "file", ref: "src/pay.rs", lines: "1-4", detail: null })).toBe("src/pay.rs:1-4");
    expect(s.review!.scanFindings).toBe(0);
    expect(canIntegrate(s)).toBe(true);
    expect(parseIntegrated({ key: "DX-2", target: "main", commit: "c1", snapshot: 3, state: "done", session: null, worktreeRemoved: true, worktreeKept: [] })!.worktreeRemoved).toBe(true);
    expect(parseEvent({ root: "/p", key: "DX-2", review: 7, stage: "check", name: "tests", index: 0 })!.name).toBe("tests");
    expect(parseEvent({ stage: "x" })).toBeNull();
  });

  it("nothing malformed opens the gate", () => {
    // a gate without conditions: every one false
    const s = parseState(raw({ gate: { ok: true } }))!;
    expect(blockers(s).map((b) => b.id)).toEqual(["checks", "reviewer", "functional"]);
    expect(canIntegrate(s)).toBe(false);
    // the backend gave no command: no integration even with the gate open
    expect(canIntegrate(state({ integrate: null }))).toBe(false);
    // a review running: never
    expect(canIntegrate(state({ running: true }))).toBe(false);
    expect(parseState({ key: "DX-2" })).toBeNull();
    expect(parseState(null)).toBeNull();
  });

  it("the check rows follow the review's checks (or the project's, before a review)", () => {
    expect(checkRows(state()).map((r) => [r.name, r.run?.passed])).toEqual([["tests", true]]);
    expect(checkRows(state({ review: null })).map((r) => [r.name, r.run])).toEqual([["tests", null]]);
  });
});

describe("the panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("says every condition, with its evidence, and lets integrate only when all three hold", () => {
    const html = renderPanel(t, { key: "DX-2", state: state(), error: null, stage: null, busy: false, detected: null });
    document.body.innerHTML = html;
    const conds = [...document.querySelectorAll(".ig-cond")];
    expect(conds.map((c) => c.getAttribute("data-cond"))).toEqual(["checks", "reviewer", "functional"]);
    expect(conds.every((c) => c.classList.contains("ok"))).toBe(true);
    expect(conds[0].textContent).toContain("All passed on eeeeeeee: tests");
    expect(conds[0].textContent).toContain("cargo test");
    expect(conds[0].textContent).toContain("exit 0 · 4.2 s");
    expect(conds[1].textContent).toContain("src/pay.rs:1-4");
    expect(conds[1].textContent).toContain("claude-opus-5-5 · 1000 tokens");
    expect(conds[2].textContent).toContain("Recorded by Rita");
    const integrate = document.querySelector('[data-action="integration:integrate"]') as HTMLButtonElement;
    expect(integrate.disabled).toBe(false);
    expect(integrate.getAttribute("data-on")).toBe("DX-2");
  });

  it("with a condition off, Integrate is disabled and the panel says why", () => {
    const s = state({
      gate: { checks: no("stale_head", ["feature/dx-2-pay"]), reviewer: no("stale"), functional: no("criteria_changed", ["Rita"]), ok: false },
      integrate: null,
    });
    document.body.innerHTML = renderPanel(t, { key: "DX-2", state: s, error: null, stage: null, busy: false, detected: null });
    const integrate = document.querySelector('[data-action="integration:integrate"]') as HTMLButtonElement;
    expect(integrate.disabled).toBe(true);
    const foot = document.querySelector(".ig-foot")!.textContent!;
    expect(foot).toContain("Integrate is disabled until all three conditions hold.");
    expect(foot).toContain("feature/dx-2-pay moved since the review");
    expect(foot).toContain("Given by Rita for other acceptance criteria");
    expect(document.querySelectorAll(".ig-cond.bad")).toHaveLength(3);
  });

  it("names failed checks with their output, the conflict files, the reviewer's not met, and an unknown code as unknown", () => {
    const failed = state({
      review: review({ state: "checked", verdict: null, checks: [{ name: "tests", command: "cargo test", exit: 101, passed: false, tail: "test pays ... FAILED", ms: 900, timedOut: false }] }),
      gate: { checks: no("failed", ["tests"]), reviewer: no("skipped"), functional: ok(["Rita"]), ok: false },
      integrate: null,
    });
    document.body.innerHTML = renderPanel(t, { key: "DX-2", state: failed, error: null, stage: null, busy: false, detected: null });
    expect(document.querySelector(".ig-cond[data-cond=checks]")!.textContent).toContain("Failed: tests");
    expect(document.querySelector(".ig-tail")!.textContent).toBe("test pays ... FAILED");
    expect(document.querySelector(".ig-cond[data-cond=reviewer]")!.textContent).toContain("the checks must pass first");
    const s = state();
    expect(conditionText(t, "checks", no("conflict", ["src/cart.rs"]), s)).toContain("src/cart.rs");
    expect(conditionText(t, "reviewer", no("not_met", ["1"]), s)).toBe("Not met: criterion 1.");
    expect(conditionText(t, "checks", no("from_the_future"), s)).toBe("Unknown state (from_the_future).");
    expect(conditionText(t, "functional", { ok: true, code: "brand_new", items: [] }, s)).toBe("Unknown state (brand_new).");
  });

  it("without mandatory checks it offers the detected test command; a running review shows its step and Stop", () => {
    const none = state({ review: null, checks: [], gate: { checks: no("none_set"), reviewer: no("no_review"), functional: no("not_recorded"), ok: false }, request: null, requestBlocked: "the project has no mandatory checks", integrate: null });
    document.body.innerHTML = renderPanel(t, { key: "DX-2", state: none, error: null, stage: null, busy: false, detected: "cargo test" });
    expect(document.querySelector('[data-action="integration:detected"]')!.textContent).toBe("Use «cargo test» as the mandatory check");
    expect((document.querySelector('[data-action="integration:request"]') as HTMLButtonElement).disabled).toBe(true);
    const running = state({ running: true, gate: { checks: no("running"), reviewer: no("running"), functional: ok(["Rita"]), ok: false }, integrate: null });
    document.body.innerHTML = renderPanel(t, { key: "DX-2", state: running, error: null, stage: "Running tests…", busy: false, detected: null });
    expect(document.querySelector(".ig-stage")!.textContent).toBe("Running tests…");
    expect(document.querySelector('[data-action="integration:cancel"]')).not.toBeNull();
  });

  it("is one dialog that keeps an opened output open across a refresh, and goes away on close", () => {
    const html = renderPanel(t, { key: "DX-2", state: state(), error: null, stage: null, busy: false, detected: null });
    showPanel(html);
    (document.querySelector("#ig-panel details") as HTMLDetailsElement).open = true;
    showPanel(html);
    expect(document.querySelectorAll("#ig-panel")).toHaveLength(1);
    expect((document.querySelector("#ig-panel details") as HTMLDetailsElement).open).toBe(true);
    showPanel(null);
    expect(document.getElementById("ig-panel")).toBeNull();
  });
});

function harness(over: Partial<ReviewGateway> = {}, approved = true) {
  let current: ReviewState = state();
  const listeners: Array<(e: ReturnType<typeof parseEvent> & object) => void> = [];
  const gateway: ReviewGateway = {
    state: vi.fn(async () => current),
    request: vi.fn(async () => 8),
    cancel: vi.fn(async () => true),
    integrate: vi.fn(async () => ({ key: "DX-2", target: "main", commit: "c".repeat(40), snapshot: 5, state: "done", session: "S2", worktreeRemoved: false, worktreeKept: [] })),
    onEvent: vi.fn(async (f) => {
      listeners.push(f);
      return () => undefined;
    }),
    ...over,
  };
  const notes: string[] = [];
  const deps: ReviewDeps = {
    gateway,
    root: () => "/p",
    approve: vi.fn(async () => ({ approved, reason: "", decidedAt: 42 })),
    audit: vi.fn(async () => undefined),
    guard: vi.fn(<T,>(f: () => Promise<T>) => f()),
    reviewer: () => ({ provider: "claude", model: "claude-opus-5-5", language: "en" }),
    detectedTest: () => "cargo test",
    setChecks: vi.fn(async () => undefined),
    closeSession: vi.fn(() => true),
    projectChanged: vi.fn(),
    notify: (m) => notes.push(m),
    copy: (k: IntegrationKey, p) => t(k, p),
  };
  return { svc: makeReviewService(deps), deps, gateway, notes, set: (s: ReviewState) => (current = s), emit: (e: unknown) => listeners.forEach((f) => f(parseEvent(e)!)) };
}

describe("the review use case", () => {
  it("requests a review with the backend's exact command, after the human approves it", async () => {
    const h = harness();
    await h.svc.open("DX-2");
    await h.svc.request("DX-2");
    expect(h.deps.approve).toHaveBeenCalledWith(expect.objectContaining({ command: "git -C /p merge-tree …", title: "Review DX-2: merge onto main, run the checks and the reviewer" }));
    expect(h.gateway.request).toHaveBeenCalledWith("/p", "DX-2", "git -C /p merge-tree …", 42, { provider: "claude", model: "claude-opus-5-5", language: "en" });
  });

  it("a refused request or integration runs nothing and is audited", async () => {
    const h = harness({}, false);
    await h.svc.open("DX-2");
    await h.svc.request("DX-2");
    await h.svc.integrate("DX-2");
    expect(h.gateway.request).not.toHaveBeenCalled();
    expect(h.gateway.integrate).not.toHaveBeenCalled();
    expect(h.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ action: "review.request", approved: false, decidedAt: 42 }));
    expect(h.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ action: "review.integrate", approved: false, command: "git -C /p merge --ff-only " + "c".repeat(40) }));
  });

  it("integrates only with the gate open on a fresh read, through the secret-scan guard, then closes the issue's Co-Dev", async () => {
    const h = harness();
    await h.svc.open("DX-2");
    // the gate closed meanwhile (the fresh read): no dialog, nothing runs
    h.set(state({ gate: { checks: no("stale_base", ["main"]), reviewer: no("stale"), functional: ok(["Rita"]), ok: false }, integrate: null }));
    await h.svc.integrate("DX-2");
    expect(h.deps.approve).not.toHaveBeenCalled();
    expect(h.gateway.integrate).not.toHaveBeenCalled();
    h.set(state());
    await h.svc.integrate("DX-2");
    expect(h.deps.approve).toHaveBeenCalledWith(expect.objectContaining({ title: "Integrate DX-2 into main", scope: "branch main · bbbbbbbb → cccccccc" }));
    expect(h.deps.guard).toHaveBeenCalled();
    expect(h.gateway.integrate).toHaveBeenCalledWith("/p", "DX-2", "git -C /p merge --ff-only " + "c".repeat(40), 42);
    expect(h.deps.closeSession).toHaveBeenCalledWith("S2");
    expect(h.deps.projectChanged).toHaveBeenCalled();
    expect(h.notes.at(-1)).toContain("DX-2 integrated into main (cccccccc); the issue is in «done». Undo: snapshot #5.");
  });

  it("a backend refusal is said, and nothing else happens", async () => {
    const h = harness({ integrate: vi.fn(async () => Promise.reject(new Error("the gate does not hold: functional: not_recorded"))) });
    await h.svc.open("DX-2");
    await h.svc.integrate("DX-2");
    expect(h.notes.at(-1)).toBe("the gate does not hold: functional: not_recorded");
    expect(h.deps.closeSession).not.toHaveBeenCalled();
  });

  it("follows a running review's steps and reads the gate again when it is done", async () => {
    const h = harness();
    await h.svc.open("DX-2");
    h.emit({ root: "/p", key: "DX-2", review: 8, stage: "check", name: "tests", index: 0 });
    expect(h.svc.stage("DX-2")).toBe("Running tests…");
    // another folder's review is not ours
    h.emit({ root: "/other", key: "DX-2", review: 9, stage: "reviewer" });
    expect(h.svc.stage("DX-2")).toBe("Running tests…");
    const reads = (h.gateway.state as ReturnType<typeof vi.fn>).mock.calls.length;
    h.emit({ root: "/p", key: "DX-2", review: 8, stage: "done", state: "reviewed" });
    await vi.waitFor(() => expect((h.gateway.state as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads + 1));
    expect(h.svc.stage("DX-2")).toBeNull();
    expect(h.notes).toContain("Review of DX-2: reviewed.");
  });

  it("sets the detected test command as the mandatory check on request", async () => {
    const h = harness();
    await h.svc.open("DX-2");
    await h.svc.useDetected("DX-2");
    expect(h.deps.setChecks).toHaveBeenCalledWith([{ name: "tests", command: "cargo test" }]);
  });
});

describe("the Project's issue panel", () => {
  const project = (branch: string | null) =>
    parseProject({
      root: "/shop",
      keyPrefix: "SH",
      method: "kanban",
      iterDays: 14,
      wip: {},
      dor: [],
      dod: [],
      checks: [],
      issues: [{ key: "SH-1", title: "Cart total", kind: "story", priority: "high", points: 5, state: "review", assignee: "Ana", rank: 0, ready: true, acceptance: [{ text: "Given a cart When I add Then it counts", done: true }], dodDone: [], links: [], scope: ["src/cart/**"], deps: [], missing: [], functional: null, branch }],
      sprints: [],
      releases: [],
      retro: [],
      inbox: [],
    })!;

  it("opens «Review & integrate» for an issue with a branch, and says nothing without one", () => {
    const st = (p: ReturnType<typeof project>) => ({ status: "ready", project: p, error: null, view: "board", selected: "SH-1", detail: null, reports: null, filters: { q: "", quick: [], me: "Ana" }, swim: "epic", prompt: null, drift: null, sprintPlan: null, testCommand: "cargo test" }) as unknown as Parameters<typeof renderProject>[0];
    const NOW = Date.UTC(2026, 10, 27, 12);
    const withBranch = renderProject(st(project("feature/sh-1-cart")), NOW);
    expect(withBranch).toContain('data-action="pj-integration"');
    expect(withBranch).toContain("Branch feature/sh-1-cart");
    expect(renderProject(st(project(null)), NOW)).not.toContain('data-action="pj-integration"');
  });
});
