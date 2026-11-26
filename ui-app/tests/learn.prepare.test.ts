// Learning Track: preparing a course that is graded offline against a course cache (Learn P1, the
// Seiva course). The use case on its own (fakes), then the real chain of modules with a fake Tauri
// IPC: the «Prepare this course» card, the shared approval dialog with the EXACT command the backend
// built, the refusal audited from the UI, and `course_prepare` called with the approved command.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { isNotPrepared, needsPreparing, prepareCourse } from "../src/features/learn/application/prepare-service";
import type { CourseGateway } from "../src/features/learn/application/ports";
import type { PrepareStatus } from "../src/features/learn/domain/types";

const COMMAND = "# Cargo.toml [dependencies] of the course\n#   seiva = { git = \"https://github.com/ngolacloud/seiva\", tag = \"v0.2.0\" }\ncd /data/cc/seiva-basics/prepare\nCARGO_HOME=/data/cc/seiva-basics/cargo-home cargo fetch";
const status = (state: PrepareStatus["state"], extra: Partial<PrepareStatus> = {}): PrepareStatus => ({
  needed: state !== "not-needed", state, command: state === "not-needed" ? "" : COMMAND, dir: "/data/cc/seiva-basics", timeoutSecs: 240, fetchSecs: null, warmSecs: null, ...extra,
});

function fakeGateway(st: PrepareStatus, ok = true) {
  const prepared: Array<{ courseId: string; command: string; reason: string }> = [];
  const gw = {
    prepareStatus: vi.fn(async () => st),
    prepare: vi.fn(async (courseId: string, d: { command: string; reason: string }) => {
      prepared.push({ courseId, command: d.command, reason: d.reason });
      return { ok, output: ok ? "" : "error: failed to fetch", status: ok ? status("ready", { fetchSecs: 20.6, warmSecs: 21.2 }) : st };
    }),
  } as unknown as CourseGateway;
  return { gw, prepared };
}

describe("prepareCourse (the use case)", () => {
  it("a ready course, or one with nothing to prepare, asks nothing", async () => {
    for (const st of [status("ready"), status("not-needed")]) {
      const { gw } = fakeGateway(st);
      const approve = vi.fn();
      const r = await prepareCourse({ gw, human: { approve }, audit: { record: vi.fn() }, title: "T" }, "seiva-basics");
      expect(r.kind).toBe("ready");
      expect(approve).not.toHaveBeenCalled();
      expect(gw.prepare).not.toHaveBeenCalled();
    }
  });

  it("the human sees the exact command; a refusal is audited and nothing runs", async () => {
    const { gw } = fakeGateway(status("missing"));
    const approve = vi.fn(async () => ({ approved: false, reason: "", decidedAt: 7 }));
    const record = vi.fn(async () => undefined);
    const r = await prepareCourse({ gw, human: { approve }, audit: { record }, title: "Prepare Seiva" }, "seiva-basics");
    expect(r.kind).toBe("refused");
    expect(approve).toHaveBeenCalledWith({ title: "Prepare Seiva", command: COMMAND, scope: "course seiva-basics · /data/cc/seiva-basics" });
    expect(record).toHaveBeenCalledWith("/data/cc/seiva-basics", {
      feature: "learn", action: "course.prepare", command: COMMAND, scope: "course seiva-basics · /data/cc/seiva-basics", approved: false, reason: undefined, decidedAt: 7,
    });
    expect(gw.prepare).not.toHaveBeenCalled();
  });

  it("an approval runs exactly the approved command; a failure brings the output back", async () => {
    const ok = fakeGateway(status("stale"));
    const human = { approve: vi.fn(async () => ({ approved: true, reason: "first time", decidedAt: 9 })) };
    const r = await prepareCourse({ gw: ok.gw, human, audit: { record: vi.fn() }, title: "T" }, "seiva-basics");
    expect(r).toEqual({ kind: "prepared", status: status("ready", { fetchSecs: 20.6, warmSecs: 21.2 }) });
    expect(ok.prepared).toEqual([{ courseId: "seiva-basics", command: COMMAND, reason: "first time" }]);

    const bad = fakeGateway(status("missing"), false);
    const f = await prepareCourse({ gw: bad.gw, human, audit: { record: vi.fn() }, title: "T" }, "seiva-basics");
    expect(f.kind).toBe("failed");
    expect(f.kind === "failed" && f.output).toBe("error: failed to fetch");
  });

  it("recognises the backend's refusal and what needs preparing", () => {
    expect(isNotPrepared("COURSE_NOT_PREPARED: course `seiva-basics` has not been prepared yet.")).toBe(true);
    expect(isNotPrepared("evaluation failed: boom")).toBe(false);
    expect([status("missing"), status("stale"), status("ready"), status("not-needed")].map(needsPreparing)).toEqual([true, true, false, false]);
    expect(needsPreparing(null)).toBe(false);
  });
});

/* ───── the real chain: the card, the dialog, the IPC ───── */

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let LM: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Array<[string, Record<string, unknown>]>;
let prepState: PrepareStatus["state"];

