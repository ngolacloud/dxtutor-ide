import { describe, expect, it } from "vitest";
import { parseAgentEvent, type AgentEvent } from "../src/features/codev/domain/agent-events";
import {
  activeHunk,
  choose,
  completeReview,
  initialOverlay,
  isOpen,
  mapEdit,
  reduceOverlay,
  revealAll,
  revealStep,
  setPaused,
  shiftAnchors,
  virtualView,
  type OverlayState,
} from "../src/features/codev/domain/hunk-overlay";

/* Live hunks in the editor (docs/v2/RF-CODEV-STREAM.md §8): the pure overlay state that the
   editor draws. A sequence of backend events → hunk states; the virtual view of a file;
   human edits outside the hunks map onto the real file, edits on them are refused. */

const FILE = "fn f() {\n    for c in chars {\n    }\n}\n";

const run = (events: AgentEvent[], s: OverlayState = initialOverlay()): OverlayState => events.reduce(reduceOverlay, s);

const start = (hunk: string, start: number, end: number, old: string, path = "lib.rs"): AgentEvent => ({
  kind: "hunk_start",
  hunk,
  call: hunk.split(":")[0],
  path,
  op: old ? "replace" : "insert",
  range: { start, end },
  base: "ab",
  old,
});
const chunk = (hunk: string, text: string): AgentEvent => ({ kind: "hunk_chunk", hunk, text });
const end = (hunk: string, text: string): AgentEvent => ({ kind: "hunk_end", hunk, text, lines: { added: 1, removed: 1 } });

describe("events → hunk states", () => {
  it("parses hunk events and drops malformed ones", () => {
    const ok = parseAgentEvent({ session: "s", event: start("c:1", 2, 2, "    for c in chars {\n") });
    expect(ok?.event.kind).toBe("hunk_start");
    expect(parseAgentEvent({ session: "s", event: { kind: "hunk_start", hunk: "c:1" } })).toBeNull();
    expect(parseAgentEvent({ session: "s", event: { kind: "hunk_rejected", hunk: "c:1", by: "robot", reason: "x" } })).toBeNull();
    expect(parseAgentEvent({ session: "s", event: { kind: "validation", status: "passed", checks: [], baseline: [] } })?.event.kind).toBe("validation");
  });

  it("streams, proposes, reviews and settles a hunk", () => {
    let s = run([start("c:1", 2, 2, "    for c in chars {\n"), chunk("c:1", "    while let"), chunk("c:1", " Some(c)")]);
    expect(s.hunks[0]).toMatchObject({ status: "streaming", text: "    while let Some(c)", shown: 0 });
    s = run([end("c:1", "    while let Some(c) = chars.next() {\n"), { kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "Assistido" }], s);
    expect(s.hunks[0].status).toBe("review");
    expect(s.reviews).toHaveLength(1);
    s = run([{ kind: "hunk_applied", hunk: "c:1", provisional: false, fingerprint: "f" }], s);
    expect(s.hunks[0].status).toBe("applied");
    expect(s.reviews).toHaveLength(0);
  });

  it("rejected and stale hunks leave the editor", () => {
    const s = run([
      start("c:1", 1, 1, "a\n"),
      start("c:2", 3, 3, "c\n"),
      { kind: "hunk_rejected", hunk: "c:1", by: "cancel", reason: "stopped" },
      { kind: "hunk_stale", hunk: "c:2", path: "lib.rs" },
    ]);
    expect(s.hunks.filter(isOpen)).toHaveLength(0);
    expect(s.hunks[0].reason).toBe("stopped");
  });

  it("an applied hunk moves the open hunks below it in the same file", () => {
    const s = run([
      start("c:1", 2, 2, "b\n"),
      end("c:1", "b1\nb2\nb3\n"),
      start("d:1", 5, 4, ""),
      { kind: "hunk_applied", hunk: "c:1", provisional: true, fingerprint: "f" },
    ]);
    expect(s.hunks[0].provisional).toBe(true);
    expect(s.hunks[1].anchor).toBe(7);
  });
});

describe("typing pace", () => {
  it("reveals the active hunk a few characters at a time, pauses and catches up", () => {
    let s = run([start("c:1", 1, 1, "a\n"), chunk("c:1", "hello world")]);
    s = revealStep(s, 4);
    expect(s.hunks[0].shown).toBe(4);
    s = revealStep(setPaused(s, true), 4);
    expect(s.hunks[0].shown).toBe(4);
    s = revealAll(setPaused(s, false));
    expect(s.hunks[0].shown).toBe(11);
    expect(activeHunk(s)?.id).toBe("c:1"); // still streaming
    s = run([end("c:1", "hello world\n")], s);
    expect(activeHunk(s)?.id).toBe("c:1"); // the newline is not shown yet
    s = revealAll(s);
    expect(activeHunk(s)).toBeNull();
  });

  it("types hunks one after another", () => {
    let s = run([start("c:1", 1, 1, "a\n"), end("c:1", "A\n"), start("c:2", 3, 3, "c\n"), end("c:2", "C\n")]);
    s = revealStep(s, 100);
    expect(s.hunks.map((h) => h.shown)).toEqual([2, 0]);
    s = revealStep(s, 100);
    expect(s.hunks.map((h) => h.shown)).toEqual([2, 2]);
  });
});

