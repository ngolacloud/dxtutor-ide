// Caso de uso agent-chat (ADR-0003, F4) com fakes: gateway guionado, presenter que
// regista chamadas e gate que escolhe um botão. Sem DOM, sem Tauri.
import { test, expect, vi } from "vitest";
import { translator } from "../src/app/i18n";
import { CODEV_ENGINE_MESSAGES } from "../src/features/codev/application/messages";
import { makeAgentChat } from "../src/features/codev/application/agent-chat";
import type { AgentChatDeps, AgentGateway } from "../src/features/codev/application/ports";
import type { AgentEvent, ApprovalRequest, HistoryItem, SessionSummary } from "../src/features/codev/domain/agent-events";
import { isAgentProvider, isNoToolsError, parseAgentEvent, parseApproval, describeCall, summarizeResult, describeSession, parseSessions, parseHistory, ago, parseExtensions } from "../src/features/codev/domain/agent-events";
import { cacheHitPercent, costUSD, formatUsage } from "../src/features/codev/domain/pricing";
import { architectureSession, isArchitectureRequest } from "../src/features/codev/domain/session-kind";

type H = Parameters<AgentGateway["subscribe"]>[0];

function setup(choice: unknown = "allow", extra: Partial<AgentChatDeps> = {}) {
  const prov = { id: "claude", model: "claude-opus-5-5" };
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
    sessions: vi.fn(async () => [] as SessionSummary[]),
    history: vi.fn(async () => [] as HistoryItem[]),
    setPlan: vi.fn(async () => undefined),
    checkpoints: vi.fn(async () => [] as Array<{ id: number; label: string; created: number }>),
    rewind: vi.fn(async () => "ficheiros repostos para o checkpoint 1 («x»): 2 reposto(s), 1 apagado(s)"),
    extensions: vi.fn(async () => ({
      commands: [{ name: "rever", description: "Revê um ficheiro" }],
      skills: [{ name: "migracoes", description: "Migrações SQL" }],
      hooks: { present: true, trusted: false },
      mcp: { present: false, trusted: false },
      mcpServers: ["github"],
    })),
    trust: vi.fn(async () => undefined),
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
      agentTodos: (_c: unknown, todos: Array<{ content: string; status: string }>) =>
        log(`todos ${todos.map((x) => `${x.status}:${x.content}`).join("|")}`),
      agentPlan: (_r: unknown, m: string) => log(`plan ${m}`),
      toolDiffLink: (_r: unknown, onDiff: () => void) => {
        log("difflink");
        diffClicks.push(onDiff);
      },
      liveError: (_c: unknown, _a: boolean, _code: unknown, m: string) => log(`error ${m}`),
    },
    { get: (t: Record<string, unknown>, k: string) => t[k] ?? (() => undefined) },
  );
  const gateButtons: string[][] = [];
  const diffClicks: Array<() => void> = [];
  const deps: AgentChatDeps = {
    gateway,
    presenter: presenter as unknown as AgentChatDeps["presenter"],
    gate: {
      ask: async <T>(_h: unknown, btns: Array<{ l: string; v: T }>) => {
        gateButtons.push(btns.map((b) => b.l));
        const b = btns.find((x) => (x.v as unknown) === choice) ?? btns[btns.length - 1];
        return b.v;
      },
    },
    verify: { real: () => true, command: (k) => (k === "test" ? { cmd: "cargo test", from: "Cargo.toml", trusted: true } : null) },
    workspace: { root: () => "/proj" },
    reloadFromDisk: vi.fn(async () => undefined),
    provider: () => prov.id,
    model: () => prov.model,
    mode: () => "assist",
    speaker: () => "co-dev · agente",
    nowSecs: () => 10_000,
    openDiff: vi.fn(),
    ...extra,
  };
  const chat = makeAgentChat(deps);
  const emit = (e: AgentEvent, s = "S1") => h.event(s, e);
  return { chat, gateway, deps, prov, calls, gateButtons, diffClicks, abort, emit, h: () => h, setScript: (f: (s: string) => void) => (script = f) };
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
    root: "/proj", provider: "claude", model: "claude-opus-5-5", effort: "high", testCmd: "cargo test", lintCmd: null, mode: "assist",
    // live hunks only when the chat has somewhere to draw them (deps.hunks)
    reviewEdits: false,
    // the Project issue, when the conversation starts from one (A5)
    issue: null,
    // toolset 9: an architecture session only when the deps say so (Studio open / the request)
    architecture: false,
    // toolset 11: a backlog session only for /backlog and /project
    backlog: false,
    // H2: the project of the workspace (none here)
    project: null,
  });
  expect(t.gateway.send).toHaveBeenCalledWith("S1", "olá", { kind: "chat" });
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

