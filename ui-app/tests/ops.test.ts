import { describe, expect, it, vi } from "vitest";
import { driftDue, driftKey, eventsFor, findingLabel, forceUnlock, importDraft, isAddress, kubeCmd, movedDraft, planText, podTrouble, q, securityFindings, servicePort, DRIFT_EVERY_MS } from "../src/features/ops/domain/commands";
import { makeOps } from "../src/features/ops/application/ops-service";
import type { ApprovalRequest, OpsPort } from "../src/features/ops/application/ports";
import type { AcceptedRisk, IacFinding, IacPlan, IacState, KubeTarget, PipelineRun, Stage } from "../src/features/ops/domain/types";
import { renderOps } from "../src/features/ops/ui/ops-view";

/* A9 (docs/v2/UI-AUDIT.md item 10): DevOps em só leitura — o plano de IaC como diff, o namespace do
 * Kubernetes do pane Infra, as CLIs de cloud — e toda a mudança como um comando mostrado por inteiro,
 * aprovado e corrido num terminal. */

const T: KubeTarget = { kubeconfig: "/home/u/.kube/my config", context: "kind-dev", namespace: "shop" };

describe("domínio: os comandos exactos", () => {
  it("aspas de shell e o kubeconfig/contexto/namespace sempre explícitos", () => {
    expect(q("web-1")).toBe("web-1");
    expect(q("it's")).toBe(`'it'\\''s'`);
    expect(kubeCmd.undo(T, "web", 2)).toBe("kubectl --kubeconfig '/home/u/.kube/my config' --context kind-dev -n shop rollout undo deploy/web --to-revision=2");
    expect(kubeCmd.logs({ ...T, kubeconfig: "" }, "deploy", "web")).toBe("kubectl --context kind-dev -n shop logs -f deploy/web --tail=200");
    expect(kubeCmd.portForward({ ...T, kubeconfig: "" }, "web", 8080, "80")).toBe("kubectl --context kind-dev -n shop port-forward svc/web 8080:80");
    expect(kubeCmd.exec({ ...T, kubeconfig: "" }, "db-0")).toBe("kubectl --context kind-dev -n shop exec -it db-0 -- sh");
    expect(forceUnlock("tofu", "infra/prod", "a1b2-c3")).toBe("cd infra/prod && tofu force-unlock -force a1b2-c3");
    expect(forceUnlock("terraform", ".", "x y")).toBe("terraform force-unlock -force 'x y'");
    expect(servicePort(["80→8080/TCP"])).toBe("80");
  });

  it("um pod com problemas, os eventos de um objecto e o plano em texto", () => {
    expect(podTrouble({ name: "a", phase: "Running", ready: "1/1", restarts: 0, node: "", created: "", reason: null })).toBe(false);
    expect(podTrouble({ name: "b", phase: "Running", ready: "0/1", restarts: 6, node: "", created: "", reason: "CrashLoopBackOff" })).toBe(true);
    expect(eventsFor([{ kind: "Warning", reason: "BackOff", object: "pod/b", message: "x", count: 2, last: "" }, { kind: "Normal", reason: "Pulled", object: "pod/a", message: "y", count: 1, last: "" }], "pod/b")).toHaveLength(1);
    const txt = planText({ ok: true, tool: "tofu", dir: "infra", refreshOnly: false, add: 1, change: 1, destroy: 0, notes: "", drift: [], changes: [{ address: "aws_s3_bucket.logs", action: "update", reason: "x", dependents: ["aws_cloudfront.cdn"], writeOnly: ["password_wo"], attrs: [{ name: "versioning", before: "false", after: "true", unknown: false, sensitive: false }] }] });
    expect(txt).toContain("+1 ~1 -0");
    expect(txt).toContain("versioning: false → true");
    expect(txt).toContain("blast radius: aws_cloudfront.cdn");
    expect(txt).toContain("write-only: password_wo");
  });

  it("r23 F4b: rascunhos import/moved, endereços, achados de segurança e quando o drift volta a ser verificado", () => {
    expect(importDraft("aws_s3_bucket.logs", "my-logs")).toBe('import {\n  to = aws_s3_bucket.logs\n  id = "my-logs"\n}\n');
    expect(movedDraft("aws_s3_bucket.a", "module.s3.aws_s3_bucket.a")).toBe("moved {\n  from = aws_s3_bucket.a\n  to   = module.s3.aws_s3_bucket.a\n}\n");
    for (const ok of ["aws_s3_bucket.logs", "module.a.aws_x.y[0]", 'module.a["k"].data.aws_x.y', "terraform_data.c"]) expect(isAddress(ok), ok).toBe(true);
    for (const bad of ["logs", "-destroy", "a.b; rm -rf /", ""]) expect(isAddress(bad), bad).toBe(false);
    expect(driftKey("infra", "aws_s3_bucket.logs")).toBe("drift:infra:aws_s3_bucket.logs");
    expect(driftDue(null, 5)).toBe(true);
    expect(driftDue(1000, 1000 + DRIFT_EVERY_MS - 1)).toBe(false);
    expect(driftDue(1000, 1000 + DRIFT_EVERY_MS)).toBe(true);
    expect(securityFindings(RUN_BLOCKED).map((f) => `${f.source}:${f.accepted}`)).toEqual(["built-in:false", "checkov:true", "tflint:false"]);
    expect(findingLabel(SECRET)).toBe("built-in secret-argument · infra/main.tf:7");
  });
});

