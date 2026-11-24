import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Goldens de innerHTML sobre o DOM real do Co-Dev (features/codev.ts), via o
 * harness que carrega a cadeia real de módulos. Regra de stripping: ver
 * harness.ts (STRIPPED_ATTRS). Relógio fixo para hhmm() ser determinístico. */

let w: any;
let CM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7k)

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
  // rid() (app.ts) gera hashes com Math.random() — fixá-lo torna os goldens
  // reprodutíveis (o hash em si não é comportamento a caracterizar).
  vi.spyOn(Math, "random").mockReturnValue(0.123456789);
  w = await bootApp();
  CM = await import("../src/features/codev");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("goldens de DOM — estados estáticos", () => {
  it("#pane-codev (conhecimento, checkpoints, routing, equipa, backlog, studio)", () => {
    CM.renderCodevPane();
    const el = document.querySelector("#pane-codev")!;
    expect(golden(el)).toMatchSnapshot();
  });

  it("chat depois de newChat()", () => {
    w.newChat();
    const el = document.querySelector("#ag-msgs")!;
    expect(golden(el)).toMatchSnapshot();
  });

  it("página Definições (renderSettingsPage)", () => {
    const host = document.createElement("div");
    CM.renderSettingsPage(null, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("página Gestor de missões (renderManagerPage, estado inicial)", () => {
    const host = document.createElement("div");
    CM.renderManagerPage(null, host);
    expect(golden(host)).toMatchSnapshot();
  });
});