test("/retomar: lista as conversas, abre a escolhida com resume (sem criar outra) e redesenha-a", async () => {
  const t = setup("sess-b");
  (t.gateway.sessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: "sess-b", title: "corrige o <b>lexer</b>", messages: 6, model: "m", created: 1, updated: 10_000 - 7200 },
    { id: "sess-a", title: "primeira", messages: 2, model: "m", created: 1, updated: 1 },
  ]);
  (t.gateway.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce("sess-b");
  (t.gateway.history as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { role: "user", text: "corrige o lexer", tools: [] },
    { role: "assistant", text: "Feito.", tools: ["read", "edit"] },
  ]);
  await t.chat.resumeMenu();
  expect(t.gateway.sessions).toHaveBeenCalledWith("/proj");
  // rótulos em texto simples (o gate insere-os como texto, não HTML)
  expect(t.gateButtons[0]).toEqual(["corrige o <b>lexer</b> · há 2 h · 6 mensagens", "primeira · há 0 dias · 2 mensagens".replace("há 0 dias", ago(1, 10_000)), "Cancelar"]);
  expect(t.gateway.start).toHaveBeenCalledTimes(1);
  expect(t.gateway.start).toHaveBeenCalledWith(expect.objectContaining({ resume: "sess-b", mode: "assist" }));
  expect(t.calls).toContain("text Feito.");
  expect(t.calls).toContain("note tools 2 chamada(s): read, edit");
  // a mensagem seguinte vai para a sessão retomada
  t.setScript(() => t.emit(done(), "sess-b"));
  await t.chat.send("e agora?");
  expect(t.gateway.send).toHaveBeenLastCalledWith("sess-b", "e agora?", { kind: "chat" });
});

test("/retomar sem sessões ou cancelado não abre nada", async () => {
  const t = setup("");
  await t.chat.resumeMenu();
  expect(t.calls).toContain("text Ainda não há conversas anteriores neste projecto.");
  (t.gateway.sessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: "x", title: "t", messages: 1, model: "m", created: 1, updated: 1 },
  ]);
  await t.chat.resumeMenu();
  expect(t.gateway.start).not.toHaveBeenCalled();
});

test("parse e rótulos das sessões", () => {
  expect(parseSessions([{ id: "a", title: "t", messages: 1, model: "m", created: 1, updated: 2 }, { id: 3 }, null]).length).toBe(1);
  expect(parseSessions("nada")).toEqual([]);
  expect(parseHistory([{ role: "user", text: "olá" }, { role: "system", text: "x" }])).toEqual([{ role: "user", text: "olá", tools: [] }]);
  expect(ago(100, 130)).toBe("agora");
  expect(ago(0, 600)).toBe("há 10 min");
  expect(ago(0, 86_400)).toBe("há 1 dia");
  expect(describeSession({ id: "a", title: "x".repeat(80), messages: 3, model: "m", created: 0, updated: 0 }, 0)).toMatch(/^x{59}… · agora · 3 mensagens$/);
});

test("F6: checklist de tarefas, aviso de checkpoint e diff no pedido de aprovação de uma edição", async () => {
  const t = setup("allow");
  t.setScript(() => {
    t.emit({ kind: "tool_start", id: "td", name: "todo_write", input: { todos: [
      { content: "ler", status: "completed" }, { content: "corrigir", status: "in_progress" }, { content: 3 },
    ] } });
    t.emit({ kind: "tool_result", id: "td", name: "todo_write", is_error: false, content: "[x] ler" });
    t.h().approval("S1", {
      call: { id: "e1", name: "edit", input: { path: "src/a.rs", old_string: "a", new_string: "b" }, read_only: false, command: null },
      reason: "modo Manual", dangerous: false, suggestedRule: "edit",
    });
    setTimeout(() => {
      t.emit({ kind: "checkpoint", id: 1, label: "corrige" });
      t.emit({ kind: "notice", text: "aviso qualquer" });
      t.emit(done());
    }, 5);
  });
  await t.chat.send("corrige");
  expect(t.calls).toContain("todos completed:ler|in_progress:corrigir");
  expect(t.calls.some((c) => c.startsWith("toolLine todo_write"))).toBe(false);
  expect(t.calls.some((c) => c.startsWith("result") && c.includes("[x] ler"))).toBe(false);
  expect(t.calls).toContain("difflink");
  t.diffClicks[0]();
  expect(t.deps.openDiff).toHaveBeenCalledWith("src/a.rs", "a", "b", "proposta do agente");
  expect(t.calls).toContain("note checkpoint Checkpoint 1 guardado antes das alterações — /reverter para voltar atrás.");
  expect(t.calls).toContain("note notice aviso qualquer");
});