describe("the editor's view of a file", () => {
  it("shows old lines then the new lines written so far, with the writing line marked", () => {
    let s = run([start("c:1", 2, 2, "    for c in chars {\n"), chunk("c:1", "    while let Some(c)")]);
    s = revealStep(s, 13);
    const v = virtualView(FILE, "lib.rs", s);
    expect(v.lines.map((l) => [l.kind, l.text])).toEqual([
      ["ctx", "fn f() {"],
      ["old", "    for c in chars {"],
      ["new", "    while let"],
      ["ctx", "    }"],
      ["ctx", "}"],
      ["ctx", ""],
    ]);
    expect(v.lines[2].writing).toBe(true);
    expect(v.lines[1].real).toBe(2);
    expect(v.lines[3].real).toBe(3);
    expect(v.blocks).toEqual([{ hunk: "c:1", from: 1, to: 3 }]);
    // other files are not affected
    expect(virtualView(FILE, "other.rs", s).text).toBe(FILE);
  });

  it("finds the old lines when the file moved, and inserts at the end", () => {
    const s = revealAll(run([start("c:1", 1, 1, "    }\n"), end("c:1", "    };\n"), start("d:1", 5, 4, ""), end("d:1", "// end\n")]));
    const v = virtualView(FILE, "lib.rs", s);
    expect(v.lines.map((l) => l.kind)).toEqual(["ctx", "ctx", "old", "new", "ctx", "new", "ctx"]);
    expect(v.lines[5].text).toBe("// end");
  });

  it("does not draw a hunk whose old lines are gone or ambiguous", () => {
    const s = run([start("c:1", 1, 1, "missing\n"), start("c:2", 1, 1, "x\n")]);
    expect(virtualView("a\nb\n", "lib.rs", s).blocks).toEqual([]);
    expect(virtualView("y\nx\nx\n", "lib.rs", s).blocks).toEqual([]);
  });
});

describe("human edits while hunks are open", () => {
  const s = revealAll(run([start("c:1", 2, 2, "    for c in chars {\n"), end("c:1", "    while let Some(c) = chars.next() {\n")]));
  const v = virtualView(FILE, "lib.rs", s);

  it("an edit outside the hunks changes the real file at the same place", () => {
    const next = v.text.replace("    }", "    } // loop");
    const r = mapEdit(v, next, FILE);
    expect(r?.real).toBe("fn f() {\n    for c in chars {\n    } // loop\n}\n");
    expect(r?.delta).toBe(0);
    const top = mapEdit(v, "// top\n" + v.text, FILE);
    expect(top?.real).toBe("// top\n" + FILE);
    expect(top).toMatchObject({ line: 1, delta: 1 });
    expect(shiftAnchors(s, "lib.rs", top!.line, top!.delta).hunks[0].anchor).toBe(3);
  });

  it("an edit on a hunk's lines is refused", () => {
    expect(mapEdit(v, v.text.replace("while let", "while"), FILE)).toBeNull();
    expect(mapEdit(v, v.text.replace("for c in", "for x in"), FILE)).toBeNull();
    // joining the line before the hunk with the hunk's first line
    expect(mapEdit(v, v.text.replace("fn f() {\n", "fn f() {"), FILE)).toBeNull();
  });

  it("typing at the end of the line just before a hunk is fine", () => {
    const r = mapEdit(v, v.text.replace("fn f() {", "fn f() { // ok"), FILE);
    expect(r?.real.startsWith("fn f() { // ok\n    for c in chars {")).toBe(true);
  });
});

describe("reviews", () => {
  it("a review is complete when every open hunk has a choice", () => {
    let s = run([
      start("c:1", 1, 1, "a\n"),
      start("c:2", 3, 3, "c\n"),
      { kind: "hunk_review", call: "c", hunks: ["c:1", "c:2"], reason: "Manual" },
    ]);
    s = choose(s, "c:1", "accept");
    expect(completeReview(s, "c:1")).toBeNull();
    s = choose(s, "c:2", "reject");
    expect(completeReview(s, "c:2")?.call).toBe("c");
  });
});
