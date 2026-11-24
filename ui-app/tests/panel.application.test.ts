import { describe, expect, it, vi } from "vitest";
import { makeTerminals } from "../src/features/panel/application/terminals";
import { makeProblems } from "../src/features/panel/application/problems-service";
import { makeOutput } from "../src/features/panel/application/output";
import type { CheckEvent, Clock, ProblemsPort, PtyPort, SpawnRequest, WorkspacePort } from "../src/features/panel/application/ports";
import type { ScanResult } from "../src/features/panel/domain/types";

function fakePty() {
  let onData: (id: string, d: string) => void = () => {};
  let onExit: (id: string, c: number) => void = () => {};
  const spawned: SpawnRequest[] = [];
  const written: [string, string][] = [];
  const killed: string[] = [];
  const port: PtyPort = {
    spawn: async (r) => { spawned.push(r); },
    write: async (id, d) => { written.push([id, d]); },
    resize: async () => {},
    kill: async (id) => { killed.push(id); queueMicrotask(() => onExit(id, 129)); return true; },
    shells: async () => [],
    info: async () => ({ shell: "/bin/bash", shellPid: 1, process: "cargo", cwd: "/w/sub" }),
    onData: async (cb) => { onData = cb; return () => {}; },
    onExit: async (cb) => { onExit = cb; return () => {}; },
  };
  return { port, spawned, written, killed, data: (id: string, d: string) => onData(id, d), exit: (id: string, c: number) => onExit(id, c) };
}

const ws = (root: string | null = "/w"): WorkspacePort & { r: string | null } => {
  const w = {
    r: root,
    root: () => w.r,
    name: () => "w",
    home: () => "/home/u",
    env: () => ({ DOCKER_HOST: "unix:///x" }),
    hasFile: () => true,
    openFile: () => {},
    openUrl: () => {},
  };
  return w;
};

const realClock: Clock = { now: () => Date.now(), after: (ms, f) => { const t = setTimeout(f, ms); return () => clearTimeout(t); } };

describe("gestor de terminais", () => {
  it("cria uma shell na raiz, arranca-a com as medidas da vista e encaminha os bytes", async () => {
    const pty = fakePty();
    const t = makeTerminals({ pty: pty.port, workspace: ws(), output: makeOutput(Date.now), clock: realClock });
    const got: string[] = [];
    t.setSink({ data: (_id, d) => got.push(d), exited: () => {} });
    const m = t.create();
    await t.start(m.id, 30, 120);
    expect(pty.spawned[0]).toMatchObject({ id: m.id, rows: 30, cols: 120, cwd: "/w", command: undefined, env: { DOCKER_HOST: "unix:///x" } });
    pty.data(m.id, "hello");
    pty.data("other", "ignored");
    expect(got).toEqual(["hello"]);
    t.write(m.id, "ls\r");
    expect(pty.written).toEqual([[m.id, "ls\r"]]);
  });

  it("uma tarefa devolve o código de saída real e reutiliza o lugar", async () => {
    const pty = fakePty();
    const out = makeOutput(Date.now);
    const t = makeTerminals({ pty: pty.port, workspace: ws(), output: out, clock: realClock });
    const p = t.runTask("docker compose up -d", { label: "compose" });
    const id = t.active()!;
    await t.start(id, 24, 80);
    expect(pty.spawned[0].command).toBe("docker compose up -d");
    pty.exit(id, 17);
    await expect(p).resolves.toBe(17);
    expect(t.get(id)?.exited).toBe(17); // fica à vista com o código
    void t.runTask("docker compose up -d", { label: "compose" });
    expect(t.list().filter((x) => x.label === "compose")).toHaveLength(1);
    expect(out.lines("Tasks").map((l) => l.text).join("\n")).toContain("✖ compose · exit 17");
  });

  it("dividir abre no cwd da instância; matar fecha; exit 0 de uma shell fecha", async () => {
    const pty = fakePty();
    const t = makeTerminals({ pty: pty.port, workspace: ws(), output: makeOutput(Date.now), clock: realClock });
    const a = t.create();
    await t.start(a.id, 24, 80);
    t.shellEvent(a.id, { kind: "cwd", path: "/w/crates" });
    const b = t.split(a.id)!;
    expect(b.group).toBe(a.group);
    expect(b.cwd).toBe("/w/crates");
    expect(t.group(a.id)).toHaveLength(2);
    await t.start(b.id, 24, 80);
    await t.kill(b.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.list().map((x) => x.id)).toEqual([a.id]);
    pty.exit(a.id, 0);
    expect(t.list()).toHaveLength(0);
  });

  it("regista comandos (OSC 633) e expõe os que falharam, sem o Ctrl+C", async () => {
    const pty = fakePty();
    const t = makeTerminals({ pty: pty.port, workspace: ws(), output: makeOutput(Date.now), clock: realClock });
    const a = t.create();
    await t.start(a.id, 24, 80);
    t.shellEvent(a.id, { kind: "command", command: "cargo test" });
    t.shellEvent(a.id, { kind: "exit", code: 101 }, "test result: FAILED");
    t.shellEvent(a.id, { kind: "command", command: "sleep 9" });
    t.shellEvent(a.id, { kind: "exit", code: 130 });
    t.shellEvent(a.id, { kind: "command", command: "ls" });
    t.shellEvent(a.id, { kind: "exit", code: 0 });
    expect(t.history()).toHaveLength(3);
    expect(t.failures()).toMatchObject([{ command: "cargo test", exitCode: 101, output: "test result: FAILED" }]);
    expect(t.get(a.id)?.lastExit).toBe(0);
  });

  it("o título acompanha o processo em primeiro plano", async () => {
    const pty = fakePty();
    const t = makeTerminals({ pty: pty.port, workspace: ws(), output: makeOutput(Date.now), clock: realClock });
    const a = t.create();
    const f = vi.fn();
    t.subscribe(f);
    await t.start(a.id, 24, 80); // o arranque já pergunta ao backend o que está a correr
    await new Promise((r) => setTimeout(r, 0));
    expect(t.get(a.id)).toMatchObject({ process: "cargo", cwd: "/w/sub", shell: "/bin/bash" });
    expect(f).toHaveBeenCalled();
  });

  it("ao abrir a pasta, a shell virgem aberta antes passa para a raiz nova", async () => {
    const pty = fakePty();
    const w = ws(null);
    const t = makeTerminals({ pty: pty.port, workspace: w, output: makeOutput(Date.now), clock: realClock });
    const a = t.create();
    await t.start(a.id, 24, 80);
    w.r = "/proj";
    t.workspaceChanged();
    await new Promise((r) => setTimeout(r, 0));
    expect(pty.killed).toEqual([a.id]);
    expect(t.list().map((x) => x.cwd)).toEqual(["/proj"]);
    expect(t.active()).toBe(t.list()[0].id);
  });
});