test("F6: o plano aparece no pedido de aprovação; aprovar ou continuar a planear vai ao backend", async () => {
  for (const [choice, allow] of [[true, true], [false, false]] as const) {
    const t = setup(choice);
    t.setScript(() => {
      t.h().approval("S1", {
        call: { id: "p1", name: "exit_plan", input: { plan: "1. ler\n2. corrigir" }, read_only: false, command: null },
        reason: "aprovar o plano proposto", dangerous: false, suggestedRule: null,
      });
      setTimeout(() => t.emit(done()), 5);
    });
    await t.chat.send("planeia");
    expect(t.calls).toContain("plan 1. ler\n2. corrigir");
    expect(t.calls).toContain("toolLine exit_plan plano proposto");
    expect(t.gateButtons[0]).toEqual(["Aprovar plano", "Continuar a planear"]);
    expect(t.gateway.approve).toHaveBeenCalledWith("S1", "p1", allow, allow ? undefined : "o humano quer continuar a planear: ajusta o plano");
  }
});

test("F6: /plano liga o modo plano antes de enviar; /reverter repõe e relê o disco", async () => {
  const t = setup(2);
  t.setScript(() => t.emit(done()));
  await t.chat.plan("acrescenta paginação");
  expect(t.gateway.setPlan).toHaveBeenCalledWith("S1", true);
  expect(t.gateway.send).toHaveBeenCalledWith("S1", "acrescenta paginação", { kind: "chat" });
  expect((t.gateway.setPlan as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    (t.gateway.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );

  (t.gateway.checkpoints as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: 1, label: "primeiro pedido", created: 10_000 - 120 },
    { id: 2, label: "segundo pedido", created: 10_000 - 30 },
  ]);
  (t.deps.reloadFromDisk as ReturnType<typeof vi.fn>).mockClear();
  await t.chat.rewindMenu();
  expect(t.gateButtons.at(-1)).toEqual(["#2 · segundo pedido · agora", "#1 · primeiro pedido · há 2 min", "Cancelar"]);
  expect(t.gateway.rewind).toHaveBeenCalledWith("S1", 2);
  expect(t.deps.reloadFromDisk).toHaveBeenCalled();
  expect(t.calls.some((c) => c.startsWith("note rewind Ficheiros repostos para o checkpoint 1"))).toBe(true);
});

test("F6: /reverter sem sessão ou sem checkpoints explica porquê", async () => {
  const t = setup();
  await t.chat.rewindMenu();
  expect(t.calls.some((c) => c.startsWith("text Ainda não há checkpoints"))).toBe(true);
  expect(t.gateway.rewind).not.toHaveBeenCalled();
});

test("F7: /comandos lista comandos, skills, hooks e MCP; confiar nos hooks fecha a sessão para a próxima os ligar", async () => {
  const t = setup("hooks");
  t.setScript(() => t.emit(done()));
  await t.chat.send("olá"); // abre a sessão S1
  await t.chat.commandsMenu();
  const listing = t.calls.find((c) => c.startsWith("text **Comandos do projecto**"))!;
  expect(listing).toContain("`/rever` — Revê um ficheiro");
  expect(listing).toContain("- migracoes — Migrações SQL");
  expect(listing).toContain("**Hooks** (`.dxtutor/hooks.json`): **por confiar**");
  expect(listing).toContain("**Servidores MCP**: github");
  // só oferece confiar no que existe e não está confiado
  expect(t.gateButtons.at(-1)).toEqual(["Confiar nos hooks do projecto", "Agora não"]);
  expect(t.gateway.trust).toHaveBeenCalledWith("/proj", "hooks");
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
  expect(t.calls.some((c) => c.startsWith("note trusted Hooks confiados"))).toBe(true);
});

