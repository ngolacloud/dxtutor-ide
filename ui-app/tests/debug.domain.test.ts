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

import { cargoBins, cargoTargets, fsKeyFor, relOf } from "../src/features/debug/domain/session";

describe("domain/session — que programa depurar e onde o gdb parou (ADR-0006, R4)", () => {
  it("cargoBins: os [[bin]], senão o nome do pacote", () => {
    expect(cargoBins('[package]\nname = "app"\nversion = "0.1.0"\n')).toEqual(["app"]);
    expect(cargoBins('[package]\nname = "app"\n\n[[bin]]\nname = "srv"\npath = "src/srv.rs"\n\n[[bin]]\nname = "cli"\n')).toEqual(["srv", "cli"]);
    expect(cargoBins('[workspace]\nmembers = ["a"]\n')).toEqual([]);
  });

  it("cargoTargets: num workspace, só os crates com src/main.rs ou [[bin]] (as bibliotecas não correm)", () => {
    const tomls = { "Cargo.toml": '[workspace]\nmembers = ["crates/*"]\n', "crates/app/Cargo.toml": '[package]\nname = "app"\n', "crates/lib/Cargo.toml": '[package]\nname = "lib"\n', "crates/tool/Cargo.toml": '[package]\nname = "tool"\n[[bin]]\nname = "tool-cli"\n' };
    const has = (rel: string) => rel === "crates/app/src/main.rs";
    expect(cargoTargets(tomls, has)).toEqual(["app", "tool-cli"]);
  });

  it("fsKeyFor: o caminho do gdb → a chave do editor; fora da pasta não abre", () => {
    expect(fsKeyFor("/proj/src/main.rs", "/proj", "dxtutor/")).toBe("dxtutor/src/main.rs");
    expect(fsKeyFor("/proj/src/main.rs", "/proj/", "dxtutor/")).toBe("dxtutor/src/main.rs");
    expect(fsKeyFor("src/main.rs", "/proj", "dxtutor/")).toBe("dxtutor/src/main.rs");
    expect(fsKeyFor("/rustc/abc/library/core/src/panic.rs", "/proj", "dxtutor/")).toBe(null);
    expect(fsKeyFor("", "/proj", "dxtutor/")).toBe(null);
    expect(relOf("dxtutor/src/main.rs", "dxtutor/")).toBe("src/main.rs");
  });
});
