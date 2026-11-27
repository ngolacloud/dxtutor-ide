// RF-A03/A04 (sessão de fecho dos RF, bloco 3): uma alteração que viola as regras do arquitecto
// chega à revisão a vermelho, com «Aceitar» desligado; o override do Arquitecto, com o número de um
// ADR aceite, desbloqueia-a. O papel, o ADR e o registo são do backend (testados no Rust); aqui:
// o evento, o estado, o caso de uso e as duas barras (editor e chat).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { parseAgentEvent, type AgentEvent } from "../src/features/codev/domain/agent-events";
import { blockedReview, initialOverlay, overrideReview, reduceOverlay } from "../src/features/codev/domain/hunk-overlay";
import { makeHunkReview } from "../src/features/codev/application/hunk-review";

const V = [{ rule: "library:moment", message: "biblioteca proibida: moment", path: "src/a.ts", line: 1 }];
const start = (hunk: string): AgentEvent =>
  ({ kind: "hunk_start", hunk, call: hunk.split(":")[0], path: "src/a.ts", op: "replace", range: { start: 1, end: 1 }, base: null, old: "a\n" }) as AgentEvent;
const end = (hunk: string): AgentEvent => ({ kind: "hunk_end", hunk, text: "import moment from 'moment';\n", lines: { added: 1, removed: 1 } }) as AgentEvent;
const review = (violations?: typeof V): AgentEvent =>
  ({ kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "viola as regras", ...(violations ? { violations } : {}) }) as AgentEvent;

describe("domínio", () => {
  it("o evento traz as violações; a revisão fica bloqueada até ao override", () => {
    const parsed = parseAgentEvent({ session: "S", event: { kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "x", violations: V } });
    expect(parsed?.event).toEqual({ kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "x", violations: V });
    let s = [start("c:1"), end("c:1"), review(V)].reduce(reduceOverlay, initialOverlay());
    expect(blockedReview(s, "c:1")?.violations).toEqual(V);
    expect(blockedReview(s, "c")).not.toBeNull(); // by the call too
    s = overrideReview(s, "c", "ADR-0007");
    expect(blockedReview(s, "c:1")).toBeNull();
    expect(s.reviews[0].overriddenBy).toBe("ADR-0007");
    // without violations nothing is blocked
    const ok = [start("c:1"), end("c:1"), review()].reduce(reduceOverlay, initialOverlay());
    expect(blockedReview(ok, "c:1")).toBeNull();
    expect(ok.reviews[0].violations).toBeUndefined();
  });
});

function fakes(answer: string | null = "ADR-0007", fail?: string) {
  const log: string[] = [];
  const deps = {
    review: vi.fn(async (_s: string, call: string, d: unknown) => void log.push(`review ${call} ${JSON.stringify(d)}`)),
    override: vi.fn(async (_s: string, call: string, adr: string) => {
      if (fail) throw new Error(fail);
      log.push(`override ${call} ${adr}`);
    }),
    askAdr: vi.fn(() => answer),
    flush: vi.fn(async () => undefined),
    reloadFromDisk: vi.fn(async () => undefined),
    editor: { repaint: () => undefined, open: () => undefined, current: () => null, reveal: () => undefined, preview: () => undefined },
    every: () => () => undefined,
    pace: () => 40,
    notify: (m: string) => log.push(`notify ${m}`),
    cancel: vi.fn(),
  };
  const r = makeHunkReview(deps);
  r.readFrom(() => "a\n");
  for (const e of [start("c:1"), end("c:1"), review(V)]) r.sink.event("S", e);
  return { r, deps, log };
}

