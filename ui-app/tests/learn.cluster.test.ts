// Learning Track: the practice cluster of the Kubernetes course (Learn P3b) — kind on rootless
// Podman, only for the live units. The use case with fakes, then the real chain with a fake Tauri
// IPC: an offline step shows neither the preparation nor the cluster; a live step shows what the
// machine lacks, or the cluster's state with «Start practice cluster» / «Delete cluster», each run
// with the EXACT command the backend built, approved in the shared dialog (a refusal is audited).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { canRunCluster, isLiveUnavailable, memoryMiB, runClusterAction } from "../src/features/learn/application/cluster-service";
import type { CourseGateway } from "../src/features/learn/application/ports";
import type { ClusterState } from "../src/features/learn/domain/types";
import { fromCourseDto } from "../src/features/learn/domain/course-adapter";

const START = "podman network create --internal --label io.dxtutor.sandbox=kind dxtutor-kind\nkind create cluster --name dxtutor-kubernetes-basics --image docker.io/kindest/node:v1.36.4@sha256:" + "0".repeat(64) + " --kubeconfig /data/cc/kubernetes-basics/cluster/kubeconfig --wait 180s\nkind load image-archive /data/cc/kubernetes-basics/cluster/images.tar --name dxtutor-kubernetes-basics";
const DELETE = "kind delete cluster --name dxtutor-kubernetes-basics --kubeconfig /data/cc/kubernetes-basics/cluster/kubeconfig\npodman network rm --force dxtutor-kind";
const DIR = "/data/cc/kubernetes-basics/cluster";

const cluster = (over: Partial<ClusterState> = {}, running = false): ClusterState => ({
  live: true,
  prepared: true,
  support: { ok: true, podman: "podman version 4.9.3", reason: null, fix: null },
  status: {
    name: "dxtutor-kubernetes-basics", exists: running, running, createdAt: running ? 1_800_000_000 : null, lastUsed: running ? 1_800_000_000 : null,
    createSecs: running ? 44.3 : null, memoryBytes: running ? 642 * 1024 * 1024 : null, idleDeadline: running ? 1_800_001_200 : null,
  },
  startCommand: START, deleteCommand: DELETE, dir: DIR, idleMinutes: 20,
  ...over,
});
const NO_PODMAN: ClusterState = cluster({ support: { ok: false, podman: null, reason: "Podman is not installed.", fix: "Install Podman 4.9 or newer, rootless (https://podman.io/docs/installation)." }, status: null });

function fakeGateway(st: ClusterState, after: ClusterState) {
  const runs: Array<{ action: string; command: string; reason: string }> = [];
  const gw = {
    clusterStatus: vi.fn(async () => st),
    clusterAction: vi.fn(async (_id: string, action: string, d: { command: string; reason: string }) => { runs.push({ action, command: d.command, reason: d.reason }); return after; }),
  } as unknown as CourseGateway;
  return { gw, runs };
}

