import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R5a: fora da app desktop, a Infra não finge ligar o runtime/cluster, correr a stack
 * nem fazer deploy; os erros reais (falta o compose, faltam Dockerfiles, falta deploy/k8s) ficam. */

let w: any;
const term = (): string => document.getElementById("term")?.textContent || "";

beforeEach(async () => {
  w = await bootApp();
  w.ENVS.rtOn = false; w.ENVS.k8sOn = false; w.STACK = null; w.K8S = null;
});

describe("no browser", () => {
  it("ligar o cluster diz que precisa da app desktop e não liga", () => {
    const toast = vi.spyOn(w, "toast");
    w.k8sConnect();
    expect(w.ENVS.k8sOn).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/needs the desktop app/));
  });

  it("▶ RUN com um docker-compose.yml válido não inventa serviços a correr", () => {
    w.ENVS.rtOn = true; // mesmo «ligado» (estado antigo), o browser não arranca contentores
    w.FS[w.ROOT + "docker-compose.yml"] = { content: "services:\n  web:\n    image: nginx\n", orig: null };
    const r = w.dxRun();
    expect(r).toMatchObject({ ok: false });
    expect(w.STACK).toBe(null);
    expect(term()).toMatch(/precisa da app desktop/);
    expect(term()).not.toMatch(/services up|simulated/);
  });

  it("▶ RUN sem docker-compose.yml mostra o erro real do compose", () => {
    w.ENVS.rtOn = true;
    delete w.FS[w.ROOT + "docker-compose.yml"];
    w.dxRun();
    expect(term()).toMatch(/no configuration file provided/);
  });

  it("deploy: com manifestos, não finge um cluster — diz que precisa da app desktop", () => {
    w.ENVS.rtOn = true; w.ENVS.k8sOn = true;
    w.FS[w.ROOT + "deploy/k8s/all.yaml"] = { content: w.k8sInfra(w.SD), orig: null };
    for (const n of w.SD.nodes) { const d = w.ROOT + w.appDir(n) + "/Dockerfile"; w.FS[d] = { content: "FROM scratch\n", orig: null }; }
    const r = w.dxDeploy();
    expect(r).toMatchObject({ ok: false });
    expect(w.K8S).toBe(null);
    expect(term()).toMatch(/The deploy needs the desktop app/);
    expect(term()).not.toMatch(/deployments ready|simulated/);
  });

  it("o terminal emulado não responde com um cluster/contentor inventado", () => {
    w.XC.kubectl(["get", "pods"]);
    w.XC.devcontainer(["up"]);
    expect(term()).toMatch(/does not talk to the cluster/);
    expect(term()).toMatch(/does not start containers/);
    expect(w.DEVC == null).toBe(true);
  });
});
