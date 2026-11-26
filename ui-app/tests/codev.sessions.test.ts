import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCodevSessions, type CodevSessionsDeps, type IssueRun, type SessionSlotView } from "../src/features/codev/application/codev-sessions";
import type { AgentChat } from "../src/features/codev/application/agent-chat";
import { makeHunkReview } from "../src/features/codev/application/hunk-review";
import { clashFiles, parseScopeCheck } from "../src/features/codev/domain/scope-overlap";
import type { AgentEvent } from "../src/features/codev/domain/agent-events";
import { bootApp } from "./harness";

/* Multi Co-Dev, phase 2: several Co-Dev sessions in the UI. The manager with fake chats and views
   (another issue opens another session, never one whose scope overlaps a running issue's; a refusal
   offers to wait; closing a session starts the waiting issue), the live hunks per session (a
   background session does not paint, decisions go to their session), and the session view in the
   real Co-Dev pane (transcripts and run state swap). */

interface FakeChat {
  chat: AgentChat;
  view: SessionSlotView & { shown: boolean };
  log: string[];
}

function fakes(clash: Record<string, Array<{ other: string; paths: string[]; total: number }>> = {}, confirm = false) {
  const made: FakeChat[] = [];
  let n = 0;
  const notes: string[] = [];
  const hidden: { f: (s: string) => boolean } = { f: () => false };
  const deps: CodevSessionsDeps = {
    make: () => {
      const log: string[] = [];
      let issueKey: string | null = null;
      let session: string | null = null;
      const chat = {
        issueKey: () => issueKey,
        sessionId: () => session,
        issue: vi.fn(async (r: IssueRun) => {
          if (session) log.push(`close ${session}`);
          issueKey = r.key;
          session = `S${++n}`;
          log.push(`issue ${r.key} ${session}`);
          return true;
        }),
        reset: vi.fn(() => {
          if (session) log.push(`close ${session}`);
          session = null;
          issueKey = null;
        }),
        modeChanged: vi.fn(),
      } as unknown as AgentChat;
      const view = {
        shown: made.length === 0,
        show() { view.shown = true; log.push("show"); },
        hide() { view.shown = false; log.push("hide"); },
        dispose: vi.fn(),
        waiting: () => false,
        running: () => false,
      };
      made.push({ chat, view, log });
      return { chat, view };
    },
    overlap: vi.fn(async (key: string) => clash[key] ?? []),
    hunks: { setHidden: (f) => (hidden.f = f), visibilityChanged: vi.fn(), forget: vi.fn() },
    confirm: vi.fn(() => confirm),
    notify: (m) => notes.push(m),
  };
  const s = makeCodevSessions(deps);
  const run = (key: string): IssueRun => ({ key, text: `do ${key}`, scope: [], template: "v1" });
  return { s, deps, made, notes, hidden, run };
}