test("F7: Board opção 2 — a issue vai ao agente em modo plano com o pedido dela", async () => {
  const t = setup();
  t.setScript(() => t.emit(done()));
  await t.chat.story({ id: "DX-12", title: "Paginação na API", type: "feature", pts: 3, note: "usar cursor" });
  expect(t.gateway.setPlan).toHaveBeenCalledWith("S1", true);
  const sent = (t.gateway.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  expect(sent).toContain("Implementa a issue DX-12 do Board: «Paginação na API» (funcionalidade, 3 pontos).");
  expect(sent).toContain("Nota da issue: usar cursor");
  expect(sent).toContain("exit_plan");
});

test("A5: a story opens a session that knows the issue (its accepted changes count for it)", async () => {
  const t = setup();
  t.setScript(() => t.emit(done()));
  await t.chat.send("olá");
  t.setScript(() => t.emit(done()));
  await t.chat.story({ id: "PRJ-7", title: "x", type: "feature", pts: 1 });
  const starts = (t.gateway.start as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { issue?: string | null }).issue);
  expect(starts).toEqual([null, "PRJ-7"]);
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
  // RF-G01: the chat message answers a chat request; the story's turn answers the issue
  const origins = (t.gateway.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
  expect(origins).toEqual([{ kind: "chat" }, { kind: "issue", issue: "PRJ-7" }]);
});

test("F7: parse do estado das extensões e pedido de uma correcção", () => {
  const x = parseExtensions({ commands: [{ name: "a" }, { nope: 1 }], hooks: { present: true }, mcpServers: ["s", 3] });
  expect(x.commands).toEqual([{ name: "a", description: "" }]);
  expect(x.hooks).toEqual({ present: true, trusted: false });
  expect(x.mcp).toEqual({ present: false, trusted: false });
  expect(x.mcpServers).toEqual(["s"]);
  expect(parseExtensions(null).commands).toEqual([]);
});

test("i18n: com a porta copy (a interface em inglês), o pedido da issue e as notas saem em inglês", async () => {
  const copy = translator(CODEV_ENGINE_MESSAGES);
  const t = setup("allow", { copy });
  t.setScript(() => t.emit(done()));
  await t.chat.story({ id: "DX-1", title: "t", type: "fix", pts: 1 });
  const sent = (t.gateway.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  expect(sent).toContain("Implement issue DX-1 from the Board: «t» (fix, 1 points).");
  expect(sent).toContain("exit_plan");
  t.setScript(() => t.emit({ kind: "done", outcome: { type: "cancelled" } } as AgentEvent));
  await t.chat.send("x");
  expect(t.calls).toContain("note outcome Interrupted by you. The history is consistent: you can carry on.");
});

test("sem a porta copy (fakes antigos), os textos ficam os de antes: uma correcção é «correcção»", async () => {
  const t = setup();
  t.setScript(() => t.emit(done()));
  await t.chat.story({ id: "DX-1", title: "t", type: "fix", pts: 1 });
  expect((t.gateway.send as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain("(correcção, 1 pontos)");
});

test("F8: o provedor activo vai ao backend e mudar de modelo abre outra sessão", async () => {
  const t = setup();
  t.prov.id = "gemini";
  t.prov.model = "gemini-2.5-pro";
  t.setScript(() => t.emit(done()));
  await t.chat.send("olá");
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "gemini", model: "gemini-2.5-pro" }));
  await t.chat.send("de novo");
  expect(t.gateway.start).toHaveBeenCalledTimes(1);
  // o utilizador escolhe o Ollama no seletor: a sessão Gemini fecha, abre-se outra
  t.prov.id = "ollama";
  t.prov.model = "qwen2.5-coder:14b";
  (t.gateway.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce("S2");
  t.setScript((s) => t.emit(done(), s));
  await t.chat.send("e agora?");
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "ollama", model: "qwen2.5-coder:14b" }));
  expect(isAgentProvider("codex") && isAgentProvider("ollama") && !isAgentProvider("mistral")).toBe(true);
});

test("F8: modelo sem tool calling nativo → send devolve false e esse modelo passa ao modo de texto", async () => {
  const t = setup();
  t.prov.id = "ollama";
  t.prov.model = "gemma2:2b";
  t.setScript(() => t.h().error("S1", "[sem-ferramentas] HTTP 400: gemma2:2b does not support tools"));
  expect(t.chat.available()).toBe(true);
  expect(await t.chat.send("olá")).toBe(false);
  expect(t.calls.some((c) => c.startsWith("text O modelo gemma2:2b não suporta ferramentas nativas"))).toBe(true);
  expect(t.calls.some((c) => c.startsWith("error"))).toBe(false);
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
  expect(t.chat.available()).toBe(false);
  // outro modelo do mesmo provedor continua no agente
  t.prov.model = "qwen2.5-coder:14b";
  expect(t.chat.available()).toBe(true);
  // um erro normal continua a ser erro (e send devolve true: não há reenvio)
  t.setScript(() => t.h().error("S1", "HTTP 401: chave inválida"));
  expect(await t.chat.send("x")).toBe(true);
  expect(t.calls).toContain("error HTTP 401: chave inválida");
  expect(isNoToolsError("[sem-ferramentas] x") && !isNoToolsError("HTTP 400")).toBe(true);
});

