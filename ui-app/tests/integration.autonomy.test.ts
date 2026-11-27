import { describe, expect, it, vi } from "vitest";
import { activeDelegations, canOpenPr, grantProblem, parseNotice, parseOverview, parsePrState, type Overview, type PrState } from "../src/features/integration/domain/autonomy";
import { makeAutonomyService } from "../src/features/integration/application/autonomy-service";
import type { AutonomyDeps, AutonomyGateway } from "../src/features/integration/application/ports";
import { AUTONOMY_MESSAGES, type AutonomyKey } from "../src/features/integration/application/autonomy-messages";
import { readGrantForm, renderAutonomy, type TA } from "../src/features/integration/ui/autonomy-view";

/* Multi Co-Dev, phase 5: delegated autonomy and pull requests. The rules (who may delegate, the expiry, the kill
   switch, the rate, the gate the autonomy never skips, the push that is never forced) are Rust's —
   `cargo test -p tutor-board autonomy`, `-p tutor-eval gitwork::publish gh::`, `-p dxtutor-ide codev_autonomy`.
   Here: answers that do not parse never offer more than the backend allows, the section says the switch, the mode,
   the delegations, the log with its audit rows and the pull request, and the use case asks the shared approval
   dialog with the backend's text, audits a refusal, pauses at once, and never acts by itself. */

const ta: TA = (k, p) => {
  const s = AUTONOMY_MESSAGES.en[k];
  return p ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in p ? String(p[n]) : all)) : s;
};

const NOW = 1_800_000_000_000;
const H = 3_600_000;

const delegation = (over: Record<string, unknown> = {}) => ({
  id: 3,
  scope: "issue",
  target: "DX-2",
  actions: ["review", "integrate"],
  provider: "claude",
  model: null,
  language: "en",
  note: "",
  grantedBy: "Ana",
  grantedEmail: "ana@x.pt",
  grantedAt: NOW - H,
  expiresAt: NOW + 2 * H + 30 * 60_000,
  revokedBy: null,
  revokedAt: null,
  revokeReason: null,
  ...over,
});

const event = (over: Record<string, unknown> = {}) => ({ id: 9, key: "DX-2", delegation: 3, action: "integrate", trigger: "review_done", outcome: "stopped", code: "awaiting_functional", detail: "functional: not_recorded", review: 7, audit: [], at: NOW, ...over });

const overviewRaw = (over: Record<string, unknown> = {}) => ({
  switch: { paused: false, by: null, at: null, reason: null },
  delegations: [delegation(), delegation({ id: 2, revokedAt: NOW - 10, revokedBy: "Rui" }), delegation({ id: 1, expiresAt: NOW - 1 })],
  events: [event({ id: 10, action: "review", outcome: "ok", code: "reviewed", detail: "every criterion met", audit: [41, 42] }), event()],
  used: 2,
  limit: 6,
  now: NOW,
  sprint: "S1",
  mode: "integrate",
  ...over,
});

const PLAN = `git -C /p push --porcelain -- origin ${"ab".repeat(20)}:refs/heads/feature/dx-2-pay\ngh pr create --base 'main' --head 'feature/dx-2-pay' --title 'DX-2: Pay' --body-file -   # the body: the gate's evidence`;

const prRaw = (over: Record<string, unknown> = {}) => ({ key: "DX-2", gh: { installed: true, version: "gh version 2.60.0", signedIn: true, notes: "" }, plan: PLAN, blocked: null, record: null, live: null, liveError: null, ...over });

describe("narrowing the backend's answers", () => {
  it("an unreadable switch counts as paused, and an unreadable overview is no overview", () => {
    expect(parseOverview(overviewRaw({ switch: { paused: "no" } }))!.switch.paused).toBe(true);
    expect(parseOverview(overviewRaw())!.switch.paused).toBe(false);
    expect(parseOverview({ ...overviewRaw(), switch: 3 })).toBeNull();
    expect(parseOverview(null)).toBeNull();
    const o = parseOverview(overviewRaw())!;
    // only the active ones (not revoked, not expired), newest first
    expect(activeDelegations(o).map((d) => d.id)).toEqual([3]);
    // unknown actions are dropped
    expect(parseOverview(overviewRaw({ delegations: [delegation({ actions: ["review", "merge_everything"] })] }))!.delegations[0].actions).toEqual(["review"]);
  });

  it("a pull request can be opened only with the backend's text and nothing blocking it", () => {
    expect(canOpenPr(parsePrState(prRaw()))).toBe(true);
    expect(canOpenPr(parsePrState(prRaw({ plan: null, blocked: "the gate does not hold: functional: not_recorded" })))).toBe(false);
    expect(canOpenPr(parsePrState(prRaw({ blocked: "gh is not signed in" })))).toBe(false);
    expect(canOpenPr(null)).toBe(false);
    expect(parsePrState({ plan: PLAN })).toBeNull();
  });

  it("a notice says whether it integrated, and which session to close", () => {
    const n = parseNotice({ root: "/p", event: event({ outcome: "ok", code: "integrated" }), integrated: { commit: "c".repeat(40), session: "S2" } })!;
    expect([n.integrated, n.session]).toEqual([true, "S2"]);
    expect(parseNotice({ root: "/p", event: { key: "DX-2" } })).toBeNull();
  });

  it("integrating locally and opening a pull request exclude each other; at least one action", () => {
    expect(grantProblem([])).toBe("none");
    expect(grantProblem(["integrate", "pr"])).toBe("both");
    expect(grantProblem(["review", "pr"])).toBeNull();
  });
});

