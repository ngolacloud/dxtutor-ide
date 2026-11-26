import { describe, expect, it, vi } from "vitest";
import { makePlatform, type PlatformPort } from "../src/features/ops/application/platform-service";
import type { ApprovalRequest } from "../src/features/ops/application/ports";
import { timelineText, type IncidentView, type PrReview, type Queue } from "../src/features/ops/domain/platform-types";
import { tauriPlatform } from "../src/features/ops/infrastructure/tauri";
import { renderPlatform } from "../src/features/ops/ui/platform-view";

/* r23 F5b (docs/v2/AUDIT-r23.md §4.5, Q01/Q02, UI-PLAT-09/11/12): a fila «My queue» (feito só quando a verificação do
 * backend passa; passar exige destinatário e motivo), a revisão de PR de infra (cada verificação com a sua fonte; aprovar
 * com uma a falhar pede motivo) e os incidentes locais (cronologia, confiança, estado, a causa principal). */

const QUEUE: Queue = {
  me: { name: "ana", email: "ana@x", gh: "ana" },
  items: [
    { id: "review:49", kind: "review", title: "Review PR #49: bigger db", why: "your review is requested — CODEOWNERS: *.tf @ana", action: "open-pr", arg: "49", line: 0, done: false, proof: null },
    { id: "iac:infra/main.tf", kind: "iac", title: "1 blocking IaC finding(s) in infra/main.tf", why: "you changed this file", action: "open-file", arg: "infra/main.tf", line: 7, done: false, proof: null },
    { id: "recurring:runbooks/restore.md", kind: "recurring", title: "Run «restore test»", why: "recurring task (monthly)", action: "run-runbook", arg: "runbooks/restore.md", line: 0, done: false, proof: null },
    { id: "incident:3", kind: "incident", title: "INC-1 checkout latency (SEV-2) is investigating", why: "you are its commander", action: "open-incident", arg: "3", line: 0, done: false, proof: null },
    { id: "deploy:staging", kind: "deploy", title: "The deploy to staging failed at rollout", why: "you ran it", action: "open-deploy", arg: "staging", line: 0, done: false, proof: null },
  ],
  done: [{ id: 1, item: "iac:old.tf", kind: "done", title: "old finding", proof: "no blocking finding left", recipient: null, reason: null, actor: "ana", at: 1 }],
  team: [{ id: 2, item: "review:40", kind: "handover", title: "Review PR #40", proof: null, recipient: "bruno", reason: "his module", actor: "ana", at: 2 }],
  measured: [["deploysYouRan", "3"], ["codevConfirmed", "1/2"]],
  missing: ["on-call and alerts: not connected (no pager source)"],
};
const REVIEW: PrReview = {
  number: 49, title: "bigger db", url: "https://github.com/o/r/pull/49", author: "bruno", head: "db", base: "main", headSha: "abc1234567", files: ["infra/db/main.tf"], diff: "+  instance_class = \"db.r6g.large\"",
  checks: [
    { id: "ci", status: "failed", summary: "failing: test", source: "gh statusCheckRollup" },
    { id: "plan", status: "ok", summary: "infra/db: +0 ~1 −0", source: "the IaC pipeline on the PR head" },
    { id: "capacity", status: "not_connected", summary: "capacity needs a metrics source", source: "not connected" },
  ],
  failing: ["ci"],
};
const INC: IncidentView = {
  incident: { id: 3, key: "INC-1", title: "checkout latency", severity: "SEV-2", status: "investigating", commander: "ana", openedAt: 0, mitigatedAt: null, resolvedAt: null },
  events: [{ id: 1, kind: "status", text: "investigating", reason: null, actor: "ana", at: 0 }, { id: 2, kind: "not-checked", text: "db metrics", reason: "no metrics source", actor: "ana", at: 60_000 }],
  confidence: { level: "low", reasons: ["no metrics source is connected: the causes are hypotheses"] },
  precision: [1, 2],
};

