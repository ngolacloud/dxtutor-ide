import { describe, expect, it, vi } from "vitest";
import { gateTone, preflightGates, secretGates, stepTone, stillBlocking } from "../src/features/deploy/domain/rules";
import { makeDeploy } from "../src/features/deploy/application/deploy-service";
import type { ApprovalRequest, DeployPort } from "../src/features/deploy/application/ports";
import type { DeployPlan, DeployRecord, Gate } from "../src/features/deploy/domain/types";
import { tauriDeploy } from "../src/features/deploy/infrastructure/tauri";
import { renderDeploy } from "../src/features/deploy/ui/view";
import { envStage, lifecycleOf } from "../src/features/scm/domain/lifecycle";

/* r23 F4c2 (docs/v2/AUDIT-r23.md §4.4, D01–D04): o deploy guiado — o plano do backend (todas as verificações, o que
 * bloqueia, o que admite excepção), excepções com motivo, a aprovação com os comandos exactos (produção: motivo e
 * «production» escrito), o rollout com as linhas e o registo; e o registo no ciclo de vida do commit (F3). */

const g = (id: string, status: Gate["status"], summary = ""): Gate => ({ id, status, summary, detail: "", hint: status === "not_installed" ? `install ${id}` : null });
const PLAN = (env: string): DeployPlan => {
  const gates = [g("version", "ok", "abc"), g("sbom", "not_installed"), g("signature", "not_connected"), g("vulns", "not_installed"), g("secrets", "ok", "1 Secret present"), g("secret-check", "not_connected"), g("drift", "skipped"), g("admission", "ok"), g("slo", "not_connected"), g("window", "skipped"), g("migrations", "skipped")];
  const prod = env === "production";
  if (prod) gates.push(g("staging", "ok"), g("approver", "ok", "approved by bruno"));
  const waivable = prod ? ["sbom", "signature", "vulns", "secret-check", "slo"] : [];
  return {
    id: `plan-${env}`, env, context: prod ? "prod" : "kind-dev", namespace: "shop", version: "0123456789abcdef", subject: "feat: SHOP-7 web", issue: "SHOP-7",
    identity: { git: "ana", cluster: "kind-admin", vault: null }, manifests: ["deploy/k8s/app.yaml"], deployments: ["web"], images: ["shop/web:1.0"], secretsFromVault: ["shop-env"],
    gates, strategy: "rolling", blockers: waivable, waivable, commands: ["kubectl --context kind-dev -n shop apply -f -   # deploy/k8s/app.yaml without the Secrets (shop-env)"], approver: prod ? "bruno" : null, notes: "",
  };
};
const REC = (env: string, ok: boolean): DeployRecord => ({ id: 1, env, context: "kind-dev", namespace: "shop", version: "0123456789abcdef", issue: "SHOP-7", actor: "ana", approver: null, at: 1, ok, failedStep: ok ? null : "rollout", waivers: "[]", gates: "{}", reason: null });

describe("domínio", () => {
  it("o que ainda bloqueia com as excepções, e o tom de cada verificação e de cada passo", () => {
    const p = PLAN("production");
    expect(stillBlocking(p, {})).toEqual(["sbom", "signature", "vulns", "secret-check", "slo"]);
    expect(stillBlocking(p, { sbom: "no scanner yet", slo: "x" })).toEqual(["signature", "vulns", "secret-check", "slo"]);
    expect(gateTone(p, p.gates[1], {})).toBe("blocked");
    expect(gateTone(p, p.gates[1], { sbom: "no scanner yet" })).toBe("waived");
    expect(gateTone(PLAN("staging"), PLAN("staging").gates[1], {})).toBe("warn");
    expect(gateTone(p, p.gates[6], {})).toBe("skip");
    expect(secretGates(p).map((x) => x.id)).toEqual(["secrets", "secret-check"]);
    expect(preflightGates(p).map((x) => x.id)).not.toContain("version");
    expect([stepTone(p, "target", {}), stepTone(p, "secrets", {}), stepTone(PLAN("staging"), "preflight", {}), stepTone(null, "target", {})]).toEqual(["ok", "blocked", "warn", "todo"]);
  });

  it("o ciclo de vida do commit: o último deploy de cada ambiente; sem fonte, «não ligado»", () => {
    expect(envStage(undefined).state).toBe("pending");
    expect(envStage(null).state).toBe("not-connected");
    expect(envStage([]).state).toBe("none");
    const s = envStage([{ ...REC("production", false), at: 3 }, { ...REC("staging", true), at: 1 }, { ...REC("staging", false), at: 0 }]);
    expect(s).toMatchObject({ state: "failed", text: "staging ✓ · production ✗" });
    expect(s.detail).toContain("failed at rollout");
    expect(lifecycleOf({ message: "x", tests: [], runs: null, prs: null, ghMissing: "not-installed" }).at(-1)?.state).toBe("not-connected");
    expect(lifecycleOf({ message: "x", tests: [], runs: null, prs: null, ghMissing: "not-installed", deploys: [REC("staging", true)] }).at(-1)).toMatchObject({ state: "ok", text: "staging ✓" });
  });
});