const SECRET: IacFinding = { source: "built-in", rule: "secret-argument", file: "infra/main.tf", line: 7, severity: "error", message: "`password` takes a secret from `var.db`", resource: null, key: "built-in:secret-argument:infra/main.tf:abc", accepted: false };
const stage = (id: string, status: Stage["status"], findings: IacFinding[] = [], extra: Partial<Stage> = {}): Stage => ({ id, status, summary: status, detail: "", hint: null, command: `${id} cmd`, findings, ms: 10, ...extra });
const RUN_BLOCKED: PipelineRun = {
  id: "a".repeat(64), tool: "tofu", dir: "infra", target: null, blocked: true, blockers: ["rules"], notes: "",
  plan: null,
  stages: [
    stage("init", "ok"), stage("fmt", "ok", [{ ...SECRET, source: "fmt", rule: "fmt", key: "fmt:1" }]),
    stage("rules", "failed", [SECRET]),
    stage("tflint", "ok", [{ ...SECRET, source: "tflint", rule: "terraform_unused_declarations", severity: "warning", key: "tflint:1" }]),
    stage("checkov", "ok", [{ ...SECRET, source: "checkov", rule: "CKV_AWS_18", resource: "aws_s3_bucket.logs", key: "checkov:1", accepted: true }]),
    stage("trivy", "not_installed", [], { hint: "Install Trivy" }),
  ],
};

const PLAN: IacPlan = { ok: true, tool: "tofu", dir: "infra", refreshOnly: false, add: 1, change: 0, destroy: 0, notes: "", drift: [], changes: [{ address: "terraform_data.web", action: "create", dependents: ["terraform_data.b"], writeOnly: [], monthlyCost: null, attrs: [{ name: "input", before: null, after: '{"image":"nginx"}', unknown: false, sensitive: false }, { name: "id", before: null, after: null, unknown: true, sensitive: false }] }] };
const DRIFT = { address: "aws_s3_bucket.logs", action: "update" as const, attrs: [{ name: "acl", before: '"private"', after: '"public-read"', unknown: false, sensitive: false }] };
const RUN_OK = (dir: string, target: string | null, plan: IacPlan = PLAN): PipelineRun => ({
  id: "b".repeat(64), tool: "tofu", dir, target, blocked: false, blockers: [], notes: "", plan: { ...plan, dir },
  stages: [stage("init", "ok"), stage("rules", "ok"), stage("tflint", "not_installed", [], { hint: "Install TFLint: curl …" }), stage("plan", "ok"), stage("drift", "ok"), stage("infracost", "not_installed", [], { hint: "Install infracost" })],
});
const STATE: IacState = { ok: true, tool: "tofu", dir: "infra", backend: "local", serial: 4, lineage: "lin-1", lockReadable: true, backupSerial: 3, notes: "", lock: { id: "lock-9", who: "ana@laptop", operation: "OperationTypeApply", created: "2026-11-26T10:00:00Z" }, resources: [{ address: "terraform_data.web", kind: "terraform_data", mode: "managed", module: null, id: "id-1", sensitive: ["input"] }] };

