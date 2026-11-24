import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R5c1: os ambientes vêm do cluster real. Cada ambiente é um contexto do kubeconfig +
 * um namespace; o estado de staging/production lê-se do cluster pela porta desktop
 * (`desktopPorts.infra.cluster`, falsa aqui) e promover aplica os manifestos com os segredos do
 * ambiente. No browser não há cluster: nada se inventa (nem estado, nem crash, nem promoção). */

let w: any;
let desktopPorts: Record<string, any>;
let infra: any; // o módulo FRESCO (initSecrets não é publicado no window)

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el: Element, v: string) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const okBtn = () => document.getElementById("dlg-ok") as HTMLButtonElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** O cluster local deployado: manifestos gerados do design e o K8S lido (versão anotada). */
function deployLocal(): void {
  w.FS[w.ROOT + "deploy/k8s/all.yaml"] = { content: w.k8sInfra(w.SD), orig: "" };
  const docs = w.k8sDocs();
  w.K8S = { docs, deps: docs.filter((d: any) => d.k === "Deployment").map((d: any) => ({ n: d.n, rep: d.rep, ready: d.rep, img: d.img })), ver: w.GIT.refs.develop, at: 1 };
}

beforeEach(async () => {
  localStorage.clear(); // a hidratação preguiçosa do ENVX leria o que um teste anterior guardou
  w = await bootApp();
  desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, any>;
  infra = await import("../src/features/infra");
  w.ENVS.rtOn = true; w.ENVS.k8sOn = true; w.K8S = null;
  w.ENVX.ctx = { staging: "", production: "" }; w.ENVX.ns = { staging: "dxtutor-staging", production: "dxtutor" };
  w.ENVX.st = { staging: null, production: null }; w.ENVX.hist = []; w.ENVX.sec = null;
});

afterEach(() => {
  delete desktopPorts.infra;
  document.getElementById("dlg")?.classList.remove("show");
  vi.restoreAllMocks();
});

describe("no browser (sem cluster)", () => {
  it("staging e production não têm estado nem crash inventado", () => {
    deployLocal();
    expect(w.envState("staging")).toBe(null);
    expect(w.envHealth("staging")).toBe("off");
    expect(w.envDeps("staging")).toEqual([]);
  });

  it("promover sem o local deployado pede o deploy primeiro", () => {
    const toast = vi.spyOn(w, "toast");
    w.promote("staging");
    expect(toast).toHaveBeenCalledWith("Deploy to Local first");
  });

  it("promover sem contexto escolhido para o ambiente pede para o escolher", () => {
    deployLocal();
    const toast = vi.spyOn(w, "toast");
    w.promote("staging");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Escolhe o contexto e o namespace de Staging/));
  });

  it("aprovar a promoção diz que precisa da app desktop e não regista nada", () => {
    deployLocal();
    w.ENVX.ctx.staging = "kind-staging";
    const toast = vi.spyOn(w, "toast");
    w.promote("staging");
    expect(document.querySelector("#dlg .dlg-b")!.textContent).toMatch(/kind-staging \/ dxtutor-staging/);
    expect(document.querySelector("#dlg .dlg-b")!.textContent).not.toMatch(/simulated/);
    click(okBtn()!);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/precisa da app desktop/));
    expect(w.ENVX.hist).toEqual([]);
    expect(w.ENVX.st.staging).toBe(null);
  });
});

describe("no desktop (porta do cluster, falsa)", () => {
  let apply: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>;
  const staged = { ver: "abc1234", at: 5, ingress: true, deps: [{ n: "orders-db", rep: 1, ready: 0, status: "crash", err: "ImagePullBackOff", restarts: 0 }] };
  beforeEach(() => {
    apply = vi.fn(async () => true);
    read = vi.fn(async () => staged);
    desktopPorts.infra = { rtConnect: vi.fn(), k8sConnect: vi.fn(), dxDeploy: vi.fn(), observe: vi.fn(), cluster: { apply, read } };
  });

  it("promover aplica os manifestos com os segredos DE STAGING, regista a promoção e relê o ambiente", async () => {
    deployLocal();
    w.ENVX.ctx.staging = "kind-staging";
    infra.initSecrets();
    const api = Object.keys(w.ENVX.sec.staging).find((a) => "DATABASE_URL" in w.ENVX.sec.staging[a])!;
    w.ENVX.sec.staging[api].DATABASE_URL = "postgres://u:p@db.staging:5432/app";
    w.promote("staging");
    click(okBtn()!);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    const [target, manifest, ver] = apply.mock.calls[0];
    expect(target).toEqual({ env: "staging", ctx: "kind-staging", ns: "dxtutor-staging" });
    expect(ver).toBe(w.GIT.refs.develop);
    expect(manifest).toContain('DATABASE_URL: "postgres://u:p@db.staging:5432/app"');
    expect(manifest).not.toContain("postgres://app:app@"); // os valores locais não vão para staging
    await flush();
    expect(w.ENVX.hist[0]).toMatchObject({ from: "local", to: "staging", ver: w.GIT.refs.develop });
    expect(w.envState("staging")).toEqual(staged);
    expect(w.envHealth("staging")).toBe("bad");
  });

  it("um deploy que falha não fica no histórico", async () => {
    apply.mockResolvedValueOnce(false);
    deployLocal();
    w.ENVX.ctx.staging = "kind-staging";
    w.promote("staging");
    click(okBtn()!);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await flush();
    expect(w.ENVX.hist).toEqual([]);
  });

  it("refreshEnvs lê só os ambientes com contexto escolhido e com o cluster ligado", async () => {
    w.ENVX.ctx.production = "prod-ctx";
    await w.refreshEnvs();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ env: "production", ctx: "prod-ctx", ns: "dxtutor" });
    expect(w.envState("production")).toEqual(staged);
    w.ENVS.k8sOn = false;
    await w.refreshEnvs();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("production bloqueada por staging a falhar aponta para os logs (não para um debugger que já não existe)", async () => {
    deployLocal();
    w.ENVX.ctx.staging = "kind-staging"; w.ENVX.ctx.production = "prod-ctx";
    await w.refreshEnvs();
    const openTab = vi.spyOn(w, "openTab").mockImplementation(() => {});
    w.promote("production");
    expect(document.querySelector("#dlg h2")!.textContent).toBe("Production is blocked");
    expect(document.querySelector("#dlg .dlg-b")!.textContent).toMatch(/ImagePullBackOff/);
    click(okBtn()!);
    expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "observe", env: "staging", name: "orders-db" }));
  });

  it("na vista Environments, o contexto de staging escolhe-se entre os contextos reais e relê o ambiente", async () => {
    w.KCTX.length = 0; w.KCTX.push("kind-staging", "prod-ctx");
    const host = document.createElement("div"); document.body.appendChild(host);
    w.VIEW.envs({}, host);
    const sel = host.querySelector('[data-action="env-ctx"][data-on="staging"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "kind-staging", "prod-ctx"]);
    change(sel, "kind-staging");
    expect(w.ENVX.ctx.staging).toBe("kind-staging");
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith({ env: "staging", ctx: "kind-staging", ns: "dxtutor-staging" }));
    change(host.querySelector('[data-action="env-ns"][data-on="staging"]')!, " stg ");
    expect(w.ENVX.ns.staging).toBe("stg");
    host.remove();
  });
});
