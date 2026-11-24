import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R5b: o dev container e o escalar/apagar no cluster deixam de ser simulados. No browser,
 * o «attach» só escreve o devcontainer.json (sem um DEVC inventado) e o scale/delete dizem que
 * precisam do kubectl real sem mexer no estado do cluster; no desktop, as versões publicadas
 * passam pela porta `desktopPorts.infra` (que recebe a versão de base como último argumento). */

let w: any;
let desktopPorts: Record<string, unknown>; // a MESMA instância que a app usa (o harness reimporta a cadeia)
const P_DC = () => w.ROOT + ".devcontainer/devcontainer.json";

beforeEach(async () => {
  w = await bootApp();
  desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, unknown>;
  w.ENVS.rtOn = true; w.ENVS.k8sOn = false; w.DEVC = null; w.K8S = null;
});

afterEach(() => {
  delete desktopPorts.infra;
  vi.restoreAllMocks();
});

describe("no browser", () => {
  it("attach escreve o devcontainer.json do projecto e não finge um contentor a correr", () => {
    delete w.FS[P_DC()];
    const toast = vi.spyOn(w, "toast");
    w.dcAttach();
    expect(w.FS[P_DC()]?.content).toMatch(/"name"/);
    expect(w.DEVC == null).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/precisa da app desktop/));
  });

  it("attach sem runtime ligado não escreve nada", () => {
    w.ENVS.rtOn = false;
    delete w.FS[P_DC()];
    w.dcAttach();
    expect(w.FS[P_DC()]).toBeUndefined();
  });

  it("detach limpa o DEVC", () => {
    w.DEVC = { name: "x", image: "y" };
    w.dcDetach();
    expect(w.DEVC).toBe(null);
  });

  it("scale e delete dizem que precisam do kubectl real e não mexem no estado do cluster", () => {
    const k8s = { ctx: "kind-dx", ns: "dx", deps: [{ n: "api", ready: 1, want: 1 }] };
    w.K8S = k8s;
    const toast = vi.spyOn(w, "toast");
    w.k8sScale("api", 1);
    w.k8sDown();
    expect(w.K8S).toBe(k8s);
    expect(k8s.deps[0].want).toBe(1);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Escalar no cluster precisa da app desktop/));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Apagar do cluster precisa da app desktop/));
  });
});

describe("no desktop (porta)", () => {
  it("as versões publicadas consultam a porta e passam-lhe a versão de base", () => {
    const port = {
      rtConnect: vi.fn(), k8sConnect: vi.fn(), dxDeploy: vi.fn(),
      dcAttach: vi.fn(), dcDetach: vi.fn(), k8sScale: vi.fn(), k8sDown: vi.fn(),
    };
    desktopPorts.infra = port;
    w.dcAttach(); w.dcDetach(); w.k8sScale("api", -1); w.k8sDown();
    expect(port.dcAttach).toHaveBeenCalledWith(expect.any(Function));
    expect(port.dcDetach).toHaveBeenCalledWith(expect.any(Function));
    expect(port.k8sScale).toHaveBeenCalledWith("api", -1, expect.any(Function));
    expect(port.k8sDown).toHaveBeenCalledWith(expect.any(Function));
  });

  it("uma porta sem os métodos do R5b cai na versão de base", () => {
    desktopPorts.infra = { rtConnect: vi.fn(), k8sConnect: vi.fn(), dxDeploy: vi.fn() };
    const toast = vi.spyOn(w, "toast");
    w.k8sDown();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Apagar do cluster/));
  });
});
