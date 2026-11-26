import { describe, expect, it, vi } from "vitest";
import { approvalBlocker, checksText, effectiveChecks, parseChecks } from "../src/features/project/domain/gate";
import { parseProject } from "../src/features/project/domain/types";
import { makeProjectService } from "../src/features/project/application/project-service";
import type { ProjectDeps } from "../src/features/project/application/ports";
import { renderProject } from "../src/features/project/ui/view";
import { PROJECT_GATE_MESSAGES } from "../src/features/project/ui/gate-messages";
import { PROJECT_ENGINE_MESSAGES } from "../src/features/project/application/messages";

/* Multi Co-Dev, phase 2: the integration gate's data — the project's mandatory checks and the functional
   approval on an issue. The rules (who and when, criteria needed, audited, falls with the criteria; who may
   approve) are tested in Rust (tutor-board, src-tauri roles); here the shape the UI reads, the Settings
   text, the use case and the markup. */

const NOW = Date.UTC(2026, 10, 26, 12);

const project = (over: Record<string, unknown> = {}, issue: Record<string, unknown> = {}) => ({
  root: "/shop",
  keyPrefix: "SH",
  method: "kanban",
  iterDays: 14,
  wip: {},
  dor: [],
  dod: [],
  checks: [],
  issues: [
    { key: "SH-1", title: "Cart total", kind: "story", priority: "high", points: 5, state: "accept", assignee: "Ana", rank: 0, ready: true, acceptance: [{ text: "Given a cart When I add Then it counts", done: true }], dodDone: [], links: [], scope: ["src/cart/**"], deps: [], missing: [], functional: null, ...issue },
  ],
  sprints: [],
  releases: [],
  retro: [],
  inbox: [],
  ...over,
});

describe("the gate's data as the UI reads it", () => {
  it("parses the checks and the approval", () => {
    const p = parseProject(project({ checks: [{ name: "tests", command: "cargo test" }, { name: "", command: "x" }] }, { functional: { by: "Ana", at: NOW, note: "tried it" } }))!;
    expect(p.checks).toEqual([{ name: "tests", command: "cargo test" }]);
    expect(p.issues[0].functional).toEqual({ by: "Ana", at: NOW, note: "tried it" });
    expect(parseProject(project({ checks: undefined }, { functional: undefined }))!.issues[0].functional).toBeNull();
  });

  it("the Settings text: `name: command` per line; a colon inside the command is not a name", () => {
    expect(parseChecks("tests: cargo test --workspace\n\n  lint: cargo clippy -- -D warnings\ncargo test -- a::b")).toEqual({
      checks: [
        { name: "tests", command: "cargo test --workspace" },
        { name: "lint", command: "cargo clippy -- -D warnings" },
        { name: "cargo", command: "cargo test -- a::b" },
      ],
    });
    expect(parseChecks("lint:")).toEqual({ error: "lint:" });
    expect(parseChecks("")).toEqual({ checks: [] });
    expect(checksText([{ name: "tests", command: "npm test" }])).toBe("tests: npm test");
  });

  it("none set: the detected test command holds", () => {
    expect(effectiveChecks([], "cargo test")).toEqual({ checks: [{ name: "tests", command: "cargo test" }], detected: true });
    expect(effectiveChecks([], null)).toEqual({ checks: [], detected: true });
    expect(effectiveChecks([{ name: "e2e", command: "npm run e2e" }], "npm test")).toEqual({ checks: [{ name: "e2e", command: "npm run e2e" }], detected: false });
  });

  it("the approval needs criteria, once", () => {
    const i = parseProject(project())!.issues[0];
    expect(approvalBlocker(i)).toBeNull();
    expect(approvalBlocker({ ...i, acceptance: [] })).toBe("noCriteria");
    expect(approvalBlocker({ ...i, functional: { by: "Ana", at: NOW, note: "" } })).toBe("approved");
  });

  it("every text has both languages", () => {
    expect(Object.keys(PROJECT_GATE_MESSAGES.ptAO).sort()).toEqual(Object.keys(PROJECT_GATE_MESSAGES.en).sort());
    expect(Object.keys(PROJECT_ENGINE_MESSAGES.ptAO).sort()).toEqual(Object.keys(PROJECT_ENGINE_MESSAGES.en).sort());
  });
});

