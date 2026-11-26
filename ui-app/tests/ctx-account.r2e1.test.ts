import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootApp } from "./harness";

/* ADR-0006, R2e1: o `ctx` da barra de estado vem do uso real que o provider reporta
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
  it("antes de qualquer volta fica vazio (sem percentagem inventada)", async () => {
    (await import("../src/features/codev")).ctxPill();
    expect(ctx().textContent).toBe("");
  });

  it("mostra os tokens de entrada da última volta e a soma no título", () => {
    usage(1234, 56);
    expect(ctx().textContent).toBe("ctx 1.2k");
    usage(18500, 300);
    expect(ctx().textContent).toBe("ctx 19k");
    expect(ctx().title).toMatch(/Last turn: 18500 input tokens, 300 output · conversation: 19734 input, 356 output \(2 turn/);
  });

  it("um provider que não reporta uso não inventa um número", () => {
    usage(0, 0);
    expect(ctx().textContent).toBe("");
    expect(ctx().title).toMatch(/did not report/);
  });

  it("o agente v2: a percentagem lida da cache no ctx, a cache e o custo da conversa no título", () => {
    const v2 = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number | null) =>
      document.dispatchEvent(new window.CustomEvent("dx:llm-usage", { detail: { provider: "claude", input, output, cacheRead, cacheWrite, cost } }));
    v2(10_000, 100, 0, 9_000, 0.05);
    expect(ctx().textContent).toBe("ctx 10k · 0% cache");
    v2(10_000, 100, 9_500, 0, 0.01);
    expect(ctx().textContent).toBe("ctx 10k · 48% cache");
    expect(ctx().title).toMatch(/Cache: 48% of the input was read from the cache \(9500 tokens read, 9000 written\)/);
    expect(ctx().title).toMatch(/Conversation cost: \$0\.060/);
    // without a price (another provider) no cost line
    v2(100, 1, 0, 0, null);
    expect(ctx().title).toMatch(/Conversation cost: \$0\.060/);
  });

  it("«Nova conversa» repõe o ctx", async () => {
    usage(500, 10);
    expect(ctx().textContent).toBe("ctx 500");
    (await import("../src/features/codev")).newChat();
    expect(ctx().textContent).toBe("");
  });
});

describe("Conta: a identidade real", () => {
  const pane = (): HTMLElement => document.getElementById("pane-account")!;

  it("no browser diz que não há sessão local (sem «walter · Team SYS»)", async () => {
    (await import("../src/features/account")).renderAccountPane();
    expect(pane().textContent).toMatch(/No local session/);
    expect(pane().textContent).not.toMatch(/walter|Team SYS/);
  });

  it("no desktop mostra o utilizador, a máquina e a identidade git", async () => {
    w.DXR = { user: "ana", host: "portatil", gitName: "Ana Silva", gitEmail: "ana@example.com" };
    (await import("../src/features/account")).renderAccountPane();
    expect(pane().textContent).toMatch(/ana/);
    expect(pane().textContent).toMatch(/portatil/);
    expect(pane().textContent).toMatch(/Ana Silva <ana@example\.com>/);
  });

  it("sem user.name no git, di-lo", async () => {
    w.DXR = { user: "ana", host: "portatil" };
    (await import("../src/features/account")).renderAccountPane();
    expect(pane().textContent).toMatch(/sem user\.name configurado/);
  });
});