const model = (o: Overview | null, pr: PrState | null, audit: Record<number, unknown> = {}) => ({
  key: "DX-2",
  overview: o,
  pr,
  error: null,
  busy: false,
  audit: (id: number) => (audit[id] as never) ?? null,
  eventText: (code: string) => ta(`ev_${code}` as AutonomyKey),
});

describe("the «Autonomy and pull request» section", () => {
  it("says the switch, the mode, the active delegations with Revoke, the editor and the log with its audit rows", () => {
    const o = parseOverview(overviewRaw())!;
    document.body.innerHTML = renderAutonomy(ta, model(o, parsePrState(prRaw()), { 41: { id: 41, at: NOW, call: "review.request", outcome: "sent", decidedBy: "delegation:3:Ana", command: "git -C /p merge-tree …", reason: "" } }));
    const txt = document.body.textContent!;
    expect(txt).toContain("Autonomy is on: it acts only where a person delegated it.");
    expect(txt).toContain("2 of 6 autonomous actions in the last hour.");
    expect(txt).toContain("When the gate opens: the Co-Dev integrates it locally (delegated).");
    // one active delegation (the revoked and the expired ones are not offered), who gave it and when it ends
    expect(document.querySelectorAll('[data-action="integration:revoke"]')).toHaveLength(1);
    expect(document.querySelector('[data-action="integration:revoke"]')!.getAttribute("data-on")).toBe("DX-2|3");
    expect(txt).toContain("by Ana, expires in 2 h 30 min");
    // the editor: the three actions, this issue or its sprint, and the expiry
    expect(document.querySelectorAll('input[name="ig-act"]')).toHaveLength(3);
    expect(document.querySelector('select[name="ig-scope"]')!.textContent).toContain("Its sprint (S1)");
    expect([...document.querySelectorAll('select[name="ig-hours"] option')].map((x) => x.getAttribute("value"))).toEqual(["8", "24", "72", "168"]);
    // the log, newest first, with its audit rows: one shown, one a link
    const log = document.querySelectorAll(".ig-log li");
    expect(log[0].textContent).toContain("The reviewer met every criterion.");
    expect(log[0].querySelectorAll('[data-action="integration:audit"]')).toHaveLength(2);
    expect(log[0].querySelector(".ig-audit")!.textContent).toContain("review.request · sent · decided by delegation:3:Ana");
    expect(log[1].textContent).toContain("Waiting for the functional approval (a person's).");
    // the pull request button, with the backend's plan
    expect(document.querySelector('[data-action="integration:pr-open"]')!.getAttribute("title")).toContain("Push feature/dx-2-pay and open a pull request into main");
    expect(txt).toContain("gh gh version 2.60.0, signed in.");
  });

  it("paused: says who paused it and offers Resume, never Pause", () => {
    const o = parseOverview(overviewRaw({ switch: { paused: true, by: "Rui", at: NOW, reason: "" } }))!;
    document.body.innerHTML = renderAutonomy(ta, model(o, null));
    expect(document.body.textContent).toContain("Autonomy is paused for the whole app by Rui.");
    expect(document.querySelector('[data-action="integration:resume"]')).not.toBeNull();
    expect(document.querySelector('[data-action="integration:pause"]')).toBeNull();
  });

  it("gh missing or signed out is said and no pull request is offered; an open one shows its state on GitHub", () => {
    const o = parseOverview(overviewRaw({ delegations: [], events: [], mode: "manual" }))!;
    document.body.innerHTML = renderAutonomy(ta, model(o, parsePrState(prRaw({ plan: null, gh: { installed: true, version: "gh 2", signedIn: false, notes: "" }, blocked: "gh is not signed in: run `gh auth login` yourself" }))));
    expect(document.body.textContent).toContain("gh is not signed in: run `gh auth login` yourself.");
    expect(document.querySelector('[data-action="integration:pr-open"]')).toBeNull();
    expect(document.body.textContent).toContain("Nothing delegated for this issue or its sprint.");
    document.body.innerHTML = renderAutonomy(
      ta,
      model(o, parsePrState(prRaw({ plan: null, blocked: "pull request #42 is already open for exactly this review", record: { number: 42, prUrl: "https://github.com/o/r/pull/42", branch: "feature/dx-2-pay", head: "h", target: "main", remote: "origin", actor: "Ana", delegation: null, at: NOW }, live: { number: 42, url: "u", state: "OPEN", draft: false, review: "APPROVED", checks: { passed: 3, failed: 0, pending: 1 }, mergedAt: "" } }))),
    );
    expect(document.body.textContent).toContain("#42 · feature/dx-2-pay → main · opened by Ana");
    expect(document.body.textContent).toContain("On GitHub: OPEN · review APPROVED · checks 3 passed, 0 failed, 1 pending");
  });

  it("an issue in no sprint cannot delegate on its sprint; the form reads what was chosen", () => {
    const o = parseOverview(overviewRaw({ sprint: null }))!;
    document.body.innerHTML = renderAutonomy(ta, model(o, null));
    expect((document.querySelector('select[name="ig-scope"] option[value="sprint"]') as HTMLOptionElement).disabled).toBe(true);
    (document.querySelector('input[value="review"]') as HTMLInputElement).checked = true;
    (document.querySelector('input[value="pr"]') as HTMLInputElement).checked = true;
    (document.querySelector('select[name="ig-hours"]') as HTMLSelectElement).value = "72";
    expect(readGrantForm(document, "DX-2")).toEqual({ scope: "issue", actions: ["review", "pr"], hours: 72 });
    expect(readGrantForm(document, "OTHER-1").actions).toEqual([]);
  });
});