function fakes(opts: { approve?: boolean } = {}) {
  const calls: string[] = [];
  const confirms: ApprovalRequest[] = [];
  const texts: Array<string | null> = [];
  const toasts: string[] = [];
  const asked: Array<{ intent: string; text: string; context: Array<{ text: string; path?: string }> }> = [];
  const world: string[] = [];
  let verifyDone = true;
  let inc = INC;
  let metricsFail: string | null = null;
  const port: PlatformPort = {
    queue: async () => { calls.push("queue"); return QUEUE; },
    verify: async (_r, id, title) => { calls.push(`verify ${id} ${title}`); return verifyDone ? { done: true, proof: "ana reviewed: APPROVED" } : { done: false, proof: null }; },
    handover: async (_r, id, _t, who, why) => { calls.push(`handover ${id} ${who} ${why}`); return 1; },
    review: async (_r, pr) => { calls.push(`review ${pr}`); return REVIEW; },
    submit: async (_r, pr, decision, body, reason) => { calls.push(`submit ${pr} ${decision} «${body}» ${reason}`); return "ok"; },
    incidents: async () => [inc.incident],
    incident: async () => inc,
    open: async (_r, title, sev) => { calls.push(`open ${title} ${sev}`); return { ...INC.incident, title }; },
    add: async (_r, id, kind, text, reason) => { calls.push(`add ${id} ${kind} ${text} ${reason}`); },
    status: async (_r, id, status, note) => { calls.push(`status ${id} ${status} ${note}`); inc = { ...inc, incident: { ...inc.incident, status: status as never } }; return inc.incident; },
    feedback: async (_r, id, right) => { calls.push(`feedback ${id} ${right}`); },
    metricsCheck: async (_r, id) => { calls.push(`metrics ${id}`); if (metricsFail) throw new Error(metricsFail); return ["metrics · web: errors 0.01% in the hour before, 4.20% since 15 min before it opened"]; },
  };
  const p = makePlatform({
    port,
    world: { root: () => "/proj", openFile: (f, l) => world.push(`file ${f}:${l}`), runRunbook: (x) => world.push(`runbook ${x}`), openDeploy: (e) => world.push(`deploy ${e}`) },
    human: { approve: async (r) => { confirms.push(r); return { approved: opts.approve ?? true, reason: r.reasonRequired ? "the test job is flaky, tracked in #51" : "", decidedAt: 1 }; }, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m) },
    codev: { available: () => true, ask: (r) => asked.push(r as never) },
    say: (k, prm) => (prm ? `${k} ${JSON.stringify(prm)}` : k),
  });
  return { p, calls, confirms, texts, toasts, asked, world, notDone: () => { verifyDone = false; }, metricsFails: (m: string) => { metricsFail = m; } };
}

describe("a fila", () => {
  it("cada acção leva ao sítio certo; «Verificar» só marca feito quando o backend o prova; passar pede destinatário e motivo", async () => {
    const f = fakes();
    await f.p.refresh();
    expect(f.p.state().queue?.items).toHaveLength(5);
    f.p.act("iac:infra/main.tf");
    f.p.act("recurring:runbooks/restore.md");
    f.p.act("deploy:staging");
    expect(f.world).toEqual(["file infra/main.tf:7", "runbook runbooks/restore.md", "deploy staging"]);
    f.p.act("review:49");
    await vi.waitFor(() => expect(f.p.state().review?.number).toBe(49));
    expect(f.p.state().tab).toBe("review");
    f.p.act("incident:3");
    await vi.waitFor(() => expect(f.p.state().incident?.incident.key).toBe("INC-1"));
    await f.p.verify("review:49");
    expect(f.calls).toContain("verify review:49 Review PR #49: bigger db");
    expect(f.toasts.at(-1)).toContain("verified");
    f.notDone();
    await f.p.verify("iac:infra/main.tf");
    expect(f.toasts.at(-1)).toBe("notYet");
    f.texts.push("bruno", "x");
    await f.p.handover("iac:infra/main.tf");
    expect(f.toasts.at(-1)).toBe("handoverNeedsReason");
    f.texts.push("bruno", "his module");
    await f.p.handover("iac:infra/main.tf");
    expect(f.calls).toContain("handover iac:infra/main.tf bruno his module");
  });
});

describe("a revisão de PR", () => {
  it("aprovar com uma verificação a falhar pede motivo no diálogo (o comando gh exacto) e envia-o; pedir alterações pede o texto", async () => {
    const f = fakes();
    f.texts.push("#49");
    await f.p.askPr();
    expect(f.calls).toContain("review 49");
    await f.p.submit("approve");
    expect(f.confirms[0]).toMatchObject({ reasonRequired: true, scope: "https://github.com/o/r/pull/49" });
    expect(f.confirms[0].command).toContain("gh pr review 49 --approve");
    expect(f.confirms[0].command).toContain("failingNote");
    expect(f.calls).toContain("submit 49 approve «» the test job is flaky, tracked in #51");
    f.texts.push("split the instance change from the engine upgrade");
    await f.p.submit("request-changes");
    expect(f.confirms[1].reasonRequired).toBe(false);
    expect(f.calls).toContain("submit 49 request-changes «split the instance change from the engine upgrade» null");
    f.p.askCodevPr();
    expect(f.asked.at(-1)?.context[0].text).toContain("ci: failed");
    f.texts.push("abc");
    await f.p.askPr();
    expect(f.toasts.at(-1)).toBe("badPr");
  });

  it("recusado no diálogo: nada é publicado", async () => {
    const f = fakes({ approve: false });
    await f.p.openReview(49);
    await f.p.submit("approve");
    expect(f.calls.some((c) => c.startsWith("submit"))).toBe(false);
  });
});