describe("several Co-Dev sessions", () => {
  it("one session: the first issue uses the conversation on screen, as before", async () => {
    const t = fakes();
    expect(t.made).toHaveLength(1);
    expect(await t.s.issue(t.run("DX-1"))).toBe(true);
    expect(t.made).toHaveLength(1);
    expect(t.deps.overlap).not.toHaveBeenCalled();
    // the same issue again starts over in the same session (as before)
    await t.s.issue(t.run("DX-1"));
    expect(t.made).toHaveLength(1);
    expect(t.made[0].log).toEqual(["issue DX-1 S1", "close S1", "issue DX-1 S2"]);
    expect(t.s.slots()).toHaveLength(1);
  });

  it("another issue opens another session (the first keeps running) when the scopes do not overlap", async () => {
    const t = fakes();
    await t.s.issue(t.run("DX-1"));
    await t.s.issue(t.run("DX-2"));
    expect(t.deps.overlap).toHaveBeenCalledWith("DX-2", ["DX-1"]);
    expect(t.made).toHaveLength(2);
    expect(t.made[0].log).not.toContain("close S1");
    expect(t.made[0].view.shown).toBe(false);
    expect(t.made[1].view.shown).toBe(true);
    expect(t.s.slots().map((x) => [x.issue, x.selected])).toEqual([["DX-1", false], ["DX-2", true]]);
    expect(t.s.sessionId()).toBe("S2");
    // the background session's hunks are hidden; the visible one's are not
    expect(t.hidden.f("S1")).toBe(true);
    expect(t.hidden.f("S2")).toBe(false);
    // switching shows the other conversation
    t.s.select(t.s.slots()[0].id);
    expect(t.made[0].view.shown).toBe(true);
    expect(t.made[1].view.shown).toBe(false);
    expect(t.hidden.f("S1")).toBe(false);
    expect(t.hidden.f("S2")).toBe(true);
    expect(t.deps.hunks.visibilityChanged).toHaveBeenCalled();
    expect(t.s.selectSession("S2")).toBe(true);
    expect(t.s.sessionId()).toBe("S2");
    expect(t.s.selectSession("nope")).toBe(false);
  });

  it("an overlap is refused with the files; or it waits and starts when the other closes", async () => {
    const clash = { "DX-2": [{ other: "DX-1", paths: ["src/cart.rs", "src/total.rs"], total: 2 }] };
    const refused = fakes(clash, false);
    await refused.s.issue(refused.run("DX-1"));
    expect(await refused.s.issue(refused.run("DX-2"))).toBe(false);
    expect(refused.made).toHaveLength(1);
    expect(refused.notes.at(-1)).toContain("src/cart.rs, src/total.rs");
    expect(refused.notes.at(-1)).toContain("DX-1");
    expect(String((refused.deps.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("· DX-1: src/cart.rs, src/total.rs");
    expect(refused.s.queued()).toEqual([]);

    const waits = fakes(clash, true);
    await waits.s.issue(waits.run("DX-1"));
    expect(await waits.s.issue(waits.run("DX-2"))).toBe(false);
    expect(waits.s.queued()).toEqual([{ key: "DX-2", blockers: ["DX-1"] }]);
    // DX-1 closes: no overlap any more → DX-2 starts in the background
    delete (clash as Record<string, unknown>)["DX-2"];
    waits.s.close(waits.s.slots()[0].id);
    await vi.waitFor(() => expect(waits.s.queued()).toEqual([]));
    await vi.waitFor(() => expect(waits.made.some((m) => m.log.includes("issue DX-2 S2"))).toBe(true));
    expect(waits.notes.at(-1)).toContain("DX-2");
  });

  it("a failed check refuses (two Co-Devs on unknown scopes never share the tree)", async () => {
    const t = fakes();
    await t.s.issue(t.run("DX-1"));
    (t.deps.overlap as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("a issue DX-2 não existe"));
    expect(await t.s.issue(t.run("DX-2"))).toBe(false);
    expect(t.made).toHaveLength(1);
    expect(t.notes.at(-1)).toContain("a issue DX-2 não existe");
  });

  it("closing a session: its hunks go, another conversation shows; the last one only resets", async () => {
    const t = fakes();
    await t.s.issue(t.run("DX-1"));
    await t.s.issue(t.run("DX-2"));
    const [a, b] = t.s.slots();
    t.s.close(b.id);
    expect(t.deps.hunks.forget).toHaveBeenCalledWith("S2");
    expect(t.s.slots().map((x) => x.id)).toEqual([a.id]);
    expect(t.made[0].view.shown).toBe(true);
    expect(t.made[1].view.dispose).toHaveBeenCalled();
    t.s.close(a.id);
    expect(t.s.slots()).toHaveLength(1);
    expect(t.s.slots()[0].issue).toBeNull();
    // the mode is one for all the open sessions
    t.s.chats().forEach((c) => c.modeChanged("auto"));
    expect(t.made[0].chat.modeChanged).toHaveBeenCalledWith("auto");
  });

  it("a free conversation on screen takes the next issue (as before), checked against the running ones", async () => {
    const t = fakes();
    await t.s.issue(t.run("DX-1"));
    await t.s.issue(t.run("DX-2"));
    t.s.resetCurrent(); // «New conversation» on DX-2's session: the conversation on screen is free
    await t.s.issue(t.run("DX-3"));
    expect(t.deps.overlap).toHaveBeenLastCalledWith("DX-3", ["DX-1"]);
    expect(t.made).toHaveLength(2);
    expect(t.s.slots().map((x) => x.issue)).toEqual(["DX-1", "DX-3"]);
  });
});

describe("the scope check's answer", () => {
  it("narrows the overlaps to the running issues and lists the files", () => {
    const c = parseScopeCheck({ overlaps: [{ a: "DX-2", b: "DX-1", paths: ["a.rs", "b.rs", "c.rs", "d.rs"], total: 9 }], files: 10 }, "DX-2")!;
    expect(c).toEqual([{ other: "DX-1", paths: ["a.rs", "b.rs", "c.rs", "d.rs"], total: 9 }]);
    expect(clashFiles(c, 3, (n) => `+${n} more`)).toBe("a.rs, b.rs, c.rs (+6 more)");
    expect(parseScopeCheck({ nope: 1 }, "DX-2")).toBeNull();
    expect(parseScopeCheck({ overlaps: [] }, "DX-2")).toEqual([]);
  });
});

describe("live hunks per session", () => {
  const start = (hunk: string, path: string, line: number): AgentEvent =>
    ({ kind: "hunk_start", hunk, call: hunk.split(":")[0], path, op: "replace", range: { start: line, end: line }, base: "x", old: "old\n" }) as AgentEvent;

  function review() {
    const log: string[] = [];
    const deps = {
      review: vi.fn(async (s: string, call: string) => void log.push(`review ${s} ${call}`)),
      flush: vi.fn(async () => undefined),
      reloadFromDisk: vi.fn(async () => undefined),
      editor: { repaint: () => undefined, open: (p: string) => log.push(`open ${p}`), current: () => null, reveal: () => undefined, preview: () => undefined },
      every: () => () => undefined,
      pace: () => 40,
      notify: (m: string) => log.push(`notify ${m}`),
      cancel: vi.fn(),
    };
    const r = makeHunkReview(deps);
    r.readFrom(() => "old\nb\n");
    return { r, deps, log };
  }

  it("a background session does not paint; its decisions go to it; its end leaves the others", async () => {
    const { r, deps, log } = review();
    let bg = "S2";
    r.setHidden((s) => s === bg);
    r.sink.event("S1", start("a:1", "src/a.rs", 1));
    r.sink.event("S2", start("b:1", "src/b.rs", 1));
    expect(r.state().hunks.map((h) => h.id)).toEqual(["a:1"]);
    expect(log.filter((l) => l.startsWith("open"))).toEqual(["open src/a.rs"]);
    expect(r.view("src/b.rs", "old\nb\n")).toBeNull();
    // the human opens S2's chat: its hunks show, S1's go
    bg = "S1";
    r.visibilityChanged();
    expect(r.state().hunks.map((h) => h.id)).toEqual(["b:1"]);
    r.sink.event("S2", { kind: "hunk_end", hunk: "b:1", text: "new\n", lines: { added: 1, removed: 1 } } as AgentEvent);
    r.sink.event("S2", { kind: "hunk_review", call: "b", hunks: ["b:1"], reason: "Manual" } as AgentEvent);
    r.sink.event("S1", { kind: "hunk_review", call: "a", hunks: ["a:1"], reason: "Manual" } as AgentEvent);
    r.decide("b:1", true);
    await vi.waitFor(() => expect(deps.review).toHaveBeenCalledWith("S2", "b", [{ hunk: "b:1", accept: true }]));
    // a decision on the hidden session's call (from its chat bar) still goes to it
    r.decideAll("a", false);
    await vi.waitFor(() => expect(deps.review).toHaveBeenCalledWith("S1", "a", [{ hunk: "a:1", accept: false, reason: "rejeitado no editor" }]));
    // S1's turn ends: S2's open review stays
    r.sink.event("S2", start("c:1", "src/c.rs", 1));
    r.sink.event("S1", { kind: "done", outcome: { type: "done", truncated: false } } as AgentEvent);
    expect(r.state().hunks.some((h) => h.id === "c:1")).toBe(true);
    // a closed session's hunks go
    r.forget("S2");
    expect(r.state().hunks).toEqual([]);
  });
});

/* the session view in the real Co-Dev pane */
let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any — a janela do harness
beforeEach(async () => { w = await bootApp(); });
afterEach(() => { document.getElementById("ag-msgs")?.replaceChildren(); void w; });

describe("the session view", () => {
  it("each session keeps its transcript and its run; switching swaps them", async () => {
    const { makeSessionView } = await import("../src/features/codev/ui/session-view");
    const { agentStore } = await import("../src/app/store");
    const R = agentStore.run as unknown as { active: boolean; label: string; pend: (() => void) | null; abort: AbortController | null };
    const notes: string[] = [];
    const opts = (label: string) => ({ label: () => label, notify: (l: string) => notes.push(l), changed: () => undefined });
    const a = makeSessionView(opts("Co-Dev · DX-1"), true);
    const b = makeSessionView(opts("Co-Dev · DX-2"), false);
    const msgs = document.getElementById("ag-msgs")!;
    msgs.replaceChildren();
    a.presenter.userMessage("first");
    a.presenter.beginRun("Agente Co-Dev");
    expect(R.active).toBe(true);
    // B works in the background: nothing of it on screen, the run on screen is still A's
    b.presenter.userMessage("second");
    const card = b.presenter.thinking("co-dev");
    b.presenter.beginRun("Agente Co-Dev");
    const sigB = b.presenter.startAbort();
    b.presenter.assistantText(card, "B is working");
    expect(msgs.textContent).toContain("first");
    expect(msgs.textContent).not.toContain("second");
    expect(b.running()).toBe(true);
    // B asks for a decision in the background: a notice that says which, not A's bar
    const decided = b.gate.ask(card.tools, [{ l: "Permitir", v: "allow", pri: true }, { l: "Recusar", v: "deny" }]);
    expect(notes).toEqual(["Co-Dev · DX-2"]);
    expect(R.pend).toBeNull();
    expect(b.waiting()).toBe(true);
    a.presenter.endRun();
    expect(R.active).toBe(false);
    // switch to B: its transcript, its run (still active) and its pending decision
    a.hide();
    b.show();
    expect(msgs.textContent).toContain("B is working");
    expect(msgs.textContent).not.toContain("first");
    expect(R.active).toBe(true);
    expect(R.pend).not.toBeNull();
    [...msgs.querySelectorAll<HTMLButtonElement>(".gate button")].find((x) => x.textContent === "Permitir")!.click();
    expect(await decided).toBe("allow");
    expect(R.pend).toBeNull();
    // Stop on screen stops B's turn
    R.abort!.abort();
    expect(sigB.aborted).toBe(true);
    b.presenter.endRun();
    // back to A: its transcript again
    b.hide();
    a.show();
    expect(msgs.textContent).toContain("first");
    expect(R.active).toBe(false);
    // the composer's queue belongs to the conversation on screen: it travels with it (A works: it waits)
    const { swapQueue } = await import("../src/features/codev/ui/composer");
    a.presenter.beginRun("Agente Co-Dev");
    swapQueue(["for A later"]);
    a.hide();
    b.show();
    expect(swapQueue([])).toEqual([]);
    b.hide();
    a.show();
    expect(swapQueue([])).toEqual(["for A later"]);
    a.presenter.endRun();
  });
});
