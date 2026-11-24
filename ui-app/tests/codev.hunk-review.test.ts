import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHunkReview } from "../src/features/codev/application/hunk-review";
import type { AgentEvent } from "../src/features/codev/domain/agent-events";
import { bootApp } from "./harness";

/* Live hunks (docs/v2/RF-CODEV-STREAM.md §8). First the use case with fakes: typing pace,
   following the hunk, decisions sent after the autosave, reload after apply, the chat bar
   settled. Then the real editor: the textarea shows the proposal, an edit outside the hunk
   reaches the real file, an edit on it is refused, Accept/Reject live on the hunk's bar. */

const start = (hunk: string, path: string, line: number, old: string): AgentEvent => ({
  kind: "hunk_start",
  hunk,
  call: hunk.split(":")[0],
  path,
  op: "replace",
  range: { start: line, end: line },
  base: "ab",
  old,
});

function fakes() {
  const log: string[] = [];
  let tick: (() => void) | null = null;
  let current: string | null = null;
  const real: Record<string, string> = { "src/a.rs": "one\ntwo\nthree\n" };
  const deps = {
    review: vi.fn(async (_s: string, call: string, d: unknown) => void log.push(`review ${call} ${JSON.stringify(d)}`)),
    flush: vi.fn(async () => void log.push("flush")),
    reloadFromDisk: vi.fn(async () => void log.push("reload")),
    editor: {
      repaint: (p: string) => log.push(`repaint ${p}`),
      open: (p: string) => {
        current = p;
        log.push(`open ${p}`);
      },
      current: () => current,
      reveal: (l: number) => log.push(`reveal ${l}`),
      preview: (p: string, t: string) => log.push(`preview ${p} ${JSON.stringify(t)}`),
    },
    every: (_ms: number, f: () => void) => {
      tick = f;
      return () => (tick = null);
    },
    pace: () => 40,
    notify: (m: string) => log.push(`notify ${m}`),
    cancel: vi.fn(),
  };
  const r = makeHunkReview(deps);
  r.readFrom((p) => real[p] ?? null);
  return { r, deps, log, tickNow: () => tick?.(), ticking: () => tick !== null };
}

describe("the live-hunk use case", () => {
  it("opens the hunk's file, types at the pace and stops ticking when done", () => {
    const { r, log, tickNow, ticking } = fakes();
    r.sink.event("s", start("c:1", "src/a.rs", 2, "two\n"));
    expect(log).toContain("open src/a.rs");
    r.sink.event("s", { kind: "hunk_chunk", hunk: "c:1", text: "TWO, now longer" });
    expect(ticking()).toBe(true);
    tickNow(); // 40 chars/s × 50 ms = 2 chars
    expect(r.state().hunks[0].shown).toBe(2);
    expect(log.some((l) => l.startsWith("reveal"))).toBe(true);
    r.faster();
    r.sink.event("s", { kind: "hunk_end", hunk: "c:1", text: "TWO, now longer\n", lines: { added: 1, removed: 1 } });
    r.faster();
    expect(ticking()).toBe(false);
  });

  it("stops following when the human scrolls away, and comes back on request", () => {
    const { r, log } = fakes();
    r.sink.event("s", start("c:1", "src/a.rs", 2, "two\n"));
    r.sink.event("s", { kind: "hunk_chunk", hunk: "c:1", text: "x" });
    r.stopFollowing();
    expect(r.following()).toBe(false);
    log.length = 0;
    r.backToCodev();
    expect(r.following()).toBe(true);
    expect(log.some((l) => l.startsWith("reveal"))).toBe(true);
  });

  it("sends the review once every hunk has a choice, after saving the editor", async () => {
    const { r, deps, log } = fakes();
    r.sink.event("s", start("c:1", "src/a.rs", 1, "one\n"));
    r.sink.event("s", start("c:2", "src/a.rs", 3, "three\n"));
    r.sink.event("s", { kind: "hunk_review", call: "c", hunks: ["c:1", "c:2"], reason: "Assistido" });
    r.decide("c:1", true);
    expect(deps.review).not.toHaveBeenCalled();
    r.decide("c:2", false);
    await vi.waitFor(() => expect(deps.review).toHaveBeenCalledOnce());
    expect(log.indexOf("flush")).toBeLessThan(log.findIndex((l) => l.startsWith("review")));
    expect(deps.review.mock.calls[0][2]).toEqual([
      { hunk: "c:1", accept: true },
      { hunk: "c:2", accept: false, reason: "rejeitado no editor" },
    ]);
  });

  it("reloads the file after a hunk is applied and settles the chat bar", async () => {
    const { r, deps } = fakes();
    const labels: string[] = [];
    r.sink.event("s", start("c:1", "src/a.rs", 1, "one\n"));
    r.sink.event("s", { kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "Manual" });
    r.sink.onSettled("c", (l) => labels.push(l));
    r.sink.decideAll("c", true);
    r.sink.event("s", { kind: "hunk_applied", hunk: "c:1", provisional: false, fingerprint: "f" });
    await vi.waitFor(() => expect(deps.reloadFromDisk).toHaveBeenCalled());
    expect(labels).toEqual(["✓ 1 alteração(ões) aplicada(s)"]);
  });

  it("a new file is previewed, never opened (it is not on disk until accepted)", () => {
    const { r, log } = fakes();
    r.sink.event("s", { kind: "hunk_start", hunk: "w:1", call: "w", path: "src/new.rs", op: "create", range: { start: 1, end: 0 }, base: null, old: "" });
    r.sink.event("s", { kind: "hunk_end", hunk: "w:1", text: "fn x() {}\n", lines: { added: 1, removed: 0 } });
    expect(log.some((l) => l.startsWith("open"))).toBe(false);
    r.sink.open("src/new.rs");
    expect(log).toContain('preview src/new.rs "fn x() {}\\n"');
  });

  it("Esc-stop goes to the turn's cancel", () => {
    const { r, deps } = fakes();
    r.stop();
    expect(deps.cancel).toHaveBeenCalled();
  });
});