describe("os incidentes", () => {
  it("abrir, juntar evidência e verificações (as não feitas com porquê), mitigar, julgar a causa; o Co-Dev escreve o rascunho do postmortem", async () => {
    const f = fakes();
    f.texts.push("checkout latency", "sev-2");
    await f.p.newIncident();
    expect(f.calls).toContain("open checkout latency SEV-2");
    f.texts.push("db metrics", "no metrics source");
    await f.p.addEvent("not-checked");
    expect(f.calls).toContain("add 3 not-checked db metrics no metrics source");
    f.texts.push("rolled back to rev 3");
    await f.p.setStatus("mitigated");
    expect(f.calls).toContain("status 3 mitigated rolled back to rev 3");
    await f.p.feedback(true);
    expect(f.calls).toContain("feedback 3 true");
    f.p.postmortem();
    expect(f.asked.at(-1)).toMatchObject({ intent: "change", context: [{ path: "docs/postmortems/INC-1.md" }] });
    expect(timelineText(INC)).toContain("not-checked: db metrics (no metrics source)");
  });
});

describe("NOTAS-r23 ponto 3: as métricas no incidente", () => {
  it("«Verificar as métricas» pede ao backend e relê o incidente; sem fonte, o erro diz porquê", async () => {
    const f = fakes();
    await f.p.openIncident(INC.incident.id);
    await f.p.metricsCheck();
    expect(f.calls).toContain(`metrics ${INC.incident.id}`);
    expect(f.p.state().error).toBeNull();
    f.metricsFails("no metrics source: not connected");
    await f.p.metricsCheck();
    expect(f.p.state().error).toBe("no metrics source: not connected");
  });
});

describe("a vista", () => {
  it("a fila com porquê, acção, verificar e passar; feito, equipa, medido e o que não foi lido; a revisão com as fontes; o incidente com a confiança", async () => {
    const f = fakes();
    const t = (k: string, prm?: Record<string, string | number>) => (prm ? `${k}:${Object.values(prm).join(",")}` : k);
    const host = document.createElement("div");
    const draw = (): void => { host.innerHTML = renderPlatform(t as never, f.p.state(), true, true); };
    await f.p.refresh();
    draw();
    expect(host.querySelectorAll(".pf-item")).toHaveLength(5);
    expect(host.querySelector('[data-action="pf:verify"][data-on="review:49"]')).not.toBeNull();
    expect(host.querySelector('[data-action="pf:handover"][data-on="deploy:staging"]')).not.toBeNull();
    expect(host.textContent).toContain("his module");
    expect(host.textContent).toContain("m_codevConfirmed");
    expect(host.textContent).toContain("no pager source");
    await f.p.openReview(49);
    draw();
    expect(host.querySelector(".pf-check.c-failed")?.textContent).toContain("gh statusCheckRollup");
    expect(host.querySelector(".pf-check.c-not_connected")?.textContent).toContain("stNotConnected");
    expect(host.textContent).toContain("failingCount:1");
    f.p.setTab("incidents");
    await f.p.openIncident(3);
    draw();
    expect(host.querySelector(".pf-conf.c-low")?.textContent).toContain("no metrics source");
    expect(host.querySelector('[data-action="pf:feedback"]')).toBeNull();
    expect(renderPlatform(t as never, f.p.state(), true, false)).toContain("needDesktop");
  });
});

describe("o adaptador Tauri", () => {
  it("os comandos e os argumentos", async () => {
    const seen: Array<[string, unknown]> = [];
    const port = tauriPlatform(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; });
    await port.verify("/p", "review:49", "t");
    await port.submit("/p", 49, "approve", "", "why");
    await port.add("/p", 3, "not-checked", "db", "no source");
    await port.metricsCheck("/p", 3);
    expect(seen).toEqual([
      ["queue_verify", { root: "/p", id: "review:49", title: "t" }],
      ["pr_review_submit", { root: "/p", pr: 49, decision: "approve", body: "", reason: "why" }],
      ["incident_add", { root: "/p", id: 3, kind: "not-checked", text: "db", reason: "no source" }],
      ["incident_metrics_check", { root: "/p", id: 3 }],
    ]);
  });
});
