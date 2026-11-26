/* ═══════════ feature `ops` — application: the Platform activity (r23 F5b, docs/v2/AUDIT-r23.md §4.5) ═══════════
   - My queue: items computed by the backend from real state; «Verify» asks the backend (done only when the state says
     so, recorded with the proof); «Hand over» needs a recipient and a reason (Team view); the counts measured here.
   - PR infra review: the PR's diff and «Before you merge», each check with its source or «not connected»; the review
     is posted with `gh` after the shared approval with the exact command — approving with a failing check needs a
     reason (the backend refuses it otherwise); Co-Dev can comment the diff (a proposal only).
   - Incidents (local records): open one, add evidence and checks (run, or not run with why), mitigate, resolve with a
     summary, judge the top cause; the confidence comes from the backend; Co-Dev drafts the postmortem in the editor.
   No DOM, no window. */
import { timelineText, type Incident, type IncidentView, type PrReview, type Queue } from "../domain/platform-types";
import type { ApprovalRequest, ApprovalDecision, CodevPort } from "./ports";

export interface PlatformPort {
  queue(root: string): Promise<Queue>;
  verify(root: string, id: string, title: string): Promise<{ done: boolean; proof: string | null }>;
  handover(root: string, id: string, title: string, recipient: string, reason: string): Promise<number>;
  review(root: string, pr: number): Promise<PrReview>;
  submit(root: string, pr: number, decision: string, body: string, reason: string | null): Promise<string>;
  incidents(root: string): Promise<Incident[]>;
  incident(root: string, id: number): Promise<IncidentView>;
  open(root: string, title: string, severity: string): Promise<Incident>;
  add(root: string, id: number, kind: string, text: string, reason: string | null): Promise<void>;
  status(root: string, id: number, status: string, note: string): Promise<Incident>;
  feedback(root: string, id: number, right: boolean): Promise<void>;
}

export interface PlatformWorld {
  root(): string | null;
  openFile(rel: string, line: number): void;
  runRunbook(path: string): void;
  openDeploy(env: string): void;
}

export type Say = (key: string, params?: Record<string, string | number>) => string;
export type PfTab = "home" | "review" | "incidents";