describe("the real editor draws the proposal", () => {
  let w: Window & Record<string, any>;
  beforeEach(async () => {
    vi.useFakeTimers();
    w = (await bootApp()) as Window & Record<string, any>;
  });
  afterEach(() => vi.useRealTimers());

  it("shows the hunk in the textarea, maps edits outside it and refuses edits on it", async () => {
    const key = Object.keys(w.FS).find((k: string) => k.endsWith("/lib.rs"))!;
    const rel = key.slice(w.ROOT.length);
    w.openPath(key);
    const original: string = w.FS[key].content;
    const lines = original.split("\n");
    const target = lines.findIndex((l) => l.trim().length > 0);
    const { hunkReview } = await import("../src/features/codev/index");
    hunkReview.sink.event("s", start("c:1", rel, target + 1, lines[target] + "\n"));
    hunkReview.sink.event("s", { kind: "hunk_chunk", hunk: "c:1", text: "// proposed by Co-Dev\n" });
    hunkReview.faster();
    hunkReview.sink.event("s", { kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "Manual" });

    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    expect(ta.value).toContain("// proposed by Co-Dev");
    expect(w.FS[key].content).toBe(original); // I1: the file is untouched
    expect(document.querySelectorAll("#ed-hl .l.hk-new").length).toBe(1);
    expect(document.querySelectorAll("#ed-hl .l.hk-old").length).toBe(1);
    const bar = document.querySelector(".hk-bar")!;
    expect(bar.querySelector('[data-action="hunk-accept"]')).not.toBeNull();

    // an edit on the last line (outside the hunk) reaches the real file
    ta.value = ta.value + "// human";
    ta.dispatchEvent(new window.Event("input"));
    expect(w.FS[key].content).toBe(original + "// human");

    // an edit on the proposed line is refused and the view is restored
    const before = ta.value;
    ta.value = ta.value.replace("// proposed by Co-Dev", "// changed");
    ta.dispatchEvent(new window.Event("input"));
    expect(ta.value).toBe(before);
    expect(w.FS[key].content).toBe(original + "// human");

    // choosing on the bar records the decision
    // (the bar is redrawn on every paint: query it again)
    (document.querySelector('.hk-bar [data-action="hunk-reject"]') as HTMLElement).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(hunkReview.state().hunks[0].choice).toBe("reject");

    // once settled, the editor shows the plain file again
    hunkReview.sink.event("s", { kind: "hunk_rejected", hunk: "c:1", by: "human", reason: "no" });
    expect(document.querySelectorAll("#ed-hl .l.hk-new").length).toBe(0);
    expect((document.getElementById("ed-ta") as HTMLTextAreaElement).value).toBe(original + "// human");
  });
});
