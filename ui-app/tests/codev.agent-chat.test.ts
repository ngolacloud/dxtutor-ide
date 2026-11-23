// Caso de uso agent-chat (ADR-0003, F4) com fakes: gateway guionado, presenter que
// regista chamadas e gate que escolhe um botão. Sem DOM, sem Tauri.
import { test, expect, vi } from "vitest";
import { makeAgentChat } from "../src/features/codev/application/agent-chat";
import type { AgentChatDeps, AgentGateway } from "../src/features/codev/application/ports";
import type { AgentEvent, ApprovalRequest } from "../src/features/codev/domain/agent-events";
import { parseAgentEvent, parseApproval, describeCall, summarizeResult } from "../src/features/codev/domain/agent-events";
import { costUSD, formatUsage } from "../src/features/codev/domain/pricing";

type H = Parameters<AgentGateway["subscribe"]>[0];

function setup(choice: "allow" | "always" | "deny" = "allow") {
  let h!: H;
  const calls: string[] = [];
  const log = (s: string) => calls.push(s);
  let script: (session: string) => void = () => undefined;
  const gateway: AgentGateway = {
    available: () => true,
    start: vi.fn(async () => "S1"),
    send: vi.fn(async (s: string) => {
      setTimeout(() => script(s), 0);
    }),
    approve: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    setMode: vi.fn(async () => true),
    close: vi.fn(async () => true),
    subscribe: vi.fn(async (handlers: H) => {
      h = handlers;
      return () => undefined;
    }),
  };
  const abort = new AbortController();
  const presenter = new Proxy(
    {
      thinking: () => ({ tools: "TOOLS", body: "BODY" }),
      startAbort: () => abort.signal,
      toolLine: (_h: unknown, name: string, label: string) => {
        log(`toolLine ${name} ${label}`);
        return `ref:${name}`;
      },
      assistantText: (_c: unknown, t: string) => log(`text ${t}`),
      toolRunResult: (_r: unknown, ok: boolean, s: string) => log(`result ${ok} ${s}`),
      toolReason: (_r: unknown, why: string, d: boolean) => log(`reason ${d} ${why}`),
      agentNote: (_c: unknown, k: string, t: string) => log(`note ${k} ${t}`),
      agentReasoning: (_c: unknown, t: string) => log(`reasoning ${t}`),
      liveError: (_c: unknown, _a: boolean, _code: unknown, m: string) => log(`error ${m}`),
    },
    { get: (t: Record<string, unknown>, k: string) => t[k] ?? (() => undefined) },
  );
  const gateButtons: string[][] = [];
  const deps: AgentChatDeps = {
    gateway,
    presenter: presenter as unknown as AgentChatDeps["presenter"],
    gate: {
      ask: async <T>(_h: unknown, btns: Array<{ l: string; v: T }>) => {
        gateButtons.push(btns.map((b) => b.l));
        return btns.find((b) => (b.v as unknown) === choice)!.v;
      },
    },
    verify: { real: () => true, command: (k) => (k === "test" ? { cmd: "cargo test", from: "Cargo.toml", trusted: true } : null) },
    workspace: { root: () => "/proj" },
    reloadFromDisk: vi.fn(async () => undefined),
    model: () => "claude-opus-5-5",
    mode: () => "assist",
    speaker: () => "co-dev · agente",
  };
  const chat = makeAgentChat(deps);
  const emit = (e: AgentEvent, s = "S1") => h.event(s, e);
  return { chat, gateway, deps, calls, gateButtons, abort, emit, h: () => h, setScript: (f: (s: string) => void) => (script = f) };
}

const stream = (event: unknown): AgentEvent => ({ kind: "stream", event }) as AgentEvent;
const done = (outcome: unknown = { type: "done", truncated: false }): AgentEvent => ({ kind: "done", outcome }) as AgentEvent;