const step = (over: Record<string, unknown>) => ({
  kind: "concept", id: "", title: "", points: 10, intro: "Briefing.", difficulty: 1, body: "", prompt: "", target: "", explanation: "",
  lineComments: [], placeholderPolicy: "shown", installCommands: [], runCommand: "", dependencies: [], instructions: "", entry: "", starter: "",
  ...over,
});
const SEIVA = {
  id: "seiva-basics", language: "rust", category: "framework", subject: "seiva", title: "Seiva: Backends That Keep Their Shape", level: "intermediate",
  summary: "Build a Seiva module.", overview: "Seiva is a Rust backend framework.", prepare: true,
  units: [{ id: "sv-u1-domain", title: "The domain", intro: "", concepts: "Rules in constructors.", difficulty: 1, level: "basic", steps: [
    step({ kind: "challenge", id: "sv-ch1-task", title: "The task entity", points: 30, entry: "Task", instructions: "Implement `Task::new`.", starter: "pub struct Task;\n" }),
  ] }],
};
const dto = (state: PrepareStatus["state"]) => ({ ...status(state), preparedAt: null });

function fakeTauri(approveAudit: (a: Record<string, unknown>) => void = () => undefined): void {
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    plugin_list: () => [],
    list_courses: () => [{ id: "seiva-basics", language: "rust", category: "framework", subject: "seiva", title: "Seiva", level: "intermediate", summary: "s" }],
    get_course: (a) => (a.subject === "seiva" ? SEIVA : Promise.reject(new Error("no course"))),
    course_prepare_status: () => dto(prepState),
    course_prepare: () => { prepState = "ready"; return { ok: true, output: "", status: { ...dto("ready"), fetchSecs: 20.6, warmSecs: 21.2 } }; },
    audit_record: (a) => { approveAudit(a); return null; },
    submit_step: () => Promise.reject(new Error("COURSE_NOT_PREPARED: course `seiva-basics` has not been prepared yet.")),
  };
  w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd);
    return handlers[cmd](args);
  } } };
}

beforeEach(async () => {
  w = await bootApp();
  calls = [];
  prepState = "missing";
  LM = await import("../src/features/learn");
  LM.course();
  LM.LTS.lang = null; LM.LTS.levels = []; LM.LTS.cur = null; LM.LTS.done = {};
});

afterEach(() => {
  delete w.__TAURI__;
  document.getElementById("onb")?.remove();
  document.getElementById("approval")?.remove();
  vi.restoreAllMocks();
});

const res = () => document.getElementById("lt-res")!;
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const prepButton = () => document.querySelector<HTMLButtonElement>('#lt-res [data-action="lt-prepare"]');

async function openSeiva() {
  LM.ltOnboard(1);
  await vi.waitFor(() => expect(document.querySelector('#onb .onb-fw [data-on="seiva"]')).toBeTruthy());
  document.getElementById("onb")!.classList.remove("show");
  LM.LTS.lang = "seiva"; LM.LTS.levels = ["basic"];
  LM.ltOpen("sv-ch1-task");
  await vi.waitFor(() => expect(prepButton()).toBeTruthy());
}

describe("the Seiva course in the Learning Track", () => {
  it("the Seiva card is available, and an unprepared course shows «Prepare this course»", async () => {
    fakeTauri();
    await openSeiva();
    const card = document.querySelector('#onb .onb-fw [data-on="seiva"]') as HTMLButtonElement;
    expect(card.querySelector(".tag")!.textContent).toBe("Available");
    expect(res().textContent).toMatch(/Prepare this course/);
    expect(res().textContent).toMatch(/Grading never uses the network/);
    expect(calls).toContainEqual(["course_prepare_status", { courseId: "seiva-basics" }]);
  });

  it("approving runs `course_prepare` with the command shown in the dialog, and the card goes away", async () => {
    fakeTauri();
    await openSeiva();
    click(prepButton()!);
    await vi.waitFor(() => expect(document.getElementById("approval")).toBeTruthy());
    expect(document.querySelector("#approval .appr-cmd")!.textContent).toBe(COMMAND);
    click(document.getElementById("appr-ok")!);
    await vi.waitFor(() => expect(calls.some(([c]) => c === "course_prepare")).toBe(true));
    const [, args] = calls.find(([c]) => c === "course_prepare")!;
    expect(args.courseId).toBe("seiva-basics");
    expect((args.decision as { command: string }).command).toBe(COMMAND);
    await vi.waitFor(() => expect(prepButton()).toBeNull());
    expect(res().textContent).toMatch(/Prepared \(download 21 s, build 21 s\)/);
    // the UI records nothing for an approval: the backend audits what it runs
    expect(calls.some(([c]) => c === "audit_record")).toBe(false);
  });

  it("a refusal is audited from the UI and nothing is prepared", async () => {
    const audited: Array<Record<string, unknown>> = [];
    fakeTauri((a) => audited.push(a));
    await openSeiva();
    click(prepButton()!);
    await vi.waitFor(() => expect(document.getElementById("approval")).toBeTruthy());
    click(document.getElementById("appr-no")!);
    await vi.waitFor(() => expect(audited).toHaveLength(1));
    expect(audited[0].root).toBe("/data/cc/seiva-basics");
    expect(audited[0].entry).toMatchObject({ feature: "learn", action: "course.prepare", command: COMMAND, approved: false });
    expect(calls.some(([c]) => c === "course_prepare")).toBe(false);
    await vi.waitFor(() => expect(res().textContent).toMatch(/Not prepared/));
  });
});