describe("runClusterAction (the use case)", () => {
  it("a machine that cannot run the cluster asks nothing and says why", async () => {
    const { gw } = fakeGateway(NO_PODMAN, NO_PODMAN);
    const approve = vi.fn();
    const r = await runClusterAction({ gw, human: { approve }, audit: { record: vi.fn() }, title: a => a }, "kubernetes-basics", "start");
    expect(r).toEqual({ kind: "unavailable", state: NO_PODMAN });
    expect(approve).not.toHaveBeenCalled();
    expect(canRunCluster(NO_PODMAN)).toBe(false);
    expect(canRunCluster(cluster({ prepared: false }))).toBe(false);
    expect(canRunCluster(cluster())).toBe(true);
  });

  it("the human sees the exact command; a refusal is audited and nothing runs", async () => {
    const { gw, runs } = fakeGateway(cluster(), cluster({}, true));
    const approve = vi.fn(async () => ({ approved: false, reason: "", decidedAt: 3 }));
    const record = vi.fn(async () => undefined);
    const r = await runClusterAction({ gw, human: { approve }, audit: { record }, title: a => `T ${a}` }, "kubernetes-basics", "start");
    expect(r.kind).toBe("refused");
    expect(approve).toHaveBeenCalledWith({ title: "T start", command: START, scope: `course kubernetes-basics · ${DIR}` });
    expect(record).toHaveBeenCalledWith(DIR, { feature: "learn", action: "cluster.start", command: START, scope: `course kubernetes-basics · ${DIR}`, approved: false, reason: undefined, decidedAt: 3 });
    expect(runs).toEqual([]);
  });

  it("an approval runs exactly the approved command, to start or to delete", async () => {
    const human = { approve: vi.fn(async () => ({ approved: true, reason: "practice", decidedAt: 5 })) };
    const s = fakeGateway(cluster(), cluster({}, true));
    expect(await runClusterAction({ gw: s.gw, human, audit: { record: vi.fn() }, title: a => a }, "kubernetes-basics", "start")).toEqual({ kind: "done", state: cluster({}, true) });
    expect(s.runs).toEqual([{ action: "start", command: START, reason: "practice" }]);
    const d = fakeGateway(cluster({}, true), cluster());
    await runClusterAction({ gw: d.gw, human, audit: { record: vi.fn() }, title: a => a }, "kubernetes-basics", "delete");
    expect(d.runs).toEqual([{ action: "delete", command: DELETE, reason: "practice" }]);
  });

  it("recognises the backend's «cannot run here» and shows memory in MiB", () => {
    expect(isLiveUnavailable("LIVE_UNAVAILABLE: Podman is not installed.")).toBe(true);
    expect(isLiveUnavailable("COURSE_NOT_PREPARED: …")).toBe(false);
    expect(memoryMiB(642 * 1024 * 1024)).toBe("642 MiB");
    expect(memoryMiB(null)).toBe("");
  });

  it("the live flag of a project step reaches the engine (and only when set)", () => {
    const c = fromCourseDto({
      id: "k", title: "K", summary: "", overview: "", language: "yaml", category: "tool", subject: "kubernetes",
      units: [{ id: "u", title: "U", intro: "", concepts: "", difficulty: 1, level: "basic", steps: [
        { kind: "challenge", id: "live", title: "", points: 1, intro: "", difficulty: 1, body: "", prompt: "", target: "", explanation: "", lineComments: [], placeholderPolicy: "shown", instructions: "", entry: "", starter: "", project: { main: "a.yaml", files: { "a.yaml": "" }, readonly: [], live: true } },
        { kind: "challenge", id: "off", title: "", points: 1, intro: "", difficulty: 1, body: "", prompt: "", target: "", explanation: "", lineComments: [], placeholderPolicy: "shown", instructions: "", entry: "", starter: "", project: { main: "a.yaml", files: { "a.yaml": "" }, readonly: [] } },
      ] }],
    });
    const [live, off] = c.units[0].steps;
    expect(live.project?.live).toBe(true);
    expect(off.project && "live" in off.project).toBe(false);
  });
});

/* ───── the real chain: the cards, the dialog, the IPC ───── */

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let LM: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Array<[string, Record<string, unknown>]>;
let clusterNow: ClusterState;
let prepState: "missing" | "ready";

const step = (over: Record<string, unknown>) => ({
  kind: "challenge", id: "", title: "", points: 30, intro: "Briefing.", difficulty: 1, body: "", prompt: "", target: "", explanation: "",
  lineComments: [], placeholderPolicy: "shown", installCommands: [], runCommand: "", dependencies: [], instructions: "Write it.", entry: "", starter: "",
  ...over,
});
const K8S = {
  id: "kubernetes-basics", language: "yaml", category: "tool", subject: "kubernetes", title: "Kubernetes", level: "beginner",
  summary: "Manifests.", overview: "Kubernetes runs containers.", prepare: true,
  units: [
    { id: "k8s-u1", title: "Objects", intro: "", concepts: "Objects.", difficulty: 1, level: "basic", steps: [
      step({ id: "k8s-p1-pod", title: "Fix the Pod", project: { main: "pod.yaml", files: { "pod.yaml": "kind: pod\n" }, readonly: [] } }),
    ] },
    { id: "k8s-u12", title: "On a real cluster", intro: "", concepts: "Live.", difficulty: 12, level: "advanced", steps: [
      step({ id: "k8s-p12-rollout", title: "Roll out", project: { main: "deployment.yaml", files: { "deployment.yaml": "kind: Deployment\n" }, readonly: [], live: true } }),
    ] },
  ],
};
const prepDto = () => ({
  needed: true, state: prepState, command: "# Practice cluster of the course\ndownload https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64", kind: "cluster",
  packages: [{ name: "kind", version: "v0.33.0", source: "GitHub release (sha256-checked)", pinned: true }], dir: "/data/cc/kubernetes-basics", timeoutSecs: 0,
  preparedAt: null, fetchSecs: null, warmSecs: null,
});