test("abre a sessão com os comandos detectados e o modo, faz streaming do texto e mostra o custo", async () => {
  const t = setup();
  t.setScript(() => {
    t.emit(stream({ type: "message_start", model: "claude-opus-5-5" }));
    t.emit(stream({ type: "thinking_delta", index: 0, text: "vou ver" }));
    t.emit(stream({ type: "text_delta", index: 1, text: "Olá " }));
    t.emit(stream({ type: "text_delta", index: 1, text: "mundo" }));
    t.emit({ kind: "usage", request: u(1000, 50), turn: u(1000, 50) });
    t.emit(done());
  });
  await t.chat.send("olá");
  expect(t.gateway.start).toHaveBeenCalledWith({
    root: "/proj", model: "claude-opus-5-5", effort: "high", testCmd: "cargo test", lintCmd: null, mode: "assist",
  });
  expect(t.gateway.send).toHaveBeenCalledWith("S1", "olá");
  expect(t.calls).toContain("reasoning vou ver");
  expect(t.calls).toContain("text Olá mundo");
  expect(t.calls.some((c) => c.startsWith("note usage 1.0k entrada · 50 saída · $"))).toBe(true);
  expect(t.deps.reloadFromDisk).toHaveBeenCalled();

  // a segunda mensagem reutiliza a sessão
  t.setScript(() => t.emit(done()));
  await t.chat.send("de novo");
  expect(t.gateway.start).toHaveBeenCalledTimes(1);
});

test("aprovação: razão, «Permitir sempre» quando a política sugere regra, e a resposta vai ao backend", async () => {
  const t = setup("always");
  const req: ApprovalRequest = {
    call: { id: "tu1", name: "bash", input: { command: "npm run build" }, read_only: false, command: "npm run build" },
    reason: "npm não está na lista de comandos seguros",
    dangerous: false,
    suggestedRule: "bash:npm run",
  };
  t.setScript(() => {
    t.h().approval("S1", req);
    setTimeout(() => {
      t.emit({ kind: "tool_start", id: "tu1", name: "bash", input: { command: "npm run build" } });
      t.emit({ kind: "tool_result", id: "tu1", name: "bash", is_error: false, content: "exit 0\n--- stdout\nok" });
      t.emit(done());
    }, 5);
  });
  await t.chat.send("constrói");
  expect(t.calls).toContain("toolLine bash $ npm run build");
  expect(t.calls).toContain("reason false npm não está na lista de comandos seguros");
  expect(t.gateButtons[0]).toEqual(["Permitir", "Permitir sempre", "Recusar"]);
  expect(t.gateway.approve).toHaveBeenCalledWith("S1", "tu1", true, undefined, true);
  // a mesma linha de ferramenta recebe o resultado (não se duplica)
  expect(t.calls.filter((c) => c.startsWith("toolLine")).length).toBe(1);
  expect(t.calls).toContain("result true exit 0 (+2 linhas)");
});

test("piso de segurança: sem «Permitir sempre»; recusar chega ao backend com razão", async () => {
  const t = setup("deny");
  t.setScript(() => {
    t.h().approval("S1", {
      call: { id: "x", name: "bash", input: {}, read_only: false, command: "git push" },
      reason: "git push: publica no remoto", dangerous: true, suggestedRule: null,
    });
    setTimeout(() => t.emit(done()), 5);
  });
  await t.chat.send("publica");
  expect(t.gateButtons[0]).toEqual(["Permitir", "Recusar"]);
  expect(t.calls).toContain("reason true git push: publica no remoto");
  expect(t.gateway.approve).toHaveBeenCalledWith("S1", "x", false, "o humano recusou", false);
});

