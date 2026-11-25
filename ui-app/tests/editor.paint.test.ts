// Bug 8 of docs/v2/RF-DELONIX-PLANO.md §2 (RF-S03): typing in the editor repainted it with the base
// painter (`paintEd`), which leaves out what `paintEdFull` adds on top — breakpoints, the line the
// debugger stopped on, the inline values and the inline diagnostics — so they vanished at every key
// until something else repainted. In the real editor of the harness.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any — the harness window
let DM: typeof import("../src/features/debug");

beforeEach(async () => {
  w = await bootApp();
  DM = await import("../src/features/debug");
  w.LS.set("bps6", []); // the breakpoints are kept in LS, which outlives a test in this jsdom
});

it("a breakpoint stays in the margin while the human types", () => {
  const p = w.ROOT + "crates/lexer/src/lib.rs";
  w.openPath(p);
  DM.toggleBp(p, 2);
  w.paintEd(p); // the published painter (the full one)
  const gut = (): Element[] => [...document.getElementById("ed-gut")!.children];
  expect(gut()[1].classList.contains("bp")).toBe(true);
  const ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
  ta.value = ta.value + "\n// typed";
  ta.dispatchEvent(new Event("input"));
  expect(gut()[1].classList.contains("bp")).toBe(true);
  expect(gut().filter((g) => g.classList.contains("bp"))).toHaveLength(1);
});