function fakeTauri(): void {
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    plugin_list: () => [],
    list_courses: () => [{ id: "kubernetes-basics", language: "yaml", category: "tool", subject: "kubernetes", title: "Kubernetes", level: "beginner", summary: "s" }],
    get_course: (a) => (a.subject === "kubernetes" ? K8S : Promise.reject(new Error("no course"))),
    course_prepare_status: () => prepDto(),
    learn_cluster_status: () => ({ ...clusterNow, status: clusterNow.status ? { ...clusterNow.status, prepared: true } : null }),
    learn_cluster_start: () => { clusterNow = cluster({}, true); return { ...clusterNow, status: { ...clusterNow.status!, prepared: true } }; },
    learn_cluster_delete: () => { clusterNow = cluster(); return { ...clusterNow, status: { ...clusterNow.status!, prepared: true } }; },
    audit_record: () => null,
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
  prepState = "ready";
  clusterNow = cluster();
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

async function open(stepId: string) {
  LM.ltOnboard(1);
  await vi.waitFor(() => expect(document.querySelector('#onb .onb-fw [data-on="kubernetes"]')).toBeTruthy());
  document.getElementById("onb")!.classList.remove("show");
  LM.LTS.lang = "kubernetes"; LM.LTS.levels = ["basic", "advanced"];
  LM.ltOpen(stepId);
  await vi.waitFor(() => expect(res().textContent).toMatch(/Write it\./));
}

describe("the practice cluster in the Learning Track", () => {
  it("an offline step shows neither the preparation nor the cluster", async () => {
    prepState = "missing";
    fakeTauri();
    await open("k8s-p1-pod");
    await vi.waitFor(() => expect(calls.some(([c]) => c === "course_prepare_status")).toBe(true));
    expect(res().textContent).not.toMatch(/Prepare this course|Practice cluster/);
    expect(calls.some(([c]) => c === "learn_cluster_status")).toBe(false);
  });

  it("a live step of an unprepared course asks to prepare it, with the cluster's text", async () => {
    prepState = "missing";
    clusterNow = cluster({ prepared: false, status: null });
    fakeTauri();
    await open("k8s-p12-rollout");
    await vi.waitFor(() => expect(res().textContent).toMatch(/Prepare this course/));
    expect(res().textContent).toMatch(/kind on rootless Podman/);
    expect(res().textContent).toMatch(/applies your files to a fresh namespace/);
  });

  it("without Podman, the live step says why and what to install; the offline units still grade", async () => {
    clusterNow = NO_PODMAN;
    fakeTauri();
    await open("k8s-p12-rollout");
    await vi.waitFor(() => expect(res().textContent).toMatch(/Podman is not installed/));
    expect(res().textContent).toMatch(/podman\.io\/docs\/installation/);
    expect(res().textContent).toMatch(/offline units of the course still grade/);
    expect(document.querySelector('[data-action="lt-cluster-start"]')).toBeNull();
  });

  it("«Start practice cluster» runs the approved command; «Delete cluster» too", async () => {
    fakeTauri();
    await open("k8s-p12-rollout");
    await vi.waitFor(() => expect(document.querySelector('[data-action="lt-cluster-start"]')).toBeTruthy());
    expect(res().textContent).toMatch(/dxtutor-kubernetes-basics is not running/);
    click(document.querySelector('[data-action="lt-cluster-start"]')!);
    await vi.waitFor(() => expect(document.getElementById("approval")).toBeTruthy());
    expect(document.querySelector("#approval .appr-cmd")!.textContent).toBe(START);
    click(document.getElementById("appr-ok")!);
    await vi.waitFor(() => expect(calls.some(([c]) => c === "learn_cluster_start")).toBe(true));
    const [, args] = calls.find(([c]) => c === "learn_cluster_start")!;
    expect(args.courseId).toBe("kubernetes-basics");
    expect((args.decision as { command: string }).command).toBe(START);
    await vi.waitFor(() => expect(res().textContent).toMatch(/is running \(642 MiB\)/));

    document.getElementById("approval")?.remove();
    click(document.querySelector('[data-action="lt-cluster-delete"]')!);
    await vi.waitFor(() => expect(document.querySelector("#approval .appr-cmd")?.textContent).toBe(DELETE));
    click(document.getElementById("appr-ok")!);
    await vi.waitFor(() => expect(calls.some(([c]) => c === "learn_cluster_delete")).toBe(true));
    await vi.waitFor(() => expect(res().textContent).toMatch(/was deleted/));
  });

  it("a refused start is audited from the UI and nothing runs", async () => {
    fakeTauri();
    await open("k8s-p12-rollout");
    await vi.waitFor(() => expect(document.querySelector('[data-action="lt-cluster-start"]')).toBeTruthy());
    click(document.querySelector('[data-action="lt-cluster-start"]')!);
    await vi.waitFor(() => expect(document.getElementById("approval")).toBeTruthy());
    click(document.getElementById("appr-no")!);
    await vi.waitFor(() => expect(calls.some(([c]) => c === "audit_record")).toBe(true));
    const [, a] = calls.find(([c]) => c === "audit_record")!;
    expect(a).toMatchObject({ root: DIR });
    expect(calls.some(([c]) => c === "learn_cluster_start")).toBe(false);
    await vi.waitFor(() => expect(res().textContent).toMatch(/Nothing was changed/));
  });
});
