import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R5c2: a vista de observabilidade mostra as métricas e os logs REAIS de um workload,
 * pela porta `desktopPorts.infra.obs` (falsa aqui): `stats`/`compose logs` para um serviço do
 * compose, `kubectl top`/`logs` para um Deployment no contexto do ambiente. No browser não há de
 * onde os ler — e já não há séries semeadas nem logs sintéticos. */

let w: any;
let INF: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da infra da cadeia do bootApp (U7p2)
let desktopPorts: Record<string, any>;
let host: HTMLElement;

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const open = (env: string, name: string) => {
  const t = { id: `obs:${env}:${name}`, kind: "observe", env, name };
  vi.spyOn(w, "tabOf").mockReturnValue(t);
  w.cur = t.id;
  vi.spyOn(w, "show").mockImplementation(() => w.VIEW.observe(t, host));
  w.VIEW.observe(t, host);
};

beforeEach(async () => {
  localStorage.clear();
  w = await bootApp();
  INF = await import("../src/features/infra");
  desktopPorts = (await import("../src/app/desktop")).desktopPorts as Record<string, any>;
  host = document.createElement("div"); document.body.appendChild(host);
  Object.keys(INF.OBS).forEach((k) => delete INF.OBS[k]);
  (await import("../src/features/stack")).setStackState(null); INF.setK8s(null); w.ENVS.k8sOn = false;
  INF.ENVX.ctx = { staging: "", production: "" }; INF.ENVX.ns = { staging: "dx-stg", production: "dx" };
});

afterEach(() => {
  delete desktopPorts.infra;
  host.remove();
  vi.restoreAllMocks();
});

describe("no browser", () => {
  it("diz que as métricas e os logs vêm da app desktop; nada semeado nem «simulated»", () => {
    open("local", "orders-api");
    expect(host.textContent).toMatch(/na app desktop/);
    expect(host.textContent).not.toMatch(/simulated/);
    expect(host.querySelector(".obs-c")).toBe(null);
    expect(host.querySelector(".ll")).toBe(null);
  });
});

describe("no desktop (porta obs falsa)", () => {
  let obs: { sample: any; logs: any; follow: any; command: any };
  beforeEach(() => {
    obs = {
      sample: vi.fn(async () => ({ cpu: 12.5, mem: 40 })),
      logs: vi.fn(async () => "2026-11-24T10:00:00.000Z INFO ready\n2026-11-24T10:00:01.000Z ERROR boom\n"),
      follow: vi.fn(),
      command: vi.fn((t: any) => `logs ${t.via} ${t.n}`),
    };
    desktopPorts.infra = { rtConnect: vi.fn(), k8sConnect: vi.fn(), dxDeploy: vi.fn(), obs };
  });

  it("um serviço do compose a correr: lê o stats e os logs dele e mostra-os", async () => {
    (await import("../src/features/stack")).setStackState([{ name: "db", src: "postgres:16", url: "internal", state: "running" }]);
    open("local", "db");
    expect(host.textContent).toMatch(/Reading the logs/);
    await vi.waitFor(() => expect(host.querySelectorAll(".ll").length).toBe(2));
    expect(obs.sample).toHaveBeenCalledWith({ via: "compose", env: "local", n: "db" });
    expect([...host.querySelectorAll(".ll")].map((l) => l.className)).toEqual(["ll INFO", "ll ERROR"]);
    expect(host.querySelector(".obs-h b")!.textContent).toBe("12.5 %");
    expect(host.textContent).toMatch(/logs compose db/);
    expect(host.querySelector(".tag.live")).toBeTruthy();
  });

  it("staging: o Deployment no contexto/namespace do ambiente (não no do local)", async () => {
    w.ENVS.k8sOn = true; w.ENVS.ctx = "kind-local"; w.ENVS.ns = "dx";
    INF.ENVX.ctx.staging = "stg-ctx";
    open("staging", "api");
    await vi.waitFor(() => expect(obs.logs).toHaveBeenCalled());
    expect(obs.logs).toHaveBeenCalledWith({ via: "kubectl", env: "staging", n: "api", ctx: "stg-ctx", ns: "dx-stg" });
  });

  it("sem saber onde corre (ambiente sem contexto) di-lo em vez de inventar", () => {
    open("production", "api");
    expect(host.textContent).toMatch(/Não sei onde corre/);
    expect(obs.sample).not.toHaveBeenCalled();
  });

  it("sem métricas (p.ex. sem metrics-server) mostra porquê; um erro de logs aparece nos logs", async () => {
    w.ENVS.k8sOn = true;
    obs.sample.mockResolvedValue({ error: "Metrics API not available" });
    obs.logs.mockRejectedValue(new Error("deployments.apps \"api\" not found"));
    open("local", "api");
    await vi.waitFor(() => expect(host.textContent).toMatch(/Metrics API not available/));
    expect(host.querySelector(".ll.ERROR")!.textContent).toMatch(/not found/);
  });

  it("«Clear» esconde as linhas até agora; «Follow in terminal» segue os logs do mesmo alvo", async () => {
    (await import("../src/features/stack")).setStackState([{ name: "db", src: "x", url: "internal", state: "running" }]);
    open("local", "db");
    await vi.waitFor(() => expect(host.querySelectorAll(".ll").length).toBe(2));
    click(host.querySelector('[data-action="obs-clear"]')!);
    expect(INF.OBS["local:db"].logs).toEqual([]);
    expect(INF.OBS["local:db"].clearedAt).toBe("2026-11-24T10:00:01.000Z");
    click(host.querySelector('[data-action="obs-follow"]')!);
    expect(obs.follow).toHaveBeenCalledWith({ via: "compose", env: "local", n: "db" });
  });
});