function harness(over: Partial<AutonomyGateway> = {}, approved = true) {
  let notice: ((n: ReturnType<typeof parseNotice> & object) => void) | null = null;
  const gateway: AutonomyGateway = {
    overview: vi.fn(async () => parseOverview(overviewRaw())!),
    grant: vi.fn(async () => parseOverview(overviewRaw())!.delegations[0]),
    revoke: vi.fn(async () => parseOverview(overviewRaw())!.delegations[0]),
    pause: vi.fn(async (_r: string, paused: boolean) => ({ paused, by: null, at: null, reason: null })),
    prState: vi.fn(async () => parsePrState(prRaw())!),
    prOpen: vi.fn(async () => ({ key: "DX-2", number: 42, url: "https://github.com/o/r/pull/42", remote: "origin", branch: "feature/dx-2-pay", head: "h".repeat(40), createdBranch: true })),
    auditRows: vi.fn(async () => [{ id: 41, at: NOW, call: "review.request", outcome: "sent", decidedBy: "delegation:3:Ana", command: "c", reason: "" }]),
    onNotice: vi.fn(async (f) => {
      notice = f;
      return () => undefined;
    }),
    ...over,
  };
  const notes: string[] = [];
  const deps: AutonomyDeps = {
    gateway,
    root: () => "/p",
    approve: vi.fn(async () => ({ approved, reason: "", decidedAt: 42 })),
    audit: vi.fn(async () => undefined),
    guard: vi.fn(<T,>(f: () => Promise<T>) => f()),
    reviewer: () => ({ provider: "claude", model: "claude-opus-5-5", language: "en" }),
    reviewChanged: vi.fn(),
    closeSession: vi.fn(() => true),
    projectChanged: vi.fn(),
    notify: (m) => notes.push(m),
    copy: (k: AutonomyKey, p) => ta(k, p),
  };
  return { svc: makeAutonomyService(deps), deps, gateway, notes, notice: (n: unknown) => notice?.(parseNotice(n)!) };
}

