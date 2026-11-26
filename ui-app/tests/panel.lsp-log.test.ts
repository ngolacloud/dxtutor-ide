// feature `panel` — o registo dos servidores de linguagem no canal «Language servers» do Output (LSP P6).
import { describe, expect, it } from "vitest";
import { LSP_CHANNEL, lspLogLevel, lspLogText, newLines, type LspLogLine } from "../src/features/panel/domain/lsp-log";
import { PANEL_LSP_LOG_MESSAGES } from "../src/features/panel/ui/lsp-log-messages";
import { makeOutput } from "../src/features/panel/application/output";
import { translator } from "../src/app/i18n";

const line = (seq: number, o: Partial<LspLogLine> = {}): LspLogLine => ({
  seq,
  at: 0,
  key: "python\u0000/home/u/proj\u0000/home/u/proj",
  server: "pyright",
  root: "/home/u/proj",
  kind: "stderr",
  text: `line ${seq}`,
  code: null,
  detail: null,
  ...o,
});
const en = translator(PANEL_LSP_LOG_MESSAGES); // LOCALE en nos testes

describe("o texto de cada linha", () => {
  it("stderr e logMessage com o servidor e a pasta à frente", () => {
    expect(lspLogText(line(1), en)).toBe("[pyright · proj] line 1");
    expect(lspLogText(line(2, { kind: "log", text: "[error] boom", root: "/home/u/proj/" }), en)).toBe("[pyright · proj] [error] boom");
  });

  it("os eventos saem na língua da interface, pelo código e pelos detalhes", () => {
    const ev = (code: string, detail: Record<string, unknown>) => lspLogText(line(1, { kind: "event", code, detail, text: "backend text" }), en);
    expect(ev("started", { pid: 77 })).toBe("[pyright · proj] started (pid 77)");
    expect(ev("stopped", { reason: "idle" })).toBe("[pyright · proj] stopped: no open file for the idle time");
    expect(ev("stopped", { reason: "folder" })).toBe("[pyright · proj] stopped: its folder was closed");
    expect(ev("killed", { reason: "app-exit" })).toBe("[pyright · proj] stopped: dxtutor is closing — it did not exit in time and was killed");
    expect(ev("crashed", { exitCode: 3 })).toBe("[pyright · proj] exited unexpectedly (code 3); it starts again when a file needs it");
    expect(ev("crashed", { exitCode: null })).toBe("[pyright · proj] exited unexpectedly; it starts again when a file needs it");
    expect(ev("over-limit", { running: 7, max: 6 })).toContain("7 language servers are running (the limit is 6)");
    expect(ev("something-new", {})).toBe("[pyright · proj] backend text");
  });

  it("um servidor que morreu ou foi morto é um erro; o tecto, um aviso", () => {
    expect(lspLogLevel(line(1, { kind: "event", code: "crashed" }))).toBe("error");
    expect(lspLogLevel(line(1, { kind: "event", code: "killed" }))).toBe("error");
    expect(lspLogLevel(line(1, { kind: "event", code: "over-limit" }))).toBe("warn");
    expect(lspLogLevel(line(1, { kind: "event", code: "stopped" }))).toBe("info");
    expect(lspLogLevel(line(1, { kind: "log", text: "[error] x" }))).toBe("error");
    expect(lspLogLevel(line(1))).toBe("info");
  });
});

describe("juntar o registo lido com o que se ouve", () => {
  it("cada linha uma vez, por ordem, mesmo quando o registo e os eventos se sobrepõem", () => {
    const backlog = [line(1), line(2), line(3)];
    const early = [line(3), line(4)]; // chegou pelo evento enquanto se lia o registo
    const out = makeOutput(() => 0, [LSP_CHANNEL]);
    let seen = 0;
    const append = (ls: LspLogLine[]) => {
      const r = newLines(ls, seen);
      seen = r.seen;
      for (const l of r.fresh) out.append(LSP_CHANNEL, lspLogText(l, en), lspLogLevel(l));
    };
    append([...early, ...backlog]);
    append([line(4), line(5)]);
    append([line(2)]);
    expect(out.lines(LSP_CHANNEL).map((l) => l.text)).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5"].map((t) => `[pyright · proj] ${t}`));
    expect(seen).toBe(5);
    expect(newLines([], 5)).toEqual({ fresh: [], seen: 5 });
  });
});