test("o uso de cada pedido do agente segue para o contador e o ctx (entrada com cache) — ADR-0006, R3c", async () => {
  const t = setup();
  const onUsage = vi.fn();
  (t.deps as { onUsage?: (i: number, o: number) => void }).onUsage = onUsage;
  t.setScript(() => {
    t.emit({ kind: "usage", request: u(1000, 50, 200, 30), turn: u(1000, 50, 200, 30) });
    t.emit({ kind: "usage", request: u(400, 20), turn: u(1400, 70, 200, 30) });
    t.emit(done());
  });
  await t.chat.send("olá");
  // por pedido, não o acumulado da volta; com a cache lida/escrita e o custo do pedido
  expect(onUsage.mock.calls.map((c) => c.slice(0, 2))).toEqual([[1230, 50], [400, 20]]);
  expect(onUsage.mock.calls[0][2]).toEqual({ cacheRead: 200, cacheWrite: 30, cost: costUSD("claude-opus-5-5", u(1000, 50, 200, 30)) });
  expect(onUsage.mock.calls[1][2]).toEqual({ cacheRead: 0, cacheWrite: 0, cost: costUSD("claude-opus-5-5", u(400, 20)) });
});

test("H1: /comandos mostra a sandbox do projecto e deixa confiá-la", async () => {
  const t = setup("sandbox");
  (t.gateway.extensions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    commands: [], skills: [], hooks: { present: false, trusted: false }, mcp: { present: false, trusted: false },
    sandbox: { present: true, trusted: false }, mcpServers: [],
  });
  await t.chat.commandsMenu();
  expect(t.calls.some((c) => c.startsWith("text ") && c.includes("**Sandbox** (`.dxtutor/sandbox.json`)"))).toBe(true);
  expect(t.gateway.trust).toHaveBeenCalledWith("/proj", "sandbox");
});

test("conjunto 11: /backlog abre uma sessão de backlog; o /project continua nela; a conversa normal não a tem", async () => {
  const t = setup();
  t.setScript(() => t.emit(done()));
  await t.chat.backlog("/backlog uma loja com encomendas");
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ backlog: true, issue: null }));
  expect(t.gateway.send).toHaveBeenLastCalledWith("S1", "/backlog uma loja com encomendas", { kind: "chat" });
  // /project goes on in the open backlog session (the model already read the draft)
  await t.chat.backlog("/project scrum, sprints de 2 semanas");
  expect(t.gateway.start).toHaveBeenCalledTimes(1);
  expect(t.gateway.send).toHaveBeenLastCalledWith("S1", "/project scrum, sprints de 2 semanas", { kind: "chat" });
  // another /backlog is a new backlog session
  await t.chat.backlog("/backlog outra vez");
  expect(t.gateway.close).toHaveBeenCalledWith("S1");
  expect(t.gateway.start).toHaveBeenCalledTimes(2);
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ backlog: true }));
  // a new conversation is a plain one again; a /project there opens a backlog session
  t.chat.reset();
  await t.chat.send("olá");
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ backlog: false }));
  await t.chat.backlog("/project kanban");
  expect(t.gateway.start).toHaveBeenCalledTimes(4);
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ backlog: true }));
});

test("conjunto 9: a sessão nova é de arquitectura conforme as deps, com o primeiro pedido", async () => {
  const t = setup();
  const architecture = vi.fn((q: string) => q.includes("arquitectura"));
  (t.deps as { architecture?: (q: string) => boolean }).architecture = architecture;
  t.setScript(() => t.emit(done()));
  await t.chat.send("desenha a arquitectura do serviço");
  expect(architecture).toHaveBeenCalledWith("desenha a arquitectura do serviço");
  expect(t.gateway.start).toHaveBeenLastCalledWith(expect.objectContaining({ architecture: true }));
  // the next message reuses the session: the kind is decided once
  await t.chat.send("e agora corrige o bug");
  expect(t.gateway.start).toHaveBeenCalledTimes(1);
});

test("custo: as escritas de cache de 1 hora custam 2× a entrada; a percentagem da cache", () => {
  // Opus 5.5: 4k × $4 × 1.25 + 6k × $4 × 2 = $0.02 + $0.048
  expect(costUSD("claude-opus-5-5", { ...u(0, 0, 0, 10_000), cache_creation_1h_input_tokens: 6_000 })).toBeCloseTo(0.068);
  expect(cacheHitPercent(10_000, 8_700)).toBe(87);
  expect(cacheHitPercent(0, 0)).toBeNull();
  expect(isArchitectureRequest("Desenha a arquitetura do sistema")).toBe(true);
  expect(isArchitectureRequest("draw an architecture diagram")).toBe(true);
  expect(isArchitectureRequest("corrige o teste do lexer")).toBe(false);
  expect(architectureSession(true, "corrige o teste")).toBe(true);
});