describe("serviço de Problems", () => {
  function fakeProblems(result: ScanResult) {
    let check: (e: CheckEvent) => void = () => {};
    let resolve: (r: ScanResult) => void = () => {};
    const scans: string[] = [];
    const port: ProblemsPort = {
      scan: (root) => { scans.push(root); return new Promise((r) => { resolve = r; }); },
      onCheck: async (cb) => { check = cb; return () => {}; },
      onLsp: async () => () => {},
    };
    return { port, scans, finish: () => resolve(result), check: (e: CheckEvent) => check(e) };
  }
  const result: ScanResult = {
    problems: [{ file: "src/a.rs", line: 1, col: 1, endLine: 1, endCol: 2, severity: "error", message: "boom", code: "E0308", source: "rustc" }],
    checks: [{ source: "rustc", command: "cargo check", cwd: "", exitCode: 101, millis: 900, count: 1, error: null }],
    skipped: ["tsconfig.json found but tsc is not installed"],
  };

  it("voo único: pedidos durante um scan dão UM scan a seguir; relata no canal Problems", async () => {
    const f = fakeProblems(result);
    const out = makeOutput(Date.now);
    const s = makeProblems({ port: f.port, workspace: ws(), output: out, clock: realClock });
    s.request("open", true);
    s.request("save", true);
    s.request("save", true);
    expect(f.scans).toHaveLength(1);
    f.check({ phase: "done", report: result.checks[0] });
    f.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.all()).toHaveLength(1);
    expect(f.scans).toHaveLength(2);
    const log = out.lines("Problems").map((l) => l.text).join("\n");
    expect(log).toContain("✓ rustc: 1 problem · exit 101 · 900 ms");
    expect(log).toContain("tsc is not installed");
  });

  it("um scan de uma pasta que entretanto foi trocada é descartado", async () => {
    const f = fakeProblems(result);
    const w = ws("/a");
    const s = makeProblems({ port: f.port, workspace: w, output: makeOutput(Date.now), clock: realClock });
    s.request("open", true);
    w.r = "/b";
    f.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.all()).toEqual([]);
  });
});
