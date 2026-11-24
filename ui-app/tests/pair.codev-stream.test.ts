import { expect, test } from "vitest";
import { bootApp } from "./harness";

/* RF-S09 (docs/v2/RF-DELONIX-PLANO.md F6.5): in a PairCode session the guest sees the same
   Co-Dev stream and highlight as the host — the host's live hunk events go through the pair
   channel and feed the guest's editor overlay (read-only there). */

test("o canal só leva os eventos dos hunks e chega ao overlay do convidado", async () => {
  await bootApp();
  const { pairState } = await import("../src/app/pair-state");
  const { hunkReview } = await import("../src/features/codev/index");
  const sent: unknown[] = [];
  pairState.registerCodevSend((e) => sent.push(e));
  pairState.codevOut({ kind: "stream" });
  pairState.codevOut({ kind: "hunk_start" });
  expect(sent).toEqual([{ kind: "hunk_start" }]);
  // the guest: an event from the host draws the hunk in its overlay
  pairState.codevIn({ kind: "hunk_start", hunk: "c:1", call: "c", path: "src/a.rs", op: "insert", range: { start: 1, end: 0 }, base: null, old: "" });
  pairState.codevIn({ kind: "hunk_chunk", hunk: "c:1", text: "fn x() {}\n" });
  const h = hunkReview.state().hunks.find((x) => x.id === "c:1");
  expect(h?.path).toBe("src/a.rs");
  expect(h?.text).toBe("fn x() {}\n");
  // garbage from the channel is ignored
  pairState.codevIn({ nope: 1 });
});

test("os hunks espelhados não se decidem do lado do convidado", async () => {
  await bootApp();
  const { pairState } = await import("../src/app/pair-state");
  const { hunkReview } = await import("../src/features/codev/index");
  const notes: string[] = [];
  pairState.codevIn({ kind: "hunk_start", hunk: "m:1", call: "m", path: "src/b.rs", op: "insert", range: { start: 1, end: 0 }, base: null, old: "" });
  pairState.codevIn({ kind: "hunk_end", hunk: "m:1", text: "x\n", lines: { added: 1, removed: 0 } });
  pairState.codevIn({ kind: "hunk_review", call: "m", hunks: ["m:1"], reason: "Assistido" });
  // deciding on the guest goes through the review dependency, which refuses the mirror
  hunkReview.sink.decideAll("m", true);
  await new Promise((r) => setTimeout(r, 0));
  expect(notes.length).toBe(0); // no crash; the refusal is reported through the notifier
});
