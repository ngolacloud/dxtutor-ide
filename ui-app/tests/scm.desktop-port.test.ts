import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* A0.5 (docs/v2/UI-AUDIT.md): on the desktop app every Source Control action must go
 * through the desktop port (`desktopPorts.scm`, real git), not the in-memory engine.
 * Before this fix the pane buttons, the branch picker, the gitflow prompt and Ctrl+Enter
 * used the local engine, so commits and branches made from the pane never reached git.
 * These tests install a fake port and prove each entry point consults it. */

let w: any;
let calls: string[];

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
  calls = [];
  const { desktopPorts } = await import("../src/app/desktop");
  desktopPorts.scm = {
    commit: (msg, author) => { calls.push(`commit:${msg ?? ""}:${author ?? ""}`); return { h: "real", m: msg ?? "", n: 1 }; },
    checkout: (b, create, virtual) => { calls.push(`checkout:${b}:${!!create}`); return virtual(b, create); },
    gitMerge: (src) => { calls.push(`merge:${src}`); return { h: "real", m: src }; },
    gfStart: (kind, name) => { calls.push(`gfStart:${kind}:${name}`); return `${kind}/${name}`; },
    gfFinish: (b) => { calls.push(`gfFinish:${b ?? ""}`); return { h: "real", m: "merge" }; },
  };
  w.renderScmPane();
});

afterEach(async () => {
  const { desktopPorts } = await import("../src/app/desktop");
  delete desktopPorts.scm;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Source Control on the desktop goes through the real-git port", () => {
  it("the Commit button uses the port", () => {
    click(document.querySelector('#pane-scm [data-action="commit"]')!);
    expect(calls).toEqual(["commit::"]);
  });

  it("a branch row uses the port to check out", () => {
    const row = [...document.querySelectorAll('#pane-scm [data-action="checkout"]')].find((e) => e.getAttribute("data-on") === "main")!;
    click(row);
    expect(calls).toEqual(["checkout:main:false"]);
  });

  it("Ctrl+Enter in the commit message uses the port (git-aware commit)", () => {
    const input = document.getElementById("scm-msg")!;
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    expect(calls).toEqual(["commit::"]);
  });

  it("the published globals used by the monolith and the agents use the port", () => {
    w.commitGit("feat: x", "lead");
    w.gfStart("feature", "export-report");
    w.gfFinish("feature/export-report");
    expect(calls).toEqual(["commit:feat: x:lead", "gfStart:feature:export-report", "gfFinish:feature/export-report"]);
  });

  it("finishing a feature from the pane uses the port", () => {
    w.checkout("feature/x", true);
    calls = [];
    w.renderScmPane();
    click(document.querySelector('#pane-scm [data-action="gf-finish-feature"]')!);
    expect(calls).toEqual(["gfFinish:"]);
  });
});