test("fins anormais, fallback, repetição e erros chegam ao cartão", async () => {
  const t = setup();
  t.setScript(() => {
    t.emit(stream({ type: "message_start", model: "m" }));
    t.emit(stream({ type: "text_delta", index: 0, text: "parcial" }));
    t.emit({ kind: "retrying", attempt: 1, reason: "Overloaded" });
    t.emit(stream({ type: "message_start", model: "m" }));
    t.emit(stream({ type: "text_delta", index: 0, text: "inteiro" }));
    t.emit({ kind: "served_by", model: "claude-opus-4-8" });
    t.emit(done({ type: "refused", details: { category: "cyber" } }));
  });
  await t.chat.send("x");
  expect(t.calls).toContain("note retry A repetir o pedido (Overloaded)…");
  expect(t.calls).toContain("text inteiro"); // o parcial descartado não volta
  expect(t.calls.filter((c) => c.includes("parcial") && c.includes("inteiro"))).toEqual([]);
  expect(t.calls).toContain("note fallback Respondido por claude-opus-4-8 (fallback do servidor).");
  expect(t.calls.some((c) => c.startsWith("note outcome O modelo recusou") && c.includes("cyber"))).toBe(true);

  const e = setup();
  e.setScript(() => e.h().error("S1", "sem chave da Anthropic"));
  await e.chat.send("x");
  expect(e.calls).toContain("error sem chave da Anthropic");
});

test("eventos de outra sessão são ignorados; Parar cancela; modo e nova conversa vão à sessão", async () => {
  const t = setup();
  t.setScript(() => {
    t.emit(stream({ type: "text_delta", index: 0, text: "de outra sessão" }), "OUTRA");
    t.abort.abort();
    setTimeout(() => t.emit(done({ type: "cancelled" })), 5);
  });
  await t.chat.send("x");
  expect(t.calls.some((c) => c.includes("de outra sessão"))).toBe(false);
  expect(t.gateway.cancel).toHaveBeenCalledWith("S1");
  expect(t.calls.some((c) => c.startsWith("note outcome Interrompido"))).toBe(true);
  t.chat.modeChanged("auto");
  expect(t.gateway.setMode).toHaveBeenCalledWith("S1", "auto");
  t.chat.reset();
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
});

test("falha a abrir a sessão aparece como erro e não deixa o turno pendurado", async () => {
  const t = setup();
  (t.gateway.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("a pasta do projecto não existe"));
  await t.chat.send("x");
  expect(t.calls).toContain("error a pasta do projecto não existe");
});

// ───── domínio ─────

function u(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite };
}

test("parse estreita os payloads do IPC e recusa formas desconhecidas", () => {
  expect(parseAgentEvent({ session: "S", event: { kind: "done", outcome: { type: "done", truncated: false } } })?.session).toBe("S");
  expect(parseAgentEvent({ session: "S", event: { kind: "nada" } })).toBeNull();
  expect(parseAgentEvent({ event: {} })).toBeNull();
  expect(parseAgentEvent({ session: "S", event: { kind: "tool_start" } })).toBeNull();
  const a = parseApproval({ session: "S", request: { call: { id: "1", name: "edit", input: { path: "a" } }, reason: "modo" } });
  expect(a?.request).toEqual({
    call: { id: "1", name: "edit", input: { path: "a" }, read_only: false, command: null },
    reason: "modo", dangerous: false, suggestedRule: null,
  });
  expect(parseApproval({ session: "S", request: { call: {} } })).toBeNull();
});

test("rótulos, resumos e custo", () => {
  expect(describeCall("edit", { path: "src/a.rs" })).toBe("src/a.rs");
  expect(describeCall("grep", { pattern: "TODO", glob: "*.ts" })).toBe("/TODO/ *.ts");
  expect(describeCall("bash", {}, "cargo test")).toBe("$ cargo test");
  expect(summarizeResult("\nlinha 1\nlinha 2\n")).toBe("linha 1 (+1 linhas)");
  // Opus 5.5: $4/M entrada, $20/M saída, $0.20/M leitura de cache, escrita 1.25×
  expect(costUSD("claude-opus-5-5", u(1_000_000, 0))).toBeCloseTo(4);
  expect(costUSD("claude-opus-5-5", u(0, 1_000_000))).toBeCloseTo(20);
  expect(costUSD("claude-opus-5-5", u(0, 0, 1_000_000, 1_000_000))).toBeCloseTo(0.2 + 5);
  expect(costUSD("modelo-desconhecido", u(1, 1))).toBeNull();
  expect(formatUsage("claude-opus-5-5", u(2000, 300, 10_000))).toBe("12k entrada (10k da cache) · 300 saída · $0.016");
});
