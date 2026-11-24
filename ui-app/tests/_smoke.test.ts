import { describe, expect, it } from "vitest";
import { bootApp } from "./harness";

describe("smoke: a cadeia real de módulos arranca em jsdom", () => {
  it("exporta o doTool do Co-Dev e popula o workspace da fixture", async () => {
    const w = await bootApp();
    expect(typeof (await import("../src/features/codev")).doTool).toBe("function");
    expect(Object.keys((w as any).FS).length).toBeGreaterThan(0);
    expect((w as any).FS[(w as any).ROOT + "crates/lexer/src/lib.rs"]).toBeTruthy();
    expect((w as any).P_LX).toBeUndefined(); // os caminhos fixos do projecto de demonstração saíram (ADR-0006, R1c2)
    // O boot reimporta a cadeia inteira (inclui os cursos embutidos, ~770 KB de JSON) DENTRO
    // do teste — os goldens fazem-no num beforeEach (10 s de hook). Com a suite em paralelo o
    // arranque frio encostava aos 5 s por omissão; 20 s dá margem sem esconder um bloqueio real.
  }, 20_000);
});