function fakes(opts: { approve?: boolean } = {}) {
  const calls: string[] = [];
  const confirms: ApprovalRequest[] = [];
  const toasts: string[] = [];
  const texts: Array<string | null> = [];
  let out: ((id: string, line: string) => void) | null = null;
  const port: DeployPort = {
    plan: async (root, target) => { calls.push(`plan ${root} ${JSON.stringify(target)}`); return PLAN(target.env); },
    rollout: async (root, planId, confirm, reason, waivers) => {
      calls.push(`rollout ${root} ${planId} ${confirm} ${reason} ${JSON.stringify(waivers)}`);
      out?.(planId, "$ kubectl apply -f -");
      out?.("other-plan", "not mine");
      out?.(planId, "deployment.apps/web configured");
      return REC(planId.endsWith("production") ? "production" : "staging", true);
    },
    records: async () => [REC("staging", true)],
    onOutput: (f) => { out = f; },
  };
  let tabs = 0;
  const d = makeDeploy({
    deploy: port,
    world: { root: () => "/proj", target: (env) => ({ env, context: env === "production" ? "prod" : "kind-dev", namespace: "shop", stagingContext: env === "production" ? "kind-dev" : null, stagingNamespace: env === "production" ? "shop" : null }), openTab: () => { tabs++; } },
    human: { approve: async (r) => { confirms.push(r); return { approved: opts.approve ?? true, reason: "release 1.4 for SHOP-7", decidedAt: 1 }; }, text: async () => texts.shift() ?? null, toast: (m) => toasts.push(m) },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { d, calls, confirms, toasts, texts, tabs: () => tabs };
}

describe("o serviço", () => {
  it("staging: o plano para o cluster do ambiente; deploy aprovado com os comandos; as linhas do rollout; o registo", async () => {
    const f = fakes();
    f.d.open("staging");
    expect(f.tabs()).toBe(1);
    await vi.waitFor(() => expect(f.d.state().plan?.env).toBe("staging"));
    expect(f.calls[0]).toContain('"context":"kind-dev"');
    await f.d.rollout();
    expect(f.confirms[0]).toMatchObject({ destructive: false, reasonRequired: false, confirmText: undefined, scope: 'scope {"ctx":"kind-dev","ns":"shop"}' });
    expect(f.confirms[0].command).toContain("without the Secrets (shop-env)");
    expect(f.calls.at(-1)).toBe("rollout /proj plan-staging null release 1.4 for SHOP-7 []");
    expect(f.d.state().lines).toEqual(["$ kubectl apply -f -", "deployment.apps/web configured"]);
    expect(f.d.state().record?.ok).toBe(true);
    await vi.waitFor(() => expect(f.d.recent()).toHaveLength(1));
  });

  it("produção: bloqueada até cada verificação sem dados ter uma excepção com motivo; depois motivo e «production» escrito", async () => {
    const f = fakes();
    await f.d.plan("production");
    await f.d.rollout();
    expect(f.confirms).toHaveLength(0);
    f.texts.push("x");
    await f.d.waive("sbom");
    expect(f.toasts.at(-1)).toBe("waiveNeedsReason");
    await f.d.waive("version");
    for (const gate of ["sbom", "signature", "vulns", "secret-check", "slo"]) { f.texts.push(`no ${gate} source yet`); await f.d.waive(gate); }
    f.d.unwaive("slo");
    await f.d.rollout();
    expect(f.confirms).toHaveLength(0);
    f.texts.push("no SLO source yet");
    await f.d.waive("slo");
    await f.d.rollout();
    expect(f.confirms[0]).toMatchObject({ destructive: true, reasonRequired: true, confirmText: "production" });
    expect(f.confirms[0].command).toContain("waivedList");
    expect(f.confirms[0].command).toContain("sbom (no sbom source yet)");
    expect(f.calls.at(-1)).toContain("rollout /proj plan-production production release 1.4 for SHOP-7");
    expect(f.calls.at(-1)).toContain('{"gate":"slo","reason":"no SLO source yet"}');
  });

  it("recusado no diálogo: nada corre", async () => {
    const f = fakes({ approve: false });
    await f.d.plan("staging");
    await f.d.rollout();
    expect(f.calls.some((c) => c.startsWith("rollout"))).toBe(false);
  });
});

describe("o adaptador Tauri", () => {
  it("os comandos e os argumentos; as linhas do rollout pelo evento", async () => {
    const seen: Array<[string, unknown]> = [];
    let listener: ((p: unknown) => void) | null = null;
    const port = tauriDeploy(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; }, (_e, f) => { listener = f; });
    await port.plan("/p", { env: "staging", context: "c", namespace: "n" });
    await port.rollout("/p", "id1", "production", "why", [{ gate: "slo", reason: "r" }]);
    await port.records("/p", ["abcdef1"]);
    expect(seen).toEqual([
      ["deploy_plan", { root: "/p", target: { env: "staging", context: "c", namespace: "n" } }],
      ["deploy_rollout", { root: "/p", planId: "id1", confirm: "production", reason: "why", waivers: [{ gate: "slo", reason: "r" }] }],
      ["deploy_records", { root: "/p", shas: ["abcdef1"] }],
    ]);
    const got: string[] = [];
    port.onOutput((id, l) => got.push(`${id}:${l}`));
    listener!({ planId: "id1", line: "ok" });
    expect(got).toEqual(["id1:ok"]);
  });
});

describe("a vista", () => {
  it("os oito passos; «não instalado» com a dica e nunca verde; excepções; os comandos; o registo", async () => {
    const f = fakes();
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const host = document.createElement("div");
    const draw = (): void => { host.innerHTML = renderDeploy(t as never, f.d.state(), true); };
    await f.d.plan("production");
    draw();
    expect([...host.querySelectorAll(".dp-step h3")].map((h) => h.textContent)).toEqual(["target", "identity", "secrets", "preflight", "strategy", "approve", "rollout", "record", "history"]);
    const sbom = host.querySelector('.dp-gate[data-on="sbom"]')!;
    expect(sbom.classList.contains("g-blocked")).toBe(true);
    expect(sbom.querySelector(".dp-st")?.textContent).toBe("stNotInstalled");
    expect(host.textContent).toContain("install sbom");
    expect(host.querySelector('[data-action="deploy:waive"][data-on="sbom"]')).not.toBeNull();
    expect(host.querySelector('[data-action="deploy:rollout"]')?.hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("fromVault:shop-env");
    expect(host.querySelector(".dp-cmds")?.textContent).toContain("without the Secrets");
    for (const gate of ["sbom", "signature", "vulns", "secret-check", "slo"]) { f.texts.push("reason here"); await f.d.waive(gate); }
    draw();
    expect(host.querySelector('[data-action="deploy:rollout"]')?.hasAttribute("disabled")).toBe(false);
    expect(host.querySelector(".dp-verdict.ok")?.textContent).toBe("ready");
    await f.d.rollout();
    draw();
    expect(host.querySelector(".dp-out")?.textContent).toContain("deployment.apps/web configured");
    expect(host.querySelector(".dp-rec.ok")).not.toBeNull();
    expect(renderDeploy(t as never, f.d.state(), false)).toContain("needDesktop");
  });
});
