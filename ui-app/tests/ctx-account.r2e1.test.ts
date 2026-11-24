import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";

/* ADR-0005, R2e1: o `ctx` da barra de estado vem do uso real que o provider reporta
 * (`dx:llm-usage`, anunciado pelo platform/desktop/llm.ts) e o pane Conta mostra a identidade
 * real (no desktop) em vez de «walter · Team SYS». */

let w: any;
const usage = (input: number, output: number) =>
  document.dispatchEvent(new window.CustomEvent("dx:llm-usage", { detail: { provider: "claude", input, output } }));
const ctx = (): HTMLElement => document.getElementById("st-ctx")!;

beforeEach(async () => {
  w = await bootApp();
});
afterEach(() => {
  delete w.DXR;
});

describe("ctx: o uso real da conversa", () => {
  it("antes de qualquer volta fica vazio (sem percentagem inventada)", () => {
    w.ctxPill();
    expect(ctx().textContent).toBe("");
  });

  it("mostra os tokens de entrada da última volta e a soma no título", () => {
    usage(1234, 56);
    expect(ctx().textContent).toBe("ctx 1.2k");
    usage(18500, 300);
    expect(ctx().textContent).toBe("ctx 19k");
    expect(ctx().title).toMatch(/Última volta: 18500 tokens de entrada, 300 de saída · conversa: 19734 de entrada, 356 de saída \(2 volta/);
  });

  it("um provider que não reporta uso não inventa um número", () => {
    usage(0, 0);
    expect(ctx().textContent).toBe("");
    expect(ctx().title).toMatch(/não reportou/);
  });

  it("«Nova conversa» repõe o ctx", () => {
    usage(500, 10);
    expect(ctx().textContent).toBe("ctx 500");
    w.newChat();
    expect(ctx().textContent).toBe("");
  });
});

describe("Conta: a identidade real", () => {
  const pane = (): HTMLElement => document.getElementById("pane-account")!;

  it("no browser diz que não há sessão local (sem «walter · Team SYS»)", () => {
    w.renderAccountPane();
    expect(pane().textContent).toMatch(/Sem sessão local/);
    expect(pane().textContent).not.toMatch(/walter|Team SYS/);
  });

  it("no desktop mostra o utilizador, a máquina e a identidade git", () => {
    w.DXR = { user: "ana", host: "portatil", gitName: "Ana Silva", gitEmail: "ana@example.com" };
    w.renderAccountPane();
    expect(pane().textContent).toMatch(/ana/);
    expect(pane().textContent).toMatch(/portatil/);
    expect(pane().textContent).toMatch(/Ana Silva <ana@example\.com>/);
  });

  it("sem user.name no git, di-lo", () => {
    w.DXR = { user: "ana", host: "portatil" };
    w.renderAccountPane();
    expect(pane().textContent).toMatch(/sem user\.name configurado/);
  });
});