test("live hunks: opens with reviewEdits, saves before sending, and shows the review bar and validation", async () => {
  const t = setup();
  const order: string[] = [];
  const sunk: string[] = [];
  const decided: Array<[string, boolean]> = [];
  let settle: ((l: string) => void) | null = null;
  t.deps.flush = vi.fn(async () => void order.push("flush"));
  (t.gateway.send as ReturnType<typeof vi.fn>).mockImplementation(async (s: string) => {
    order.push("send");
    setTimeout(() => script(s), 0);
  });
  let script: (s: string) => void = () => undefined;
  t.deps.hunks = {
    event: (_s, e) => sunk.push(e.kind),
    decideAll: (call, accept) => decided.push([call, accept]),
    open: () => undefined,
    onSettled: (_call, f) => (settle = f),
  };
  const bars: Array<{ acceptAll(): void; rejectAll(): void; open(): void }> = [];
  (t.deps.presenter as unknown as Record<string, unknown>).hunkReview = (_r: unknown, info: { path: string; count: number }, on: (typeof bars)[number]) => {
    t.calls.push(`hunkReview ${info.path} ${info.count}`);
    bars.push(on);
    return { settle: (l: string) => t.calls.push(`settled ${l}`) };
  };
  script = () => {
    t.emit({ kind: "hunk_start", hunk: "c:1", call: "c", path: "src/a.rs", op: "replace", range: { start: 1, end: 1 }, base: null, old: "a\n" });
    t.emit({ kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "modo Assistido: aceitas cada alteração no editor" });
    t.emit({ kind: "validation", status: "passed", checks: [{ command: "cargo test", ok: true, summary: "ok" }], baseline: [] });
    t.emit(done());
  };
  await t.chat.send("muda isto");
  expect(t.gateway.start).toHaveBeenCalledWith(expect.objectContaining({ reviewEdits: true }));
  expect(order).toEqual(["flush", "send"]);
  expect(sunk).toEqual(["hunk_start", "hunk_review", "validation"]);
  expect(t.calls).toContain("hunkReview src/a.rs 1");
  expect(t.calls).toContain("reason false modo Assistido: aceitas cada alteração no editor");
  expect(t.calls).toContain("note validation Validação passou (`cargo test`): as alterações provisórias ficam.");
  bars[0].acceptAll();
  expect(decided).toEqual([["c", true]]);
  settle!("✓ 1 alteração(ões) aplicada(s)");
  expect(t.calls).toContain("settled ✓ 1 alteração(ões) aplicada(s)");
});

test("RF-G06: a pergunta do Co-Dev aparece no chat e o evento é reconhecido", async () => {
  expect(parseAgentEvent({ session: "S1", event: { kind: "question", text: "cursor ou página?" } })).not.toBeNull();
  const t = setup();
  t.setScript(() => {
    t.emit({ kind: "question", text: "cursor ou página?" });
    t.emit(done());
  });
  await t.chat.send("pagina a API");
  expect(t.calls).toContain("note question Pergunta do Co-Dev (responde na próxima mensagem): cursor ou página?");
});

test("RF-P03: numa sessão PairCode, quem não conduz não aprova — o pedido é recusado com aviso", async () => {
  const t = setup();
  (t.deps as { canApprove?: () => boolean }).canApprove = () => false;
  t.setScript(() => {
    t.h().approval("S1", { call: { id: "c1", name: "bash", input: { command: "cargo build" }, read_only: false, command: "cargo build" }, reason: "modo Manual", dangerous: false, suggestedRule: "bash:cargo build" });
    setTimeout(() => t.emit(done()), 5);
  });
  await t.chat.send("compila");
  await new Promise((r) => setTimeout(r, 0));
  expect(t.gateway.approve).toHaveBeenCalledWith("S1", "c1", false, expect.stringContaining("só quem conduz"));
  expect(t.calls.some((c) => c.startsWith("note pair Só quem conduz"))).toBe(true);
});

