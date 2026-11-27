// Learning Track: preparing a course that is graded offline against a course cache (Learn P1, the
// Seiva course; Learn P2a, the pip cache of the Django course). The use case on its own (fakes), then the real chain of modules with a fake Tauri
// IPC: the «Prepare this course» card, the shared approval dialog with the EXACT command the backend
// built, the refusal audited from the UI, and `course_prepare` called with the approved command.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { isNotPrepared, needsPreparing, prepareCourse } from "../src/features/learn/application/prepare-service";
import type { CourseGateway } from "../src/features/learn/application/ports";
import { packageLines } from "../src/features/learn/application/prepare-service";
import type { CoursePackage, PrepareStatus } from "../src/features/learn/domain/types";

const COMMAND = "# Cargo.toml [dependencies] of the course\n#   seiva = { git = \"https://github.com/ngolacloud/seiva\", tag = \"v0.2.0\" }\ncd /data/cc/seiva-basics/prepare\nCARGO_HOME=/data/cc/seiva-basics/cargo-home cargo fetch";
const SEIVA_PACKAGES: CoursePackage[] = [
  { name: "seiva", version: "tag v0.2.0", source: "https://github.com/ngolacloud/seiva", pinned: true },
  { name: "tokio", version: "1", source: "crates.io", pinned: false },
];
const status = (state: PrepareStatus["state"], extra: Partial<PrepareStatus> = {}): PrepareStatus => ({
  needed: state !== "not-needed", state, command: state === "not-needed" ? "" : COMMAND, kind: state === "not-needed" ? "" : "cargo",
  packages: state === "not-needed" ? [] : SEIVA_PACKAGES, dir: "/data/cc/seiva-basics", timeoutSecs: 240, fetchSecs: null, warmSecs: null, ...extra,
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

  it("the dialog lists every package with its version and source, with the note for its package manager", async () => {
    expect(packageLines([...SEIVA_PACKAGES, { name: "Django", version: "5.2.19", source: "PyPI", pinned: true }, { name: "odd", version: "", source: "", pinned: false }]))
      .toEqual(["seiva tag v0.2.0 · https://github.com/ngolacloud/seiva", "tokio 1 · crates.io", "Django 5.2.19 · PyPI", "odd"]);
    const { gw } = fakeGateway(status("missing"));
    const approve = vi.fn(async () => ({ approved: false, reason: "", decidedAt: 1 }));
    const packagesText = (kind: string) => ({ heading: "Packages", note: `note for ${kind}` });
    await prepareCourse({ gw, human: { approve }, audit: { record: vi.fn(async () => undefined) }, title: "T", packagesText }, "seiva-basics");
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      command: COMMAND,
      list: { heading: "Packages", items: ["seiva tag v0.2.0 · https://github.com/ngolacloud/seiva", "tokio 1 · crates.io"], note: "note for cargo" },
    }));
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
const PIP_COMMAND = "# requirements.txt of the course: exact versions, sha256-checked, wheels only\n#   Django==5.2.19 --hash=sha256:" + "5".repeat(64) + "\ncd /data/cc/django-basics\n/usr/bin/python3 -m venv --clear /data/cc/django-basics/venv";
const DJANGO = {
  id: "django-basics", language: "python", category: "framework", subject: "django", title: "Django: Web Apps the Batteries-Included Way", level: "intermediate",
  summary: "Build a Django app.", overview: "Django is a Python web framework.", prepare: true,
  units: [{ id: "dj-u01-views", title: "Views and URLs", intro: "", concepts: "Requests and responses.", difficulty: 1, level: "basic", steps: [
    step({ kind: "challenge", id: "dj-u01-p1-pages", title: "First pages", points: 30, entry: "home", instructions: "Write the views.", starter: "def home(request):\n    ...\n" }),
  ] }],
};
let pipMode = false;
const dto = (state: PrepareStatus["state"]) => pipMode
  ? { ...status(state), command: PIP_COMMAND, kind: "pip", dir: "/data/cc/django-basics", timeoutSecs: 180,
    packages: [{ name: "Django", version: "5.2.19", source: "PyPI", pinned: true }, { name: "asgiref", version: "3.12.1", source: "PyPI", pinned: true }], preparedAt: null }
  : { ...status(state), preparedAt: null };

function fakeTauri(approveAudit: (a: Record<string, unknown>) => void = () => undefined): void {
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    plugin_list: () => [],
    list_courses: () => [
      { id: "seiva-basics", language: "rust", category: "framework", subject: "seiva", title: "Seiva", level: "intermediate", summary: "s" },
      { id: "django-basics", language: "python", category: "framework", subject: "django", title: "Django", level: "intermediate", summary: "s" },
    ],
    get_course: (a) => (a.subject === "seiva" ? SEIVA : a.subject === "django" ? DJANGO : Promise.reject(new Error("no course"))),
    course_prepare_status: () => dto(prepState),
    course_prepare: () => { prepState = "ready"; return { ok: true, output: "", status: { ...dto("ready"), fetchSecs: pipMode ? 6.7 : 20.6, warmSecs: pipMode ? 8.0 : 21.2 } }; },
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
  pipMode = false;
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
    // the crates it downloads, by name and version, with the cargo note
    const items = [...document.querySelectorAll("#approval .appr-list li")].map(li => li.textContent);
    expect(items).toEqual(["seiva tag v0.2.0 · https://github.com/ngolacloud/seiva", "tokio 1 · crates.io"]);
    expect(document.querySelector("#approval .appr-note")!.textContent).toMatch(/Cargo also downloads the crates these depend on/);
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

describe("the Django course (a pip course cache) in the Learning Track", () => {
  async function openDjango() {
    pipMode = true;
    LM.ltOnboard(1);
    await vi.waitFor(() => expect(document.querySelector('#onb .onb-fw [data-on="django"]')).toBeTruthy());
    document.getElementById("onb")!.classList.remove("show");
    LM.LTS.lang = "django"; LM.LTS.levels = ["basic"];
    LM.ltOpen("dj-u01-p1-pages");
    await vi.waitFor(() => expect(prepButton()).toBeTruthy());
  }

  it("the card speaks of Python packages, and the dialog lists each pinned package before the command", async () => {
    fakeTauri();
    await openDjango();
    const card = document.querySelector('#onb .onb-fw [data-on="django"]') as HTMLButtonElement;
    expect(card.querySelector(".tag")!.textContent).toBe("Available");
    expect(res().textContent).toMatch(/Python packages that are not on this computer yet/);
    expect(res().textContent).toMatch(/Your own Python is not changed/);
    click(prepButton()!);
    await vi.waitFor(() => expect(document.getElementById("approval")).toBeTruthy());
    expect(document.querySelector("#approval h2")!.textContent).toBe("Prepare the Django: Web Apps the Batteries-Included Way course: download and install its Python packages");
    expect([...document.querySelectorAll("#approval .appr-list li")].map(li => li.textContent)).toEqual(["Django 5.2.19 · PyPI", "asgiref 3.12.1 · PyPI"]);
    expect(document.querySelector("#approval .appr-note")!.textContent).toMatch(/checked against its sha256 hash/);
    expect(document.querySelector("#approval .appr-cmd")!.textContent).toBe(PIP_COMMAND);
    click(document.getElementById("appr-ok")!);
    await vi.waitFor(() => expect(calls.some(([c]) => c === "course_prepare")).toBe(true));
    const [, args] = calls.find(([c]) => c === "course_prepare")!;
    expect(args).toMatchObject({ courseId: "django-basics", decision: { command: PIP_COMMAND } });
    await vi.waitFor(() => expect(prepButton()).toBeNull());
    expect(res().textContent).toMatch(/Prepared \(download 7 s, set-up 8 s\)/);
  });
});
