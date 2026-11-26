import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeCodevSessions, type CodevSessionsDeps, type IssueRun } from "../src/features/codev/application/codev-sessions";
import type { AgentChat } from "../src/features/codev/application/agent-chat";
import { makeWorktrees, type WorktreeGateway, type WorktreesDeps } from "../src/features/codev/application/worktrees";
import { makeHunkReview } from "../src/features/codev/application/hunk-review";
import { makeCodevsView } from "../src/features/codev/ui/codevs-view";
import type { AgentMapStore } from "../src/features/codev/application/agent-map";
import { applyEdits, branchLabel, claimsBySession, cleanable, parseClaims, parseFile, parseListed, parsePlan, type ListedWorktree, type Placement, type WorktreeRef } from "../src/features/codev/domain/worktrees";
import { branchName } from "../src/features/project/domain/board";
import type { AgentEvent } from "../src/features/codev/domain/agent-events";
import type { Issue } from "../src/features/project/domain/types";

/* Multi Co-Dev, phase 3: a worktree per Co-Dev issue session and the file claims. The sessions manager
   (a second issue gets its own worktree and starts even when it overlaps — the claims decide; a folder
   without git keeps the phase-2 rule), the worktrees use case (the approval shows the exact command, a
   refusal is audited, leftovers are offered for clean-up, commits go through the secret scan's guard),
   the read-only proposal of a worktree session's hunks, and the strip's cards. The rules themselves are
   Rust's (cargo test -p tutor-eval gitwork::codev, -p tutor-board claims, -p dxtutor-ide codev_). */

const REF: WorktreeRef = { key: "DX-2", branch: "feature/dx-2-pay", path: "/data/worktrees/abc/DX-2", dir: "/data/worktrees/abc/DX-2" };

function fakes(place: (key: string, needed: boolean) => Placement, clash: Record<string, Array<{ other: string; paths: string[]; total: number }>> = {}) {
  const made: Array<{ chat: AgentChat; log: string[]; ctx: { worktree(): WorktreeRef | null } }> = [];
  let n = 0;
  const notes: string[] = [];
  const hidden: { f: (s: string) => boolean } = { f: () => false };
  const closedRefs: WorktreeRef[] = [];
  const deps: CodevSessionsDeps = {
    make: (ctx) => {
      const log: string[] = [];
      let issueKey: string | null = null;
      let session: string | null = null;
      const chat = {
        issueKey: () => issueKey,
        sessionId: () => session,
        issue: vi.fn(async (r: IssueRun, where?: { worktree?: boolean; keepWorktree?: boolean }) => {
          if (session) log.push(`close ${session}${where?.keepWorktree ? " keep" : ""}`);
          issueKey = r.key;
          session = `S${++n}`;
          log.push(`issue ${r.key} ${session}${where?.worktree ? " wt" : ""}`);
          return true;
        }),
        reset: vi.fn(async () => {
          if (session) log.push(`close ${session}`);
          session = null;
          issueKey = null;
        }),
        closing: () => Promise.resolve(),
        modeChanged: vi.fn(),
      } as unknown as AgentChat;
      const view = { show() {}, hide() {}, dispose: vi.fn(), waiting: () => false, running: () => false };
      made.push({ chat, log, ctx });
      return { chat, view };
    },
    overlap: vi.fn(async (key: string) => clash[key] ?? []),
    hunks: { setHidden: (f) => (hidden.f = f), visibilityChanged: vi.fn(), forget: vi.fn() },
    confirm: vi.fn(() => false),
    notify: (m) => notes.push(m),
    worktree: { prepare: vi.fn(async (k: string, needed: boolean) => place(k, needed)), sessionClosed: (r) => void closedRefs.push(r) },
  };
  const s = makeCodevSessions(deps);
  const run = (key: string): IssueRun => ({ key, text: `do ${key}`, scope: [], template: "v1" });
  return { s, deps, made, notes, hidden, run, closedRefs };
}

const worktreeFor = (key: string, needed: boolean): Placement =>
  needed ? { kind: "worktree", created: true, ref: { ...REF, key, branch: `feature/${key.toLowerCase()}` } } : { kind: "main" };

