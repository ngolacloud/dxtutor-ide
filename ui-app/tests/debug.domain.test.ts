import { describe, expect, it } from "vitest";
import { bpKey, bpLine, bpPath } from "../src/features/debug/domain/breakpoints";

/* Testes unitários do domínio PURO da feature Run and Debug (ADR-0002, Fase 2): só
 * dados→dados, sem harness nem `window`. Os geradores das sessões simuladas
 * (lexer-trace/crash-trace/launch) saíram com elas (ADR-0006, R1c2); fica a regra das
 * chaves de breakpoint. */

describe("domain/breakpoints — chaves path:line", () => {
  it("bpKey junta; bpLine/bpPath desfazem (caminho com ':' no meio é raro, mas o nº fica no fim)", () => {
    expect(bpKey("a/b/lib.rs", 10)).toBe("a/b/lib.rs:10");
    expect(bpLine("a/b/lib.rs:10")).toBe("10");
    expect(bpPath("a/b/lib.rs:10")).toBe("a/b/lib.rs");
  });

  it("um caminho com ':' no meio mantém-se inteiro (o nº é só o segmento final)", () => {
    expect(bpPath(bpKey("C:/src/lib.rs", 3))).toBe("C:/src/lib.rs");
    expect(bpLine(bpKey("C:/src/lib.rs", 3))).toBe("3");
  });
});
