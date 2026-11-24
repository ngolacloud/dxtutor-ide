import { describe, expect, it, vi } from "vitest";
import { eventsFor, iacApply, kubeCmd, planText, podTrouble, q, servicePort } from "../src/features/ops/domain/commands";
import { makeOps } from "../src/features/ops/application/ops-service";
import type { OpsPort } from "../src/features/ops/application/ports";
import type { IacPlan, KubeTarget } from "../src/features/ops/domain/types";
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
    expect(iacApply({ tool: "tofu", dir: "infra/prod", refreshOnly: false })).toBe("cd infra/prod && tofu plan -out=tfplan && tofu apply tfplan");
    expect(iacApply({ tool: "terraform", dir: ".", refreshOnly: true })).toBe("terraform apply -refresh-only");
    expect(servicePort(["80→8080/TCP"])).toBe("80");
  });

  it("um pod com problemas, os eventos de um objecto e o plano em texto", () => {
    expect(podTrouble({ name: "a", phase: "Running", ready: "1/1", restarts: 0, node: "", created: "", reason: null })).toBe(false);
    expect(podTrouble({ name: "b", phase: "Running", ready: "0/1", restarts: 6, node: "", created: "", reason: "CrashLoopBackOff" })).toBe(true);
    expect(eventsFor([{ kind: "Warning", reason: "BackOff", object: "pod/b", message: "x", count: 2, last: "" }, { kind: "Normal", reason: "Pulled", object: "pod/a", message: "y", count: 1, last: "" }], "pod/b")).toHaveLength(1);
    const txt = planText({ ok: true, tool: "tofu", dir: "infra", refreshOnly: false, add: 1, change: 1, destroy: 0, applyCommand: "", notes: "", drift: [], changes: [{ address: "aws_s3_bucket.logs", action: "update", attrs: [{ name: "versioning", before: "false", after: "true", unknown: false, sensitive: false }] }] });
    expect(txt).toContain("+1 ~1 -0");
    expect(txt).toContain("versioning: false → true");
  });
});

const PLAN: IacPlan = { ok: true, tool: "tofu", dir: "infra", refreshOnly: false, add: 1, change: 0, destroy: 0, applyCommand: "tofu plan -out=tfplan && tofu apply tfplan", notes: "", drift: [], changes: [{ address: "terraform_data.web", action: "create", attrs: [{ name: "input", before: null, after: '{"image":"nginx"}', unknown: false, sensitive: false }, { name: "id", before: null, after: null, unknown: true, sensitive: false }] }] };

function fakes(target: KubeTarget | null = T) {
  const ran: string[] = [];
  const confirms: string[] = [];
  let answer = true;
  const texts: Array<string | null> = [];
  const asked: Array<{ intent: string; context: Array<{ text: string }> }> = [];
  const toasts: string[] = [];
  const port: OpsPort = {
    iacDirs: async () => [".", "infra"],
    iacPlan: async (_r, dir, refreshOnly) => ({ ...PLAN, dir, refreshOnly }),
    kubeState: async (t) => ({ ok: true, context: t.context, namespace: t.namespace, notes: "", pods: [{ name: "web-1", phase: "Running", ready: "0/1", restarts: 6, node: "n1", created: "", reason: "CrashLoopBackOff" }], services: [{ name: "web", kind: "ClusterIP", clusterIp: "10.0.0.5", ports: ["80→8080/TCP"] }], deployments: [{ name: "web", ready: "0/1", images: ["web:1.1"], revision: "2" }], events: [{ kind: "Warning", reason: "BackOff", object: "pod/web-1", message: "Back-off restarting failed container", count: 9, last: "" }] }),
    kubeHistory: vi.fn(async () => [{ revision: 2, replicaSet: "web-b", images: ["web:1.1"], created: "", replicas: 1 }, { revision: 1, replicaSet: "web-a", images: ["web:1.0"], created: "", replicas: 0 }]),
    cloudStatus: async () => [{ provider: "aws", installed: false, version: "", account: null, notes: "Install the AWS CLI v2" }, { provider: "gcloud", installed: true, version: "500.0.0", account: "shop-prod (ana@x)", notes: "" }, { provider: "az", installed: false, version: "", account: null, notes: "Install the Azure CLI" }],
    cloudInventory: async (p) => ({ ok: true, provider: p, commands: ["gcloud run services list --format=json"], notes: "", resources: [{ provider: p, kind: "run", name: "api", region: "europe-west1", status: "ready" }] }),
  };
  const o = makeOps({
    ops: port,
    world: { root: () => "/proj", kubeTarget: () => target, runInTerminal: (c) => ran.push(c) },
    human: { confirm: (m) => { confirms.push(m); return answer; }, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m) },
    codev: { available: () => true, ask: (r) => asked.push(r) },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { o, ran, confirms, texts, asked, toasts, port, refuse: () => { answer = false; } };
}

describe("o serviço", () => {
  it("planeia na pasta escolhida e só aplica com o comando exacto aprovado", async () => {
    const f = fakes();
    await f.o.refresh();
    expect(f.o.state().iac.dirs).toEqual([".", "infra"]);
    f.o.selectDir("infra");
    await f.o.plan(false);
    expect(f.o.state().iac.plan?.changes[0].address).toBe("terraform_data.web");
    f.refuse();
    f.o.applyPlan();
    expect(f.ran).toEqual([]);
    expect(f.confirms[0]).toContain("cd infra && tofu plan -out=tfplan && tofu apply tfplan");
    f.o.askPlan("explain");
    expect(f.asked[0].context[0].text).toContain("create terraform_data.web");
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
    await f.o.plan(false);
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
});