describe("phase 3: a worktree per Co-Dev issue session", () => {
  it("alone, an issue works in the main tree as before; a second one gets its own worktree", async () => {
    const t = fakes(worktreeFor);
    expect(await t.s.issue(t.run("DX-1"))).toBe(true);
    expect(t.deps.worktree!.prepare).toHaveBeenLastCalledWith("DX-1", false);
    expect(t.made[0].log).toEqual(["issue DX-1 S1"]);
    expect(t.s.slots()[0].worktree).toBeNull();
    expect(await t.s.issue(t.run("DX-2"))).toBe(true);
    expect(t.deps.worktree!.prepare).toHaveBeenLastCalledWith("DX-2", true);
    expect(t.made[1].log).toEqual(["issue DX-2 S2 wt"]);
    expect(t.s.slots().map((x) => x.worktree?.branch ?? null)).toEqual([null, "feature/dx-2"]);
    expect(t.made[1].ctx.worktree()?.key).toBe("DX-2");
    // the worktree session's hunks never paint in the editor, even on screen; the main tree's do when shown
    expect(t.s.slots()[1].selected).toBe(true);
    expect(t.hidden.f("S2")).toBe(true);
    t.s.select(t.s.slots()[0].id);
    expect(t.hidden.f("S1")).toBe(false);
  });

  it("an overlap no longer refuses: it starts in its worktree and the human is told the claims decide", async () => {
    const clash = { "DX-3": [{ other: "DX-1", paths: ["src/cart.rs"], total: 1 }] };
    const t = fakes(worktreeFor, clash);
    await t.s.issue(t.run("DX-1"));
    expect(await t.s.issue(t.run("DX-3"))).toBe(true);
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(t.s.queued()).toEqual([]);
    expect(t.notes.at(-1)).toContain("src/cart.rs");
    expect(t.notes.at(-1)).toContain("reserva");
    // a failing check does not stop it either
    (t.deps.overlap as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    expect(await t.s.issue(t.run("DX-4"))).toBe(true);
  });

  it("a refused worktree does not start; a folder without git keeps the phase-2 rule", async () => {
    const refused = fakes((k, needed) => (needed ? { kind: "refused" } : { kind: "main" }));
    await refused.s.issue(refused.run("DX-1"));
    expect(await refused.s.issue(refused.run("DX-2"))).toBe(false);
    expect(refused.made).toHaveLength(1);

    const clash = { "DX-2": [{ other: "DX-1", paths: ["src/cart.rs"], total: 1 }] };
    const plain = fakes((k, needed) => (needed ? { kind: "unavailable", reason: "not a git repository" } : { kind: "main" }), clash);
    await plain.s.issue(plain.run("DX-1"));
    expect(await plain.s.issue(plain.run("DX-2"))).toBe(false);
    expect(plain.deps.confirm).toHaveBeenCalled();
    expect(plain.notes.at(-1)).toContain("src/cart.rs");
  });

  it("starting the same issue again keeps its worktree; closing it lets the worktree go (or stay)", async () => {
    const t = fakes(worktreeFor);
    await t.s.issue(t.run("DX-1"));
    await t.s.issue(t.run("DX-2"));
    await t.s.issue(t.run("DX-2"));
    expect(t.deps.worktree!.prepare).toHaveBeenLastCalledWith("DX-2", true);
    expect(t.made[1].log).toEqual(["issue DX-2 S2 wt", "close S2 keep", "issue DX-2 S3 wt"]);
    t.s.close(t.s.slots()[1].id);
    await vi.waitFor(() => expect(t.closedRefs.map((r) => r.key)).toEqual(["DX-2"]));
    expect(t.s.slots().map((x) => x.issue)).toEqual(["DX-1"]);
  });

  it("an issue that already has a worktree goes back to it, even alone", async () => {
    const t = fakes((key) => ({ kind: "worktree", created: false, ref: { ...REF, key } }));
    await t.s.issue(t.run("DX-2"));
    expect(t.made[0].log).toEqual(["issue DX-2 S1 wt"]);
    expect(t.s.slots()[0].worktree?.key).toBe("DX-2");
  });
});

/* ───── the use case ───── */

function gateway(over: Partial<WorktreeGateway> = {}): WorktreeGateway {
  return {
    plan: vi.fn(async (_r, key) => ({ available: true, reason: null, key, branch: `feature/${key.toLowerCase()}`, path: `/wt/${key}`, exists: false, newBranch: true, command: `git -C /p worktree add -b feature/${key.toLowerCase()} -- /wt/${key} abc` })),
    create: vi.fn(async (_r, key) => ({ key, path: `/wt/${key}`, dir: `/wt/${key}`, branch: `feature/${key.toLowerCase()}`, head: "abc", prunable: false, dirty: [], changed: [] })),
    list: vi.fn(async () => [] as ListedWorktree[]),
    remove: vi.fn(async () => ({ removed: true, dirty: [] })),
    file: vi.fn(async (_r, _k, path) => ({ path, abs: `/wt/DX-2/${path}`, branch: "feature/dx-2", before: "a\n", now: "a\nb\n" })),
    commit: vi.fn(async () => "1a2b3c4"),
    claims: vi.fn(async () => []),
    ...over,
  };
}

function useCase(g: WorktreeGateway, approved = true) {
  const notes: string[] = [];
  const deps: WorktreesDeps = {
    gateway: g,
    root: () => "/p",
    approve: vi.fn(async () => ({ approved, reason: "", decidedAt: 42 })),
    audit: vi.fn(async () => undefined),
    guard: vi.fn(<T,>(f: () => Promise<T>) => f()),
    openReadOnly: vi.fn(),
    ask: vi.fn(async () => "DX-2: pay"),
    notify: (m) => notes.push(m),
  };
  return { w: makeWorktrees(deps), deps, notes };
}

describe("the worktrees use case", () => {
  it("a new worktree only with the human's approval of the exact command; a refusal is audited", async () => {
    const g = gateway();
    const ok = useCase(g);
    const p = await ok.w.prepare("DX-2", true);
    expect(p).toMatchObject({ kind: "worktree", created: true, ref: { key: "DX-2", branch: "feature/dx-2" } });
    expect(ok.deps.approve).toHaveBeenCalledWith(expect.objectContaining({ command: "git -C /p worktree add -b feature/dx-2 -- /wt/DX-2 abc" }));
    expect(g.create).toHaveBeenCalledWith("/p", "DX-2", "git -C /p worktree add -b feature/dx-2 -- /wt/DX-2 abc", 42);

    const no = useCase(gateway(), false);
    expect(await no.w.prepare("DX-2", true)).toEqual({ kind: "refused" });
    expect(no.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ feature: "codev", action: "worktree.create", approved: false, decidedAt: 42 }));
    expect(no.notes.at(-1)).toContain("DX-2");
  });

  it("an existing worktree is reused without asking; alone, none is created; without git, the phase-2 rule", async () => {
    const exists = useCase(gateway({ plan: vi.fn(async (_r, key) => ({ available: true, reason: null, key, branch: "feature/x", path: "/wt/x", exists: true, newBranch: false, command: "" })) }));
    expect(await exists.w.prepare("DX-2", false)).toMatchObject({ kind: "worktree", created: false });
    expect(exists.deps.approve).not.toHaveBeenCalled();

    const alone = useCase(gateway());
    expect(await alone.w.prepare("DX-2", false)).toEqual({ kind: "main" });
    expect(alone.deps.approve).not.toHaveBeenCalled();

    const plain = useCase(gateway({ plan: vi.fn(async (_r, key) => ({ available: false, reason: "not a git repository", key, branch: "", path: "", exists: false, newBranch: false, command: "" })) }));
    expect(await plain.w.prepare("DX-2", true)).toEqual({ kind: "unavailable", reason: "not a git repository" });
    expect(await plain.w.prepare("DX-2", false)).toEqual({ kind: "main" });

    // a failing plan: alone it works in the main tree as always; next to another it does not start
    const broken = useCase(gateway({ plan: vi.fn(async () => Promise.reject(new Error("db"))) }));
    expect(await broken.w.prepare("DX-2", false)).toEqual({ kind: "main" });
    expect(await broken.w.prepare("DX-2", true)).toEqual({ kind: "refused" });
  });

  it("leftovers are told on folder open and cleaned up only with approval; a commit goes through the guard", async () => {
    const left: ListedWorktree[] = [
      { key: "DX-7", path: "/wt/DX-7", dir: "/wt/DX-7", branch: "feature/dx-7", head: "abc", prunable: false, dirty: [], changed: [{ path: "a.rs", status: "M" }], session: null, remove: "git -C /p worktree remove -- /wt/DX-7" },
      { key: "DX-8", path: "/wt/DX-8", dir: "/wt/DX-8", branch: "feature/dx-8", head: "def", prunable: false, dirty: ["b.rs"], changed: [], session: null, remove: "git -C /p worktree remove -- /wt/DX-8" },
      { key: "DX-9", path: "/wt/DX-9", dir: "/wt/DX-9", branch: "feature/dx-9", head: "fed", prunable: false, dirty: [], changed: [], session: "cda-1", remove: "x" },
    ];
    const g = gateway({ list: vi.fn(async () => left), claims: vi.fn(async () => [{ path: "a.rs", session: "cda-1", issue: "DX-9", at: 1 }]) });
    const u = useCase(g);
    await u.w.workspaceOpened();
    expect(u.notes.at(-1)).toContain("DX-7, DX-8");
    expect(u.w.kept().map((x) => x.key)).toEqual(["DX-7", "DX-8"]);
    expect(u.w.kept().map(cleanable)).toEqual([true, false]);
    expect(u.w.claimsOf("cda-1")).toEqual(["a.rs"]);
    await u.w.cleanup("DX-7");
    expect(u.deps.approve).toHaveBeenLastCalledWith(expect.objectContaining({ command: "git -C /p worktree remove -- /wt/DX-7" }));
    expect(g.remove).toHaveBeenCalledWith("/p", "DX-7", "git -C /p worktree remove -- /wt/DX-7", 42);
    // the open session's worktree is never offered
    await u.w.cleanup("DX-9");
    expect(g.remove).toHaveBeenCalledTimes(1);
    await u.w.commit("DX-8");
    expect(u.deps.guard).toHaveBeenCalled();
    expect(g.commit).toHaveBeenCalledWith("/p", "DX-8", "DX-2: pay");
    expect(u.notes.at(-1)).toContain("1a2b3c4");
  });

  it("a worktree session's proposal opens read-only next to its file", async () => {
    const u = useCase(gateway());
    await u.w.openProposal(REF, "src/pay.rs", (now) => now + "c\n");
    expect(u.deps.openReadOnly).toHaveBeenCalledWith("/wt/DX-2/src/pay.rs", "a\nb\n", "a\nb\nc\n", expect.stringContaining("feature/dx-2-pay"));
    await u.w.openFile("DX-2", "src/pay.rs");
    expect(u.deps.openReadOnly).toHaveBeenLastCalledWith("/wt/DX-2/src/pay.rs", "a\n", "a\nb\n", expect.stringContaining("DX-2"));
  });
});

