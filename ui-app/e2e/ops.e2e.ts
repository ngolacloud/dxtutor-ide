/* ═══════════ A9 — Ops: IaC, Kubernetes, cloud — read-only by default (docs/v2/UI-AUDIT.md item 10; r23 F4b) ═══════════
   The real app in desktop mode against a scripted backend that answers the `ops_*` / `iac_*` commands the way
   `tutor_eval::ops` / `tutor_eval::iac` do (an IaC pipeline whose stages arrive as `iac://stage` events — the
   first run blocked by a secret in the code, the second clean —, a namespace with a crashing pod, a deployment's
   revisions, the cloud CLIs' status and a gcloud inventory). Proves: the Infra pane leads to the Ops tab; a missing
   scanner shows «not installed» with its hint; a blocked run offers no apply; accepting the risk asks for a reason
   and the backend keeps it; the clean run's plan is a per-resource / per-attribute diff; applying shows the
   backend's command for the REVIEWED plan file (r23 F4b replaced the re-planning `plan -out=tfplan && apply
   tfplan`), and only reaches the terminal once approved (a refusal sends nothing and is audited); rolling back is
   the same; reading logs goes straight to the terminal; the cloud inventory comes from the CLI that is installed. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const emit = (event: string, payload: unknown): void => { (listeners[event] || []).forEach((h) => h({ payload })); };
  let runs = 0;
  const stage = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, summary: status, detail: "", hint: null, command: `tofu ${id}`, findings: [], ms: 120, ...extra });
  const secret = { source: "built-in", rule: "secret-argument", file: "infra/main.tf", line: 2, severity: "error", message: "`password` takes a secret from a literal: its value is kept in the state and the plan.", resource: null, key: "built-in:secret-argument:infra/main.tf:0123456789abcdef", accepted: false };
  const plan = (dir: unknown) => ({ ok: true, tool: "tofu", dir, refreshOnly: false, add: 1, change: 1, destroy: 0, notes: "", drift: [],
    changes: [
      { address: "terraform_data.web", action: "update", dependents: ["terraform_data.cache"], writeOnly: [], monthlyCost: null, attrs: [{ name: "input", before: '{"image":"nginx:1.27"}', after: '{"image":"nginx:1.28"}', unknown: false, sensitive: false }] },
      { address: "terraform_data.cache", action: "create", dependents: [], writeOnly: [], monthlyCost: null, attrs: [{ name: "id", before: null, after: null, unknown: true, sensitive: false }] },
    ] });
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", skipped: 0, truncated: false, files: [{ path: "infra/main.tf", content: 'resource "terraform_data" "web" {\n  input = { image = "nginx:1.27" }\n}\n' }] };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
      case "list_tests":
        return [];
      case "ops_iac_dirs":
        return ["infra"];
      case "iac_risks":
        return [];
      case "iac_risk_accept":
        return { id: 1, key: args.key, kind: args.kind, label: args.label, reason: args.reason, actor: "ana", at: 1, expires: 2592000001 };
      case "iac_pipeline_run": {
        runs += 1;
        const blocked = runs === 1;
        const stages = [
          stage("init", "ok"), stage("fmt", "ok"), stage("validate", "ok"),
          stage("rules", blocked ? "failed" : "ok", { findings: [{ ...secret, accepted: !blocked }] }),
          stage("tflint", "not_installed", { hint: "Install TFLint: curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash", command: "" }),
          stage("plan", "ok", { summary: "+1 ~1 −0" }),
        ];
        for (const s of stages) { emit("iac://stage", { root: args.root, dir: args.dir, stage: { ...s, status: "running" } }); emit("iac://stage", { root: args.root, dir: args.dir, stage: s }); }
        return { id: "ab".repeat(32), tool: "tofu", dir: args.dir, target: args.target ?? null, stages, plan: plan(args.dir), blocked, blockers: blocked ? ["rules"] : [], notes: "" };
      }
      case "iac_apply_command":
        return { command: `cd infra && tofu apply -input=false /home/e2e/.local/share/dxtutor/iac-plans/${args.planId}.bin`, planFile: `/home/e2e/.local/share/dxtutor/iac-plans/${args.planId}.bin`, tool: "tofu", dir: args.dir, destroy: 0 };
      case "ops_kube_state":
        return { ok: true, context: args.context, namespace: args.namespace, notes: "",
          pods: [{ name: "web-7c9f", phase: "Running", ready: "0/1", restarts: 6, node: "kind-control-plane", created: "", reason: "CrashLoopBackOff" }, { name: "db-0", phase: "Running", ready: "1/1", restarts: 0, node: "kind-control-plane", created: "", reason: null }],
          services: [{ name: "web", kind: "ClusterIP", clusterIp: "10.96.0.12", ports: ["80→8080/TCP"] }],
          deployments: [{ name: "web", ready: "0/1", images: ["shop/web:1.1"], revision: "2" }],
          events: [{ kind: "Warning", reason: "BackOff", object: "pod/web-7c9f", message: "Back-off restarting failed container web", count: 9, last: "2026-11-24T10:00:00Z" }] };
      case "ops_kube_history":
        return [{ revision: 2, replicaSet: "web-b", images: ["shop/web:1.1"], created: "2026-11-24T09:00:00Z", replicas: 1 }, { revision: 1, replicaSet: "web-a", images: ["shop/web:1.0"], created: "2026-11-23T09:00:00Z", replicas: 0 }];
      case "ops_cloud_status":
        return [{ provider: "aws", installed: false, version: "", account: null, notes: "Install the AWS CLI v2 and run `aws configure sso` (or `aws configure`)." }, { provider: "gcloud", installed: true, version: "500.0.0", account: "shop-prod (ana@example.com)", notes: "" }, { provider: "az", installed: false, version: "", account: null, notes: "Install the Azure CLI and run `az login`." }];
      case "ops_cloud_inventory":
        return { ok: true, provider: args.provider, commands: ["gcloud run services list --format=json"], notes: "", resources: [{ provider: "gcloud", kind: "run", name: "api", region: "europe-west1", status: "ready" }] };
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = { core: { invoke }, event: { listen: async (event: string, h: Handler) => { (listeners[event] ||= []).push(h); return () => undefined; } } };
  w.__fake = { calls };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("infra/main.tf")));
  // the cluster the Infra pane is connected to, and a recorder for what would reach the terminal
  await page.evaluate(() => {
    const w = window as unknown as { ENVS: Record<string, unknown>; runTask: (c: string) => void; __ran: string[] };
    Object.assign(w.ENVS, { k8sOn: true, ctx: "kind-dev", ns: "shop", kube: "" });
    w.__ran = [];
    w.runTask = (c: string) => { w.__ran.push(c); };
  });
}

const ran = (page: Page) => page.evaluate(() => (window as unknown as { __ran: string[] }).__ran);
const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

test("the Ops tab: IaC plan diff, the namespace with its actions, cloud CLIs — changes only through approved commands", async ({ page }) => {
  await boot(page);
  await page.locator('#activity .act[data-pane="infra"]').first().click();
  await page.locator('[data-action="ops-open"]').click();
  const ops = page.locator(".ops");
  await expect(ops).toBeVisible();
  // r23 F1: the status bar shows the build — the desktop app's version (app_info) with the commit it was built from
  await expect(page.locator("#st-build")).toHaveText(/^e2e( · [0-9a-f]{7}\*?)?$/);

  // IaC (r23 F4b): the pipeline — a missing scanner says so, a secret in the code blocks the apply
  await ops.locator('[data-action="ops-run"]').click();
  await expect(ops.locator(".ops-stage")).toHaveCount(6);
  expect((await calls(page, "iac_pipeline_run")).at(-1)).toEqual({ root: "/proj", dir: "infra", target: null });
  await expect(ops.locator(".ops-stage.s-not_installed")).toContainText("Install TFLint");
  await expect(ops.locator(".ops-verdict.bad")).toContainText("rules");
  await expect(ops.locator('[data-action="ops-apply"]')).toHaveCount(0);
  // accepting the risk asks for a reason; the backend keeps it (and audits it)
  await ops.locator('[data-action="ops-tab"][data-on="security"]').click();
  await ops.locator('[data-action="ops-accept"]').click();
  const appr = page.locator("#approval");
  await expect(appr.locator(".appr-cmd")).toContainText("takes a secret from a literal");
  await appr.locator("#appr-reason").fill("fixture value, rotated before any deploy");
  await appr.locator("#appr-ok").click();
  await expect.poll(async () => (await calls(page, "iac_risk_accept")).length).toBe(1);
  expect((await calls(page, "iac_risk_accept"))[0]).toMatchObject({ root: "/proj", kind: "finding", key: "built-in:secret-argument:infra/main.tf:0123456789abcdef", reason: "fixture value, rotated before any deploy" });
  await expect(ops.locator(".ops-finding .ops-ok")).toHaveCount(1);
  // run again: clean; the plan is a per-resource diff with its blast radius
  await ops.locator('[data-action="ops-tab"][data-on="pipeline"]').click();
  await expect(ops.locator(".ops-dim", { hasText: "run the pipeline again" })).toHaveCount(1);
  await ops.locator('[data-action="ops-run"]').click();
  await expect(ops.locator(".ops-verdict.ok")).toBeVisible();
  await ops.locator('[data-action="ops-tab"][data-on="plan"]').click();
  await expect(ops.locator(".ops-res")).toHaveCount(2);
  await expect(ops.locator('.ops-res[data-on="terraform_data.web"] .ops-blast')).toHaveText("blast radius 1");
  await ops.locator('.ops-res[data-on="terraform_data.web"]').click();
  await expect(ops.locator(".ops-attr")).toContainText("nginx:1.28");
  // apply: the backend's command for the reviewed plan file, only once approved
  await ops.locator('[data-action="ops-tab"][data-on="pipeline"]').click();
  await ops.locator('[data-action="ops-apply"]').click();
  await expect(appr.locator(".appr-cmd")).toHaveText(`cd infra && tofu apply -input=false /home/e2e/.local/share/dxtutor/iac-plans/${"ab".repeat(32)}.bin`);
  await expect(appr.locator(".appr-scope")).toContainText("folder infra · tofu");
  expect((await calls(page, "iac_apply_command")).at(-1)).toEqual({ root: "/proj", dir: "infra", planId: "ab".repeat(32) });
  await page.screenshot({ path: test.info().outputPath("a9-ops-approval.png") });
  await appr.locator("#appr-no").click();
  await expect(appr).toHaveCount(0);
  expect(await ran(page)).toEqual([]);
  // the refusal is in the audit log too (r23 F1): the backend decides who and when
  await expect.poll(async () => (await calls(page, "audit_record")).length).toBe(1);
  expect((await calls(page, "audit_record"))[0]).toMatchObject({ root: "/proj", entry: { feature: "ops", action: "iac.apply", approved: false, scope: "folder infra · tofu" } });
  expect(String(((await calls(page, "audit_record"))[0].entry as { command: string }).command)).toContain("tofu apply -input=false");

  // Kubernetes: the crashing pod, logs straight to the terminal, a rollback only once approved
  await expect(ops.locator(".ops-sec").nth(1).locator(".ops-row.bad .ops-why").first()).toHaveText("CrashLoopBackOff");
  expect((await calls(page, "ops_kube_state")).at(-1)).toEqual({ context: "kind-dev", namespace: "shop", kubeconfig: null });
  await ops.locator('[data-action="ops-logs-pod"][data-on="web-7c9f"]').click();
  await expect.poll(() => ran(page)).toEqual(["kubectl --context kind-dev -n shop logs -f web-7c9f --tail=200"]);
  await ops.locator('[data-action="ops-history"][data-on="web"]').click();
  await expect(ops.locator(".ops-hist .ops-row")).toHaveCount(2);
  await ops.locator('[data-action="ops-undo"][data-on="web|1"]').click();
  await expect(appr.locator(".appr-scope")).toContainText("context kind-dev · namespace shop");
  await appr.locator("#appr-ok").click();
  await expect.poll(async () => (await ran(page)).at(-1)).toBe("kubectl --context kind-dev -n shop rollout undo deploy/web --to-revision=1");
  expect((await calls(page, "audit_record")).at(-1)).toMatchObject({ entry: { action: "kube.undo", approved: true, outcome: "sent", scope: "context kind-dev · namespace shop" } });

  // cloud: the installed CLI's inventory; the others say how to install them
  await expect(ops.locator(".ops-card").first()).toContainText("Install the AWS CLI");
  await ops.locator('[data-action="ops-inventory"][data-on="gcloud"]').click();
  await expect(ops.locator(".ops-card").nth(1)).toContainText("api");
  await page.screenshot({ path: test.info().outputPath("a9-ops.png") });
});