function deps(answers: Array<string | null>) {
  const ops: Array<Record<string, unknown>> = [];
  const toasts: string[] = [];
  let functional: unknown = null;
  const d: ProjectDeps = {
    gateway: {
      available: () => true,
      load: vi.fn(async () => project({}, { functional })),
      apply: vi.fn(async (_r: string, op: Record<string, unknown>) => {
        ops.push(op);
        if (op.op === "approve_functional") functional = { by: "Ana", at: NOW, note: op.note ?? "" };
        if (op.op === "revoke_functional") functional = null;
        return project({}, { functional });
      }),
      issue: vi.fn(async () => ({ activity: [], changeSets: [] })),
      reports: vi.fn(async () => ({})),
    },
    workspace: { root: () => "/shop", me: () => "Ana", testCommand: () => "cargo test" },
    git: { available: () => true, branch: vi.fn(async () => undefined), log: vi.fn(async () => []) },
    codev: { available: () => true, work: vi.fn() },
    dialog: { prompt: () => answers.shift() ?? null, confirm: () => true },
    notify: { toast: (m) => toasts.push(m) },
    now: () => NOW,
  };
  return { d, ops, toasts };
}

describe("the use case", () => {
  it("records the approval with an optional note; cancelling the dialog stops", async () => {
    const t = deps([null, " checked on staging ", ""]);
    const s = makeProjectService(t.d);
    await s.open();
    expect(s.state().testCommand).toBe("cargo test");
    expect(await s.approveFunctional("SH-1")).toBe(false);
    expect(t.ops).toEqual([]);
    expect(await s.approveFunctional("SH-1")).toBe(true);
    expect(t.ops.at(-1)).toEqual({ op: "approve_functional", key: "SH-1", note: "checked on staging" });
    expect(s.state().project!.issues[0].functional?.by).toBe("Ana");
    expect(t.toasts.at(-1)).toContain("SH-1");
    // a withdrawal needs a reason
    expect(await s.revokeFunctional("SH-1")).toBe(false);
    expect(t.ops).toHaveLength(1);
  });

  it("withdraws with the reason", async () => {
    const t = deps(["", "the total is wrong"]);
    const s = makeProjectService(t.d);
    await s.open();
    await s.approveFunctional("SH-1");
    expect(t.ops.at(-1)).toEqual({ op: "approve_functional", key: "SH-1", note: null });
    expect(await s.revokeFunctional("SH-1")).toBe(true);
    expect(t.ops.at(-1)).toEqual({ op: "revoke_functional", key: "SH-1", reason: "the total is wrong" });
    expect(s.state().project!.issues[0].functional).toBeNull();
  });

  it("a refusal from the store (not the responsible) is shown", async () => {
    const t = deps([""]);
    (t.d.gateway.apply as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: "role", message: "a aprovação funcional é do responsável da issue (Ana): és Rui", overridable: false });
    const s = makeProjectService(t.d);
    await s.open();
    expect(await s.approveFunctional("SH-1")).toBe(false);
    expect(t.toasts.at(-1)).toContain("responsável da issue (Ana)");
  });
});

describe("the markup", () => {
  const st = (p: ReturnType<typeof parseProject>, over: Record<string, unknown> = {}) =>
    ({ status: "ready", project: p, error: null, view: "board", selected: "SH-1", detail: null, reports: null, filters: { q: "", quick: [], me: "Ana" }, swim: "epic", prompt: null, drift: null, sprintPlan: null, testCommand: "cargo test", ...over }) as Parameters<typeof renderProject>[0];

  it("the issue panel shows the approval, or the button (off without criteria)", () => {
    const none = renderProject(st(parseProject(project())), NOW);
    expect(none).toContain('data-action="pj-functional-approve"');
    expect(none).not.toContain('data-action="pj-functional-approve" disabled');
    const noCrit = renderProject(st(parseProject(project({}, { acceptance: [] }))), NOW);
    expect(noCrit).toContain('data-action="pj-functional-approve" disabled');
    const done = renderProject(st(parseProject(project({}, { functional: { by: "Ana <b>", at: NOW, note: "on staging" } }))), NOW);
    expect(done).toContain("Ana &lt;b&gt;");
    expect(done).toContain("on staging");
    expect(done).toContain('data-action="pj-functional-revoke"');
  });

  it("Settings list the mandatory checks; none set, the detected command is the default", () => {
    const set = renderProject(st(parseProject(project({ checks: [{ name: "tests", command: "cargo test --workspace" }] })), { view: "settings", selected: null }), NOW);
    expect(set).toContain('name="checks"');
    expect(set).toContain("tests: cargo test --workspace</textarea>");
    const def = renderProject(st(parseProject(project()), { view: "settings", selected: null }), NOW);
    expect(def).toContain("cargo test");
    expect(def).toMatch(/detected test command|comando de testes detectado/);
  });
});