describe("the worktree domain", () => {
  it("narrows the backend's answers", () => {
    expect(parsePlan({ available: true, key: "DX-1", branch: "b", path: "/p", exists: false, newBranch: true, command: "git x", reason: null })).toMatchObject({ command: "git x", newBranch: true });
    expect(parsePlan({ nope: 1 })).toBeNull();
    const l = parseListed([{ key: "DX-1", path: "/w", dir: "/w", branch: null, head: "abc", prunable: false, dirty: ["a"], changed: [{ path: "a", status: "?" }, { nope: 1 }], session: null, remove: "git r" }, 3])!;
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ branch: null, remove: "git r", changed: [{ path: "a", status: "?" }] });
    expect(parseFile({ path: "a", abs: "/w/a", before: null, now: "x" })).toMatchObject({ before: null, now: "x" });
    expect(parseClaims([{ path: "a", session: "s", issue: "DX-1", at: 2 }, { path: "" }])).toEqual([{ path: "a", session: "s", issue: "DX-1", at: 2 }]);
    expect(claimsBySession([{ path: "a", session: "s", issue: null, at: 1 }, { path: "b", session: "s", issue: null, at: 1 }]).get("s")).toEqual(["a", "b"]);
    expect(branchLabel({ branch: null, head: "abcdef123" })).toBe("⎇ abcdef12");
  });

  it("applies a review's blocks to the file (bottom first)", () => {
    const real = "a\nb\nc\nd\n";
    expect(applyEdits(real, [{ start: 2, end: 2, text: "B\n" }, { start: 4, end: 4, text: "D1\nD2\n" }])).toBe("a\nB\nc\nD1\nD2\n");
    expect(applyEdits(real, [{ start: 3, end: 2, text: "new\n" }])).toBe("a\nb\nnew\nc\nd\n");
    expect(applyEdits(real, [{ start: 1, end: 2, text: "" }])).toBe("c\nd\n");
    expect(applyEdits("", [{ start: 1, end: 0, text: "fresh\n" }])).toBe("fresh\n");
    expect(applyEdits("a\nb", [{ start: 1, end: 1, text: "A" }])).toBe("A\nb");
  });

  it("names the issue branch as the backend does (tutor_board::project::branches)", () => {
    const i = (key: string, title: string, kind: string) => ({ key, title, kind }) as unknown as Issue;
    expect(branchName(i("DX-12", "Pagar com cartão", "story"))).toBe("feature/dx-12-pagar-com-cartao");
    expect(branchName(i("DX-3", "  Corrigir o cálculo do IVA (Angola)! ", "bug"))).toBe("fix/dx-3-corrigir-o-calculo-do-iva-angola");
    expect(branchName(i("DX-4", "???", "task"))).toBe("feature/dx-4");
    expect(branchName(i("DX-5", "Ação — Über straße Œuvre", "story"))).toBe("feature/dx-5-acao-uber-stra-e-uvre");
    expect(branchName(i("DX-7", "abcdefghij abcdefghij abcdefghij abcdef gh", "story"))).toBe("feature/dx-7-abcdefghij-abcdefghij-abcdefghij-abcdef");
  });
});

