import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R5c1: os ambientes vêm do cluster real. Cada ambiente é um contexto do kubeconfig +
 * um namespace; o estado de staging/production lê-se do cluster pela porta desktop
 * (`desktopPorts.infra.cluster`, falsa aqui) e promover aplica os manifestos com os segredos do
 * ambiente. No browser não há cluster: nada se inventa (nem estado, nem crash, nem promoção). */

let w: any;
let INF: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da infra da cadeia do bootApp (U7p2)
let desktopPorts: Record<string, any>;
let infra: any; // o módulo FRESCO (initSecrets não é publicado no window)

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const change = (el: Element, v: string) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); };
const okBtn = () => document.getElementById("dlg-ok") as HTMLButtonElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** O cluster local deployado: manifestos gerados do design e o K8S lido (versão anotada). */
function deployLocal(): void {
  w.FS[w.ROOT + "deploy/k8s/all.yaml"] = { content: INF.k8sInfra(w.SD), orig: "" };
  const docs = INF.k8sDocs();
  INF.setK8s({ docs, deps: docs.filter((d: any) => d.k === "Deployment").map((d: any) => ({ n: d.n, rep: d.rep, ready: d.rep, img: d.img })), ver: w.GIT.refs.develop, at: 1 });
}

beforeEach(async () => {
  localStorage.clear(); // a hidratação preguiçosa do ENVX leria o que um teste anterior guardou
  w = await bootApp();
  INF = await import("../src/features/infra");
  desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, any>;
  infra = await import("../src/features/infra");
  w.ENVS.rtOn = true; w.ENVS.k8sOn = true; INF.setK8s(null);
  INF.ENVX.ctx = { staging: "", production: "" }; INF.ENVX.ns = { staging: "dxtutor-staging", production: "dxtutor" };
  INF.ENVX.st = { staging: null, production: null }; INF.ENVX.hist = []; INF.ENVX.sec = null;
});

afterEach(() => {
  delete desktopPorts.infra;
  document.getElementById("dlg")?.classList.remove("show");
  vi.restoreAllMocks();
});

describe("no browser (sem cluster)", () => {
  it("staging e production não têm estado nem crash inventado", () => {
    deployLocal();
    expect(INF.envState("staging")).toBe(null);
    expect(INF.envHealth("staging")).toBe("off");
    expect(INF.envDeps("staging")).toEqual([]);
  });

  it("promover sem o local deployado pede o deploy primeiro", () => {
    const toast = vi.spyOn(w, "toast");
    INF.promote("staging");
    expect(toast).toHaveBeenCalledWith("Deploy to Local first");
  });

  it("promover sem contexto escolhido para o ambiente pede para o escolher", () => {
    deployLocal();
    const toast = vi.spyOn(w, "toast");
    INF.promote("staging");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Escolhe o contexto e o namespace de Staging/));
  });

  it("aprovar a promoção diz que precisa da app desktop e não regista nada", () => {
    deployLocal();
    INF.ENVX.ctx.staging = "kind-staging";
    const toast = vi.spyOn(w, "toast");
    INF.promote("staging");
    expect(document.querySelector("#dlg .dlg-b")!.textContent).toMatch(/kind-staging \/ dxtutor-staging/);
    expect(document.querySelector("#dlg .dlg-b")!.textContent).not.toMatch(/simulated/);
    click(okBtn()!);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/precisa da app desktop/));
    expect(INF.ENVX.hist).toEqual([]);
    expect(INF.ENVX.st.staging).toBe(null);
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
    INF.ENVX.ctx.staging = "kind-staging";
    infra.initSecrets();
    const api = Object.keys(INF.ENVX.sec.staging).find((a) => "DATABASE_URL" in INF.ENVX.sec.staging[a])!;
    INF.ENVX.sec.staging[api].DATABASE_URL = "postgres://u:p@db.staging:5432/app";
    INF.promote("staging");
    click(okBtn()!);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    const [target, manifest, ver] = apply.mock.calls[0];
    expect(target).toEqual({ env: "staging", ctx: "kind-staging", ns: "dxtutor-staging" });
    expect(ver).toBe(w.GIT.refs.develop);
    expect(manifest).toContain('DATABASE_URL: "postgres://u:p@db.staging:5432/app"');
    expect(manifest).not.toContain("postgres://app:app@"); // os valores locais não vão para staging
    await flush();
    expect(INF.ENVX.hist[0]).toMatchObject({ from: "local", to: "staging", ver: w.GIT.refs.develop });
    expect(INF.envState("staging")).toEqual(staged);
    expect(INF.envHealth("staging")).toBe("bad");
  });

  it("um deploy que falha não fica no histórico", async () => {
    apply.mockResolvedValueOnce(false);
    deployLocal();
    INF.ENVX.ctx.staging = "kind-staging";
    INF.promote("staging");
    click(okBtn()!);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await flush();
    expect(INF.ENVX.hist).toEqual([]);
  });

  it("refreshEnvs lê só os ambientes com contexto escolhido e com o cluster ligado", async () => {
    INF.ENVX.ctx.production = "prod-ctx";
    await INF.refreshEnvs();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ env: "production", ctx: "prod-ctx", ns: "dxtutor" });
    expect(INF.envState("production")).toEqual(staged);
    w.ENVS.k8sOn = false;
    await INF.refreshEnvs();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("production bloqueada por staging a falhar aponta para os logs (não para um debugger que já não existe)", async () => {
    deployLocal();
    INF.ENVX.ctx.staging = "kind-staging"; INF.ENVX.ctx.production = "prod-ctx";
    await INF.refreshEnvs();
    const openTab = vi.spyOn(w, "openTab").mockImplementation(() => {});
    INF.promote("production");
    expect(document.querySelector("#dlg h2")!.textContent).toBe("Production is blocked");
    expect(document.querySelector("#dlg .dlg-b")!.textContent).toMatch(/ImagePullBackOff/);
    click(okBtn()!);
    expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ kind: "observe", env: "staging", name: "orders-db" }));
  });

  it("na vista Environments, o contexto de staging escolhe-se entre os contextos reais e relê o ambiente", async () => {
    INF.KCTX.length = 0; INF.KCTX.push("kind-staging", "prod-ctx");
    const host = document.createElement("div"); document.body.appendChild(host);
    w.VIEW.envs({}, host);
    const sel = host.querySelector('[data-action="env-ctx"][data-on="staging"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "kind-staging", "prod-ctx"]);
    change(sel, "kind-staging");
    expect(INF.ENVX.ctx.staging).toBe("kind-staging");
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith({ env: "staging", ctx: "kind-staging", ns: "dxtutor-staging" }));
    change(host.querySelector('[data-action="env-ns"][data-on="staging"]')!, " stg ");
    expect(INF.ENVX.ns.staging).toBe("stg");
    host.remove();
  });
});