test("RF-S01/S08 (F3.2/F3.3): «Writing path a–b» uma vez por chamada, contra a ordem do plano aprovado", async () => {
  const t = setup();
  const lines: Array<{ path: string; start: number; end: number; place: unknown }> = [];
  const opened: string[] = [];
  t.deps.hunks = { event: () => undefined, decideAll: () => undefined, open: (p: string) => opened.push(p), onSettled: () => undefined };
  const opens: Array<() => void> = [];
  (t.deps.presenter as unknown as Record<string, unknown>).hunkWriting = (_c: unknown, info: (typeof lines)[number], open: () => void) => {
    lines.push(info);
    opens.push(open);
  };
  const start = (call: string, path: string, s: number, e: number, n = 1): AgentEvent =>
    ({ kind: "hunk_start", hunk: `${call}:${n}`, call, path, op: "replace", range: { start: s, end: e }, base: null, old: "" }) as AgentEvent;
  t.setScript(() => {
    t.emit({ kind: "tool_start", id: "p", name: "exit_plan", input: { plan: "x", steps: [{ text: "lexer", files: [{ path: "src/lexer.rs" }] }, { text: "parser", files: [{ path: "./src/parser.rs" }] }] } });
    // ahead: parser.rs before lexer.rs
    t.emit(start("c1", "src/parser.rs", 40, 52));
    t.emit(start("c1", "src/parser.rs", 90, 91, 2)); // same call: no second line
    t.emit(start("c2", "src/lexer.rs", 3, 2)); // an insertion
    t.emit(start("c3", "README.md", 1, 1));
    t.emit(done());
  });
  await t.chat.send("implementa o plano");
  expect(lines.map((l) => [l.path, l.start, l.end, l.place])).toEqual([
    ["src/parser.rs", 40, 52, { kind: "ahead", step: 2, pending: ["src/lexer.rs"] }],
    ["src/lexer.rs", 3, 2, { kind: "in-order", step: 1 }],
    ["README.md", 1, 1, { kind: "outside" }],
  ]);
  opens[0]();
  expect(opened).toEqual(["src/parser.rs"]);
  // without a plan the line is still there, with no place
  t.chat.reset();
  t.setScript(() => {
    t.emit(start("d1", "src/a.rs", 5, 6));
    t.emit(done());
  });
  await t.chat.send("muda isto");
  expect(lines.at(-1)!.place).toEqual({ kind: "none" });
});

test("RF-G08: os blocos contra as linhas que o plano deu — aviso na linha «Writing» e na barra de revisão", async () => {
  const t = setup();
  const lines: Array<{ path: string; lines?: unknown }> = [];
  const reviews: Array<{ path: string; count: number; outside?: { n: number; planned: string } }> = [];
  t.deps.hunks = { event: () => undefined, decideAll: () => undefined, open: () => undefined, onSettled: () => undefined };
  const pres = t.deps.presenter as unknown as Record<string, unknown>;
  pres.hunkWriting = (_c: unknown, info: (typeof lines)[number]) => lines.push(info);
  pres.hunkReview = (_r: unknown, info: (typeof reviews)[number]) => {
    reviews.push(info);
    return { settle: () => undefined };
  };
  const start = (call: string, path: string, s: number, e: number, n: number): AgentEvent =>
    ({ kind: "hunk_start", hunk: `${call}:${n}`, call, path, op: "replace", range: { start: s, end: e }, base: null, old: "" }) as AgentEvent;
  t.setScript(() => {
    t.emit({ kind: "tool_start", id: "p", name: "exit_plan", input: { plan: "x", steps: [{ text: "parse", files: [{ path: "src/parser.rs", start: 40, end: 52 }, { path: "README.md" }] }] } });
    t.emit(start("c1", "src/parser.rs", 41, 45, 1)); // in
    t.emit(start("c1", "src/parser.rs", 120, 125, 2)); // out
    t.emit(start("c1", "src/parser.rs", 300, 300, 3)); // out
    t.emit({ kind: "hunk_review", call: "c1", hunks: ["c1:1", "c1:2", "c1:3"], reason: "" });
    t.emit(start("c2", "src/parser.rs", 200, 210, 1)); // out, first of its call
    t.emit({ kind: "hunk_review", call: "c2", hunks: ["c2:1"], reason: "" });
    t.emit(start("c3", "README.md", 1, 2, 1)); // the plan gave no lines for it
    t.emit({ kind: "hunk_review", call: "c3", hunks: ["c3:1"], reason: "" });
    t.emit(done());
  });
  await t.chat.send("implementa");
  expect(lines.map((l) => l.lines)).toEqual([{ kind: "in" }, { kind: "out", planned: [[40, 52]] }, { kind: "unknown" }]);
  expect(reviews.map((r) => r.outside)).toEqual([{ n: 2, planned: "40–52" }, { n: 1, planned: "40–52" }, undefined]);
});


