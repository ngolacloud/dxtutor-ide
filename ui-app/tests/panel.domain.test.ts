import { describe, expect, it } from "vitest";
import { parseOsc633, parseOsc7, unescape633 } from "../src/features/panel/domain/shell-integration";
import { detectLinks, linkCandidates } from "../src/features/panel/domain/links";
import { counts, filterProblems, fromLsp, groupByFile, mergeLive, ALL } from "../src/features/panel/domain/problems";
import { portUrl, shortCwd, terminalTitle, duration } from "../src/features/panel/domain/naming";
import type { Problem, TerminalMeta } from "../src/features/panel/domain/types";

const P = (file: string, line: number, severity: Problem["severity"], message = "m", source = "rustc"): Problem => ({
  file, line, col: 1, endLine: line, endCol: 2, severity, message, code: null, source,
});

describe("integração de shell (OSC 633 / OSC 7)", () => {
  it("lê comando escapado e código de saída", () => {
    expect(parseOsc633("E;cargo build\\x3b echo \\\\done")).toEqual({ kind: "command", command: "cargo build; echo \\done" });
    expect(parseOsc633("D;101")).toEqual({ kind: "exit", code: 101 });
    expect(parseOsc633("D;")).toBeNull();
    expect(parseOsc633("A")).toBeNull();
    expect(unescape633("a\\x0ab")).toBe("a\nb");
  });
  it("lê o cwd de um OSC 7 (com percent-encoding)", () => {
    expect(parseOsc7("file://kaeso/home/walter/my%20proj")).toBe("/home/walter/my proj");
    expect(parseOsc7("file:///tmp")).toBe("/tmp");
    expect(parseOsc7("nonsense")).toBeNull();
  });
});

describe("links no terminal", () => {
  it("detecta ficheiro:linha:coluna (rustc), (linha,coluna) (tsc) e URLs", () => {
    const rust = detectLinks("  --> src/lib.rs:10:8");
    expect(rust).toMatchObject([{ kind: "file", path: "src/lib.rs", line: 10, col: 8 }]);
    const ts = detectLinks("ui/src/a.ts(12,5): error TS2322");
    expect(ts[0]).toMatchObject({ kind: "file", path: "ui/src/a.ts", line: 12, col: 5 });
    const url = detectLinks("  ➜  Local:   http://localhost:5173/.");
    expect(url).toMatchObject([{ kind: "url", text: "http://localhost:5173/" }]);
  });
  it("ignora versões e números soltos", () => {
    expect(detectLinks("vite v5.4.11 ready in 0.81s")).toEqual([]);
  });
  it("resolve contra o cwd do terminal e depois contra a raiz; fora do workspace não", () => {
    expect(linkCandidates("src/lib.rs", "/w/crates/a", "/w", null)).toEqual(["crates/a/src/lib.rs", "src/lib.rs"]);
    expect(linkCandidates("/w/x/y.ts", null, "/w", null)).toEqual(["x/y.ts"]);
    expect(linkCandidates("../../etc/passwd", "/w/a", "/w", null)).toEqual([]);
    expect(linkCandidates("~/w/z.go", null, "/home/u/w", "/home/u")).toEqual(["z.go"]);
  });
});

describe("Problems", () => {
  const ps = [P("b.rs", 3, "warning"), P("a.rs", 9, "warning"), P("b.rs", 1, "error", "E0308 mismatched"), P("c.ts", 2, "info", "x", "ts")];
  it("agrupa por ficheiro, ficheiros com erros primeiro, erros antes de avisos", () => {
    const g = groupByFile(ps);
    expect(g.map((x) => x.file)).toEqual(["b.rs", "a.rs", "c.ts"]);
    expect(g[0].items.map((p) => p.severity)).toEqual(["error", "warning"]);
    expect(counts(ps)).toEqual({ errors: 1, warnings: 2, infos: 1 });
  });
  it("filtra por texto (com !exclusão) e severidade", () => {
    expect(filterProblems(ps, { ...ALL, text: "mismatched" })).toHaveLength(1);
    expect(filterProblems(ps, { ...ALL, text: "!b.rs" }).map((p) => p.file)).toEqual(["a.rs", "c.ts"]);
    expect(filterProblems(ps, { ...ALL, warnings: false, infos: false })).toHaveLength(1);
  });
  it("o LSP ao vivo substitui os da mesma fonte nesse ficheiro", () => {
    const live = new Map([["b.rs", [P("b.rs", 7, "error", "live", "rustc")]]]);
    const m = mergeLive(ps, live);
    expect(m.filter((p) => p.file === "b.rs").map((p) => p.message)).toEqual(["live"]);
    expect(m).toHaveLength(3);
  });
  it("converte publishDiagnostics (0-based) em Problem relativo à raiz", () => {
    const p = fromLsp("file:///w/src/main.rs", { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } }, severity: 1, message: "boom", code: "E0599", source: "rust-analyzer" }, "/w");
    expect(p).toMatchObject({ file: "src/main.rs", line: 5, col: 3, endCol: 10, severity: "error", code: "E0599" });
    expect(fromLsp("file:///elsewhere/x.rs", {}, "/w")).toBeNull();
  });
});

describe("nomes", () => {
  const t = (o: Partial<TerminalMeta>): TerminalMeta => ({ id: "t", kind: "shell", group: "t", shell: "/usr/bin/bash", label: null, process: null, cwd: null, exited: null, lastExit: null, commands: 0, command: null, ...o });
  it("título = processo em primeiro plano, senão a shell; tarefas pelo rótulo", () => {
    expect(terminalTitle(t({}))).toBe("bash");
    expect(terminalTitle(t({ process: "bash" }))).toBe("bash");
    expect(terminalTitle(t({ process: "cargo" }))).toBe("cargo");
    expect(terminalTitle(t({ kind: "task", label: "docker compose up" }))).toBe("docker compose up");
  });
  it("cwd curto relativo ao workspace ou ao HOME", () => {
    expect(shortCwd("/w/ide/src-tauri", "/w/ide", "ide", "/w")).toBe("ide/src-tauri");
    expect(shortCwd("/w/other", "/w/ide", "ide", "/w")).toBe("~/other");
    expect(shortCwd(null, null, null, null)).toBe("");
  });
  it("URL de uma porta e duração", () => {
    expect(portUrl({ port: 5173, address: "::" })).toBe("http://localhost:5173");
    expect(portUrl({ port: 80, address: "192.168.1.4" })).toBe("http://192.168.1.4:80");
    expect(duration(840)).toBe("840 ms");
    expect(duration(3200)).toBe("3.2 s");
    expect(duration(65000)).toBe("1 min 05 s");
  });
});