describe("a worktree session's hunks", () => {
  it("make the proposal of a file from the session's open blocks", () => {
    const r = makeHunkReview({
      review: vi.fn(async () => undefined), flush: vi.fn(async () => undefined), reloadFromDisk: vi.fn(async () => undefined),
      editor: { repaint: () => undefined, open: () => undefined, current: () => null, reveal: () => undefined, preview: () => undefined },
      every: () => () => undefined, pace: () => 40, notify: () => undefined, cancel: vi.fn(),
    });
    r.setHidden(() => true);
    r.sink.event("S2", { kind: "hunk_start", hunk: "c:1", call: "c", path: "src/pay.rs", op: "replace", range: { start: 2, end: 2 }, base: "x", old: "b\n" } as AgentEvent);
    r.sink.event("S2", { kind: "hunk_end", hunk: "c:1", text: "B\n", lines: { added: 1, removed: 1 } } as AgentEvent);
    expect(r.proposal("S2", "src/pay.rs", "a\nb\nc\n")).toBe("a\nB\nc\n");
    expect(r.proposal("S2", "other.rs", "x\n")).toBe("x\n");
    expect(r.state().hunks).toEqual([]);
  });
});

describe("the Co-Devs strip with worktrees", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ag-msgs"></div>';
  });

  it("shows the branch of a worktree session, its claims, and the worktrees left without a session", async () => {
    const t = fakes(worktreeFor);
    await t.s.issue(t.run("DX-1"));
    await t.s.issue(t.run("DX-2"));
    const left: ListedWorktree[] = [{ key: "DX-8", path: "/wt/DX-8", dir: "/wt/DX-8", branch: "feature/dx-8", head: "d", prunable: false, dirty: ["b.rs"], changed: [{ path: "b.rs", status: "M" }], session: null, remove: "git -C /p worktree remove -- /wt/DX-8" }];
    const u = useCase(gateway({ list: vi.fn(async () => left), claims: vi.fn(async () => [{ path: "src/pay.rs", session: "S2", issue: "DX-2", at: 1 }]) }));
    await u.w.refresh();
    const map = { snapshot: () => ({ sessions: [] }), onChange: () => () => undefined } as unknown as AgentMapStore;
    const picks: string[][] = [];
    const view = makeCodevsView(t.s, map, { now: () => 0, every: () => () => undefined, worktrees: u.w, pick: (_ph, items) => picks.push(items.map((i) => i.label)) });
    view.render();
    const host = document.getElementById("ag-codevs")!;
    const cards = [...host.querySelectorAll(".cdv-card")];
    expect(cards).toHaveLength(3);
    expect(cards[1].querySelector(".cdv-wt")!.textContent).toBe("⎇ feature/dx-2");
    expect(cards[1].textContent).toContain("1");
    expect(cards[1].querySelector('[data-action="codevs-commit"]')).not.toBeNull();
    expect(cards[0].querySelector(".cdv-wt")).toBeNull();
    expect(cards[2].className).toContain("st-kept");
    expect(cards[2].textContent).toContain("DX-8");
    // dirty: no clean-up offered (it would lose the changes)
    expect(cards[2].querySelector('[data-action="codevs-cleanup"]')).toBeNull();
    // «Files» lists what the worktree changed
    await view.actions()["codevs-files"].run({ on: "DX-8" } as never);
    await vi.waitFor(() => expect(picks).toEqual([["b.rs"]]));
  });

  it("stays away with one session in the main tree (as in phase 2)", () => {
    const t = fakes(worktreeFor);
    const map = { snapshot: () => ({ sessions: [] }), onChange: () => () => undefined } as unknown as AgentMapStore;
    makeCodevsView(t.s, map, { now: () => 0, every: () => () => undefined }).render();
    expect(document.getElementById("ag-codevs")).toBeNull();
  });
});