describe("caso de uso", () => {
  it("aceitar é recusado até ao override; com ele, a decisão segue", async () => {
    const { r, deps, log } = fakes();
    r.decide("c:1", true);
    r.decideAll("c", true);
    expect(deps.review).not.toHaveBeenCalled();
    expect(log.filter((l) => l.startsWith("notify")).at(-1)).toContain("override do Arquitecto");
    const settledOverride: string[] = [];
    r.sink.onOverridden!("c", (adr) => settledOverride.push(adr));
    expect(await r.sink.override!("c")).toBe(true);
    expect(deps.askAdr).toHaveBeenCalledWith("biblioteca proibida: moment");
    expect(log).toContain("override c ADR-0007");
    expect(settledOverride).toEqual(["ADR-0007"]);
    r.decide("c:1", true);
    await vi.waitFor(() => expect(deps.review).toHaveBeenCalledWith("S", "c", [{ hunk: "c:1", accept: true }]));
  });

  it("rejeitar não precisa de override; cancelar ou o backend recusar deixam-na bloqueada", async () => {
    const a = fakes();
    a.r.decide("c:1", false);
    await vi.waitFor(() => expect(a.deps.review).toHaveBeenCalledTimes(1));
    const cancelled = fakes(null);
    expect(await cancelled.r.sink.override!("c")).toBe(false);
    expect(cancelled.deps.override).not.toHaveBeenCalled();
    const refused = fakes("ADR-0099", "o ADR «ADR-0099» não está aceite");
    expect(await refused.r.sink.override!("c")).toBe(false);
    expect(refused.log.at(-1)).toBe("notify o ADR «ADR-0099» não está aceite");
    refused.r.decide("c:1", true);
    expect(refused.deps.review).not.toHaveBeenCalled();
  });
});

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any — a janela do harness
beforeEach(async () => { w = await bootApp(); });
afterEach(() => { document.getElementById("ag-msgs")?.replaceChildren(); });

describe("as barras", () => {
  it("chat: a vermelho, «Aceitar todas» desligado, «Override (ADR)…»; o override desbloqueia", async () => {
    const { presenter } = await import("../src/features/codev/ui/chat-view");
    const card = presenter.thinking("co-dev");
    const ref = presenter.toolLine(card.tools, "edit", "src/a.ts");
    const calls: string[] = [];
    const bar = presenter.hunkReview!(ref, { path: "src/a.ts", count: 1, reason: "", violations: ["biblioteca proibida: moment"] }, {
      acceptAll: () => calls.push("acceptAll"), rejectAll: () => calls.push("rejectAll"), open: () => undefined, override: () => calls.push("override"),
    });
    const gate = document.querySelector(".hk-gate")!;
    expect(gate.classList.contains("hk-violation")).toBe(true);
    expect(gate.querySelector(".hk-rules")!.textContent).toBe("breaks the rules: biblioteca proibida: moment");
    const accept = [...gate.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Aceitar todas")!;
    expect(accept.disabled).toBe(true);
    [...gate.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Override (ADR)…")!.click();
    expect(calls).toEqual(["override"]);
    bar.unblock!("ADR-0007");
    expect(accept.disabled).toBe(false);
    expect(gate.classList.contains("hk-violation")).toBe(false);
    expect(gate.querySelector(".hk-rules")!.textContent).toContain("override: ADR-0007");
    // without violations: no rules line, no override button
    const ref2 = presenter.toolLine(card.tools, "edit", "src/b.ts");
    presenter.hunkReview!(ref2, { path: "src/b.ts", count: 1, reason: "" }, { acceptAll: () => undefined, rejectAll: () => undefined, open: () => undefined, override: () => undefined });
    const gates = document.querySelectorAll(".hk-gate");
    expect(gates[1].querySelector(".hk-rules")).toBeNull();
    expect([...gates[1].querySelectorAll("button")].some((b) => b.textContent === "Override (ADR)…")).toBe(false);
  });

  it("editor: o bloco que viola as regras tem «Aceitar» desligado e «Override (ADR)…»", async () => {
    const { makeHunkOverlayView } = await import("../src/features/codev/ui/hunk-overlay-view");
    const { r } = fakes();
    r.faster(); // the typing is over (the test's ticker never runs)
    const view = makeHunkOverlayView(r);
    const host = { wrap: document.createElement("div"), hl: document.createElement("div"), gut: document.createElement("div") };
    const v = r.view("src/a.ts", "a\n")!;
    view.decorate("src/a.ts", host, v);
    const barEl = host.wrap.querySelector(".hk-bar")!;
    expect(barEl.querySelector(".hk-tag-bad")!.textContent).toBe("breaks the rules");
    expect(barEl.querySelector('[data-action="hunk-accept"]')).toBeNull();
    expect((barEl.querySelector("button[disabled]") as HTMLButtonElement).textContent).toBe("Aceitar");
    expect(barEl.querySelector('[data-action="hunk-override"]')?.getAttribute("data-on")).toBe("c:1");
    // after the override: the usual bar
    await r.sink.override!("c");
    view.decorate("src/a.ts", host, r.view("src/a.ts", "a\n")!);
    expect(host.wrap.querySelector('.hk-bar [data-action="hunk-accept"]')).not.toBeNull();
  });
});