export interface PlatformState {
  tab: PfTab;
  queue: Queue | null;
  busy: string | null;
  review: PrReview | null;
  prNumber: number | null;
  /** the PR review is being read (it plans the PR head: it can take a while) */
  reviewing: boolean;
  incidents: Incident[] | null;
  incident: IncidentView | null;
  error: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

export function makePlatform(deps: {
  port: PlatformPort; world: PlatformWorld; codev: CodevPort; say: Say;
  human: { approve(r: ApprovalRequest): Promise<ApprovalDecision>; text(placeholder: string, initial?: string): Promise<string | null>; toast(m: string): void };
}) {
  const { port, world, codev, say, human } = deps;
  const st: PlatformState = { tab: "home", queue: null, busy: null, review: null, prNumber: null, reviewing: false, incidents: null, incident: null, error: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };
  /** An action that changes something: one at a time. */
  async function busy<T>(what: string, f: () => Promise<T>): Promise<T | null> {
    if (st.busy) return null;
    st.busy = what; st.error = null; emit();
    try { return await f(); } catch (e) { st.error = msg(e); return null; } finally { st.busy = null; emit(); }
  }
  /** A read: never blocked by another read (opening an incident while the list loads). */
  async function read<T>(f: () => Promise<T>): Promise<T | null> {
    try { return await f(); } catch (e) { st.error = msg(e); emit(); return null; }
  }
  const root = (): string | null => world.root();

  async function loadQueue(): Promise<void> {
    const r = root();
    if (!r) return;
    const q = await read(() => port.queue(r));
    if (q) { st.queue = q; emit(); }
  }
  async function verify(id: string): Promise<void> {
    const r = root(), it = st.queue?.items.find((i) => i.id === id);
    if (!r || !it) return;
    const v = await busy("verify", () => port.verify(r, id, it.title));
    if (!v) return;
    human.toast(v.done ? say("verified", { p: v.proof ?? "" }) : say("notYet"));
    if (v.done) await loadQueue();
  }
  async function handover(id: string): Promise<void> {
    const r = root(), it = st.queue?.items.find((i) => i.id === id);
    if (!r || !it) return;
    const who = await human.text(say("handoverWho"));
    if (!who || !who.trim()) return;
    const why = await human.text(say("handoverWhy", { who: who.trim() }));
    if (!why || why.trim().length < 3) { human.toast(say("handoverNeedsReason")); return; }
    if ((await busy("handover", () => port.handover(r, id, it.title, who.trim(), why.trim()))) !== null) await loadQueue();
  }
  function act(id: string): void {
    const it = st.queue?.items.find((i) => i.id === id);
    if (!it) return;
    switch (it.action) {
      case "open-pr": void openReview(Number(it.arg)); return;
      case "open-file": world.openFile(it.arg, it.line || 1); return;
      case "run-runbook": world.runRunbook(it.arg); return;
      case "open-incident": st.tab = "incidents"; emit(); void openIncident(Number(it.arg)); return;
      case "open-deploy": world.openDeploy(it.arg); return;
    }
  }

  async function openReview(pr: number): Promise<void> {
    const r = root();
    if (!r || !Number.isInteger(pr) || pr <= 0) return;
    st.tab = "review"; st.prNumber = pr; st.review = null; st.reviewing = true; emit();
    const rv = await read(() => port.review(r, pr));
    st.reviewing = false;
    if (rv && st.prNumber === pr) st.review = rv;
    emit();
  }
  async function askPr(): Promise<void> {
    const v = await human.text(say("prPh"));
    if (v === null) return;
    const n = Number(v.trim().replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) { human.toast(say("badPr")); return; }
    await openReview(n);
  }
  /** Posts the review: the shared dialog shows the exact `gh pr review`; approving with a failing check asks a reason
   *  (the backend refuses without one). */
  async function submit(decision: "approve" | "request-changes" | "comment"): Promise<void> {
    const r = root(), rv = st.review;
    if (!r || !rv) return;
    let body = "";
    if (decision !== "approve") {
      const b = await human.text(say(decision === "comment" ? "commentPh" : "changesPh"));
      if (b === null || !b.trim()) return;
      body = b.trim();
    }
    const failing = decision === "approve" && rv.failing.length > 0;
    const d = await human.approve({
      title: say(decision === "approve" ? "approveWhat" : decision === "comment" ? "commentWhat" : "changesWhat", { n: rv.number }),
      command: `gh pr review ${rv.number} --${decision} --body ${JSON.stringify(body)}${failing ? `\n# ${say("failingNote", { l: rv.failing.join(", ") })}` : ""}`,
      scope: rv.url, reasonRequired: failing,
    });
    if (!d.approved) return;
    const out = await busy("submit", () => port.submit(r, rv.number, decision, body, failing ? d.reason : null));
    if (out !== null) { human.toast(say("posted", { n: rv.number })); await loadQueue(); }
  }
  function askCodevPr(): void {
    const rv = st.review;
    if (!rv || !codev.available()) return;
    codev.ask({ intent: "explain", text: say("askPr"), context: [{ kind: "problem", label: `PR #${rv.number} · ${rv.title}`, text: `${rv.checks.map((c) => `${c.id}: ${c.status} — ${c.summary}`).join("\n")}\n\n${rv.diff.slice(0, 30_000)}` }], send: true });
  }

  async function loadIncidents(): Promise<void> {
    const r = root();
    if (!r) return;
    const l = await read(() => port.incidents(r));
    if (l) { st.incidents = l; emit(); }
  }
  async function openIncident(id: number): Promise<void> {
    const r = root();
    if (!r) return;
    const v = await read(() => port.incident(r, id));
    if (v) { st.incident = v; emit(); }
    if (!st.incidents) void loadIncidents();
  }
  async function newIncident(): Promise<void> {
    const r = root();
    if (!r) return;
    const title = await human.text(say("incTitlePh"));
    if (!title || title.trim().length < 3) return;
    const sev = (await human.text(say("incSevPh"), "SEV-3"))?.trim().toUpperCase();
    if (!sev) return;
    const i = await busy("open", () => port.open(r, title.trim(), sev));
    if (i) { await loadIncidents(); await openIncident(i.id); }
  }
  async function addEvent(kind: "evidence" | "checked" | "not-checked" | "note"): Promise<void> {
    const r = root(), v = st.incident;
    if (!r || !v) return;
    const text = await human.text(say(`incAdd_${kind.replace("-", "_")}`));
    if (!text || !text.trim()) return;
    let reason: string | null = null;
    if (kind === "not-checked") { reason = await human.text(say("incWhyNot")); if (!reason || reason.trim().length < 3) return; }
    if ((await busy("add", () => port.add(r, v.incident.id, kind, text.trim(), reason).then(() => true))) !== null) await openIncident(v.incident.id);
  }
  async function setStatus(status: "mitigated" | "resolved" | "investigating"): Promise<void> {
    const r = root(), v = st.incident;
    if (!r || !v) return;
    const note = await human.text(say(status === "resolved" ? "incResolvePh" : "incStatusPh", { s: status }));
    if (note === null) return;
    if ((await busy("status", () => port.status(r, v.incident.id, status, note.trim()))) !== null) { await openIncident(v.incident.id); await loadIncidents(); }
  }
  async function feedback(right: boolean): Promise<void> {
    const r = root(), v = st.incident;
    if (!r || !v) return;
    if ((await busy("feedback", () => port.feedback(r, v.incident.id, right).then(() => true))) !== null) await openIncident(v.incident.id);
  }
  /** Co-Dev drafts the postmortem as a proposal in the editor (docs/postmortems/INC-n.md). */
  function postmortem(): void {
    const v = st.incident;
    if (!v || !codev.available()) { human.toast(say("noCodev")); return; }
    codev.ask({ intent: "change", text: say("askPostmortem", { p: `docs/postmortems/${v.incident.key}.md` }), context: [{ kind: "problem", label: `${v.incident.key} timeline`, text: timelineText(v), path: `docs/postmortems/${v.incident.key}.md` }] });
  }
  function askCause(): void {
    const v = st.incident;
    if (!v || !codev.available()) { human.toast(say("noCodev")); return; }
    codev.ask({ intent: "explain", text: say("askCause"), context: [{ kind: "problem", label: `${v.incident.key} ${v.incident.title}`, text: timelineText(v) }], send: true });
  }

  return {
    state: (): PlatformState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    setTab: (t: PfTab) => { st.tab = t; emit(); if (t === "home" && !st.queue) void loadQueue(); if (t === "incidents" && !st.incidents) void loadIncidents(); },
    refresh: async (): Promise<void> => { await loadQueue(); },
    loadQueue, verify, handover, act, openReview, askPr, submit, askCodevPr,
    loadIncidents, openIncident, newIncident, addEvent, setStatus, feedback, postmortem, askCause,
    workspaceChanged: (): void => { Object.assign(st, { queue: null, review: null, prNumber: null, incidents: null, incident: null, error: null }); emit(); },
  };
}

export type Platform = ReturnType<typeof makePlatform>;