function fakes(target: KubeTarget | null = T) {
  const ran: string[] = [];
  const confirms: ApprovalRequest[] = [];
  let answer = true;
  const texts: Array<string | null> = [];
  const asked: Array<{ intent: string; context: Array<{ text: string }> }> = [];
  const toasts: string[] = [];
  const audited: Array<{ action: string; command: string; scope: string; approved: boolean; outcome?: string }> = [];
  let auditFails = false;
  let exit: number | null = null;
  const opened: string[] = [];
  const ticks: Array<() => void> = [];
  const pipelines: Array<{ dir: string; target: string | null }> = [];
  let nextRun: (dir: string, target: string | null) => PipelineRun = RUN_OK;
  let applyRefusal: string | null = null;
  let stageListener: ((e: { root: string; dir: string; stage: Stage }) => void) | null = null;
  let risks: AcceptedRisk[] = [];
  const accepted: Array<{ key: string; kind: string; label: string; reason: string }> = [];
  const port: OpsPort = {
    iacDirs: async () => [".", "infra"],
    iacPlan: async (_r, dir, refreshOnly) => ({ ...PLAN, dir, refreshOnly }),
    kubeState: async (t) => ({ ok: true, context: t.context, namespace: t.namespace, notes: "", pods: [{ name: "web-1", phase: "Running", ready: "0/1", restarts: 6, node: "n1", created: "", reason: "CrashLoopBackOff" }], services: [{ name: "web", kind: "ClusterIP", clusterIp: "10.0.0.5", ports: ["80→8080/TCP"] }], deployments: [{ name: "web", ready: "0/1", images: ["web:1.1"], revision: "2" }], events: [{ kind: "Warning", reason: "BackOff", object: "pod/web-1", message: "Back-off restarting failed container", count: 9, last: "" }] }),
    kubeHistory: vi.fn(async () => [{ revision: 2, replicaSet: "web-b", images: ["web:1.1"], created: "", replicas: 1 }, { revision: 1, replicaSet: "web-a", images: ["web:1.0"], created: "", replicas: 0 }]),
    cloudStatus: async () => [{ provider: "aws", installed: false, version: "", account: null, notes: "Install the AWS CLI v2" }, { provider: "gcloud", installed: true, version: "500.0.0", account: "shop-prod (ana@x)", notes: "" }, { provider: "az", installed: false, version: "", account: null, notes: "Install the Azure CLI" }],
    cloudInventory: async (p) => ({ ok: true, provider: p, commands: ["gcloud run services list --format=json"], notes: "", resources: [{ provider: p, kind: "run", name: "api", region: "europe-west1", status: "ready" }] }),
    pipeline: async (root, dir, target) => {
      pipelines.push({ dir, target });
      stageListener?.({ root, dir, stage: stage("init", "running") });
      stageListener?.({ root: "/other", dir, stage: stage("fmt", "running") });
      return nextRun(dir, target);
    },
    onStage: (f) => { stageListener = f; },
    applyCommand: async (_r, dir, id) => {
      if (applyRefusal) throw new Error(applyRefusal);
      return { command: `cd ${dir} && tofu apply -input=false '/data/iac-plans/${id}.bin'`, planFile: `/data/iac-plans/${id}.bin`, tool: "tofu", dir, destroy: 0 };
    },
    iacState: async (_r, dir) => ({ ...STATE, dir }),
    risks: async () => risks,
    acceptRisk: async (_r, a) => { accepted.push(a); const r = { id: risks.length + 1, key: a.key, kind: a.kind, label: a.label, reason: a.reason, actor: "ana", at: 1, expires: 30 * 864e5 }; risks = [r, ...risks]; return r; },
    revokeRisk: async (_r, id) => { risks = risks.filter((r) => r.id !== id); return true; },
  };
  const o = makeOps({
    ops: port,
    world: {
      root: () => "/proj", kubeTarget: () => target,
      runInTerminal: (c) => { ran.push(c); return exit === null ? undefined : Promise.resolve(exit); },
      openFile: (f, l) => opened.push(`${f}:${l}`), now: () => 7_000, every: (_ms, f) => { ticks.push(f); return () => { ticks.length = 0; }; },
    },
    human: { approve: async (r) => { confirms.push(r); return { approved: answer, reason: answer && r.reasonRequired ? "fixture bucket, not public" : "", decidedAt: 1 }; }, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m) },
    audit: { record: async (e) => { if (auditFails) throw new Error("db locked"); audited.push(e); } },
    codev: { available: () => true, ask: (r) => asked.push(r) },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return {
    o, ran, confirms, texts, asked, toasts, port, audited, opened, ticks, pipelines, accepted,
    refuse: () => { answer = false; }, breakAudit: () => { auditFails = true; }, exitWith: (c: number) => { exit = c; },
    runs: (f: (dir: string, target: string | null) => PipelineRun) => { nextRun = f; }, refuseApply: (m: string) => { applyRefusal = m; },
  };
}

describe("o serviço", () => {
  it("r23 F4b: corre o pipeline na pasta escolhida e aplica o plano REVISTO com o comando do backend, aprovado e auditado com o resultado", async () => {
    const f = fakes();
    await f.o.refresh();
    expect(f.o.state().iac.dirs).toEqual([".", "infra"]);
    f.o.selectDir("infra");
    await f.o.runPipeline();
    expect(f.pipelines).toEqual([{ dir: "infra", target: null }]);
    const r = f.o.state().iac.run!;
    expect(r.plan?.changes[0].address).toBe("terraform_data.web");
    f.exitWith(0);
    await f.o.applyRun();
    expect(f.confirms[0]).toMatchObject({ command: `cd infra && tofu apply -input=false '/data/iac-plans/${"b".repeat(64)}.bin'`, scope: 'scopeIac {"dir":"infra","tool":"tofu"}', destructive: false });
    expect(f.ran).toEqual([f.confirms[0].command]);
    await vi.waitFor(() => expect(f.audited.map((a) => `${a.action}:${a.approved}:${a.outcome}`)).toEqual(["iac.apply:true:sent", "iac.apply:true:ok"]));
    expect(f.o.state().iac.applied).toEqual({ id: "b".repeat(64), code: 0 });
    f.o.askPlan("explain");
    expect(f.asked[0].context[0].text).toContain("create terraform_data.web");
    expect(f.asked[0].context[0].text).toContain("blast radius: terraform_data.b");
  });

  it("r23 F4b: um plano bloqueado não se aplica, e a recusa do backend chega ao humano sem nada correr", async () => {
    const f = fakes();
    await f.o.refresh();
    f.runs(() => RUN_BLOCKED);
    await f.o.runPipeline();
    await f.o.applyRun();
    expect(f.confirms).toEqual([]);
    f.runs((d, t) => RUN_OK(d, t));
    await f.o.runPipeline();
    f.refuseApply("the configuration changed after this plan: run the pipeline again");
    await f.o.applyRun();
    expect(f.toasts.at(-1)).toContain("applyRefused");
    expect(f.toasts.at(-1)).toContain("configuration changed");
    expect(f.confirms).toEqual([]);
    expect(f.ran).toEqual([]);
  });

  it("r23 F4b: os eventos de etapa de OUTRA pasta não entram; o drift agenda-se de 6 em 6 horas e avisa", async () => {
    const f = fakes();
    await f.o.refresh();
    expect(f.ticks).toHaveLength(1);
    const p = f.o.runPipeline();
    expect(f.o.state().iac.live?.map((s) => s.id)).toEqual(["init"]);
    await p;
    expect(f.o.state().iac.live).toBeNull();
    (f.port as { iacPlan: OpsPort["iacPlan"] }).iacPlan = async (_r, dir, refreshOnly) => ({ ...PLAN, dir, refreshOnly, changes: [], drift: [DRIFT] });
    f.ticks[0]();
    await vi.waitFor(() => expect(f.toasts.at(-1)).toContain("driftFound"));
    expect(f.o.state().iac.drift.at).toBe(7_000);
    expect(f.o.drifted()[0].address).toBe("aws_s3_bucket.logs");
    f.o.workspaceChanged();
    expect(f.ticks).toHaveLength(0);
    expect(f.o.state().iac.dirs).toBeNull();
  });

  it("r23 F4b: aceitar um risco pede um motivo, guarda-o no backend e marca o achado; revogar volta a bloquear", async () => {
    const f = fakes();
    await f.o.refresh();
    f.runs(() => RUN_BLOCKED);
    await f.o.runPipeline();
    await f.o.acceptFinding(SECRET.key);
    expect(f.confirms[0]).toMatchObject({ title: `acceptWhat {"what":"${findingLabel(SECRET)}"}`, reasonRequired: true });
    expect(f.accepted[0]).toEqual({ key: SECRET.key, kind: "finding", label: findingLabel(SECRET), reason: "fixture bucket, not public" });
    expect(f.o.state().iac.staleRisks).toBe(true);
    expect(f.o.security().find((x) => x.key === SECRET.key)?.accepted).toBe(true);
    expect(f.o.state().iac.risks[0].key).toBe(SECRET.key);
    await f.o.revokeRisk(f.o.state().iac.risks[0].id);
    expect(f.o.security().find((x) => x.key === SECRET.key)?.accepted).toBe(false);
    f.o.openFinding(SECRET.key);
    expect(f.opened).toEqual(["infra/main.tf:7"]);
    f.o.fixFinding(SECRET.key);
    expect(f.asked.at(-1)).toMatchObject({ intent: "change", context: [{ kind: "problem", path: "infra/main.tf" }] });
    f.refuse();
    await f.o.acceptFinding("checkov:1");
    expect(f.accepted).toHaveLength(1); // cancelled: nothing kept
  });

  it("r23 F4b: o drift — reverter é um pipeline dirigido, escrever no código vai ao Co-Dev, ignorar pede um motivo", async () => {
    const f = fakes();
    await f.o.refresh();
    f.o.selectDir("infra");
    (f.port as { iacPlan: OpsPort["iacPlan"] }).iacPlan = async (_r, dir, refreshOnly) => ({ ...PLAN, dir, refreshOnly, changes: [], drift: [DRIFT] });
    await f.o.checkDrift();
    f.o.driftRevert("aws_s3_bucket.logs");
    await vi.waitFor(() => expect(f.pipelines).toEqual([{ dir: "infra", target: "aws_s3_bucket.logs" }]));
    f.o.driftToCode("aws_s3_bucket.logs");
    expect(f.asked.at(-1)?.context[0].text).toContain('acl: "private" → "public-read"');
    await f.o.driftIgnore("aws_s3_bucket.logs");
    expect(f.accepted.at(-1)).toMatchObject({ key: "drift:infra:aws_s3_bucket.logs", kind: "drift" });
  });

  it("r23 F4b: o estado — força o desbloqueio com aprovação e o nome da pasta; mover e importar vão ao Co-Dev como blocos", async () => {
    const f = fakes();
    await f.o.refresh();
    f.o.selectDir("infra");
    f.o.setTab("state");
    await vi.waitFor(() => expect(f.o.state().iac.state.data?.serial).toBe(4));
    f.o.unlock();
    await vi.waitFor(() => expect(f.ran).toEqual(["cd infra && tofu force-unlock -force lock-9"]));
    expect(f.confirms[0]).toMatchObject({ destructive: true, confirmText: "infra" });
    f.texts.push("module.app.terraform_data.web");
    await f.o.moveResource("terraform_data.web");
    expect(f.asked.at(-1)?.context[0].text).toBe(movedDraft("terraform_data.web", "module.app.terraform_data.web"));
    f.texts.push("not an address");
    await f.o.moveResource("terraform_data.web");
    expect(f.toasts.at(-1)).toBe("badAddress");
    f.texts.push("aws_s3_bucket.logs", "my-logs");
    await f.o.importResource();
    expect(f.asked.at(-1)?.context[0].text).toBe(importDraft("aws_s3_bucket.logs", "my-logs"));
  });

  it("o Kubernetes: lê o namespace do pane Infra; ler logs corre logo; mudar pede aprovação", async () => {
    const f = fakes();
    await f.o.refresh();
    expect(f.o.state().kube.state?.pods[0].reason).toBe("CrashLoopBackOff");
    f.o.kubeAction("logs-pod", "web-1");
    expect(f.ran[0]).toContain("logs -f web-1");
    expect(f.confirms).toEqual([]);
    await f.o.history("web");
    expect(f.o.state().kube.history?.revisions.map((r) => r.revision)).toEqual([2, 1]);
    f.o.kubeAction("undo", "web", "1");
    await vi.waitFor(() => expect(f.ran).toHaveLength(2));
    expect(f.confirms[0].scope).toBe('scopeKube {"c":"kind-dev","n":"shop"}');
    expect(f.ran.at(-1)).toBe("kubectl --kubeconfig '/home/u/.kube/my config' --context kind-dev -n shop rollout undo deploy/web --to-revision=1");
    f.texts.push("3");
    await f.o.scale("web");
    expect(f.ran.at(-1)).toContain("scale deploy/web --replicas=3");
    f.texts.push("-1");
    await f.o.scale("web");
    expect(f.toasts.at(-1)).toBe("badReplicas");
    f.texts.push("18080");
    await f.o.portForward("web");
    expect(f.ran.at(-1)).toContain("port-forward svc/web 18080:80");
    f.o.askPod("web-1");
    expect(f.asked[0].context[0].text).toContain("Back-off restarting");
    f.o.kubeAction("delete-pod", "web-1");
    await vi.waitFor(() => expect(f.ran.at(-1)).toContain("delete pod web-1"));
    expect(f.confirms.at(-1)).toMatchObject({ destructive: true, confirmText: "web-1" });
    expect(f.audited.map((a) => `${a.action}:${a.approved}`)).toEqual(["kube.undo:true", "kube.scale:true", "kube.port-forward:true", "kube.delete-pod:true"]);
    expect(f.audited[0].scope).toBe('scopeKube {"c":"kind-dev","n":"shop"}');
  });

  it("uma aprovação que o registo de auditoria não guarda não corre", async () => {
    const f = fakes();
    await f.o.refresh();
    f.breakAudit();
    f.o.kubeAction("restart", "web");
    await vi.waitFor(() => expect(f.toasts.at(-1)).toContain("notAudited"));
    expect(f.ran).toEqual([]);
  });

  it("um apply que destrói pede o nome da pasta escrito; recusado, nada corre (e a recusa vai para o registo)", async () => {
    const f = fakes();
    f.o.selectDir("infra");
    (f.port as { applyCommand: OpsPort["applyCommand"] }).applyCommand = async (_r, dir, id) => ({ command: `cd ${dir} && tofu apply -input=false /p/${id}.bin`, planFile: "", tool: "tofu", dir, destroy: 1 });
    await f.o.runPipeline();
    f.refuse();
    await f.o.applyRun();
    expect(f.confirms[0]).toMatchObject({ destructive: true, confirmText: "infra" });
    expect(f.ran).toEqual([]);
    await vi.waitFor(() => expect(f.audited.map((a) => `${a.action}:${a.approved}`)).toEqual(["iac.apply:false"]));
  });

  it("sem cluster ligado no pane Infra, não lê nada", async () => {
    const f = fakes(null);
    await f.o.refresh();
    expect(f.o.state().kube.target).toBeNull();
    expect(f.o.state().kube.state).toBeNull();
  });

  it("a cloud: o estado das CLIs e o inventário só de leitura", async () => {
    const f = fakes();
    await f.o.refresh();
    await f.o.inventory("gcloud");
    expect(f.o.state().cloud.inventory.gcloud.resources[0].name).toBe("api");
  });
});

describe("a vista", () => {
  it("desenha o plano com atributos, os pods com problemas e as acções, e as CLIs", async () => {
    const f = fakes();
    await f.o.refresh();
    await f.o.runPipeline();
    f.o.setTab("plan");
    f.o.toggleResource("terraform_data.web");
    await f.o.history("web");
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const host = document.createElement("div");
    host.innerHTML = renderOps(t as never, f.o.state(), true, true);
    expect(host.querySelector(".ops-res.a-create")?.textContent).toContain("terraform_data.web");
    expect(host.querySelectorAll(".ops-attr")).toHaveLength(2);
    expect(host.textContent).toContain("knownAfter");
    expect(host.querySelector(".ops-row.bad .ops-why")?.textContent).toBe("CrashLoopBackOff");
    expect(host.querySelector('[data-action="ops-undo"][data-on="web|1"]')).not.toBeNull();
    expect(host.querySelector('[data-action="ops-undo"][data-on="web|2"]')).toBeNull(); // the current revision
    expect(host.querySelector('[data-action="ops-inventory"][data-on="gcloud"]')).not.toBeNull();
    expect(host.querySelector('[data-action="ops-inventory"][data-on="aws"]')).toBeNull();
    expect(renderOps(t as never, f.o.state(), true, false)).toContain("needDesktop");
  });

  it("r23 F4b: as etapas «não instalado» com a dica, nunca verdes; o veredicto bloqueado; achados, drift e estado nos seus separadores", async () => {
    const f = fakes();
    await f.o.refresh();
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const host = document.createElement("div");
    const draw = (): void => { host.innerHTML = renderOps(t as never, f.o.state(), true, true); };
    f.runs(() => RUN_BLOCKED);
    await f.o.runPipeline();
    draw();
    const trivy = host.querySelector(".ops-stage.s-not_installed");
    expect(trivy?.textContent).toContain("stNotInstalled");
    expect(trivy?.textContent).toContain("Install Trivy");
    expect(host.querySelector(".ops-stage.s-ok .ops-st")?.textContent).toBe("stOk");
    expect(host.querySelector(".ops-verdict.bad")?.textContent).toBe("blocked:rules");
    expect(host.querySelector('[data-action="ops-apply"]')).toBeNull();
    expect(host.querySelector('[data-action="ops-tab"][data-on="security"] .ops-badge')?.textContent).toBe("1");
    f.o.setTab("security");
    draw();
    expect([...host.querySelectorAll(".ops-finding")].map((r) => r.classList.contains("bad"))).toEqual([true, false, false]);
    expect(host.querySelector('[data-action="ops-accept"]')?.getAttribute("data-on")).toBe(SECRET.key);
    expect(host.querySelector(".ops-chip.s-not_installed")?.textContent).toContain("trivy");
    f.runs((d, tg) => RUN_OK(d, tg));
    await f.o.runPipeline();
    draw();
    expect(host.querySelector(".ops-verdict.ok")?.textContent).toBe("readyToApply:1");
    expect(host.querySelector('[data-action="ops-apply"]')).not.toBeNull();
    f.o.setTab("plan");
    draw();
    expect(host.querySelector(".ops-blast")?.textContent).toBe("blast:1");
    expect(host.textContent).toContain("costNotInstalled");
    (f.port as { iacPlan: OpsPort["iacPlan"] }).iacPlan = async (_r, dir, refreshOnly) => ({ ...PLAN, dir, refreshOnly, changes: [], drift: [DRIFT] });
    await f.o.checkDrift();
    f.o.setTab("drift");
    draw();
    expect(host.textContent).toContain("driftWho");
    expect(host.querySelector('[data-action="ops-drift-revert"]')?.getAttribute("data-on")).toBe("aws_s3_bucket.logs");
    f.o.setTab("state");
    await vi.waitFor(() => expect(f.o.state().iac.state.data).not.toBeNull());
    draw();
    expect(host.querySelector('[data-action="ops-unlock"]')).not.toBeNull();
    expect(host.textContent).toContain("sensitiveIn:input");
    expect(host.textContent).not.toContain("id-1-secret");
  });
});