describe("the autonomy use case", () => {
  it("delegates after the dialog shows what is delegated, with the Co-Dev's reviewer; the backend checks the role", async () => {
    const h = harness();
    await h.svc.refresh("DX-2");
    await h.svc.grant("DX-2", "sprint", ["review", "integrate"], 24);
    expect(h.deps.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delegate to the Co-Dev on sprint S1",
        command: "delegate review, integrate on sprint S1 for 24 h",
        list: expect.objectContaining({ items: ["request the review when the Co-Dev session finishes the issue", "integrate locally when the gate is open"] }),
      }),
    );
    expect(h.gateway.grant).toHaveBeenCalledWith("/p", { scope: "sprint", target: "S1", actions: ["review", "integrate"], hours: 24, provider: "claude", model: "claude-opus-5-5", language: "en" });
  });

  it("asks nothing when the choice is invalid, and a refusal in the dialog runs nothing and is audited", async () => {
    const h = harness({}, false);
    await h.svc.refresh("DX-2");
    await h.svc.grant("DX-2", "issue", ["integrate", "pr"], 24);
    expect(h.deps.approve).not.toHaveBeenCalled();
    expect(h.notes.at(-1)).toBe("Integrating locally and opening a pull request exclude each other: choose one.");
    await h.svc.grant("DX-2", "issue", ["pr"], 8);
    await h.svc.resume("DX-2");
    await h.svc.openPr("DX-2");
    expect(h.gateway.grant).not.toHaveBeenCalled();
    expect(h.gateway.pause).not.toHaveBeenCalled();
    expect(h.gateway.prOpen).not.toHaveBeenCalled();
    expect(h.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ action: "autonomy.grant", approved: false, command: "delegate pr on issue DX-2 for 8 h" }));
    expect(h.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ action: "autonomy.resume", approved: false }));
    expect(h.deps.audit).toHaveBeenCalledWith("/p", expect.objectContaining({ action: "review.pr", approved: false, command: PLAN }));
  });

  it("pauses at once, without a dialog; resuming asks", async () => {
    const h = harness();
    await h.svc.pause("DX-2");
    expect(h.deps.approve).not.toHaveBeenCalled();
    expect(h.gateway.pause).toHaveBeenCalledWith("/p", true, "");
    await h.svc.resume("DX-2");
    expect(h.deps.approve).toHaveBeenCalledWith(expect.objectContaining({ title: "Resume autonomy for the whole app", command: "resume autonomy" }));
    expect(h.gateway.pause).toHaveBeenLastCalledWith("/p", false, "");
  });

  it("opens the pull request with the backend's exact text, through the secret-scan guard", async () => {
    const h = harness();
    await h.svc.openPr("DX-2");
    expect(h.deps.approve).toHaveBeenCalledWith(expect.objectContaining({ title: "Push feature/dx-2-pay and open a pull request into main", command: PLAN, scope: "remote origin · the reviewed commit abababab" }));
    expect(h.deps.guard).toHaveBeenCalled();
    expect(h.gateway.prOpen).toHaveBeenCalledWith("/p", "DX-2", PLAN, 42);
    expect(h.notes.at(-1)).toBe("Pull request #42 opened: https://github.com/o/r/pull/42");
    // without the backend's text there is nothing to approve
    const blocked = harness({ prState: vi.fn(async () => parsePrState(prRaw({ plan: null, blocked: "the gate does not hold" }))!) });
    await blocked.svc.openPr("DX-2");
    expect(blocked.deps.approve).not.toHaveBeenCalled();
    expect(blocked.gateway.prOpen).not.toHaveBeenCalled();
  });

  it("tells each autonomous step, closes the integrated issue's session, and ignores another folder's", async () => {
    const h = harness();
    h.svc.listen();
    await vi.waitFor(() => expect(h.gateway.onNotice).toHaveBeenCalled());
    h.notice({ root: "/other", event: event({ outcome: "ok", code: "integrated" }), integrated: { commit: "c", session: "S9" } });
    expect(h.notes).toHaveLength(0);
    h.notice({ root: "/p", event: event({ outcome: "ok", code: "integrated" }), integrated: { commit: "c".repeat(40), session: "S2" } });
    expect(h.notes.at(-1)).toBe("Co-Dev autonomy · DX-2: Integrated through the gate.");
    expect(h.deps.closeSession).toHaveBeenCalledWith("S2");
    expect(h.deps.projectChanged).toHaveBeenCalled();
    expect(h.deps.reviewChanged).toHaveBeenCalledWith("DX-2");
    // a code this interface does not know is said as it is, never as done
    h.notice({ root: "/p", event: event({ code: "from_the_future" }) });
    expect(h.notes.at(-1)).toBe("Co-Dev autonomy · DX-2: Step «from_the_future».");
  });

  it("shows the audit rows a step wrote, on request", async () => {
    const h = harness();
    await h.svc.toggleAudit("DX-2", 41);
    expect(h.svc.audit(41)?.decidedBy).toBe("delegation:3:Ana");
    await h.svc.toggleAudit("DX-2", 41);
    expect(h.svc.audit(41)).toBeNull();
  });
});
