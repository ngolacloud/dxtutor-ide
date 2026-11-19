import { describe, expect, it } from "vitest";
import { bootApp } from "./harness";

describe("smoke: a cadeia real de módulos arranca em jsdom", () => {
  it("publica o motor Co-Dev no window e popula o workspace semeado", async () => {
    const w = await bootApp();
    expect(typeof (w as any).runMission).toBe("function");
    expect(typeof (w as any).doTool).toBe("function");
    expect(Object.keys((w as any).FS).length).toBeGreaterThan(0);
    expect((w as any).FS[(w as any).P_LX]).toBeTruthy();
  });
});