test("RF-A03/A04: a revisão que viola as regras chega à barra com as violações e o override, que a desbloqueia", async () => {
  const t = setup();
  const overridden: Record<string, (adr: string) => void> = {};
  const overrides: string[] = [];
  t.deps.hunks = {
    event: () => undefined, decideAll: () => undefined, open: () => undefined, onSettled: () => undefined,
    override: async (call: string) => { overrides.push(call); overridden[call]?.("ADR-0007"); return true; },
    onOverridden: (call: string, f: (adr: string) => void) => { overridden[call] = f; },
  };
  const seen: Array<{ violations?: string[]; on: { override?(): void }; unblocked: string[] }> = [];
  (t.deps.presenter as unknown as Record<string, unknown>).hunkReview = (_r: unknown, info: { violations?: string[] }, on: { override?(): void }) => {
    const entry = { violations: info.violations, on, unblocked: [] as string[] };
    seen.push(entry);
    return { settle: () => undefined, unblock: (adr: string) => entry.unblocked.push(adr) };
  };
  t.setScript(() => {
    t.emit({ kind: "hunk_start", hunk: "c:1", call: "c", path: "src/a.ts", op: "replace", range: { start: 1, end: 1 }, base: null, old: "" } as AgentEvent);
    t.emit({ kind: "hunk_review", call: "c", hunks: ["c:1"], reason: "viola", violations: [{ rule: "library:moment", message: "biblioteca proibida: moment", path: "src/a.ts" }] } as AgentEvent);
    t.emit({ kind: "hunk_start", hunk: "d:1", call: "d", path: "src/b.ts", op: "replace", range: { start: 1, end: 1 }, base: null, old: "" } as AgentEvent);
    t.emit({ kind: "hunk_review", call: "d", hunks: ["d:1"], reason: "ok" } as AgentEvent);
    t.emit(done());
  });
  await t.chat.send("muda isto");
  expect(seen[0].violations).toEqual(["biblioteca proibida: moment"]);
  expect(typeof seen[0].on.override).toBe("function");
  seen[0].on.override!();
  await vi.waitFor(() => expect(seen[0].unblocked).toEqual(["ADR-0007"]));
  expect(overrides).toEqual(["c"]);
  // a review without violations: no override offered
  expect(seen[1].violations).toBeUndefined();
  expect(seen[1].on.override).toBeUndefined();
});

test("RF-G07: depois do Stop, a barra mantém ou descarta (volta ao checkpoint do turno, só os ficheiros)", async () => {
  expect(parseAgentEvent({ session: "S1", event: { kind: "stop_review", checkpoint: 3, files: ["a.rs"] } })?.event).toEqual({ kind: "stop_review", checkpoint: 3, files: ["a.rs"] });
  expect(parseAgentEvent({ session: "S1", event: { kind: "stop_review", checkpoint: "3", files: [] } })).toBeNull();
  let answer = false;
  const t = setup("allow", { confirm: () => answer });
  const bars: Array<{ on: { keep(): void; discard(): void }; settled: string[] }> = [];
  (t.deps.presenter as unknown as Record<string, unknown>).stopReview = (_c: unknown, info: { checkpoint: number; files: string[] }, on: { keep(): void; discard(): void }) => {
    t.calls.push(`stopReview ${info.checkpoint} ${info.files.join(",")}`);
    const b = { on, settled: [] as string[] };
    bars.push(b);
    return { settle: (l: string) => b.settled.push(l) };
  };
  t.setScript(() => {
    t.emit({ kind: "stop_review", checkpoint: 3, files: ["src/a.rs", "src/b.rs"] } as AgentEvent);
    t.emit({ kind: "stop_review", checkpoint: 4, files: ["src/c.rs"] } as AgentEvent);
    t.emit(done({ type: "cancelled" }));
  });
  await t.chat.send("muda isto");
  expect(t.calls).toContain("stopReview 3 src/a.rs,src/b.rs");
  // keep: nothing goes back
  bars[0].on.keep();
  expect(bars[0].settled).toEqual(["Mantido — as alterações do turno parado ficam."]);
  // discard, refused in the confirmation: nothing goes back either
  bars[1].on.discard();
  expect(t.gateway.rewind).not.toHaveBeenCalled();
  // discard, confirmed: the files back to the checkpoint (not the conversation), the editor reloads
  answer = true;
  const reloads = (t.deps.reloadFromDisk as ReturnType<typeof vi.fn>).mock.calls.length;
  bars[1].on.discard();
  await vi.waitFor(() => expect(bars[1].settled).toEqual(["Descartado — os ficheiros voltaram ao checkpoint 4."]));
  expect(t.gateway.rewind).toHaveBeenCalledWith("S1", 4, false);
  expect((t.deps.reloadFromDisk as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reloads + 1);
});
